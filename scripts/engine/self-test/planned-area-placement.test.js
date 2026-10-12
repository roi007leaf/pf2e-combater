import assert from "node:assert/strict";
import { scoreCandidate } from "../scoring.js";
import { computeAreaMarker, refreshDraftAreaPlacements } from "../action/builder/projection.js";
import { showActionPreview, clearActionPreview } from "../../ui/action/preview.js";

const previousCanvas = globalThis.canvas;
const previousPIXI = globalThis.PIXI;
globalThis.canvas = {
  grid: { size: 100, distance: 5 },
  scene: { grid: { size: 100, distance: 5 } },
  walls: {
    // Tree blocks casting from Ezren's starting column, but not after moving left.
    checkCollision: (ray) => ray.A.x >= 600 && ray.A.y >= 600 && ray.B.y < 600,
  },
};
try {
  const goblin = { id: "goblin", name: "Goblin behind tree", center: { x: 650, y: 50 }, distance: 30 };
  const context = {
    actor: { id: "ezren" },
    profile: { conditions: { slugs: [], values: {} }, combatState: {} },
    token: { id: "ezren-token", center: { x: 650, y: 650 }, width: 1, height: 1 },
    targets: [goblin], enemies: [goblin], allies: [],
    battlefield: { targets: [goblin], enemies: [goblin], allies: [] },
  };
  const spell = scoreCandidate(context, {
    id: "fireball", slug: "fireball", name: "Fireball", actionCost: 2,
    source: "spell-curated", curated: { role: "area-damage" }, role: "area-damage",
    targetingProfile: { type: "burst", distance: 20, maxRange: 500, enemy: true },
    activityProfile: { spell: true },
  });
  assert.equal(spell.activityProfile.areaPlacementCenter, null, "tree blocks original recommendations");
  const stride = {
    instanceId: "move", action: { slug: "stride", requiresDestination: true },
    destination: { x: 50, y: 650 },
  };
  const cast = { instanceId: "cast", action: spell, execution: { status: "pending" } };
  const draft = { steps: [stride, cast], uncounted: [] };
  const after = refreshDraftAreaPlacements(context, draft).steps[1];
  assert.deepEqual(after.areaMarker.center, goblin.center, "30 ft left opens Fireball placement on goblin");
  assert.equal(after.action.activityProfile.areaPlacementOptions[0].enemyCount, 1);
  assert.deepEqual(context.token.center, { x: 650, y: 650 }, "planning must not move real token");
  assert.equal(cast.areaMarker, undefined, "refresh must not mutate stored draft");
  const circles = [];
  globalThis.PIXI = { Graphics: class {
    drawCircle(x, y, radius) { circles.push({ x, y, radius }); }
    destroy() {}
  } };
  globalThis.canvas.interface = { addChild() {} };
  assert.equal(showActionPreview(context, after, { skipMovement: true }).type, "area");
  assert.deepEqual(circles[0], { x: 650, y: 50, radius: 400 }, "hover draws Fireball on goblin after planned Stride");
  clearActionPreview();
  assert.equal(refreshDraftAreaPlacements(context, { steps: [cast, stride] }).steps[0].areaMarker, null,
    "later Stride cannot affect earlier Fireball");
  assert.equal(refreshDraftAreaPlacements(context, { steps: [{ ...stride, execution: { status: "failed" } }, cast] }).steps[1].areaMarker, null,
    "failed movement cannot open casting path");
  const chained = refreshDraftAreaPlacements(context, {
    steps: [{ ...stride, destination: { x: 350, y: 650 } }, { ...stride, instanceId: "move-again" }, cast],
  });
  assert.deepEqual(chained.steps[2].areaMarker.center, goblin.center, "chained Strides project final origin");
  assert.deepEqual(refreshDraftAreaPlacements(context, { steps: [stride], uncounted: [cast] }).uncounted[0].areaMarker.center,
    goblin.center, "uncounted actions use preceding movement too");
  assert.equal(refreshDraftAreaPlacements(context, { steps: [cast] }).steps[0].areaMarker, null,
    "removing Stride restores blocked placement");
  const manualMarker = { shape: "burst", center: { x: 200, y: 200 }, distance: 20 };
  const manual = refreshDraftAreaPlacements(context, { steps: [stride, { ...cast, areaMarker: manualMarker, areaPlacementIndex: -1 }] }).steps[1];
  assert.equal(manual.areaMarker, manualMarker, "manual placement survives movement edits");
  assert.equal(manual.action.activityProfile.areaPlacementOptions[0].enemyCount, 1, "manual placement still gets fresh choices");
  assert.equal(refreshDraftAreaPlacements(context, { steps: [stride, { ...cast, areaMarker: null, areaPlacementIndex: -1 }] }).steps[1].areaMarker,
    null, "removed template must not reappear during refresh");
  const done = { ...cast, areaMarker: manualMarker, execution: { status: "done" } };
  assert.equal(refreshDraftAreaPlacements(context, { steps: [stride, done] }).steps[1], done,
    "executed templates remain fixed");
  const cone = { ...spell, targetingProfile: { type: "cone", distance: 60, enemy: true } };
  const coneAfter = refreshDraftAreaPlacements(context, { steps: [stride, { ...cast, action: cone }] }).steps[1];
  assert.deepEqual(coneAfter.areaMarker.center, stride.destination, "cone starts at planned casting position");
  assert.deepEqual(computeAreaMarker(context, spell), null);
} finally {
  globalThis.canvas = previousCanvas;
  globalThis.PIXI = previousPIXI;
}
console.log("Planned area placement tests passed.");
