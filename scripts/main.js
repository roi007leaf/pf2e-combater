import { MODULE_ID } from "./constants.js";
import { registerSettings, setting, SETTINGS } from "./settings.js";
import { documentRelevantToContext } from "./state/context-relevance.js";
import {
  captureMovementOrigin,
  clearMovementActionSpends,
  consumeTokenRefreshChange,
  markMovementActionSpent,
  tokenUpdateAffectsCombatGeometry,
} from "./state/token-refresh.js";

let activePanel = null;
let refreshTimer = null;

function activeContext() {
  return activePanel?.context ?? activePanel?._context ?? null;
}

function handlePanelClosed(panel) {
  if (activePanel === panel) activePanel = null;
}

async function openCurrent(source) {
  const { openPanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
  activePanel = await openPanelForCurrentCombatant(activePanel, source, { onClose: handlePanelClosed });
}

function scheduleRefresh(source) {
  if (!activePanel) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (!activePanel) return;
    openCurrent(source).catch((error) => {
      console.warn(`${MODULE_ID} | Refresh failed`, error);
    });
  }, 150);
}

function scheduleDocumentRefresh(document, source) {
  if (!documentRelevantToContext(document, activeContext())) return;
  scheduleRefresh(source);
}

Hooks.once("init", () => {
  registerSettings();

  game.keybindings.register(MODULE_ID, "togglePanel", {
    name: "Toggle PF2e Combater",
    hint: "Open or close the PF2e Combater tactical advisor panel.",
    editable: [{ key: "KeyC", modifiers: ["Alt", "Shift"] }],
    onDown: async () => {
      const { togglePanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
      activePanel = await togglePanelForCurrentCombatant(activePanel, "keybinding", { onClose: handlePanelClosed });
      return true;
    },
  });
});

Hooks.once("ready", async () => {
  console.log("PF2e Combater | Ready");
  if (!setting(SETTINGS.autoOpen)) return;
  if (!game.combat?.started) return;
  await openCurrent("ready");
});

Hooks.on("deleteCombat", (combat) => {
  const activeCombatId = activeContext()?.combat?.id;
  const isActiveCombat = activeCombatId && activeCombatId === combat.id;
  const isCurrentCombat = game.combat && combat === game.combat;
  if (!isActiveCombat && !isCurrentCombat) return;
  clearMovementActionSpends();
  if (activePanel) {
    const panel = activePanel;
    activePanel = null;
    panel.close().catch((error) => {
      console.warn(`${MODULE_ID} | Close failed`, error);
    });
  }
});

Hooks.on("updateCombat", async (combat, changed) => {
  if (combat !== game.combat) return;
  if (!combat.started) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  if (!setting(SETTINGS.autoOpen) && !activePanel) return;
  await openCurrent("combat-turn");
});

Hooks.on("preUpdateToken", (token, changed) => {
  captureMovementOrigin(token, { changed });
});

Hooks.on("updateToken", (token, changed, options) => {
  const movementSpent = markMovementActionSpent(token, { changed, options });
  if (!tokenUpdateAffectsCombatGeometry(changed)) return;
  scheduleRefresh(movementSpent ? "token-movement" : "token-update");
});

Hooks.on("refreshToken", (token) => {
  if (!consumeTokenRefreshChange(token)) return;
  scheduleRefresh("token-refresh");
});

Hooks.on("targetToken", (user) => {
  if (user !== game.user) return;
  scheduleRefresh("target-change");
});

Hooks.on("updateActor", (actor) => {
  scheduleDocumentRefresh(actor, "actor-update");
});

Hooks.on("createItem", (item) => {
  scheduleDocumentRefresh(item, "item-create");
});

Hooks.on("updateItem", (item) => {
  scheduleDocumentRefresh(item, "item-update");
});

Hooks.on("deleteItem", (item) => {
  scheduleDocumentRefresh(item, "item-delete");
});

Hooks.on("createActiveEffect", (effect) => {
  scheduleDocumentRefresh(effect, "effect-create");
});

Hooks.on("updateActiveEffect", (effect) => {
  scheduleDocumentRefresh(effect, "effect-update");
});

Hooks.on("deleteActiveEffect", (effect) => {
  scheduleDocumentRefresh(effect, "effect-delete");
});
