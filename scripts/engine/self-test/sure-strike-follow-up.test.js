import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";

const sure = {
  id: "sure-strike", slug: "sure-strike", name: "Sure Strike", role: "buff",
  actionCost: 1, source: "spell-curated", score: 153, confidence: "high",
  activityProfile: { attackBuff: true, preMovementSetup: true },
  setupFor: ["strike", "attack", "damage"],
};
const fireball = {
  id: "fireball", slug: "fireball", name: "Fireball", role: "area-damage",
  actionCost: 2, source: "spell-curated", score: 156, confidence: "high",
  saveProfile: { stat: "reflex" }, activityProfile: { spell: true },
};
const drain = {
  id: "drain-bonded-item", slug: "drain-bonded-item", name: "Drain Bonded Item",
  role: "resource-recovery", actionCost: 0, source: "system-inferred", score: 100, confidence: "high",
};
for (const includeCoverage of [false, true]) {
  const invalid = buildTurnPlans(fighterContext, [sure, fireball, drain], { includeCoverage });
  assert.ok(invalid.every((plan) => plan.steps.every((step) => step.id !== sure.id)),
    "Fireball + Sure Strike + Drain must not enter Auto-fill without an attack roll");
  const ray = { ...fireball, id: "ray", slug: "ray", name: "Attack spell", role: "damage",
    saveProfile: null, activityProfile: { spell: true, spellAttack: true } };
  const valid = buildTurnPlans(fighterContext, [ray, sure, drain], { includeCoverage });
  const pairs = valid.filter((plan) => plan.steps.some((step) => step.id === sure.id));
  assert.ok(pairs.length, "Sure Strike must remain available with a spell attack roll");
  assert.ok(pairs.every((plan) => plan.steps.findIndex((step) => step.id === sure.id)
    < plan.steps.findIndex((step) => step.id === ray.id)), "Sure Strike precedes spell attack");
  const trip = { ...ray, id: "trip", slug: "trip", source: "generic", skill: "athletics", traits: ["attack"] };
  assert.ok(buildTurnPlans(fighterContext, [sure, trip], { includeCoverage })
    .every((plan) => plan.steps.every((step) => step.id !== sure.id)), "attack-trait skill check is not an attack roll");
}
console.log("Sure Strike follow-up tests passed.");
