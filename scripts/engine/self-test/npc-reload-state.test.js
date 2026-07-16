import assert from "node:assert/strict";
import { MODULE_ID } from "../../constants.js";
import { buildTurnPlans } from "../planner.js";
import { revertDraftStep } from "../action/revert.js";
import {
  NPC_RELOAD_STATE_FLAG,
  actionReloadCost,
  npcReloadWeaponKey,
  npcWeaponNeedsReload,
  revertNpcReloadState,
  setNpcWeaponLoaded,
} from "../npc-reload-state.js";
import { executeReloadWeapon } from "../execution/equipment.js";
import { executeStrike } from "../execution/strike.js";
import { readWeaponActions } from "../../readers/weapon-action-reader.js";

function npcFixture() {
  const weapon = {
    id: "sling-weapon",
    uuid: "Actor.npc.Item.sling-weapon",
    name: "Sling",
    type: "weapon",
    isHeld: true,
    system: {
      category: "martial",
      equipped: { carryType: "held", handsHeld: 1 },
      reload: { value: "1" },
    },
    subitems: [],
  };
  const attackItem = {
    id: "sling-attack",
    uuid: "Actor.npc.Item.sling-attack",
    name: "Sling",
    type: "melee",
    flags: { pf2e: { linkedWeapon: weapon.id } },
    system: { traits: { value: ["propulsive", "reload-1"] } },
  };
  const actor = {
    id: "npc",
    uuid: "Actor.npc",
    name: "Umbral Gnome Scout",
    type: "npc",
    flags: { [MODULE_ID]: {} },
    items: [weapon, attackItem],
    itemTypes: { weapon: [weapon] },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return this;
    },
  };
  const strike = {
    id: "strike-sling",
    name: "Sling",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    confidence: "medium",
    executable: "strike",
    attackTrait: true,
    reload: 1,
    item: attackItem,
    score: 100,
    variants: [{ roll: async () => ({}) }],
  };
  return { actor, attackItem, strike, weapon };
}

const { actor, strike, weapon } = npcFixture();
assert.equal(actionReloadCost(strike), 1, "NPC melee reload trait must be understood");
assert.equal(
  actionReloadCost({ ...strike, reload: undefined, activityProfile: { reloadCost: 0 } }),
  1,
  "atomic Strike overhead must not erase its backing weapon's reload trait",
);
assert.equal(npcReloadWeaponKey(strike), weapon.id, "NPC attack and linked weapon must share state");
assert.equal(npcReloadWeaponKey({ item: weapon }), weapon.id);
assert.equal(npcWeaponNeedsReload(actor, strike), false, "untracked NPC weapons start loaded");
assert.equal(
  readWeaponActions(actor, {}, []).some((action) => action.executable === "reload-weapon"),
  false,
  "Browse must not offer Reload while the NPC weapon is loaded",
);

const firedOp = await setNpcWeaponLoaded(actor, strike, false);
assert.equal(actor.flags[MODULE_ID][NPC_RELOAD_STATE_FLAG][weapon.id], false);
assert.equal(npcWeaponNeedsReload(actor, strike), true);
const npcReloadAction = readWeaponActions(actor, {}, []).find((action) => action.executable === "reload-weapon");
assert.equal(
  Boolean(npcReloadAction),
  true,
  "Browse must offer Reload after the NPC weapon fires",
);

const target = { id: "target", name: "Target", distance: 20 };
const context = {
  actor: { document: actor },
  profile: { conditions: { slugs: [], values: {} } },
  targets: [target],
  enemies: [target],
  battlefield: { targets: [target], enemies: [target], allies: [] },
};
const plans = buildTurnPlans(context, [strike, npcReloadAction], { includeCoverage: false });
assert.equal(plans[0].steps[0].activityProfile.reloadBeforeStrike, true);
assert.equal(plans[0].steps[0].reloadCost, 1);
assert.equal(plans[0].steps[0].actionCost, 2, "unloaded NPC strike must reserve Reload + Strike");
assert.equal(
  plans.some((plan) => plan.steps.some((step) => step === npcReloadAction)),
  false,
  "standalone NPC Reload stays available in Browse but the planner owns its placement",
);

await revertNpcReloadState(firedOp, { actor, warnings: [] });
assert.equal(npcWeaponNeedsReload(actor, strike), false, "undoing the first shot restores loaded default");

const previousGame = globalThis.game;
const previousCanvas = globalThis.canvas;
const targetToken = { id: target.id, name: target.name, setTarget: () => undefined };
globalThis.game = { user: { targets: new Set([targetToken]) } };
globalThis.canvas = { tokens: { setTargets: () => undefined, placeables: [] } };
try {
  const strikeResult = await executeStrike({
    actor,
    step: {},
    action: strike,
    choices: { targetTokenIds: [target.id] },
  });
  assert.equal(strikeResult.status, "done");
  assert.equal(npcWeaponNeedsReload(actor, strike), true, "successful NPC Strike must unload its weapon");
  assert.equal(strikeResult.patch.execution.revert.ops[0].kind, "npc-reload-state");

  const reloadResult = await executeReloadWeapon({ actor, action: { ...strike, item: weapon, executable: "reload-weapon" } });
  assert.equal(reloadResult.status, "done");
  assert.equal(npcWeaponNeedsReload(actor, strike), false, "NPC Reload must load its linked attack");
  assert.equal(reloadResult.patch.execution.revert.ops[0].kind, "npc-reload-state");

  const reloadUndo = await revertDraftStep({
    context: { actor: { document: actor } },
    step: { execution: reloadResult.patch.execution },
  });
  assert.equal(reloadUndo.patch.execution.status, "pending");
  assert.equal(npcWeaponNeedsReload(actor, strike), true, "undoing Reload must restore unloaded state");
} finally {
  globalThis.game = previousGame;
  globalThis.canvas = previousCanvas;
}

const conflictWarnings = [];
await setNpcWeaponLoaded(actor, strike, true);
const conflictOp = await setNpcWeaponLoaded(actor, strike, false);
await setNpcWeaponLoaded(actor, strike, true);
await revertNpcReloadState(conflictOp, { actor, warnings: conflictWarnings });
assert.equal(npcWeaponNeedsReload(actor, strike), false, "conflicting manual load state must survive Safe Undo");
assert.ok(conflictWarnings.some((warning) => warning.includes("state changed")));

console.log("PF2e Combater NPC reload-state test passed");
