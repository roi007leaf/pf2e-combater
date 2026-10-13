import assert from "node:assert/strict";
import { actionBudget } from "../action/budget.js";
import { beginTrackedExecution, createTurnSnapshot, recordTrackedExecution, registerActionTrackerHooks, trackedActionContext } from "../../state/action-tracker.js";

const MODULE = "pf2e-combater";
const saved = { game: globalThis.game, Hooks: globalThis.Hooks };
const callbacks = new Map();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let sequence = 0;
let actor;
let combat;
const emit = (event, item, ...args) => {
  for (const handler of callbacks.get(event) ?? []) handler(item, ...args, "gm");
};
const condition = (slug, value = 1) => ({ id: `${slug}-${++sequence}`, slug, system: { value: { value, isValued: value !== null } } });
function fixture({ quickened = true } = {}) {
  actor = {
    id: "actor", flags: {}, itemTypes: { condition: quickened ? [condition("quickened")] : [], effect: [] },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        let target = this;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = value;
      }
    },
  };
  const combatant = { id: "combatant", actor };
  combat = { id: "combat", started: true, round: 1, turn: 0, combatant, turns: [combatant], flags: {} };
  combat.flags[MODULE] = { actionTurn: createTurnSnapshot(combat, { key: `turn-${++sequence}` }) };
  globalThis.game.combat = combat;
  return { actor, combat, combatant };
}
function applyStunned(value) {
  const item = { ...condition("stunned", value), actor };
  actor.itemTypes.condition.push(item);
  emit("createItem", item, {});
  return item;
}
const stunnedValue = () => Math.max(0, ...actor.itemTypes.condition.filter((item) => item.slug === "stunned")
  .map((item) => item.system.value.value ?? 0));
const budget = (context) => actionBudget(trackedActionContext(context));

try {
  globalThis.game = {
    user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } }, messages: [],
    pf2e: { ConditionManager: { async updateConditionValue(id, owner, value) {
      const item = owner.itemTypes.condition.find((entry) => entry.id === id);
      if (!item) return;
      if (value === 0) {
        owner.itemTypes.condition = owner.itemTypes.condition.filter((entry) => entry !== item);
        emit("deleteItem", item, {});
      } else {
        item.system.value.value = value;
        emit("updateItem", item, { "system.value.value": value }, {});
      }
    } } },
  };
  globalThis.Hooks = { on(event, callback) { callbacks.set(event, [...(callbacks.get(event) ?? []), callback]); } };
  registerActionTrackerHooks(() => {});

  let context = fixture();
  const first = applyStunned(1);
  emit("updateItem", first, {}, {});
  await tick();
  assert.equal(budget(context).normalActions, 3);
  assert.equal(budget(context).quickenedActions, 0, "Stunned spends the restricted action during this turn");
  assert.equal(stunnedValue(), 0, "paying Stunned 1 clears it instead of charging again next turn");
  assert.ok(actor.itemTypes.condition.some((item) => item.slug === "quickened"), "Quickened condition stays active");
  assert.equal(createTurnSnapshot(combat).pool.totalActions, 4, "next turn regains the extra action");
  applyStunned(1);
  await tick();
  assert.equal(budget(context).normalActions, 2, "a second Stunned application still spends an action");
  assert.equal(stunnedValue(), 0);

  context = fixture();
  applyStunned(5);
  await tick();
  assert.equal(budget(context).totalActions, 0);
  assert.equal(stunnedValue(), 1, "only actions actually lost reduce the condition");
  assert.equal(createTurnSnapshot(combat).pool.totalActions, 3, "unpaid Stunned carries into next turn");

  context = fixture({ quickened: false });
  const step = { instanceId: "spell", actionCost: 2, slug: "cast-a-spell" };
  const end = beginTrackedExecution(context, step);
  applyStunned(2);
  await tick();
  assert.equal(budget(context).normalActions, 3, "finish the in-progress activity before consuming remaining actions");
  assert.equal(stunnedValue(), 2);
  await recordTrackedExecution(context, step, { status: "done" });
  end();
  await tick();
  assert.equal(budget(context).totalActions, 0);
  assert.equal(stunnedValue(), 1, "the completed two-action activity leaves only one action to pay Stunned");

  context = fixture();
  applyStunned(null);
  await tick();
  assert.equal(budget(context).totalActions, 0);
  assert.ok(actor.itemTypes.condition.some((item) => item.slug === "stunned"), "duration-based Stunned is not removed by paying actions");

  context = fixture();
  combat.combatant = { id: "other", actor: { id: "other" } };
  applyStunned(1);
  await tick();
  assert.equal(stunnedValue(), 1, "off-turn Stunned waits for the next action pool");
  assert.equal(actor.flags[MODULE], undefined);

  context = fixture();
  globalThis.game.user = { id: "player", isGM: false };
  applyStunned(1);
  await tick();
  assert.equal(budget(context).totalActions, 4, "the player client leaves authoritative deductions to the active GM");
  assert.equal(stunnedValue(), 1);
  console.log("PF2e Combater | Mid-turn Stunned tests passed");
} finally {
  Object.assign(globalThis, saved);
}
