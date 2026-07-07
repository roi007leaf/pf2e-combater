import { MODULE_ID } from "./constants.js";

const SETTINGS = {
  autoOpen: "autoOpen",
  compactDefault: "compactDefault",
  rememberPanelPosition: "rememberPanelPosition",
  enableSpellRecommendations: "enableSpellRecommendations",
  hideUntrainedSkillActions: "hideUntrainedSkillActions",
  includeUnknownCustomActions: "includeUnknownCustomActions",
  hideAutoFillFromPlayers: "hideAutoFillFromPlayers",
  showDebugTab: "showDebugTab",
  disableForPlayers: "disableForPlayers",
};

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.autoOpen, {
    name: "PF2E_COMBATER.Settings.AutoOpen.Name",
    hint: "PF2E_COMBATER.Settings.AutoOpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.compactDefault, {
    name: "PF2E_COMBATER.Settings.CompactDefault.Name",
    hint: "PF2E_COMBATER.Settings.CompactDefault.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.rememberPanelPosition, {
    name: "PF2E_COMBATER.Settings.RememberPanelPosition.Name",
    hint: "PF2E_COMBATER.Settings.RememberPanelPosition.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
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
