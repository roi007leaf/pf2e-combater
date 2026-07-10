import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";
import {
  INTEL_REVEAL_MODES,
  NONE_FACT_ID,
  normalizeIntelLedger,
  normalizeIntelRevealMode,
} from "../rules/intel-ledger.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomId(prefix) {
  return `${prefix}-${globalThis.foundry?.utils?.randomID?.() ?? Date.now()}`;
}

function inputName(index, categoryId) {
  return `intel.${index}.${categoryId}`;
}

function revealModeInputName(index) {
  return `intel.${index}.revealMode`;
}

function factCountLabel(count) {
  if (count === 1) return t("Intel.FactOne", "1 fact");
  return t("Intel.FactMany", "{count} facts", { count });
}

function selectedCountLabel(selected, total) {
  return t("Intel.SelectedCount", "{selected}/{total} selected", { selected, total });
}

function factPreviewLabel(values) {
  if (!values.length) return "";
  if (values.length <= 2) return values.join(", ");
  return `${values.slice(0, 2).join(", ")} ${t("Intel.MoreFacts", "+{count} more", { count: values.length - 2 })}`;
}

function categoryFacts(entry, category, { editable = false } = {}) {
  const facts = editable
    ? entry.availableFacts?.[category.id] ?? entry.revealedFacts?.[category.id] ?? []
    : entry.revealedFacts?.[category.id] ?? [];
  if (editable && !facts.length) return [{ id: NONE_FACT_ID, label: t("Intel.None", "None") }];
  return facts;
}

function selectedFactIds(value, facts) {
  if (value === true) return facts.map((fact) => fact.id);
  return Array.isArray(value) ? value : [];
}

function categoryModel(entry, category, index, { editable = false } = {}) {
  const values = editable
    ? entry.available?.[category.id] ?? entry.revealed?.[category.id] ?? []
    : entry.revealed?.[category.id] ?? [];
  const facts = categoryFacts(entry, category, { editable });
  const selectedIds = selectedFactIds(entry.values?.[category.id], facts);
  const selectedCount = selectedIds.length;
  const totalCount = facts.length;
  return {
    ...category,
    checked: selectedCount > 0,
    inputName: inputName(index, category.id),
    values,
    hasValues: values.length > 0,
    facts: facts.map((fact) => ({
      ...fact,
      inputName: inputName(index, category.id),
      checked: selectedIds.includes(fact.id),
    })),
    selectedCount,
    totalCount,
    markIcon: selectedCount === 0 ? "fa-plus" : (selectedCount === totalCount ? "fa-check" : "fa-minus"),
    countLabel: factCountLabel(values.length),
    detailLabel: editable
      ? (selectedCount > 0 ? selectedCountLabel(selectedCount, totalCount) : factPreviewLabel(values) || t("Intel.NoSystemValues", "No system values found"))
      : factCountLabel(values.length),
    emptyLabel: t("Intel.NoSystemValues", "No system values found"),
    revealAllLabel: t("Intel.ToggleCategoryAll", "Select or clear all {category} facts", { category: category.label }),
  };
}

function entryModel(entry, categories, index, { canResetAttempts = false } = {}) {
  const revealMode = normalizeIntelRevealMode(entry.revealMode);
  const categoryModels = categories.map((category) => categoryModel(
    entry,
    category,
    index,
    { editable: entry.editable === true },
  ));
  return {
    ...entry,
    index,
    revealMode,
    revealModeOptions: [
      {
        id: INTEL_REVEAL_MODES.exact,
        label: t("Intel.RevealExact", "Exact numbers"),
        hint: t("Intel.RevealExactHint", "Players see the actual DCs and amounts."),
      },
      {
        id: INTEL_REVEAL_MODES.band,
        label: t("Intel.RevealBand", "Bands only"),
        hint: t("Intel.RevealBandHint", "Players see Low, Mid, or High for level-scaled numbers."),
      },
    ].map((option) => ({
      ...option,
      inputName: revealModeInputName(index),
      checked: option.id === revealMode,
    })),
    categories: categoryModels,
    categoryColumns: [
      categoryModels.filter((_category, categoryIndex) => categoryIndex % 2 === 0),
      categoryModels.filter((_category, categoryIndex) => categoryIndex % 2 === 1),
    ],
    knownLabel: t("Intel.KnownFacts", "Revealed facts"),
    noneLabel: t("Intel.NoRevealedDataShort", "Nothing revealed"),
    selectedLabel: t("Intel.SelectedFacts", "Selected to reveal"),
    revealStyleLabel: t("Intel.RevealStyle", "Reveal style"),
    revealAllLabel: t("Intel.RevealAll", "Reveal all"),
    revealAllTooltip: t(
      "Intel.RevealAllTooltip",
      "Select every available Recall Knowledge fact for this NPC. Save Intel to reveal them to players.",
    ),
    canResetAttempts,
    resetAttemptsLabel: t("Intel.ResetAttempts", "Reset RK attempts"),
    resetAttemptsTooltip: t(
      "Intel.ResetAttemptsTooltip",
      "Reset every actor's Recall Knowledge attempt progression against this NPC.",
    ),
  };
}

function windowContext(view, mode, { canResetAttempts = false } = {}) {
  const editable = mode === "edit" && view?.editable === true;
  const categories = view?.categories ?? [];
  const entries = (view?.entries ?? []).map((entry, index) => entryModel(
    { ...entry, editable },
    categories,
    index,
    { canResetAttempts: editable && canResetAttempts },
  ));
  return {
    editable,
    entries,
    hasEntries: entries.length > 0,
    title: editable
      ? t("Intel.ConfigureTitle", "Recall Knowledge Intel")
      : t("Intel.ViewTitle", "Known Intel"),
    help: editable
      ? t("Intel.Help", "Mark facts learned by Recall Knowledge. Auto-fill and shuffle use hidden defenses only after you mark the matching fact known.")
      : t("Intel.ViewHelp", "Recall Knowledge facts revealed by the GM."),
    cancelLabel: t("Dialog.Cancel", "Cancel"),
    closeLabel: t("Dialog.Close", "Close"),
    saveLabel: t("Intel.Save", "Save intel"),
    noRevealedData: t("Intel.NoRevealedData", "No Recall Knowledge facts have been revealed yet."),
    noTargetsLabel: t("Intel.NoTargets", "No NPC targets available."),
  };
}

export function resolveIntelWindowView(view, viewProvider = null) {
  if (typeof viewProvider !== "function") return view ?? {};
  try {
    const fresh = viewProvider();
    return fresh && typeof fresh === "object" ? fresh : (view ?? {});
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to refresh Recall Knowledge intel window`, error);
    return view ?? {};
  }
}

const LIVE_REFRESH_HOOKS = ["renderCombatTracker", "updateCombatant", "updateToken", "updateActor", "updateCombat"];

export class IntelWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "pf2e-combater-intel-window"],
    tag: "section",
    window: {
      frame: true,
      icon: "fa-solid fa-brain",
      positioned: true,
      resizable: true,
    },
    position: {
      width: 620,
      height: "auto",
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/intel-window.hbs`,
    },
  };

  constructor(view, options = {}) {
    const { mode, onSave, onResetAttempts, viewProvider, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-intel`), ...appOptions });
    this._view = view ?? {};
    this._mode = mode ?? (view?.editable === true ? "edit" : "view");
    this._onSave = typeof onSave === "function" ? onSave : null;
    this._onResetAttempts = typeof onResetAttempts === "function" ? onResetAttempts : null;
    this._viewProvider = this._mode === "view" && typeof viewProvider === "function" ? viewProvider : null;
    this._liveRefreshHooks = [];
    this._liveRefreshTimer = null;
    this._registerLiveRefreshHooks();
  }

  get title() {
    return this._mode === "edit"
      ? t("Intel.ConfigureTitle", "Recall Knowledge Intel")
      : t("Intel.ViewTitle", "Known Intel");
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    this._view = resolveIntelWindowView(this._view, this._viewProvider);
    return windowContext(this._view, this._mode, { canResetAttempts: Boolean(this._onResetAttempts) });
  }

  _registerLiveRefreshHooks() {
    if (!this._viewProvider || typeof globalThis.Hooks?.on !== "function") return;
    const refresh = () => this._scheduleLiveRefresh();
    this._liveRefreshHooks = LIVE_REFRESH_HOOKS.map((hook) => ({ hook, refresh }));
    for (const { hook } of this._liveRefreshHooks) globalThis.Hooks.on(hook, refresh);
  }

  _unregisterLiveRefreshHooks() {
    if (typeof globalThis.Hooks?.off === "function") {
      for (const { hook, refresh } of this._liveRefreshHooks) globalThis.Hooks.off(hook, refresh);
    }
    this._liveRefreshHooks = [];
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    if (this._liveRefreshTimer && typeof clearTimer === "function") clearTimer(this._liveRefreshTimer);
    this._liveRefreshTimer = null;
  }

  _scheduleLiveRefresh() {
    if (!this._viewProvider || this._liveRefreshTimer) return;
    const setTimer = globalThis.setTimeout ?? globalThis.window?.setTimeout;
    if (typeof setTimer !== "function") {
      this.render({ force: true }).catch((error) => console.warn(`${MODULE_ID} | Intel refresh failed`, error));
      return;
    }
    this._liveRefreshTimer = setTimer(() => {
      this._liveRefreshTimer = null;
      this.render({ force: true }).catch((error) => console.warn(`${MODULE_ID} | Intel refresh failed`, error));
    }, 0);
  }

  async close(options) {
    this._unregisterLiveRefreshHooks();
    return super.close(options);
  }

  _readForm() {
    const form = this.element.querySelector("[data-intel-form]");
    return (this._view.entries ?? []).map((entry, index) => ({
      actor: entry.actor,
      revealMode: normalizeIntelRevealMode(Array.from(form?.elements ?? [])
        .find((element) => element?.name === revealModeInputName(index) && element.checked === true)?.value),
      value: normalizeIntelLedger(Object.fromEntries(
        (this._view.categories ?? []).map((category) => [
          category.id,
          Array.from(form?.elements ?? [])
            .filter((element) => element?.name === inputName(index, category.id) && element.checked === true)
            .map((element) => element.value),
        ]),
      )),
    }));
  }

  async _save(button) {
    if (!button) return;
    button.disabled = true;
    try {
      await this._onSave?.(this._readForm());
      await this.close();
    } finally {
      button.disabled = false;
    }
  }

  async _resetAttempts(index, button) {
    const entry = this._view.entries?.[index];
    if (!entry?.actor || !this._onResetAttempts) return;
    button.disabled = true;
    try {
      await this._onResetAttempts(entry.actor);
    } finally {
      button.disabled = false;
    }
  }

  _syncFactState(fact) {
    if (!fact) return;
    const checked = fact.querySelector("input[type='checkbox']")?.checked === true;
    fact.classList.toggle("is-known", checked);
    const icon = fact.querySelector(".combater-intel-fact-mark i");
    icon?.classList.toggle("fa-check", checked);
    icon?.classList.toggle("fa-plus", !checked);
  }

  _syncCategoryState(category) {
    if (!category) return;
    const inputs = Array.from(category.querySelectorAll("input[type='checkbox']"));
    const checkedCount = inputs.filter((input) => input.checked === true).length;
    const allChecked = inputs.length > 0 && checkedCount === inputs.length;
    category.classList.toggle("is-known", checkedCount > 0);
    const icon = category.querySelector(".combater-intel-category-mark i");
    icon?.classList.toggle("fa-check", allChecked);
    icon?.classList.toggle("fa-minus", checkedCount > 0 && !allChecked);
    icon?.classList.toggle("fa-plus", checkedCount === 0);
  }

  _syncEntryState(entry) {
    if (!entry) return;
    if (!entry.querySelector("[data-intel-category]")) return;
    const checkedCount = entry.querySelectorAll(
      "[data-intel-category] input[type='checkbox']:checked",
    ).length;
    entry.classList.toggle("has-revealed", checkedCount > 0);
    const status = entry.querySelector("[data-intel-status]");
    if (!status) return;
    status.textContent = checkedCount > 0
      ? (status.dataset.intelSelectedLabel || status.dataset.intelKnownLabel || t("Intel.SelectedFacts", "Selected to reveal"))
      : (status.dataset.intelNoneLabel || t("Intel.NoRevealedDataShort", "Nothing revealed"));
  }

  _syncRevealModeLabels(entry) {
    if (!entry) return;
    for (const option of entry.querySelectorAll(".combater-intel-reveal-option")) {
      option.classList.toggle("is-selected", option.querySelector("input")?.checked === true);
    }
    for (const label of entry.querySelectorAll("[data-intel-fact-label]")) {
      label.textContent = label.dataset.exactLabel || label.textContent;
    }
  }

  _syncIntelEditorState() {
    for (const entry of this.element.querySelectorAll("[data-intel-entry]")) this._syncRevealModeLabels(entry);
    for (const fact of this.element.querySelectorAll("[data-intel-fact]")) this._syncFactState(fact);
    for (const category of this.element.querySelectorAll("[data-intel-category]")) this._syncCategoryState(category);
    for (const entry of this.element.querySelectorAll("[data-intel-entry]")) this._syncEntryState(entry);
  }

  _revealAll(entry) {
    if (!entry) return;
    for (const input of entry.querySelectorAll("[data-intel-category] input[type='checkbox']")) {
      input.checked = true;
    }
    for (const fact of entry.querySelectorAll("[data-intel-fact]")) this._syncFactState(fact);
    for (const category of entry.querySelectorAll("[data-intel-category]")) this._syncCategoryState(category);
    this._syncEntryState(entry);
  }

  _toggleCategory(category) {
    if (!category) return;
    const inputs = Array.from(category.querySelectorAll("input[type='checkbox']"));
    const checked = !(inputs.length > 0 && inputs.every((input) => input.checked === true));
    for (const input of inputs) input.checked = checked;
    for (const fact of category.querySelectorAll("[data-intel-fact]")) this._syncFactState(fact);
    this._syncCategoryState(category);
    this._syncEntryState(category.closest("[data-intel-entry]"));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-intel-close]")?.addEventListener("click", () => this.close());
    this.element.querySelector("[data-intel-save]")?.addEventListener("click", (event) => this._save(event.currentTarget));
    for (const button of this.element.querySelectorAll("[data-intel-reset-attempts]")) {
      button.addEventListener("click", () => this._resetAttempts(Number(button.dataset.intelResetAttempts), button));
    }
    for (const button of this.element.querySelectorAll("[data-intel-reveal-all]")) {
      button.addEventListener("click", () => this._revealAll(button.closest("[data-intel-entry]")));
    }
    for (const button of this.element.querySelectorAll("[data-intel-reveal-category]")) {
      button.addEventListener("click", () => this._toggleCategory(button.closest("[data-intel-category]")));
    }
    this._syncIntelEditorState();
    for (const input of this.element.querySelectorAll("[data-intel-fact] input[type='checkbox']")) {
      input.addEventListener("change", () => {
        this._syncFactState(input.closest("[data-intel-fact]"));
        this._syncCategoryState(input.closest("[data-intel-category]"));
        this._syncEntryState(input.closest("[data-intel-entry]"));
      });
    }
    for (const input of this.element.querySelectorAll("[data-intel-reveal-mode]")) {
      input.addEventListener("change", () => {
        this._syncRevealModeLabels(input.closest("[data-intel-entry]"));
      });
    }
  }
}

export async function openIntelWindow(view, options = {}) {
  const window = new IntelWindow(view, options);
  await window.render({ force: true });
  return window;
}
