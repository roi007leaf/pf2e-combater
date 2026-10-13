import assert from "node:assert/strict";
import { buildCandidates } from "../candidates.js";
import { builderAtomicActionsForStep } from "../action/builder/index.js";
import { preparePanelContext } from "../../ui/panel/context-workflow.js";
import { readCombatContext } from "../../state/combat-context.js";
import { writeDraftPlan } from "../../state/draft-plans.js";
import { createTurnSnapshot } from "../../state/action-tracker.js";
import { executeDraftStep } from "../action/executor.js";

const saved = { game: globalThis.game, canvas: globalThis.canvas, localStorage: globalThis.localStorage };
const storage = new Map();
const flurry = {
  id: "flurry", uuid: "Actor.monk.Item.flurry", type: "action", name: "Flurry of Blows",
  system: {
    slug: "flurry-of-blows", actionType: { value: "action" }, actions: { value: 1 },
    traits: { value: ["monk", "flourish"] },
    description: { value: "Make two unarmed Strikes. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses. Apply your multiple attack penalty to the Strikes normally." },
  },
};
const fist = { id: "fist", uuid: "Actor.monk.Item.fist", type: "weapon", name: "Fist",
  system: { slug: "fist", category: "unarmed", traits: { value: ["unarmed", "agile", "finesse"] }, damage: { dice: 1, die: "d6", modifier: 4, damageType: "bludgeoning" } } };
function actor(id, type = "character") {
  return { id, uuid: `Actor.${id}`, name: id, type, isOwner: id === "monk", items: [],
    testUserPermission: () => id === "monk", flags: {},
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        let target = this;
        for (const key of parts.slice(0, -1)) target = target[key] ??= {};
        target[parts.at(-1)] = value;
      }
    },
    itemTypes: { action: [], feat: [], feature: [], weapon: [], consumable: [], spell: [], condition: [], effect: [] },
    system: { attributes: { hp: { value: 40, max: 40 }, speed: { value: 25 }, reach: { base: 5, manipulate: 5 }, ac: { value: 20 } }, traits: { value: [], size: { value: "med" } }, actions: [] },
  };
}
function token(document, x, disposition) {
  const entry = { id: document.id, name: document.name, actor: document, center: { x: x + 50, y: 50 }, w: 100, h: 100, setTarget() {},
    document: { id: document.id, uuid: `Scene.scene.Token.${document.id}`, actor: document, disposition, x, y: 0, width: 1, height: 1 },
  };
  entry.document.object = entry;
  return entry;
}

try {
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const monk = actor("monk");
  monk.items = [flurry, fist];
  monk.itemTypes.action = [flurry];
  monk.itemTypes.weapon = [fist];
  let rolls = 0;
  monk.system.actions = [{ slug: "fist", label: "Fist", name: "Fist", type: "strike", visible: true, ready: true, canAttack: true,
    item: fist, totalModifier: 11, variants: [0, 1, 2].map(() => ({ roll: async () => { rolls += 1; return null; } })) }];
  const selected = token(monk, 100, 1);
  const enemy = token(actor("horse", "npc"), 200, -1);
  const combatant = { id: "monk-turn", actor: monk, tokenId: selected.id, token: selected.document, initiative: 20 };
  const enemyCombatant = { id: "horse-turn", actor: enemy.actor, tokenId: enemy.id, token: enemy.document, initiative: 10 };
  const combat = { id: "combat", started: true, round: 1, turn: 0, combatant, combatants: [combatant, enemyCombatant], turns: [combatant, enemyCombatant], flags: {} };
  globalThis.game = { user: { id: "player", isGM: false, targets: new Set([enemy]) }, combat, messages: [] };
  globalThis.canvas = { scene: { id: "scene", grid: { distance: 5, size: 100 } },
    grid: { size: 100, measurePath: ([from, to]) => ({ distance: Math.hypot(to.x - from.x, to.y - from.y) / 20 }) },
    tokens: { controlled: [selected], placeables: [selected, enemy] },
  };
  const snapshot = createTurnSnapshot(combat, { key: "monk-current-turn" });
  combat.flags["pf2e-combater"] = { actionTurn: snapshot };
  monk.flags["pf2e-combater"] = { actionReceipts: { turnKey: snapshot.key,
    entries: { approach: { cost: 1, slug: "stride", movement: true } }, normalAdjustment: 1 } };
  const context = readCombatContext("test", { combatant });
  const liveFlurry = buildCandidates(context).candidates.find((entry) => entry.slug === "flurry-of-blows");
  assert.ok(liveFlurry?.activityProfile?.backingStrike, "native Fist and Flurry are available after Stride");
  const atoms = builderAtomicActionsForStep(liveFlurry);
  assert.equal(atoms.length, 2);
  writeDraftPlan(context, { steps: [
    { instanceId: "approach", actionKey: "stride", name: "Stride", actionCost: 1, execution: { status: "done" } },
    ...atoms.map((entry, index) => ({ instanceId: `flurry-${index}`, actionKey: entry.id, name: entry.name,
      actionCost: entry.actionCost, groupId: entry.groupId, groupLabel: entry.groupLabel, atomIndex: entry.atomIndex,
      targetTokenIds: [enemy.id], targetLabel: enemy.name, targetSelection: "manual" })),
  ] });
  const panel = {
    _browser: null, _selectedCombatant: combatant, refreshSource: "test", activeTab: "one", searchQuery: "",
    _activeAutoFillPlans() { return this._autoFillPlans ?? []; }, _activePinnedPlanId: () => null,
    _actorForMovement: (ctx) => ctx.actor.document,
  };
  const closed = preparePanelContext(panel);
  panel._browser = {};
  const opened = preparePanelContext(panel);
  assert.ok(opened.builder.draft.steps.slice(1).every((step) => !step.stale), "opening Browse resolves both Flurry strikes");
  assert.equal(closed.actionTracker.countLabel, "1/3");
  assert.ok(closed.builder.draft.steps.slice(1).every((step) => !step.stale), "closed Browse must still resolve available Flurry strikes after Stride");
  assert.deepEqual(closed.builder.draft.steps.slice(1).map((step) => step.action.executable), ["strike", "strike"]);
  assert.deepEqual(closed.builder.draft.steps.slice(1).map((step) => step.actionCost), [1, 0], "both strikes share Flurry's one-action cost");
  assert.ok(closed.builder.draft.steps.slice(1).every((step) => step.canShowExecuteStep), "both strike buttons remain available");
  const firstResult = await executeDraftStep({ context: panel._context, step: closed.builder.draft.steps[1] });
  assert.equal(firstResult.status, "done", "first Fist executes through the native strike roller");
  writeDraftPlan(context, { steps: closed.builder.draft.steps.map((step, index) => index === 1 ? { ...step, ...firstResult.patch } : step) });
  panel._browser = null;
  const afterFirst = preparePanelContext(panel);
  assert.equal(afterFirst.actionTracker.countLabel, "0/3");
  assert.equal(afterFirst.builder.draft.steps[2].stale, false, "second Fist remains available when the activity's action is already spent");
  const secondResult = await executeDraftStep({ context: panel._context, step: afterFirst.builder.draft.steps[2] });
  assert.equal(secondResult.status, "done");
  assert.equal(rolls, 2, "both grouped strikes execute once");
  monk.itemTypes.action = [];
  monk.items = [fist];
  panel._autoFillPreparationCache = null;
  const removed = preparePanelContext(panel);
  assert.equal(removed.builder.draft.steps[2].stale, true, "removing Flurry still invalidates its remaining strike instead of borrowing a standalone Fist");
  console.log("Grouped draft refresh tests passed");
} finally {
  Object.assign(globalThis, saved);
}
