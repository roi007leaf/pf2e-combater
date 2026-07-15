import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";

const lowConfidence = {
  id: "low-confidence-blast",
  name: "Low Confidence Blast",
  slug: "low-confidence-blast",
  source: "system-inferred",
  role: "damage",
  actionCost: 1,
  score: 200,
  confidence: "low",
};
const safeCandidate = {
  id: "safe-strike",
  name: "Safe Strike",
  slug: "safe-strike",
  source: "system-inferred",
  role: "damage",
  actionCost: 1,
  score: 20,
  confidence: "medium",
};
const confidencePlans = buildTurnPlans(fighterContext, [lowConfidence, safeCandidate]);
assert.equal(
  confidencePlans.some((plan) => plan.steps.some((step) => step.id === lowConfidence.id)),
  false,
  "explicitly low-confidence classifications must never enter Auto-fill by default",
);

const trustedLowPlans = buildTurnPlans(fighterContext, [{
  ...lowConfidence,
  allowLowConfidenceAutoFill: true,
}]);
assert.equal(trustedLowPlans[0].steps[0].id, lowConfidence.id, "exact trusted rules may opt a low-confidence action into Auto-fill");

const widePool = Array.from({ length: 16 }, (_value, index) => ({
  id: `wide-${index}`,
  name: `Wide ${index}`,
  slug: `wide-${index}`,
  source: "system-inferred",
  role: "damage",
  actionCost: 1,
  score: 100 - index,
  confidence: "medium",
}));
const widePlans = buildTurnPlans(fighterContext, widePool);
const tailPlan = widePlans.find((plan) => plan.steps.some((step) => step.id === "wide-15"));
assert.ok(tailPlan, "candidate outside primary search pool should remain reachable");
assert.equal(tailPlan.totalCost, 3, "coverage backfill should build a complete turn, not a single-step stub");
assert.ok(widePlans[0].searchDiagnostics.statesExpanded > 0);
assert.equal(widePlans[0].searchDiagnostics.searchedCandidates <= 12, true);

const diversityPlans = buildTurnPlans(fighterContext, [
  {
    id: "strike-one",
    name: "Strike One",
    slug: "strike",
    source: "strike",
    actionCost: 3,
    score: 30,
    confidence: "medium",
  },
  {
    id: "strike-two",
    name: "Strike Two",
    slug: "strike",
    source: "strike",
    actionCost: 3,
    score: 29,
    confidence: "medium",
  },
  {
    id: "battle-ward",
    name: "Battle Ward",
    slug: "battle-ward",
    source: "system-inferred",
    role: "buff",
    actionCost: 3,
    score: 28,
    confidence: "medium",
  },
]);
assert.equal(diversityPlans[0].steps[0].id, "strike-one", "best plan must remain first");
assert.equal(diversityPlans[1].steps[0].id, "battle-ward", "near-equal alternative should prefer a different tactical category");

console.log("PF2e Combater planner search test passed");
