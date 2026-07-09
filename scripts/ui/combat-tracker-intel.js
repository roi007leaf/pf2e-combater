import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import { intelLedgerView, isNpcIntelTarget } from "../rules/intel-ledger.js";
import { playerAccessAllowed } from "../settings.js";
import { openIntelWindow } from "./intel-window.js";

const BUTTON_CLASS = `${MODULE_ID}-combatant-intel`;

function rootElement(html) {
  const HTMLElementCtor = globalThis.HTMLElement;
  if (typeof HTMLElementCtor !== "function") return null;
  if (html instanceof HTMLElementCtor) return html;
  if (html?.[0] instanceof HTMLElementCtor) return html[0];
  if (html?.element instanceof HTMLElementCtor) return html.element;
  return null;
}

function combatantList(combat) {
  return collectionValues(combat?.combatants);
}

function combatantById(combat, id) {
  if (!id) return null;
  return combat?.combatants?.get?.(id)
    ?? combatantList(combat).find((combatant) => String(combatant?.id) === String(id))
    ?? null;
}

function combatantToken(combatant) {
  return combatant?.token?.object
    ?? combatant?.token
    ?? combatant?.tokenDocument
    ?? combatant?.document?.token
    ?? null;
}

function combatantActor(combatant) {
  return combatant?.actor
    ?? combatant?.token?.actor
    ?? combatant?.token?.object?.actor
    ?? combatant?.tokenDocument?.actor
    ?? combatant?.document?.actor
    ?? null;
}

function tokenHidden(token) {
  const document = token?.document ?? token;
  return token?.hidden === true
    || document?.hidden === true
    || token?.visible === false
    || token?.isVisible === false;
}

function combatantHidden(combatant) {
  const document = combatant?.document ?? combatant;
  return combatant?.hidden === true || document?.hidden === true;
}

function playerCanSeeCombatant(combatant) {
  if (globalThis.game?.user?.isGM === true) return true;
  const token = combatantToken(combatant);
  const visible = typeof combatant?.visible === "boolean"
    ? combatant.visible
    : !combatantHidden(combatant);
  return visible && !tokenHidden(token);
}

function unknownCombatantName() {
  return globalThis.game?.i18n?.localize?.("COMBATANT.Unknown") || "Unknown";
}

function combatantNameIsHidden(combatant) {
  if (globalThis.game?.user?.isGM === true) return false;
  if (!globalThis.game?.pf2e?.settings?.tokens?.nameVisibility) return false;
  if (combatant?.playersCanSeeName === false) return true;
  const token = combatantToken(combatant);
  const document = token?.document ?? token;
  return document?.playersCanSeeName === false;
}

function rowCombatantName(row) {
  return String(row?.querySelector?.(".token-name .name, .combatant-name .name, .name")?.textContent ?? "")
    .trim();
}

function combatantDisplayName(combatant, row = null) {
  const visibleRowName = rowCombatantName(row);
  if (visibleRowName) return visibleRowName;
  if (combatantNameIsHidden(combatant)) return unknownCombatantName();
  const token = combatantToken(combatant);
  const document = token?.document ?? token;
  return combatant?.name ?? token?.name ?? document?.name ?? combatantActor(combatant)?.name ?? unknownCombatantName();
}

function intelTargetForCombatant(combatant, row = null) {
  const actor = combatantActor(combatant);
  const token = combatantToken(combatant);
  if (!actor) return null;
  return {
    id: combatant?.id ?? token?.id ?? actor.id,
    displayName: combatantDisplayName(combatant, row),
    name: combatantDisplayName(combatant, row),
    actor,
    token: {
      id: token?.id ?? token?.document?.id ?? null,
      img: combatant?.img ?? token?.document?.texture?.src ?? token?.texture?.src ?? actor.img ?? "",
    },
  };
}

function combatantIntelView(combatant, row = null) {
  const target = intelTargetForCombatant(combatant, row);
  if (!target || !isNpcIntelTarget(target) || !playerCanSeeCombatant(combatant)) return null;
  const view = intelLedgerView({
    isGM: globalThis.game?.user?.isGM === true,
    intelTargets: [target],
  });
  return view.visible && view.editable !== true && view.entries.some((entry) => entry.hasRevealed)
    ? view
    : null;
}

function rowCombatantId(row) {
  return row?.dataset?.combatantId
    ?? row?.getAttribute?.("data-combatant-id")
    ?? row?.querySelector?.("[data-combatant-id]")?.getAttribute?.("data-combatant-id")
    ?? null;
}

function activeCombatTrackerCombat() {
  return globalThis.ui?.combat?.viewed ?? globalThis.ui?.combat?.combat ?? globalThis.game?.combat ?? null;
}

function currentCombatTrackerRow(combatantId) {
  const root = rootElement(globalThis.ui?.combat?.element) ?? globalThis.document?.querySelector?.("#combat-tracker, #combat");
  if (!root) return null;
  return Array.from(root.querySelectorAll("[data-combatant-id], li.combatant"))
    .find((row) => String(rowCombatantId(row)) === String(combatantId)) ?? null;
}

function combatantIntelViewById(combatantId) {
  const combat = activeCombatTrackerCombat();
  return combatantIntelView(combatantById(combat, combatantId), currentCombatTrackerRow(combatantId));
}

function insertButton(row, view, combatantId) {
  row.querySelector(`.${BUTTON_CLASS}`)?.remove();
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.tooltip = view.tooltip;
  button.setAttribute("aria-label", t("Intel.PlayerTooltip", "View Recall Knowledge facts the GM has revealed."));
  button.innerHTML = `<i class="fa-solid fa-brain"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openIntelWindow(view, { mode: "view", viewProvider: () => combatantIntelViewById(combatantId) });
  });

  const target = row.querySelector(".combatant-controls, .combatant-name, .token-name, .token-initiative") ?? row;
  target.append(button);
}

function decorateCombatTracker(app, html) {
  if (globalThis.game?.user?.isGM === true) return;
  if (!playerAccessAllowed()) return;
  const root = rootElement(html) ?? rootElement(app?.element);
  if (!root) return;
  const combat = app?.viewed ?? app?.combat ?? globalThis.game?.combat ?? null;
  const seen = new Set();
  for (const row of root.querySelectorAll("[data-combatant-id], li.combatant")) {
    const id = rowCombatantId(row);
    if (!id || seen.has(String(id))) continue;
    seen.add(String(id));
    const combatant = combatantById(combat, id);
    const view = combatantIntelView(combatant, row);
    if (view) insertButton(row, view, id);
    else row.querySelector(`.${BUTTON_CLASS}`)?.remove();
  }
}

export function registerCombatTrackerIntel() {
  Hooks.on("renderCombatTracker", decorateCombatTracker);
}
