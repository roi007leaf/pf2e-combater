import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomId(prefix) {
  return `${prefix}-${globalThis.foundry?.utils?.randomID?.() ?? Date.now()}`;
}

export function effectClockWindowView(clock) {
  const groups = (clock?.groups ?? []).map((group) => ({
    ...group,
    entries: (group?.entries ?? []).map((entry) => ({
      ...entry,
      canOpen: Boolean(entry?.documentUuid),
    })),
  }));
  const urgentCount = Number(clock?.urgentCount ?? 0);
  const totalCount = Number(clock?.totalCount ?? 0);
  return {
    title: t("EffectClock.Title", "Effect Clock"),
    help: t("EffectClock.Help", "Turn-aware timing for PF2e effects, conditions, and turn-boundary events. Native PF2e duration rules remain authoritative."),
    summary: urgentCount > 0
      ? t("EffectClock.UrgentSummary", "{urgent} of {total} tracked events need attention this turn.", { urgent: urgentCount, total: totalCount })
      : t("EffectClock.ClearSummary", "{total} timed events tracked; nothing needs attention this turn.", { total: totalCount }),
    groups,
    hasEntries: totalCount > 0,
    empty: t("EffectClock.Empty", "No finite effects or turn-end condition events to track."),
  };
}

export class EffectClockWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "pf2e-combater-effect-clock-window"],
    tag: "section",
    window: {
      frame: true,
      icon: "fa-solid fa-hourglass-half",
      positioned: true,
      resizable: true,
    },
    position: { width: 600, height: "auto" },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/effect-clock-window.hbs` },
  };

  constructor(view, options = {}) {
    const { onOpen, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-effect-clock`), ...appOptions });
    this._view = view;
    this._onOpen = typeof onOpen === "function" ? onOpen : null;
  }

  get title() {
    return this._view?.title ?? t("EffectClock.Title", "Effect Clock");
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return this._view;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-effect-clock-close]")?.addEventListener("click", () => this.close());
    for (const button of this.element.querySelectorAll("[data-effect-clock-open]")) {
      button.addEventListener("click", () => this._onOpen?.(button.dataset.effectClockOpen));
    }
  }
}

export async function openEffectClockWindow(view, options = {}) {
  const window = new EffectClockWindow(view, options);
  await window.render({ force: true });
  return window;
}
