import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { slugify } from "../engine/action/text.js";
import { canAttackTarget, contextAllies, contextEnemies, contextTargets } from "../engine/target-pool.js";
import {
  isSeekRelevantVisibility,
  isVisionerActive,
  readVisionerDetectionState,
} from "../integrations/visioner.js";
import { hasDemoralizeImmunity } from "../rules/demoralize-immunity.js";
import {
  canvasTokenById,
  isLockedDoorWall,
  pointToSegmentDistance,
  wallSegment,
} from "../rules/canvas-geometry.js";
import { pf2eActionName, pf2eCondition, t } from "../i18n.js";
import {
  actionUsesMovement,
  contextProfile,
  hasCondition,
  meleeReach,
  movementBlockingCondition,
  movementRange,
} from "./action/reader-helpers.js";
import {
  centerPoint,
  movementGridMetrics,
  movementReachableCenters,
} from "./action/reach.js";

const ESCAPE_CONDITIONS = new Set([
  "grabbed",
  "grappled",
  "immobilised",
  "immobilized",
  "restrained",
]);
const GENERIC_ACTIONS_BY_SLUG = new Map(GENERIC_ACTIONS.map((action) => [action.slug, action]));
const MANUAL_ONLY_SKILL_ACTION_SLUGS = new Set([
  "balance",
  "borrow-an-arcane-spell",
  "coerce",
  "cover-tracks",
  "create-forgery",
  "craft",
  "decipher-writing",
  "follow-the-expert",
  "gather-information",
  "high-jump",
  "identify-alchemy",
  "identify-magic",
  "impersonate",
  "learn-a-spell",
  "lie",
  "long-jump",
  "make-an-impression",
  "perform",
  "repair",
  "sense-direction",
  "squeeze",
  "subsist",
  "track",
  "treat-disease",
  "treat-poison",
  "treat-wounds",
]);
const COMBAT_SIGNAL_ROLES = new Set([
  "area-damage",
  "buff",
  "control",
  "damage",
  "debuff",
  "defense",
  "grab",
  "healing",
  "mobility-attack",
  "multiattack",
  "reaction-attack",
  "reaction-defense",
  "self-healing",
  "setup",
  "stealth-defense",
  "summon",
]);
const COMBAT_SIGNAL_SLUGS = new Set([
  "administer-first-aid",
  "command-an-animal",
  "create-a-diversion",
  "demoralize",
  "disarm",
  "escape",
  "feint",
  "grapple",
  "hide",
  "raise-a-shield",
  "recall-knowledge",
  "reposition",
  "seek",
  "sense-motive",
  "shove",
  "sneak",
  "stabilize",
  "steal",
  "take-cover",
  "trip",
  "tumble-through",
]);

function availability(available, reason) {
  return { available, reason };
}

function isGmContext(context) {
  return context?.isGM === true || globalThis.game?.user?.isGM === true;
}

function hideGenericActionForContext(action, context) {
  if (action.hideFromSuggestions) return true;
  return action.slug === "recall-knowledge"
    && action.playerFacing
    && isGmContext(context)
    && isNpcProfile(contextProfile(context));
}

function hasCombatRelevantSystemActionSignal(slug, traits, tactic) {
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (COMBAT_SIGNAL_SLUGS.has(slug)) return true;
  if (normalizedTraits.includes("attack")) return true;
  if (COMBAT_SIGNAL_ROLES.has(tactic?.role)) return true;

  const activity = tactic?.activityProfile ?? {};
  const targeting = tactic?.targetingProfile ?? {};
  return Boolean(
    targeting.enemy
    || tactic?.saveProfile
    || tactic?.damageProfile
    || activity.appliesCondition
    || activity.removesCondition
    || activity.reducesCondition
    || activity.requiresTargetCondition
    || activity.averageDamage
    || activity.healing
    || activity.includesStrike
    || activity.extraAction
    || activity.shieldBlock
  );
}

export function hideNonCombatSystemAction(slug, traits, tactic) {
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (MANUAL_ONLY_SKILL_ACTION_SLUGS.has(slug)) return true;
  if (!normalizedTraits.includes("exploration")) return false;
  return !hasCombatRelevantSystemActionSignal(slug, normalizedTraits, tactic);
}

function genericActionVariants(action, context, profile) {
  if (action.slug !== "command-an-animal" || !hasCompanionOrMinion(context, profile)) return [action];
  return [{
    ...action,
    activityProfile: {
      ...(action.activityProfile ?? {}),
      commandActionCost: 1,
      minionActionBudget: 2,
    },
  }];
}

function genericActionDisplayName(action) {
  if (action.slug === "command-an-animal" && action.activityProfile?.minionActionBudget) {
    return t("MinionPlan.CommandAction", "Command Companion");
  }
  return pf2eActionName(action.slug, action.name);
}

export function readGenericActions(context) {
  const profile = contextProfile(context);
  return GENERIC_ACTIONS
    .filter((action) => !hideGenericActionForContext(action, context))
    .flatMap((action) => genericActionVariants(action, context, profile))
    .map((action) => {
    const itemAvailability = readGenericActionAvailabilityForAction(action, context);
    // Wall proximity no longer grants Take Cover eligibility (see the catalog entry), so any
    // prone-triggered Take Cover is inherently the "stay prone for cover" tactic -- it conflicts
    // with also Standing up in the same plan (see requiresProneForCover in planner.js).
    const proneCover = action.slug === "take-cover" && hasCondition(profile, "prone");
    return {
      ...action,
      name: genericActionDisplayName(action),
      source: "generic",
      confidence: "medium",
      detected: true,
      item: null,
      available: itemAvailability.available,
      unavailableReason: itemAvailability.reason,
      activityProfile: {
        ...(action.activityProfile ?? {}),
        ...(proneCover ? { requiresProneCover: true } : {}),
      },
      targetingProfile: {
        ...(action.targetingProfile ?? {}),
        ...(Number.isFinite(Number(action.maxRange)) ? { maxRange: Number(action.maxRange) } : {}),
      },
    };
  });
}

export function readGenericActionAvailability(slug, context) {
  const action = GENERIC_ACTIONS_BY_SLUG.get(slug);
  return action ? readGenericActionAvailabilityForAction(action, context) : availability(true, "");
}

function readGenericActionAvailabilityForAction(action, context) {
  const profile = contextProfile(context);
  const targets = contextTargets(context);
  const enemies = contextEnemies(context);
  const targetableTargets = targets.filter(canAttackTarget);
  const targetableEnemies = enemies.filter(canAttackTarget);
  const actionTargets = action.slug === "demoralize"
    ? targetableTargets.filter((target) => !hasDemoralizeImmunity(target))
    : targetableTargets;
  const actionEnemies = action.slug === "demoralize"
    ? targetableEnemies.filter((target) => !hasDemoralizeImmunity(target))
    : targetableEnemies;
  const allies = contextAllies(context);
  const movementAvailability = readMovementAvailability(context, action);

  if (action.playerFacing && isNpcProfile(profile)) {
    return availability(false, t("Avail.NpcNoRecall", "NPCs do not need Recall Knowledge recommendations."));
  }
  if (!movementAvailability.available) {
    return movementAvailability;
  }
  if (action.slug === "raise-a-shield") {
    if (!profile.hasShield) return availability(false, t("Avail.NoShield", "No shield equipped."));
    return availability(true, "");
  }
  if (action.requiresTarget) {
    const targetExists = Boolean(actionTargets.length);
    if (!targetExists && action.slug === "demoralize" && targetableTargets.length) {
      return availability(false, t("Avail.DemoralizeImmune", "Target is temporarily immune to Demoralize."));
    }
    if (!targetExists) return availability(false, t("Avail.NoEnemySelected", "No enemy target selected."));
  }
  if (Number.isFinite(action.maxRange)) {
    const targetPool = action.requiresTarget ? actionTargets : [...actionTargets, ...actionEnemies];
    const inRange = targetPool.some((target) => (target?.distance ?? Infinity) <= action.maxRange);
    if (!inRange) return availability(false, t("Avail.NoTargetWithin", "No target within {range} feet.", { range: action.maxRange }));
  }
  if (action.requiresEnemyInReach) {
    const enemyInReach = targetableTargets.some((target) => (target?.distance ?? Infinity) <= meleeReach(profile));
    if (!enemyInReach) return availability(false, t("Avail.NoEnemyInReach", "No enemy in reach."));
  }
  if (action.requiresFreeHand && freeHands(profile) < 1) {
    return availability(false, t("Avail.NoFreeHand", "No free hand to manipulate an object."));
  }
  if (action.requiresNearbyEnemy) {
    const nearbyEnemy = targetableTargets.some((target) => (target?.distance ?? Infinity) <= movementRange(profile));
    if (!nearbyEnemy) return availability(false, t("Avail.NoEnemyClose", "No enemy close enough."));
  }
  if (action.requiresSeekTarget) {
    if (!hasSeekTarget(context, enemies)) {
      return availability(false, t("Avail.NoHiddenTarget", "No hidden or undetected target detected."));
    }
  }
  if (action.requiresCombatSignal) {
    if (!hasCombatSignal(context, targetableTargets)) {
      return availability(false, t("Avail.NoDeceptionEffect", "No combat-relevant deception or mental effect detected."));
    }
  }
  if (action.requiresTumbleThroughOpportunity) {
    if (!hasTumbleThroughOpportunity(context, targetableTargets)) {
      return availability(false, t("Avail.NoPathThroughEnemy", "No useful path through enemy detected."));
    }
  }
  if (action.requiresTerrain) {
    if (!hasTerrain(context, action.requiresTerrain)) {
      return availability(false, t("Avail.NoTerrain", "No {terrain} terrain detected.", { terrain: action.requiresTerrain }));
    }
  }
  if (action.requiresObstacleInReach) {
    if (!hasObjectInReach(context, profile, ["obstacles", "objects", "hazards", "doors"])) {
      return availability(false, t("Avail.NoObstacle", "No obstacle or object in reach."));
    }
  }
  if (action.requiresObjectInReach) {
    if (!hasObjectInReach(context, profile, ["objects"])) {
      return availability(false, t("Avail.NoObject", "No object in reach."));
    }
  }
  if (action.requiresProne) {
    if (!hasCondition(profile, "prone")) {
      return availability(false, t("Avail.NotProne", "Actor is not prone."));
    }
  }
  if (action.requiresSickened) {
    if (!hasCondition(profile, "sickened")) {
      return availability(false, t("Avail.NotSickened", "Actor is not sickened."));
    }
  }
  if (action.requiresCover) {
    if (!hasCoverOrConcealment(profile, context)) {
      return availability(false, t("Avail.NoCoverConcealment", "No cover or concealment detected."));
    }
  }
  if (action.requiresHiddenOrCover) {
    if (!hasCoverOrConcealment(profile, context) && !hasCondition(profile, "hidden")) {
      return availability(false, t("Avail.NoHiddenCover", "No hidden state, cover, or concealment detected."));
    }
  }
  if (action.requiresGrabbedOrRestrained) {
    if (![...ESCAPE_CONDITIONS].some((condition) => hasCondition(profile, condition))) {
      return availability(false, t("Avail.NotGrabbed", "Actor is not grabbed, restrained, or immobilized."));
    }
  }
  if (action.requiresDyingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying"))) {
      return availability(false, t("Avail.NoDyingAlly", "No dying ally detected."));
    }
  }
  if (action.requiresDyingOrBleedingAlly) {
    if (!allies.some((ally) => hasCondition(ally, "dying") || hasCondition(ally, "persistent-bleed"))) {
      return availability(false, t("Avail.NoDyingBleedingAlly", "No dying or bleeding ally detected."));
    }
  }
  if (action.requiresCompanionOrMinion) {
    if (!hasCompanionOrMinion(context, profile)) {
      return availability(false, t("Avail.NoCompanion", "No companion or minion detected."));
    }
  }
  return availability(true, "");
}

function freeHands(profile) {
  const hands = Number(profile?.handsFree);
  return Number.isFinite(hands) ? hands : 0;
}

function hasMovementCollisionChecker(context) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  return typeof globalThis.canvas?.walls?.checkCollision === "function"
    || Array.isArray(globalThis.canvas?.walls?.placeables)
    || typeof collisionToken?.checkCollision === "function";
}

function basicMovementBlockedByCollision(context, profile, action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  if (!["crawl", "step", "stride"].includes(slug)) return false;
  if (!hasMovementCollisionChecker(context)) return false;

  const origin = centerPoint(context?.token);
  if (!origin) return false;

  const distance = ["crawl", "step"].includes(slug) ? 5 : movementRange(profile);
  const metrics = movementGridMetrics();
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  return !movementReachableCenters(origin, distance, metrics, collisionToken, context).length;
}

export function readMovementAvailability(context, action) {
  if (!actionUsesMovement(action)) return availability(true, "");

  const profile = contextProfile(context);
  const condition = movementBlockingCondition(profile, action);
  if (condition) return availability(false, t("Avail.MoveBlocked", "Actor is {condition}; move actions are unavailable.", { condition: pf2eCondition(condition, condition) }));

  return availability(true, "");
}

function isNpcProfile(profile) {
  return ["npc", "hazard", "loot"].includes(String(profile?.actorType ?? profile?.type ?? "").toLowerCase());
}

function hasTerrain(context, key) {
  const terrain = context?.battlefield?.terrain ?? context?.terrain ?? {};
  if (terrain === key) return true;
  if (Array.isArray(terrain)) return terrain.includes(key);
  return Boolean(terrain?.[key]);
}

function hasLockedCanvasDoorInReach(context, profile) {
  const origin = centerPoint(context?.token);
  const walls = globalThis.canvas?.walls?.placeables ?? [];
  if (!origin || !Array.isArray(walls) || !walls.length) return false;

  const metrics = movementGridMetrics();
  const reach = meleeReach(profile);
  return walls.some((wall) => {
    if (!isLockedDoorWall(wall)) return false;
    const segment = wallSegment(wall);
    if (!segment) return false;
    return pointToSegmentDistance(origin, segment[0], segment[1])
      / metrics.pixelsPerFoot <= reach;
  });
}

function hasObjectInReach(context, profile, buckets) {
  const reach = meleeReach(profile);
  if (buckets.includes("doors") && hasLockedCanvasDoorInReach(context, profile)) return true;

  return buckets.some((bucket) => {
    const values = context?.battlefield?.[bucket] ?? context?.[bucket] ?? [];
    return Array.isArray(values) && values.some((entry) => (entry?.distance ?? Infinity) <= reach);
  });
}

function hasSeekTarget(context, enemies) {
  const observer = context?.token ?? context?.combatant?.token ?? null;
  const useVisioner = isVisionerActive();
  return enemies.some((enemy) => {
    const visionerState = useVisioner
      ? (enemy?.visionerDetectionState
        ?? enemy?.visibility
        ?? readVisionerDetectionState(enemy, observer))
      : null;
    if (visionerState) return isSeekRelevantVisibility(visionerState);
    if (enemy?.token?.hidden || enemy?.hidden) return true;
    return hasCondition(enemy, "hidden")
      || hasCondition(enemy, "undetected")
      || hasCondition(enemy, "unnoticed")
      || hasCondition(enemy, "invisible");
  });
}

function hasCombatSignal(context, targets) {
  const contextSignals = context?.combatSignals ?? context?.battlefield?.combatSignals ?? [];
  const signals = Array.isArray(contextSignals) ? contextSignals : [contextSignals];
  const targetSignals = targets.flatMap((target) => {
    const values = target?.behaviorSignals ?? target?.combatSignals ?? [];
    return Array.isArray(values) ? values : [values];
  });
  return [...signals, ...targetSignals]
    .map((signal) => String(signal ?? "").toLowerCase())
    .some((signal) => [
      "deception",
      "mental-magic",
      "mental",
      "abnormal-behavior",
      "possessed",
      "charmed",
      "controlled",
    ].includes(signal));
}

function hasTumbleThroughOpportunity(context, targets) {
  const battlefield = context?.battlefield ?? {};
  if (context?.tumbleThroughOpportunity || battlefield.tumbleThroughOpportunity) return true;

  const rawNeeds = context?.tacticalNeeds ?? battlefield.tacticalNeeds ?? [];
  const needs = (Array.isArray(rawNeeds) ? rawNeeds : [rawNeeds])
    .map((need) => String(need ?? "").toLowerCase());
  if (needs.some((need) => ["through-enemy", "flank", "body-block", "reposition-behind"].includes(need))) {
    return true;
  }

  return targets.some((target) =>
    target?.blocksPath
    || target?.needThroughEnemy
    || target?.flankOpportunity
    || target?.offGuardPayoff,
  );
}

function hasCoverOrConcealment(profile, context) {
  return Boolean(
    profile?.hasCover
    || profile?.hasConcealment
    || context?.battlefield?.hasCover
    || context?.battlefield?.hasConcealment,
  );
}

function hasCompanionOrMinion(context, profile) {
  return Boolean(
    profile?.hasCompanion
    || profile?.hasMinion
    || context?.companions?.length
    || context?.minions?.length,
  );
}
