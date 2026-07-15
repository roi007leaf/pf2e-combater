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
  if (step?.requiresTarget === true) merged.requiresTarget = true;
  return merged;
}

function swapChoiceIds(action, rowsKey, idsKey) {
  const profile = action?.activityProfile ?? {};
  const rows = Array.isArray(profile[rowsKey]) ? profile[rowsKey] : [];
  const ids = rows.map((row) => row?.id ?? row).filter(Boolean);
  if (ids.length) return ids.map(String);
  return (Array.isArray(profile[idsKey]) ? profile[idsKey] : []).filter(Boolean).map(String);
}

function needsSwapItemsChoice(step, action) {
  if (action?.executable !== "swap-items" && action?.activityProfile?.swapsItems !== true) return false;
  const heldIds = swapChoiceIds(action, "heldItems", "heldItemIds");
  const drawIds = swapChoiceIds(action, "drawableItems", "drawableItemIds");
  if (heldIds.length <= 1 && drawIds.length <= 1) return false;
  return !heldIds.includes(String(step?.swapHeldItemId ?? ""))
    || !drawIds.includes(String(step?.swapDrawItemId ?? ""));
}

export function executionReadinessForStep(step, action = step?.action ?? step) {
  const resolvedAction = executionAction(step, action);
  const choices = [];
  if (requiresDestinationForAction(resolvedAction) && !destinationFromStep(step)) choices.push("destination");
  if (requiresTargetForAction(resolvedAction) && !resolveTarget(step, resolvedAction)) choices.push("target");
  if (needsAreaChoiceForExecution(step, resolvedAction)) choices.push("area");
  if (needsSwapItemsChoice(step, resolvedAction)) choices.push("swap-items");
  const choiceLabels = choices.map((choice) => t(`Choice.${choice}`, choice));
  return {
    status: choices.length ? "needs-choice" : "ready",
    choices,
    warning: choices.length === 1 && choices[0] === "swap-items"
      ? t("Exec.ChooseSwapItems", "Choose items to swap.")
      : choices.length ? t("Exec.ChooseAtExec", "Choose {choices} at execution.", { choices: choiceLabels.join(", ") }) : "",
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
