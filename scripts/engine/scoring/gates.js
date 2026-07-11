import { hasDemoralizeImmunity } from "../../rules/demoralize-immunity.js";
import { livingMarkedTarget, readCombatState, targetHasMarkState } from "../../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../../rules/exploit-vulnerability.js";
import { t } from "../../i18n.js";
import { slugify as slugText } from "../action/text.js";
import {
  contextActorDocument,
  hasCondition,
  hasEffectSlug,
  inRange,
  isAreaAction,
  isAttackLikeAction,
  requiresTargetableEnemy,
} from "./facts.js";
import { isRangeBuffSetup, rangeBuffIsNeeded } from "./spells.js";
import { attackableEnemies, isExtractElementAction } from "./targets.js";

function blockedAction(action, reason, patch = {}) {
  return {
    ...action,
    score: -999,
    suggestedTarget: null,
    reason,
    reasons: [reason],
    ...patch,
  };
}

function targetMarkLabel(mark) {
  return slugText(mark)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isChannelElementsAction(action) {
  return [
    action?.slug,
    action?.tacticSlug,
    action?.name,
  ].map(slugText).includes("channel-elements");
}

function isHuntPreyAction(action) {
  return [action?.slug, action?.tacticSlug, action?.name].map(slugText).includes("hunt-prey");
}

function kineticAuraActive(context, profile) {
  const states = [
    profile?.combatState,
    context?.combatState,
    context?.actor?.profile?.combatState,
  ];
  if (states.some((state) => state?.kineticistAuraActive === true || state?.channelElementsActive === true)) {
    return true;
  }

  const actorState = readCombatState(contextActorDocument(context));
  if (actorState.kineticistAuraActive === true || actorState.channelElementsActive === true) return true;

  return hasCondition(profile, "kinetic-aura")
    || hasCondition(profile, "channel-elements")
    || hasEffectSlug(profile, "kinetic-aura")
    || hasEffectSlug(profile, "channel-elements");
}

export function blockedCandidateResult(context, action, { role, target, profile, siblingSpells } = {}) {
  if (action.slug === "demoralize" && !target && attackableEnemies(context).some(hasDemoralizeImmunity)) {
    return blockedAction(action, t("ScoreReason.TargetIsTemporarilyImmune", "Target is temporarily immune to Demoralize."));
  }

  if (isExtractElementAction(action) && !target) {
    return blockedAction(action, t("ScoreReason.NoValidElementalTarget", "No valid elemental target."));
  }

  if (isExploitVulnerabilityAction(action) && !target && attackableEnemies(context).some(hasExploitVulnerabilityMark)) {
    return blockedAction(action, t("ScoreReason.TargetIsAlreadyExploited", "Target is already exploited."));
  }

  if (isHuntPreyAction(action)) {
    const state = profile?.combatState ?? readCombatState(contextActorDocument(context));
    const markedUuids = Array.isArray(state?.huntedPreyTokenUuids) ? state.huntedPreyTokenUuids : [];
    const livingPrey = livingMarkedTarget(context, markedUuids, "hunted-prey");
    if (!target && (livingPrey || (state?.huntedPreyActive === true && markedUuids.length === 0))) {
      return blockedAction(action, t(
        "ScoreReason.CurrentHuntedPreyOnlyTarget",
        "Current hunted prey is already designated; no other valid prey target.",
      ));
    }
  }

  const targetMark = action.activityProfile?.targetMark;
  if (targetMark && !target && attackableEnemies(context).some((enemy) => targetHasMarkState(enemy, targetMark))) {
    const label = targetMarkLabel(targetMark);
    return blockedAction(action, t("ScoreReason.TargetAlreadyHas", "Target already has {label}.", { label }));
  }

  if (isChannelElementsAction(action) && kineticAuraActive(context, profile)) {
    return blockedAction(action, t("ScoreReason.KineticAuraAlreadyActive", "Kinetic aura already active; Channel Elements is redundant."));
  }

  if (isRangeBuffSetup(action) && !rangeBuffIsNeeded(context, siblingSpells)) {
    return blockedAction(action, t("ScoreReason.NoSpellNeedsExtraRange", "No castable spell currently lacks a target in range."));
  }

  if (action.source === "strike" && !target) {
    return blockedAction(action, t("ScoreReason.NoValidEnemyTarget", "No valid enemy target."));
  }

  if (isAttackLikeAction(action, role) && !isAreaAction(action, role) && !target) {
    return blockedAction(action, t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target."));
  }

  if (requiresTargetableEnemy(action, role) && !target) {
    return blockedAction(action, t("ScoreReason.NoTargetableEnemyTarget", "No targetable enemy target."));
  }

  if (role === "area-damage" && !attackableEnemies(context).length) {
    return blockedAction(
      action,
      t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target."),
      { activityProfile: { ...action.activityProfile, areaPlacementCenter: null, areaPlacementAimPoint: null } },
    );
  }

  if (["step", "stride"].includes(action.slug) && action.source === "generic" && !target) {
    return blockedAction(action, t("ScoreReason.NoValidEnemyTarget", "No valid enemy target."));
  }

  if (action.source === "strike" && target && !inRange(action, target)) {
    return blockedAction(action, t("ScoreReason.TargetIsOutOf", "Target is out of range."));
  }

  return null;
}
