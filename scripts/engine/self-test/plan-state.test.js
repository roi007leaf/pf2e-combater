import assert from "node:assert/strict";
import { buildTurnPlans } from "../planner.js";
import {
  createPlanState,
  evaluatePlan,
  planStateSignature,
  projectContextFromPlanState,
} from "../plan-state.js";

const target = {
  id: "ogre",
  name: "Ogre",
  distance: 5,
  conditions: { slugs: [], values: {} },
  token: { center: { x: 5, y: 0 } },
};
const context = {
  actor: {
    id: "hero",
    name: "Hero",
    profile: { conditions: { slugs: [], values: {} }, combatState: {} },
  },
  profile: { conditions: { slugs: [], values: {} }, combatState: {} },
  token: { id: "hero-token", center: { x: 0, y: 0 }, width: 1, height: 1 },
  targets: [target],
  enemies: [target],
  allies: [],
  battlefield: { targets: [target], enemies: [target], allies: [] },
};

const trip = {
  id: "trip",
  slug: "trip",
  name: "Trip",
  source: "generic",
  role: "setup",
  actionCost: 1,
  score: 60,
  confidence: "high",
  suggestedTarget: { type: "enemy", id: target.id, name: target.name },
  activityProfile: { appliesConditions: ["prone"], duration: "until target stands" },
};

const tripState = createPlanState(context, { steps: [{ action: trip }] });
const afterTrip = projectContextFromPlanState(context, tripState);
assert.equal(
  afterTrip.profile.conditions.slugs.includes("prone"),
  false,
  "enemy conditions must not leak onto the acting actor",
);
assert.equal(
  afterTrip.targets[0].conditions.slugs.includes("prone"),
  true,
  "Trip should project prone onto its selected target",
);
assert.equal(
  afterTrip.battlefield.enemies[0].conditions.slugs.includes("prone"),
  true,
  "projected target state should stay consistent across battlefield pools",
);
assert.equal(tripState.durations.get("ogre:prone"), "until target stands");

const twinTargets = [
  { ...target, id: "twin-one", name: "Guard", conditions: { slugs: [], values: {} } },
  { ...target, id: "twin-two", name: "Guard", conditions: { slugs: [], values: {} } },
];
const twinContext = {
  ...context,
  targets: twinTargets,
  enemies: twinTargets,
  battlefield: { targets: twinTargets, enemies: twinTargets, allies: [] },
};
const secondTwinTrip = {
  ...trip,
  suggestedTarget: { type: "enemy", id: "twin-two", name: "Guard" },
};
const afterSecondTwinTrip = projectContextFromPlanState(
  twinContext,
  createPlanState(twinContext, { steps: [secondTwinTrip] }),
);
assert.equal(afterSecondTwinTrip.targets[0].conditions.slugs.includes("prone"), false);
assert.equal(afterSecondTwinTrip.targets[1].conditions.slugs.includes("prone"), true);

const dropProneState = createPlanState(context, {
  steps: [{ actionKey: "drop-prone", action: { slug: "drop-prone", executable: "drop-prone" } }],
});
const afterDropProne = projectContextFromPlanState(context, dropProneState);
assert.equal(afterDropProne.profile.conditions.slugs.includes("prone"), true);
assert.equal(afterDropProne.targets[0].conditions.slugs.includes("prone"), false);
assert.notEqual(
  planStateSignature(tripState),
  planStateSignature(dropProneState),
  "dominance state must distinguish actor and target conditions",
);

const shieldState = createPlanState(context, {
  steps: [{ action: { slug: "raise-a-shield", source: "generic", activityProfile: { duration: "until next turn" } } }],
});
assert.equal(shieldState.raisedShieldActive, true);
assert.equal(projectContextFromPlanState(context, shieldState).profile.combatState.raisedShieldActive, true);
assert.equal(shieldState.durations.get("self:action:raise-a-shield"), "until next turn");

const proneContext = {
  ...context,
  profile: { ...context.profile, conditions: { slugs: ["prone"], values: { prone: 1 } } },
  actor: {
    ...context.actor,
    profile: { ...context.actor.profile, conditions: { slugs: ["prone"], values: { prone: 1 } } },
  },
};
const standAndTripState = createPlanState(proneContext, {
  steps: [{
    action: {
      ...trip,
      id: "stand-and-trip",
      slug: "stand-and-trip",
      activityProfile: { includes: ["stand", "trip"], removesCondition: "prone", appliesCondition: "prone" },
    },
  }],
});
const afterStandAndTrip = projectContextFromPlanState(proneContext, standAndTripState);
assert.equal(afterStandAndTrip.profile.conditions.slugs.includes("prone"), false);
assert.equal(afterStandAndTrip.targets[0].conditions.slugs.includes("prone"), true);

const focusAction = (id) => ({
  id,
  slug: id,
  source: "spell-curated",
  isFocusSpell: true,
  spellResource: { type: "focus", remaining: 1, max: 3 },
});
const overspentFocus = createPlanState(context, {
  steps: [focusAction("focus-one"), focusAction("focus-two")],
});
assert.equal(overspentFocus.resourceLegal, false);
assert.deepEqual(overspentFocus.resourceConflicts, ["focus"]);

const manualStrike = {
  id: "manual-strike",
  slug: "manual-strike",
  source: "strike",
  actionCost: 1,
};
const plannedStrike = {
  id: "planned-strike",
  slug: "planned-strike",
  name: "Longsword",
  source: "strike",
  role: "damage",
  actionCost: 1,
  score: 100,
  confidence: "high",
  traits: [],
  suggestedTarget: { type: "enemy", id: target.id, name: target.name },
};
const fillers = [
  { id: "guard", slug: "guard", name: "Guard", source: "system-inferred", role: "defense", actionCost: 1, score: 40, confidence: "high" },
  { id: "seek", slug: "seek", name: "Seek", source: "system-inferred", role: "utility", actionCost: 1, score: 30, confidence: "high" },
];
const prefixedPlans = buildTurnPlans(context, [plannedStrike, ...fillers], {
  reservedSteps: [{ action: manualStrike }],
});
const generatedStrikeSteps = prefixedPlans.flatMap((plan) => plan.steps)
  .filter((step) => step.id === plannedStrike.id);
assert.ok(generatedStrikeSteps.length > 0);
assert.equal(
  generatedStrikeSteps.every((step) => step.attackIndex === 2 && step.mapPenalty === 5),
  true,
  "gap-fill Strikes must continue MAP from manual prefix Strikes",
);
assert.equal(
  prefixedPlans.every((plan) => plan.steps.filter((step) => step.source === "strike").length <= 1),
  true,
  "manual prefix Strikes must count toward planner Strike cap",
);

const afterStrikeFollowUp = {
  id: "after-strike-follow-up",
  slug: "after-strike-follow-up",
  name: "After-Strike Follow-Up",
  source: "system-inferred",
  role: "buff",
  actionCost: 1,
  score: 90,
  confidence: "high",
  activityProfile: { previousActionRequirements: ["strike"] },
};
assert.equal(
  buildTurnPlans(context, [afterStrikeFollowUp], { reservedSteps: [{ action: manualStrike }] })
    .some((plan) => plan.steps.some((step) => step.id === afterStrikeFollowUp.id)),
  true,
  "manual prefix should satisfy an immediate previous-action requirement",
);

const pronePayoff = {
  id: "prone-payoff",
  slug: "prone-payoff",
  name: "Prone Payoff",
  source: "system-inferred",
  role: "damage",
  actionCost: 1,
  score: 90,
  confidence: "high",
  suggestedTarget: { type: "enemy", id: target.id, name: target.name },
  activityProfile: { requiresTargetCondition: "prone" },
};
assert.equal(
  buildTurnPlans(context, [pronePayoff], { reservedSteps: [{ action: trip }] })
    .some((plan) => plan.steps.some((step) => step.id === pronePayoff.id)),
  true,
  "manual target setup should satisfy gap-fill target-condition requirements",
);

const evaluation = evaluatePlan(context, [trip]);
assert.equal(evaluation.legal, true);
assert.equal(evaluation.score, trip.score);
assert.equal(evaluation.projectedState.targetConditions.ogre.includes("prone"), true);
assert.ok(evaluation.reasons.includes("conditions"));

console.log("PF2e Combater plan state test passed");
