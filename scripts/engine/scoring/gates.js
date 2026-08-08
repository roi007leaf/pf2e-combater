import { hasDemoralizeImmunity } from "../../rules/demoralize-immunity.js";
import { livingMarkedTarget, readCombatState, targetHasMarkState } from "../../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../../rules/exploit-vulnerability.js";
import { resolveTacticPersonality } from "../../rules/tactic-personality.js";
import { t } from "../../i18n.js";
import { slugify as slugText } from "../action/text.js";
import {
  contextActorDocument,
  hasCondition,
  hasEffectSlug,
  hpPercent,
  inRange,
  isAreaAction,
  isAttackLikeAction,
  requiresTargetableEnemy,
} from "./facts.js";
import { isRangeBuffSetup, rangeBuffIsNeeded } from "./spells.js";
import { attackableEnemies, isExtractElementAction } from "./targets.js";
import { inActionReach } from "./tactic-helpers.js";
import { contextAllies } from "../target-pool.js";
import { HARD_BLOCK_SCORE } from "./weights.js";

function blockedAction(action, reason, patch = {}) {
  return {
    ...action,
    score: HARD_BLOCK_SCORE,
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

function isStanceAction(action) {
  const slug = String(action?.slug ?? action?.tacticSlug ?? "").toLowerCase();
  const name = String(action?.name ?? "").toLowerCase();
  const traits = Array.isArray(action?.traits) ? action.traits.map((trait) => String(trait).toLowerCase()) : [];
  return action?.activityProfile?.stance === true
    || traits.includes("stance")
    || slug.endsWith("-stance")
    || name.includes(" stance");
}

function activeStanceCount(context, profile) {
  const profileStances = profile?.combatState?.activeStances;
  if (Array.isArray(profileStances) && profileStances.length) return profileStances.length;

  const actorState = readCombatState(contextActorDocument(context));
  if (Array.isArray(actorState?.activeStances) && actorState.activeStances.length) return actorState.activeStances.length;

  return hasCondition(profile, "stance") || hasEffectSlug(profile, "stance") ? 1 : 0;
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

function entityNeedsHealing(entity) {
  return hpPercent(entity) < 0.5
    || hasCondition(entity, "dying")
    || hasCondition(entity, "persistent-bleed");
}

function hasNeededHealingRecipient(context, profile, action, { ignoreRange = false } = {}) {
  if (hpPercent(profile) < 0.5) return true;
  return contextAllies(context).some((ally) =>
    entityNeedsHealing(ally)
    && (ignoreRange || action?.targetingProfile?.reach !== true || inActionReach(profile, action, ally)),
  );
}

function actorType(context) {
  return String(
    context?.profile?.actorType
      ?? context?.actor?.profile?.actorType
      ?? context?.actor?.document?.type
      ?? context?.actor?.type
      ?? "",
  ).toLowerCase();
}

function hasExplicitPlayerHealerPreference(context) {
  const type = actorType(context);
  if (!type || type === "npc") return false;
  return resolveTacticPersonality(context)?.role === "healer";
}

export function blockedCandidateResult(context, action, {
  role,
  target,
  profile,
  siblingSpells,
  backingStrikes,
} = {}) {
  if (
    action.activityProfile?.requiresDualBackingStrike === true
    && (!Array.isArray(backingStrikes) || backingStrikes.length < 2)
  ) {
    return blockedAction(action, t("ScoreReason.RequiresTwoHeldMeleeWeapons", "Requires two held melee weapons."));
  }

  const handsFree = Number(profile?.handsFree);
  if (action.activityProfile?.requiresFreeHand === true && Number.isFinite(handsFree) && handsFree < 1) {
    return blockedAction(action, t("Avail.NoFreeHand", "No free hand available."));
  }

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

  if (isStanceAction(action) && activeStanceCount(context, profile) > 0) {
    return blockedAction(action, t("ScoreReason.StanceAlreadyActive", "A stance is already active."));
  }

  if (role === "healing" && !hasNeededHealingRecipient(context, profile, action) && !hasExplicitPlayerHealerPreference(context)) {
    const hasOutOfReachRecipient = action?.targetingProfile?.reach === true
      && hasNeededHealingRecipient(context, profile, action, { ignoreRange: true });
    return blockedAction(action, hasOutOfReachRecipient
      ? t("ScoreReason.NoBadlyInjuredHealingTargetInReach", "No badly injured healing target is in reach.")
      : t("ScoreReason.NoAllyIsBadly", "No ally is badly injured."));
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
