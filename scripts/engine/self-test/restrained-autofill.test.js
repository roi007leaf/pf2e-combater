import assert from "node:assert/strict";
import { fighterContext, fixtureCandidates } from "../fixtures.js";
import { buildCandidates } from "../candidates.js";
import { buildTurnPlans } from "../planner.js";
import { executeDraftStep } from "../action/executor.js";
import { projectContextForDraftDestination } from "../action/builder/index.js";

const context = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: { slugs: ["restrained"], values: { restrained: 1 } },
  },
};
const { candidates, detected } = buildCandidates(context);
const escape = candidates.find((action) => action.slug === "escape");
assert.ok(escape, "Restrained actors must have Escape available");
for (const slug of ["step", "stride", "sneak", "stand"]) {
  assert.equal(detected.find((action) => action.slug === slug)?.available, false);
  assert.equal(candidates.some((action) => action.slug === slug), false);
}

const plans = buildTurnPlans(context, [
  ...fixtureCandidates,
  { ...escape, score: 1 },
]);
assert.equal(plans[0].steps[0]?.slug, "escape", "Auto-fill must start with Escape while Restrained");
assert.ok(plans.every((plan) => plan.steps[0]?.slug === "escape"), "Every alternate plan must Escape first");
const actorProfileContext = { ...context, profile: undefined, actor: { ...context.actor, profile: context.profile } };
assert.equal(buildTurnPlans(actorProfileContext, [...fixtureCandidates, escape])[0].steps[0]?.slug, "escape");

const crowdedPlans = buildTurnPlans(context, [
  ...Array.from({ length: 20 }, (_, index) => ({
    id: `support-${index}`, slug: `support-${index}`, name: `Support ${index}`,
    source: "generic", role: "defense", actionCost: 1, score: 100 - index,
  })),
  { ...escape, score: 1 },
]);
assert.equal(crowdedPlans[0].steps[0]?.slug, "escape", "Candidate cap must not drop required Escape");

const stride = { slug: "stride", source: "generic", traits: ["move"], actionCost: 1 };
const result = await executeDraftStep({ context, step: { action: stride }, action: stride });
assert.equal(result.status, "failed", "Stale movement steps must stay blocked while Restrained");
assert.match(result.error, /restrained/i);

const liveContext = {
  ...context,
  actor: { document: { itemTypes: { condition: [{ slug: "restrained", system: { slug: "restrained" } }] } } },
};
const projectedContext = projectContextForDraftDestination(liveContext, {
  steps: [{ action: escape, actionKey: "escape", instanceId: "escape-1", actionCost: 1 }],
});
assert.equal(projectedContext.profile.conditions.slugs.includes("restrained"), false);
const stillRestrainedResult = await executeDraftStep({ context: projectedContext, step: { action: stride }, action: stride });
assert.equal(stillRestrainedResult.status, "failed", "Planned Escape cannot override actual Restrained condition");
assert.match(stillRestrainedResult.error, /restrained/i);

liveContext.actor.document.itemTypes.condition = [];
const freedResult = await executeDraftStep({ context: liveContext, step: { action: stride }, action: stride });
assert.equal(freedResult.status, "needs-choice", "Movement is available again after actual condition removal");

const oneActionPlans = buildTurnPlans({ ...context, actionsSpent: { normal: 2 } }, [...fixtureCandidates, escape]);
assert.equal(oneActionPlans[0].steps[0]?.slug, "escape");
assert.equal(oneActionPlans[0].totalCost, 1);
assert.equal(buildTurnPlans(context, fixtureCandidates)[0].steps.length, 0, "No illegal fallback if Escape is unavailable");

console.log("restrained-autofill.test.js passed");
