import assert from "node:assert/strict";
import {
  createFixturePf2eAdapter,
  createFoundryPf2eAdapter,
  createPf2eRuntime,
} from "../../runtime/pf2e-runtime.js";

const calls = [];
const actions = new Map([
  [
    "create-a-diversion",
    {
      variants: [{ slug: "distracting-words" }, { slug: "gesture" }],
      use: async (options) => {
        calls.push({ kind: "action", options });
        return { action: true };
      },
    },
  ],
]);
actions.raiseAShield = async (options) => {
  calls.push({ kind: "legacy", options });
  return { legacy: true };
};

const pf2e = {
  actions,
  rollItemMacro: async (uuid, event) => {
    calls.push({ kind: "item", uuid, event });
    return { item: true };
  },
};
const runtime = createPf2eRuntime(createFixturePf2eAdapter({ pf2e }));

const tokenMarks = new Map([["Scene.test.Token.target", new Set(["hunted-prey"])]]);
const fallbackEntry = { id: "fallback-entry" };
const actorFacts = runtime.readActor({
  system: { actions: [{ slug: "strike" }, null] },
  itemTypes: { spellcastingEntry: [fallbackEntry] },
  synthetics: { tokenMarks },
});
assert.deepEqual(actorFacts.actions.map((action) => action.slug), ["strike"]);
assert.deepEqual(actorFacts.spellcasting, [fallbackEntry]);
assert.equal(actorFacts.tokenMarks, tokenMarks);

const requestedVariant = await runtime.useAction("create-a-diversion", { actor: "Valeros" }, { variant: "gesture" });
assert.deepEqual(requestedVariant, { action: true });
assert.equal(calls.at(-1).options.variant, "gesture");

await runtime.useAction("create-a-diversion", {}, { variant: "missing" });
assert.equal(calls.at(-1).options.variant, "distracting-words", "unknown variants should fall back to PF2e's first variant");

const legacyResult = await runtime.useAction("raise-a-shield", { actor: "Valeros" });
assert.deepEqual(legacyResult, { legacy: true });
assert.deepEqual(calls.at(-1), { kind: "legacy", options: { actor: "Valeros" } });
assert.equal(await runtime.useAction("missing-action"), null);

const entry = {
  cast: async (item, options) => {
    calls.push({ kind: "cast", item, options });
    return { cast: true };
  },
  setSlotExpendedState: async (rank, slotId, expended) => {
    calls.push({ kind: "slot", rank, slotId, expended });
  },
};
const spell = { uuid: "Actor.valeros.Item.magic-missile" };
assert.deepEqual(await runtime.castSpell(entry, spell, { rank: 1 }), { cast: true });
assert.deepEqual(calls.at(-1), { kind: "cast", item: spell, options: { rank: 1 } });
assert.equal(await runtime.setSlotExpended(entry, 1, 0, false), true);
assert.deepEqual(calls.at(-1), { kind: "slot", rank: 1, slotId: 0, expended: false });
assert.equal(await runtime.setSlotExpended({}, 1, 0, false), false);

const click = { type: "click" };
assert.deepEqual(await runtime.rollItem(spell, click), { item: true });
assert.deepEqual(calls.at(-1), { kind: "item", uuid: spell.uuid, event: click });
assert.equal(await runtime.rollItem({}, click), null);

let activeGame = { pf2e };
const productionRuntime = createPf2eRuntime(createFoundryPf2eAdapter({ getGame: () => activeGame }));
assert.deepEqual(await productionRuntime.useAction("raise-a-shield", { actor: "Kyra" }), { legacy: true });
activeGame = {};
assert.equal(await productionRuntime.useAction("raise-a-shield"), null, "production Adapter should read current Foundry runtime state");

assert.throws(() => createPf2eRuntime({}), /adapter is invalid/);

console.log("PF2e Combater PF2e runtime contract test passed");
