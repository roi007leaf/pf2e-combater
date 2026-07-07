import { slugify } from "./text.js";
import {
  isDestinationActionSlug,
  isSelfCenteredAreaAction,
  requiresAreaMarkerForAction,
  requiresDestinationForAction,
} from "./requirements.js";
import { areaMarkerLabel, areaMarkerShape, areaRegionDistance, areaRegionWidth } from "../area/region.js";
import { footprintPathDistanceFeet } from "../../rules/token-geometry.js";

const ESCAPE_REMOVED_CONDITIONS = ["grabbed", "grappled", "immobilised", "immobilized", "restrained"];
const RAISE_SHIELD_SLUGS = new Set(["raise-a-shield"]);
const SHIELD_SPELL_SLUGS = new Set(["shield"]);

function actionSlugFromName(name) {
  return slugify(name);
}

export function draftStepIsUsable(step) {
  return step && !step.stale && step.execution?.status !== "failed";
}

function draftStepSlugCandidates(step) {
  const action = step?.action ?? {};
  return [
    step?.slug,
    step?.actionKey,
    step?.key,
    action?.slug,
    action?.id,
    action?.name,
  ].map(actionSlugFromName).filter(Boolean);
}

function draftStepGrantsRaisedShield(step) {
  if (!draftStepIsUsable(step)) return false;
  return draftStepSlugCandidates(step).some((slug) => RAISE_SHIELD_SLUGS.has(slug));
}

function draftStepGrantsShieldSpell(step) {
  if (!draftStepIsUsable(step)) return false;
  const action = step?.action ?? {};
  const slugs = draftStepSlugCandidates(step);
  if (!slugs.some((slug) => SHIELD_SPELL_SLUGS.has(slug))) return false;
  return String(action?.source ?? "").startsWith("spell")
    || action?.activityProfile?.spell === true
    || action?.item?.type === "spell"
    || action?.isCantrip === true;
}

function draftShieldCombatState(draft, { beforeInstanceId = null } = {}) {
  const state = {};
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  for (const step of steps) {
    if (beforeInstanceId && step?.instanceId === beforeInstanceId) break;
    if (draftStepGrantsRaisedShield(step)) state.raisedShieldActive = true;
    if (draftStepGrantsShieldSpell(step)) state.shieldSpellActive = true;
  }
  return state;
}

function numericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function targetCenter(target) {
  return numericPoint(target?.center) ?? numericPoint(target?.token?.center);
}

function casterCenter(context) {
  return numericPoint(context?.token?.center);
}

export function computeAreaMarker(context, action) {
  if (!requiresAreaMarkerForAction(action)) return null;

  const type = areaMarkerShape(action);
  const activityProfile = action?.activityProfile ?? {};
  const distance = areaRegionDistance(action);
  const width = areaRegionWidth(action, null, 5);
  const originTokenId = context?.token?.id ?? context?.token?.uuid ?? null;

  if (type === "emanation" && isSelfCenteredAreaAction(action)) {
    const center = casterCenter(context);
    if (!center) return null;
    return {
      shape: "emanation",
      center,
      distance,
      width,
      rotation: 0,
      originTokenId,
      label: areaMarkerLabel("emanation", distance),
    };
  }

  if (type === "burst") {
    const center = numericPoint(activityProfile.areaPlacementCenter);
    if (!center) return null;
    return {
      shape: "burst",
      center,
      distance,
      width,
      rotation: 0,
      originTokenId,
      label: areaMarkerLabel("burst", distance),
    };
  }

  if (type === "cone" || type === "line") {
    const aimPoint = numericPoint(activityProfile.areaPlacementAimPoint);
    const origin = casterCenter(context);
    if (!aimPoint || !origin) return null;
    const rotation = Math.round((Math.atan2(aimPoint.y - origin.y, aimPoint.x - origin.x) * 180) / Math.PI);
    return {
      shape: type,
      center: origin,
      distance,
      width,
      rotation,
      originTokenId,
      label: areaMarkerLabel(type, distance),
    };
  }

  return null;
}

function footprintDistanceFeet(origin, originToken, target) {
  const center = targetCenter(target);
  return footprintPathDistanceFeet(origin, originToken, center, target);
}

function draftActionSlug(step) {
  const raw = step?.slug
    ?? step?.action?.slug
    ?? step?.actionKey
    ?? step?.key
    ?? "";
  return String(raw).toLowerCase().split("#")[0];
}

function valuesArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function draftStepRemovedConditions(step) {
  const slug = draftActionSlug(step);
  const profile = step?.action?.activityProfile ?? {};
  const included = new Set(valuesArray(profile.includes).map((entry) => String(entry).toLowerCase()));
  const removed = new Set(valuesArray(profile.removesCondition)
    .concat(valuesArray(profile.removesConditions))
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean));

  if (slug === "stand" || slug === "stand-stride" || included.has("stand")) removed.add("prone");
  if (slug === "escape") {
    for (const condition of ESCAPE_REMOVED_CONDITIONS) removed.add(condition);
  }
  return removed;
}

function draftStepAddedConditions(step) {
  const slug = draftActionSlug(step);
  const profile = step?.action?.activityProfile ?? {};
  const added = new Set(valuesArray(profile.appliesCondition)
    .concat(valuesArray(profile.appliesConditions))
    .concat(valuesArray(profile.appliedCondition))
    .map((entry) => String(entry).toLowerCase())
    .filter(Boolean));

  if (slug.includes("drop-prone") || step?.action?.executable === "drop-prone") added.add("prone");
  return added;
}

function draftConditionChanges(draft, { beforeInstanceId = null } = {}) {
  const added = new Set();
  const removed = new Set();
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  for (const step of steps) {
    if (beforeInstanceId && step?.instanceId === beforeInstanceId) break;
    for (const condition of draftStepRemovedConditions(step)) {
      added.delete(condition);
      removed.add(condition);
    }
    for (const condition of draftStepAddedConditions(step)) {
      removed.delete(condition);
      added.add(condition);
    }
  }
  return { added, removed };
}

function removeConditions(conditions, removed) {
  if (!conditions || !removed?.size) return conditions;

  if (Array.isArray(conditions)) {
    return conditions.filter((condition) => !removed.has(String(condition?.slug ?? condition).toLowerCase()));
  }

  const next = { ...conditions };
  if (Array.isArray(next.slugs)) {
    next.slugs = next.slugs.filter((slug) => !removed.has(String(slug).toLowerCase()));
  }
  if (next.values && typeof next.values === "object") {
    next.values = { ...next.values };
    for (const condition of removed) delete next.values[condition];
  }
  return next;
}

function removeProfileConditions(profile, removed) {
  if (!profile || !removed?.size) return profile;
  return {
    ...profile,
    conditions: removeConditions(profile.conditions, removed),
  };
}

function addConditions(conditions, added) {
  if (!added?.size) return conditions;

  if (Array.isArray(conditions)) {
    const existing = new Set(conditions.map((condition) => String(condition?.slug ?? condition).toLowerCase()));
    return [
      ...conditions,
      ...[...added].filter((condition) => !existing.has(condition)),
    ];
  }

  const next = { ...(conditions ?? {}) };
  const slugs = Array.isArray(next.slugs) ? [...next.slugs] : [];
  const values = { ...(next.values ?? {}) };
  for (const condition of added) {
    if (!slugs.includes(condition)) slugs.push(condition);
    values[condition] = Math.max(1, Number(values[condition]) || 0);
  }
  return { ...next, slugs, values };
}

function addProfileConditions(profile, added) {
  if (!profile || !added?.size) return profile;
  return {
    ...profile,
    conditions: addConditions(profile.conditions, added),
  };
}

function conditionChangeSets(changes) {
  if (changes instanceof Set) return { removed: changes, added: new Set() };
  return {
    removed: changes?.removed instanceof Set ? changes.removed : new Set(),
    added: changes?.added instanceof Set ? changes.added : new Set(),
  };
}

function projectProfileConditions(profile, changes) {
  const { removed, added } = conditionChangeSets(changes);
  return addProfileConditions(removeProfileConditions(profile, removed), added);
}

function projectConditionState(context, changes) {
  const { removed, added } = conditionChangeSets(changes);
  if (!removed.size && !added.size) return context;
  const nextProfile = projectProfileConditions(context?.profile, changes);
  const actorProfile = projectProfileConditions(context?.actor?.profile, changes);
  return {
    ...context,
    ...(nextProfile ? { profile: nextProfile } : {}),
    actor: context?.actor
      ? {
        ...context.actor,
        ...(actorProfile ? { profile: actorProfile } : {}),
      }
      : context?.actor,
  };
}

function projectShieldCombatProfile(profile, shieldState) {
  if (!profile || (!shieldState?.raisedShieldActive && !shieldState?.shieldSpellActive)) return profile;
  return {
    ...profile,
    combatState: {
      ...(profile.combatState ?? {}),
      ...(shieldState.raisedShieldActive ? { raisedShieldActive: true } : {}),
      ...(shieldState.shieldSpellActive ? { shieldSpellActive: true } : {}),
    },
  };
}

function projectShieldCombatState(context, shieldState) {
  if (!shieldState?.raisedShieldActive && !shieldState?.shieldSpellActive) return context;
  const nextProfile = projectShieldCombatProfile(context?.profile ?? {}, shieldState);
  const actorProfile = projectShieldCombatProfile(context?.actor?.profile ?? {}, shieldState);
  return {
    ...context,
    profile: nextProfile,
    actor: context?.actor
      ? {
        ...context.actor,
        profile: actorProfile,
      }
      : context?.actor,
  };
}

function projectTargetDistance(target, origin, originToken) {
  const center = targetCenter(target);
  if (!center) return target;
  const distance = footprintDistanceFeet(origin, originToken, target);
  return Number.isFinite(distance) ? { ...target, distance } : target;
}

function projectTargetList(targets, origin, originToken) {
  return Array.isArray(targets)
    ? targets.map((target) => projectTargetDistance(target, origin, originToken))
    : targets;
}

function draftStepLooksLikeDestinationStep(step) {
  if (step?.requiresDestination === true) return true;
  if (requiresDestinationForAction(step?.action)) return true;
  const slug = String(step?.slug ?? step?.action?.slug ?? "").toLowerCase();
  const key = String(step?.actionKey ?? step?.key ?? "").toLowerCase();
  return isDestinationActionSlug(slug)
    || isDestinationActionSlug(key)
    || slug.includes("stride")
    || key.includes("stride")
    || slug.includes("step")
    || key.includes("step");
}

function lastDraftDestination(draft, { beforeInstanceId = null } = {}) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const uncounted = Array.isArray(draft?.uncounted) ? draft.uncounted : [];
  const inUncounted = beforeInstanceId != null
    && uncounted.some((step) => step?.instanceId === beforeInstanceId);

  let destination = null;
  const scan = (list, stopAtBefore) => {
    for (const step of list) {
      if (stopAtBefore && beforeInstanceId && step?.instanceId === beforeInstanceId) break;
      if (!draftStepLooksLikeDestinationStep(step)) continue;
      const stepDestination = numericPoint(step?.destination);
      if (stepDestination) destination = stepDestination;
    }
  };

  if (inUncounted) {
    scan(steps, false);
    scan(uncounted, true);
  } else {
    scan(steps, true);
  }
  return destination;
}

function projectContextToOrigin(context, destination, conditionChanges = new Set(), shieldState = {}) {
  if (!context) return context;
  const stateContext = projectShieldCombatState(projectConditionState(context, conditionChanges), shieldState);
  if (!destination) return stateContext;

  const battlefield = stateContext.battlefield ?? {};
  const originToken = stateContext.token ?? null;
  return {
    ...stateContext,
    token: {
      ...(stateContext.token ?? {}),
      center: destination,
      plannedCenter: destination,
    },
    battlefield: {
      ...battlefield,
      targets: projectTargetList(battlefield.targets, destination, originToken),
      enemies: projectTargetList(battlefield.enemies, destination, originToken),
      allies: projectTargetList(battlefield.allies, destination, originToken),
    },
    targets: projectTargetList(stateContext.targets, destination, originToken),
    enemies: projectTargetList(stateContext.enemies, destination, originToken),
    allies: projectTargetList(stateContext.allies, destination, originToken),
  };
}

export function projectContextForDraftDestination(context, draft) {
  return projectContextToOrigin(
    context,
    lastDraftDestination(draft),
    draftConditionChanges(draft),
    draftShieldCombatState(draft),
  );
}

export function projectContextForDraftStepOrigin(context, draft, instanceId) {
  const options = { beforeInstanceId: instanceId };
  return projectContextToOrigin(
    context,
    lastDraftDestination(draft, options),
    draftConditionChanges(draft, options),
    draftShieldCombatState(draft, options),
  );
}
