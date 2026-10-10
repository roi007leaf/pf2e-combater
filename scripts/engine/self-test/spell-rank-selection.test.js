import assert from "node:assert/strict";
import { buildCandidates } from "../candidates.js";
import { buildActionBuilderModel } from "../action/builder/index.js";
import { readSpellActions } from "../../readers/spell-reader.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";
import { executeOpenItem } from "../execution/native-item.js";

const spell = {
  id: "fireball", type: "spell", slug: "fireball", name: "Fireball",
  system: {
    slug: "fireball", time: { value: "2" }, level: { value: 3 },
    location: { value: "arcane" }, traits: { value: ["fire"] },
    range: { value: "500 feet" }, area: { type: "burst", value: 20 },
    damage: { 0: { formula: "6d6", type: "fire" } },
    heightening: { type: "interval", interval: 1, damage: { 0: "2d6" } },
  },
};
const castCalls = [];
const entry = {
  id: "arcane", name: "Arcane Spells",
  system: {
    prepared: { value: "prepared" }, tradition: { value: "arcane" },
    slots: Object.fromEntries([3, 4, 5].map((rank) => [`slot${rank}`, { prepared: [{ id: spell.id, expended: false }] }])),
  },
  cast: async (item, options) => { castCalls.push({ item, options }); return { id: "cast" }; },
};
const actor = { id: "caster", type: "character", system: {}, itemTypes: { spell: [spell], spellcastingEntry: [entry] }, spellcasting: [entry] };
const enemy = { id: "enemy", name: "Enemy", distance: 30, hpPercent: 1 };
const context = { actor: { id: actor.id, document: actor }, profile: { actorType: "character", conditions: { slugs: [], values: {} } }, targets: [enemy], battlefield: { enemies: [enemy], allies: [] } };
const fireballs = (actions) => actions.filter((action) => action.slug === "fireball");
assert.deepEqual(fireballs(readSpellActions(context)).map((action) => action.castRank), [3, 4, 5]);
const built = buildCandidates(context);
assert.deepEqual(fireballs(built.detected).map((action) => action.castRank), [3, 4, 5], "Candidate deduplication must retain every prepared spell rank");
assert.deepEqual(fireballs(built.candidates).map((action) => action.castRank), [3, 4, 5], "All usable ranks must be selectable");
const builder = buildActionBuilderModel({ context, candidates: built.candidates, rejected: built.rejected, draft: { steps: [] } });
const rows = fireballs(builder.tabs.two.all);
assert.equal(new Set(rows.map((action) => action.key)).size, 3);
const view = decorateBuilder(builder, "two");
const visibleRows = view.tabsList.find((tab) => tab.id === "two").sections.flatMap((section) => section.actions).filter((action) => action.slug === "fireball");
for (const rank of [3, 4, 5]) {
  const row = visibleRows.find((action) => action.castRank === rank);
  assert.ok(row, `Rank ${rank} must appear in Browse`);
  assert.ok(row.detailChips.some((chip) => chip.label === `Rank ${rank}`), "Visible rank chip identifies which rank Add will use");
  const drafted = buildActionBuilderModel({ context, candidates: built.candidates, draft: { steps: [{ instanceId: `rank-${rank}`, actionKey: row.key, actionCost: 2 }] } });
  assert.equal(drafted.draft.steps[0].action.castRank, rank, "Draft must preserve selected rank");
  await executeOpenItem({ actor, action: drafted.draft.steps[0].action });
  assert.equal(castCalls.at(-1).options.rank, rank, "Native execution must cast selected rank");
}

const signature = { ...spell, system: { ...spell.system, location: { value: "arcane", signature: true } } };
const spontaneousEntry = {
  ...entry,
  system: { ...entry.system, prepared: { value: "spontaneous" }, slots: Object.fromEntries([3, 4, 5].map((rank) => [`slot${rank}`, { value: 1, max: 1 }])) },
};
const spontaneousContext = { ...context, actor: { document: { ...actor, itemTypes: { spell: [signature], spellcastingEntry: [spontaneousEntry] }, spellcasting: [spontaneousEntry] } } };
assert.deepEqual(fireballs(buildCandidates(spontaneousContext).candidates).map((action) => action.castRank), [3, 4, 5], "Signature spells must retain every castable rank");

const secondSpell = { ...spell, id: "second-fireball", system: { ...spell.system, location: { value: "second-entry" } } };
const secondEntry = { ...entry, id: "second-entry", system: { ...entry.system, slots: { slot3: { prepared: [{ id: secondSpell.id, expended: false }] } } } };
const twoEntryContext = { ...context, actor: { document: { ...actor, itemTypes: { spell: [spell, secondSpell], spellcastingEntry: [entry, secondEntry] }, spellcasting: [entry, secondEntry] } } };
assert.equal(fireballs(buildCandidates(twoEntryContext).candidates).length, 4, "Same spell in separate spellcasting entries must retain separate resources");

entry.system.slots.slot4.prepared[0].expended = true;
const depleted = buildCandidates(context);
assert.deepEqual(fireballs(depleted.candidates).map((action) => action.castRank), [3, 5], "Expending one rank must not remove other ranks");
const depletedBuilder = buildActionBuilderModel({ context, candidates: depleted.candidates, rejected: depleted.rejected, draft: { steps: [{ instanceId: "rank-5", actionKey: rows.find((row) => row.castRank === 5).key, actionCost: 2 }] } });
assert.equal(depletedBuilder.draft.steps[0].action.castRank, 5, "Refreshing after another rank is spent preserves the chosen rank");
assert.equal(depleted.rejected.find((entry) => entry.action.slug === "fireball" && entry.action.castRank === 4)?.action.available, false, "Spent rank must not remain a usable candidate");

console.log("Spell rank selection regressions passed");
