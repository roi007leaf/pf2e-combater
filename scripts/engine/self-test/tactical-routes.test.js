import assert from "node:assert/strict";
import {
  availableTacticalRouteModes,
  compareTacticalRouteCenters,
  nextTacticalRouteMode,
  tacticalRouteMetrics,
  tacticalRouteModeForStep,
} from "../../rules/tactical-routes.js";
import { movementPreviewForStep } from "../../ui/movement-preview.js";

const target = { id: "target", center: { x: 20, y: 0 }, threatReach: 5 };
const enemy = { id: "enemy", center: { x: 10, y: 0 }, threatReach: 5 };
const ally = { id: "ally", center: { x: 25, y: 0 }, threatReach: 5 };
const context = {
  isGM: false,
  profile: { reach: 5 },
  targets: [target],
  enemies: [enemy],
  allies: [ally],
};

assert.equal(tacticalRouteModeForStep({}), "approach");
assert.deepEqual(
  availableTacticalRouteModes(context, {}),
  ["approach", "shortest", "safe", "cover", "flank", "escape"],
);
assert.equal(nextTacticalRouteMode(context, { routeMode: "approach" }), "shortest");

const short = { x: 15, y: 5, cost: 5, route: [{ x: 15, y: 5 }] };
const long = { x: 15, y: -5, cost: 15, route: [{ x: 0, y: -5 }, { x: 15, y: -5 }] };
assert.ok(compareTacticalRouteCenters(context, { routeMode: "shortest" }, short, long, { target }) < 0);

const danger = { x: 10, y: 0, cost: 5, route: [{ x: 5, y: 0 }, { x: 10, y: 0 }] };
const safe = { x: 10, y: 15, cost: 15, route: [{ x: 0, y: 10 }, { x: 10, y: 15 }] };
assert.ok(compareTacticalRouteCenters(context, { routeMode: "safe" }, safe, danger, { target }) < 0);

const lineBlocked = (center) => center.y >= 10;
assert.ok(compareTacticalRouteCenters(context, { routeMode: "cover" }, safe, danger, { target, lineBlocked }) < 0);

const flank = { x: 15, y: 0, cost: 10, route: [{ x: 15, y: 0 }] };
const offAxis = { x: 20, y: 5, cost: 10, route: [{ x: 20, y: 5 }] };
assert.ok(compareTacticalRouteCenters(context, { routeMode: "flank" }, flank, offAxis, { target }) < 0);

const escape = { x: -10, y: 0, cost: 15, route: [{ x: -5, y: 0 }, { x: -10, y: 0 }] };
assert.ok(compareTacticalRouteCenters(context, { routeMode: "escape" }, escape, danger, { target }) < 0);

const hiddenContext = {
  ...context,
  enemies: [{ ...enemy, detectionState: "undetected" }],
};
assert.equal(
  tacticalRouteMetrics(hiddenContext, { routeMode: "safe" }, danger).endpointThreats,
  0,
  "player route scoring must not infer undetected enemies",
);
assert.equal(
  tacticalRouteMetrics({
    token: { center: { x: 0, y: 0 }, width: 2, height: 2 },
    enemies: [{ center: { x: 15, y: 0 }, width: 2, height: 2, threatReach: 5 }],
  }, { routeMode: "safe" }, { x: 0, y: 0 }, { gridSize: 5 }).endpointThreats,
  1,
  "route threat distance should measure from token footprints, not only center points",
);

const openLineContext = {
  isGM: true,
  token: { center: { x: 0, y: 0 } },
  enemies: [{ center: { x: 100, y: 0 }, threatReach: 5 }],
};
const sparseRoute = {
  x: 20,
  y: 0,
  cost: 20,
  route: [{ x: 5, y: 0, cost: 5 }, { x: 20, y: 0, cost: 20 }],
};
const denseRoute = {
  x: 20,
  y: 0,
  cost: 20,
  route: [
    { x: 5, y: 0, cost: 5 },
    { x: 10, y: 0, cost: 10 },
    { x: 15, y: 0, cost: 15 },
    { x: 20, y: 0, cost: 20 },
  ],
};
assert.equal(
  tacticalRouteMetrics(openLineContext, { routeMode: "cover" }, sparseRoute).pathLines,
  tacticalRouteMetrics(openLineContext, { routeMode: "cover" }, denseRoute).pathLines,
  "route exposure must not change when the same path uses fewer stored points",
);

const normalTerrainRoute = {
  x: 10,
  y: 0,
  cost: 10,
  route: [{ x: 5, y: 0, cost: 5 }, { x: 10, y: 0, cost: 10 }],
};
const difficultTerrainRoute = {
  x: 10,
  y: 0,
  cost: 20,
  route: [{ x: 5, y: 0, cost: 10 }, { x: 10, y: 0, cost: 20 }],
};
assert.equal(
  tacticalRouteMetrics(openLineContext, { routeMode: "cover" }, difficultTerrainRoute).pathLines,
  tacticalRouteMetrics(openLineContext, { routeMode: "cover" }, normalTerrainRoute).pathLines * 2,
  "exposure must weight movement budget spent crossing costly terrain",
);

const weightedLineContext = {
  isGM: true,
  token: { center: { x: 0, y: 10 } },
  enemies: [{ center: { x: 100, y: 0 }, threatReach: 5 }],
};
const highExposureRoute = {
  x: 10,
  y: 10,
  cost: 40,
  route: [
    { x: 0, y: 0, cost: 10 },
    { x: 10, y: 0, cost: 30 },
    { x: 10, y: 10, cost: 40 },
  ],
};
const lowExposureRoute = {
  x: 10,
  y: 10,
  cost: 40,
  route: [
    { x: 0, y: 0, cost: 20 },
    { x: 10, y: 0, cost: 30 },
    { x: 10, y: 10, cost: 40 },
  ],
};
assert.ok(
  compareTacticalRouteCenters(
    weightedLineContext,
    { routeMode: "safe" },
    lowExposureRoute,
    highExposureRoute,
    { lineBlocked: (center) => center.y >= 5 },
  ) < 0,
  "safe routing must prefer less segment-weighted exposure when endpoints and node counts match",
);
const weightedThreatContext = {
  isGM: true,
  token: { center: { x: 0, y: 10 } },
  enemies: [{ center: { x: 5, y: 0 }, width: 0.5, height: 0.5, threatReach: 5 }],
};
assert.ok(
  tacticalRouteMetrics(weightedThreatContext, { routeMode: "safe" }, lowExposureRoute).pathThreats
    < tacticalRouteMetrics(weightedThreatContext, { routeMode: "safe" }, highExposureRoute).pathThreats,
  "melee exposure must use the same segment weighting as open enemy lines",
);

const movementContext = {
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 10, reach: 5 } },
  profile: { speed: 10, reach: 5 },
  targets: [target],
  enemies: [enemy],
  allies: [],
};
const approachPreview = movementPreviewForStep(movementContext, {
  slug: "stride",
  routeMode: "approach",
}, { gridSize: 5 });
const safePreview = movementPreviewForStep(movementContext, {
  slug: "stride",
  routeMode: "safe",
}, { gridSize: 5 });
const shortestPreview = movementPreviewForStep(movementContext, {
  slug: "stride",
  routeMode: "shortest",
}, { gridSize: 5 });
assert.notDeepEqual(
  { x: shortestPreview.recommendedCenter.x, y: shortestPreview.recommendedCenter.y },
  movementContext.token.center,
  "an explicit route mode must not recommend spending Stride without leaving the origin",
);
assert.notDeepEqual(
  safePreview.recommendedCenter,
  approachPreview.recommendedCenter,
  "the movement recommendation must consume the selected tactical route mode",
);
assert.ok(
  tacticalRouteMetrics(movementContext, { routeMode: "safe" }, safePreview.recommendedCenter).endpointThreats
    <= tacticalRouteMetrics(movementContext, { routeMode: "approach" }, approachPreview.recommendedCenter).endpointThreats,
  "the safe route should not land in more melee threat than the approach route",
);

console.log("PF2e Combater tactical route test passed");
