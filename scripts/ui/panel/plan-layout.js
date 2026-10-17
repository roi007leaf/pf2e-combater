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

  for (const toggle of element.querySelectorAll("[data-profile-menu-toggle]")) {
    bindPopoverMenu(element, toggle, toggle.parentElement?.querySelector("[data-profile-menu]"), { closeOn: "button" });
  }

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

  for (const button of element.querySelectorAll("[data-cycle-auto-fill-previous]")) {
    button.addEventListener("click", () => panel._cycleAutoFillDraft(-1));
  }

  // Minimal bar: tooltips open upward, so they never cover the bar's popovers below it.
  if (panel.expanded === false) {
    for (const node of element.querySelectorAll(".combater-compact [data-tooltip]:not([data-tooltip-direction])")) {
      node.dataset.tooltipDirection = "UP";
    }
  }

  // Minimal bar: right-click a plan chip for that step's buttons, as a tiny popover.
  for (const chip of element.querySelectorAll("[data-quick-step]")) {
    const tools = chip.parentElement?.querySelector("[data-quick-tools]");
    if (!tools) continue;
    chip.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // The chip's tooltip would sit on top of the row it opens.
      globalThis.game?.tooltip?.deactivate?.();
      tools.showPopover();
      const anchor = chip.getBoundingClientRect();
      const box = tools.getBoundingClientRect();
      const viewport = element.ownerDocument.defaultView;
      tools.style.left = `${Math.max(8, Math.min(anchor.left, viewport.innerWidth - box.width - 8))}px`;
      const below = anchor.bottom + 5;
      tools.style.top = `${below + box.height > viewport.innerHeight - 8 ? Math.max(8, anchor.top - box.height - 5) : below}px`;
      tools.querySelector("button:not(:disabled)")?.focus();
    });
    tools.addEventListener("click", (event) => {
      if (event.target.closest("button")) tools.hidePopover();
    });
    tools.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); tools.hidePopover(); chip.focus(); }
    });
  }

  // The full panel's footer and the minimal bar's play button both run the next step.
  for (const button of element.querySelectorAll("[data-run-next]")) {
    button.addEventListener("click", (event) => {
      panel._executeDraftStep(event.currentTarget.dataset.runNext, event);
    });
  }
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
