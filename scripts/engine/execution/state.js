import { t } from "../../i18n.js";
import { requiresDestinationForAction, requiresTargetForAction } from "../action/requirements.js";
import { needsAreaChoiceForExecution } from "./area.js";
import { destinationFromStep } from "./movement.js";
import { resolveTarget } from "./targets.js";

export function executionAction(step, action) {
  const merged = { ...(action ?? {}) };
  for (const key of ["actionKey", "key", "slug", "movementAction"]) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === "") && step?.[key]) {
      merged[key] = step[key];
    }
  }
  if (step?.requiresDestination === true) merged.requiresDestination = true;
  return merged;
}

export function executionReadinessForStep(step, action = step?.action ?? step) {
  const resolvedAction = executionAction(step, action);
  const choices = [];
  if (requiresDestinationForAction(resolvedAction) && !destinationFromStep(step)) choices.push("destination");
  if (requiresTargetForAction(resolvedAction) && !resolveTarget(step, resolvedAction)) choices.push("target");
  if (needsAreaChoiceForExecution(step, resolvedAction)) choices.push("area");
  const choiceLabels = choices.map((choice) => t(`Choice.${choice}`, choice));
  return {
    status: choices.length ? "needs-choice" : "ready",
    choices,
    warning: choices.length ? t("Exec.ChooseAtExec", "Choose {choices} at execution.", { choices: choiceLabels.join(", ") }) : "",
  };
}

export function nextPendingExecutionStep(draft) {
  return (Array.isArray(draft?.steps) ? draft.steps : [])
    .find((step) => step?.execution?.status !== "done") ?? null;
}

export function resetDraftExecution(draft) {
  const resetList = (list) => (Array.isArray(list) ? list : []).map((step) => ({
    ...step,
    execution: { status: "pending" },
  }));
  return {
    ...(draft ?? {}),
    steps: resetList(draft?.steps),
    ...(Array.isArray(draft?.uncounted) ? { uncounted: resetList(draft.uncounted) } : {}),
  };
}
