import assert from "node:assert/strict";
import { classifySpell } from "../spell/classifier.js";
import { readSpellActions } from "../../readers/spell-reader.js";
import { scoredAreaPlacement } from "../scoring/area.js";
import { tokensInAreaMarker } from "../area/region.js";
import { refreshDraftAreaPlacements } from "../action/builder/projection.js";

const previousCanvas = globalThis.canvas;
globalThis.canvas = { grid: { size: 100, distance: 5 }, scene: { grid: { size: 100, distance: 5 } } };
try {
  const spell = {
    id: "wrath", name: "Divine Wrath", type: "spell", slug: "divine-wrath",
    system: {
      slug: "divine-wrath", location: { value: "divine" }, level: { value: 4 }, time: { value: "2" },
      traits: { value: ["concentrate", "manipulate", "sanctified", "spirit"] },
      range: { value: "120 feet" }, area: { type: "burst", value: 20 },
      defense: { save: { statistic: "fortitude" } }, damage: { 0: { formula: "4d10", type: "spirit" } },
      description: { value: "<p>You channel the fury of divinity against your foes. You deal @Damage[4d10[spirit]] to enemies in the area, depending on their Fortitude save.</p>" },
    },
  };
  assert.equal(classifySpell(spell).targetingProfile.enemiesOnly, true, "Divine Wrath must explicitly exclude allies");
  const entry = { id: "divine", system: { prepared: { value: "spontaneous" } } };
  const actor = { id: "caster", type: "character", system: {}, itemTypes: { spell: [spell], spellcastingEntry: [entry] }, spellcasting: [entry] };
  const cluster = [1, 2, 3].map((id) => ({ id: `enemy-${id}`, center: { x: 350, y: 50 }, distance: 15 }));
  const isolated = { id: "isolated", center: { x: 50, y: 1250 }, distance: 60 };
  const ally = { id: "ally", center: { x: 350, y: 50 } };
  const context = {
    actor: { document: actor }, profile: {}, token: { id: "caster", center: { x: 50, y: 50 } },
    enemies: [...cluster, isolated], targets: cluster, allies: [ally],
    battlefield: { enemies: [...cluster, isolated], targets: cluster, allies: [ally] },
  };
  const action = readSpellActions(context).find((candidate) => candidate.slug === "divine-wrath");
  assert.equal(action.targetingProfile.enemiesOnly, true, "spell reader retains selective area targeting");
  const options = { enemyValues: context.enemies, allyValues: context.allies, maxCastRange: 120 };
  const placement = scoredAreaPlacement(action, context, options);
  assert.equal(placement.enemies.length, 3, "safe spell should favor clustered enemies despite ally overlap");
  assert.equal(placement.allies.length, 0);
  assert.ok(placement.areaPlacementOptions.every((option) => option.allyCount === 0));
  const fireball = { ...action, targetingProfile: { ...action.targetingProfile, enemiesOnly: false } };
  assert.equal(scoredAreaPlacement(fireball, context, options).enemies.length, 1, "ordinary damaging areas still avoid allies");
  for (const type of ["cone", "line"]) {
    const selective = { ...action, targetingProfile: { ...action.targetingProfile, type, distance: 60 } };
    assert.equal(scoredAreaPlacement(selective, context, options).enemies.length, 3, `${type}: enemy-only area should ignore ally overlap`);
    const ordinary = { ...selective, targetingProfile: { ...selective.targetingProfile, enemiesOnly: false } };
    assert.equal(scoredAreaPlacement(ordinary, context, options).enemies.length, 1, `${type}: harmful area still favors ally-free target`);
  }
  const refreshed = refreshDraftAreaPlacements(context, { steps: [{ instanceId: "wrath-step", action }] }).steps[0];
  assert.equal(refreshed.action.activityProfile.areaPlacementOptions[0].enemyCount, 3, "draft refresh respects exemption");
  const neutral = { id: "neutral", center: ally.center };
  globalThis.canvas.tokens = { placeables: [...cluster, ally, neutral, context.token] };
  const marker = { shape: "burst", center: cluster[0].center, distance: 20 };
  assert.deepEqual(tokensInAreaMarker({ context, action, marker }).map((token) => token.id), cluster.map((enemy) => enemy.id),
    "enemy-only template targets exclude allies, caster, and neutral tokens");
  assert.ok(tokensInAreaMarker({ context, action: fireball, marker }).some((token) => token.id === ally.id));
  const legacy = { ...spell, system: { ...spell.system, description: { value: "You deal 4d10 good damage; each creature in the area attempts a save. Creatures sharing your alignment are unaffected." } } };
  assert.notEqual(classifySpell(legacy).targetingProfile.enemiesOnly, true, "legacy alignment exemption is not blanket ally immunity");
  const generic = { ...spell, system: { ...spell.system, description: { value: "You deal 4d10 spirit damage to each creature in the area." } } };
  assert.notEqual(classifySpell(generic).targetingProfile.enemiesOnly, true, "enemy targeting alone does not imply allies are safe");
  const explicitTargets = { ...generic, system: { ...generic.system, target: { value: "enemies in the area" } } };
  assert.equal(classifySpell(explicitTargets).targetingProfile.enemiesOnly, true, "other spells with explicit enemy-only recipients share exemption");
  const plainText = { ...spell, system: { ...spell.system, description: { value: "You deal 4d10 spirit damage to enemies in the area, depending on their Fortitude save." } } };
  assert.equal(classifySpell(plainText).targetingProfile.enemiesOnly, true, "plain rules text and Foundry damage macros both work");
} finally {
  globalThis.canvas = previousCanvas;
}
console.log("Enemies-only area tests passed.");
