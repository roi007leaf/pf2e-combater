import { classTacticAdjustment } from "../rules/class-tactics.js";
import { canUseIntelCategory } from "../rules/intel-ledger.js";
import { npcTacticAdjustment } from "../rules/npc-tactics.js";
import { tacticPersonalityAdjustment } from "../rules/tactic-personality.js";
import { resourceHorizonAdjustment } from "../rules/resource-horizon.js";
import { backingStrikeForAction, backingStrikesForAction, bestReadyStrikeFromOptions } from "./backing-strike.js";
import {
  actionTraitSlugs,
  canUseTargetDefenses,
  canUseTargetSave,
  isAttackLikeAction,
  isMeleeStrikeFallback,
  isRangedStrike,
  isSpellAction,
  hpPercent,
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

export function scoreCandidate(context, action, siblingSpells = [], siblingActions = []) {
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
    ? action.activityProfile?.backingStrike ?? backingStrikeForAction(action, siblingActions)
    // Frenzy-style counted Strikes: value them like the creature's best melee Strike.
    : action.activityProfile?.countedStrikes >= 2
      ? bestReadyStrikeFromOptions(siblingActions, (strike) => strike?.item?.system?.range == null && !(Number(strike?.range?.increment) > 0))
      : null;
  const backingStrikes = action.activityProfile?.requiresDualBackingStrike
    ? action.activityProfile?.backingStrikes ?? backingStrikesForAction(action, siblingActions)
    : null;
  const backingManeuver = action.activityProfile?.npcFamily === "grab-rider"
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
