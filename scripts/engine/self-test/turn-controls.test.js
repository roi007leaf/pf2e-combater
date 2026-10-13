import assert from "node:assert/strict";
import { MODULE_ID } from "../../constants.js";
import { createTurnSnapshot, registerActionTrackerHooks, trackedActionContext } from "../../state/action-tracker.js";
import { attacksThisTurn, delayedTurn, delayTargets, handleTurnControl, orderAfter, reactionUsed, readiedAction, registerTurnControlHooks, turnIdentity } from "../../state/turn-controls.js";
import { readyChoices, turnControlsView } from "../../ui/panel/turn-controls.js";
import { upcomingTurnsView } from "../../ui/panel/upcoming-turns.js";
import { setSocket, requestTurnControl } from "../../socket.js";

const previous = { game: globalThis.game, Hooks: globalThis.Hooks };
const gm = { id: "gm", isGM: true, isActiveGM: true, active: true };
const players = ["a", "b", "c", "d"].map((id) => ({ id: `p-${id}`, isGM: false, active: true }));
const users = new Map([gm, ...players].map((user) => [user.id, user]));
users.activeGM = gm;
let handlers;
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) merge(target[key] ??= {}, value);
    else target[key] = value;
  }
}
function apply(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes(".")) { merge(target, { [key]: value }); continue; }
    const parts = key.split(".");
    let holder = target;
    for (const part of parts.slice(0, -1)) holder = holder[part] ??= {};
    const last = parts.at(-1);
    if (last.startsWith("-=")) delete holder[last.slice(2)];
    else holder[last] = value;
  }
}
function fixture({ active = "a", ties = false } = {}) {
  handlers = new Map();
  globalThis.Hooks = { on(name, fn) { const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list); } };
  const combat = {
    id: "combat", started: true, round: 1, turn: 0, flags: {}, settings: { skipDefeated: true }, events: [], updates: [],
    get combatant() { return this.turns[this.turn]; },
    getTimeDelta: () => 0,
    async update(changed, options = {}) {
      this.updates.push({ changed, options });
      for (const fn of handlers.get("preUpdateCombat") ?? []) fn(this, changed, options);
      const old = this.combatant;
      const oldRound = this.round;
      const prior = { combatantId: old?.id, round: oldRound, turn: this.turn };
      if (options.turnEvents !== false) this.previous = prior;
      for (const update of changed.combatants ?? []) apply(this.combatants.get(update._id), update);
      const { combatants: _combatants, ...ownChanges } = changed;
      apply(this, ownChanges);
      this.turns.sort((a, b) => b.initiative - a.initiative
        || (a.flags.pf2e.overridePriority?.[a.initiative] ?? 3) - (b.flags.pf2e.overridePriority?.[b.initiative] ?? 3)
        || a.id.localeCompare(b.id));
      const next = this.combatant;
      if (options.turnEvents !== false) {
        // Foundry advances by numeric intervals. Backwards index changes are
        // rewinds, not end/start events; only same-index identity swaps advance.
        const transitions = [];
        for (let round = oldRound; round <= this.round; round += 1) {
          const first = round === oldRound ? prior.turn + 1 : 0;
          const last = round === this.round ? this.turn : this.turns.length - 1;
          for (let turn = first; turn <= last; turn += 1) transitions.push({ actor: this.turns[turn], round, skipped: round !== this.round || turn !== this.turn });
        }
        if (old !== next && oldRound === this.round && prior.turn === this.turn) transitions.push({ actor: next, round: this.round, skipped: false });
        let from = { actor: old, round: oldRound, skipped: false };
        for (const to of transitions) {
          if (!from.skipped && from.actor.flags.pf2e.roundOfLastTurnEnd !== from.round) {
            this.events.push(`end:${from.actor.id}:${from.round}`);
            from.actor.flags.pf2e.roundOfLastTurnEnd = from.round;
          }
          if (to.actor.flags.pf2e.roundOfLastTurn !== to.round) {
            this.events.push(`start:${to.actor.id}:${to.round}`);
            to.actor.flags.pf2e.roundOfLastTurn = to.round;
          }
          from = to;
        }
      }
      for (const fn of handlers.get("updateCombat") ?? []) await fn(this, changed, options);
      return this;
    },
    async nextTurn() {
      const next = this.turns.findIndex((entry, index) => index > this.turn && !entry.isDefeated);
      return this.update({ turn: next < 0 ? 0 : next, round: this.round + Number(next < 0) });
    },
  };
  combat.turns = ["a", "b", "c", "d"].map((id, index) => ({
    id, name: id.toUpperCase(), initiative: ties ? 20 : 40 - index * 10, flags: { pf2e: {} }, visible: true,
    actor: { id, itemTypes: { condition: [], effect: [] }, testUserPermission: (user) => user?.id === `p-${id}` },
    async update(patch) { apply(this, patch); },
  }));
  combat.combatants = new Map(combat.turns.map((entry) => [entry.id, entry]));
  combat.turn = combat.turns.findIndex((entry) => entry.id === active);
  for (const entry of combat.turns.slice(0, combat.turn)) Object.assign(entry.flags.pf2e, { roundOfLastTurn: 1, roundOfLastTurnEnd: 1 });
  combat.combatant.flags.pf2e.roundOfLastTurn = 1;
  globalThis.game = { user: gm, users, combat, combats: new Map([[combat.id, combat]]), messages: [] };
  combat.flags[MODULE_ID] = { actionTurn: createTurnSnapshot(combat) };
  registerActionTrackerHooks(() => {});
  registerTurnControlHooks(() => {});
  return combat;
}
const act = (combat, action, extra = {}, user = `p-${combat.combatant.id}`) => handleTurnControl.call({ socketdata: { userId: user } }, { ...turnIdentity(combat), action, ...extra });
const context = (combat, id = combat.combatant.id) => ({ combat, combatant: combat.combatants.get(id), actor: combat.combatants.get(id).actor });

try {
  let combat = fixture();
  await assert.rejects(act(combat, "end", {}, "p-b"), /own turn/);
  await act(combat, "end");
  assert.equal(combat.combatant.id, "b");
  assert.deepEqual(combat.events, ["end:a:1", "start:b:1"]);
  const request = { ...turnIdentity(combat), action: "end" };
  const doubleClick = await Promise.allSettled([1, 2].map(() => handleTurnControl.call({ socketdata: { userId: "p-b" } }, request)));
  assert.equal(doubleClick.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(combat.combatant.id, "c", "double-click advances once");

  combat = fixture();
  combat.combatant.actor.itemTypes.condition = [{ slug: "slowed", system: { value: { value: 1 } } }];
  combat.flags[MODULE_ID].actionTurn = createTurnSnapshot(combat);
  await act(combat, "delay", { afterId: "c" });
  assert.deepEqual(combat.turns.map((entry) => entry.id), ["b", "c", "a", "d"]);
  assert.equal(combat.combatant.id, "b");
  assert.equal(combat.flags[MODULE_ID].actionTurn.combatantId, "b", "atomic reorder snapshots the correct next creature");
  assert.deepEqual(upcomingTurnsView(combat).entries.map((entry) => entry.id), ["c", "a"], "preview follows the delayed initiative position");
  assert.equal(delayedTurn(combat.combatants.get("a")).afterId, "c");
  const view = turnControlsView(context(combat, "a"), combat, players[0]);
  assert.match(view.waitingLabel, /C/);
  assert.equal(view.controlsCurrent, false);
  assert.equal(view.delayed.length, 0, "players have no GM return controls");
  assert.match(turnControlsView(context(combat, "a"), combat, gm).endLabel, /B/, "GM controls identify the active creature when viewing another actor");
  combat.combatants.get("c").hidden = true;
  assert.match(turnControlsView(context(combat, "a"), combat, players[0]).waitingLabel, /Unknown creature/, "GM scheduling cannot expose a hidden target to the waiting player");
  combat.combatants.get("c").hidden = false;
  assert.equal(turnControlsView(context(combat), combat, gm).delayed[0].id, "a");
  combat.combatants.get("a").actor.itemTypes.condition = [];
  assert.equal(trackedActionContext(context(combat, "a")).turnActionPool.normalActions, 2, "waiting tracker shows the preserved turn allowance");
  await combat.nextTurn();
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "a", "automatically returns after chosen creature");
  assert.equal(delayedTurn(combat.combatant), null);
  assert.equal(combat.flags[MODULE_ID].actionTurn.pool.normalActions, 2, "Delay preserves the original slowed allowance");
  assert.equal(combat.events.filter((event) => event.startsWith("start:a:")).length, 0, "return does not repeat native turn-start effects");
  await combat.nextTurn();
  assert.equal(combat.events.filter((event) => event.startsWith("end:a:")).length, 1, "delay's end effects do not run twice");

  combat = fixture({ ties: true });
  await act(combat, "delay", { afterId: "c" });
  assert.deepEqual(combat.turns.map((entry) => entry.id), ["b", "c", "a", "d"], "native PF2e tie priorities give an exact position");
  assert.ok(combat.turns.every((entry) => entry.initiative === 20));
  await assert.rejects(act(combat, "return", { delayedId: "a" }, "p-a"), /Only the GM/);
  await act(combat, "return", { delayedId: "a" }, "gm");
  assert.equal(combat.combatant.id, "a");
  assert.deepEqual(combat.turns.map((entry) => entry.id), ["b", "a", "c", "d"]);
  assert.deepEqual(upcomingTurnsView(combat).entries.map((entry) => entry.id), ["c", "d"], "GM return advances the preview");
  assert.equal(combat.previous.combatantId, "b");

  combat = fixture({ active: "d" });
  assert.ok(delayTargets(combat, players[3]).every((entry) => entry.nextRound));
  await act(combat, "delay", { afterId: "b" });
  assert.equal(combat.round, 2);
  assert.equal(combat.combatant.id, "a");
  await combat.nextTurn();
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "d");
  assert.equal(combat.events.includes("start:d:2"), false, "crossing the round boundary still resumes the original turn");

  combat = fixture();
  await act(combat, "delay", { afterId: "b" });
  await act(combat, "delay", { afterId: "c" });
  assert.deepEqual(combat.turns.map((entry) => entry.id), ["c", "b", "a", "d"], "dependent delays move with their chosen creature");
  assert.equal(combat.combatant.id, "c");
  await combat.nextTurn();
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "a");

  combat = fixture({ active: "c" });
  const cInitiative = combat.combatant.initiative;
  await act(combat, "delay", { afterId: "b" });
  await combat.nextTurn();
  await combat.nextTurn();
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "c");
  assert.equal(combat.combatant.initiative, cInitiative, "waiting an entire round preserves the original initiative");
  assert.ok(combat.events.includes("start:c:2"), "a full-round delay gets a fresh turn rather than resuming old actions");

  combat = fixture();
  const snapshot = combat.flags[MODULE_ID].actionTurn;
  globalThis.game.messages = [{ id: "spent", flags: { [MODULE_ID]: { actionSpend: { turnKey: snapshot.key, cost: 1, slug: "seek" } } } }];
  await assert.rejects(act(combat, "delay", { afterId: "b" }), /before spending/);
  globalThis.game.messages = [];
  combat.combatant.actor.itemTypes.condition = [{ slug: "fleeing", system: {} }];
  await assert.rejects(act(combat, "delay", { afterId: "b" }), /condition prevents/);
  combat.combatant.actor.itemTypes.condition = [];
  combat.combatants.get("b").hidden = true;
  await assert.rejects(act(combat, "delay", { afterId: "b" }), /another creature/);
  await assert.rejects(act(combat, "delay", { afterId: "a" }), /another creature/);
  combat.combatants.get("b").hidden = false;
  const stale = { ...turnIdentity(combat), action: "delay", afterId: "c" };
  await combat.nextTurn();
  await assert.rejects(handleTurnControl.call({ socketdata: { userId: "p-a" } }, stale), /no longer active/);
  assert.equal(combat.combatant.id, "b");
  assert.equal(turnControlsView(context(combat), combat, players[0]).controlsCurrent, false);
  setSocket({ executeAsUser: async (...args) => args });
  assert.deepEqual(await requestTurnControl({ action: "end" }), ["turnControl", "gm", { action: "end" }]);
  setSocket(null);
  assert.equal(turnControlsView(context(combat), combat, players[1]).canEnd, false, "no socket disables player turn controls");
  assert.deepEqual(orderAfter(combat, "c", "b").updates, [], "unchanged positions do not rewrite initiative scores");

  for (const active of ["a", "b", "c", "d"]) for (const afterId of ["a", "b", "c", "d"].filter((id) => id !== active)) {
    combat = fixture({ active });
    const originalNext = combat.turns[(combat.turn + 1) % combat.turns.length].id;
    await act(combat, "delay", { afterId });
    assert.equal(combat.combatant.id, originalNext, `${active} delaying after ${afterId} preserves the next creature`);
    assert.deepEqual(combat.events, [`end:${active}:1`, `start:${originalNext}:${combat.round}`], "initiative changes run exactly one end/start pair");
  }

  // Two waiting creatures sit before the GM's current turn. Bringing the group
  // back moves that current turn backwards, which core would treat as a rewind.
  combat = fixture();
  combat.combatants.get("a").flags[MODULE_ID] = { delayedTurn: { afterId: "d", round: 1, pool: combat.flags[MODULE_ID].actionTurn.pool, quickenedAllowed: [] } };
  combat.combatants.get("b").flags[MODULE_ID] = { delayedTurn: { afterId: "a", round: 1, pool: combat.flags[MODULE_ID].actionTurn.pool, quickenedAllowed: [] } };
  combat.turn = 3;
  combat.flags[MODULE_ID].actionTurn = createTurnSnapshot(combat);
  await act(combat, "return", { delayedId: "a" }, "gm");
  assert.deepEqual(combat.turns.map((entry) => entry.id), ["c", "d", "a", "b"]);
  assert.equal(combat.combatant.id, "a");
  assert.equal(combat.previous.combatantId, "d");
  assert.ok(combat.events.includes("end:d:1"), "GM return ends the current turn even when a waiting group changes its index");

  // Ready: 2 actions, the turn ends, and the readied action lasts until the
  // start of the creature's next turn.
  combat = fixture();
  const ready = { label: "  Fist  ", strike: "fist", mapIndex: 7 };
  await assert.rejects(act(combat, "ready", { ...ready, label: " " }), /action to ready/);
  await act(combat, "ready", ready);
  assert.equal(combat.combatant.id, "b", "Ready ends the turn");
  assert.deepEqual(combat.events, ["end:a:1", "start:b:1"]);
  const held = readiedAction(combat.combatants.get("a"));
  assert.equal(held.label, "Fist", "action label is normalized");
  assert.equal(held.mapIndex, 2, "MAP index is clamped to the third attack");
  assert.equal(held.strike, "fist");
  assert.equal(held.skillAction, null, "a readied Strike carries no skill action");
  const readyView = turnControlsView(context(combat, "a"), combat, gm);
  assert.equal(readyView.readied.label, "Fist");
  assert.equal(readyView.readied.canUse, true);
  assert.equal(readyView.visible, true, "a readied creature shows its banner off-turn");
  await assert.rejects(act(combat, "ready-clear", { readiedId: "a" }, "p-b"), /own turn/);
  await combat.nextTurn();
  await combat.nextTurn();
  assert.ok(readiedAction(combat.combatants.get("a")), "readied action survives other creatures' turns");
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "a");
  assert.equal(readiedAction(combat.combatant), null, "readied action expires at its owner's next turn");

  combat = fixture();
  await act(combat, "ready", ready);
  await act(combat, "ready-clear", { readiedId: "a" }, "p-a");
  assert.equal(readiedAction(combat.combatants.get("a")), null, "the owner can use or discard a readied action off-turn");
  await assert.rejects(act(combat, "ready-clear", { readiedId: "a" }, "p-a"), /no readied action/);
  assert.equal(reactionUsed(combat.combatants.get("a")), false, "discarding a readied action spends no reaction");

  // A readied Stride keeps its chosen destination; anything else is dropped.
  combat = fixture();
  await act(combat, "ready", { label: "Stride", movement: { slug: "stride", destination: { x: "150", y: 250, elevation: 5 }, movementPlan: { id: "plan", waypoints: [{ x: 150, y: 250 }] } } });
  assert.deepEqual(readiedAction(combat.combatants.get("a")).movement, {
    slug: "stride", destination: { x: 150, y: 250, elevation: 5 }, movementPlan: { id: "plan", waypoints: [{ x: 150, y: 250 }] },
  }, "a readied Stride stores its destination and route");
  assert.equal(turnControlsView(context(combat, "a"), combat, gm).readied.hasMovement, true, "the readied banner previews a stored route on hover");
  await assert.rejects(act(combat, "ready-move", { readiedId: "a", movement: { destination: { x: 1, y: 2 } } }, "p-b"), /own turn/);
  await act(combat, "ready-move", { readiedId: "a", movement: { slug: "teleport", destination: { x: 300, y: 350 }, movementPlan: null } }, "p-a");
  assert.deepEqual(readiedAction(combat.combatants.get("a")).movement, { slug: "stride", destination: { x: 300, y: 350 }, movementPlan: null },
    "changing the destination replaces the route and keeps the readied action's own movement type");
  assert.equal(readiedAction(combat.combatants.get("a")).label, "Stride");
  await assert.rejects(act(combat, "ready-move", { readiedId: "a", movement: { destination: { x: "nope" } } }, "p-a"), /Choose a destination/);
  combat = fixture();
  await act(combat, "ready", { label: "Interact", movement: { slug: "teleport", destination: { x: 1, y: 2 } } });
  assert.equal(readiedAction(combat.combatants.get("a")).movement, null, "only Stride and Step can carry a readied destination");

  // Using a readied action is a reaction: mark it, and keep PF2e Reaction Checker in sync.
  combat = fixture();
  globalThis.game.modules = new Map([["pf2e-reaction", { active: true }]]);
  combat.combatants.get("a").flags["pf2e-reaction"] = { state: true };
  await act(combat, "ready", ready);
  await act(combat, "ready-clear", { readiedId: "a", used: true }, "p-a");
  assert.equal(reactionUsed(combat.combatants.get("a")), true, "using a readied action spends the reaction");
  assert.equal(combat.combatants.get("a").flags["pf2e-reaction"].state, false, "PF2e Reaction Checker sees the reaction as spent");
  assert.equal(turnControlsView(context(combat, "a"), combat, gm).reactionUsedLabel, "Reaction used");
  await combat.nextTurn();
  await combat.nextTurn();
  await combat.nextTurn();
  assert.equal(combat.combatant.id, "a");
  combat.combatant.flags["pf2e-reaction"].state = true; // Reaction Checker resets at turn start.
  assert.equal(reactionUsed(combat.combatant), false, "the reaction returns at the creature's next turn");
  combat.combatants.get("b").flags["pf2e-reaction"] = { state: false };
  assert.equal(reactionUsed(combat.combatants.get("b")), true, "a reaction spent outside Combater (Reaction Checker) also counts");
  delete globalThis.game.modules;

  // Sundry tracks reactions as an actor effect; read it, and report ours to its API.
  combat = fixture();
  combat.combatants.get("c").actor.itemTypes.effect = [{ slug: "effect-reaction-used", system: { badge: { value: 1 } } }];
  assert.equal(reactionUsed(combat.combatants.get("c")), true, "Sundry's Reaction Used effect counts as a spent reaction");
  combat.combatants.get("c").actor.itemTypes.effect[0].isExpired = true;
  assert.equal(reactionUsed(combat.combatants.get("c")), false, "an expired Sundry effect does not");
  const sundryCalls = [];
  globalThis.game.modules = new Map([["sundry", { active: true }]]);
  globalThis.sundry = { api: { reactionUsed: async (actors) => { sundryCalls.push(actors.map((actor) => actor.id)); } } };
  await act(combat, "ready", ready);
  await act(combat, "ready-clear", { readiedId: "a" }, "p-a");
  assert.deepEqual(sundryCalls, [], "discarding a readied action tells Sundry nothing");
  combat = fixture();
  globalThis.game.modules = new Map([["sundry", { active: true }]]);
  await act(combat, "ready", ready);
  await act(combat, "ready-clear", { readiedId: "a", used: true }, "p-a");
  assert.deepEqual(sundryCalls, [["a"]], "using a readied action is reported to Sundry's reaction tracker");
  delete globalThis.sundry;

  combat = fixture();
  const readySnapshot = combat.flags[MODULE_ID].actionTurn;
  globalThis.game.messages = [{ id: "hit", flags: { [MODULE_ID]: { actionSpend: { turnKey: readySnapshot.key, cost: 1, slug: "strike" } } } }];
  assert.equal(attacksThisTurn(combat), 1, "attacks made this turn feed the readied attack's MAP");
  assert.match(turnControlsView(context(combat), combat, gm).delayDetail, /before spending/, "Delay explains why it is unavailable");
  assert.equal(turnControlsView(context(combat), combat, gm).canReady, true, "Ready works mid-turn with 2 actions left");
  globalThis.game.messages.push({ id: "move", flags: { [MODULE_ID]: { actionSpend: { turnKey: readySnapshot.key, cost: 1, slug: "seek" } } } });
  await assert.rejects(act(combat, "ready", ready), /2 actions remaining/);
  globalThis.game.messages = [];
  combat.combatant.actor.itemTypes.condition = [{ slug: "confused", system: {} }];
  await assert.rejects(act(combat, "ready", ready), /prevents Ready/);
} finally {
  setSocket(null);
  globalThis.game = previous.game;
  globalThis.Hooks = previous.Hooks;
}
// Ready offers single skill actions; trained-only ones need training.
{
  const untrained = readyChoices({ type: "character", skills: { athletics: { rank: 0 }, deception: { rank: 0 } } });
  const skillSlugs = untrained.filter((choice) => choice.group === "skill").map((choice) => choice.action);
  for (const slug of ["trip", "grapple", "shove", "demoralize", "create-a-diversion", "recall-knowledge", "seek", "hide", "take-cover"]) {
    assert.ok(skillSlugs.includes(slug), `${slug} can be readied`);
  }
  assert.ok(!skillSlugs.includes("disarm") && !skillSlugs.includes("feint"), "Disarm and Feint need training");
  assert.ok(!skillSlugs.includes("balance") && !skillSlugs.includes("high-jump"), "terrain moves and 2-action activities are left out");
  const trained = readyChoices({ type: "character", skills: { athletics: { rank: 1 }, deception: { rank: 2 } } });
  assert.ok(trained.some((choice) => choice.action === "disarm") && trained.some((choice) => choice.action === "feint"));
  assert.equal(untrained.find((choice) => choice.action === "trip")?.value, "skill:trip");
}

console.log("Turn controls and Delay tests passed.");
