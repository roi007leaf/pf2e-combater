import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { SETTINGS, setting } from "../settings.js";
import { buildCandidates } from "../engine/candidates.js";
import { confidenceLabel } from "../engine/confidence.js";
import { bestTurnPlan, buildTurnPlans } from "../engine/planner.js";
import { readCombatContext } from "../state/combat-context.js";
import { clearMovementPreview, showMovementPreview } from "./movement-preview.js";
import { selectableAlternativePlans, selectDisplayPlan } from "./plan-selection.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DEFAULT_TAB = "plan";
const TABS = new Set(["plan", "alternatives", "debug"]);
const RESET_PIN_REFRESH_SOURCES = new Set([
  "actor-update",
  "button",
  "combat-turn",
  "item-create",
  "item-delete",
  "item-update",
  "target-change",
  "token-refresh",
  "token-update",
]);

function readSetting(key, fallback) {
  try {
    return setting(key);
  } catch (_error) {
    return fallback;
  }
}

function readPanelState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.panelState) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writePanelState(patch) {
  try {
    localStorage.setItem(STORAGE_KEYS.panelState, JSON.stringify({ ...readPanelState(), ...patch }));
  } catch (_error) {
    // Some browser privacy modes deny storage; panel still works without persistence.
  }
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function camelCase(value) {
  return String(value ?? "").replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function actionCostClass(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  return `cost-${Math.max(1, Math.min(3, Number(cost) || 1))}`;
}

function actionCostLabel(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  const numeric = Math.max(1, Math.min(3, Number(cost) || 1));
  return `${numeric} action${numeric === 1 ? "" : "s"}`;
}

function actionDiamonds(cost) {
  if (cost === "reaction") return ["R"];
  if (cost === 0) return ["F"];
  return Array.from({ length: Math.max(1, Math.min(3, Number(cost) || 1)) }, () => "◆");
}

function stepTraitSlugs(step) {
  const traits = Array.isArray(step?.traits) ? step.traits : [];
  return traits.map((trait) => String(trait?.slug ?? trait?.name ?? trait).toLowerCase());
}

function isRangedStep(step) {
  if (!step) return false;
  const increment = Number(step?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return true;

  const traits = stepTraitSlugs(step);
  if (traits.includes("ranged")) return true;

  // A thrown weapon's melee Strike is not ranged (max reach 5 ft); it only
  // counts as ranged when the Strike actually reaches beyond melee.
  const max = Number(step?.range?.max ?? step?.targetingProfile?.maxRange);
  const isThrown = traits.some((trait) => /^thrown(-\d+)?$/.test(trait));
  return isThrown && Number.isFinite(max) && max > 5;
}

function rangeLabelFor(step) {
  if (!isRangedStep(step)) return "";
  const max = Number(step?.range?.max ?? step?.range?.increment ?? step?.targetingProfile?.maxRange);
  return Number.isFinite(max) && max > 0 ? `Ranged ${max} ft` : "Ranged";
}

function decorateStep(step, index) {
  const cost = step?.actionCost ?? 1;
  const targetName = step?.suggestedTarget?.name ?? "";
  const rangeLabel = rangeLabelFor(step);
  return {
    ...step,
    index,
    costClass: actionCostClass(cost),
    costLabel: actionCostLabel(cost),
    diamonds: actionDiamonds(cost),
    reason: step?.reason ?? step?.reasons?.[0] ?? "",
    targetLabel: targetName ? `Target: ${targetName}` : "",
    mapLabel: step?.mapPenalty > 0 ? `MAP -${step.mapPenalty}` : "",
    isRanged: Boolean(rangeLabel),
    rangeLabel,
    sourceLabel: titleCase(step?.source),
  };
}

function decoratePlan(plan, index = 0) {
  const confidence = plan?.confidence ?? "low";
  return {
    ...plan,
    index,
    rank: index + 1,
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
    steps: (plan?.steps ?? []).map((step, stepIndex) => decorateStep(step, stepIndex)),
    reason: plan?.reason ?? plan?.steps?.[0]?.reason ?? "No recommendation available.",
  };
}

function debugAction(action, index) {
  const profileParts = action?.activityProfile
    ? Object.entries(action.activityProfile)
      .filter(([, value]) => value === true || Number.isFinite(value))
      .map(([key, value]) => value === true ? camelCase(key) : `${camelCase(key)}:${value}`)
    : [];
  const skillCheckLabel = action?.skillCheck?.label ?? "";
  if (skillCheckLabel) profileParts.push(skillCheckLabel);
  return {
    index,
    name: action?.name ?? "Unknown action",
    slug: action?.slug ?? "",
    source: action?.source ?? "",
    role: action?.role ?? "",
    profile: profileParts.join(", "),
    skillCheckLabel,
    available: action?.available !== false,
    score: Number.isFinite(action?.score) ? action.score : null,
    costLabel: actionCostLabel(action?.actionCost ?? 1),
    targetLabel: action?.suggestedTarget?.name ?? "",
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
  };
}

async function renderSheet(document) {
  const sheet = document?.sheet;
  if (!sheet?.render) return false;
  await sheet.render(true);
  return true;
}

function escapeHtml(value) {
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

async function createGuidance(step, actor) {
  const message = `<strong>${escapeHtml(step?.name ?? "Recommended action")}</strong><br>${escapeHtml(step?.reason ?? "Review this recommendation before acting.")}`;
  const userId = game?.user?.id;

  if (globalThis.ChatMessage?.create && userId) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content: message,
      whisper: [userId],
    });
    return;
  }

  globalThis.ui?.notifications?.info?.(`${step?.name ?? "Recommended action"}: ${step?.reason ?? "Review recommendation."}`);
}


class CombaterPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-panel`,
    classes: [MODULE_ID, "combater-panel"],
    tag: "aside",
    window: {
      frame: true,
      icon: "fa-solid fa-crosshairs",
      positioned: true,
      resizable: true,
    },
    position: {
      width: 420,
      height: "auto",
    },
  };

  get title() {
    const actorName = this._context?.actor?.name;
    return actorName ? `PF2e Combater - ${actorName}` : "PF2e Combater";
  }

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/combater-panel.hbs`,
    },
  };

  constructor(options = {}) {
    super(options);
    const state = readPanelState();
    this.refreshSource = options.refreshSource ?? "manual";
    this.expanded = typeof state.expanded === "boolean"
      ? state.expanded
      : !readSetting(SETTINGS.compactDefault, true);
    this.activeTab = TABS.has(state.activeTab) ? state.activeTab : DEFAULT_TAB;
    this._context = null;
    this._candidates = [];
    this._rejected = [];
    this._detected = [];
    this._plans = [];
    this._plan = null;
    this._pinnedPlanId = null;
    this._expandedAltId = null;
    this._restoredPosition = false;
  }

  async refresh(refreshSource = "manual") {
    this.refreshSource = refreshSource;
    if (RESET_PIN_REFRESH_SOURCES.has(refreshSource)) this._pinnedPlanId = null;
    clearMovementPreview();
    await this.render({ force: true });
  }

  async _prepareContext(options) {
    await super._prepareContext(options);

    const context = readCombatContext(this.refreshSource);
    this._context = context;

    if (!context) {
      this._candidates = [];
      this._rejected = [];
      this._detected = [];
      this._plans = [];
      this._plan = null;
      return this._viewContext(null);
    }

    const { candidates, rejected, detected } = buildCandidates(context);
    const plans = buildTurnPlans(context, candidates);
    const plan = selectDisplayPlan(plans, this._pinnedPlanId) ?? bestTurnPlan(context, candidates);

    this._candidates = candidates;
    this._rejected = rejected;
    this._detected = detected;
    this._plans = plans;
    this._plan = plan;

    return this._viewContext(context);
  }

  _viewContext(context) {
    const showDebug = Boolean(game?.user?.isGM && readSetting(SETTINGS.showDebugTab, false));
    if (!showDebug && this.activeTab === "debug") this.activeTab = DEFAULT_TAB;

    const plan = decoratePlan(this._plan, 0);
    const alternatives = selectableAlternativePlans(this._plans, this._plan)
      .slice(0, 6)
      .map((candidatePlan, index) => ({
        ...decoratePlan(candidatePlan, index + 1),
        detailsExpanded: candidatePlan?.id === this._expandedAltId,
      }));

    return {
      actor: context?.actor ?? null,
      token: context?.token ?? null,
      plan,
      alternatives,
      expanded: this.expanded,
      activeTab: this.activeTab,
      activeTabPlan: this.activeTab === "plan",
      activeTabAlternatives: this.activeTab === "alternatives",
      activeTabDebug: this.activeTab === "debug",
      showDebug,
      hasContext: Boolean(context),
      refreshSource: this.refreshSource,
      debug: {
        candidates: this._candidates.map(debugAction),
        rejected: this._rejected.map((entry, index) => ({
          index,
          action: debugAction(entry?.action, index),
          reason: entry?.reason ?? "",
        })),
        detected: this._detected.map(debugAction),
        context,
      },
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    clearMovementPreview();
    this._restorePosition();

    const element = this.element;
    this._activateDrag(element);

    element.querySelector("[data-action='toggle-expanded']")
      ?.addEventListener("click", () => this._setExpanded(!this.expanded));
    element.querySelector("[data-action='refresh']")
      ?.addEventListener("click", () => this.refresh("button"));

    for (const button of element.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", () => this._setActiveTab(button.dataset.tab));
    }

    for (const button of element.querySelectorAll("[data-execute-step]")) {
      button.addEventListener("click", () => this.executeStep(Number(button.dataset.executeStep)));
    }

    for (const button of element.querySelectorAll("[data-execute-alt-step]")) {
      button.addEventListener("click", () =>
        this.executeAltStep(button.dataset.executeAltPlan, Number(button.dataset.executeAltStep)));
    }

    for (const previewElement of element.querySelectorAll("[data-preview-step]")) {
      previewElement.addEventListener("pointerenter", () => this._showMovementPreview(previewElement));
      previewElement.addEventListener("pointerleave", () => clearMovementPreview());
      previewElement.addEventListener("pointercancel", () => clearMovementPreview());
    }

    for (const promote of element.querySelectorAll("[data-promote-plan]")) {
      promote.addEventListener("click", () => this._promotePlan(promote.dataset.promotePlan));
    }

    for (const toggle of element.querySelectorAll("[data-toggle-alt]")) {
      toggle.addEventListener("click", (event) => {
        if (event.target.closest("[data-promote-plan]")) return;
        this._toggleAltDetails(toggle.dataset.toggleAlt);
      });
      toggle.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        if (event.target.closest("[data-promote-plan]")) return;
        event.preventDefault();
        this._toggleAltDetails(toggle.dataset.toggleAlt);
      });
    }

    if (readSetting(SETTINGS.rememberPanelPosition, true)) {
      element.addEventListener("pointerup", () => this._savePosition(), { passive: true });
    }
  }

  async close(options) {
    clearMovementPreview();
    return super.close(options);
  }

  _setExpanded(expanded) {
    this.expanded = expanded;
    writePanelState({ expanded });
    this.render({ force: true });
  }

  _setActiveTab(tab) {
    if (!TABS.has(tab)) return;
    this.activeTab = tab;
    writePanelState({ activeTab: tab });
    this.render({ force: true });
  }

  _promotePlan(planId) {
    if (!this._plans.some((plan) => plan?.id === planId)) return;
    this._pinnedPlanId = planId;
    this.activeTab = DEFAULT_TAB;
    writePanelState({ activeTab: DEFAULT_TAB });
    clearMovementPreview();
    this.render({ force: true });
  }

  _toggleAltDetails(planId) {
    if (!planId) return;
    this._expandedAltId = this._expandedAltId === planId ? null : planId;
    clearMovementPreview();
    this.render({ force: true });
  }

  _planForPreview(element) {
    const planId = element.dataset.previewPlan;
    if (!planId || planId === "main") return this._plan;
    return this._plans.find((plan) => plan?.id === planId) ?? null;
  }

  _showMovementPreview(element) {
    const plan = this._planForPreview(element);
    const step = plan?.steps?.[Number(element.dataset.previewStep)];
    showMovementPreview(this._context, step);
  }

  _restorePosition() {
    if (this._restoredPosition || !readSetting(SETTINGS.rememberPanelPosition, true)) return;
    this._restoredPosition = true;

    const { left, top } = readPanelState();
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;

    if (typeof this.setPosition === "function") {
      this.setPosition({ left, top });
      return;
    }

    this._moveTo(left, top);
  }

  _savePosition() {
    if (!readSetting(SETTINGS.rememberPanelPosition, true)) return;
    const box = this.element.getBoundingClientRect();
    writePanelState({
      left: Math.round(box.left),
      top: Math.round(box.top),
    });
  }

  _moveTo(left, top) {
    if (typeof this.setPosition === "function") {
      this.setPosition({ left, top });
      return;
    }

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  _activateDrag(element) {
    const handle = element.querySelector(".combater-compact");
    if (!handle) return;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button, a, input, select, textarea")) return;

      const startBox = element.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent) => {
        this._moveTo(
          Math.max(0, startBox.left + moveEvent.clientX - startX),
          Math.max(0, startBox.top + moveEvent.clientY - startY),
        );
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this._savePosition();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  async executeStep(index) {
    await this._executeStep(this._plan?.steps?.[index]);
  }

  async executeAltStep(planId, index) {
    const plan = this._plans.find((candidate) => candidate?.id === planId);
    await this._executeStep(plan?.steps?.[index]);
  }

  async _executeStep(step) {
    if (!step) return;

    // Combater is advisory only: show the action's details, never roll or execute
    // for the player. Open the item/spell/feat sheet when there is one; otherwise
    // post a short chat note describing the recommended action.
    const actor = this._context?.actor?.document;
    if (step.item && await renderSheet(step.item)) return;
    await createGuidance(step, actor);
  }
}

export async function openPanelForCurrentCombatant(activePanel, refreshSource = "manual") {
  if (activePanel) {
    await activePanel.refresh?.(refreshSource);
    return activePanel;
  }

  const panel = new CombaterPanel({ refreshSource });
  await panel.render({ force: true });
  return panel;
}

export async function togglePanelForCurrentCombatant(activePanel, refreshSource = "manual") {
  if (activePanel?.close) {
    await activePanel.close();
    return null;
  }

  return openPanelForCurrentCombatant(null, refreshSource);
}
