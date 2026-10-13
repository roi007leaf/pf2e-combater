import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";
import {
  TACTIC_ACTION_SLIDERS,
  TACTIC_TARGET_SLIDERS,
  TACTIC_TEMPERAMENTS,
} from "../rules/tactic-personality.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomId(prefix) {
  return `${prefix}-${globalThis.foundry?.utils?.randomID?.() ?? Date.now()}`;
}

function clampSlider(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-3, Math.min(3, Math.round(number))) : 0;
}

// Icon, tint and a one-line hint per role and temperament, shown on the picker cards.
function roleMeta() {
  return {
    auto: { icon: "fa-wand-magic-sparkles", tone: "gold", hint: t("Tactic.RoleHint.Auto", "Read from the creature") },
    "melee-striker": { icon: "fa-hand-fist", tone: "red", hint: t("Tactic.RoleHint.MeleeStriker", "Close in and hit hard") },
    "ranged-striker": { icon: "fa-bullseye", tone: "red", hint: t("Tactic.RoleHint.RangedStriker", "Attack from range") },
    "spell-damage": { icon: "fa-fire", tone: "red", hint: t("Tactic.RoleHint.SpellDamage", "Damage with spells") },
    healer: { icon: "fa-heart-pulse", tone: "green", hint: t("Tactic.RoleHint.Healer", "Keep allies standing") },
    buffer: { icon: "fa-arrow-up", tone: "green", hint: t("Tactic.RoleHint.Buffer", "Boost allies") },
    debuffer: { icon: "fa-arrow-down", tone: "blue", hint: t("Tactic.RoleHint.Debuffer", "Weaken enemies") },
    boss: { icon: "fa-crown", tone: "gold", hint: t("Tactic.RoleHint.Boss", "Big threat, uses its best tricks") },
    lieutenant: { icon: "fa-chess-rook", tone: "gold", hint: t("Tactic.RoleHint.Lieutenant", "Leads and supports the boss") },
    minion: { icon: "fa-user", tone: "blue", hint: t("Tactic.RoleHint.Minion", "Simple, expendable attacks") },
    brute: { icon: "fa-hammer", tone: "red", hint: t("Tactic.RoleHint.Brute", "Soak hits, deal heavy damage") },
    skirmisher: { icon: "fa-person-running", tone: "green", hint: t("Tactic.RoleHint.Skirmisher", "Hit and reposition") },
    artillery: { icon: "fa-meteor", tone: "red", hint: t("Tactic.RoleHint.Artillery", "Stay back, area damage") },
    controller: { icon: "fa-link", tone: "blue", hint: t("Tactic.RoleHint.Controller", "Lock down the battlefield") },
    defender: { icon: "fa-shield-halved", tone: "blue", hint: t("Tactic.RoleHint.Defender", "Protect allies, hold the line") },
    support: { icon: "fa-hands-holding", tone: "green", hint: t("Tactic.RoleHint.Support", "Help allies succeed") },
  };
}

function temperamentMeta() {
  return {
    auto: { icon: "fa-wand-magic-sparkles", tone: "gold", hint: t("Tactic.TemperamentHint.Auto", "From the creature") },
    aggressive: { icon: "fa-fire-flame-curved", tone: "red", hint: t("Tactic.TemperamentHint.Aggressive", "Presses the attack") },
    cautious: { icon: "fa-shield", tone: "blue", hint: t("Tactic.TemperamentHint.Cautious", "Avoids risk") },
    opportunist: { icon: "fa-eye", tone: "gold", hint: t("Tactic.TemperamentHint.Opportunist", "Goes for openings") },
    berserker: { icon: "fa-skull", tone: "red", hint: t("Tactic.TemperamentHint.Berserker", "Ignores its own safety") },
    coward: { icon: "fa-person-running", tone: "green", hint: t("Tactic.TemperamentHint.Coward", "Flees when hurt") },
  };
}

function optionModel(option, selected, meta = {}) {
  const id = String(option.id);
  return {
    icon: "fa-circle",
    tone: "blue",
    ...(meta[id] ?? {}),
    ...option,
    id,
    selected: id === selected,
  };
}

const STEP_VALUES = [-3, -2, -1, 0, 1, 2, 3];

function stepLabel(value) {
  if (value > 0) return `+${value}`;
  return value < 0 ? `−${Math.abs(value)}` : "0";
}

function sliderModel(prefix, slider, values) {
  const id = String(slider.id);
  const value = clampSlider(values?.[id]);
  return {
    ...slider,
    id,
    inputName: `${prefix}.${id}`,
    value,
    steps: STEP_VALUES.map((step) => ({ value: step, label: stepLabel(step), checked: step === value, mid: step === 0, negative: step < 0 })),
  };
}

function windowTitle(view) {
  if (view?.title) return view.title;
  return view?.actorName
    ? t("Tactic.ConfigureTitleFor", "Auto-fill tactic · {name}", { name: view.actorName })
    : t("Tactic.ConfigureTitle", "Auto-fill tactic");
}

function windowContext(view) {
  const custom = view?.custom ?? {};
  const role = view?.role ?? "auto";
  const temperament = view?.temperament ?? "auto";
  const bulkTokenCount = Math.max(0, Number(view?.bulkTokenCount) || 0);
  const bulkTokens = bulkTokenCount > 1;
  return {
    title: windowTitle(view),
    help: view?.help ?? t("Tactic.HelpShort", "How Auto-fill picks actions and targets for this creature."),
    showAdvanced: view?.showAdvanced === true,
    roleLabel: t("Tactic.Role", "Role"),
    temperamentLabel: t("Tactic.Temperament", "Temperament"),
    customLabel: t("Tactic.FineTune", "Fine-tune priorities"),
    customHelp: t("Tactic.FineTuneHelp", "Nudge the preset up or down per priority."),
    actionStyleLabel: t("Tactic.ActionStyle", "Action style"),
    targetStyleLabel: t("Tactic.TargetStyle", "Target style"),
    roles: (Array.isArray(view?.roles) ? view.roles : []).map((option) => optionModel(option, role, roleMeta())),
    temperaments: TACTIC_TEMPERAMENTS.map((option) => optionModel(option, temperament, temperamentMeta())),
    customEnabled: view?.showAdvanced === true && view?.customEnabled === true,
    actionSliders: TACTIC_ACTION_SLIDERS.map((slider) => sliderModel("action", slider, custom.action)),
    targetSliders: TACTIC_TARGET_SLIDERS.map((slider) => sliderModel("target", slider, custom.target)),
    sliderGroups: [
      { label: t("Tactic.ActionStyle", "Action style"), sliders: TACTIC_ACTION_SLIDERS.map((slider) => sliderModel("action", slider, custom.action)) },
      { label: t("Tactic.TargetStyle", "Target style"), sliders: TACTIC_TARGET_SLIDERS.map((slider) => sliderModel("target", slider, custom.target)) },
    ],
    avoidLabel: t("Tactic.ScaleAvoid", "Avoid"),
    presetLabel: t("Tactic.ScalePreset", "Preset"),
    preferLabel: t("Tactic.ScalePrefer", "Prefer"),
    learned: {
      visible: Array.isArray(view?.learned?.entries),
      title: t("Preference.LearnedTitle", "Learned from your choices"),
      help: t("Preference.LearnedHelp", "Thumbs up/down and your edits to Auto-filled plans teach it what you like."),
      empty: t("Preference.LearnedEmpty", "Nothing learned yet. Rate plans or edit what Auto-fill suggests."),
      forgetLabel: t("Preference.Forget", "Forget"),
      forgetAllLabel: t("Preference.ForgetAll", "Forget all"),
      entries: (view?.learned?.entries ?? []).map((entry) => ({
        ...entry,
        tone: entry.positive ? "is-positive" : "is-negative",
        icon: entry.kind ? "fa-layer-group" : "fa-bolt",
      })),
    },
    scopeLabel: t("Tactic.SaveFor", "Save for"),
    scopeTokenLabel: bulkTokens
      ? t("Tactic.ScopeSelected", "{count} selected NPCs", { count: bulkTokenCount })
      : t("Tactic.ScopeToken", "This token"),
    scopeActorLabel: t("Tactic.ScopeActor", "All tokens of this actor"),
    saveLabel: t("Tactic.Save", "Save"),
    resetShortLabel: t("Tactic.Reset", "Reset"),
    cancelLabel: t("Dialog.Cancel", "Cancel"),
    resetLabel: bulkTokens
      ? t("Tactic.ResetSelectedOverrides", "Reset {count} selected overrides", { count: bulkTokenCount })
      : t("Tactic.ResetTokenOverride", "Reset override"),
    saveActorLabel: t("Tactic.SaveActorDefault", "Save actor default"),
    saveTokenLabel: bulkTokens
      ? t("Tactic.SaveSelectedTokens", "Save to {count} selected NPCs", { count: bulkTokenCount })
      : t("Tactic.SaveTokenOverride", "Save token override"),
  };
}

export class TacticWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "pf2e-combater-tactic-window"],
    tag: "section",
    window: {
      frame: true,
      icon: "fa-solid fa-chess-knight",
      positioned: true,
      resizable: true,
    },
    position: {
      width: 600,
      height: "auto",
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/tactic-window.hbs`,
    },
  };

  constructor(view, options = {}) {
    const { onSave, onForget, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-tactic`), ...appOptions });
    this._view = view ?? {};
    this._onSave = typeof onSave === "function" ? onSave : null;
    this._onForget = typeof onForget === "function" ? onForget : null;
  }

  get title() {
    return windowTitle(this._view);
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return windowContext(this._view);
  }

  _form() {
    return this.element.querySelector("[data-tactic-form]");
  }

  _readForm() {
    const form = this._form();
    const read = (name) => form?.elements?.namedItem?.(name)?.value;
    const readChecked = (name) => form?.elements?.namedItem?.(name)?.checked === true;
    const action = {};
    const target = {};
    for (const slider of TACTIC_ACTION_SLIDERS) action[slider.id] = clampSlider(read(`action.${slider.id}`));
    for (const slider of TACTIC_TARGET_SLIDERS) target[slider.id] = clampSlider(read(`target.${slider.id}`));
    return {
      role: read("role") || "auto",
      temperament: this._view?.showAdvanced === true ? (read("temperament") || "auto") : "auto",
      customEnabled: this._view?.showAdvanced === true && readChecked("customEnabled"),
      custom: this._view?.showAdvanced === true ? { action, target } : null,
    };
  }

  _syncCustomVisibility() {
    const form = this._form();
    const enabled = form?.elements?.namedItem?.("customEnabled")?.checked === true;
    form?.classList.toggle("is-custom", enabled);
  }

  async _save(decision, button) {
    if (!button) return;
    button.disabled = true;
    try {
      await this._onSave?.(decision);
      await this.close();
    } finally {
      button.disabled = false;
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._syncCustomVisibility();
    this.element.querySelector("[data-tactic-close]")?.addEventListener("click", () => this.close());
    this.element.querySelector("[name='customEnabled']")?.addEventListener("change", () => this._syncCustomVisibility());
    // One Save button; the scope switch picks the token override or the actor default.
    this.element.querySelector("[data-tactic-save]")?.addEventListener("click", (event) => {
      const scope = this.element.querySelector("[name='tacticSaveScope']:checked")?.value;
      const tokenMode = Number(this._view?.bulkTokenCount) > 1 ? "tokens" : "token";
      this._save({ mode: scope === "actor" ? "actor" : tokenMode, value: this._readForm() }, event.currentTarget);
    });
    // Learned preferences: forget one, or all, then redraw from the fresh profile.
    for (const button of this.element.querySelectorAll("[data-learned-forget]")) {
      button.addEventListener("click", async () => {
        if (!this._onForget) return;
        button.disabled = true;
        this._view = { ...this._view, learned: await this._onForget(button.dataset.learnedForget || null) };
        await this.render();
      });
    }
    this.element.querySelector("[data-tactic-reset]")?.addEventListener("click", (event) =>
      this._save({ mode: Number(this._view?.bulkTokenCount) > 1 ? "reset-tokens" : "reset" }, event.currentTarget));
  }
}

export async function openTacticWindow(view, options = {}) {
  const window = new TacticWindow(view, options);
  await window.render({ force: true });
  return window;
}
