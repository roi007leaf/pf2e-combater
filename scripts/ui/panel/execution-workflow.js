import { executeDraftStep } from "../../engine/action/executor.js";
import { executionReadinessForStep } from "../../engine/execution/state.js";
import { revertDraftExecution, revertDraftStep } from "../../engine/action/revert.js";
import { readSustainedSpellEntries } from "../../engine/sustained-spells.js";
import { promptRetchDc, promptRetchResult } from "../../rules/retch-decision.js";
import { requestRetchDc, requestRetchResult } from "../../socket.js";
import { clearActionPreview } from "../action/preview.js";
import { isSustainAction, sustainedSpellDraftFields } from "./view-model.js";
import { t } from "../../i18n.js";

function escapeHtml(value) {
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

export async function chooseSustainedSpellForStep(panel, step) {
  if (!panel._context || !step?.instanceId) return null;
  const entries = readSustainedSpellEntries(panel._context, undefined, panel._readActiveDraftPlan())
    .filter((entry) => entry.planned !== true && entry.sustained !== true);
  if (!entries.length) {
    globalThis.ui?.notifications?.warn?.(t("Notify.NoSustainNeeded", "No sustained spells need sustaining."));
    return null;
  }

  let selected = entries[0];
  if (entries.length > 1) {
    const dialog = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof dialog?.wait !== "function") {
      globalThis.ui?.notifications?.warn?.(t("Notify.ChooseSustainFirst", "Choose a spell from the Sustained spells section first."));
      return null;
    }
    const choice = await dialog.wait({
      window: { title: t("Dialog.SustainSpell.Title", "Sustain a Spell") },
      content: `<p>${escapeHtml(t("Dialog.SustainSpell.Content", "Choose which sustained spell to sustain."))}</p>`,
      buttons: [
        ...entries.map((entry) => ({
          action: entry.id,
          label: escapeHtml(entry.name),
        })),
        { action: "cancel", label: t("Dialog.Cancel", "Cancel") },
      ],
      rejectClose: false,
    }).catch(() => "cancel");
    if (!choice || choice === "cancel") return null;
    selected = entries.find((entry) => entry.id === choice) ?? null;
    if (!selected) return null;
  }

  const current = panel._findActiveStep(step.instanceId) ?? step;
  const nextStep = panel._stepWithRetryReset(current, { sustainedSpell: sustainedSpellDraftFields(selected) });
  await panel._persistActiveDraftStep(nextStep);
  return {
    ...step,
    sustainedSpell: sustainedSpellDraftFields(selected),
  };
}

export async function executePanelDraftStep(panel, instanceId, event) {
  try {
    if (!panel._canExecuteDraft()) return;
    let step = panel._findDraftStep(instanceId);
    if (!panel._context || !step || step.executionStatus === "done") return;

    const action = step.action ?? step;
    if (isSustainAction(action) && !step.sustainedSpell) {
      step = await chooseSustainedSpellForStep(panel, step);
      if (!step) return;
    }

    const readiness = executionReadinessForStep(step, action);
    if (readiness.choices.length) {
      globalThis.ui?.notifications?.warn?.(readiness.warning || t("Notify.ResolveChoices", "Resolve required choices before executing."));
      return;
    }

    clearActionPreview();
    const result = await executeDraftStep({
      context: panel._contextForDraftStep(step.instanceId) ?? panel._context,
      step,
      action,
      event,
    });
    await applyPanelExecutionResult(panel, step, result, event);
  } catch (error) {
    globalThis.console?.error?.("pf2e-combater | Execute step failed", error);
    globalThis.ui?.notifications?.error?.(t("Notify.ExecuteFailed", "Could not execute the step; see the console."));
  }
}

export function handlePanelExecutionChoice(panel, step, choice, event, result = null) {
  if (choice === "destination") {
    panel._chooseDestination(step.instanceId);
    return true;
  }
  if (choice === "target") {
    panel._chooseTarget(step.instanceId);
    return true;
  }
  if (choice === "area") {
    panel._chooseArea(step.instanceId);
    return true;
  }
  if (choice === "retch-dc") {
    providePanelRetchDc(panel, step, event);
    return true;
  }
  if (choice === "retch-result") {
    confirmPanelRetchResult(panel, step, event, result?.rolled ?? null);
    return true;
  }
  return false;
}

export function retchActorName(panel) {
  return panel._context?.actor?.name ?? panel._context?.combatant?.name ?? null;
}

export async function setPanelAwaitingGm(panel, instanceId, on) {
  if (!instanceId) return;
  const before = panel._awaitingGm.has(instanceId);
  if (on) panel._awaitingGm.add(instanceId);
  else panel._awaitingGm.delete(instanceId);
  if (panel._awaitingGm.has(instanceId) !== before) await panel.render({ force: true });
}

export async function providePanelRetchDc(panel, step, event) {
  try {
    const actorName = retchActorName(panel);
    let dc;
    if (game?.user?.isGM === true) {
      dc = await promptRetchDc({ actorName });
    } else {
      globalThis.ui?.notifications?.info?.(t("Notify.WaitingRetchDcGM", "Waiting for the GM to set the Retch save DC."));
      await setPanelAwaitingGm(panel, step.instanceId, true);
      try {
        dc = await requestRetchDc({ actorName });
      } finally {
        await setPanelAwaitingGm(panel, step.instanceId, false);
      }
      if (dc == null) dc = await promptRetchDc({ actorName });
    }
    if (!Number.isFinite(dc)) return;
    const result = await executeDraftStep({
      context: panel._contextForDraftStep(step.instanceId) ?? panel._context,
      step,
      action: step.action ?? step,
      event,
      choices: { dc },
    });
    await applyPanelExecutionResult(panel, step, result, event);
  } catch (error) {
    globalThis.console?.error?.("pf2e-combater | Retch DC step failed", error);
    globalThis.ui?.notifications?.error?.(t("Notify.RetchFailed", "Retch could not be resolved; see the console."));
  }
}

export async function confirmPanelRetchResult(panel, step, event, rolled) {
  try {
    const actorName = retchActorName(panel);
    let decision;
    if (game?.user?.isGM === true) {
      decision = await promptRetchResult({ actorName, rolled });
    } else {
      globalThis.ui?.notifications?.info?.(t("Notify.WaitingRetchGM", "Waiting for the GM to judge your Retch save."));
      await setPanelAwaitingGm(panel, step.instanceId, true);
      try {
        decision = await requestRetchResult({ actorName, rolled });
      } finally {
        await setPanelAwaitingGm(panel, step.instanceId, false);
      }
      if (decision === null) decision = await promptRetchResult({ actorName, rolled });
    }
    if (!decision) return;
    const result = await executeDraftStep({
      context: panel._contextForDraftStep(step.instanceId) ?? panel._context,
      step,
      action: step.action ?? step,
      event,
      choices: { retchSucceeded: decision.succeeded === true, retchCritical: decision.critical === true },
    });
    await applyPanelExecutionResult(panel, step, result, event);
  } catch (error) {
    globalThis.console?.error?.("pf2e-combater | Retch result step failed", error);
    globalThis.ui?.notifications?.error?.(t("Notify.RetchFailed", "Retch could not be resolved; see the console."));
  }
}

export async function applyPanelExecutionResult(panel, step, result, event) {
  if (result?.status === "needs-choice") {
    handlePanelExecutionChoice(panel, step, result.choices?.[0], event, result);
    return;
  }
  if (!result || result.status === "cancelled") return;
  if (!panel._context || !step?.instanceId) return;

  const current = panel._findActiveStep(step.instanceId) ?? step;
  await panel._persistActiveDraftStep({ ...current, ...(result.patch ?? {}) });
  clearActionPreview();
  if (result.status === "failed" && result.error) globalThis.ui?.notifications?.warn?.(result.error);
  await panel.render({ force: true });
}

export async function revertPanelDraftStep(panel, instanceId) {
  if (!panel._canExecuteDraft() || !panel._context) return;
  const current = panel._findActiveStep(instanceId);
  if (!current || current?.execution?.status !== "done") return;
  const result = await revertDraftStep({
    context: panel._contextForDraftStep(instanceId) ?? panel._context,
    step: current,
  });
  await panel._persistActiveDraftStep({ ...current, ...(result.patch ?? {}) });
  clearActionPreview();
  for (const warning of result.warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
  await panel.render({ force: true });
}

export async function resetPanelExecution(panel) {
  if (!panel._canExecuteDraft() || !panel._context) return;
  const { draft, warnings } = await revertDraftExecution({
    context: panel._context,
    draft: panel._readActiveDraftPlan(),
    contextForStep: (step) => panel._contextForDraftStep(step?.instanceId) ?? panel._context,
  });
  await panel._writeActiveDraftPlan(draft);
  for (const warning of warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
  await panel.render({ force: true });
}
