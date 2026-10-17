import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";
import { MINIMAL_PARTS, SETTINGS, minimalHiddenParts } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function partLabels() {
  return {
    autofill: [t("MinimalParts.AutoFill", "Auto-fill"), t("MinimalParts.AutoFillHint", "Fill the turn with the best plan.")],
    browse: [t("MinimalParts.Browse", "Browse"), t("MinimalParts.BrowseHint", "Open the action browser to add steps.")],
    setup: [t("MinimalParts.Setup", "Plan setup"), t("MinimalParts.SetupHint", "Tactic, intel, resources, turn intent and loadout.")],
    cycle: [t("MinimalParts.Cycle", "Plan choice"), t("MinimalParts.CycleHint", "Step through Auto-fill's plans, and why this one.")],
    plan: [t("MinimalParts.Plan", "Plan steps"), t("MinimalParts.PlanHint", "Your planned steps; click one to run it or make the choice it needs, right-click for its options.")],
    tracker: [t("MinimalParts.Tracker", "Action tracker"), t("MinimalParts.TrackerHint", "Action and reaction glyphs, and condition icons.")],
    readied: [t("MinimalParts.Readied", "Readied action"), t("MinimalParts.ReadiedHint", "A readied action with its Use and Discard buttons.")],
    delay: [t("MinimalParts.Delay", "Delay"), t("MinimalParts.DelayHint", "Delaying, Jump in, and the GM's Jump in for waiting creatures.")],
    upcoming: [t("MinimalParts.Upcoming", "Upcoming turns"), t("MinimalParts.UpcomingHint", "Who acts next.")],
    turn: [t("MinimalParts.Turn", "End turn"), t("MinimalParts.TurnHint", "End turn, with Delay and Ready in its menu.")],
  };
}

// Settings menu: which parts the minimal bar shows. Saved per user.
export class MinimalPartsMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-minimal-parts`,
    classes: [MODULE_ID, "pf2e-combater-minimal-parts"],
    tag: "form",
    window: { icon: "fa-solid fa-sliders" },
    position: { width: 420, height: "auto" },
    form: { handler: MinimalPartsMenu.#save, closeOnSubmit: true },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/minimal-parts.hbs` },
  };

  get title() {
    return t("MinimalParts.Title", "Customize minimal bar");
  }

  async _prepareContext(options) {
    await super._prepareContext(options);
    const hidden = new Set(minimalHiddenParts());
    const labels = partLabels();
    return {
      intro: t("MinimalParts.Intro", "Choose what the minimal bar shows. Only affects you."),
      parts: MINIMAL_PARTS.map((part) => ({ part, label: labels[part][0], hint: labels[part][1], checked: !hidden.has(part) })),
      saveLabel: t("MinimalParts.Save", "Save"),
    };
  }

  static async #save(_event, _form, formData) {
    const data = formData.object ?? {};
    const parts = Object.fromEntries(MINIMAL_PARTS.map((part) => [part, data[part] === true]));
    await game.settings.set(MODULE_ID, SETTINGS.minimalParts, parts);
  }
}
