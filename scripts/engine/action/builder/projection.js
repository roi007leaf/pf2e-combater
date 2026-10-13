import {
  isSelfCenteredAreaAction,
  requiresAreaMarkerForAction,
} from "../requirements.js";
import { areaMarkerLabel, areaMarkerShape, areaRegionDistance, areaRegionWidth } from "../../area/region.js";
import { createPlanState, projectContextFromPlanState } from "../../plan-state.js";
import { scoreCandidate } from "../../scoring.js";

export function draftStepIsUsable(step) {
  return step && !step.stale && !step.quickenedNextTurn && step.execution?.status !== "failed";
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

// Re-score only drafted areas, rather than rebuilding every candidate for every step.
// Movement edits must update both the AOE choices and their automatic hover template.
export function refreshDraftAreaPlacements(context, draft) {
  const refresh = (step) => {
    const action = step?.action;
    if (!draftStepIsUsable(step) || step.execution?.status === "done" || !action
      || !requiresAreaMarkerForAction(action)) return step;
    const origin = projectContextForDraftStepOrigin(context, draft, step.instanceId);
    const scored = scoreCandidate(origin, action);
    const profile = scored.activityProfile ?? {};
    const refreshedAction = {
      ...action,
      activityProfile: {
        ...action.activityProfile,
        areaPlacementCenter: profile.areaPlacementCenter ?? null,
        areaPlacementAimPoint: profile.areaPlacementAimPoint ?? null,
        areaPlacementOptions: profile.areaPlacementOptions ?? [],
      },
    };
    // Manual placement has index -1. Leave its marker and committed targets alone.
    if (step.areaPlacementIndex === -1) return { ...step, action: refreshedAction };
    const options = refreshedAction.activityProfile.areaPlacementOptions;
    const index = Math.min(Math.max(0, step.areaPlacementIndex ?? 0), Math.max(0, options.length - 1));
    const placement = options[index];
    const markerAction = placement ? {
      ...refreshedAction,
      activityProfile: { ...refreshedAction.activityProfile, ...placement },
    } : refreshedAction;
    return {
      ...step,
      action: refreshedAction,
      areaPlacementIndex: index,
      areaMarker: computeAreaMarker(origin, markerAction),
    };
  };
  return {
    ...draft,
    steps: (draft.steps ?? []).map(refresh),
    uncounted: (draft.uncounted ?? []).map(refresh),
  };
}
