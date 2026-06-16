import { MODULE_ID } from "./constants.js";
import { registerSettings, setting, SETTINGS } from "./settings.js";

let activePanel = null;
let refreshTimer = null;

function activeContext() {
  return activePanel?.context ?? activePanel?._context ?? null;
}

function actorId(actor) {
  return actor?.document?.id ?? actor?.id ?? null;
}

function documentActorId(document) {
  return actorId(document?.actor ?? document?.parent ?? document);
}

function contextTargets(context) {
  return context?.targets ?? context?.battlefield?.targets ?? [];
}

function actorRelevantToActiveContext(document) {
  const id = documentActorId(document);
  if (!id) return false;

  const context = activeContext();
  if (!context) return false;

  if (id === actorId(context.actor) || id === actorId(context.combatant?.actor)) return true;
  return contextTargets(context).some((target) => id === actorId(target?.actor));
}

async function openCurrent(source) {
  const { openPanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
  activePanel = await openPanelForCurrentCombatant(activePanel, source);
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

Hooks.once("init", () => {
  registerSettings();

  game.keybindings.register(MODULE_ID, "togglePanel", {
    name: "Toggle PF2e Combater",
    hint: "Open or close the PF2e Combater tactical advisor panel.",
    editable: [{ key: "KeyC", modifiers: ["Alt", "Shift"] }],
    onDown: async () => {
      const { togglePanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
      activePanel = await togglePanelForCurrentCombatant(activePanel, "keybinding");
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
  if (activePanel) {
    activePanel.close();
    activePanel = null;
  }
});

Hooks.on("updateCombat", async (combat, changed) => {
  if (combat !== game.combat) return;
  if (!combat.started) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  if (!setting(SETTINGS.autoOpen)) return;
  await openCurrent("combat-turn");
});

Hooks.on("updateToken", (_token, changed) => {
  if (!("x" in changed) && !("y" in changed) && !("hidden" in changed)) return;
  scheduleRefresh("token-update");
});

Hooks.on("targetToken", (user) => {
  if (user !== game.user) return;
  scheduleRefresh("target-change");
});

Hooks.on("updateActor", (actor) => {
  if (!actorRelevantToActiveContext(actor)) return;
  scheduleRefresh("actor-update");
});

Hooks.on("createItem", (item) => {
  if (!actorRelevantToActiveContext(item)) return;
  scheduleRefresh("item-create");
});

Hooks.on("updateItem", (item) => {
  if (!actorRelevantToActiveContext(item)) return;
  scheduleRefresh("item-update");
});

Hooks.on("deleteItem", (item) => {
  if (!actorRelevantToActiveContext(item)) return;
  scheduleRefresh("item-delete");
});
