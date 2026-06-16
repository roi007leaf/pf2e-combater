import { MODULE_ID } from "./constants.js";

const SETTINGS = {
  autoOpen: "autoOpen",
  compactDefault: "compactDefault",
  rememberPanelPosition: "rememberPanelPosition",
  enableSpellRecommendations: "enableSpellRecommendations",
  includeUnknownCustomActions: "includeUnknownCustomActions",
  showDebugTab: "showDebugTab",
};

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.autoOpen, {
    name: "Auto-open on turn start",
    hint: "Open the PF2e Combater panel when a combatant's turn starts.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.compactDefault, {
    name: "Compact by default",
    hint: "Open the panel in compact mode before any saved panel state exists.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.rememberPanelPosition, {
    name: "Remember panel position",
    hint: "Save the floating panel position on this client.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.enableSpellRecommendations, {
    name: "Enable spell recommendations",
    hint: "Include curated spells in recommended full-turn plans.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.includeUnknownCustomActions, {
    name: "Show unknown custom actions in alternatives",
    hint: "Show actor actions that PF2e Combater can detect but not tactically score.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, SETTINGS.showDebugTab, {
    name: "Show GM debug tab",
    hint: "Allow GMs to inspect scoring inputs, rejected actions, and detected actor actions.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
  });
}

export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

export { SETTINGS };
