import { normalizedActionFacts } from "./facts.js";

const DESTINATION_ACTION_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);

export function actionSlug(action) {
  return normalizedActionFacts(action).identity.slug;
}

export function actionTargeting(action) {
  return action?.targetingProfile ?? action?.action?.targetingProfile ?? {};
}

export function actionIncludes(action, value) {
  return normalizedActionFacts(action).activityIncludes.includes(String(value ?? "").toLowerCase());
}

export function isDestinationActionSlug(value) {
  return DESTINATION_ACTION_SLUGS.has(String(value ?? "").toLowerCase());
}

export function isSelfCenteredAreaAction(action) {
  return normalizedActionFacts(action).targeting.selfCentered;
}

export function isTargetCenteredAreaAction(action) {
  return normalizedActionFacts(action).targeting.targetCentered;
}

export function requiresAreaMarkerForAction(action) {
  return normalizedActionFacts(action).targeting.requiresAreaMarker;
}

export function requiresDestinationForAction(action) {
  return normalizedActionFacts(action).targeting.requiresDestination;
}

export function requiresTargetForAction(action) {
  return normalizedActionFacts(action).targeting.requiresTarget;
}
