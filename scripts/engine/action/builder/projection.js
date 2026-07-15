import {
  isSelfCenteredAreaAction,
  requiresAreaMarkerForAction,
} from "../requirements.js";
import { areaMarkerLabel, areaMarkerShape, areaRegionDistance, areaRegionWidth } from "../../area/region.js";
import { createPlanState, projectContextFromPlanState } from "../../plan-state.js";

export function draftStepIsUsable(step) {
  return step && !step.stale && step.execution?.status !== "failed";
}

function numericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
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

function draftStepsBefore(draft, beforeInstanceId = null) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const uncounted = Array.isArray(draft?.uncounted) ? draft.uncounted : [];
  if (!beforeInstanceId) return steps;
  const uncountedIndex = uncounted.findIndex((step) => step?.instanceId === beforeInstanceId);
  if (uncountedIndex >= 0) return [...steps, ...uncounted.slice(0, uncountedIndex)];
  const stepIndex = steps.findIndex((step) => step?.instanceId === beforeInstanceId);
  return stepIndex >= 0 ? steps.slice(0, stepIndex) : steps;
}

export function projectContextForDraftDestination(context, draft) {
  const state = createPlanState(context, { steps: draftStepsBefore(draft) });
  return projectContextFromPlanState(context, state);
}

export function projectContextForDraftStepOrigin(context, draft, instanceId) {
  const state = createPlanState(context, { steps: draftStepsBefore(draft, instanceId) });
  return projectContextFromPlanState(context, state);
}
