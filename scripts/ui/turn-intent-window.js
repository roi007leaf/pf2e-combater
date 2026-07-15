import { MODULE_ID } from "../constants.js";
import { currentTargetSelection } from "../engine/action/executor.js";
import { actionKey } from "../engine/planner/rules.js";
import { contextTargets } from "../engine/target-pool.js";
import { normalizeTurnIntent } from "../engine/planner/turn-intent.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomId(prefix) {
  return `${prefix}-${globalThis.foundry?.utils?.randomID?.() ?? Date.now()}`;
}

function targetIdentityValues(target) {
  return [target?.id, target?.uuid, target?.token?.id, target?.token?.uuid]
    .filter(Boolean)
    .map(String);
}

function targetSelection(context, intent) {
  const currentIds = currentTargetSelection().targetTokenIds.map(String);
  const ids = currentIds.length ? currentIds : intent.lockedTargetIds;
  const idSet = new Set(ids);
  const targets = contextTargets(context).filter((target) => targetIdentityValues(target).some((id) => idSet.has(id)));
  return {
    ids,
    names: targets.map((target) => target?.name ?? target?.actor?.name).filter(Boolean),
  };
}

function actionOptions(candidates, selectedKey) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      key: String(actionKey(candidate) ?? ""),
      name: String(candidate?.name ?? candidate?.label ?? candidate?.slug ?? "Action"),
    }))
    .filter((option) => option.key && !seen.has(option.key) && seen.add(option.key))
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((option) => ({ ...option, selected: option.key === selectedKey }));
}

export function turnIntentWindowView(context, value, candidates = []) {
  const intent = normalizeTurnIntent(value);
  const selection = targetSelection(context, intent);
  const targetLabel = selection.names.length
    ? selection.names.join(", ")
    : t("TurnIntent.NoTargets", "No targets selected");
  return {
    intent,
    captureTargetIds: selection.ids,
    title: t("TurnIntent.Title", "Turn Intent"),
    help: t("TurnIntent.Help", "Temporary constraints for this combatant's current turn. Auto-fill and shuffle both obey them."),
    targetLabel,
    canLockTarget: selection.ids.length > 0,
    lockTarget: intent.lockedTargetIds.length > 0,
    actionOptions: actionOptions(candidates, intent.requiredActionKey),
  };
}

export class TurnIntentWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "pf2e-combater-turn-intent-window"],
    tag: "section",
    window: {
      frame: true,
      icon: "fa-solid fa-bullseye",
      positioned: true,
      resizable: false,
    },
    position: { width: 480, height: "auto" },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/turn-intent-window.hbs` },
  };

  constructor(view, options = {}) {
    const { onSave, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-turn-intent`), ...appOptions });
    this._view = view;
    this._onSave = typeof onSave === "function" ? onSave : null;
  }

  get title() {
    return this._view?.title ?? t("TurnIntent.Title", "Turn Intent");
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return this._view;
  }

  _readIntent() {
    const form = this.element.querySelector("[data-turn-intent-form]");
    const checked = (name) => form?.elements?.namedItem?.(name)?.checked === true;
    const value = (name) => String(form?.elements?.namedItem?.(name)?.value ?? "");
    return normalizeTurnIntent({
      lockedTargetIds: checked("lockTarget") ? this._view.captureTargetIds : [],
      requiredActionKey: value("requiredActionKey"),
      noSpellSlots: checked("noSpellSlots"),
      stayRanged: checked("stayRanged"),
      endInCover: checked("endInCover"),
      preserveFinalAction: checked("preserveFinalAction"),
    });
  }

  async _finish(intent, button) {
    if (!button) return;
    button.disabled = true;
    try {
      await this._onSave?.(intent);
      await this.close();
    } finally {
      button.disabled = false;
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-turn-intent-cancel]")?.addEventListener("click", () => this.close());
    this.element.querySelector("[data-turn-intent-clear]")?.addEventListener("click", (event) =>
      this._finish(normalizeTurnIntent(), event.currentTarget));
    this.element.querySelector("[data-turn-intent-save]")?.addEventListener("click", (event) =>
      this._finish(this._readIntent(), event.currentTarget));
  }
}

export async function openTurnIntentWindow(view, options = {}) {
  const window = new TurnIntentWindow(view, options);
  await window.render({ force: true });
  return window;
}
