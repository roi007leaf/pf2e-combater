import { classTacticAdjustment } from "../rules/class-tactics.js";
import { canUseIntelCategory } from "../rules/intel-ledger.js";
import { npcTacticAdjustment } from "../rules/npc-tactics.js";
import { resolveTacticPersonality, tacticPersonalityAdjustment } from "../rules/tactic-personality.js";
import { resourceHorizonAdjustment } from "../rules/resource-horizon.js";
import { backingStrikeForAction, backingStrikesForAction, bestReadyStrikeFromOptions } from "./backing-strike.js";
import { commanderTacticAdjustment } from "./scoring/commander.js";
import {
  actionTraitSlugs,
  canUseTargetDefenses,
  canUseTargetSave,
  isAreaAction,
  isAttackLikeAction,
  isMeleeStrikeFallback,
  isRangedStrike,
  isSpellAction,
  hpPercent,
  damageAverage,
  maxRange,
} from "./scoring/facts.js";
import {
  actionSkillDcSlug,
  ownSkillReliabilityScore,
  skillAutoFillRequirement,
  skillCheckScore,
} from "./scoring/skills.js";
import { spellTacticalAdjustment } from "./scoring/spells.js";
import { nativeRollContextPreflight } from "./scoring/roll-preflight.js";
import { nativeOutcomeRanking } from "./scoring/probability.js";
import { blockedCandidateResult, healingIsIdle } from "./scoring/gates.js";
import {
  bestTargetForAction,
  distinctTargetsFor,
  focusFireBonus,
  targetRankingReasons,
} from "./scoring/targets.js";
import {
  baseScore,
  defaultReason,
  includesStand,
  scoreRoleTactics,
  suggestedTargetFor,
} from "./scoring/tactics.js";
import { sanitizeScoredRecommendation } from "./recommendation-safety.js";
import { detectionState } from "./target-pool.js";
import { t } from "../i18n.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { deterministicPreferenceAdjustment } from "../state/preference-profile.js";
import { SETTINGS, settingOrDefault } from "../settings.js";
import { HARD_BLOCK_SCORE, MAP_PENALTY_BY_ATTACK_INDEX, mapScoreCost } from "./scoring/weights.js";

// PF2e core rule: affecting a hidden creature (any attack roll or save-requiring effect) needs a
// DC 11 flat check first, independent of the attack roll or save itself. A flat check against DC
// 11 succeeds on a roll of 11 or higher — exactly half of a d20's outcomes.
const HIDDEN_TARGET_FLAT_CHECK_DISCOUNT = 0.5;
const PLAYER_INTEL_CATEGORIES = ["traits", "saves", "perception", "weaknesses", "resistances", "immunities"];

function npcStrikeAttackBonus(action) {
  if (action?.source !== "strike" || action?.item?.type !== "melee") return null;
  return npcStrikeItemBonus(action);
}

function npcStrikeItemBonus(action) {
  if (action?.item?.type !== "melee") return null;
  const rawBonus = action.item.system?.bonus?.value;
  if (rawBonus === null || rawBonus === undefined || rawBonus === "") return null;
  const bonus = Number(rawBonus);
  return Number.isFinite(bonus) ? bonus : null;
}

// A multi-Strike action (Hunted Shot, Flurry of Blows) is worth its first Strike plus each extra
// Strike it packs into the same action, scored as the backing weapon against the same target and
// discounted for the MAP that extra Strike takes.
function extraStrikeValue(context, action, backingStrike, target, siblingSpells) {
  if (!action.activityProfile?.multiStrike || !backingStrike || !target) return 0;
  const strikes = Number(action.activityProfile.countedStrikes)
    || (action.activityProfile.includes ?? []).filter((atom) => atom === "strike").length;
  if (strikes < 2) return 0;
  const strikeScore = Number(scoreCandidate(context, { ...backingStrike, preferredTarget: target }, siblingSpells, []).score);
  if (!Number.isFinite(strikeScore) || strikeScore <= 0) return 0;
  const agile = actionTraitSlugs(backingStrike).includes("agile");
  let value = 0;
  for (let index = 1; index < strikes; index += 1) {
    const tier = action.activityProfile.mapAppliesPerStrike === true ? MAP_PENALTY_BY_ATTACK_INDEX[Math.min(index, 2)] : null;
    const penalty = tier ? (agile ? tier.agile : tier.standard) : 0;
    value += Math.max(0, strikeScore - mapScoreCost({ score: strikeScore }, penalty));
  }
  return value;
}

// Many items only state it in prose: "<strong>Frequency</strong> once per day".
function frequencyFromText(html) {
  const match = String(html ?? "").replace(/<[^>]+>/g, " ").match(/\bfrequency\s+once per (day|hour|10 minutes|week)/i);
  return match ? match[1].toLowerCase() : "";
}

function systemValueOf(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
}

// A slotted spell or a 2-action attack spent on a creature a cheap hit would finish. The GM sees the
// real remaining HP; a player only sees that it is nearly down (under 15%).
function overkillPenalty(context, action, target) {
  const slotted = String(action?.source ?? "").startsWith("spell") && Number(action?.castRank ?? action?.rank) > 0
    && !actionTraitSlugs(action).includes("cantrip") && !actionTraitSlugs(action).includes("focus");
  const costly = slotted || Number(action?.actionCost) >= 2;
  if (!costly) return 0;
  const percent = hpPercent(target);
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const max = Number(target?.actor?.document?.system?.attributes?.hp?.max ?? target?.actor?.system?.attributes?.hp?.max);
  const average = Number(damageAverage(action)) || 0;
  if (Number.isFinite(max) && max > 0 && average > 0) {
    const remaining = percent * max;
    if (average < remaining * 2.5) return 0;
    return Math.min(40, Math.round((average - remaining) * 0.6) + (slotted ? 10 : 0));
  }
  return percent < 0.15 ? (slotted ? 25 : 12) : 0;
}

// The best spell a Spellstrike could channel: 1 or 2 actions, a single target, an attack roll or a
// save, and damage.
function spellstrikeChannelledSpell(action, siblingSpells) {
  const isSpellstrike = action?.activityProfile?.spellstrike === true || /(?:^|-)spellstrike$/.test(String(action?.slug ?? "").toLowerCase());
  if (!isSpellstrike || !Array.isArray(siblingSpells)) return null;
  return siblingSpells
    .filter((spell) => Number(spell?.actionCost) >= 1 && Number(spell?.actionCost) <= 2 && spell?.targetingProfile?.area !== true
      && ["damage", "save-damage"].includes(spell?.role) && spell?.available !== false)
    .map((spell) => ({ name: spell.name, average: Number(spell.damageProfile?.average ?? spell.averageDamage) || 0 }))
    .toSorted((left, right) => right.average - left.average)[0] ?? null;
}

// Quick Draw (and kin) draws the weapon as part of the Strike: it lands with the best stowed
// weapon, not the fist.
function drawnBackingStrike(action, allSiblingActions) {
  const drawsFirst = /(?:^|-)quick-draw$/.test(String(action?.slug ?? "").toLowerCase())
    || (action?.activityProfile?.includes ?? []).includes("draw");
  if (!drawsFirst || !Array.isArray(allSiblingActions)) return null;
  return allSiblingActions.filter((sibling) => sibling?.requiresDrawnWeaponId && !(Number(sibling?.range?.increment) > 0))
    .toSorted((left, right) => (Number(right.averageDamage) || 0) - (Number(left.averageDamage) || 0))[0] ?? null;
}

export function scoreCandidate(context, action, siblingSpells = [], allSiblingActions = []) {
  // A stowed weapon's follow-up Strike isn't an attack in hand: it never stands in for one here.
  const siblingActions = Array.isArray(allSiblingActions) ? allSiblingActions.filter((sibling) => !sibling?.requiresDrawnWeaponId) : allSiblingActions;
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const role = action.curated?.role ?? action.role;
  const preference = deterministicPreferenceAdjustment(context, action);
  const skillRequirement = skillAutoFillRequirement(profile, action);
  if (skillRequirement) {
    return {
      ...action,
      score: HARD_BLOCK_SCORE,
      suggestedTarget: null,
      reason: skillRequirement.reason,
      reasons: [skillRequirement.reason],
      preference,
    };
  }

  const target = bestTargetForAction(context, action, role);
  const distinctTargets = action.activityProfile?.requiresDistinctTargets
    ? distinctTargetsFor(context, action, role)
    : null;
  const backingStrike = (action.activityProfile?.requiresDistinctTargets || action.activityProfile?.requiresBackingStrike)
    ? action.activityProfile?.backingStrike ?? drawnBackingStrike(action, allSiblingActions) ?? backingStrikeForAction(action, siblingActions)
    // Frenzy-style counted Strikes: value them like the creature's best melee Strike.
    : action.activityProfile?.countedStrikes >= 2
      ? bestReadyStrikeFromOptions(siblingActions, (strike) => strike?.item?.system?.range == null && !(Number(strike?.range?.increment) > 0))
      : null;
  const backingStrikes = action.activityProfile?.requiresDualBackingStrike
    ? action.activityProfile?.backingStrikes ?? backingStrikesForAction(action, siblingActions)
    : null;
  // A Grab that follows a Strike listing it grabs automatically (no check, no MAP); only a grab that
  // really is an Athletics check is backed by Grapple.
  const backingManeuver = action.activityProfile?.npcFamily === "grab-rider" && action.activityProfile?.noAttackRoll !== true
    ? GENERIC_ACTIONS.find((generic) => generic.slug === "grapple") ?? null
    : null;
  const suggestedTarget = suggestedTargetFor(context, action, role, target);
  const bestTargetReasons = targetRankingReasons(context, action, role, target);
  const skillDcSlug = actionSkillDcSlug(action);
  const skillCheck = canUseTargetSave(context, target, skillDcSlug) ? skillCheckScore(profile, target, action) : null;
  const ownSkillReliability = ownSkillReliabilityScore(profile, action, context);
  const spellAdjustment = spellTacticalAdjustment(action, role, context);
  const resourceAdjustment = resourceHorizonAdjustment(context, action);
  // Planner re-scoring compares a candidate against itself on a projected board; native odds can't
  // see projected conditions, so both sides of that comparison use the heuristic hit chance.
  const preflightAllowed = context?.skipNativePreflight !== true && (context?.isGM === true
    || (typeof context?.isGM !== "boolean" && globalThis.game?.user?.isGM === true)
    || settingOrDefault(SETTINGS.nativeRollContextPreflight, false));
  const rawNativePreflight = preflightAllowed
    ? nativeRollContextPreflight(context, action, { target })
    : { available: false, status: "disabled", scoreApplied: false };
  const nativeOutcome = nativeOutcomeRanking(action, rawNativePreflight);
  const nativePreflight = nativeOutcome.preflight;

  const blocked = blockedCandidateResult(context, action, {
    role,
    target,
    profile,
    siblingSpells,
    backingStrikes,
  });
  if (blocked) return { ...blocked, preference };

  let {
    score,
    reasons,
    areaHitCount,
    areaPlacementCenter,
    areaPlacementAimPoint,
    areaPlacementOptions,
    minionPlan,
    conditionalBonuses,
    outOfReach,
  } = scoreRoleTactics(context, action, {
    role,
    profile,
    target,
    criticalChance: rawNativePreflight?.odds?.criticalSuccess,
    backingStrike,
    extraStrikeValue: extraStrikeValue(context, action, backingStrike, target, siblingSpells),
  });

  const targetDistance = Number(target?.distance);
  const rangedStrikeLike = ((action.source === "strike" && isRangedStrike(action))
    || (action.activityProfile?.multiStrike === true && String(action.activityProfile?.backingStrikeFilter ?? "").startsWith("ranged")))
    && action.activityProfile?.retreatBeforeStrike !== true;
  if (rangedStrikeLike && target
    && Number.isFinite(targetDistance) && targetDistance <= 5
    && siblingActions.some((sibling) => sibling !== action && sibling.source === "strike"
      && sibling.available !== false && !isRangedStrike(sibling)
      && targetDistance <= maxRange(sibling))) {
    score -= 14;
    reasons.push(t("ScoreReason.RangedStrikeAdjacentMeleeReady", "A ready melee Strike can reach this adjacent target."));
  }

  // Nothing can attack from here (every Strike needs a move first): closing the distance is the
  // turn's real work, not filler -- worth more than Recall Knowledge or an idle Raise a Shield.
  const plainStride = action.source === "generic" && /(?:^|-)stride$/.test(String(action.slug ?? action.id ?? ""));
  if (plainStride && target && Number.isFinite(targetDistance) && targetDistance > 5) {
    const attackNow = siblingActions.some((sibling) => sibling !== action && sibling?.available !== false && !sibling?.needsApproach
      && (sibling.source === "strike" || sibling.attackTrait === true)
      && Number(sibling?.activityProfile?.strideCount ?? 0) === 0
      && targetDistance <= maxRange(sibling));
    if (!attackNow) {
      score += 30;
      reasons.push(t("ScoreReason.CloseTheDistance", "No attack reaches from here; close the distance."));
    }
  }

  // Once a day (or an hour, or 10 minutes): worth saving for when it matters, especially when it
  // isn't damage or healing (a +10 ft Speed bracelet is not this turn's best use of an action).
  const frequencyPer = String(systemValueOf(action?.item?.system?.frequency?.per ?? action?.frequency?.per) ?? "").toLowerCase()
    || frequencyFromText(action?.item?.system?.description?.value ?? action?.description);
  if (/^(?:day|week|month|pt1h|pt10m|pt24h|hour|10 minutes)$/.test(frequencyPer)) {
    const impactful = ["damage", "save-damage", "area-damage", "multiattack", "healing"].includes(role);
    score -= impactful ? 10 : 30;
    reasons.push(t("ScoreReason.LimitedUse", "Limited use ({per}); worth saving.", { per: frequencyPer }));
  }

  const strikeBonus = npcStrikeAttackBonus(action);
  if (strikeBonus !== null && target) {
    const bestReadyBonus = Math.max(strikeBonus, ...siblingActions
      .filter((sibling) => sibling.available !== false && Number(target.distance) <= maxRange(sibling))
      .map(npcStrikeAttackBonus)
      .filter((bonus) => bonus !== null));
    const difference = Math.min(10, bestReadyBonus - strikeBonus);
    if (difference > 0) {
      score -= difference * 3;
      reasons.push(t("ScoreReason.NpcStrikeAttackBonusGap", "Strike attack bonus trails another ready Strike by {difference}.", { difference }));
    }
  }

  const retreatBonus = action.activityProfile?.retreatBeforeStrike === true
    ? npcStrikeItemBonus(action)
    : null;
  if (retreatBonus !== null && target && hpPercent(profile) >= 0.5) {
    const readyMeleeBonuses = siblingActions
      .filter((sibling) => sibling.available !== false && sibling.source === "strike"
        && !isRangedStrike(sibling) && Number(target.distance) <= maxRange(sibling))
      .map(npcStrikeAttackBonus)
      .filter((bonus) => bonus !== null);
    if (readyMeleeBonuses.length && Math.max(...readyMeleeBonuses) >= retreatBonus + 2) {
      score -= 18;
      reasons.push(t("ScoreReason.RetreatSacrificesStrongerMelee", "Retreating for a ranged Strike gives up a stronger ready melee Strike."));
    }
  }

  // A melee brute stepping back to throw javelins at the creature it just left spends an action to
  // swap a hit for a weaker one (and usually provokes). Archers, artillery, skirmishers and cautious or cowardly
  // creatures are meant to back off; everyone else keeps hitting.
  if (action.activityProfile?.retreatBeforeStrike === true && target) {
    const tactic = resolveTacticPersonality(context);
    const role = tactic?.effectiveRole ?? tactic?.role;
    const temperament = tactic?.effectiveTemperament ?? tactic?.temperament;
    const backsOff = ["ranged-striker", "artillery", "skirmisher"].includes(role) || ["cautious", "coward"].includes(temperament);
    const rangedAverage = Number(action.averageDamage ?? action.strike?.averageDamage ?? action.activityProfile?.averageDamage) || 0;
    const bestMelee = Math.max(0, ...siblingActions
      .filter((sibling) => sibling.available !== false && sibling.source === "strike" && !isRangedStrike(sibling)
        && Number(target.distance) <= maxRange(sibling))
      .map((sibling) => Number(sibling.averageDamage) || 0));
    if (!backsOff && bestMelee > 0 && bestMelee >= rangedAverage) {
      score -= 60;
      reasons.push(t("ScoreReason.KeepsMeleePressure", "Its melee attack hits at least as hard; backing off to throw spends an action for nothing."));
    }
  }

  // Class, personality, spell and resource terms value the action for this actor, not the hit;
  // the hidden-target flat check must not discount them.
  let actorAdjustment = 0;
  const classAdjustment = classTacticAdjustment(profile, action, {
    context,
    target,
    role,
    traits: actionTraitSlugs(action),
    isSpell: isSpellAction(action),
    isMeleeStrike: isMeleeStrikeFallback(action),
    isRangedStrike: isRangedStrike(action),
    includesStrike: action.activityProfile?.includesStrike === true,
    reloadBeforeStrike: action.activityProfile?.reloadBeforeStrike === true || Number(action.reloadCost) > 0,
    consumable: action.item?.type === "consumable" || action.type === "consumable",
    isImpulse: actionTraitSlugs(action).includes("impulse")
      || action.activityProfile?.impulse === true
      || action.activityProfile?.overflow === true,
  });
  if (classAdjustment.scoreDelta) {
    score += classAdjustment.scoreDelta;
    actorAdjustment += classAdjustment.scoreDelta;
    reasons.push(...classAdjustment.reasons);
  }

  // A commander tactic is worth what its squad can do with it (PF2e Commanderer's state).
  const commanderAdjustment = commanderTacticAdjustment(context, action);
  if (commanderAdjustment) {
    score += commanderAdjustment.scoreDelta;
    actorAdjustment += commanderAdjustment.scoreDelta;
    reasons.push(...commanderAdjustment.reasons);
  }

  // Spellstrike delivers a spell along with the Strike: it is worth the spell it would channel too.
  const channelled = spellstrikeChannelledSpell(action, siblingSpells);
  if (channelled) {
    const bonus = Math.min(110, 40 + Math.round(4 * channelled.average));
    score += bonus;
    actorAdjustment += bonus;
    reasons.push(t("ScoreReason.SpellstrikeChannels", "Spellstrike channels {spell} with the Strike.", { spell: channelled.name }));
  }

  const npcAdjustment = npcTacticAdjustment(context, action, { target, role, areaHitCount });
  if (npcAdjustment.scoreDelta) {
    score += npcAdjustment.scoreDelta;
    actorAdjustment += npcAdjustment.scoreDelta;
    reasons.push(...npcAdjustment.reasons);
  }

  const tacticAdjustment = tacticPersonalityAdjustment(context, action, { target, role, areaHitCount, siblings: siblingActions });
  if (tacticAdjustment.scoreDelta) {
    score += tacticAdjustment.scoreDelta;
    actorAdjustment += tacticAdjustment.scoreDelta;
    reasons.push(...tacticAdjustment.reasons);
  }

  if (spellAdjustment.scoreDelta) {
    score += spellAdjustment.scoreDelta;
    actorAdjustment += spellAdjustment.scoreDelta;
    reasons.push(...spellAdjustment.reasons);
  }

  if (resourceAdjustment.scoreDelta) {
    score += resourceAdjustment.scoreDelta;
    actorAdjustment += resourceAdjustment.scoreDelta;
    reasons.push(...resourceAdjustment.reasons);
  }

  // A multi-action offensive action commits several actions to one effect (a
  // 2-action nuke, or a Stride -> Stride -> Strike that closes a gap and attacks).
  // The planner sums per-step scores, so without this it is out-summed by the cheap
  // 1-action fillers it displaces and never surfaces. Credit each extra action it
  // costs at a representative realized action value (~55) so it competes as the
  // whole-turn investment it is.
  const multiActionOffensive = String(action.source).startsWith("spell")
    ? ["damage", "area-damage", "save-damage", "control", "debuff"].includes(role)
    : (["mobility-attack", "multiattack"].includes(role)
      || (role === "damage" && action.activityProfile?.includesStrike === true)) && !includesStand(action);
  if (multiActionOffensive && Number(action.actionCost) >= 2 && score > baseScore(action)) {
    const extraActions = Math.min(2, Number(action.actionCost) - 1);
    const extraActionValue = role === "area-damage" && areaHitCount === 1 ? 20 : 55;
    score += extraActions * extraActionValue;
    reasons.push(t("ScoreReason.CommitsActions", "Commits {count} actions to one effect.", { count: action.actionCost }));
  }

  // The native preflight and skillCheckScore both price the same degree-of-success odds against the
  // same DC; count them once (the native one is more exact), so a GM-run plan and a player-run plan
  // for the same PC weigh skill actions alike.
  if (skillCheck && !nativeOutcome.scoreDelta) {
    score += skillCheck.scoreDelta;
    reasons.push(...skillCheck.reasons);
  }

  if (ownSkillReliability) {
    score += ownSkillReliability.scoreDelta;
    reasons.push(...ownSkillReliability.reasons);
  }

  if (target && isAttackLikeAction(action, role) && !isAreaAction(action, role)) score += focusFireBonus(context, target);

  const overkill = target && !isAreaAction(action, role) ? overkillPenalty(context, action, target) : 0;
  if (overkill > 0) {
    score -= overkill;
    reasons.push(t("ScoreReason.Overkill", "{target} is nearly down: a cheaper attack finishes them.", { target: target.name }));
  }

  if (target && isAttackLikeAction(action, role) && detectionState(target) === "hidden") {
    const targetDependentGain = Math.max(0, score - actorAdjustment - baseScore(action));
    score -= targetDependentGain * HIDDEN_TARGET_FLAT_CHECK_DISCOUNT;
    reasons.push(t("ScoreReason.HiddenTargetFlatCheck", "{target} is hidden; a flat check is needed before this can affect them.", { target: target.name }));
  }

  if (role === "healing" && healingIsIdle(context, profile, action)) {
    score = Math.min(score, -5);
    reasons.unshift(t("ScoreReason.NobodyNeedsHealing", "Nobody needs healing yet."));
  }

  if (nativeOutcome.scoreDelta) {
    score += nativeOutcome.scoreDelta;
    reasons.push(nativePreflight.rankingReason);
  }

  if (preference.scoreDelta) {
    score += preference.scoreDelta;
    reasons.push(preference.reason);
  }

  if (nativePreflight.available && nativePreflight.reason) reasons.push(nativePreflight.reason);

  // A move-and-Strike or multi-Strike that reaches nobody can't be used from here: no "commits
  // actions" credit, no role bonus can lift it back into a plan.
  // An area attack whose best placement catches no (non-immune) enemy does nothing from here; the
  // planner may still Stride first and re-aim it (see buildCandidates' approach pool).
  // (Only on a real board: without token positions a placement can't be measured.)
  if (areaHitCount === 0 && role === "area-damage" && context?.token?.center) score = HARD_BLOCK_SCORE;
  if (outOfReach) {
    score = HARD_BLOCK_SCORE;
    reasons.unshift(t("ScoreReason.OutOfReachThisTurn", "{name} can't reach an enemy from here.", { name: action.name }));
  }

  return sanitizeScoredRecommendation({
    ...action,
    ...(backingManeuver ? { executable: backingManeuver.executable, slug: backingManeuver.slug, skill: backingManeuver.skill } : {}),
    score,
    skillCheck,
    preference,
    nativePreflight,
    suggestedTarget,
    bestTargetReasons,
    reason: reasons[0] ?? defaultReason(action),
    reasons,
    activityProfile: {
      ...action.activityProfile,
      areaPlacementCenter,
      areaPlacementAimPoint,
      areaPlacementOptions,
      // How many enemies the best placement catches (null when not an area action).
      areaHitCount: Number.isFinite(areaHitCount) ? areaHitCount : null,
      ...(distinctTargets ? { distinctTargets } : {}),
      ...(backingStrike ? { backingStrike } : {}),
      ...(backingStrikes ? { backingStrikes } : {}),
      ...(backingManeuver ? { backingManeuver } : {}),
      ...(minionPlan ? { minionPlan } : {}),
      conditionalBonuses,
    },
  }, {
    isGM: canUseTargetDefenses(context),
    fallbackReason: defaultReason(action),
    playerIntelCategories: PLAYER_INTEL_CATEGORIES.filter((category) => canUseIntelCategory(context, target, category)),
  });
}
