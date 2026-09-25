import assert from "node:assert/strict";
import { executeOpenItem } from "../execution/native-item.js";

const castCalls = [];
const entry = {
  id: "divine-entry",
  cast: async (spell, options) => {
    castCalls.push({ spell, options });
    return { id: `cast-${castCalls.length}` };
  },
};
const actor = { id: "caster", spellcasting: [entry] };
const overlays = new Map([
  ["touch", { overlayType: "override", sort: 1, system: { time: { value: "1" }, range: { value: "touch" } } }],
  ["living", { overlayType: "override", sort: 2, system: { time: { value: "2" }, damage: { 0: { kinds: ["damage"] } }, target: { value: "1 living creature" } } }],
  ["undead", { overlayType: "override", sort: 3, system: { time: { value: "2" }, damage: { 0: { kinds: ["healing"] } }, target: { value: "1 willing undead creature" } } }],
  ["emanation", { overlayType: "override", sort: 4, system: { time: { value: "3" }, area: { type: "emanation", value: 30 } } }],
]);
const harm = {
  id: "harm",
  type: "spell",
  hasVariants: true,
  system: { time: { value: "1 to 3" } },
  overlays,
  loadVariant({ castRank, overlayIds }) {
    const overlayId = overlayIds[0];
    return { ...this, original: this, variantId: overlayId, castRank, system: overlays.get(overlayId).system };
  },
};
const cases = [
  { actions: 1, role: "save-damage", target: { enemy: true }, expected: "touch" },
  { actions: 2, role: "save-damage", target: { enemy: true }, expected: "living" },
  { actions: 2, role: "healing", target: { ally: true, requiresAnyTrait: ["undead"] }, expected: "undead" },
  { actions: 3, role: "save-damage", target: { enemy: true }, expected: "emanation" },
];
for (const testCase of cases) {
  await executeOpenItem({
    actor,
    action: {
      item: harm,
      spellcastingEntryId: entry.id,
      actionCost: testCase.actions,
      variableActionCost: true,
      castRank: 5,
      role: testCase.role,
      targetingProfile: testCase.target,
      activityProfile: { includes: [testCase.role === "healing" ? "healing" : "damage"] },
    },
  });
  const cast = castCalls.at(-1);
  assert.equal(cast.spell.variantId, testCase.expected, `${testCase.actions}-action Harm should cast the matching native variant`);
  assert.equal(cast.spell.castRank, 5);
  assert.equal(cast.options.rank, 5);
}

const plainSpell = { id: "plain", type: "spell", system: { time: { value: "2" } } };
await executeOpenItem({ actor, action: { item: plainSpell, spellcastingEntryId: entry.id, actionCost: 2, castRank: 2 } });
assert.equal(castCalls.at(-1).spell, plainSpell, "spells without variants still cast normally");

const missingVariant = { ...harm, overlays: new Map([["touch", overlays.get("touch")]]) };
const castCount = castCalls.length;
const unavailable = await executeOpenItem({
  actor,
  action: { item: missingVariant, spellcastingEntryId: entry.id, actionCost: 3, variableActionCost: true, castRank: 5 },
});
assert.equal(unavailable.variantUnavailable, true);
assert.equal(castCalls.length, castCount, "missing planned variant must not cast the base spell");

console.log("PF2e Combater spell variant execution test passed");
