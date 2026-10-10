import assert from "node:assert/strict";
import { summonIdentity } from "../../rules/summoned-creatures.js";
import { readCombatContext } from "../../state/combat-context.js";

const saved = { game: globalThis.game, canvas: globalThis.canvas };
try {
  let active = false;
  let flagReads = 0;
  const actor = {
    id: "summon", uuid: "Actor.summon", name: "Wolf", type: "npc", isOwner: true,
    flags: { "pf2e-summons-assistant": { summoner: { id: "caster", uuid: "Actor.caster" } } },
    system: { traits: { value: ["summoned", "minion"] }, attributes: { hp: { value: 10, max: 10 } } },
    items: [], itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [] },
    getFlag(scope, key) {
      flagReads++;
      if (!active) throw new Error(`Flag scope "${scope}" is not valid or not currently active`);
      return this.flags[scope]?.[key];
    },
  };
  globalThis.game = { user: { isGM: true, targets: new Set() }, modules: { get: () => ({ active }) } };
  const token = { id: "wolf", actor, document: { id: "wolf", actor, disposition: 1, x: 0, y: 0, width: 1, height: 1 } };
  globalThis.canvas = { tokens: { controlled: [token], placeables: [token] }, grid: { size: 1 } };
  const identity = { summoned: true, summonerId: "caster", summonerUuid: "Actor.caster" };
  assert.deepEqual(summonIdentity(actor), identity, "inactive optional module must not throw or lose persisted summon identity");
  assert.equal(flagReads, 0, "inactive module scope must not reach Foundry getFlag");
  assert.deepEqual(readCombatContext("inactive-summons-assistant").token.summonerId, "caster", "panel context must remain readable");
  active = true;
  assert.deepEqual(summonIdentity(actor), identity, "active module preserves summon ownership");
  delete actor.flags["pf2e-summons-assistant"];
  assert.deepEqual(summonIdentity(actor), { summoned: true, summonerId: null, summonerUuid: null });
  active = false;
  assert.doesNotThrow(() => readCombatContext("missing-summon-flags"));
  assert.deepEqual(summonIdentity(null), { summoned: false, summonerId: null, summonerUuid: null });
} finally {
  Object.assign(globalThis, saved);
}
console.log("Summon identity regressions passed");
