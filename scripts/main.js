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
import { writeSharedDraftPlanPayload } from "./state/draft-plans.js";
import { clearMovementPreview } from "./ui/movement-preview.js";
import { cancelDestinationPicker } from "./ui/destination-picker.js";
import { promptUnsustainedSpellCleanup } from "./rules/sustained-spells.js";

let activePanel = null;
let refreshTimer = null;
let autoOpenSuppressed = false;

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

function tokenIdentityValues(value) {
  const document = value?.document ?? value;
  return [
    value?.id,
    value?.uuid,
    value?.tokenId,
    value?.tokenUuid,
    document?.id,
    document?.uuid,
    value?.object?.id,
    value?.object?.uuid,
    value?.object?.document?.id,
    value?.object?.document?.uuid,
  ]
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => String(entry));
}

function tokenMatchesCombatant(token, combatant) {
  const tokenIds = new Set(tokenIdentityValues(token));
  if (!tokenIds.size) return false;

  const references = [
    combatant?.token?.object,
    combatant?.token,
    combatant?.tokenDocument,
    combatant?.document?.token,
    { id: combatant?.tokenId, uuid: combatant?.tokenUuid },
  ];
  return references.some((value) =>
    tokenIdentityValues(value).some((id) => tokenIds.has(id)),
  );
}

function inlineTurnCombatant(combat = game.combat) {
  const turnIndex = Number(combat?.turn);
  const turns = collectionValues(combat?.turns);
  if (Number.isInteger(turnIndex) && turnIndex >= 0 && turnIndex < turns.length) {
    return turns[turnIndex] ?? null;
  }
  return combat?.combatant ?? null;
}

function previousTurnCombatant(combat = game.combat) {
  const turns = collectionValues(combat?.turns);
  if (!turns.length) return null;
  const turnIndex = Number(combat?.turn);
  if (!Number.isInteger(turnIndex)) return null;
  const previousIndex = turnIndex > 0 ? turnIndex - 1 : turns.length - 1;
  return turns[previousIndex] ?? null;
}

function ownershipLevelValue(level) {
  if (Number.isFinite(Number(level))) return Number(level);
  const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};
  return Number(levels[String(level ?? "").toUpperCase()] ?? 0) || 0;
}

function actorOwnedByUser(actor, user = game.user) {
  if (!actor || !user) return false;
  if (actor.isOwner === true) return true;

  const ownerPermission = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, ownerPermission);
  }

  const ownership = actor.ownership ?? {};
  const ownerLevel = ownershipLevelValue(ownerPermission);
  return ownershipLevelValue(ownership[user.id]) >= ownerLevel;
}

function combatantOwnedByUser(combatant, user = game.user) {
  return actorOwnedByUser(combatant?.actor, user)
    || actorOwnedByUser(combatant?.token?.actor, user)
    || actorOwnedByUser(combatant?.tokenDocument?.actor, user);
}

function nextOwnedCombatant(combat = game.combat, user = game.user) {
  const turns = collectionValues(combat?.turns);
  if (!turns.length) return null;

  const turnIndex = Number(combat?.turn);
  const start = Number.isInteger(turnIndex) && turnIndex >= 0 && turnIndex < turns.length ? turnIndex : 0;
  for (let offset = 0; offset < turns.length; offset += 1) {
    const combatant = turns[(start + offset) % turns.length];
    if (combatantOwnedByUser(combatant, user)) return combatant;
  }
  return null;
}

function panelCombatantForAutomaticOpen() {
  if (game.user?.isGM === true) return selectedTokenCombatant() ?? inlineTurnCombatant(game.combat);
  return nextOwnedCombatant(game.combat, game.user) ?? inlineTurnCombatant(game.combat);
}

function panelCombatantForTokenTool() {
  if (game.user?.isGM !== true) return panelCombatantForAutomaticOpen();
  return selectedTokenCombatant() ?? panelCombatantForAutomaticOpen();
}

function selectedTokenCombatant() {
  const selectedToken = canvas?.tokens?.controlled?.[0] ?? null;
  if (!selectedToken) return null;
  return collectionValues(game.combat?.combatants)
    .find((combatant) => tokenMatchesCombatant(selectedToken, combatant))
    ?? null;
}

function refreshSceneControls() {
  try {
    ui?.controls?.render?.();
  } catch (_error) {
    // Toolbar active state is cosmetic; ignore render failures.
  }
}

function activeContext() {
  return activePanel?.context ?? activePanel?._context ?? null;
}

function handlePanelClosed(panel) {
  if (activePanel === panel) activePanel = null;
  refreshSceneControls();
}

function resetMovementPreview() {
  cancelDestinationPicker();
  clearMovementPreview();
}

async function openCurrent(source) {
  const { openPanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
  activePanel = await openPanelForCurrentCombatant(activePanel, source, {
    onClose: handlePanelClosed,
    combatant: panelCombatantForAutomaticOpen(),
  });
  refreshSceneControls();
}

async function promptPreviousTurnSustainedCleanup(combat) {
  const context = activeContext();
  if (!context || context.combat?.id !== combat?.id) return;
  const previous = previousTurnCombatant(combat);
  const next = inlineTurnCombatant(combat);
  const contextCombatantId = context.combatant?.id ?? null;
  if (!contextCombatantId || contextCombatantId !== (previous?.id ?? null)) return;
  if (contextCombatantId === (next?.id ?? null)) return;
  try {
    await promptUnsustainedSpellCleanup(context);
  } catch (error) {
    console.warn(`${MODULE_ID} | Sustained spell cleanup failed`, error);
  }
}

async function openSelectedOrCurrent(source) {
  const { openPanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
  activePanel = await openPanelForCurrentCombatant(activePanel, source, {
    onClose: handlePanelClosed,
    combatant: panelCombatantForTokenTool(),
  });
  refreshSceneControls();
}

async function closeActivePanel() {
  if (!activePanel?.close) return;
  autoOpenSuppressed = true;
  const panel = activePanel;
  activePanel = null;
  await panel.close();
  refreshSceneControls();
}

function scheduleRefresh(source) {
  if (!activePanel) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const panel = activePanel;
    if (!panel) return;
    panel.refresh?.(source).catch((error) => {
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
      activePanel = await togglePanelForCurrentCombatant(activePanel, "keybinding", {
        onClose: handlePanelClosed,
        combatant: panelCombatantForAutomaticOpen(),
      });
      refreshSceneControls();
      return true;
    },
  });
});

function addTool(toolsContainer, tool) {
  if (!toolsContainer || !tool?.name) return;
  if (Array.isArray(toolsContainer)) {
    if (!toolsContainer.some((entry) => entry?.name === tool.name)) toolsContainer.push(tool);
    return;
  }
  if (typeof toolsContainer === "object") toolsContainer[tool.name] = tool;
}

Hooks.on("getSceneControlButtons", (controls) => {
  const groups = Array.isArray(controls) ? controls : Object.values(controls ?? {});
  const tokenControl = groups.find((control) => control?.name === "tokens" || control?.name === "token");
  if (!tokenControl?.tools) return;

  addTool(tokenControl.tools, {
    name: `${MODULE_ID}-toggle-panel`,
    title: "Toggle PF2e Combater",
    icon: "fa-solid fa-crosshairs",
    toggle: true,
    active: Boolean(activePanel),
    onChange: async (_event, toggled) => {
      try {
        if (toggled) {
          autoOpenSuppressed = false;
          await openSelectedOrCurrent("token-tool");
        } else await closeActivePanel();
      } catch (error) {
        console.warn(`${MODULE_ID} | Token tool toggle failed`, error);
      } finally {
        refreshSceneControls();
      }
    },
  });
});

Hooks.once("ready", async () => {
  console.log("PF2e Combater | Ready");
  game.socket?.on?.(`module.${MODULE_ID}`, (payload) => {
    if (payload?.type !== "shareDraft" || game.user?.isGM !== true) return;
    writeSharedDraftPlanPayload(payload);
    scheduleRefresh("shared-draft");
    if (!payload.silent) {
      ui?.notifications?.info?.(`PF2e Combater: ${payload.userName ?? "Player"} shared ${payload.actorName ?? "a"} plan.`);
    }
  });
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
  resetMovementPreview();
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
  await promptPreviousTurnSustainedCleanup(combat);
  resetMovementPreview();
  if (!setting(SETTINGS.autoOpen) && !activePanel) return;
  if (autoOpenSuppressed && !activePanel) return;
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
