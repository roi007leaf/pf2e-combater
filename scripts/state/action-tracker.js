import { MODULE_ID } from "../constants.js";
import { collectionValues } from "../foundry-data.js";
import { actionBudget, quickenedEligible, turnActionPool } from "../engine/action/budget.js";
import { slugify } from "../engine/action/text.js";
import { readChatAction } from "./chat-action-cost.js";
import { t } from "../i18n.js";
import { movementActionsSpent } from "./token-refresh.js";
import { canvasMovementEntries, recordedMovementIds } from "./canvas-movement.js";

const executionScopes = new Map();
let conditionQueue = Promise.resolve();

function actorDocument(context) {
  return context?.actor?.document ?? context?.combatant?.actor ?? context?.actor;
}

function turnMatches(snapshot, combat, combatantId = combat?.combatant?.id) {
  return Boolean(snapshot && combat?.started && snapshot.round === combat.round
    && snapshot.turn === combat.turn && snapshot.combatantId === combatantId);
}

function activeConditions(actor) {
  return collectionValues(actor?.itemTypes?.condition).filter((item) => !item.system?.expired
    && (item.active !== false || (item.slug ?? item.system?.slug) === "slowed"));
}

function quickenedConditions(actor) {
  return activeConditions(actor).filter((item) => (item.slug ?? item.system?.slug) === "quickened");
}

function quickenedAllowance(actor) {
  const configured = quickenedConditions(actor).map((item) => item.flags?.[MODULE_ID]?.quickenedAllowed).filter(Array.isArray);
  if (configured.length) return [...new Set(configured.flat())];
  // The condition alone has no restrictions. Recognize the native Haste effect;
  // other sources need the GM to supply their permitted actions.
  const haste = collectionValues(actor?.itemTypes?.effect).some((item) => !item.isExpired && !item.system?.expired
    && ["haste", "spell-effect-haste", "effect-haste"].includes(item.slug ?? item.system?.slug));
  return haste ? ["strike", "stride"] : [];
}

function conditionProfile(actor) {
  const conditions = activeConditions(actor);
  const value = (slug) => Math.max(0, ...conditions.filter((item) => (item.slug ?? item.system?.slug) === slug)
    .map((item) => Number(item.value ?? item.system?.value?.value) || 1));
  return {
    conditions: { slugs: ["slowed", "stunned", "quickened"].filter((slug) => value(slug)), values: {
      slowed: value("slowed"), stunned: value("stunned"), quickened: value("quickened"),
    } },
    stunnedDuration: conditions.some((item) => (item.slug ?? item.system?.slug) === "stunned"
      && item.system?.value?.isValued === false),
  };
}

export function createTurnSnapshot(combat, { round = combat?.round, turn = combat?.turn, key, combatant = combat?.turns?.[turn] ?? combat?.combatant } = {}) {
  if (turn === null || turn === undefined) return null;
  if (!combatant || !(round > 0)) return null;
  const actor = combatant.actor;
  const pool = turnActionPool(conditionProfile(actor));
  return {
    key: key ?? globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    combatantId: combatant.id, actorId: actor?.id, tokenId: combatant.tokenId ?? combatant.token?.id,
    sceneId: combatant.sceneId ?? combatant.token?.parent?.id,
    round, turn, pool, quickenedAllowed: quickenedAllowance(actor),
    movementStartIds: recordedMovementIds(combatant),
  };
}

export function currentActionTurn(combat = globalThis.game?.combat) {
  const snapshot = combat?.flags?.[MODULE_ID]?.actionTurn;
  return turnMatches(snapshot, combat) ? snapshot : null;
}

function speakerMatches(message, snapshot) {
  const speaker = message?.speaker ?? {};
  if (speaker.token) return speaker.token === snapshot.tokenId
    && (!speaker.scene || !snapshot.sceneId || speaker.scene === snapshot.sceneId);
  return Boolean(speaker.actor && speaker.actor === snapshot.actorId);
}

export function chatActionEntry(message, combat = globalThis.game?.combat) {
  const snapshot = currentActionTurn(combat);
  if (!snapshot || !speakerMatches(message, snapshot)) return null;
  const entry = readChatAction(message);
  if (!entry) return null;
  const scope = executionScopes.get(snapshot.actorId);
  return { ...entry, turnKey: snapshot.key, ...(scope?.turnKey === snapshot.key ? { executionId: scope.id } : {}) };
}

function receiptData(context, snapshot) {
  const stored = actorDocument(context)?.flags?.[MODULE_ID]?.actionReceipts;
  return stored?.turnKey === snapshot.key ? stored : {
    turnKey: snapshot.key, entries: {}, normalAdjustment: 0, quickenedAdjustment: 0,
    lastStunned: null, quickenedAllowed: null,
  };
}

// A delayed turn resumes only once its creature has chosen where to return. One
// still waiting when its own slot comes round again lost that turn and starts fresh.
export function resumesDelayedTurn(delay, round) {
  return Boolean(delay?.afterId) && (round === delay.round
    || (round === delay.round + 1 && delay.afterId !== delay.originalPreviousId));
}

function forecastActionContext(context, combat) {
  const actor = actorDocument(context);
  const index = combat.turns.findIndex((entry) => entry.id === context.combatant.id);
  const delay = combat.turns[index]?.flags?.[MODULE_ID]?.delayedTurn;
  const expectedRound = combat.round + Number(index <= combat.turn);
  const resumesDelay = resumesDelayedTurn(delay, expectedRound);
  const pool = resumesDelay ? delay.pool : turnActionPool(conditionProfile(actor));
  const quickenedAllowed = resumesDelay && delay.quickenedAllowed?.length ? delay.quickenedAllowed : quickenedAllowance(actor);
  return {
    ...context,
    turnActionPool: pool,
    quickenedAllowed,
    // Off-turn movement, chat, and the previous turn's receipts cannot spend the
    // actions this actor is expected to regain at their next turn's start.
    actionsSpent: { movement: 0, normal: 0, quickened: 0, total: 0 },
    actionTracker: {
      forecast: true, turnKey: null, executionIds: [], entries: [],
      pool, nextTurnPool: pool, budget: pool, quickenedAllowed, quickenedPending: false,
    },
  };
}

export function trackedActionContext(context, { combat = globalThis.game?.combat, messages = globalThis.game?.messages } = {}) {
  if (!context || context.combat?.id !== combat?.id) return context;
  if (combat?.started && combat.combatant?.id && context.combatant?.id
    && context.combatant.id !== combat.combatant.id) return forecastActionContext(context, combat);
  const snapshot = currentActionTurn(combat);
  if (!snapshot || snapshot.combatantId !== context.combatant?.id) return context;
  const receipts = receiptData(context, snapshot);
  const entries = Object.entries(receipts.entries ?? {})
    .filter(([, entry]) => !entry.reverted)
    .map(([executionId, entry]) => ({ ...entry, executionId }));
  const allExecutionIds = Object.keys(receipts.entries ?? {});
  const executionIds = allExecutionIds.filter((id) => !receipts.entries[id].reverted);
  const coveredMessages = new Set(entries.flatMap((entry) => entry.messageIds ?? []));
  const seenMessages = new Set();
  const cards = [];
  for (const message of collectionValues(messages)) {
    const entry = message.flags?.[MODULE_ID]?.actionSpend;
    if (!entry || entry.turnKey !== snapshot.key || seenMessages.has(message.id)) continue;
    seenMessages.add(message.id);
    if (coveredMessages.has(message.id) || (entry.executionId && allExecutionIds.includes(entry.executionId))) continue;
    // An ability/spell card may produce a follow-up check. Spend the card only.
    const card = entry.phase === "roll" && cards.findLast((candidate) =>
      (entry.origin ? candidate.origin === entry.origin : candidate.slug === entry.slug)
      && (!candidate.rolled || candidate.spell));
    if (card) { card.rolled = true; continue; }
    const copy = { ...entry };
    entries.push(copy);
    if (entry.phase === "card") cards.push(copy);
  }
  const canvasEntries = canvasMovementEntries(combat.combatant, [
    ...(snapshot.movementStartIds ?? []),
    ...Object.values(receipts.entries ?? {}).flatMap((entry) => entry.movementIds ?? []),
  ]);
  const movement = canvasEntries?.length ?? Math.max(0, Number(context.actionsSpent?.movement) || 0);
  // A matching movement card can describe the same canvas action. Match modes so
  // a Fly card cannot hide a separate walking Stride; managed moves are excluded by ID.
  const reportedMovement = new Map();
  for (const entry of entries.filter((entry) => entry.movement && !entry.canvasExcluded)) {
    reportedMovement.set(entry.slug, (reportedMovement.get(entry.slug) ?? 0) + entry.cost);
  }
  const unreported = canvasEntries ?? Array.from({ length: movement }, () => ({ cost: 1, slug: "stride", movement: true }));
  for (const entry of unreported) {
    const covered = reportedMovement.get(entry.slug) ?? 0;
    if (covered > 0) reportedMovement.set(entry.slug, covered - 1);
    else entries.push(entry);
  }
  const quickenedAllowed = receipts.quickenedAllowed
    ?? (snapshot.quickenedAllowed?.length ? snapshot.quickenedAllowed : quickenedAllowance(actorDocument(context)));
  const total = entries.reduce((sum, entry) => sum + entry.cost, 0);
  const eligible = entries.filter((entry) => quickenedEligible(entry, entry.cost, { quickenedAllowed }));
  const quickenedAdjustment = receipts.quickenedAdjustment ?? 0;
  const quickened = Math.min(Math.max(0, snapshot.pool.quickenedActions - quickenedAdjustment), eligible.length);
  const quickenedExecutionIds = eligible.slice(0, quickened).map((entry) => entry.executionId).filter(Boolean);
  const normalSpent = Math.max(0, total - quickened + (receipts.normalAdjustment ?? 0));
  const quickenedSpent = Math.max(0, quickened + quickenedAdjustment);
  // Show newly gained quickened immediately without changing actions regained at turn start.
  const nextTurnPool = turnActionPool(conditionProfile(actorDocument(context)));
  const quickenedPending = snapshot.pool.quickened === 0 && nextTurnPool.quickened > 0;
  const tracked = {
    ...context, turnActionPool: snapshot.pool, quickenedAllowed,
    actionsSpent: { movement, normal: normalSpent, quickened: quickenedSpent, total: normalSpent + quickenedSpent },
    actionTracker: { turnKey: snapshot.key, executionIds, quickenedExecutionIds, entries, pool: snapshot.pool, nextTurnPool, quickenedAllowed, quickenedPending },
  };
  tracked.actionTracker.budget = actionBudget(tracked);
  return tracked;
}

export function beginTrackedExecution(context, step) {
  const snapshot = currentActionTurn();
  if (!snapshot || context?.combat?.id !== globalThis.game?.combat?.id || context?.combatant?.id !== snapshot.combatantId) return () => {};
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const scope = { id: step.instanceId, turnKey: snapshot.key, done };
  executionScopes.set(snapshot.actorId, scope);
  return () => {
    if (executionScopes.get(snapshot.actorId) === scope) executionScopes.delete(snapshot.actorId);
    finish();
  };
}

async function writeReceipts(context, snapshot, patch) {
  const actor = actorDocument(context);
  if (typeof actor?.update !== "function" || !snapshot) return;
  const current = receiptData(context, snapshot);
  // Delete only our prior receipts. Never replace an actor's flags object.
  if (actor.flags?.[MODULE_ID]?.actionReceipts?.turnKey !== snapshot.key) {
    const changes = { [`flags.${MODULE_ID}.actionReceipts`]: { ...current, ...patch } };
    for (const id of Object.keys(actor.flags?.[MODULE_ID]?.actionReceipts?.entries ?? {})) {
      if (!patch.entries?.[id]) changes[`flags.${MODULE_ID}.actionReceipts.entries.-=${id}`] = null;
    }
    await actor.update(changes);
  } else {
    await actor.update(Object.fromEntries(Object.entries(patch).map(([key, value]) => [`flags.${MODULE_ID}.actionReceipts.${key}`, value])));
  }
}

export async function recordTrackedExecution(context, step, result) {
  try {
    await persistTrackedExecution(context, step, result);
  } catch (error) {
    // The action already happened. A tracking failure must not make it retryable.
    console.warn(`${MODULE_ID} | Action tracking failed`, error);
    globalThis.ui?.notifications?.warn?.(t("ActionTracker.SaveFailed", "Action completed, but its tracker update failed. Adjust the tracker manually."));
  }
}

async function persistTrackedExecution(context, step, result) {
  const snapshot = currentActionTurn();
  if (result?.status !== "done" || !snapshot || context?.combat?.id !== globalThis.game?.combat?.id
    || context?.combatant?.id !== snapshot.combatantId || !step?.instanceId
    || (context.actionTracker?.turnKey && context.actionTracker.turnKey !== snapshot.key)) return;
  const action = step.action ?? step;
  const cost = Number(step.actionCost ?? step.cost ?? action.actionCost ?? action.cost);
  if (!(cost > 0 && cost <= 3)) return;
  const entry = {
    cost, slug: action.source === "strike" ? "strike" : action.slug, label: action.name ?? "",
    movement: Boolean(action.requiresDestination && !action.teleport),
    canvasExcluded: Boolean(context.actionTracker),
    messageIds: (result.patch?.execution?.revert?.ops ?? []).filter((op) => op.kind === "chat").map((op) => op.messageId),
    movementIds: (result.patch?.execution?.revert?.ops ?? []).filter((op) => op.kind === "movement" && op.movementId).map((op) => op.movementId),
  };
  const actor = actorDocument(context);
  const previous = receiptData(context, snapshot).entries?.[step.instanceId];
  if (previous && JSON.stringify(previous) === JSON.stringify(entry)) return;
  if (actor?.flags?.[MODULE_ID]?.actionReceipts?.turnKey === snapshot.key) {
    await writeReceipts(context, snapshot, { [`entries.${step.instanceId}`]: entry });
  } else {
    await writeReceipts(context, snapshot, { entries: { [step.instanceId]: entry } });
  }
}

export async function refundTrackedExecution(context, step) {
  const snapshot = currentActionTurn();
  if (!snapshot || context?.combatant?.id !== snapshot.combatantId || context.combat?.id !== globalThis.game?.combat?.id
    || (context.actionTracker?.turnKey && context.actionTracker.turnKey !== snapshot.key)) return;
  const entry = receiptData(context, snapshot).entries?.[step?.instanceId];
  if (entry) await writeReceipts(context, snapshot, { [`entries.${step.instanceId}.reverted`]: true });
}

export async function adjustTrackedActions(context, pool, delta) {
  const snapshot = currentActionTurn();
  if (!snapshot || context?.actionTracker?.turnKey !== snapshot.key || !["normal", "quickened"].includes(pool)) return;
  const current = receiptData(context, snapshot);
  await writeReceipts(context, snapshot, { [`${pool}Adjustment`]: (current[`${pool}Adjustment`] ?? 0) + delta });
}

export async function setQuickenedAllowance(context, slugs) {
  const snapshot = currentActionTurn();
  if (globalThis.game?.user?.isGM !== true || !context?.actionTracker) return;
  const quickenedAllowed = [...new Set(slugs.map(slugify).filter(Boolean))];
  const actor = actorDocument(context);
  const conditions = quickenedConditions(actor).filter((item) => item.id);
  // Keep the GM's choice with this application, so new turns retain it but a
  // later Quickened condition from another source starts with its own restrictions.
  if (conditions.length && typeof actor?.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", conditions.map((item) => ({
      _id: item.id, [`flags.${MODULE_ID}.quickenedAllowed`]: quickenedAllowed,
    })));
  }
  if (snapshot && context.actionTracker.turnKey === snapshot.key
    && context.combatant?.id === snapshot.combatantId && currentActionTurn()?.key === snapshot.key) {
    await writeReceipts(context, snapshot, { quickenedAllowed });
  }
}

export function registerActionTrackerHooks(refresh) {
  const hooks = globalThis.Hooks;
  hooks.on("preUpdateCombat", (combat, changed, options = {}) => {
    if (!("turn" in changed || "round" in changed)) return;
    let snapshot = createTurnSnapshot(combat, {
      round: Object.hasOwn(changed, "round") ? changed.round : combat.round,
      turn: Object.hasOwn(changed, "turn") ? changed.turn : combat.turn,
      ...(options.combaterNextCombatantId ? { combatant: combat.combatants.get(options.combaterNextCombatantId) } : {}),
    });
    const previous = combat.flags?.[MODULE_ID]?.actionTurn;
    if (snapshot && previous?.round === snapshot.round && previous.combatantId === snapshot.combatantId) {
      snapshot = { ...previous, turn: snapshot.turn };
    }
    changed[`flags.${MODULE_ID}.actionTurn`] = snapshot;
  });
  hooks.on("preCreateChatMessage", (message) => {
    const entry = chatActionEntry(message);
    if (entry) message.updateSource({ [`flags.${MODULE_ID}.actionSpend`]: entry });
    else if (message.flags?.[MODULE_ID]?.actionSpend) message.updateSource({ [`flags.${MODULE_ID}.actionSpend`]: null });
  });
  hooks.on("preUpdateChatMessage", (message, changed) => {
    const existing = message.flags?.[MODULE_ID]?.actionSpend;
    if (!existing || existing.phase !== "card" || !("content" in changed || "flavor" in changed)) return;
    let item;
    try { item = message.item; } catch (_error) { /* Keep the saved cost if the origin disappeared. */ }
    const entry = readChatAction({
      content: changed.content ?? message.content,
      flavor: changed.flavor ?? message.flavor,
      flags: message.flags, item,
    });
    // Spell variants can replace a card's cost. Preserve its original turn identity.
    if (entry) changed[`flags.${MODULE_ID}.actionSpend`] = { ...existing, ...entry };
  });
  for (const event of ["createChatMessage", "updateChatMessage", "deleteChatMessage"]) {
    hooks.on(event, (message) => {
      if (message.flags?.[MODULE_ID]?.actionSpend) refresh("chat-actions");
    });
  }
  hooks.on("ready", async () => {
    const combat = globalThis.game?.combat;
    if (!combat?.started || currentActionTurn(combat) || globalThis.game?.users?.activeGM?.id !== globalThis.game?.user?.id) return;
    await combat.update({ [`flags.${MODULE_ID}.actionTurn`]: createTurnSnapshot(combat) });
  });
  hooks.on("updateCombat", (_combat, changed) => {
    if (changed.flags?.[MODULE_ID]?.actionTurn || changed[`flags.${MODULE_ID}.actionTurn`]) refresh("chat-actions");
  });
  for (const event of ["createItem", "updateItem", "deleteItem"]) {
    hooks.on(event, (item, ...args) => {
      if ((item.slug ?? item.system?.slug) !== "stunned") return;
      const userId = args.at(-1);
      const authority = globalThis.game?.users?.activeGM?.id ?? userId;
      if (authority !== globalThis.game?.user?.id) return;
      const actor = item.actor ?? item.parent;
      const snapshot = currentActionTurn();
      if (!snapshot || globalThis.game?.combat?.combatant?.actor !== actor) return;
      const scope = executionScopes.get(snapshot.actorId);
      conditionQueue = conditionQueue.then(async () => {
        // Spring 2026 errata: finish the current activity before paying Stunned
        // with remaining actions. Its execution receipt must be saved first.
        if (scope?.turnKey === snapshot.key) await scope.done;
        if (currentActionTurn()?.key !== snapshot.key) return;
        // Read live state after queued document writes, including our own value
        // reductions. Repeated hooks must not reapply an old condition value.
        const profile = conditionProfile(actor);
        const stunned = profile.conditions.values.stunned;
        const context = {
          actor, combatant: globalThis.game.combat.combatant, combat: globalThis.game.combat,
          actionsSpent: { movement: movementActionsSpent() },
        };
        const receipts = receiptData(context, snapshot);
        const previous = receipts.lastStunned ?? snapshot.pool.stunned;
        const increase = Math.max(0, stunned - previous);
        const budget = actionBudget(trackedActionContext(context));
        const lost = profile.stunnedDuration ? budget.totalActions : increase;
        const quickenedLoss = Math.min(budget.quickenedActions, lost);
        const normalLoss = Math.min(budget.normalActions, lost - quickenedLoss);
        const paid = quickenedLoss + normalLoss;
        const manager = globalThis.game?.pf2e?.ConditionManager;
        const conditions = !profile.stunnedDuration && paid > 0 && typeof manager?.updateConditionValue === "function"
          ? collectionValues(actor.itemTypes?.condition).filter((condition) =>
            (condition.slug ?? condition.system?.slug) === "stunned" && condition.id
            && !condition.inMemoryOnly && !condition.system?.expired && condition.system?.value?.isValued !== false)
          : [];
        await writeReceipts(context, snapshot, {
          lastStunned: conditions.length ? Math.max(0, stunned - paid) : stunned,
          normalAdjustment: (receipts.normalAdjustment ?? 0) + normalLoss,
          quickenedAdjustment: (receipts.quickenedAdjustment ?? 0) + quickenedLoss,
        });
        // Use PF2e's native update/delete path. Reduce overlapping instances
        // together so removing the strongest cannot charge a weaker one again.
        for (const condition of conditions) {
          const value = Number(condition.value ?? condition.system?.value?.value) || 1;
          await manager.updateConditionValue(condition.id, actor, Math.max(0, value - paid));
        }
        refresh("chat-actions");
      }).catch((error) => console.warn(`${MODULE_ID} | Stunned action tracking failed`, error));
    });
  }
}
