import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { SETTINGS, playerAccessAllowed, settingOrDefault } from "../settings.js";
import { projectContextForDraftDestination, SUSTAIN_A_SPELL_ACTION } from "../engine/action/builder/index.js";
import { requiresDestinationForAction } from "../engine/action/requirements.js";
import { buildCandidates } from "../engine/candidates.js";
import { actionBudget } from "../engine/action/budget.js";
import { buildTurnPlans } from "../engine/planner.js";
import { clearActionPreview, showActionPreview } from "./action/preview.js";
import { CombaterBrowser } from "./CombaterBrowser.js";
import { selectDisplayPlan } from "./plan-selection.js";
import {
  actionKeyForPanelStep,
  actorForPanelMovement,
  addPanelAction,
  addPanelSustainSpell,
  addPanelUncountedAction,
  atomizePanelAutoFillSteps,
  autoFillPanelDraft,
  choosePanelMinionDestination,
  choosePanelMinionTarget,
  cyclePanelAutoFillDraft,
  cyclePanelMinionPlanMovement,
  cyclePanelMinionPlanStep,
  cyclePanelStepMap,
  cyclePanelStepMovement,
  cyclePanelStepRoute,
  cyclePanelStepWeapon,
  duplicatePanelDraftStep,
  executePanelMinionPlanStep,
  fillPanelDraftGap,
  persistPanelActiveDraftStep,
  readPanelActiveDraftPlan,
  removePanelDraftStep,
  removePanelMinionPlanStep,
  reorderPanelDraftStep,
  reorderPanelFavorite,
  revertPanelMinionPlanStep,
  showPanelMinionActionPreview,
  syncPanelDraftToGM,
  togglePanelFavorite,
  writePanelActiveDraftPlan,
  writePanelActiveSharedDraft,
} from "./panel/draft-workflow.js";
import {
  draftForAutoFillGap,
  draftNormalActionCost,
  hasLockedDraftSteps,
} from "./panel/draft-helpers.js";
import { contextWithCurrentAutoFillTargets } from "./panel/auto-fill-context.js";
import {
  cancelPanelPickers,
  choosePanelArea,
  choosePanelDestination,
  choosePanelTarget,
  clearActionPreviewUnlessPicking,
  contextForDraftStep,
  draftForOrigin,
  pickAreaTemplate,
  removePanelAreaTemplate,
  restoreDestinationPickerPreview,
  showDestinationPickerPreview,
  showPanelHoverGhost,
  stepWithRetryReset,
} from "./panel/picker-workflow.js";
import {
  applyPanelExecutionResult,
  choosePanelSwapItems,
  chooseSustainedSpellForStep,
  confirmPanelRetchResult,
  executePanelDraftStep,
  handlePanelExecutionChoice,
  providePanelRetchDc,
  resetPanelExecution,
  retchActorName,
  revertPanelDraftStep,
  setPanelAwaitingGm,
} from "./panel/execution-workflow.js";
import { activatePanelRenderBindings } from "./panel/event-bindings.js";
import {
  panelIntelLedgerView,
  preparePanelContext,
  viewPanelContext,
} from "./panel/context-workflow.js";
import { openIntelWindow } from "./intel-window.js";
import { resetRecallKnowledgeAttemptsForTarget } from "./recall-knowledge.js";
import { openTacticWindow } from "./tactic-window.js";
import { isPlannableCombatant } from "../rules/actor-eligibility.js";
import {
  TACTIC_PERSONALITY_FLAG,
  TACTIC_PERSONALITY_OVERRIDE_FLAG,
  tacticPersonalityView,
} from "../rules/tactic-personality.js";
import {
  INTEL_LEDGER_FLAG,
  INTEL_FALSE_INFORMATION_FLAG,
  INTEL_REVEAL_MODE_FLAG,
  intelLedgerView,
  intelTargetMatchesKey,
  normalizeIntelFalseInformation,
} from "../rules/intel-ledger.js";
import { readCombatContext } from "../state/combat-context.js";
import { setPlanPreferenceFeedback } from "../state/preference-profile.js";
import {
  nextResourceHorizon,
  normalizeResourceHorizon,
} from "../rules/resource-horizon.js";
import {
  debugAction,
  DEFAULT_TAB,
  explicitTargetFields,
  isSustainAction,
  normalizedSlug,
  TABS,
  withBuilderActionFields,
} from "./panel/view-model.js";
import { pf2eActionName, t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RESET_PIN_REFRESH_SOURCES = new Set([
  "actor-update",
  "button",
  "combat-turn",
  "item-create",
  "item-delete",
  "item-update",
  "intel-update",
  "resource-horizon",
  "target-change",
  "tactic-update",
  "token-refresh",
  "token-update",
]);

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

// A generic Stride carries no target of its own, so the movement preview falls back to the first
// listed enemy. When the plan continues into an attack, the stride should instead close on the
// enemy that attack will hit. Borrow the next targeted step's resolved target so the recommended
// destination matches the strike (e.g. stride toward Alon when the plan is Stride -> Strike Alon).
// A generic basic move the planner scored negative (e.g. "repositioning is low priority" when the
// target is already in reach) wastes an action. Never auto-fill it, no matter which plan variant
// feeds the auto-fill (best plan, a pinned variant, or a projected-origin edge case).
async function renderSheet(document) {
  const sheet = document?.sheet;
  if (!sheet?.render) return false;
  await sheet.render(true);
  return true;
}

async function renderSheetFromUuid(uuid) {
  if (!uuid || typeof globalThis.fromUuid !== "function") return false;
  try {
    const document = await globalThis.fromUuid(uuid);
    return renderSheet(document);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to open action details`, error);
    return false;
  }
}

function escapeHtml(value) {
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

async function createGuidance(step, actor) {
  const name = step?.name ?? t("Guidance.RecommendedAction", "Recommended action");
  const reason = step?.reason ?? t("Guidance.ReviewRecommendation", "Review this recommendation before acting.");
  const message = `<strong>${escapeHtml(name)}</strong><br>${escapeHtml(reason)}`;
  const userId = game?.user?.id;

  if (globalThis.ChatMessage?.create && userId) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content: message,
      whisper: [userId],
    });
    return;
  }

  globalThis.ui?.notifications?.info?.(`${name}: ${step?.reason ?? t("Guidance.ReviewShort", "Review recommendation.")}`);
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
      width: 720,
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
      : !settingOrDefault(SETTINGS.compactDefault, true);
    this.activeTab = TABS.has(state.activeTab) ? state.activeTab : DEFAULT_TAB;
    this.searchQuery = typeof state.searchQuery === "string" ? state.searchQuery : "";
    this.resourceHorizon = normalizeResourceHorizon(state.resourceHorizon);
    this._context = null;
    this._planningContext = null;
    this._candidates = [];
    this._rejected = [];
    this._detected = [];
    this._plans = [];
    this._autoFillPlans = [];
    this._plan = null;
    this._builder = null;
    this._gmExecuteMode = false;
    this._sharedDraftSeed = null;
    this._destinationPicker = null;
    this._areaPicker = null;
    // Draft-step instanceIds currently blocked on a GM socket response (e.g. Retch DC/result), so
    // the step can show a "waiting for the GM" indicator. Transient, never persisted.
    this._awaitingGm = new Set();
    this._pinnedPlanId = null;
    // Separate pin for the fill-gap cycle (Auto-fill with manual steps already in the draft) --
    // its plan ids come from a different, remaining-budget candidate search, so they must never be
    // compared against/confused with the full-budget _pinnedPlanId ids.
    this._pinnedFillPlanId = null;
    this._autoFillInFlight = false;
    this._selectedCombatant = options.combatant ?? null;
    this._onClose = typeof options.onClose === "function" ? options.onClose : null;
    this._restoredPosition = false;
    this._browser = null;
    this._closing = false;
    this._scrollPerformanceTimer = null;
    this._searchRenderTimer = null;
    this._searchFocusState = null;
  }

  // Switch the planned combatant WITHOUT rebuilding. Selecting a token fires controlToken on the
  // canvas thread; rebuilding the plan there (buildCandidates + buildTurnPlans) blocks the selection
  // frame — that's the lag. Callers that select via the canvas set the combatant with this and let
  // the debounce rebuild a tick later, keeping the click responsive.
  selectCombatant(combatant) {
    this._selectedCombatant = combatant ?? null;
  }

  async setCombatant(combatant, refreshSource = "combatant-selection") {
    this.selectCombatant(combatant);
    await this.refresh(refreshSource);
  }

  async refresh(refreshSource = "manual") {
    this.refreshSource = refreshSource;
    // A canvas picker is in progress (destination/template placement). Token/refresh hooks
    // fire constantly while the cursor moves over tokens; if that refresh cancelled the picker
    // it would kill the destination grid / region tools mid-selection. Re-render only and leave
    // the in-progress picker alone — _onRender re-shows its overlay. Only explicit user actions
    // cancel a picker.
    if (this._areaPicker || this._destinationPicker) {
      await this.render({ force: true });
      return;
    }
    if (RESET_PIN_REFRESH_SOURCES.has(refreshSource)) {
      this._pinnedPlanId = null;
      this._pinnedFillPlanId = null;
    }
    this._cancelDestinationPicker();
    await this.render({ force: true });
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return preparePanelContext(this);
  }

  _viewContext(context) {
    return viewPanelContext(this, context);
  }

  _selectedAutoFillPlan() {
    return selectDisplayPlan(this._activeAutoFillPlans(), this._activePinnedPlanId())
      ?? this._builder?.autoFill
      ?? this._plan;
  }

  // Auto-fill previews/cycles a full fresh turn plan when the draft is empty (or was itself
  // entirely auto-filled) but must preview/cycle only the REMAINING-budget fill once the draft has
  // manual steps in it -- those two candidate searches use unrelated contexts/ids, so which list and
  // which pin apply depends on which mode is active.
  _hasManualDraftContent() {
    const draft = this._builder?.draft ?? {};
    return draft.source !== "auto-fill" && hasLockedDraftSteps(draft);
  }

  _activeAutoFillPlans() {
    return this._hasManualDraftContent() ? this._fillGapPlans() : this._autoFillPlans;
  }

  _activePinnedPlanId() {
    return this._hasManualDraftContent() ? this._pinnedFillPlanId : this._pinnedPlanId;
  }

  // Candidate plans for filling ONLY the budget left after the current draft's steps, searched
  // from the position/state the draft leaves the actor in (this._planningContext) rather than
  // turn-start -- the counterpart to this._autoFillPlans (always a fresh full-turn search) used
  // once the draft already has manual content that must not be discarded.
  _fillGapPlans() {
    if (!this._context) return [];
    const lockedDraft = draftForAutoFillGap(this._builder?.draft ?? {});
    const focusedContext = contextWithCurrentAutoFillTargets(this._context);
    const context = projectContextForDraftDestination(focusedContext, lockedDraft);
    const remainingTotal = Math.max(0, actionBudget(context).normalActions - draftNormalActionCost(lockedDraft));
    if (remainingTotal <= 0) return [];
    const planningBudget = actionBudget(context);
    const usedNormal = draftNormalActionCost(lockedDraft);
    const remainingContext = usedNormal > 0
      ? {
        ...context,
        actionsSpent: {
          ...(context.actionsSpent ?? {}),
          normal: (context.actionsSpent?.normal ?? 0) + usedNormal,
          total: (context.actionsSpent?.total ?? 0) + usedNormal,
        },
      }
      : context;
    const candidateBuild = buildCandidates(remainingContext);
    return buildTurnPlans(
      remainingContext,
      candidateBuild.candidates.map(withBuilderActionFields),
      { reservedSteps: lockedDraft.steps },
    );
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Don't wipe the canvas preview on every render — incidental refreshes (e.g. a
    // refreshToken hook when the cursor passes over a token) would otherwise make the
    // hover overlay vanish. The preview is managed by step hover and explicit actions, and
    // the destination-picker overlay is re-shown below.
    this._restorePosition();
    activatePanelRenderBindings(this, this.element);
    this._restoreDestinationPickerPreview();

    // Keep the detached browser window in sync: every panel render (mutation, refresh, or
    // combat hook) recomputes _builder, so re-render the browser from it. No-op when closed.
    this._browser?.render({ force: true });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Reopen the browser window if it was open when the panel last closed.
    if (!this._browser && readPanelState().browserOpen) this._toggleBrowser();
  }

  // Context for the browser window: it renders the panel's already-computed builder model.
  browserViewContext() {
    const showDebug = Boolean(game?.user?.isGM && settingOrDefault(SETTINGS.showDebugTab, false));
    return {
      builder: this._builder,
      readonly: this._builder?.readonly === true,
      showDebug,
      actor: this._context?.actor ?? null,
      debug: {
        candidates: this._candidates.map(debugAction),
        rejected: this._rejected.map((entry, index) => ({
          index,
          action: debugAction(entry?.action, index),
          reason: entry?.reason ?? "",
        })),
        detected: this._detected.map(debugAction),
      },
    };
  }

  _toggleBrowser() {
    if (this._browser) {
      this._browser.close();
      return;
    }
    this._browser = new CombaterBrowser(this);
    writePanelState({ browserOpen: true });
    // Panel re-render updates the toggle's active state and cascades to show/render the browser.
    this.render({ force: true });
  }

  _onBrowserClosed(browser) {
    if (browser && this._browser && this._browser !== browser) return;
    this._browser = null;
    if (this._closing) return;
    writePanelState({ browserOpen: false });
    this.render({ force: true });
  }

  async close(options) {
    this._closing = true;
    this._browser?.close();
    this._cancelDestinationPicker();
    this._clearActionListScrollPerformance();
    this._clearSearchRenderTimer();
    clearActionPreview();
    try {
      return await super.close(options);
    } finally {
      this._onClose?.(this);
    }
  }

  _setExpanded(expanded) {
    this.expanded = expanded;
    writePanelState({ expanded });
    this.setPosition({ width: expanded ? 720 : 360 });
    this.render({ force: true });
  }

  async _configureTacticPersonality() {
    const view = tacticPersonalityView(this._context);
    if (!view.visible) return;

    await openTacticWindow(view, {
      onSave: (decision) => this._applyTacticPersonalityDecision(decision),
    });
  }

  async _applyTacticPersonalityDecision(decision) {
    if (!decision) return;

    const actor = this._context?.actor?.document ?? this._context?.actor;
    const token = this._context?.token?.document ?? this._context?.token;
    try {
      if (decision.mode === "actor") {
        if (typeof actor?.setFlag !== "function") throw new Error("Actor flags unavailable");
        await actor.setFlag(MODULE_ID, TACTIC_PERSONALITY_FLAG, decision.value);
      } else if (decision.mode === "token") {
        if (typeof token?.setFlag !== "function") throw new Error("Token flags unavailable");
        await token.setFlag(MODULE_ID, TACTIC_PERSONALITY_OVERRIDE_FLAG, decision.value);
      } else if (decision.mode === "reset") {
        if (typeof token?.unsetFlag !== "function") throw new Error("Token flags unavailable");
        await token.unsetFlag(MODULE_ID, TACTIC_PERSONALITY_OVERRIDE_FLAG);
      }
      this._pinnedPlanId = null;
      this._pinnedFillPlanId = null;
      globalThis.ui?.notifications?.info?.(t("Tactic.Saved", "Tactic set to {label}.", { label: tacticPersonalityView(this._context).label }));
      await this.refresh("tactic-update");
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to update tactic`, error);
      globalThis.ui?.notifications?.warn?.(t("Tactic.SaveFailed", "Could not update tactic."));
    }
  }

  async _configureIntelLedger() {
    const viewProvider = () => panelIntelLedgerView(this._freshIntelContext() ?? this._context);
    const view = viewProvider();
    if (!view.visible) return;

    await openIntelWindow(view, {
      mode: view.editable === true ? "edit" : "view",
      onSave: (decision) => this._saveIntelLedger(decision),
      onResetAttempts: async (target) => {
        const actor = this._context?.actor?.document ?? this._context?.actor;
        const count = await resetRecallKnowledgeAttemptsForTarget(target, { actors: [actor] });
        await this.refresh("rk-attempt-reset");
        return count;
      },
      viewProvider,
    });
  }

  _freshIntelContext() {
    return readCombatContext("intel-window", { combatant: this._selectedCombatant });
  }

  async _saveIntelLedger(decision) {
    if (!decision) return;

    try {
      for (const entry of decision) {
        if (typeof entry.actor?.setFlag !== "function") throw new Error("Actor flags unavailable");
        await entry.actor.setFlag(MODULE_ID, INTEL_LEDGER_FLAG, entry.value);
        await entry.actor.setFlag(MODULE_ID, INTEL_REVEAL_MODE_FLAG, entry.revealMode);
        await entry.actor.setFlag(MODULE_ID, INTEL_FALSE_INFORMATION_FLAG, normalizeIntelFalseInformation(entry.falseInformation));
      }
      this._pinnedPlanId = null;
      this._pinnedFillPlanId = null;
      globalThis.ui?.notifications?.info?.(t("Intel.Saved", "Intel ledger updated."));
      await this.refresh("intel-update");
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to update Recall Knowledge intel`, error);
      globalThis.ui?.notifications?.warn?.(t("Intel.SaveFailed", "Could not update intel ledger."));
    }
  }

  async _openTargetIntel(targetKey) {
    const key = String(targetKey ?? "");
    if (!key) return;
    const viewProvider = () => this._targetIntelView(key);
    const view = viewProvider();
    if (!view?.visible || !view.entries.some((entry) => entry.hasRevealed)) {
      globalThis.ui?.notifications?.info?.(t("Intel.NoRevealedData", "No Recall Knowledge facts have been revealed yet."));
      return;
    }
    await openIntelWindow(view, { mode: "view", viewProvider });
  }

  _targetIntelView(key) {
    const context = this._freshIntelContext() ?? this._context;
    const target = [
      ...(context?.battlefield?.targets ?? []),
      ...(context?.battlefield?.enemies ?? []),
      ...(context?.battlefield?.allies ?? []),
    ].find((entry) => intelTargetMatchesKey(entry, key));
    return target ? intelLedgerView({ ...context, intelTargets: [target] }) : null;
  }

  _setActiveTab(tab) {
    if (!TABS.has(tab)) return;
    this.activeTab = tab;
    writePanelState({ activeTab: tab });
    this._clearSearchRenderTimer();
    this._searchFocusState = null;
    this.render({ force: true });
  }

  _clearSearchRenderTimer() {
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    if (this._searchRenderTimer && typeof clearTimer === "function") clearTimer(this._searchRenderTimer);
    this._searchRenderTimer = null;
  }

  _scheduleSearchRender() {
    this._clearSearchRenderTimer();
    const setTimer = globalThis.setTimeout ?? globalThis.window?.setTimeout;
    if (typeof setTimer !== "function") {
      this.render({ force: true });
      return;
    }
    this._searchRenderTimer = setTimer(() => {
      this._searchRenderTimer = null;
      const render = this.render({ force: true });
      if (render && typeof render.catch === "function") {
        render.catch((error) => console.warn(`${MODULE_ID} | Search refresh failed`, error));
      }
    }, 120);
  }

  _restoreSearchFocus(element = this.element) {
    const state = this._searchFocusState;
    if (!state || state.activeTab !== this.activeTab) return;
    const input = element?.querySelector?.("[data-search-actions]");
    if (!input) return;
    const valueLength = String(input.value ?? "").length;
    const start = Math.max(0, Math.min(state.selectionStart ?? valueLength, valueLength));
    const end = Math.max(start, Math.min(state.selectionEnd ?? start, valueLength));
    input.focus?.({ preventScroll: true });
    input.setSelectionRange?.(start, end);
    this._searchFocusState = null;
  }

  _setSearchQuery(query, input = null) {
    this.searchQuery = String(query ?? "");
    writePanelState({ searchQuery: this.searchQuery });
    this._searchFocusState = {
      activeTab: this.activeTab,
      selectionStart: typeof input?.selectionStart === "number" ? input.selectionStart : this.searchQuery.length,
      selectionEnd: typeof input?.selectionEnd === "number" ? input.selectionEnd : this.searchQuery.length,
    };
    this._scheduleSearchRender();
  }

  _findBuilderAction(actionKey) {
    if (!actionKey) return null;
    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((entry) => entry.key === actionKey);
      if (action) return action;
    }
    return null;
  }

  _findSustainAction() {
    const direct = this._findBuilderAction("sustain-a-spell");
    if (isSustainAction(direct)) return direct;
    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((entry) => isSustainAction(entry));
      if (action) return action;
    }
    // The action is no longer offered in the tabs; the sustained-spells section uses this
    // self-contained template to build a Sustain step.
    return {
      ...SUSTAIN_A_SPELL_ACTION,
      name: pf2eActionName("sustain-a-spell", SUSTAIN_A_SPELL_ACTION.name),
      reason: t("Reason.SustainExtend", "Spend 1 action to extend a sustained spell's duration."),
      key: "sustain-a-spell",
      baseKey: "sustain-a-spell",
    };
  }

  _findSustainedSpell(spellId) {
    const id = normalizedSlug(spellId);
    return this._builder?.sustainedSpells?.entries?.find((entry) => normalizedSlug(entry.id) === id) ?? null;
  }

  _findDraftStep(instanceId) {
    return this._builder?.draft?.steps?.find((step) => step.instanceId === instanceId)
      ?? this._builder?.uncounted?.entries?.find((step) => step.instanceId === instanceId)
      ?? null;
  }

  // Reach Spell (and other range-extending spellshapes) modify the spell cast right
  // after them, so the spell's effective range — and its range ring — grows by 30 ft
  // when the immediately-preceding step is a rangeBuff setup. Returns the feet to add.
  _spellRangeBonus(steps, index) {
    if (!Array.isArray(steps) || index <= 0) return 0;
    const previous = steps[index - 1];
    const profile = previous?.action?.activityProfile ?? previous?.activityProfile ?? {};
    return profile?.rangeBuff === true ? 30 : 0;
  }

  _draftRangeBonus(instanceId) {
    const steps = this._builder?.draft?.steps ?? [];
    return this._spellRangeBonus(steps, steps.findIndex((step) => step.instanceId === instanceId));
  }

  // Resolve a step from whichever stored list owns it (plan or uncounted).
  _findActiveStep(instanceId) {
    const draft = this._readActiveDraftPlan();
    return (draft.steps ?? []).find((entry) => entry.instanceId === instanceId)
      ?? (draft.uncounted ?? []).find((entry) => entry.instanceId === instanceId)
      ?? null;
  }

  _canEditDraft() {
    return this._builder?.readonly !== true;
  }

  // Editing (add/remove/reorder) requires an editable draft, but executing a player's shared plan as
  // the GM is allowed even though that draft is read-only for editing.
  _canExecuteDraft() {
    return this._canEditDraft() || this._gmExecuteMode === true;
  }

  // Reads/writes route to the shared draft when the GM is executing a player plan, otherwise to the
  // local per-user draft.
  _readActiveDraftPlan() {
    return readPanelActiveDraftPlan(this);
  }

  async _persistActiveDraftStep(step, listKey) {
    return persistPanelActiveDraftStep(this, step, listKey);
  }

  async _writeActiveDraftPlan(draft) {
    return writePanelActiveDraftPlan(this, draft);
  }

  async _writeActiveSharedDraft(draft) {
    return writePanelActiveSharedDraft(this, draft);
  }

  async _addAction(actionKey) {
    return addPanelAction(this, actionKey);
  }

  async _addUncountedAction(actionKey) {
    return addPanelUncountedAction(this, actionKey);
  }

  async _addSustainSpell(spellId) {
    return addPanelSustainSpell(this, spellId);
  }

  async _removeDraftStep(instanceId) {
    return removePanelDraftStep(this, instanceId);
  }

  async _duplicateDraftStep(instanceId) {
    return duplicatePanelDraftStep(this, instanceId);
  }

  async _reorderDraftStep(instanceId, targetInstanceId) {
    return reorderPanelDraftStep(this, instanceId, targetInstanceId);
  }

  async _cycleStepMap(instanceId) {
    return cyclePanelStepMap(this, instanceId);
  }

  _actorForMovement(context) {
    return actorForPanelMovement(this, context);
  }

  async _cycleStepMovement(instanceId) {
    return cyclePanelStepMovement(this, instanceId);
  }

  async _cycleStepRoute(instanceId) {
    return cyclePanelStepRoute(this, instanceId);
  }

  async _cycleStepWeapon(instanceId) {
    return cyclePanelStepWeapon(this, instanceId);
  }

  async _cycleResourceHorizon(direction = 1) {
    this.resourceHorizon = nextResourceHorizon(this.resourceHorizon, direction);
    writePanelState({ resourceHorizon: this.resourceHorizon });
    await this.refresh("resource-horizon");
  }

  async _chooseSwapItems(instanceId) {
    return choosePanelSwapItems(this, instanceId);
  }

  async _cycleMinionPlanStep(instanceId, stepIndex, direction = 1) {
    return cyclePanelMinionPlanStep(this, instanceId, stepIndex, direction);
  }

  async _cycleMinionPlanMovement(instanceId, stepIndex) {
    return cyclePanelMinionPlanMovement(this, instanceId, stepIndex);
  }

  async _chooseMinionTarget(instanceId) {
    return choosePanelMinionTarget(this, instanceId);
  }

  _chooseMinionDestination(instanceId, stepIndex) {
    return choosePanelMinionDestination(this, instanceId, stepIndex);
  }

  async _executeMinionPlanStep(instanceId, stepIndex, event) {
    return executePanelMinionPlanStep(this, instanceId, stepIndex, event);
  }

  async _revertMinionPlanStep(instanceId, stepIndex) {
    return revertPanelMinionPlanStep(this, instanceId, stepIndex);
  }

  async _removeMinionPlanStep(instanceId, stepIndex) {
    return removePanelMinionPlanStep(this, instanceId, stepIndex);
  }

  async _toggleFavorite(actionKey) {
    return togglePanelFavorite(this, actionKey);
  }

  async _setPlanPreferenceFeedback(value) {
    if (!this._canEditDraft() || !this._context) return;
    const plan = this._builder?.draft;
    if (!plan?.steps?.length) return;
    setPlanPreferenceFeedback(this._context, plan, value);
    await this.render({ force: true });
  }

  async _reorderFavorite(key, targetKey) {
    return reorderPanelFavorite(this, key, targetKey);
  }

  _actionKeyForStep(step) {
    return actionKeyForPanelStep(this, step);
  }

  async _autoFillDraft({ plan = null, forceFull = false } = {}) {
    return autoFillPanelDraft(this, { plan, forceFull });
  }

  async _fillDraftGap({ plan, draft }) {
    return fillPanelDraftGap(this, { plan, draft });
  }

  _atomizeAutoFillSteps(autoFill, movementContext, prefixSteps = []) {
    return atomizePanelAutoFillSteps(this, autoFill, movementContext, prefixSteps);
  }

  async _cycleAutoFillDraft(direction = 1) {
    return cyclePanelAutoFillDraft(this, direction);
  }

  async _syncDraftToGM({ notify = false } = {}) {
    return syncPanelDraftToGM(this, { notify });
  }

  _cancelDestinationPicker() {
    cancelPanelPickers(this);
  }

  _clearActionPreviewUnlessPicking(event) {
    clearActionPreviewUnlessPicking(this, event);
  }

  _draftForOrigin() {
    return draftForOrigin(this);
  }

  _contextForDraftStep(instanceId) {
    return contextForDraftStep(this, instanceId);
  }

  _showDestinationPickerPreview(instanceId = this._destinationPicker?.instanceId) {
    return showDestinationPickerPreview(this, instanceId);
  }

  _showHoverGhost(instanceId, destination, metadata = {}) {
    return showPanelHoverGhost(this, instanceId, destination, metadata);
  }

  _restoreDestinationPickerPreview() {
    restoreDestinationPickerPreview(this);
  }

  _stepWithRetryReset(step, patch) {
    return stepWithRetryReset(step, patch);
  }

  _chooseDestination(instanceId) {
    return choosePanelDestination(this, instanceId);
  }

  async _chooseTarget(instanceId, options = {}) {
    return choosePanelTarget(this, instanceId, options);
  }

  async _removeAreaTemplate(instanceId) {
    return removePanelAreaTemplate(this, instanceId);
  }

  async _pickTemplate(templates) {
    return pickAreaTemplate(templates);
  }

  async _chooseArea(instanceId) {
    return choosePanelArea(this, instanceId);
  }

  async _openBuilderAction(actionKey) {
    await this._openActionDetails(this._findBuilderAction(actionKey));
  }

  async _openDraftStep(instanceId) {
    const step = this._findDraftStep(instanceId);
    await this._openActionDetails(step?.action ?? step);
  }

  // A grouped step's own atom carries the backing weapon's item/traits (e.g. Fist), not the
  // ability's (e.g. Flurry of Blows) -- groupItem/groupUuid/groupTraits are the ability's own
  // identity, captured before that override (see builderAtomicActionsForStep), so the group
  // header opens and describes the ability itself rather than whichever weapon backs its first atom.
  async _openDraftGroup(instanceId) {
    const step = this._findDraftStep(instanceId);
    const action = step?.action ?? step;
    if (action?.groupItem || action?.groupUuid) {
      await this._openActionDetails({ item: action.groupItem, uuid: action.groupUuid });
      return;
    }
    await this._openActionDetails(action);
  }

  _planForPreview(element) {
    const planId = element.dataset.previewPlan;
    if (!planId || planId === "main" || planId === "auto") return this._selectedAutoFillPlan();
    return this._plans.find((plan) => plan?.id === planId) ?? null;
  }

  _showActionPreview(element) {
    if (this._destinationPicker || this._areaPicker) return;
    const plan = this._planForPreview(element);
    const index = Number(element.dataset.previewStep);
    const step = plan?.steps?.[index];
    const reachBonus = this._spellRangeBonus(plan?.steps, index);
    showActionPreview(
      this._planningContext ?? this._context,
      reachBonus > 0 && step ? { ...step, rangeBonusFeet: reachBonus } : step,
    );
  }

  _showDraftActionPreview(element) {
    if (this._destinationPicker || this._areaPicker) return;
    const step = this._findDraftStep(element.dataset.previewDraftStep);
    if (!step?.action) return;
    const reachBonus = this._draftRangeBonus(step.instanceId);
    const isDone = step.execution?.status === "done";
    showActionPreview(this._contextForDraftStep(step.instanceId), {
      ...step.action,
      destination: step.destination,
      movementPlan: step.movementPlan,
      areaMarker: step.areaMarker,
      ...explicitTargetFields(step, step.action),
      requiresDestination: requiresDestinationForAction(step.action),
      ...(reachBonus > 0 ? { rangeBonusFeet: reachBonus } : {}),
    }, { skipMovement: isDone });
  }

  _showMinionActionPreview(instanceId, stepIndex) {
    return showPanelMinionActionPreview(this, instanceId, stepIndex);
  }

  _restorePosition() {
    if (this._restoredPosition || !settingOrDefault(SETTINGS.rememberPanelPosition, true)) return;
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
    if (!settingOrDefault(SETTINGS.rememberPanelPosition, true)) return;
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

  _clearActionListScrollPerformance() {
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    if (this._scrollPerformanceTimer && typeof clearTimer === "function") clearTimer(this._scrollPerformanceTimer);
    this._scrollPerformanceTimer = null;
  }

  _activateActionListScrollPerformance(element) {
    const body = element.querySelector(".combater-body");
    if (!body) return;
    this._clearActionListScrollPerformance();

    const setTimer = globalThis.setTimeout ?? globalThis.window?.setTimeout;
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    const markScrolling = () => {
      body.classList.add("is-scrolling");
      if (this._scrollPerformanceTimer && typeof clearTimer === "function") clearTimer(this._scrollPerformanceTimer);
      this._scrollPerformanceTimer = typeof setTimer === "function"
        ? setTimer(() => {
          body.classList.remove("is-scrolling");
          this._scrollPerformanceTimer = null;
        }, 120)
        : null;
    };

    body.addEventListener("scroll", markScrolling, { passive: true });
    body.addEventListener("wheel", markScrolling, { passive: true });
  }

  async _chooseSustainedSpellForStep(step) {
    return chooseSustainedSpellForStep(this, step);
  }

  async executeStep(index) {
    await this._openActionDetails(this._selectedAutoFillPlan()?.steps?.[index]);
  }

  async _executeDraftStep(instanceId, event) {
    return executePanelDraftStep(this, instanceId, event);
  }

  _handleExecutionChoice(step, choice, event, result = null) {
    return handlePanelExecutionChoice(this, step, choice, event, result);
  }

  _retchActorName() {
    return retchActorName(this);
  }

  async _setAwaitingGm(instanceId, on) {
    return setPanelAwaitingGm(this, instanceId, on);
  }

  async _provideRetchDc(step, event) {
    return providePanelRetchDc(this, step, event);
  }

  async _confirmRetchResult(step, event, rolled) {
    return confirmPanelRetchResult(this, step, event, rolled);
  }

  async _applyExecutionResult(step, result, event) {
    return applyPanelExecutionResult(this, step, result, event);
  }

  async _revertDraftStep(instanceId) {
    return revertPanelDraftStep(this, instanceId);
  }

  async _resetExecution() {
    return resetPanelExecution(this);
  }

  async _openActionDetails(step) {
    if (!step) return;

    const actor = this._context?.actor?.document;
    if (step.item && await renderSheet(step.item)) return;
    if (await renderSheetFromUuid(step.uuid ?? step.sourceId)) return;
    await createGuidance(step, actor);
  }
}

export async function openPanelForCurrentCombatant(activePanel, refreshSource = "manual", options = {}) {
  if (!playerAccessAllowed()) {
    await activePanel?.close?.();
    return null;
  }
  if (
    Object.prototype.hasOwnProperty.call(options, "combatant")
    && options.combatant
    && !isPlannableCombatant(options.combatant)
  ) {
    await activePanel?.close?.();
    return null;
  }
  if (activePanel) {
    if (Object.prototype.hasOwnProperty.call(options, "combatant")) {
      activePanel._selectedCombatant = options.combatant ?? null;
    }
    await activePanel.refresh?.(refreshSource);
    return activePanel;
  }

  const panel = new CombaterPanel({ ...options, refreshSource });
  await panel.render({ force: true });
  return panel;
}

export async function togglePanelForCurrentCombatant(activePanel, refreshSource = "manual", options = {}) {
  if (activePanel?.close) {
    await activePanel.close();
    return null;
  }

  return openPanelForCurrentCombatant(null, refreshSource, options);
}
