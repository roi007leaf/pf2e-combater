import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";
import { scoreCandidate } from "../scoring.js";
import { refreshDraftAreaPlacements } from "../action/builder/projection.js";

const previousCanvas = globalThis.canvas;
globalThis.canvas = { grid: { size: 100, distance: 5 }, scene: { grid: { size: 100, distance: 5 } } };
try {
  const enemy = { id: "goblin", name: "Goblin", center: { x: 250, y: 50 }, distance: 35 };
  const context = {
    ...fighterContext,
    token: { id: "ezren", center: { x: 50, y: 650 }, width: 1, height: 1 },
    targets: [enemy], enemies: [enemy], allies: [],
    battlefield: { targets: [enemy], enemies: [enemy], allies: [] },
  };
  const breatheFire = scoreCandidate(context, {
    id: "breathe-fire", slug: "breathe-fire", name: "Breathe Fire", role: "area-damage",
    curated: { role: "area-damage" }, source: "spell-curated", actionCost: 2, confidence: "high",
    targetingProfile: { type: "cone", distance: 15, enemy: true },
    saveProfile: { stat: "reflex", basic: true }, activityProfile: { spell: true },
  });
  const sure = {
    id: "sure-strike", slug: "sure-strike", name: "Sure Strike", role: "buff",
    source: "spell-curated", actionCost: 1, confidence: "high", score: 153,
    activityProfile: { attackBuff: true, preMovementSetup: true }, setupFor: ["strike", "attack", "damage"],
  };
  const drain = { id: "drain", slug: "drain", name: "Drain Bonded Item", source: "generic",
    role: "resource-recovery", actionCost: 0, score: 100, confidence: "high" };
  const stale = refreshDraftAreaPlacements(context, { steps: [{
    instanceId: "empty-cone", action: breatheFire,
    areaMarker: { shape: "cone", center: context.token.center, distance: 15, rotation: 0 },
  }] }).steps[0];
  assert.equal(stale.areaMarker, null, "refresh removes stale automatic cone that hits no enemy");
  assert.deepEqual(stale.action.activityProfile.areaPlacementOptions, [], "empty AOE cannot expose a recommended placement button");
  for (const includeCoverage of [false, true]) {
    const invalid = buildTurnPlans(context, [{ ...breatheFire, score: 143 }, sure, drain], { includeCoverage });
    assert.ok(invalid.every((plan) => plan.steps.every((step) => !["breathe-fire", "sure-strike"].includes(step.slug))),
      "reported Sure Strike + empty Breathe Fire + Drain plan must never be offered");
    const stride = { id: "stride", slug: "stride", name: "Stride", source: "generic", role: "mobility",
      requiresDestination: true, destination: { x: 50, y: 250 }, actionCost: 1, score: 80, confidence: "high" };
    const moved = buildTurnPlans(context, [stride, { ...breatheFire, score: 143 }], { includeCoverage });
    assert.ok(moved.some((plan) => plan.steps.some((step) => step.slug === "stride")
      && plan.steps.some((step) => step.slug === "breathe-fire")), "planned Stride can make short cone useful");
  }
} finally {
  globalThis.canvas = previousCanvas;
}
console.log("Area planner hit tests passed.");
