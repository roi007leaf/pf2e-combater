import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTurnPlans } from "../planner.js";
import {
  boundedPlanPreferenceDelta,
  deterministicPlanPreferenceAdjustment,
  deterministicPreferenceAdjustment,
  nextPlanPreferenceProfile,
  planPreferenceAdjustmentFromProfile,
  preferenceAdjustmentFromProfile,
  preferencePlanFeatures,
  preferencePlanId,
  setPlanPreferenceFeedback,
} from "../../state/preference-profile.js";

const panelTemplate = readFileSync(new URL("../../../templates/combater-panel.hbs", import.meta.url), "utf8");
const browserTemplate = readFileSync(new URL("../../../templates/combater-browser.hbs", import.meta.url), "utf8");
assert.ok(panelTemplate.includes('data-plan-preference="1"'));
assert.ok(panelTemplate.includes('data-plan-preference="-1"'));
assert.equal(browserTemplate.includes("data-preference-action"), false, "feedback controls belong to plan, not action browser");
assert.equal(boundedPlanPreferenceDelta(12, 6), 8);
assert.equal(boundedPlanPreferenceDelta(-12, -6), -8);

const action = {
  id: "demoralize",
  name: "Demoralize",
  role: "debuff",
  actionCost: 1,
  skill: "intimidation",
};
const related = {
  ...action,
  id: "bon-mot",
  name: "Bon Mot",
};
const plan = { steps: [action, related], totalCost: 2 };

let profile = nextPlanPreferenceProfile({}, plan, 1);
const positivePlan = planPreferenceAdjustmentFromProfile(profile, plan);
assert.equal(positivePlan.feedback, 1, "feedback belongs to complete plan, not isolated browser action");
assert.equal(positivePlan.scoreDelta, 6, "exact plan feedback should create useful but bounded direct adjustment");
assert.equal(
  preferenceAdjustmentFromProfile(profile, action).scoreDelta,
  6,
  "rated plan should teach each component action",
);
assert.equal(
  preferenceAdjustmentFromProfile(profile, { ...related, id: "related-debuff" }).scoreDelta,
  3,
  "safe shared plan features should generalize to similar future actions",
);
assert.notEqual(
  preferencePlanId(plan),
  preferencePlanId({ ...plan, steps: [...plan.steps].reverse() }),
  "plan identity must preserve visible sequence order",
);

profile = nextPlanPreferenceProfile(profile, plan, -1);
assert.equal(planPreferenceAdjustmentFromProfile(profile, plan).scoreDelta, -6);
assert.equal(preferenceAdjustmentFromProfile(profile, action).scoreDelta, -6);
profile = nextPlanPreferenceProfile(profile, plan, -1);
assert.equal(planPreferenceAdjustmentFromProfile(profile, plan).scoreDelta, 0, "clicking active plan feedback again should remove it");

let saturated = {};
for (let index = 0; index < 10; index += 1) {
  saturated = nextPlanPreferenceProfile(saturated, {
    steps: [{ ...action, id: `debuff-${index}`, name: `Debuff ${index}` }],
    totalCost: 1,
  }, 1);
}
assert.equal(
  preferenceAdjustmentFromProfile(saturated, { ...action, id: "debuff-0", name: "Debuff 0" }).scoreDelta,
  8,
  "component preference impact must never exceed scoring cap",
);
assert.ok(
  Math.abs(planPreferenceAdjustmentFromProfile(saturated, { steps: [{ ...action, id: "debuff-0", name: "Debuff 0" }], totalCost: 1 }).scoreDelta) <= 8,
  "direct plan preference impact must never exceed scoring cap",
);

const orderedExamples = Object.fromEntries(Array.from({ length: 6 }, (_value, index) => {
  const candidatePlan = { steps: [{ ...action, id: `mixed-${index}` }], totalCost: 1 };
  return [
    preferencePlanId(candidatePlan),
    { label: index < 3 ? 1 : -1, features: preferencePlanFeatures(candidatePlan) },
  ];
}));
const reversedExamples = Object.fromEntries(Object.entries(orderedExamples).reverse());
const unrelated = { ...related, id: "unrelated" };
assert.equal(
  preferenceAdjustmentFromProfile({ version: 2, examples: orderedExamples }, unrelated).scoreDelta,
  preferenceAdjustmentFromProfile({ version: 2, examples: reversedExamples }, unrelated).scoreDelta,
  "model output must not depend on plan-feedback insertion order",
);

const previousStorage = globalThis.localStorage;
const previousGame = globalThis.game;
const values = new Map();
try {
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
  globalThis.game = { user: { id: "preference-user" } };
  const context = { actor: { document: { uuid: "Actor.preference" } } };
  setPlanPreferenceFeedback(context, plan, 1);
  assert.equal(deterministicPlanPreferenceAdjustment(context, plan).positive, true);
  assert.equal(deterministicPreferenceAdjustment(context, action).scoreDelta, 6);
  assert.equal(
    deterministicPreferenceAdjustment({ actor: { document: { uuid: "Actor.other" } } }, action).scoreDelta,
    0,
    "plan learning must remain user/actor scoped",
  );

  const dislikedCandidate = {
    id: "high-score-plan",
    name: "High Score Plan",
    source: "system-inferred",
    actionCost: 3,
    score: 500,
    confidence: "high",
  };
  const normalCandidate = {
    id: "normal-score-plan",
    name: "Normal Score Plan",
    source: "system-inferred",
    actionCost: 3,
    score: 10,
    confidence: "high",
  };
  const demotionContext = { actor: { document: { uuid: "Actor.preference-demotion" } } };
  const initialPlans = buildTurnPlans(demotionContext, [dislikedCandidate, normalCandidate]);
  const dislikedPlan = initialPlans.find((candidatePlan) => candidatePlan.steps[0]?.id === "high-score-plan");
  assert.ok(dislikedPlan, "test fixture should create the high-score plan");
  setPlanPreferenceFeedback(demotionContext, dislikedPlan, -1);
  const demotedPlans = buildTurnPlans(demotionContext, [dislikedCandidate, normalCandidate]);
  assert.equal(
    demotedPlans.at(-1).steps[0]?.id,
    "high-score-plan",
    "thumbs-down should move the exact disliked plan to the end of the plan queue",
  );
  assert.equal(demotedPlans.at(-1).preference.queueDemoted, true);
  const regeneratedDemotedPlans = buildTurnPlans(demotionContext, [
    { ...dislikedCandidate, id: "high-score-plan-regenerated" },
    normalCandidate,
  ]);
  assert.equal(
    regeneratedDemotedPlans.at(-1).steps[0]?.id,
    "high-score-plan-regenerated",
    "thumbs-down demotion should survive regenerated candidate ids for the same visible plan",
  );
  assert.equal(regeneratedDemotedPlans.at(-1).preference.queueDemoted, true);
} finally {
  globalThis.localStorage = previousStorage;
  globalThis.game = previousGame;
}

console.log("PF2e Combater deterministic plan preference-learning test passed");
