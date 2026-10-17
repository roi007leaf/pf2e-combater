import { MODULE_ID } from "./constants.js";

const SETTINGS = {
  autoOpen: "autoOpen",
  autoOpenNpcTurnsOnly: "autoOpenNpcTurnsOnly",
  showReactionMarker: "showReactionMarker",
  compactDefault: "compactDefault",
  panelMode: "panelMode",
  playerPanelMode: "playerPanelMode",
  minimalParts: "minimalParts",
  rememberPanelPosition: "rememberPanelPosition",
  showTurnNavigation: "showTurnNavigation",
  enableSpellRecommendations: "enableSpellRecommendations",
  hideUntrainedSkillActions: "hideUntrainedSkillActions",
  includeUnknownCustomActions: "includeUnknownCustomActions",
  hideAutoFillFromPlayers: "hideAutoFillFromPlayers",
  nativeRollContextPreflight: "nativeRollContextPreflight",
  showDebugTab: "showDebugTab",
  disableForPlayers: "disableForPlayers",
  flankingSizeRule: "flankingSizeRule",
  raisePcShieldsWhenDefending: "raisePcShieldsWhenDefending",
  enrageBarbariansAtCombatStart: "enrageBarbariansAtCombatStart",
  learnObservedIntel: "learnObservedIntel",
};

// Parts of the minimal bar a user can switch off (Customize minimal bar).
export const MINIMAL_PARTS = ["autofill", "browse", "setup", "cycle", "plan", "tracker", "readied", "delay", "upcoming", "turn"];

export function minimalHiddenParts() {
  const shown = settingOrDefault(SETTINGS.minimalParts, {}) ?? {};
  return MINIMAL_PARTS.filter((part) => shown[part] === false);
}

export function registerSettings({ decorateFlankingFormGroup, minimalPartsMenu } = {}) {
  game.settings.register(MODULE_ID, SETTINGS.autoOpen, {
    name: "PF2E_COMBATER.Settings.AutoOpen.Name",
    hint: "PF2E_COMBATER.Settings.AutoOpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  // GM only: open the window by itself on NPC turns, and put it away on player-owned turns.
  game.settings.register(MODULE_ID, SETTINGS.autoOpenNpcTurnsOnly, {
    name: "PF2E_COMBATER.Settings.AutoOpenNpcTurnsOnly.Name",
    hint: "PF2E_COMBATER.Settings.AutoOpenNpcTurnsOnly.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.showReactionMarker, {
    name: "PF2E_COMBATER.Settings.ShowReactionMarker.Name",
    hint: "PF2E_COMBATER.Settings.ShowReactionMarker.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll("pf2e-combater.reactionMarkerChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.compactDefault, {
    name: "PF2E_COMBATER.Settings.CompactDefault.Name",
    hint: "PF2E_COMBATER.Settings.CompactDefault.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  // Tracker only: the minimal bar (action tracker, End turn, Delay/Ready) with the planner
  // switched off. The GM picks what players get by default; each user can override it.
  game.settings.register(MODULE_ID, SETTINGS.panelMode, {
    name: "PF2E_COMBATER.Settings.PanelMode.Name",
    hint: "PF2E_COMBATER.Settings.PanelMode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      default: "PF2E_COMBATER.Settings.PanelMode.Choices.Default",
      tracker: "PF2E_COMBATER.Settings.PanelMode.Choices.Tracker",
      full: "PF2E_COMBATER.Settings.PanelMode.Choices.Full",
    },
    default: "default",
    onChange: () => Hooks.callAll("pf2e-combater.panelModeChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.playerPanelMode, {
    name: "PF2E_COMBATER.Settings.PlayerPanelMode.Name",
    hint: "PF2E_COMBATER.Settings.PlayerPanelMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      full: "PF2E_COMBATER.Settings.PanelMode.Choices.Full",
      tracker: "PF2E_COMBATER.Settings.PanelMode.Choices.Tracker",
    },
    default: "full",
    onChange: () => Hooks.callAll("pf2e-combater.panelModeChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.minimalParts, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
    onChange: () => Hooks.callAll("pf2e-combater.minimalPartsChanged"),
  });

  if (minimalPartsMenu) {
    game.settings.registerMenu(MODULE_ID, "minimalPartsMenu", {
      name: "PF2E_COMBATER.Settings.MinimalParts.Name",
      label: "PF2E_COMBATER.Settings.MinimalParts.Label",
      hint: "PF2E_COMBATER.Settings.MinimalParts.Hint",
      icon: "fa-solid fa-sliders",
      type: minimalPartsMenu,
      restricted: false,
    });
  }

  game.settings.register(MODULE_ID, SETTINGS.rememberPanelPosition, {
    name: "PF2E_COMBATER.Settings.RememberPanelPosition.Name",
    hint: "PF2E_COMBATER.Settings.RememberPanelPosition.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.showTurnNavigation, {
    name: "PF2E_COMBATER.Settings.ShowTurnNavigation.Name",
    hint: "PF2E_COMBATER.Settings.ShowTurnNavigation.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll("pf2e-combater.turnNavigationChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.enableSpellRecommendations, {
    name: "PF2E_COMBATER.Settings.EnableSpellRecommendations.Name",
    hint: "PF2E_COMBATER.Settings.EnableSpellRecommendations.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.hideUntrainedSkillActions, {
    name: "PF2E_COMBATER.Settings.HideUntrainedSkillActions.Name",
    hint: "PF2E_COMBATER.Settings.HideUntrainedSkillActions.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.includeUnknownCustomActions, {
    name: "PF2E_COMBATER.Settings.IncludeUnknownCustomActions.Name",
    hint: "PF2E_COMBATER.Settings.IncludeUnknownCustomActions.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.hideAutoFillFromPlayers, {
    name: "PF2E_COMBATER.Settings.HideAutoFillFromPlayers.Name",
    hint: "PF2E_COMBATER.Settings.HideAutoFillFromPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.nativeRollContextPreflight, {
    name: "PF2E_COMBATER.Settings.NativeRollContextPreflight.Name",
    hint: "PF2E_COMBATER.Settings.NativeRollContextPreflight.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Hooks.callAll("pf2e-combater.preflightSettingChanged"),
  });

  game.settings.register(MODULE_ID, SETTINGS.showDebugTab, {
    name: "PF2E_COMBATER.Settings.ShowDebugTab.Name",
    hint: "PF2E_COMBATER.Settings.ShowDebugTab.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.disableForPlayers, {
    name: "PF2E_COMBATER.Settings.DisableForPlayers.Name",
    hint: "PF2E_COMBATER.Settings.DisableForPlayers.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => Hooks.callAll("pf2e-combater.playerAccessChanged"),
  });

  const flankingChoices = {
    raw: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.Raw",
    anySquare: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.AnySquare",
    anyCorner: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.AnyCorner",
    lineThrough: "PF2E_COMBATER.Settings.FlankingSizeRule.Choices.LineThrough",
  };
  const StringField = globalThis.foundry?.data?.fields?.StringField;
  const flankingType = StringField && decorateFlankingFormGroup
    ? new (class extends StringField {
      toFormGroup(groupConfig, inputConfig) {
        const group = super.toFormGroup(groupConfig, inputConfig);
        decorateFlankingFormGroup(group);
        return group;
      }
    })({ required: true, choices: flankingChoices, initial: "raw" })
    : String;
  game.settings.register(MODULE_ID, SETTINGS.flankingSizeRule, {
    name: "PF2E_COMBATER.Settings.FlankingSizeRule.Name",
    hint: "PF2E_COMBATER.Settings.FlankingSizeRule.Hint",
    scope: "world",
    config: true,
    type: flankingType,
    choices: flankingChoices,
    default: "raw",
  });
  game.settings.register(MODULE_ID, SETTINGS.raisePcShieldsWhenDefending, {
    name: "PF2E_COMBATER.Settings.RaisePcShieldsWhenDefending.Name",
    hint: "PF2E_COMBATER.Settings.RaisePcShieldsWhenDefending.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.enrageBarbariansAtCombatStart, {
    name: "PF2E_COMBATER.Settings.EnrageBarbariansAtCombatStart.Name",
    hint: "PF2E_COMBATER.Settings.EnrageBarbariansAtCombatStart.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MODULE_ID, SETTINGS.learnObservedIntel, {
    name: "PF2E_COMBATER.Settings.LearnObservedIntel.Name",
    hint: "PF2E_COMBATER.Settings.LearnObservedIntel.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "visionerCombatSettingsMigrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

export async function migrateVisionerCombatSettings() {
  if (!game.user?.isActiveGM || !game.modules?.get?.("pf2e-visioner")?.active) return;
  if (setting("visionerCombatSettingsMigrated")) return;
  for (const key of [SETTINGS.flankingSizeRule, SETTINGS.raisePcShieldsWhenDefending, SETTINGS.enrageBarbariansAtCombatStart]) {
    try {
      const legacy = game.settings.get("pf2e-visioner", key);
      const current = setting(key);
      const defaultValue = key === SETTINGS.flankingSizeRule ? "raw" : false;
      if (legacy === undefined || legacy === defaultValue) continue;
      if (current === defaultValue && legacy !== "oppositeArcs") {
        await game.settings.set(MODULE_ID, key, legacy);
      }
      await game.settings.set("pf2e-visioner", key, defaultValue);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not migrate Visioner combat setting ${key}:`, error);
      return;
    }
  }
  await game.settings.set(MODULE_ID, "visionerCombatSettingsMigrated", true);
}

export async function migrateDeprecatedFlankingRule() {
  if (!game.user?.isActiveGM) return;
  if (setting(SETTINGS.flankingSizeRule) === "oppositeArcs") {
    await game.settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "raw");
  }
}

// GM can lock players out of the panel entirely; the GM's own access is never affected.
export function playerAccessAllowed() {
  if (game.user?.isGM === true) return true;
  try {
    return !game.settings.get(MODULE_ID, SETTINGS.disableForPlayers);
  } catch (_error) {
    return true;
  }
}

// The user's own choice wins; otherwise players get the GM's default and the GM gets the planner.
export function trackerOnlyMode() {
  const own = settingOrDefault(SETTINGS.panelMode, "default");
  if (own === "tracker" || own === "full") return own === "tracker";
  return game.user?.isGM !== true && settingOrDefault(SETTINGS.playerPanelMode, "full") === "tracker";
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function settingOrDefault(key, fallback) {
  try {
    const value = setting(key);
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

export { SETTINGS };
