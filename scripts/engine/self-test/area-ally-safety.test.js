import assert from "node:assert/strict";
import { scoredAreaPlacement } from "../scoring/area.js";

const previousCanvas = globalThis.canvas;
globalThis.canvas = { grid: { size: 100, distance: 5 }, scene: { grid: { size: 100, distance: 5 } } };
try {
  const context = { token: { center: { x: 50, y: 50 } }, profile: {} };
  const cluster = [1, 2, 3].map((id) => ({ id: `enemy-${id}`, center: { x: 350, y: 50 } }));
  const ally = { id: "ally", center: { x: 350, y: 50 } };
  const isolated = { id: "safe-enemy", center: { x: 50, y: 850 } };
  for (const type of ["burst", "cone", "line"]) {
    const action = { targetingProfile: { type, distance: type === "burst" ? 10 : 60 } };
    const placement = scoredAreaPlacement(action, context, {
      enemyValues: [...cluster, isolated], allyValues: [ally], maxCastRange: 500,
    });
    assert.equal(placement.allies.length, 0, `${type}: safe attack must beat three enemies plus one ally`);
    assert.ok(placement.enemies.includes(isolated), `${type}: avoid empty templates when prioritizing safety`);
    assert.ok(placement.areaPlacementOptions.every((option) => option.allyCount === 0),
      `${type}: cycling recommendations must keep available ally-free placements`);
    const unavoidable = scoredAreaPlacement(action, context, {
      enemyValues: cluster, allyValues: [ally], maxCastRange: 500,
    });
    assert.equal(unavoidable.allies.length, 1, `${type}: still offer attack when friendly fire is unavoidable`);
    assert.equal(unavoidable.enemies.length, 3);
    const outOfReach = scoredAreaPlacement({ targetingProfile: { type, distance: 15 } }, context, {
      enemyValues: [{ id: "far", center: { x: 50, y: 850 }, distance: 40 }],
      allyValues: [], maxCastRange: 15,
    });
    assert.equal(outOfReach.enemies.length, 0);
    assert.equal(outOfReach.areaPlacementOptions.length, 0, `${type}: must not recommend an empty template`);
    assert.equal(outOfReach.areaPlacementAimPoint, null);
    assert.equal(outOfReach.areaPlacementCenter, null);
  }
} finally {
  globalThis.canvas = previousCanvas;
}
console.log("Area ally safety tests passed.");
