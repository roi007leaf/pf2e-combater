import assert from "node:assert/strict";
import { actionConfidenceAllowsAutoFill, normalizedActionFacts } from "../action/facts.js";
import {
  requiresAreaMarkerForAction,
  requiresDestinationForAction,
  requiresTargetForAction,
} from "../action/requirements.js";
import {
  candidateAppliedConditions,
  isAttackAction,
  isSpellAction,
  previousActionRequirements,
  targetConditionRequirementOptions,
} from "../planner/rules.js";

const trip = {
  name: "Trip",
  slug: "trip",
  source: "generic",
  role: "control",
  confidence: "high",
  actionCost: 1,
  skill: "athletics",
  targetSave: "reflex",
  attackTrait: true,
  criticalFailureRisk: "major",
  traits: ["attack"],
  targetingProfile: { enemy: true, reach: true },
  activityProfile: { appliesCondition: "prone" },
};
const tripFacts = normalizedActionFacts(trip);
assert.equal(tripFacts.version, 2);
assert.equal(tripFacts.category, "skill");
assert.equal(tripFacts.resolution.type, "check", "Athletics maneuvers stay checks despite the attack trait");
assert.equal(tripFacts.resolution.attack, true);
assert.equal(tripFacts.resolution.makesAttackRoll, true);
assert.equal(tripFacts.resolution.skill, "athletics");
assert.equal(tripFacts.resolution.targetDefense, "reflex");
assert.equal(tripFacts.resolution.criticalFailureRisk, "major");
assert.equal(tripFacts.targeting.requiresTarget, true);
assert.equal(tripFacts.targeting.requiresTargetableEnemy, true);
assert.deepEqual(tripFacts.effects.appliedConditions, ["prone"]);
assert.equal(tripFacts.economy.actionCost, 1);
assert.equal(tripFacts.economy.mapIncreases, true);
assert.equal(isAttackAction(trip), true);
assert.deepEqual([...candidateAppliedConditions(trip)], ["prone"]);

const fireball = {
  name: "Fireball",
  slug: "fireball",
  source: "spell-curated",
  role: "area-damage",
  confidence: "high",
  actionCost: 2,
  castRank: 3,
  saveProfile: { stat: "reflex", basic: true },
  damageProfile: { average: 21, types: ["fire"] },
  targetingProfile: { enemy: true, area: true, type: "burst", maxRange: 500 },
  activityProfile: { spell: true, includes: ["damage", "area"] },
};
const fireballFacts = normalizedActionFacts(fireball);
assert.equal(fireballFacts.category, "spell");
assert.equal(fireballFacts.resolution.type, "save");
assert.equal(fireballFacts.resolution.saveStat, "reflex");
assert.equal(fireballFacts.resolution.basicSave, true);
assert.equal(fireballFacts.resolution.nonCantripSpell, true);
assert.equal(fireballFacts.targeting.area, true);
assert.equal(fireballFacts.targeting.areaType, "burst");
assert.equal(fireballFacts.targeting.maxRange, 500);
assert.equal(fireballFacts.targeting.requiresTarget, false);
assert.equal(fireballFacts.effects.damageAverage, 21);
assert.deepEqual(fireballFacts.effects.damageTypes, ["fire"]);
assert.equal(fireballFacts.economy.resource.kind, "slot");
assert.equal(fireballFacts.economy.resource.rank, 3);
assert.equal(isSpellAction(fireball), true);
assert.equal(requiresAreaMarkerForAction(fireball), true);

const stride = normalizedActionFacts({
  name: "Stride",
  slug: "stride",
  source: "movement",
  role: "mobility",
  actionCost: 1,
});
assert.equal(stride.category, "movement");
assert.equal(stride.targeting.requiresDestination, true);
assert.equal(stride.targeting.requiresTarget, false);

const moveAndStrike = {
  name: "Sudden Charge",
  slug: "sudden-charge",
  source: "custom-curated",
  role: "mobility-attack",
  targetingProfile: { enemy: true },
  activityProfile: { includesStrike: true, strideCount: 2, includes: ["stride", "strike"] },
};
const moveAndStrikeFacts = normalizedActionFacts(moveAndStrike);
assert.equal(moveAndStrikeFacts.resolution.strikeLike, true);
assert.equal(moveAndStrikeFacts.targeting.requiresDestination, false);
assert.equal(moveAndStrikeFacts.targeting.requiresTarget, false);
assert.equal(requiresDestinationForAction(moveAndStrike), false);
assert.equal(requiresTargetForAction(moveAndStrike), false);

const grabRider = {
  slug: "grab",
  source: "system-inferred",
  role: "grab",
  activityProfile: {
    npcFamily: "grab-rider",
    includesGrab: true,
    previousActionRequirements: ["after-strike"],
    requiresTargetCondition: "grabbed",
    appliesConditions: ["grabbed", "restrained"],
  },
};
const grabFacts = normalizedActionFacts(grabRider);
assert.equal(grabFacts.sequencing.grabRider, true);
assert.equal(grabFacts.sequencing.requiresPreviousAction, true);
assert.deepEqual(grabFacts.sequencing.previousActionRequirements, ["after-strike"]);
assert.deepEqual(grabFacts.effects.requiredTargetConditions, [["grabbed"]]);
assert.deepEqual(previousActionRequirements(grabRider), ["after-strike"]);
assert.deepEqual(targetConditionRequirementOptions(grabRider), [["grabbed"]]);

const nestedRecallKnowledge = {
  action: {
    name: "Recall Knowledge",
    slug: "recall-knowledge",
    source: "generic",
    role: "utility",
    skill: "arcana",
  },
};
assert.equal(normalizedActionFacts(nestedRecallKnowledge).targeting.requiresTarget, true);

const lowConfidence = { slug: "uncertain-effect", confidence: "low" };
assert.equal(actionConfidenceAllowsAutoFill(lowConfidence), false);
assert.equal(actionConfidenceAllowsAutoFill({
  ...lowConfidence,
  activityProfile: { allowLowConfidenceAutoFill: true },
}), true);

assert.equal(normalizedActionFacts(tripFacts), tripFacts, "normalizing facts should be idempotent");
for (const value of [
  tripFacts,
  tripFacts.identity,
  tripFacts.resolution,
  tripFacts.targeting,
  tripFacts.effects,
  tripFacts.sequencing,
  fireballFacts.economy.resource,
  tripFacts.traits,
  tripFacts.effects.appliedConditions,
]) {
  assert.equal(Object.isFrozen(value), true, "ActionFacts output should be immutable");
}

console.log("PF2e Combater ActionFacts v2 test passed");
