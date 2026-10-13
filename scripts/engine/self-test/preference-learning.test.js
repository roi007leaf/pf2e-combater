import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTurnPlans } from "../planner.js";
import {
  boundedPlanPreferenceDelta,
  deterministicPlanPreferenceAdjustment,
  deterministicPreferenceAdjustment,
  forgetPreferenceFeature,
  learnedPreferenceEntries,
  nextEditPreferenceProfile,
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
assert.equal(boundedPlanPreferenceDelta(20, 10), 24, "learned preferences can move a plan, within a cap");
assert.equal(boundedPlanPreferenceDelta(-20, -10), -24);

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
assert.equal(positivePlan.scoreDelta, 12, "exact plan feedback should create useful but bounded direct adjustment");
assert.equal(
  preferenceAdjustmentFromProfile(profile, action).scoreDelta,
  11,
  "rated plan should teach each component action",
);
assert.equal(
  preferenceAdjustmentFromProfile(profile, action).reason,
  "You usually pick Demoralize (+11).",
  "the reason names what was learned in plain words",
);
assert.equal(
  preferenceAdjustmentFromProfile(profile, { ...related, id: "related-debuff" }).scoreDelta,
  5,
  "safe shared plan features should generalize to similar future actions",
);
assert.notEqual(
  preferencePlanId(plan),
  preferencePlanId({ ...plan, steps: [...plan.steps].reverse() }),
  "plan identity must preserve visible sequence order",
);

profile = nextPlanPreferenceProfile(profile, plan, -1);
assert.equal(planPreferenceAdjustmentFromProfile(profile, plan).scoreDelta, -12);
assert.equal(preferenceAdjustmentFromProfile(profile, action).scoreDelta, -11);
assert.match(preferenceAdjustmentFromProfile(profile, action).reason, /You usually skip Demoralize/);
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
  16,
  "component preference impact saturates per feature and stays under the scoring cap",
);
assert.ok(
  Math.abs(planPreferenceAdjustmentFromProfile(saturated, { steps: [{ ...action, id: "debuff-0", name: "Debuff 0" }], totalCost: 1 }).scoreDelta) <= 24,
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
  assert.equal(deterministicPreferenceAdjustment(context, action).scoreDelta, 11);
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

// Edits after Auto-fill are soft evidence: each removal nudges the action down, capped.
{
  const recall = { id: "recall-knowledge", name: "Recall Knowledge", role: "setup", actionCost: 1, skill: "society" };
  let edited = nextEditPreferenceProfile({}, recall, -1);
  const once = preferenceAdjustmentFromProfile(edited, recall).scoreDelta;
  assert.ok(once < 0 && once > -11, `one removal is a softer signal than a thumbs-down (${once})`);
  for (let index = 0; index < 5; index += 1) edited = nextEditPreferenceProfile(edited, recall, -1);
  const many = preferenceAdjustmentFromProfile(edited, recall).scoreDelta;
  assert.ok(many < once, "repeated removals strengthen the signal");
  assert.equal(edited.examples["edit:recall-knowledge"].label, -1.2, "edit evidence is capped");
  assert.match(preferenceAdjustmentFromProfile(edited, recall).reason, /You usually skip Recall Knowledge/);
  edited = nextEditPreferenceProfile(edited, recall, 1);
  assert.equal(edited.examples["edit:recall-knowledge"].label, -0.8, "adding it back moves the other way");

  // The learned list shows the strongest preferences by name, and Forget removes one.
  const entries = learnedPreferenceEntries(edited);
  assert.equal(entries[0].label, "Recall Knowledge");
  assert.equal(entries[0].positive, false);
  const forgotten = forgetPreferenceFeature(edited, entries[0].feature);
  assert.equal(preferenceAdjustmentFromProfile(forgotten, recall).contributions.some((entry) => entry.feature === entries[0].feature), false);
  assert.deepEqual(forgetPreferenceFeature(edited, null).examples, {}, "Forget all clears everything");
}

// Plan ratings learn from the plan's real actions when given (draft steps only carry names).
{
  const draftPlan = { steps: [{ instanceId: "a", actionKey: "k1", name: "Demoralize" }], totalCost: 1 };
  const rated = nextPlanPreferenceProfile({}, draftPlan, 1, [action]);
  assert.equal(preferenceAdjustmentFromProfile(rated, action).scoreDelta, 11, "the candidate Auto-fill scores later matches what was rated");
  const namesOnly = nextPlanPreferenceProfile({}, draftPlan, 1);
  assert.ok(preferenceAdjustmentFromProfile(namesOnly, action).scoreDelta < 11, "without real actions only generic features match");
}

// Version 2 profiles keep their ratings.
assert.equal(
  Object.keys(nextPlanPreferenceProfile({ version: 2, examples: orderedExamples }, plan, 0).examples).length,
  Object.keys(orderedExamples).length,
);

console.log("PF2e Combater deterministic plan preference-learning test passed");
