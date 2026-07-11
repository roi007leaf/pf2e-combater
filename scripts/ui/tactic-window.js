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

function optionModel(option, selected) {
  const id = String(option.id);
  return {
    ...option,
    id,
    selected: id === selected,
  };
}

function sliderModel(prefix, slider, values) {
  const id = String(slider.id);
  return {
    ...slider,
    id,
    inputName: `${prefix}.${id}`,
    value: clampSlider(values?.[id]),
  };
}

function windowContext(view) {
  const custom = view?.custom ?? {};
  const role = view?.role ?? "auto";
  const temperament = view?.temperament ?? "auto";
  return {
    title: view?.title ?? t("Tactic.ConfigureTitle", "Auto-fill tactic"),
    help: view?.help ?? t("Tactic.Help", "Set this actor's tactical profile. Auto-fill and shuffle weight actions and targets from it."),
    showAdvanced: view?.showAdvanced === true,
    roleLabel: t("Tactic.Role", "Role"),
    temperamentLabel: t("Tactic.Temperament", "Temperament"),
    customLabel: t("Tactic.CustomizePreset", "Customize preset"),
    customHelp: t("Tactic.CustomHelp", "Adjust the selected preset with custom priorities."),
    actionStyleLabel: t("Tactic.ActionStyle", "Action style"),
    targetStyleLabel: t("Tactic.TargetStyle", "Target style"),
    roles: (Array.isArray(view?.roles) ? view.roles : []).map((option) => optionModel(option, role)),
    temperaments: TACTIC_TEMPERAMENTS.map((option) => optionModel(option, temperament)),
    customEnabled: view?.showAdvanced === true && view?.customEnabled === true,
    actionSliders: TACTIC_ACTION_SLIDERS.map((slider) => sliderModel("action", slider, custom.action)),
    targetSliders: TACTIC_TARGET_SLIDERS.map((slider) => sliderModel("target", slider, custom.target)),
    cancelLabel: t("Dialog.Cancel", "Cancel"),
    resetLabel: t("Tactic.ResetTokenOverride", "Reset override"),
    saveActorLabel: t("Tactic.SaveActorDefault", "Save actor default"),
    saveTokenLabel: t("Tactic.SaveTokenOverride", "Save token override"),
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
    const { onSave, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-tactic`), ...appOptions });
    this._view = view ?? {};
    this._onSave = typeof onSave === "function" ? onSave : null;
  }

  get title() {
    return this._view?.title ?? t("Tactic.ConfigureTitle", "Auto-fill tactic");
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
    this.element.querySelector("[data-tactic-save-actor]")?.addEventListener("click", (event) =>
      this._save({ mode: "actor", value: this._readForm() }, event.currentTarget));
    this.element.querySelector("[data-tactic-save-token]")?.addEventListener("click", (event) =>
      this._save({ mode: "token", value: this._readForm() }, event.currentTarget));
    this.element.querySelector("[data-tactic-reset]")?.addEventListener("click", (event) =>
      this._save({ mode: "reset" }, event.currentTarget));
  }
}

export async function openTacticWindow(view, options = {}) {
  const window = new TacticWindow(view, options);
  await window.render({ force: true });
  return window;
}
