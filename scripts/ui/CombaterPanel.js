import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { SETTINGS, setting } from "../settings.js";
import { buildActionBuilderModel, actionBuilderKey, ACTION_BUILDER_TABS } from "../engine/action-builder.js";
import { buildCandidates } from "../engine/candidates.js";
import { confidenceLabel } from "../engine/confidence.js";
import { bestTurnPlan, buildTurnPlans } from "../engine/planner.js";
import { readActionFavorites, toggleActionFavorite } from "../state/action-favorites.js";
import { readCombatContext } from "../state/combat-context.js";
import { readDraftPlan, writeDraftPlan, upsertDraftStep, removeDraftStep } from "../state/draft-plans.js";
import { clearMovementPreview, showMovementPreview } from "./movement-preview.js";
import { displayStepEntries } from "./display-steps.js";
import { selectDisplayPlan } from "./plan-selection.js";
import { chooseDestination } from "./destination-picker.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DEFAULT_TAB = "one";
const TABS = new Set(ACTION_BUILDER_TABS.map((tab) => tab.id));
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

function movementIncludes(action, value) {
  return Array.isArray(action?.activityProfile?.includes)
    && action.activityProfile.includes.map((entry) => String(entry).toLowerCase()).includes(value);
}

function isMovementAction(action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  const source = String(action?.source ?? "").toLowerCase();
  const role = String(action?.role ?? "").toLowerCase();
  return action?.requiresDestination === true
    || slug === "stride"
    || slug === "step"
    || source === "movement"
    || role === "movement"
    || movementIncludes(action, "move")
    || Number(action?.activityProfile?.strideCount) > 0;
}

function withBuilderActionFields(action) {
  if (!action || action.requiresDestination === true || !isMovementAction(action)) return action;
  return { ...action, requiresDestination: true };
}

function destinationLabel(destination) {
  const x = Number(destination?.x);
  const y = Number(destination?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
  return `Destination: ${Math.round(x)}, ${Math.round(y)}`;
}

function draftStepId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `draft-step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function decorateStep(step, displayIndex, sourceIndex = displayIndex) {
  const cost = step?.actionCost ?? step?.cost ?? 1;
  const targetName = step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
  const rangeLabel = rangeLabelFor(step);
  return {
    ...step,
    index: sourceIndex,
    displayIndex,
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
  const steps = displayStepEntries(plan?.steps)
    .map((entry, stepIndex) => decorateStep(entry.step, stepIndex, entry.sourceIndex));
  return {
    ...plan,
    index,
    rank: index + 1,
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
    steps,
    hasSteps: steps.length > 0,
    reason: plan?.reason ?? plan?.steps?.[0]?.reason ?? "No recommendation available.",
  };
}

function decorateAction(action) {
  const cost = action?.actionCost ?? action?.cost ?? 1;
  const decorated = decorateStep(action, 0, 0);
  return {
    ...decorated,
    favoriteTitle: action?.favorite ? "Remove favorite" : "Add favorite",
    disabledTitle: action?.disabled ? action.disabledReason : "Add to draft",
    requiresDestination: isMovementAction(action),
  };
}

function decorateDraftStep(step, index) {
  const action = step?.action ? decorateAction(step.action) : null;
  const plannedCost = step?.actionCost ?? step?.cost ?? action?.actionCost ?? action?.cost;
  const displaySource = action
    ? { ...action, actionCost: plannedCost, cost: plannedCost }
    : step;
  const display = decorateStep(displaySource, index, index);
  const requiresDestination = isMovementAction(action ?? step);
  return {
    ...display,
    ...step,
    action,
    displayIndex: index,
    position: index + 1,
    instanceId: step?.instanceId,
    name: action?.name ?? step?.name ?? step?.actionKey ?? "Unknown action",
    reason: action?.reason ?? step?.reason ?? "",
    targetLabel: action?.targetLabel ?? "",
    requiresDestination,
    destinationLabel: destinationLabel(step?.destination),
    warning: step?.warning === "Choose a destination." ? "Choose destination." : step?.warning,
  };
}

function decorateBuilderTab(tab, activeTab) {
  const sections = [
    { id: "favorites", label: "Favorites", actions: tab.favorites.map(decorateAction) },
    { id: "recommended", label: "Recommended", actions: tab.recommended.map(decorateAction) },
    { id: "all", label: "All", actions: tab.all.map(decorateAction) },
  ];
  return {
    ...tab,
    active: tab.id === activeTab,
    sections: sections.map((section) => ({
      ...section,
      hasActions: section.actions.length > 0,
    })),
  };
}

function decorateBuilder(builder, activeTab) {
  if (!builder) return null;
  const draftSteps = (builder.draft?.steps ?? []).map(decorateDraftStep);
  const active = TABS.has(activeTab) ? activeTab : DEFAULT_TAB;
  return {
    ...builder,
    tabsList: ACTION_BUILDER_TABS.map((tab) => decorateBuilderTab(builder.tabs[tab.id], active)),
    activeTab: active,
    activeTabLabel: ACTION_BUILDER_TABS.find((tab) => tab.id === active)?.label ?? "1 Action",
    draft: {
      ...(builder.draft ?? {}),
      steps: draftSteps,
      hasSteps: draftSteps.length > 0,
      countLabel: draftSteps.length ? `${draftSteps.length} step${draftSteps.length === 1 ? "" : "s"}` : "Empty",
      confidenceClass: draftSteps.length ? "medium" : "low",
      warnings: [...new Set(draftSteps.map((step) => step.warning).filter(Boolean))],
    },
    poolSummary: `${builder.remainingNormalActions} normal action${builder.remainingNormalActions === 1 ? "" : "s"} left`,
    totalSummary: `${builder.remainingTotalActions} total action${builder.remainingTotalActions === 1 ? "" : "s"} left`,
    reactionSummary: builder.usage?.reaction ? "Reaction planned" : "Reaction open",
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

async function confirmReplaceDraft() {
  const message = "Replace current draft with Auto-fill plan?";
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (dialog?.confirm) {
    return dialog.confirm({
      window: { title: "Replace draft" },
      content: `<p>${escapeHtml(message)}</p>`,
      yes: { label: "Replace" },
      no: { label: "Cancel" },
    });
  }
  return globalThis.window?.confirm?.(message) ?? true;
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
    this._builder = null;
    this._pinnedPlanId = null;
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
      this._builder = null;
      return this._viewContext(null);
    }

    const { candidates, rejected, detected } = buildCandidates(context);
    const builderCandidates = candidates.map(withBuilderActionFields);
    const plans = buildTurnPlans(context, builderCandidates);
    const plan = selectDisplayPlan(plans, this._pinnedPlanId) ?? bestTurnPlan(context, builderCandidates);
    const draft = readDraftPlan(context);
    const favorites = readActionFavorites(context);

    this._candidates = builderCandidates;
    this._rejected = rejected;
    this._detected = detected;
    this._plans = plans;
    this._plan = plan;
    this._builder = decorateBuilder(buildActionBuilderModel({
      context,
      candidates: builderCandidates,
      plans: plan ? [plan] : plans,
      draft,
      favorites,
    }), this.activeTab);

    return this._viewContext(context);
  }

  _viewContext(context) {
    const showDebug = Boolean(game?.user?.isGM && readSetting(SETTINGS.showDebugTab, false));
    const autoFill = decoratePlan(this._builder?.autoFill ?? this._plan, 0);
    const draftSteps = this._builder?.draft?.steps ?? [];
    const headerSteps = draftSteps.length ? draftSteps : autoFill.steps;
    const headerMode = draftSteps.length ? "Draft" : "Auto-fill";

    return {
      actor: context?.actor ?? null,
      token: context?.token ?? null,
      plan: autoFill,
      headerSteps,
      headerMode,
      headerSummary: draftSteps.length
        ? `${draftSteps.length} selected step${draftSteps.length === 1 ? "" : "s"}`
        : autoFill.summary,
      builder: this._builder,
      expanded: this.expanded,
      activeTab: this.activeTab,
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

    for (const button of element.querySelectorAll("[data-add-action]")) {
      button.addEventListener("click", () => this._addAction(button.dataset.addAction));
    }

    for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
      button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
    }

    for (const button of element.querySelectorAll("[data-favorite-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._toggleFavorite(button.dataset.favoriteAction);
      });
    }

    for (const button of element.querySelectorAll("[data-auto-fill]")) {
      button.addEventListener("click", () => this._autoFillDraft());
    }

    for (const button of element.querySelectorAll("[data-choose-destination]")) {
      button.addEventListener("click", () => this._chooseDestination(button.dataset.chooseDestination));
    }

    for (const button of element.querySelectorAll("[data-open-action]")) {
      button.addEventListener("click", () => this._openBuilderAction(button.dataset.openAction));
    }

    for (const button of element.querySelectorAll("[data-open-draft-step]")) {
      button.addEventListener("click", () => this._openDraftStep(button.dataset.openDraftStep));
    }

    for (const button of element.querySelectorAll("[data-execute-step]")) {
      button.addEventListener("click", () => this.executeStep(Number(button.dataset.executeStep)));
    }

    for (const previewElement of element.querySelectorAll("[data-preview-step]")) {
      previewElement.addEventListener("pointerenter", () => this._showMovementPreview(previewElement));
      previewElement.addEventListener("pointerleave", () => clearMovementPreview());
      previewElement.addEventListener("pointercancel", () => clearMovementPreview());
    }

    for (const previewElement of element.querySelectorAll("[data-preview-draft-step]")) {
      previewElement.addEventListener("pointerenter", () => this._showDraftMovementPreview(previewElement));
      previewElement.addEventListener("pointerleave", () => clearMovementPreview());
      previewElement.addEventListener("pointercancel", () => clearMovementPreview());
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

  _findBuilderAction(actionKey) {
    if (!actionKey) return null;
    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((entry) => entry.key === actionKey);
      if (action) return action;
    }
    return null;
  }

  _findDraftStep(instanceId) {
    return this._builder?.draft?.steps?.find((step) => step.instanceId === instanceId) ?? null;
  }

  _draftHasManualSteps() {
    return (this._builder?.draft?.steps?.length ?? 0) > 0;
  }

  async _addAction(actionKey) {
    const action = this._findBuilderAction(actionKey);
    if (!this._context || !action || action.disabled) {
      if (action?.disabledReason) globalThis.ui?.notifications?.warn?.(action.disabledReason);
      return;
    }

    upsertDraftStep(this._context, {
      actionKey: action.key,
      actionCost: action.actionCost ?? action.cost,
      requiresDestination: isMovementAction(action),
    });
    clearMovementPreview();
    await this.render({ force: true });
  }

  async _removeDraftStep(instanceId) {
    if (!this._context || !instanceId) return;
    removeDraftStep(this._context, instanceId);
    clearMovementPreview();
    await this.render({ force: true });
  }

  async _toggleFavorite(actionKey) {
    if (!this._context || !actionKey) return;
    toggleActionFavorite(this._context, actionKey);
    await this.render({ force: true });
  }

  _actionKeyForStep(step) {
    const key = actionBuilderKey(step);
    const direct = this._findBuilderAction(key);
    if (direct) return direct.key;

    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((candidate) =>
        candidate.baseKey === key
        || candidate.slug === step?.slug
        || candidate.id === step?.id
        || candidate.item?.uuid === step?.item?.uuid);
      if (action) return action.key;
    }
    return key;
  }

  async _autoFillDraft() {
    const autoFill = this._builder?.autoFill;
    if (!this._context || !autoFill?.steps?.length) return;
    if (this._draftHasManualSteps() && !await confirmReplaceDraft()) return;

    const steps = autoFill.steps.map((step) => ({
      instanceId: draftStepId(),
      actionKey: this._actionKeyForStep(step),
      actionCost: step?.actionCost ?? step?.cost,
      requiresDestination: isMovementAction(step),
      ...(step?.destination ? { destination: step.destination } : {}),
    }));
    writeDraftPlan(this._context, { steps });
    clearMovementPreview();
    await this.render({ force: true });
  }

  _chooseDestination(instanceId) {
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) return;

    const picker = chooseDestination({
      onChoose: (destination) => {
        const current = readDraftPlan(this._context).steps.find((entry) => entry.instanceId === instanceId) ?? step;
        upsertDraftStep(this._context, { ...current, destination });
        clearMovementPreview();
        this.render({ force: true });
      },
    });
    if (!picker) globalThis.ui?.notifications?.warn?.("Canvas destination picker is not available.");
  }

  async _openBuilderAction(actionKey) {
    await this._executeStep(this._findBuilderAction(actionKey));
  }

  async _openDraftStep(instanceId) {
    const step = this._findDraftStep(instanceId);
    await this._executeStep(step?.action ?? step);
  }

  _planForPreview(element) {
    const planId = element.dataset.previewPlan;
    if (!planId || planId === "main" || planId === "auto") return this._builder?.autoFill ?? this._plan;
    return this._plans.find((plan) => plan?.id === planId) ?? null;
  }

  _showMovementPreview(element) {
    const plan = this._planForPreview(element);
    const step = plan?.steps?.[Number(element.dataset.previewStep)];
    showMovementPreview(this._context, step);
  }

  _showDraftMovementPreview(element) {
    const step = this._findDraftStep(element.dataset.previewDraftStep);
    if (!step?.action || !isMovementAction(step.action)) return;
    showMovementPreview(this._context, {
      ...step.action,
      destination: step.destination,
      requiresDestination: true,
    });
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
    await this._executeStep(this._builder?.autoFill?.steps?.[index] ?? this._plan?.steps?.[index]);
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
