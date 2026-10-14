import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";
import {
  INTEL_REVEAL_MODES,
  NONE_FACT_ID,
  normalizeIntelFalseInformation,
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

const FALSE_FACT_FALLBACKS = {
  identity: ["aberration", "animal", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "humanoid", "ooze", "plant", "spirit", "undead"],
  traits: ["aberration", "animal", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "humanoid", "ooze", "plant", "spirit", "undead"],
  weaknesses: ["acid", "cold", "electricity", "fire", "force", "mental", "poison", "sonic", "spirit", "vitality", "void"],
  resistances: ["acid", "cold", "electricity", "fire", "force", "mental", "poison", "sonic", "spirit", "vitality", "void"],
  immunities: ["acid", "bleed", "cold", "death-effects", "disease", "electricity", "fire", "mental", "paralyzed", "poison", "precision", "unconscious"],
};

// Common creature abilities a GM may plant as false Recall Knowledge.
const FALSE_ABILITY_FACTS = {
  strikes: ["Claw", "Jaws", "Fist", "Tail", "Horn", "Tentacle", "Longsword", "Spear", "Greataxe", "Shortbow", "Longbow", "Crossbow"],
  actions: ["Reactive Strike", "Grab", "Improved Grab", "Knockdown", "Push", "Trample", "Swallow Whole", "Breath Weapon", "Frightful Presence", "Constrict", "Rend", "Pounce", "Sneak Attack", "Shield Block"],
  passives: ["Ferocity", "Regeneration", "Fast Healing", "Void Healing", "Aura", "All-Around Vision", "Darkvision", "Scent", "Swarm Mind", "Tremorsense"],
};

function localizedConfigOptions(mapNames, fallback = []) {
  const values = new Map();
  for (const mapName of mapNames) {
    for (const [id, rawEntry] of Object.entries(globalThis.CONFIG?.PF2E?.[mapName] ?? {})) {
      // Some PF2e maps hold strings ("PF2E.TraitFire"), others objects ({ label, attribute } for skills).
      const rawLabel = typeof rawEntry === "string" ? rawEntry : String(rawEntry?.label ?? "");
      const localized = rawLabel ? globalThis.game?.i18n?.localize?.(rawLabel) ?? rawLabel : "";
      values.set(String(id), String(localized || rawLabel || id));
    }
  }
  for (const id of fallback) {
    if (!values.has(id)) values.set(id, id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
  }
  return [...values].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function falseFactOptions(categoryId) {
  if (categoryId === "saves") return ["fortitude", "reflex", "will"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  if (categoryId === "perception") return [{ id: "perception", label: t("Intel.Perception", "Perception") }];
  if (categoryId === "identity" || categoryId === "traits") {
    return localizedConfigOptions(["creatureTraits"], FALSE_FACT_FALLBACKS[categoryId]);
  }
  if (categoryId === "skills") return localizedConfigOptions(["skills"], ["acrobatics", "athletics", "deception", "intimidation", "stealth", "survival"]);
  if (categoryId === "languages") return localizedConfigOptions(["languages"], ["common", "draconic", "goblin", "sylvan", "undercommon"]);
  if (categoryId === "senses") return localizedConfigOptions(["senses"], ["darkvision", "low-light-vision", "scent", "tremorsense", "echolocation"]);
  if (FALSE_ABILITY_FACTS[categoryId]) {
    return FALSE_ABILITY_FACTS[categoryId].map((label) => ({ id: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label }));
  }
  if (categoryId === "immunities") {
    return localizedConfigOptions(["damageTypes", "conditionTypes"], FALSE_FACT_FALLBACKS.immunities);
  }
  return localizedConfigOptions(["damageTypes"], FALSE_FACT_FALLBACKS[categoryId]);
}

function categoryFacts(entry, category, { editable = false } = {}) {
  const facts = editable
    ? entry.availableFacts?.[category.id] ?? entry.revealedFacts?.[category.id] ?? []
    : entry.revealedFacts?.[category.id] ?? [];
  if (editable && !facts.length) {
    return [{ id: NONE_FACT_ID, isNone: true, label: t("Intel.NoneFor", "No {category}", { category: String(category.label ?? "").toLowerCase() }) }];
  }
  return facts;
}

function selectedFactIds(value, facts) {
  if (value === true) return facts.map((fact) => fact.id);
  return Array.isArray(value) ? value : [];
}

// "Reflex DC 25", "Fire 5", or a legacy free-text record.
function falseChipLabel(record, options, valueKind) {
  if (!record?.factId && record?.text) return String(record.text);
  const label = options.find((option) => option.id === record?.factId)?.label ?? record?.factLabel ?? "";
  const value = String(record?.value ?? "").trim();
  if (!value || valueKind === "none") return label;
  return valueKind === "dc" ? `${label} DC ${value}` : `${label} ${value}`;
}

// Highest and lowest of a category's values (best/worst save, biggest resistance): only where values
// differ, and for players only once the whole category is revealed at exact values, so the marks
// never hint at a hidden fact.
function extremeFactIds(facts, { canMark = true } = {}) {
  const valued = facts.filter((fact) => Number.isFinite(Number(fact?.value)));
  if (!canMark || valued.length < 2) return { highest: new Set(), lowest: new Set() };
  const values = valued.map((fact) => Number(fact.value));
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return { highest: new Set(), lowest: new Set() };
  return {
    highest: new Set(valued.filter((fact) => Number(fact.value) === max).map((fact) => fact.id)),
    lowest: new Set(valued.filter((fact) => Number(fact.value) === min).map((fact) => fact.id)),
  };
}

function extremeMark(id, extremes) {
  if (extremes.highest.has(id)) return { extreme: "highest", extremeIcon: "fa-arrow-up", extremeLabel: t("Intel.Highest", "Highest") };
  if (extremes.lowest.has(id)) return { extreme: "lowest", extremeIcon: "fa-arrow-down", extremeLabel: t("Intel.Lowest", "Lowest") };
  return {};
}

function categoryModel(entry, category, index, { editable = false } = {}) {
  const values = editable
    ? entry.available?.[category.id] ?? entry.revealed?.[category.id] ?? []
    : entry.revealed?.[category.id] ?? [];
  const facts = categoryFacts(entry, category, { editable });
  const selectedIds = selectedFactIds(entry.values?.[category.id], facts);
  const selectedCount = selectedIds.length;
  const totalCount = facts.length;
  const falseOptions = falseFactOptions(category.id);
  const categoryFalseInformation = (Array.isArray(entry.falseInformation) ? entry.falseInformation : [])
    .filter((record) => record.category === category.id);
  const revealedFalseInformation = categoryFalseInformation.filter((record) => record.revealed === true);
  // The GM can show or hide a planted fact from the editor; a Recall Knowledge
  // result for this category additionally reveals new ones by default.
  const revealsByDefault = entry.falseInformationRevealCategory === category.id;
  const canRevealFalseInformation = editable || revealsByDefault;
  const availableCount = (entry.availableFacts?.[category.id] ?? []).length;
  const playerSeesWholeCategory = entry.values?.[category.id] === true
    || (availableCount > 0 && selectedCount >= availableCount);
  const extremes = extremeFactIds(editable ? facts : (entry.revealedFacts?.[category.id] ?? []), {
    canMark: editable || (playerSeesWholeCategory && normalizeIntelRevealMode(entry.revealMode) === INTEL_REVEAL_MODES.exact),
  });
  const revealedFactByLabel = new Map((entry.revealedFacts?.[category.id] ?? []).map((fact) => [String(fact.label), fact]));
  const revealedItems = values.map((value) => ({
    label: String(value),
    isFalse: false,
    tooltip: "",
    ...extremeMark(revealedFactByLabel.get(String(value))?.id, extremes),
    uuid: revealedFactByLabel.get(String(value))?.uuid ?? "",
    infoLabel: t("Intel.AbilityDetails", "Show details"),
  }));
  if (!editable) {
    for (const record of revealedFalseInformation) {
      const label = String(record.label || record.text || "").trim();
      if (!label) continue;
      let matchingIndex = -1;
      for (let itemIndex = revealedItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
        if (!revealedItems[itemIndex].isFalse && revealedItems[itemIndex].label === label) {
          matchingIndex = itemIndex;
          break;
        }
      }
      const falseItem = {
        label,
        isFalse: true,
        tooltip: t("Intel.FalseInformationGmTooltip", "False information; players see this as normal revealed Intel."),
      };
      if (matchingIndex >= 0) revealedItems[matchingIndex] = falseItem;
      else revealedItems.push(falseItem);
    }
  }
  const falseValueKind = ["saves", "perception"].includes(category.id)
    ? "dc"
    : (["weaknesses", "resistances", "skills", "strikes"].includes(category.id) ? "amount" : "none");
  return {
    ...category,
    checked: selectedCount > 0,
    inputName: inputName(index, category.id),
    values,
    hasValues: editable ? values.length > 0 : revealedItems.length > 0,
    revealedItems,
    facts: facts.map((fact) => ({
      ...fact,
      ...extremeMark(fact.id, extremes),
      infoLabel: t("Intel.AbilityDetails", "Show details"),
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
    unknownLabel: t("Intel.Unknown", "Unknown"),
    revealAllLabel: t("Intel.ToggleCategoryAll", "Select or clear all {category} facts", { category: category.label }),
    falseInformation: categoryFalseInformation
      .map((record, recordIndex) => ({
        ...record,
        id: String(record.id ?? `false-${recordIndex}`),
        text: String(record.text ?? ""),
        inputName: `intel.${index}.falseInformation.${String(record.id ?? `false-${recordIndex}`)}`,
        entryIndex: index,
        legacy: !record.factId && Boolean(record.text),
        chipFactLabel: falseOptions.find((option) => option.id === record.factId)?.label ?? record.factLabel ?? "",
        chipLabel: falseChipLabel(record, falseOptions, falseValueKind),
        options: falseOptions.map((option) => ({ ...option, selected: option.id === record.factId })),
        hasValue: falseValueKind !== "none",
        isDc: falseValueKind === "dc",
        revealed: record.revealed === true,
        canReveal: canRevealFalseInformation,
        revealLabel: record.revealed === true
          ? t("Intel.HidePreparedFalseInformation", "Hide this misinformation from players")
          : t("Intel.RevealPreparedFalseInformation", "Reveal this prepared misinformation to players"),
        sourceLabel: [
          record.revealed === true ? t("Intel.FalseInformationRevealed", "Revealed to players") : t("Intel.FalseInformationPrepared", "Prepared; hidden from players"),
          record.sourceActorName,
          record.question,
          `Attempt ${record.attempt}`,
        ].filter(Boolean).join(" · "),
      })),
    falseOptions,
    falseHasValue: falseValueKind !== "none",
    falseIsDc: falseValueKind === "dc",
    canRevealFalseInformation,
    falseDefaultRevealed: revealsByDefault,
    falseInformationLabel: t("Intel.FalseInformation", "False information"),
    addFalseInformationLabel: t("Intel.AddFalseInformation", "Add false information to {category}", { category: category.label }),
    addFalseShortLabel: t("Intel.AddFalseShort", "False fact"),
    addFalseConfirmLabel: t("Intel.AddFalseConfirm", "Add this false fact"),
    cancelFalseLabel: t("Dialog.Cancel", "Cancel"),
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
  const editable = entry.editable === true;
  const progressTotal = editable
    ? categoryModels.reduce((sum, category) => sum + category.totalCount, 0)
    : categoryModels.length;
  const progressCount = editable
    ? categoryModels.reduce((sum, category) => sum + category.selectedCount, 0)
    : categoryModels.filter((category) => category.hasValues).length;
  const progressTemplate = editable
    ? t("Intel.ProgressFacts", "{count} of {total} facts revealed")
    : t("Intel.ProgressTopics", "{count} of {total} topics known");
  return {
    ...entry,
    index,
    progressTotal,
    progressTemplate,
    progressLabel: progressTemplate.replace("{count}", progressCount).replace("{total}", progressTotal),
    progressPercent: progressTotal > 0 ? Math.round((progressCount / progressTotal) * 100) : 0,
    noneKnownLabel: t("Intel.NothingKnownYet", "Nothing known about this creature yet."),
    revealMode,
    revealModeOptions: [
      {
        id: INTEL_REVEAL_MODES.exact,
        label: t("Intel.RevealExact", "Exact numbers"),
        shortLabel: t("Intel.RevealExactShort", "Exact DCs"),
        hint: t("Intel.RevealExactHint", "Players see the actual DCs and amounts."),
      },
      {
        id: INTEL_REVEAL_MODES.band,
        label: t("Intel.RevealBand", "Bands only"),
        shortLabel: t("Intel.RevealBandShort", "Bands"),
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
    // One NPC: its Reveal all / Reset attempts sit in the window footer.
    singleEntry: entries.length === 1 ? entries[0] : null,
    title: editable
      ? t("Intel.ConfigureTitle", "Recall Knowledge Intel")
      : t("Intel.ViewTitle", "Known Intel"),
    help: editable
      ? t("Intel.HelpShort", "Tick facts the party learned. Auto-fill uses a hidden defense only after its fact is ticked.")
      : t("Intel.ViewHelp", "Recall Knowledge facts revealed by the GM."),
    cancelLabel: t("Dialog.Cancel", "Cancel"),
    closeLabel: t("Dialog.Close", "Close"),
    saveLabel: t("Intel.Save", "Save intel"),
    saveChangesLabel: t("Intel.SaveChanges", "Save · {count} changes"),
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
    return (this._view.entries ?? []).map((entry, index) => {
      const falseInformation = normalizeIntelFalseInformation(Array.from(
        this.element.querySelectorAll(`[data-intel-false-record-entry="${index}"]`),
      ).map((recordElement) => {
        const id = recordElement.dataset.intelFalseRecord;
        const existing = entry.falseInformation?.find((record) => String(record.id) === id) ?? {};
        const select = recordElement.querySelector("[data-intel-false-fact]");
        const valueInput = recordElement.querySelector("[data-intel-false-value]");
        const chip = recordElement.dataset;
        return {
          ...existing,
          id,
          category: recordElement.dataset.intelFalseCategory,
          factId: chip.intelFalseFactId ?? select?.value ?? existing.factId ?? "",
          factLabel: chip.intelFalseFactLabel ?? select?.selectedOptions?.[0]?.textContent?.trim() ?? existing.factLabel ?? "",
          value: chip.intelFalseAmount ?? valueInput?.value ?? existing.value ?? null,
          revealed: recordElement.dataset.intelFalseRevealed === "true",
        };
      }));
      return {
        actor: entry.actor,
        falseInformation,
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
      };
    });
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
    const total = Number(status?.dataset.intelTotal) || 0;
    if (status?.dataset.intelProgressTemplate) {
      status.textContent = status.dataset.intelProgressTemplate.replace("{count}", checkedCount).replace("{total}", total);
    }
    const meter = entry.querySelector("[data-intel-meter]");
    if (meter) meter.style.width = `${total > 0 ? Math.round((checkedCount / total) * 100) : 0}%`;
    this._syncSaveLabel();
  }

  // Counts fact ticks that differ from what was saved, so Save says what it will change.
  _syncSaveLabel() {
    const button = this.element?.querySelector("[data-intel-save]");
    const label = button?.querySelector("[data-intel-save-label]");
    if (!label) return;
    const changes = Array.from(this.element.querySelectorAll("[data-intel-fact] input[type='checkbox']"))
      .filter((input) => input.checked !== input.defaultChecked).length;
    label.textContent = changes > 0
      ? String(button.dataset.saveChangesLabel ?? "").replace("{count}", changes)
      : button.dataset.saveLabel;
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

  _falseDraft(category) {
    return category?.querySelector("[data-intel-false-draft]");
  }

  _addFalseInformation(category) {
    const draft = this._falseDraft(category);
    if (!draft) return;
    draft.hidden = false;
    draft.querySelector("select")?.focus();
  }

  _closeFalseDraft(draft) {
    if (!draft) return;
    draft.hidden = true;
    const select = draft.querySelector("[data-intel-false-fact]");
    if (select) select.value = "";
    const input = draft.querySelector("[data-intel-false-value]");
    if (input) input.value = "";
  }

  // The draft's + turns the chosen fact into a false-fact chip beside the real facts.
  _confirmFalseInformation(category) {
    const draft = this._falseDraft(category);
    const container = category?.querySelector("[data-intel-false-list]");
    const template = category?.querySelector("template[data-intel-false-template]");
    const entry = category?.closest("[data-intel-entry]");
    const select = draft?.querySelector("[data-intel-false-fact]");
    if (!draft || !container || !template || !entry || !select) return;
    if (!select.value) {
      select.focus();
      return;
    }
    const factLabel = select.selectedOptions?.[0]?.textContent?.trim() ?? select.value;
    const amount = String(draft.querySelector("[data-intel-false-value]")?.value ?? "").trim();
    const fragment = template.content.cloneNode(true);
    const record = fragment.querySelector("[data-intel-false-record]");
    record.dataset.intelFalseRecordEntry = entry.dataset.intelEntryIndex;
    record.dataset.intelFalseRecord = globalThis.foundry?.utils?.randomID?.() ?? `false-${Date.now()}`;
    record.dataset.intelFalseCategory = category.dataset.intelCategory;
    record.dataset.intelFalseFactId = select.value;
    record.dataset.intelFalseFactLabel = factLabel;
    record.dataset.intelFalseAmount = amount;
    const label = record.querySelector("[data-intel-false-chip-label]");
    if (label) label.textContent = amount ? `${factLabel} ${record.dataset.falsedc === "true" ? "DC " : ""}${amount}` : factLabel;
    record.querySelector("[data-intel-remove-false]")?.addEventListener("click", () => record.remove());
    record.querySelector("[data-intel-toggle-false]")?.addEventListener("click", (event) => this._toggleFalseInformation(record, event.currentTarget));
    container.append(fragment);
    this._closeFalseDraft(draft);
  }

  _toggleFalseInformation(record, button) {
    if (!record || !button) return;
    const revealed = record.dataset.intelFalseRevealed !== "true";
    record.dataset.intelFalseRevealed = String(revealed);
    record.classList.toggle("is-revealed", revealed);
    record.classList.toggle("is-prepared", !revealed);
    button.classList.toggle("is-revealed", revealed);
    const icon = button.querySelector("i");
    // The icon shows the current state: an open eye means players can see it.
    icon?.classList.toggle("fa-eye", revealed);
    icon?.classList.toggle("fa-eye-slash", !revealed);
    const label = revealed
      ? t("Intel.HidePreparedFalseInformation", "Hide this misinformation from players")
      : t("Intel.RevealPreparedFalseInformation", "Reveal this prepared misinformation to players");
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
  }

  // The ability's own description (Reactive Strike, Ferocity...), shown under its row; a second click
  // hides it. Enriched with GM-only secrets kept from players.
  async _toggleAbilityDetails(button) {
    const uuid = button?.dataset?.intelAbilityInfo;
    const row = button?.closest("[data-intel-category], .combater-intel-revealed-section");
    if (!uuid || !row) return;
    const existing = row.querySelector("[data-intel-ability-details]");
    const wasSame = existing?.dataset.uuid === uuid;
    existing?.remove();
    for (const other of row.querySelectorAll("[data-intel-ability-info].is-open")) other.classList.remove("is-open");
    if (wasSame) return;
    const item = await globalThis.fromUuid?.(uuid);
    if (!item) return;
    const TextEditor = globalThis.foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const raw = item.system?.description?.value ?? "";
    const description = TextEditor?.enrichHTML
      ? await TextEditor.enrichHTML(raw, { secrets: globalThis.game?.user?.isGM === true, rollData: item.getRollData?.() ?? {}, relativeTo: item })
      : raw;
    const details = document.createElement("div");
    details.className = "combater-intel-ability-details";
    details.dataset.intelAbilityDetails = "";
    details.dataset.uuid = uuid;
    const title = document.createElement("strong");
    title.textContent = item.name;
    const body = document.createElement("div");
    body.className = "combater-intel-ability-description";
    body.innerHTML = description || t("Intel.NoDescription", "No description.");
    details.append(title, body);
    row.append(details);
    button.classList.add("is-open");
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const button of this.element.querySelectorAll("[data-intel-ability-info]")) {
      button.addEventListener("click", (event) => {
        // Inside the fact's <label>: don't tick the checkbox.
        event.preventDefault();
        event.stopPropagation();
        this._toggleAbilityDetails(button);
      });
    }
    this.element.querySelector("[data-intel-close]")?.addEventListener("click", () => this.close());
    this.element.querySelector("[data-intel-save]")?.addEventListener("click", (event) => this._save(event.currentTarget));
    for (const button of this.element.querySelectorAll("[data-intel-reset-attempts]")) {
      button.addEventListener("click", () => this._resetAttempts(Number(button.dataset.intelResetAttempts), button));
    }
    for (const button of this.element.querySelectorAll("[data-intel-reveal-all]")) {
      button.addEventListener("click", () => this._revealAll(
        button.closest("[data-intel-entry]") ?? this.element.querySelector("[data-intel-entry]"),
      ));
    }
    for (const button of this.element.querySelectorAll("[data-intel-reveal-category]")) {
      button.addEventListener("click", () => this._toggleCategory(button.closest("[data-intel-category]")));
    }
    for (const button of this.element.querySelectorAll("[data-intel-add-false]")) {
      button.addEventListener("click", () => this._addFalseInformation(button.closest("[data-intel-category]")));
    }
    for (const button of this.element.querySelectorAll("[data-intel-false-confirm]")) {
      button.addEventListener("click", () => this._confirmFalseInformation(button.closest("[data-intel-category]")));
    }
    for (const button of this.element.querySelectorAll("[data-intel-false-cancel]")) {
      button.addEventListener("click", () => this._closeFalseDraft(button.closest("[data-intel-false-draft]")));
    }
    for (const draft of this.element.querySelectorAll("[data-intel-false-draft]")) {
      draft.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this._confirmFalseInformation(draft.closest("[data-intel-category]"));
        } else if (event.key === "Escape") {
          event.preventDefault();
          this._closeFalseDraft(draft);
        }
      });
    }
    for (const button of this.element.querySelectorAll("[data-intel-remove-false]")) {
      button.addEventListener("click", () => button.closest("[data-intel-false-record]")?.remove());
    }
    for (const button of this.element.querySelectorAll("[data-intel-toggle-false]")) {
      button.addEventListener("click", () => this._toggleFalseInformation(button.closest("[data-intel-false-record]"), button));
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
