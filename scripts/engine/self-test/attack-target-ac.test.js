import assert from "node:assert/strict";
import { scoreCandidate } from "../scoring.js";
import { bestTargetForAction, targetRankingReasons } from "../scoring/targets.js";

const tank = {
  id: "tank", name: "Armored Attacker", distance: 5, center: { x: 100, y: 0 },
  hpPercent: 1, ac: 32, attackTargetable: true,
  actor: { document: {
    type: "character", system: { attributes: { ac: { value: 32 } } },
    itemTypes: { weapon: [{ name: "Sword" }], spell: [], action: [], feat: [] },
  } },
};
const soft = { id: "soft", name: "Exposed Enemy", distance: 20, center: { x: 400, y: 0 }, hpPercent: 1, ac: 20, attackTargetable: true };
const context = {
  isGM: true,
  actor: { document: { type: "npc", system: {}, itemTypes: {} } },
  profile: { actorType: "npc", conditions: { slugs: [], values: {} } },
  token: { id: "npc", center: { x: 0, y: 0 } },
  targets: [tank], battlefield: { targets: [tank], enemies: [tank, soft], allies: [] },
};
const shot = { id: "bow", name: "Bow", slug: "strike", source: "strike", role: "damage", actionCost: 1, range: { max: 60 } };
assert.equal(scoreCandidate(context, shot).suggestedTarget?.id, soft.id, "High-AC melee threat must not outweigh a much easier ranged target");
assert.ok(targetRankingReasons(context, shot, "damage", soft).some((reason) => /AC 20/.test(reason)));

const spellAttack = { ...shot, id: "ray", slug: "ray", source: "spell-curated", attackTrait: true };
assert.equal(bestTargetForAction(context, spellAttack, "damage")?.id, soft.id, "Spell attacks must also account for AC");
assert.equal(bestTargetForAction(context, { ...shot, range: { max: 5 } }, "damage")?.id, tank.id, "Unreachable soft target cannot win");
assert.equal(bestTargetForAction(context, { ...shot, preferredTarget: tank }, "damage")?.id, tank.id, "Explicit preferred targets remain respected");

const playerContext = { ...context, isGM: false };
assert.equal(bestTargetForAction(playerContext, shot, "damage")?.id, tank.id, "Unrevealed AC must not change player ranking");
assert.equal(targetRankingReasons(playerContext, shot, "damage", soft).some((reason) => /AC 20/.test(reason)), false);

const equalAcContext = { ...context, battlefield: { ...context.battlefield, enemies: [tank, { ...soft, ac: 32 }] } };
assert.equal(bestTargetForAction(equalAcContext, shot, "damage")?.id, tank.id, "Threat priority still breaks ties between equally hittable targets");

const actorAcContext = { ...context, battlefield: { ...context.battlefield, enemies: [{ ...tank, ac: undefined }, soft] } };
assert.equal(bestTargetForAction(actorAcContext, shot, "damage")?.id, soft.id, "Use actor AC when summary AC is missing");
const unknownAcContext = { ...context, battlefield: { ...context.battlefield, enemies: [tank, { ...soft, ac: undefined }] } };
assert.equal(targetRankingReasons(unknownAcContext, shot, "damage", unknownAcContext.battlefield.enemies[1]).some((reason) => /Known AC/.test(reason)), false);

const saveContext = {
  ...context,
  actor: {}, profile: { ...context.profile, actorType: "character" }, token: null,
  battlefield: { ...context.battlefield, enemies: [
    { ...tank, actor: undefined, saves: { fortitude: 5, reflex: 5 } },
    { ...soft, saves: { fortitude: 20, reflex: 20 } },
  ] },
};
const saveSpell = { ...spellAttack, attackTrait: false, role: "control", saveProfile: { stat: "fortitude" } };
assert.equal(bestTargetForAction(saveContext, saveSpell, "control")?.id, tank.id, "Save spells rank against save defenses, not AC");
const trip = { ...shot, source: "generic", slug: "trip", skill: "athletics", targetSave: "reflex", attackTrait: true, role: "control" };
assert.equal(bestTargetForAction(saveContext, trip, "control")?.id, tank.id, "Attack-trait skills rank against their skill DC, not AC");

console.log("attack-target-ac.test.js passed");
