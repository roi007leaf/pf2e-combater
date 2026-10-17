import { t } from "../../i18n.js";
import { bindPopoverMenu } from "./utility-menu.js";
import { chooseFinisher } from "../../integrations/animater.js";

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

// A finisher option click: Animater stores the pick on the item (or warns), then the plan redraws.
// A synthetic strike (no item uuid) is sent as { actor, name, slug }; Animater keeps it on the actor.
export async function chooseStepFinisher(panel, itemUuid, id, strike = null) {
  let item = null;
  try {
    item = itemUuid ? globalThis.fromUuidSync?.(itemUuid) ?? null : null;
    if (!item && !itemUuid && strike?.actorUuid && (strike.name || strike.slug)) {
      const actor = globalThis.fromUuidSync?.(strike.actorUuid) ?? null;
      item = actor ? { actor, name: strike.name || undefined, slug: strike.slug || undefined } : null;
    }
  } catch (_error) {
    item = null;
  }
  if (!item) return panel.render({ force: true });
  // Animater's hook and the item update redraw on success; only a refusal needs the redraw.
  if (await chooseFinisher(item, id || null)) return;
  await panel.render({ force: true });
}

export function activatePlanLayoutBindings(panel, element) {
  panel._openStepTools ??= new Set();

  bindPopoverMenu(element, element.querySelector("[data-profile-menu-toggle]"), element.querySelector("[data-profile-menu]"),
    { closeOn: "button" });

  for (const toggle of element.querySelectorAll("[data-finisher-menu-toggle]")) {
    const menu = toggle.parentElement?.querySelector("[data-finisher-menu]");
    bindPopoverMenu(element, toggle, menu, { closeOn: "button" });
    menu?.addEventListener("click", (event) => {
      const option = event.target.closest("[data-finisher-choice]");
      if (option) {
        const strike = { actorUuid: menu.dataset.finisherActor, name: menu.dataset.finisherStrikeName, slug: menu.dataset.finisherStrikeSlug };
        chooseStepFinisher(panel, menu.dataset.finisherItem, option.dataset.finisherChoice, strike)
          .catch((error) => console.warn("pf2e-combater | Finisher choice failed", error));
      }
    });
  }

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
