import { MODULE_ID } from "./constants.js";
import { playerAccessAllowed, registerSettings, setting, SETTINGS } from "./settings.js";
import { clearMovementCollisionCache } from "./readers/action-reader.js";
import { promptRetchDc, promptRetchResult } from "./rules/retch-decision.js";
import { setSocket } from "./socket.js";
import { t } from "./i18n.js";
import { documentRelevantToContext } from "./state/context-relevance.js";
import {
  captureMovementOrigin,
  clearMovementActionSpends,
  consumeTokenRefreshChange,
  markMovementActionSpent,
  tokenUpdateAffectsCombatGeometry,
} from "./state/token-refresh.js";
import { clearCombatDraftPlans, clearDraftPlan, clearSharedDraftPlan, isSharedDraftPlanEcho, writeSharedDraftPlanPayload } from "./state/draft-plans.js";
import { clearMovementPreview } from "./ui/movement-preview.js";
import { openPanelForCurrentCombatant, togglePanelForCurrentCombatant } from "./ui/CombaterPanel.js";
import { cancelDestinationPicker } from "./ui/destination-picker.js";
import { promptUnsustainedSpellCleanup } from "./rules/sustained-spells.js";
import { expiredAreaRegionsForScene } from "./engine/area-duration.js";

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

// Hazards and loot aren't plannable actors — selecting one shouldn't switch the panel to them.
const NON_PLANNABLE_ACTOR_TYPES = new Set(["hazard", "loot"]);

function isNonPlannableActorToken(token) {
  const actorType = String(token?.actor?.type ?? token?.document?.actor?.type ?? "").toLowerCase();
  return NON_PLANNABLE_ACTOR_TYPES.has(actorType);
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
  // Players follow their selected token too; fall back to their own combatant, then the active one.
  return selectedTokenCombatant() ?? nextOwnedCombatant(game.combat, game.user) ?? inlineTurnCombatant(game.combat);
}

function panelCombatantForTokenTool() {
  if (game.user?.isGM !== true) return panelCombatantForAutomaticOpen();
  return selectedTokenCombatant() ?? panelCombatantForAutomaticOpen();
}

function selectedTokenCombatant() {
  const selectedToken = canvas?.tokens?.controlled?.[0] ?? null;
  if (!selectedToken || isNonPlannableActorToken(selectedToken)) return null;
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

const REFRESH_DELAY_MS = 150;
// Token movement fires updateToken/refreshToken once per committed grid step. Coalesce those into a
// single rebuild AFTER movement settles (each step re-arms the timer) so a multi-square move costs
// one ~end-of-move refresh instead of one per square.
const MOVEMENT_REFRESH_SOURCES = new Set(["token-movement", "token-update", "token-refresh"]);
const MOVEMENT_REFRESH_DELAY_MS = 350;

function scheduleRefresh(source) {
  if (!activePanel) return;
  clearTimeout(refreshTimer);
  const delay = MOVEMENT_REFRESH_SOURCES.has(source) ? MOVEMENT_REFRESH_DELAY_MS : REFRESH_DELAY_MS;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const panel = activePanel;
    if (!panel) return;
    panel.refresh?.(source).catch((error) => {
      console.warn(`${MODULE_ID} | Refresh failed`, error);
    });
  }, delay);
}

function scheduleDocumentRefresh(document, source) {
  if (!documentRelevantToContext(document, activeContext())) return;
  scheduleRefresh(source);
}

Hooks.once("init", () => {
  registerSettings();

  game.keybindings.register(MODULE_ID, "togglePanel", {
    name: t("Keybind.ToggleName", "Toggle PF2e Combater"),
    hint: t("Keybind.ToggleHint", "Open or close the PF2e Combater tactical advisor panel."),
    editable: [{ key: "KeyC", modifiers: ["Alt", "Shift"] }],
    onDown: async () => {
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
  if (!playerAccessAllowed()) return;
  const groups = Array.isArray(controls) ? controls : Object.values(controls ?? {});
  const tokenControl = groups.find((control) => control?.name === "tokens" || control?.name === "token");
  if (!tokenControl?.tools) return;

  addTool(tokenControl.tools, {
    name: `${MODULE_ID}-toggle-panel`,
    title: t("Keybind.ToggleName", "Toggle PF2e Combater"),
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

// GM-side handler for a player's shared draft plan (runs on each GM via socketlib.executeForAllGMs).
function receiveSharedDraft(payload) {
  if (game.user?.isGM !== true) return;
  writeSharedDraftPlanPayload(payload);
  scheduleRefresh("shared-draft");
  if (!payload?.silent) {
    ui?.notifications?.info?.(t("Notify.PlanSharedBy", "PF2e Combater: {user} shared {actor} plan.", { user: payload?.userName ?? "Player", actor: payload?.actorName ?? "a" }));
  }
}

// socketlib owns the player↔GM transport (Retch adjudication, shared-plan sync). Register our
// handlers as soon as it's ready; the typed callers in scripts/socket.js use this instance.
Hooks.once("socketlib.ready", () => {
  const socket = globalThis.socketlib?.registerModule?.(MODULE_ID);
  if (!socket) {
    console.warn("PF2e Combater | socketlib unavailable — GM round-trips will fall back to local prompts");
    return;
  }
  socket.register("promptRetchDc", promptRetchDc);
  socket.register("promptRetchResult", promptRetchResult);
  socket.register("receiveSharedDraft", receiveSharedDraft);
  setSocket(socket);
});

// The GM can lock players out of the panel mid-session; each player's own client reacts by
// closing whatever's open and dropping the toolbar toggle immediately, without a reload.
Hooks.on("pf2e-combater.playerAccessChanged", () => {
  refreshSceneControls();
  if (playerAccessAllowed() || !activePanel) return;
  closeActivePanel().catch((error) => console.warn(`${MODULE_ID} | Access-change close failed`, error));
});

Hooks.once("ready", async () => {
  console.log("PF2e Combater | Ready");
  await sweepExpiredAreaTemplates();
  if (!setting(SETTINGS.autoOpen)) return;
  if (!game.combat?.started) return;
  await openCurrent("ready");
});

// --- Auto-expiring area templates (GM authority) ---------------------------------------

// True only when an embedded document is positively confirmed gone from its collection.
// Returns false when we cannot check, so a real deletion is still attempted.
function confirmedRemoved(collection, id) {
  return Boolean(collection?.get) && id != null && !collection.get(id);
}

async function deleteAreaRegions(entries) {
  for (const entry of entries ?? []) {
    if (entry?.effectUuid && typeof fromUuid === "function") {
      try {
        const effect = await fromUuid(entry.effectUuid);
        if (typeof effect?.delete === "function" && !confirmedRemoved(effect.parent?.items, effect.id)) {
          await effect.delete();
        }
      } catch (error) {
        console.warn(`${MODULE_ID} | Area effect removal failed`, error);
      }
    }
    try {
      const scene = (entry?.sceneId && game.scenes?.get?.(entry.sceneId)) ?? canvas?.scene ?? null;
      if (typeof scene?.deleteEmbeddedDocuments === "function" && !confirmedRemoved(scene.regions, entry?.regionId)) {
        await scene.deleteEmbeddedDocuments("Region", [entry.regionId]);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Area region removal failed`, error);
    }
  }
}

// Remove placed area templates whose duration has elapsed. Runs on the GM client, which is
// the single authority allowed to delete scene-embedded documents.
async function sweepExpiredAreaTemplates() {
  if (game.user?.isGM !== true) return;
  const scene = canvas?.scene ?? null;
  if (!scene) return;
  const worldTime = Number(game.time?.worldTime);
  const round = Number(game.combat?.round);
  const expired = expiredAreaRegionsForScene(scene, {
    worldTime: Number.isFinite(worldTime) ? worldTime : null,
    round: Number.isFinite(round) ? round : null,
  });
  if (expired.length) await deleteAreaRegions(expired);
}

// When a player dismisses a linked timer effect early, the deletion broadcasts to every
// client; the GM reads the effect's areaRegion flag and clears the matching template.
function removeRegionForDeletedAreaEffect(item) {
  if (game.user?.isGM !== true) return;
  const link = item?.flags?.["pf2e-combater"]?.areaRegion
    ?? item?.getFlag?.("pf2e-combater", "areaRegion");
  if (!link?.regionId) return;
  deleteAreaRegions([{ regionId: link.regionId, sceneId: link.sceneId ?? null, effectUuid: null }])
    .catch((error) => console.warn(`${MODULE_ID} | Area region removal failed`, error));
}

Hooks.on("updateWorldTime", () => {
  sweepExpiredAreaTemplates().catch((error) => console.warn(`${MODULE_ID} | Area sweep failed`, error));
});

Hooks.on("canvasReady", () => {
  // New scene / re-draw: the cached wall-collision results no longer apply.
  clearMovementCollisionCache();
  sweepExpiredAreaTemplates().catch((error) => console.warn(`${MODULE_ID} | Area sweep failed`, error));
});

// The reachable-square sweeps cache wall collisions across rebuilds; any wall edit invalidates them.
for (const wallHook of ["createWall", "updateWall", "deleteWall"]) {
  Hooks.on(wallHook, () => clearMovementCollisionCache());
}

Hooks.on("deleteCombat", (combat) => {
  // A deleted combat's plans are dead weight: drop every draft (local + shared + actor flag) tied
  // to it, independent of whether its panel is open, so nothing lingers in storage.
  clearCombatDraftPlans(combat).catch((error) => console.warn(`${MODULE_ID} | Combat draft cleanup failed`, error));
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

// When a combatant's turn ends, clear its execution plan (local + shared) so the plan
// persists through the whole turn and resets only afterward — not at the start of each round.
function clearEndedTurnDraft(combat) {
  const ended = previousTurnCombatant(combat);
  if (!ended) return;
  const context = { combat, combatant: ended };
  clearDraftPlan(context);
  clearSharedDraftPlan(context).catch((error) => console.warn(`${MODULE_ID} | Shared draft cleanup failed`, error));
}

Hooks.on("updateCombat", async (combat, changed) => {
  if (combat !== game.combat) return;
  if (!combat.started) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  await sweepExpiredAreaTemplates();
  // Read the ended turn's plan for sustained cleanup BEFORE clearing it.
  await promptPreviousTurnSustainedCleanup(combat);
  clearEndedTurnDraft(combat);
  resetMovementPreview();
  if (!setting(SETTINGS.autoOpen) && !activePanel) return;
  if (autoOpenSuppressed && !activePanel) return;
  // The window follows the selected token (GM and players), so a turn change just refreshes the
  // open panel rather than jumping to the new active combatant. Only open fresh (to the selected
  // token, then the user's own combatant) when no panel is up yet.
  if (activePanel) {
    await activePanel.refresh("combat-turn");
  } else {
    await openCurrent("combat-turn");
  }
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
  // Ignore drag previews / clones: while you hold-and-drag (before committing) Foundry animates a
  // preview whose position changes every frame, which would rebuild the plan mid-drag. Only the
  // real, committed move matters — that arrives via updateToken on drop.
  if (token?.isPreview === true || token?.document?.isPreview === true || token?._original) return;
  if (!consumeTokenRefreshChange(token)) return;
  scheduleRefresh("token-refresh");
});

Hooks.on("targetToken", (user) => {
  if (user !== game.user) return;
  scheduleRefresh("target-change");
});

// The Combater window follows the selected token instead of tracking the active combatant — for
// both the GM and players. Selecting a combatant token switches the open panel to it. (Players can
// only control tokens they own, so this never exposes a plan they aren't allowed to see.)
Hooks.on("controlToken", (token, controlled) => {
  if (!controlled || !activePanel) return;
  if (isNonPlannableActorToken(token)) return;
  // Grabbing a token to drag selects it, firing this hook. Rebuilding the panel for the token it
  // already shows is the hitch felt at drag-start — skip it. Only a genuine switch to a different
  // combatant's token needs the rebuild.
  if (token?.id && token.id === activePanel._context?.token?.id) return;
  const combatant = collectionValues(game.combat?.combatants)
    .find((entry) => tokenMatchesCombatant(token, entry)) ?? null;
  if (!combatant) return;
  // Switch the planned combatant cheaply, then rebuild on the debounce. Rebuilding synchronously
  // inside this canvas-thread hook is what makes selecting a token feel laggy.
  activePanel.selectCombatant?.(combatant);
  scheduleRefresh("token-control");
});

Hooks.on("updateActor", (actor, changes) => {
  // A player's own shared-draft sync (writeSharedDraftPlanActorFlag) also fires this hook on their
  // own client. Treating that self-inflicted echo as an ordinary actor-update would immediately
  // reset their just-chosen pinned Auto-fill plan back to the default -- refresh under a source
  // that isn't in CombaterPanel.js's RESET_PIN_REFRESH_SOURCES instead.
  scheduleDocumentRefresh(actor, isSharedDraftPlanEcho(changes) ? "shared-draft-sync" : "actor-update");
});

Hooks.on("createItem", (item) => {
  scheduleDocumentRefresh(item, "item-create");
});

Hooks.on("updateItem", (item) => {
  scheduleDocumentRefresh(item, "item-update");
});

Hooks.on("deleteItem", (item) => {
  removeRegionForDeletedAreaEffect(item);
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
