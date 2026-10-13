import { t } from "../../i18n.js";
import { bindPopoverMenu } from "./utility-menu.js";

function draftStep(panel, instanceId) {
  return (panel._builder?.draft?.steps ?? []).find((step) => step?.instanceId === instanceId) ?? null;
}

function pendingRunnableIds(panel) {
  return (panel._builder?.draft?.steps ?? [])
    .filter((step) => step?.instanceId && step.canShowExecuteStep && !step.isExecutionDone && !step.quickenedNextTurn)
    .map((step) => step.instanceId);
}

// Executes the remaining steps in order. Each step re-reads the live draft, so a
// step that opens a choice, waits for the GM, or fails stops the run there.
async function runAll(panel, event) {
  const seen = new Set();
  for (;;) {
    const [instanceId] = pendingRunnableIds(panel).filter((id) => !seen.has(id));
    if (!instanceId) return;
    seen.add(instanceId);
    const before = draftStep(panel, instanceId);
    if (before?.executionBlocked) return;
    await panel._executeDraftStep(instanceId, event);
    if (draftStep(panel, instanceId)?.isExecutionDone !== true) return;
  }
}

export function activatePlanLayoutBindings(panel, element) {
  panel._openStepTools ??= new Set();

  bindPopoverMenu(element, element.querySelector("[data-profile-menu-toggle]"), element.querySelector("[data-profile-menu]"),
    { closeOn: "button" });

  // Budget steppers re-render the panel; reopen the popover so repeated clicks work.
  const adjustToggle = element.querySelector("[data-tracker-adjust-toggle]");
  const adjustMenu = element.querySelector("[data-tracker-adjust-menu]");
  const adjust = bindPopoverMenu(element, adjustToggle, adjustMenu, { closeOn: null });
  adjustMenu?.addEventListener("toggle", () => { panel._trackerAdjustOpen = adjustMenu.matches(":popover-open"); });
  if (adjust && panel._trackerAdjustOpen && adjustToggle?.isConnected) adjust.open();

  const pips = Array.from(element.querySelectorAll("[data-pip]"));
  const light = (slots) => {
    const lit = new Set(String(slots ?? "").split(" ").filter(Boolean));
    for (const pip of pips) pip.classList.toggle("is-lit", lit.has(pip.dataset.pip));
  };
  for (const row of element.querySelectorAll("[data-step-pips]")) {
    row.addEventListener("pointerenter", () => light(row.dataset.stepPips));
    row.addEventListener("pointerleave", () => light(""));
    row.addEventListener("focusin", () => light(row.dataset.stepPips));
    row.addEventListener("focusout", () => light(""));
  }

  for (const button of element.querySelectorAll("[data-step-more]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.stepMore;
      const row = button.closest(".combater-header-step");
      const open = !row?.classList.contains("is-tools-open");
      row?.classList.toggle("is-tools-open", open);
      button.setAttribute("aria-expanded", String(open));
      if (open) panel._openStepTools.add(id);
      else panel._openStepTools.delete(id);
    });
  }

  element.querySelector("[data-cycle-auto-fill-previous]")
    ?.addEventListener("click", () => panel._cycleAutoFillDraft(-1));

  element.querySelector("[data-run-next]")?.addEventListener("click", (event) => {
    panel._executeDraftStep(event.currentTarget.dataset.runNext, event);
  });
  const runAllButton = element.querySelector("[data-run-all]");
  runAllButton?.addEventListener("click", async (event) => {
    if (panel._runAllInFlight) return;
    panel._runAllInFlight = true;
    runAllButton.disabled = true;
    try {
      await runAll(panel, event);
    } catch (error) {
      globalThis.ui?.notifications?.warn?.(error?.message ?? t("Panel.RunAllFailed", "Run all stopped."));
    } finally {
      panel._runAllInFlight = false;
      if (runAllButton.isConnected) runAllButton.disabled = false;
    }
  });
}
