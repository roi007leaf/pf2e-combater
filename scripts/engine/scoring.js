import { classTacticAdjustment } from "../rules/class-tactics.js";
import { canUseIntelCategory } from "../rules/intel-ledger.js";
import { npcTacticAdjustment } from "../rules/npc-tactics.js";
import { tacticPersonalityAdjustment } from "../rules/tactic-personality.js";
import { backingStrikeForAction, backingStrikesForAction } from "./backing-strike.js";
import {
  actionTraitSlugs,
  canUseTargetDefenses,
  canUseTargetSave,
  isAttackLikeAction,
  isMeleeStrikeFallback,
  isRangedStrike,
  isSpellAction,
} from "./scoring/facts.js";
import {
  actionSkillDcSlug,
  ownSkillReliabilityScore,
  skillCheckScore,
  trainedSkillRequirement,
} from "./scoring/skills.js";
import { spellTacticalAdjustment } from "./scoring/spells.js";
import { nativeRollContextPreflight } from "./scoring/roll-preflight.js";
import { blockedCandidateResult } from "./scoring/gates.js";
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

// PF2e core rule: affecting a hidden creature (any attack roll or save-requiring effect) needs a
// DC 11 flat check first, independent of the attack roll or save itself. A flat check against DC
// 11 succeeds on a roll of 11 or higher — exactly half of a d20's outcomes.
const HIDDEN_TARGET_FLAT_CHECK_DISCOUNT = 0.5;
const PLAYER_INTEL_CATEGORIES = ["traits", "saves", "perception", "weaknesses", "resistances", "immunities"];

export function scoreCandidate(context, action, siblingSpells = [], siblingActions = []) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const role = action.curated?.role ?? action.role;
  const preference = deterministicPreferenceAdjustment(context, action);
  const requiredTraining = trainedSkillRequirement(profile, action);
  if (requiredTraining) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: requiredTraining.reason,
      reasons: [requiredTraining.reason],
      preference,
    };
  }

  const target = bestTargetForAction(context, action, role);
  const distinctTargets = action.activityProfile?.requiresDistinctTargets
    ? distinctTargetsFor(context, action, role)
    : null;
  const backingStrike = (action.activityProfile?.requiresDistinctTargets || action.activityProfile?.requiresBackingStrike)
    ? action.activityProfile?.backingStrike ?? backingStrikeForAction(action, siblingActions)
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
  const preflightAllowed = context?.isGM === true
    || (typeof context?.isGM !== "boolean" && globalThis.game?.user?.isGM === true)
    || settingOrDefault(SETTINGS.nativeRollContextPreflight, false);
  const nativePreflight = preflightAllowed
    ? nativeRollContextPreflight(context, action, { target })
    : { available: false, status: "disabled", scoreApplied: false };

  const blocked = blockedCandidateResult(context, action, { role, target, profile, siblingSpells });
  if (blocked) return { ...blocked, preference };

  let {
    score,
    reasons,
    areaHitCount,
    areaPlacementCenter,
    areaPlacementAimPoint,
    minionPlan,
  } = scoreRoleTactics(context, action, { role, profile, target });

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
    reasons.push(...classAdjustment.reasons);
  }

  const npcAdjustment = npcTacticAdjustment(context, action, { target, role, areaHitCount });
  if (npcAdjustment.scoreDelta) {
    score += npcAdjustment.scoreDelta;
    reasons.push(...npcAdjustment.reasons);
  }

  const tacticAdjustment = tacticPersonalityAdjustment(context, action, { target, role, areaHitCount });
  if (tacticAdjustment.scoreDelta) {
    score += tacticAdjustment.scoreDelta;
    reasons.push(...tacticAdjustment.reasons);
  }

  if (spellAdjustment.scoreDelta) {
    score += spellAdjustment.scoreDelta;
    reasons.push(...spellAdjustment.reasons);
  }

  // A multi-action offensive action commits several actions to one effect (a
  // 2-action nuke, or a Stride -> Stride -> Strike that closes a gap and attacks).
  // The planner sums per-step scores, so without this it is out-summed by the cheap
  // 1-action fillers it displaces and never surfaces. Credit each extra action it
  // costs at a representative realized action value (~55) so it competes as the
  // whole-turn investment it is.
  const multiActionOffensive = String(action.source).startsWith("spell")
    ? ["damage", "area-damage", "save-damage", "control", "debuff"].includes(role)
    : ["mobility-attack", "multiattack"].includes(role) && !includesStand(action);
  if (multiActionOffensive && Number(action.actionCost) >= 2 && score > baseScore(action)) {
    const extraActions = Math.min(2, Number(action.actionCost) - 1);
    const extraActionValue = role === "area-damage" && areaHitCount === 1 ? 20 : 55;
    score += extraActions * extraActionValue;
    reasons.push(t("ScoreReason.CommitsActions", "Commits {count} actions to one effect.", { count: action.actionCost }));
  }

  if (skillCheck) {
    score += skillCheck.scoreDelta;
    reasons.push(...skillCheck.reasons);
  }

  if (ownSkillReliability) {
    score += ownSkillReliability.scoreDelta;
    reasons.push(...ownSkillReliability.reasons);
  }

  if (target && isAttackLikeAction(action, role) && detectionState(target) === "hidden") {
    const targetDependentGain = Math.max(0, score - baseScore(action));
    score -= targetDependentGain * HIDDEN_TARGET_FLAT_CHECK_DISCOUNT;
    reasons.push(t("ScoreReason.HiddenTargetFlatCheck", "{target} is hidden; a flat check is needed before this can affect them.", { target: target.name }));
  }

  if (preference.scoreDelta) {
    score += preference.scoreDelta;
    reasons.push(preference.reason);
  }

  if (nativePreflight.available && nativePreflight.reason) reasons.push(nativePreflight.reason);

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
      ...(distinctTargets ? { distinctTargets } : {}),
      ...(backingStrike ? { backingStrike } : {}),
      ...(backingStrikes ? { backingStrikes } : {}),
      ...(backingManeuver ? { backingManeuver } : {}),
      ...(minionPlan ? { minionPlan } : {}),
    },
  }, {
    isGM: canUseTargetDefenses(context),
    fallbackReason: defaultReason(action),
    playerIntelCategories: PLAYER_INTEL_CATEGORIES.filter((category) => canUseIntelCategory(context, target, category)),
  });
}
