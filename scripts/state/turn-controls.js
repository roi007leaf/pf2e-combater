import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { t } from "../i18n.js";
import { actionBudget } from "../engine/action/budget.js";
import { currentActionTurn, trackedActionContext } from "./action-tracker.js";

export const DELAY_FLAG = "delayedTurn";
export const READY_FLAG = "readiedAction";
export const READY_COST = 2;
export const REACTION_FLAG = "reactionUsed";
const REACTION_CHECKER_ID = "pf2e-reaction";
const queues = new Map();

export function delayedTurn(combatant) {
  return combatant?.flags?.[MODULE_ID]?.[DELAY_FLAG] ?? null;
}

export function readiedAction(combatant) {
  return combatant?.flags?.[MODULE_ID]?.[READY_FLAG] ?? null;
}

export function reactionUsed(combatant) {
  return Boolean(combatant?.flags?.[MODULE_ID]?.[REACTION_FLAG]);
}

// Spends the creature's reaction: our own marker, plus PF2e Reaction Checker's
// availability flag when that module is active so both agree.
function reactionSpendChanges(combatant, round) {
  const changes = { [`flags.${MODULE_ID}.${REACTION_FLAG}`]: { round } };
  const checker = globalThis.game?.modules?.get?.(REACTION_CHECKER_ID);
  if (checker?.active && combatant?.flags?.[REACTION_CHECKER_ID]?.state === true) {
    changes[`flags.${REACTION_CHECKER_ID}.state`] = false;
  }
  return changes;
}

export function ownsTurn(combatant, user = globalThis.game?.user) {
  return Boolean(user?.isGM || combatant?.actor?.testUserPermission?.(user, "OWNER"));
}

export function turnIdentity(combat = globalThis.game?.combat) {
  return { combatId: combat?.id, round: combat?.round, combatantId: combat?.combatant?.id,
    turnKey: currentActionTurn(combat)?.key ?? null };
}

export function turnCombatantName(combatant, user = globalThis.game?.user) {
  if (!user?.isGM && (combatant?.hidden || combatant?.visible === false
    || (globalThis.game?.pf2e?.settings?.tokens?.nameVisibility && combatant?.playersCanSeeName === false))) {
    return t("TurnControls.Unknown", "Unknown creature");
  }
  return combatant?.name ?? combatant?.actor?.name ?? t("TurnControls.Unknown", "Unknown creature");
}

export function delayTargets(combat, user = globalThis.game?.user) {
  const index = combat?.turn ?? -1;
  const turns = combat?.turns ?? [];
  return [...turns.slice(index + 1), ...turns.slice(0, index)]
    .filter((entry) => Number.isFinite(entry.initiative) && !entry.isDefeated && !delayedTurn(entry)
      && (user?.isGM || (!entry.hidden && entry.visible !== false)))
    .map((entry) => ({
      id: entry.id, name: turnCombatantName(entry, user),
      img: entry.img || entry.token?.texture?.src || entry.actor?.img || "icons/svg/mystery-man.svg",
      initiative: entry.initiative, order: turns.indexOf(entry) + 1,
      nextRound: turns.indexOf(entry) < index,
    }));
}

export function delayUnavailableReason(combat) {
  const active = combat?.combatant;
  if (!combat?.started || !active || delayedTurn(active)) return t("TurnControls.NotCurrent", "This turn is no longer active.");
  const conditions = collectionValues(active.actor?.itemTypes?.condition).filter((item) => item.active !== false && !item.system?.expired);
  if (conditions.some((item) => ["fleeing", "confused"].includes(item.slug ?? item.system?.slug))) {
    return t("TurnControls.CannotDelay", "This condition prevents Delay.");
  }
  const context = trackedActionContext({ combat, combatant: active, actor: active.actor }, { combat });
  if (!context.actionTracker) return t("TurnControls.TrackerRequired", "Wait for the turn's action tracker to initialize.");
  if (context.actionTracker.entries.length || context.actionsSpent.total > 0) {
    return t("TurnControls.DelayAtStart", "Delay is available at turn start, before spending actions.");
  }
  return "";
}

// Ready (Player Core): 2 actions, concentrate, then the turn ends. Fleeing and
// Confused forbid it, as they do Delay.
export function readyUnavailableReason(combat) {
  const active = combat?.combatant;
  if (!combat?.started || !active || delayedTurn(active)) return t("TurnControls.NotCurrent", "This turn is no longer active.");
  const conditions = collectionValues(active.actor?.itemTypes?.condition).filter((item) => item.active !== false && !item.system?.expired);
  if (conditions.some((item) => ["fleeing", "confused"].includes(item.slug ?? item.system?.slug))) {
    return t("TurnControls.CannotReady", "This condition prevents Ready.");
  }
  const context = trackedActionContext({ combat, combatant: active, actor: active.actor }, { combat });
  if (!context.actionTracker) return t("TurnControls.TrackerRequired", "Wait for the turn's action tracker to initialize.");
  if (actionBudget(context).normalActions < READY_COST) {
    return t("TurnControls.ReadyNeedsActions", "Ready needs 2 actions remaining.");
  }
  return "";
}

// Attacks already made this turn. A readied attack keeps the MAP it had when readied.
export function attacksThisTurn(combat) {
  const active = combat?.combatant;
  const context = trackedActionContext({ combat, combatant: active, actor: active?.actor }, { combat });
  return (context?.actionTracker?.entries ?? []).filter((entry) => entry.slug === "strike").length;
}

const READY_MOVEMENT_SLUGS = new Set(["stride", "step"]);

function readyMovement(value) {
  if (!value || typeof value !== "object" || !READY_MOVEMENT_SLUGS.has(value.slug)) return null;
  const x = Number(value.destination?.x);
  const y = Number(value.destination?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const elevation = Number(value.destination?.elevation);
  let movementPlan = null;
  try {
    movementPlan = value.movementPlan ? JSON.parse(JSON.stringify(value.movementPlan)) : null;
  } catch (_error) {
    movementPlan = null;
  }
  return { slug: value.slug, destination: { x, y, ...(Number.isFinite(elevation) ? { elevation } : {}) }, movementPlan };
}

function readyPayload(request) {
  const text = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const label = text(request.label, 80);
  if (!label) throw Error(t("TurnControls.ReadyIncomplete", "Choose an action to ready."));
  const mapIndex = Math.max(0, Math.min(2, Math.trunc(Number(request.mapIndex)) || 0));
  return { label, strike: text(request.strike, 80) || null, mapIndex, movement: readyMovement(request.movement) };
}

// Move a waiting creature together with anyone waiting after it. Native PF2e
// initiative priorities resolve ties without renumbering everyone else's rolls.
export function orderAfter(combat, moverId, afterId) {
  const turns = combat.turns;
  const movingIds = new Set([moverId]);
  for (let pass = 0; pass < turns.length; pass += 1) {
    for (const entry of turns) if (movingIds.has(delayedTurn(entry)?.afterId)) movingIds.add(entry.id);
  }
  if (movingIds.has(afterId)) throw Error(t("TurnControls.InvalidTarget", "Choose another creature to return after."));
  const anchor = turns.find((entry) => entry.id === afterId);
  if (!anchor || !Number.isFinite(anchor.initiative)) throw Error(t("TurnControls.InvalidTarget", "Choose another creature to return after."));
  const block = [turns.find((entry) => entry.id === moverId), ...turns.filter((entry) => entry.id !== moverId && movingIds.has(entry.id))].filter(Boolean);
  const ordered = turns.filter((entry) => !movingIds.has(entry.id));
  ordered.splice(ordered.indexOf(anchor) + 1, 0, ...block);
  if (ordered.every((entry, index) => entry.id === turns[index].id)) return { ordered, updates: [], movingIds };
  const tied = ordered.filter((entry) => movingIds.has(entry.id) || entry.initiative === anchor.initiative);
  const updates = tied.map((entry, priority) => ({
    _id: entry.id, initiative: anchor.initiative,
    flags: { pf2e: { overridePriority: { [anchor.initiative]: priority } } },
  }));
  return { ordered, updates, movingIds };
}

async function moveAndAdvance(combat, mover, afterId, nextId, round, delay = null) {
  const { ordered, updates } = orderAfter(combat, mover.id, afterId);
  if (delay) {
    let update = updates.find((entry) => entry._id === mover.id);
    if (!update) updates.push(update = { _id: mover.id, flags: {} });
    update.flags[MODULE_ID] = { [DELAY_FLAG]: delay };
  }
  const turn = ordered.findIndex((entry) => entry.id === nextId);
  if (turn < 0) throw Error(t("TurnControls.NotCurrent", "This turn is no longer active."));
  // A single update avoids a transient current combatant while initiative is sorted.
  await combat.update({ ...(updates.length ? { combatants: updates } : {}), round, turn }, {
    diff: false, direction: 1, combaterNextCombatantId: nextId,
    worldTime: { delta: combat.getTimeDelta?.(combat.round, combat.turn, round, round > combat.round ? 0 : combat.turn + 1) ?? 0 },
  });
}

async function performTurnControl(request, senderId) {
  const combat = globalThis.game?.combats?.get?.(request.combatId) ?? globalThis.game?.combat;
  const user = globalThis.game?.users?.get?.(senderId);
  const activeGM = globalThis.game?.users?.activeGM;
  if (!globalThis.game?.user?.isGM || (activeGM && activeGM.id !== globalThis.game.user.id)
    || !user?.active || !combat?.started || combat.id !== request.combatId) {
    throw Error(t("TurnControls.Unavailable", "An active GM is required for turn controls."));
  }
  if (request.action === "ready-clear") {
    const holder = combat.combatants.get(request.readiedId);
    if (!readiedAction(holder)) throw Error(t("TurnControls.NotReadied", "This creature has no readied action."));
    if (!ownsTurn(holder, user)) throw Error(t("TurnControls.NotOwner", "You can only control your own turn."));
    // Using a readied action is a reaction; discarding it spends nothing.
    const spent = request.used === true ? reactionSpendChanges(holder, combat.round) : {};
    await holder.update({ [`flags.${MODULE_ID}.-=${READY_FLAG}`]: null, ...spent }, { turnEvents: false });
    return true;
  }
  const expected = turnIdentity(combat);
  if (expected.round !== request.round || expected.combatantId !== request.combatantId || expected.turnKey !== request.turnKey) {
    throw Error(t("TurnControls.NotCurrent", "This turn is no longer active."));
  }
  const active = combat.combatant;
  if (request.action === "return") {
    if (!user.isGM) throw Error(t("TurnControls.GmOnly", "Only the GM can bring a delayed creature in."));
    const mover = combat.turns.find((entry) => entry.id === request.delayedId && delayedTurn(entry));
    if (!mover || mover.id === active.id) throw Error(t("TurnControls.NotDelayed", "This creature is no longer delaying."));
    const { ordered, updates } = orderAfter(combat, mover.id, active.id);
    // A waiting group can currently be before the active creature. Reorder with
    // that creature still active, then use native nextTurn: a backwards index
    // jump would otherwise be interpreted as a rewind rather than a new turn.
    if (updates.length) await combat.update({ combatants: updates, turn: ordered.findIndex((entry) => entry.id === active.id) }, {
      turnEvents: false, diff: false, combaterNextCombatantId: active.id,
    });
    await combat.nextTurn();
    return true;
  }
  if (!ownsTurn(active, user)) throw Error(t("TurnControls.NotOwner", "You can only control your own turn."));
  if (request.action === "end") {
    await combat.nextTurn();
    return true;
  }
  if (request.action === "ready") {
    const reason = readyUnavailableReason(combat);
    if (reason) throw Error(reason);
    const readied = { ...readyPayload(request), round: combat.round, turnKey: expected.turnKey };
    await active.update({ [`flags.${MODULE_ID}.${READY_FLAG}`]: readied }, { turnEvents: false });
    await combat.nextTurn();
    return true;
  }
  if (request.action !== "delay") throw Error(t("TurnControls.InvalidRequest", "Unknown turn control."));
  const reason = delayUnavailableReason(combat);
  if (reason) throw Error(reason);
  if (!delayTargets(combat, user).some((target) => target.id === request.afterId)) {
    throw Error(t("TurnControls.InvalidTarget", "Choose another creature to return after."));
  }
  const index = combat.turns.indexOf(active);
  const next = [...combat.turns.slice(index + 1), ...combat.turns.slice(0, index)]
    .find((entry) => !delayedTurn(entry) && (!combat.settings?.skipDefeated || !entry.isDefeated));
  if (!next) throw Error(t("TurnControls.NoNext", "No other creature can take a turn."));
  const tracked = trackedActionContext({ combat, combatant: active, actor: active.actor }, { combat });
  const delay = {
    afterId: request.afterId, round: combat.round, originalInitiative: active.initiative,
    originalPreviousId: combat.turns[(index + combat.turns.length - 1) % combat.turns.length]?.id,
    pool: tracked.actionTracker.pool, quickenedAllowed: tracked.quickenedAllowed,
  };
  const nextRound = combat.round + Number(combat.turns.indexOf(next) < index);
  await moveAndAdvance(combat, active, request.afterId, next.id, nextRound, delay);
  return true;
}

// socketlib supplies the sender on `this`; never accept an actor/user identity
// from the request as permission to mutate the encounter. Serialize double-clicks.
export function handleTurnControl(request = {}) {
  const senderId = this?.socketdata?.userId ?? globalThis.game?.user?.id;
  const key = request.combatId;
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => performTurnControl(request, senderId));
  queues.set(key, run);
  return run.finally(() => { if (queues.get(key) === run) queues.delete(key); });
}

export function registerTurnControlHooks(refresh) {
  // Runs after the tracker hook, replacing only a resumed turn's pool. The PF2e
  // round markers prevent a delayed turn crossing a round boundary from running
  // its start/end effects a second time.
  Hooks.on("preUpdateCombat", (combat, changed, options = {}) => {
    if (options.turnEvents === false || !("turn" in changed || "round" in changed)) return;
    const next = combat.combatants.get(options.combaterNextCombatantId)
      ?? combat.turns[changed.turn ?? combat.turn];
    const delay = delayedTurn(next);
    const round = changed.round ?? combat.round;
    if (!delay) return;
    const resumed = round === delay.round || (round === delay.round + 1 && delay.afterId !== delay.originalPreviousId);
    if (resumed) {
      const snapshot = changed[`flags.${MODULE_ID}.actionTurn`];
      if (snapshot) Object.assign(snapshot, { pool: delay.pool, quickenedAllowed: delay.quickenedAllowed });
      const updates = changed.combatants ??= [];
      let update = updates.find((entry) => entry._id === next.id);
      if (!update) updates.push(update = { _id: next.id });
      update.flags ??= {};
      update.flags.pf2e = { ...update.flags.pf2e, roundOfLastTurn: round, roundOfLastTurnEnd: round };
    }
  });
  Hooks.on("updateCombat", (combat, changed, options = {}) => {
    refresh("turn-controls");
    if (options.turnEvents === false || !globalThis.game?.user?.isActiveGM) return;
    const active = combat.combatant;
    const changes = {};
    if (delayedTurn(active)) changes[`flags.${MODULE_ID}.-=${DELAY_FLAG}`] = null;
    // A readied action lasts until the start of its owner's next turn.
    if (("turn" in changed || "round" in changed) && readiedAction(active)) changes[`flags.${MODULE_ID}.-=${READY_FLAG}`] = null;
    // A creature regains its reaction at the start of its turn.
    if (("turn" in changed || "round" in changed) && reactionUsed(active)) changes[`flags.${MODULE_ID}.-=${REACTION_FLAG}`] = null;
    if (!Object.keys(changes).length) return;
    active.update(changes, { turnEvents: false })
      .catch((error) => console.warn(`${MODULE_ID} | Turn flag cleanup failed`, error));
  });
  Hooks.on("updateCombatant", () => refresh("turn-controls"));
}
