import { hasDemoralizeImmunity } from "../../rules/demoralize-immunity.js";
import { buffAlreadyCoversEveryone } from "./buffs.js";
import { livingMarkedTarget, readCombatState, targetHasMarkState } from "../../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../../rules/exploit-vulnerability.js";
import { resolveTacticPersonality } from "../../rules/tactic-personality.js";
import { t } from "../../i18n.js";
import { contextEnemies, detectionState } from "../target-pool.js";
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
import { isSummonBuff, summonedRecipients } from "../../rules/summoned-creatures.js";

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

// A Healer heals sooner (below 75%) than everyone else (below 50%), but never a healthy party.
// Someone already healed earlier in this plan doesn't count again.
function entityNeedsHealing(entity, threshold = 0.5) {
  if (hasCondition(entity, "healed")) return false;
  return hpPercent(entity) < threshold
    || hasCondition(entity, "dying")
    || hasCondition(entity, "persistent-bleed");
}

// Medicine heals (Battle Medicine, Administer First Aid, Treat Wounds) need the patient adjacent.
export function healingRangeKnown(action) {
  return action?.targetingProfile?.reach === true || Number(action?.targetingProfile?.maxRange) > 0
    || String(action?.skill ?? action?.statistic ?? "").toLowerCase() === "medicine";
}

// Heal Animal only works on animals.
// At 0 HP only a creature on the dying track (a PC, or anything currently dying) is still alive;
// an NPC at 0 is dead, and healing can't bring it back.
function deadRecipient(entity) {
  if (!entity || Number(entity?.hpPercent) > 0 || !Number.isFinite(Number(entity?.hpPercent))) return false;
  if (hasCondition(entity, "dying")) return false;
  const type = String(entity?.actor?.type ?? entity?.actorType ?? entity?.type ?? "").toLowerCase();
  return type === "npc" || hasCondition(entity, "dead") || entity?.defeated === true;
}

// Airborne now (elevation above the ground), or a fly Speed the viewer can see on the actor.
function canFly(entity) {
  const elevation = Number(entity?.elevation ?? entity?.token?.elevation ?? entity?.token?.document?.elevation);
  if (Number.isFinite(elevation) && elevation > 0) return true;
  const actor = entity?.actor?.document ?? entity?.actor;
  const speeds = actor?.system?.attributes?.speed?.otherSpeeds;
  return Array.isArray(speeds) && speeds.some((speed) => String(speed?.type ?? "").toLowerCase() === "fly");
}

// Boost Eidolon, Lifelink Surge, Evolution Surge...: only the summoner's eidolon can take them.
const EIDOLON_ONLY_SPELLS = new Set(["boost-eidolon", "lifelink-surge", "evolution-surge", "reinforce-eidolon", "eidolons-wrath"]);
export function isEidolonOnlySpell(action) {
  return EIDOLON_ONLY_SPELLS.has(String(action?.slug ?? "").toLowerCase());
}

export function healingRecipientAllowed(action, entity) {
  if (deadRecipient(entity)) return false;
  // Stabilize only does anything for a dying creature.
  if (/(?:^|-)stabilize$/.test(String(action?.slug ?? action?.id ?? "").toLowerCase())) return hasCondition(entity, "dying");
  if (!/heal-animal/.test(String(action?.slug ?? action?.id ?? "").toLowerCase())) return true;
  const traits = (Array.isArray(entity?.traits) ? entity.traits : []).map((trait) => String(trait?.slug ?? trait).toLowerCase());
  return traits.includes("animal");
}

function hasNeededHealingRecipient(context, profile, action, { ignoreRange = false, threshold = 0.5 } = {}) {
  if (hpPercent(profile) < threshold && !hasCondition(profile, "healed") && healingRecipientAllowed(action, profile)) return true;
  return contextAllies(context).some((ally) =>
    healingRecipientAllowed(action, ally)
    && entityNeedsHealing(ally, threshold)
    && (ignoreRange || !healingRangeKnown(action) || !Number.isFinite(Number(ally?.distance)) || inActionReach(profile, action, ally)),
  );
}

// For an explicit Healer: nobody below 75% (or dying/bleeding) in range, so this heal would be wasted.
export function healingIsIdle(context, profile, action) {
  return hasExplicitPlayerHealerPreference(context)
    && !hasNeededHealingRecipient(context, profile, action, { ignoreRange: true, threshold: 0.75 });
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
  // Both hands full (a crossbow, or rapier and dagger): a fist means letting go, and re-gripping a
  // two-handed weapon costs an action. Use the weapons in hand instead.
  const item = action?.item;
  if ((item?.slug === "basic-unarmed" || item?.id === "xxPF2ExUNARMEDxx") && Number(profile?.handsFree) === 0
    && String(profile?.actorType ?? "").toLowerCase() !== "npc") {
    return blockedAction(action, t("ScoreReason.HandsFull", "Both hands are full."));
  }
  if ((role === "buff" || action?.activityProfile?.spellBuff === true) && !isSummonBuff(action)
    && action?.activityProfile?.spellshape !== true && buffAlreadyCoversEveryone(context, action)) {
    return blockedAction(action, t("ScoreReason.BuffAlreadyActive", "Everyone in reach already has {name}.", { name: action.name }));
  }
  if (isSummonBuff(action) && !summonedRecipients(context, action).length) {
    return blockedAction(action, t("ScoreReason.NoSummonedRecipient", "No living creature you summoned is in range."));
  }
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

  // See the Unseen, See Invisibility, Truesight: only worth casting when an enemy is actually hidden
  // from you (invisible, hidden or undetected).
  if (/(?:^|-)(?:see-the-unseen|see-invisibility|truesight|true-seeing)$/.test(slugText(action.slug ?? action.name))
    && !contextEnemies(context).some((enemy) => ["hidden", "undetected", "unnoticed"].includes(detectionState(enemy)) || hasCondition(enemy, "invisible"))) {
    return blockedAction(action, t("ScoreReason.NothingHiddenToReveal", "No enemy is hidden or invisible."));
  }

  // "Has at least one undead entity" (Undead, Attack!): only while the actor actually has one --
  // an effect or item by that name, or an ally token named for it.
  const owned = action?.gatingProfile?.requiresOwned;
  if (owned) {
    const stem = slugText(owned).replace(/(?:ies|y|s)$/, "");
    const actor = contextActorDocument(context);
    const names = [
      ...Array.from(actor?.items ?? []).map((item) => item?.name),
      ...contextAllies(context).map((ally) => ally?.name),
    ].map((name) => slugText(name ?? ""));
    if (stem && !names.some((name) => name.includes(stem))) {
      return blockedAction(action, t("ScoreReason.RequiresOwned", "Needs {thing} first.", { thing: owned }));
    }
  }

  // Dispel Magic needs a spell effect to unravel: an enemy's buff (Spell Effect: Haste...).
  // Its target is that enemy: never the caster or an ally.
  const dispellable = (enemy) => (Array.isArray(enemy?.effects) ? enemy.effects : [])
    .some((effect) => /spell[- ]effect/i.test(`${effect?.name ?? ""} ${effect?.slug ?? ""}`));
  if (/(?:^|-)dispel-magic$/.test(slugText(action.slug ?? action.name))
    && !(target ? contextEnemies(context).some((enemy) => enemy?.id === target?.id && dispellable(enemy)) : contextEnemies(context).some(dispellable))) {
    return blockedAction(action, t("ScoreReason.NothingToDispel", "No enemy has a spell effect to dispel."));
  }

  // Earthbind pulls a flier down: pointless against creatures that can't fly.
  if (/(?:^|-)earthbind$/.test(slugText(action.slug ?? action.name)) && !contextEnemies(context).some(canFly)) {
    return blockedAction(action, t("ScoreReason.NoFlyingEnemy", "No enemy is flying."));
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

  // A heal nobody here can receive at all (Heal Animal with no animal in the party).
  if (role === "healing" && !healingRecipientAllowed(action, profile)
    && !contextAllies(context).some((ally) => healingRecipientAllowed(action, ally))) {
    return blockedAction(action, t("ScoreReason.NoValidHealingRecipient", "No creature here can receive {name}.", { name: action.name }));
  }
  const explicitHealer = hasExplicitPlayerHealerPreference(context);
  const healingThreshold = explicitHealer ? 0.75 : 0.5;
  // An explicit Healer keeps its heals listed when nobody needs one (scored below zero by
  // healingIsIdle); a patient out of reach still blocks it, for everyone.
  const outOfReachOnly = !hasNeededHealingRecipient(context, profile, action, { threshold: healingThreshold })
    && hasNeededHealingRecipient(context, profile, action, { ignoreRange: true, threshold: healingThreshold });
  if (role === "healing" && (outOfReachOnly || !explicitHealer) && !hasNeededHealingRecipient(context, profile, action, { threshold: healingThreshold })) {
    const hasOutOfReachRecipient = healingRangeKnown(action)
      && hasNeededHealingRecipient(context, profile, action, { ignoreRange: true, threshold: healingThreshold });
    return blockedAction(action, hasOutOfReachRecipient
      ? t("ScoreReason.NoBadlyInjuredHealingTargetInReach", "No badly injured healing target is in reach.")
      : t("ScoreReason.NoAllyIsBadly", "No ally is badly injured."));
  }

  if (isEidolonOnlySpell(action) && !context?.eidolons?.length) {
    return blockedAction(action, t("ScoreReason.NoEidolonOnBoard", "No eidolon on the board to take {spell}.", { spell: action.name }));
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

  if (action.source === "strike" && target && !inRange(action, target)) {
    return blockedAction(action, t("ScoreReason.TargetIsOutOf", "Target is out of range."));
  }

  return null;
}
