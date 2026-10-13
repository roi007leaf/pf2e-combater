import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function randomId(prefix) {
  return `${prefix}-${globalThis.foundry?.utils?.randomID?.() ?? Date.now()}`;
}

export function loadoutWindowView(advice = [], actorName = "") {
  const recommendations = (Array.isArray(advice) ? advice : []).map((entry, index) => {
    const scoreLabel = t("Loadout.Score", "+{score} fit", { score: entry.score });
    const explanation = (Array.isArray(entry?.reasons) ? entry.reasons : []).join(" ");
    return {
      ...entry,
      rank: index + 1,
      best: index === 0,
      scoreLabel,
      bestLabel: t("Loadout.Best", "Best"),
      addLabel: t("Loadout.AddSwap", "Add swap to plan"),
      fitTooltip: explanation
        ? t("Loadout.FitTooltip", "Why {score}: {explanation}", { score: scoreLabel, explanation })
        : t("Loadout.FitTooltipFallback", "{score} for current battlefield conditions.", { score: scoreLabel }),
    };
  });
  return {
    title: actorName ? t("Loadout.TitleFor", "Loadout · {name}", { name: actorName }) : t("Loadout.Title", "Loadout Advisor"),
    help: t("Loadout.HelpShort", "Gear swaps that suit the current battlefield."),
    closeLabel: t("Dialog.Close", "Close"),
    recommendations,
    hasRecommendations: recommendations.length > 0,
    empty: t("Loadout.Empty", "Current held gear already fits visible battlefield conditions."),
  };
}

export class LoadoutWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "pf2e-combater-loadout-window"],
    tag: "section",
    window: {
      frame: true,
      icon: "fa-solid fa-shield-halved",
      positioned: true,
      resizable: true,
    },
    position: { width: 560, height: "auto" },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/loadout-window.hbs` },
  };

  constructor(view, options = {}) {
    const { onChoose, ...appOptions } = options;
    super({ id: randomId(`${MODULE_ID}-loadout`), ...appOptions });
    this._view = view;
    this._onChoose = typeof onChoose === "function" ? onChoose : null;
  }

  get title() {
    return this._view?.title ?? t("Loadout.Title", "Loadout Advisor");
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    return this._view;
  }

  async _choose(id, button) {
    if (!id || !button) return;
    button.disabled = true;
    try {
      const applied = await this._onChoose?.(id);
      if (applied !== false) await this.close();
    } finally {
      button.disabled = false;
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[data-loadout-close]")?.addEventListener("click", () => this.close());
    for (const button of this.element.querySelectorAll("[data-apply-loadout]")) {
      button.addEventListener("click", () => this._choose(button.dataset.applyLoadout, button));
    }
  }
}

export async function openLoadoutWindow(view, options = {}) {
  const window = new LoadoutWindow(view, options);
  await window.render({ force: true });
  return window;
}
