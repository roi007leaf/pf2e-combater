import assert from "node:assert/strict";
import { actionBudget } from "../action/budget.js";
import { createTurnSnapshot, trackedActionContext, recordTrackedExecution, refundTrackedExecution } from "../../state/action-tracker.js";
import { actionTrackerView } from "../../ui/panel/action-tracker.js";
import { buildTurnPlans } from "../planner.js";
import { fighterContext, fixtureCandidates } from "../fixtures.js";
import { clearMovementActionSpends } from "../../state/token-refresh.js";

const actor = {
  id: "canvas-actor", isOwner: true, flags: {},
  system: { movement: { speeds: { land: { value: 25 }, fly: { value: 40 } } }, attributes: { speed: { value: 15 } } },
  itemTypes: { condition: [], effect: [] },
};
const token = { id: "canvas-token", parent: { id: "canvas-scene" }, actor, _source: { _movementHistory: [] } };
const combatant = { id: "canvas-combatant", actor, token, tokenId: token.id, sceneId: token.parent.id };
const combat = { id: "canvas-combat", started: true, round: 1, turn: 0, combatant, turns: [combatant], flags: {} };
const context = { ...fighterContext, combat, combatant, actor: { ...fighterContext.actor, document: actor }, actionsSpent: { movement: 0 } };
const startTurn = () => { combat.flags["pf2e-combater"] = { actionTurn: createTurnSnapshot(combat) }; };
const read = (messages = []) => trackedActionContext(context, { combat, messages });
const waypoint = (movementId, cost, action = "walk", subpathId = movementId) => ({ movementId, subpathId, cost, action });
const history = (...points) => { token._source._movementHistory = points; };
const globals = { game: globalThis.game };
actor.update = async (changes) => {
  for (const [path, value] of Object.entries(changes)) {
    const parts = path.split(".");
    let destination = actor;
    for (const part of parts.slice(0, -1)) destination = destination[part] ??= {};
    if (parts.at(-1).startsWith("-=")) delete destination[parts.at(-1).slice(2)];
    else destination[parts.at(-1)] = value;
  }
};
try {
  globalThis.game = { combat, messages: [], user: { id: "gm", isGM: true } };
  startTurn();
  history(waypoint("drag", 25));
  assert.equal(actionBudget(read()).normalActions, 2, "canvas Stride uses one prepared Speed of movement");
  history(waypoint("drag", 25), waypoint("drag", 10));
  assert.equal(actionBudget(read()).normalActions, 1, "a 35-foot path at Speed 25 spends two actions");
  assert.equal(actionTrackerView(read()).normal, 1);
  assert.ok(buildTurnPlans(read(), fixtureCandidates).every((plan) => plan.totalCost <= 1), "Auto-fill uses the post-movement remainder");
  assert.equal(actionBudget(read()).normalActions, 1, "rereading a path never spends it twice");
  clearMovementActionSpends();
  assert.equal(actionBudget(read()).normalActions, 1, "native history survives loss of local movement caches");
  globalThis.game.user = { id: "player", isGM: false };
  assert.equal(actionBudget(read()).normalActions, 1, "player clients read the same recorded cost without local origins");
  globalThis.game.user = { id: "gm", isGM: true };
  history(waypoint("drag", 10), waypoint("keyboard", 10, "walk", "drag"));
  assert.equal(actionBudget(read()).normalActions, 2, "continued movement in the same native subpath shares a Stride");
  history(waypoint("drag", 10), waypoint("new-stride", 10));
  assert.equal(actionBudget(read()).normalActions, 1, "separate native subpaths spend separate Strides");
  history(waypoint("terrain", 50));
  assert.equal(actionBudget(read()).normalActions, 1, "native cost already accounts for difficult terrain and diagonal movement");
  history(waypoint("move-before-undo", 25));
  assert.equal(actionBudget(read()).normalActions, 2, "shortening history refunds the undone movement");
  history();
  assert.equal(actionBudget(read()).normalActions, 3, "undoing all movement refunds all its actions");
  history(waypoint("forced", 100, "displace"), waypoint("teleport", 100, "blink"));
  assert.equal(actionBudget(read()).normalActions, 3, "forced movement and teleport distance are not Strides");

  actor.itemTypes.condition = [{ slug: "quickened" }];
  actor.itemTypes.effect = [{ slug: "spell-effect-haste" }];
  startTurn();
  history(waypoint("quick-stride", 75));
  assert.equal(actionBudget(read()).normalActions, 1);
  assert.equal(actionBudget(read()).quickenedActions, 0, "canvas walking can spend Haste's restricted action");
  history(waypoint("quick-stride", 100));
  assert.equal(actionBudget(read()).totalActions, 0, "four Strides spend all four actions without a three-action cap");
  history(waypoint("fly", 40, "fly"));
  assert.equal(actionBudget(read()).normalActions, 2, "Fly uses the actor's Fly Speed");
  assert.equal(actionBudget(read()).quickenedActions, 1, "Haste's Stride allowance does not fund Fly");

  const message = { id: "stride-card", flags: { "pf2e-combater": { actionSpend: {
    turnKey: combat.flags["pf2e-combater"].actionTurn.key, cost: 1, slug: "stride", movement: true, phase: "card",
  } } } };
  history(waypoint("posted-stride", 50));
  assert.equal(read([message]).actionsSpent.total, 2, "a Stride chat card and the same canvas Stride are counted once");
  const flyMessage = structuredClone(message);
  flyMessage.flags["pf2e-combater"].actionSpend.slug = "fly";
  assert.equal(read([flyMessage]).actionsSpent.total, 3, "a Fly card does not cover a separate canvas Stride");

  history();
  startTurn();
  const step = { instanceId: "managed", actionCost: 1, action: { slug: "stride", requiresDestination: true } };
  history(waypoint("managed-move", 25));
  await recordTrackedExecution(read(), step, { status: "done", patch: { execution: { revert: { ops: [{ kind: "movement", movementId: "managed-move" }] } } } });
  assert.equal(read().actionsSpent.total, 1, "executing Stride through Combater does not also spend its canvas movement");
  history(waypoint("managed-move", 25), waypoint("manual-after", 25));
  assert.equal(read().actionsSpent.total, 2, "a later manual Stride is a separate spend");
  history(waypoint("managed-move", 25));
  assert.equal(read().actionsSpent.total, 1);
  history();
  await refundTrackedExecution(read(), step);
  assert.equal(read().actionsSpent.total, 0);

  history(waypoint("old-turn", 50));
  combat.round += 1;
  startTurn();
  assert.equal(read().actionsSpent.total, 0, "turn-start history is excluded even before Foundry clears it");
  history(waypoint("new-turn", 25));
  assert.equal(read().actionsSpent.total, 1, "new movement counts after native history resets");
} finally {
  globalThis.game = globals.game;
}
console.log("canvas action tracker tests passed");
