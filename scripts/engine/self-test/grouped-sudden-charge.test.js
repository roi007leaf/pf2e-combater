import assert from "node:assert/strict";
import { buildCandidates } from "../candidates.js";
import { builderAtomicActionsForStep } from "../action/builder/index.js";
import { preparePanelContext } from "../../ui/panel/context-workflow.js";
import { readCombatContext } from "../../state/combat-context.js";
import { writeDraftPlan } from "../../state/draft-plans.js";
import { createTurnSnapshot } from "../../state/action-tracker.js";

// Sudden Charge (Stride, Stride, Strike) saved as three grouped steps. Its Strike step must be
// re-matched from where the activity starts: projected to the end of its own Strides, the
// activity no longer qualifies, and the Strike used to read "Action is no longer available".
const saved = { game: globalThis.game, canvas: globalThis.canvas, localStorage: globalThis.localStorage };
const storage = new Map();
const suddenCharge = {
  id: "sudden", uuid: "Actor.fighter.Item.sudden", type: "feat", name: "Sudden Charge",
  system: {
    slug: "sudden-charge", actionType: { value: "action" }, actions: { value: 2 },
    traits: { value: ["barbarian", "fighter", "flourish", "open"] },
    description: { value: "Stride twice. If you end your movement within melee reach of at least one enemy, you can make a melee Strike against that enemy." },
  },
};
const boss = { id: "boss", uuid: "Actor.fighter.Item.boss", type: "weapon", name: "+1 Striking Shield Boss",
  system: { slug: "shield-boss", category: "simple", traits: { value: ["attached-to-shield"] }, damage: { dice: 2, die: "d6", modifier: 4, damageType: "bludgeoning" } } };
function actor(id, type = "character") {
  return { id, uuid: `Actor.${id}`, name: id, type, isOwner: id === "fighter", items: [],
    testUserPermission: () => id === "fighter", flags: {},
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
  const fighter = actor("fighter");
  fighter.items = [suddenCharge, boss];
  fighter.itemTypes.feat = [suddenCharge];
  fighter.itemTypes.weapon = [boss];
  fighter.system.actions = [{ slug: "shield-boss", label: "+1 Striking Shield Boss", name: "+1 Striking Shield Boss", type: "strike", visible: true, ready: true, canAttack: true,
    item: boss, totalModifier: 11, variants: [0, 1, 2].map(() => ({ roll: async () => null })) }];
  // 40 feet away: out of reach now, within two Strides.
  const selected = token(fighter, 0, 1);
  const enemy = token(actor("hobgoblin", "npc"), 800, -1);
  const combatant = { id: "fighter-turn", actor: fighter, tokenId: selected.id, token: selected.document, initiative: 20 };
  const enemyCombatant = { id: "hobgoblin-turn", actor: enemy.actor, tokenId: enemy.id, token: enemy.document, initiative: 10 };
  const combat = { id: "combat", started: true, round: 1, turn: 0, combatant, combatants: [combatant, enemyCombatant], turns: [combatant, enemyCombatant], flags: {} };
  globalThis.game = { user: { id: "player", isGM: false, targets: new Set([enemy]) }, combat, messages: [] };
  globalThis.canvas = { scene: { id: "scene", grid: { distance: 5, size: 100 } },
    grid: { size: 100, measurePath: ([from, to]) => ({ distance: Math.hypot(to.x - from.x, to.y - from.y) / 20 }) },
    tokens: { controlled: [selected], placeables: [selected, enemy] },
  };
  combat.flags["pf2e-combater"] = { actionTurn: createTurnSnapshot(combat, { key: "fighter-turn-1" }) };
  const context = readCombatContext("test", { combatant });
  const live = buildCandidates(context).candidates.find((entry) => entry.slug === "sudden-charge");
  assert.ok(live?.activityProfile?.backingStrike, "Sudden Charge is offered with the Shield Boss behind it");
  const atoms = builderAtomicActionsForStep(live);
  assert.deepEqual(atoms.map((atom) => atom.slug), ["stride", "stride", "strike"]);
  // The Strides end next to the hobgoblin (destinations are token centers).
  const destinations = [{ x: 450, y: 50 }, { x: 750, y: 50 }];
  writeDraftPlan(context, { steps: atoms.map((entry, index) => ({
    instanceId: `charge-${index}`, actionKey: entry.id, name: entry.name, actionCost: entry.actionCost,
    groupId: entry.groupId, groupLabel: entry.groupLabel, atomIndex: entry.atomIndex,
    requiresDestination: index < 2, ...(index < 2 ? { destination: destinations[index] } : {}),
    ...(index === 2 ? { targetTokenIds: [enemy.id], targetLabel: enemy.name, targetSelection: "manual" } : {}),
  })) });
  const panel = {
    _browser: null, _selectedCombatant: combatant, refreshSource: "test", activeTab: "one", searchQuery: "",
    _activeAutoFillPlans() { return this._autoFillPlans ?? []; }, _activePinnedPlanId: () => null,
    _actorForMovement: (ctx) => ctx.actor.document,
  };
  const view = preparePanelContext(panel);
  const strike = view.builder.draft.steps[2];
  assert.equal(strike.stale, false, "the Sudden Charge Strike re-matches its activity after the planned Strides");
  assert.equal(strike.warning, "", "no \"Action is no longer available\" on the Strike");
  assert.equal(strike.action?.name, "Sudden Charge -> +1 Striking Shield Boss");

  // The hobgoblin moves behind the fighter after the plan was made (what happened live): Sudden
  // Charge still reaches it from where the fighter stands (35 ft), but not from where the planned
  // Strides end (70 ft), so re-matching from the Strike's own square would drop the activity. The
  // Strike says why instead of claiming the action vanished.
  enemy.center.x = -650;
  enemy.document.x = -700;
  panel._autoFillPreparationCache = null;
  const moved = preparePanelContext(panel).builder.draft.steps[2];
  assert.equal(moved.stale, false, "the activity still exists");
  assert.equal(moved.warning, "No target in range.", "a target out of reach from the planned square says so");
  console.log("Grouped Sudden Charge tests passed");
} finally {
  Object.assign(globalThis, saved);
}
