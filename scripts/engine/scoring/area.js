import { canvasLinePathBlocked } from "../../rules/canvas-geometry.js";
import { areaRegionDistance } from "../area/region.js";

function targetCenter(entity) {
  const center = entity?.center ?? entity?.token?.center;
  const x = Number(center?.x);
  const y = Number(center?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function centerDistanceFeet(left, right, fallbackGridDistance = 5) {
  if (!left || !right) return Infinity;
  const gridSize = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size ?? 100);
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? fallbackGridDistance);
  if (!Number.isFinite(gridSize) || gridSize <= 0) return Infinity;
  return (Math.hypot(left.x - right.x, left.y - right.y) / gridSize) * (Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : fallbackGridDistance);
}

function pathBlocked(from, to) {
  if (!from || !to) return false;
  return canvasLinePathBlocked(from, to);
}

function vectorBetween(from, to) {
  if (!from || !to) return null;
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 0) return null;
  return { x, y, length };
}

function angleBetween(left, right) {
  if (!left || !right) return Infinity;
  const dot = left.x * right.x + left.y * right.y;
  const denominator = left.length * right.length;
  if (!Number.isFinite(dot) || !Number.isFinite(denominator) || denominator <= 0) return Infinity;
  const ratio = Math.max(-1, Math.min(1, dot / denominator));
  return Math.acos(ratio) * (180 / Math.PI);
}

function lineDistanceFeet(origin, direction, point) {
  const target = vectorBetween(origin, point);
  if (!target || !direction) return Infinity;
  const projection = ((target.x * direction.x) + (target.y * direction.y)) / direction.length;
  if (projection < 0 || projection > direction.length) return Infinity;
  const cross = Math.abs(target.x * direction.y - target.y * direction.x) / direction.length;
  const gridSize = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size ?? 100);
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? 5);
  if (!Number.isFinite(gridSize) || gridSize <= 0) return Infinity;
  return (cross / gridSize) * (Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : 5);
}

function directionalAreaContains(type, origin, direction, distance, entity) {
  const center = targetCenter(entity);
  const target = vectorBetween(origin, center);
  if (!target || pathBlocked(origin, center)) return false;

  const targetDistance = centerDistanceFeet(origin, center);
  if (targetDistance > distance) return false;

  if (type === "line") {
    return lineDistanceFeet(origin, direction, center) <= 2.5;
  }

  return angleBetween(direction, target) <= 45;
}

function directionalAreaPlacement(type, action, origin, enemyValues, allyValues, maxCastRange) {
  const distance = areaRegionDistance(action, null, 30);
  const candidates = enemyValues
    .filter((enemy) => (enemy?.distance ?? Infinity) <= Math.min(distance, maxCastRange))
    .filter((enemy) => {
      const center = targetCenter(enemy);
      return center && !pathBlocked(origin, center);
    });

  if (!candidates.length) {
    return {
      enemies: [],
      allies: [],
      centerTarget: null,
    };
  }

  return candidates
    .map((centerTarget) => {
      const direction = vectorBetween(origin, targetCenter(centerTarget));
      const hitEnemies = enemyValues.filter((enemy) => directionalAreaContains(type, origin, direction, distance, enemy));
      const hitAllies = allyValues.filter((ally) => directionalAreaContains(type, origin, direction, distance, ally));
      return {
        centerTarget,
        enemies: hitEnemies,
        allies: hitAllies,
        score: hitEnemies.length * 3 - hitAllies.length * 4,
      };
    })
    .toSorted((left, right) => right.score - left.score)[0];
}

function entitiesInArea(action, values) {
  const distance = areaRegionDistance(action, null, 30);
  return values.filter((entity) => (entity?.distance ?? Infinity) <= distance);
}

function withPlacementPoints(action, placement) {
  const centerTargetPoint = placement.centerTarget ? targetCenter(placement.centerTarget) : null;
  const areaType = String(action?.targetingProfile?.type ?? "").toLowerCase();
  return {
    ...placement,
    areaPlacementCenter: centerTargetPoint && !["cone", "line"].includes(areaType) ? centerTargetPoint : null,
    areaPlacementAimPoint: centerTargetPoint && ["cone", "line"].includes(areaType) ? centerTargetPoint : null,
  };
}

export function scoredAreaPlacement(action, context, { enemyValues = [], allyValues = [], maxCastRange = Infinity } = {}) {
  const type = String(action?.targetingProfile?.type ?? "area").toLowerCase();
  const distance = areaRegionDistance(action, null, 30);
  const origin = targetCenter(context?.token);

  if (["cone", "line"].includes(type) && origin) {
    return withPlacementPoints(action, directionalAreaPlacement(type, action, origin, enemyValues, allyValues, maxCastRange));
  }

  if (!["burst", "emanation"].includes(type)) {
    return withPlacementPoints(action, origin
      ? { enemies: [], allies: [], centerTarget: null }
      : {
        enemies: entitiesInArea(action, enemyValues),
        allies: entitiesInArea(action, allyValues),
        centerTarget: null,
      });
  }

  if (type === "emanation") {
    return withPlacementPoints(action, {
      enemies: enemyValues.filter((entity) => (entity?.distance ?? Infinity) <= distance),
      allies: allyValues.filter((entity) => (entity?.distance ?? Infinity) <= distance),
      centerTarget: null,
    });
  }

  if (!origin) {
    return withPlacementPoints(action, {
      enemies: entitiesInArea(action, enemyValues),
      allies: entitiesInArea(action, allyValues),
      centerTarget: null,
    });
  }

  const candidates = enemyValues
    .filter((enemy) => (enemy?.distance ?? Infinity) <= maxCastRange)
    .filter((enemy) => {
      const center = targetCenter(enemy);
      return !center || !pathBlocked(origin, center);
    });

  if (!candidates.length) {
    return withPlacementPoints(action, {
      enemies: entitiesInArea(action, enemyValues),
      allies: entitiesInArea(action, allyValues),
      centerTarget: null,
    });
  }

  return withPlacementPoints(action, candidates
    .map((centerTarget) => {
      const center = targetCenter(centerTarget);
      if (!center) {
        return {
          centerTarget,
          enemies: [centerTarget],
          allies: [],
          score: 1,
        };
      }
      const hitEnemies = enemyValues.filter((enemy) => centerDistanceFeet(center, targetCenter(enemy)) <= distance);
      const hitAllies = allyValues.filter((ally) => centerDistanceFeet(center, targetCenter(ally)) <= distance);
      return {
        centerTarget,
        enemies: hitEnemies,
        allies: hitAllies,
        score: hitEnemies.length * 3 - hitAllies.length * 4,
      };
    })
    .toSorted((left, right) => right.score - left.score)[0]);
}
