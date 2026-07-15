import {
  canvasGridDistance,
  canvasGridSize,
  canvasLinePathBlocked,
} from "../../rules/canvas-geometry.js";
import { movementFootprintCentersForToken } from "../../rules/token-geometry.js";
import { areaRegionDistance, areaRegionWidth } from "../area/region.js";
import { canUseTargetDefenses, damageAdjustment, saveScoreDelta } from "./facts.js";

const BASE_ENEMY_VALUE = 100;
const ALLY_PENALTY = 140;
const MAX_GRID_CANDIDATES = 4096;
const DIRECTION_SWEEP_DEGREES = 5;

function targetCenter(entity) {
  const center = entity?.center ?? entity?.token?.center;
  const x = Number(center?.x);
  const y = Number(center?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function centerDistanceFeet(left, right, fallbackGridDistance = 5) {
  if (!left || !right) return Infinity;
  const gridSize = canvasGridSize();
  const gridDistance = canvasGridDistance() || fallbackGridDistance;
  if (!Number.isFinite(gridSize) || gridSize <= 0) return Infinity;
  return (Math.hypot(left.x - right.x, left.y - right.y) / gridSize) * gridDistance;
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

function entityFootprintPoints(entity) {
  const center = targetCenter(entity);
  if (!center) return [];
  return movementFootprintCentersForToken(center, entity?.token ?? entity, canvasGridSize());
}

function directionalPointIsInside(type, action, origin, direction, distance, point) {
  const target = vectorBetween(origin, point);
  if (!target || pathBlocked(origin, point)) return false;

  const targetDistance = centerDistanceFeet(origin, point);
  if (targetDistance > distance) return false;

  if (type === "line") {
    const projection = ((target.x * direction.x) + (target.y * direction.y)) / direction.length;
    if (projection < 0) return false;
    const crossPixels = Math.abs(target.x * direction.y - target.y * direction.x) / direction.length;
    const crossFeet = (crossPixels / canvasGridSize()) * canvasGridDistance();
    return crossFeet <= areaRegionWidth(action, null, 5) / 2;
  }

  const angle = Number(action?.targetingProfile?.angle ?? action?.area?.angle ?? 90);
  return angleBetween(direction, target) <= (Number.isFinite(angle) && angle > 0 ? angle : 90) / 2;
}

function directionalAreaContains(type, action, origin, direction, distance, entity) {
  return entityFootprintPoints(entity)
    .some((point) => directionalPointIsInside(type, action, origin, direction, distance, point));
}

function saveIntelCategory(action) {
  return action?.saveProfile?.stat === "perception" ? "perception" : "saves";
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function enemyPlacementValue(action, context, enemy) {
  let value = BASE_ENEMY_VALUE;
  const damage = damageAdjustment(context, action, enemy);
  if (damage) value += clamp(Math.round(damage.scoreDelta * 0.7), -50, 50);

  if (action?.saveProfile && canUseTargetDefenses(context, enemy, saveIntelCategory(action))) {
    const save = saveScoreDelta(context, action, enemy, context?.profile ?? context?.actor?.profile ?? {});
    if (save) value += clamp(Math.round(save.scoreDelta * 0.5), -40, 40);
  }

  return Math.max(20, value);
}

function placementEvaluator(action, context, enemyValues) {
  const enemyWeights = new Map(enemyValues.map((enemy) => [enemy, enemyPlacementValue(action, context, enemy)]));
  return (enemies, allies) => enemies.reduce((total, enemy) => total + (enemyWeights.get(enemy) ?? BASE_ENEMY_VALUE), 0)
    - allies.length * ALLY_PENALTY;
}

function comparePlacements(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.allies.length !== right.allies.length) return left.allies.length - right.allies.length;
  return right.enemies.length - left.enemies.length;
}

function placementOutcomeKey(placement, enemyValues, allyValues) {
  const enemyIndexes = placement.enemies
    .map((enemy) => enemyValues.indexOf(enemy))
    .filter((index) => index >= 0)
    .toSorted((left, right) => left - right);
  const allyIndexes = placement.allies
    .map((ally) => allyValues.indexOf(ally))
    .filter((index) => index >= 0)
    .toSorted((left, right) => left - right);
  return `e:${enemyIndexes.join(",")}|a:${allyIndexes.join(",")}`;
}

function placementOption(action, placement, index) {
  const decorated = withPlacementPoints(action, placement);
  return {
    index,
    score: placement.score,
    enemyCount: placement.enemies.length,
    allyCount: placement.allies.length,
    areaPlacementCenter: decorated.areaPlacementCenter,
    areaPlacementAimPoint: decorated.areaPlacementAimPoint,
  };
}

function bestPlacementWithOptions(action, placements, enemyValues, allyValues) {
  if (!placements.length) return null;
  const seenOutcomes = new Set();
  const distinct = [];
  for (const placement of placements) {
    const outcome = placementOutcomeKey(placement, enemyValues, allyValues);
    if (seenOutcomes.has(outcome)) continue;
    seenOutcomes.add(outcome);
    distinct.push(placement);
    if (distinct.length >= 3) break;
  }
  return {
    ...withPlacementPoints(action, placements[0]),
    areaPlacementOptions: distinct.map((placement, index) => placementOption(action, placement, index)),
  };
}

function directionalCandidates(origin, enemyValues, distance, maxCastRange) {
  const candidates = [];
  const seenAngles = new Set();
  const maximumRange = Math.min(distance, maxCastRange);
  const eligible = enemyValues.filter((enemy) => {
    const reportedDistance = Number(enemy?.distance);
    if (Number.isFinite(reportedDistance)) return reportedDistance <= maximumRange;
    return entityFootprintPoints(enemy).some((point) => centerDistanceFeet(origin, point) <= maximumRange);
  });

  const add = (aimPoint, centerTarget = null) => {
    const direction = vectorBetween(origin, aimPoint);
    if (!direction) return;
    const angle = ((Math.atan2(direction.y, direction.x) * 180) / Math.PI + 360) % 360;
    const key = Math.round(angle * 100) / 100;
    if (seenAngles.has(key)) return;
    seenAngles.add(key);
    candidates.push({ aimPoint, centerTarget, direction });
  };

  for (const enemy of eligible) {
    const center = targetCenter(enemy);
    if (center && !pathBlocked(origin, center)) add(center, enemy);
  }

  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    const left = targetCenter(eligible[leftIndex]);
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const right = targetCenter(eligible[rightIndex]);
      if (!right) continue;
      add({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    }
  }

  const directionLength = (distance / canvasGridDistance()) * canvasGridSize();
  for (let degrees = 0; degrees < 360; degrees += DIRECTION_SWEEP_DEGREES) {
    const radians = (degrees * Math.PI) / 180;
    add({
      x: origin.x + Math.cos(radians) * directionLength,
      y: origin.y + Math.sin(radians) * directionLength,
    });
  }

  return candidates;
}

function directionalAreaPlacements(type, action, context, origin, enemyValues, allyValues, maxCastRange) {
  const distance = areaRegionDistance(action, null, 30);
  const evaluate = placementEvaluator(action, context, enemyValues);
  return directionalCandidates(origin, enemyValues, distance, maxCastRange)
    .map(({ aimPoint, centerTarget, direction }) => {
      const enemies = enemyValues.filter((enemy) => directionalAreaContains(type, action, origin, direction, distance, enemy));
      const allies = allyValues.filter((ally) => directionalAreaContains(type, action, origin, direction, distance, ally));
      return {
        aimPoint,
        centerTarget,
        enemies,
        allies,
        score: evaluate(enemies, allies),
      };
    })
    .toSorted(comparePlacements);
}

function pointOnScene(point) {
  const rect = globalThis.canvas?.dimensions?.sceneRect;
  if (!rect) return true;
  if (typeof rect.contains === "function") return rect.contains(point.x, point.y);
  const x = Number(rect.x ?? 0);
  const y = Number(rect.y ?? 0);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) return true;
  return point.x >= x && point.y >= y && point.x <= x + width && point.y <= y + height;
}

function snappedGridCenter(point) {
  const size = canvasGridSize();
  return {
    x: Math.floor(point.x / size) * size + size / 2,
    y: Math.floor(point.y / size) * size + size / 2,
  };
}

function burstCandidateCenters(enemyValues, distance) {
  const entries = [];
  const seen = new Set();
  const points = enemyValues.flatMap(entityFootprintPoints);
  const add = (point, centerTarget = null) => {
    if (!point || !pointOnScene(point) || entries.length >= MAX_GRID_CANDIDATES) return;
    const key = `${Math.round(point.x * 100) / 100}:${Math.round(point.y * 100) / 100}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ center: point, centerTarget });
  };

  for (const enemy of enemyValues) add(targetCenter(enemy), enemy);
  for (const point of points) add(snappedGridCenter(point));

  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      add(snappedGridCenter({
        x: (points[leftIndex].x + points[rightIndex].x) / 2,
        y: (points[leftIndex].y + points[rightIndex].y) / 2,
      }));
    }
  }

  if (points.length > 1) {
    add(snappedGridCenter({
      x: points.reduce((total, point) => total + point.x, 0) / points.length,
      y: points.reduce((total, point) => total + point.y, 0) / points.length,
    }));
  }

  if (!points.length) return entries;

  const size = canvasGridSize();
  const radiusPixels = (distance / canvasGridDistance()) * size;
  const minimumX = Math.min(...points.map((point) => point.x)) - radiusPixels;
  const maximumX = Math.max(...points.map((point) => point.x)) + radiusPixels;
  const minimumY = Math.min(...points.map((point) => point.y)) - radiusPixels;
  const maximumY = Math.max(...points.map((point) => point.y)) + radiusPixels;
  const first = snappedGridCenter({ x: minimumX, y: minimumY });
  const columns = Math.floor((maximumX - first.x) / size) + 1;
  const rows = Math.floor((maximumY - first.y) / size) + 1;

  if (columns > 0 && rows > 0 && columns * rows <= MAX_GRID_CANDIDATES - entries.length) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        add({ x: first.x + column * size, y: first.y + row * size });
      }
    }
    return entries;
  }

  for (const point of points) {
    for (const ratio of [0.5, 1]) {
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const radians = (degrees * Math.PI) / 180;
        add(snappedGridCenter({
          x: point.x + Math.cos(radians) * radiusPixels * ratio,
          y: point.y + Math.sin(radians) * radiusPixels * ratio,
        }));
      }
    }
  }

  return entries;
}

function entityInBurst(center, distance, entity) {
  return entityFootprintPoints(entity).some((point) =>
    centerDistanceFeet(center, point) <= distance && !pathBlocked(center, point),
  );
}

function centerWithinCastRange(origin, center, maxCastRange, centerTarget = null) {
  if (!Number.isFinite(maxCastRange)) return true;
  const reportedDistance = Number(centerTarget?.distance);
  if (Number.isFinite(reportedDistance) && reportedDistance <= maxCastRange) return true;
  return centerDistanceFeet(origin, center) <= maxCastRange;
}

function burstAreaPlacements(action, context, origin, enemyValues, allyValues, maxCastRange) {
  const distance = areaRegionDistance(action, null, 30);
  const evaluate = placementEvaluator(action, context, enemyValues);
  return burstCandidateCenters(enemyValues, distance)
    .filter(({ center, centerTarget }) =>
      centerWithinCastRange(origin, center, maxCastRange, centerTarget)
      && !pathBlocked(origin, center),
    )
    .map(({ center, centerTarget }) => {
      const enemies = enemyValues.filter((enemy) => entityInBurst(center, distance, enemy));
      const allies = allyValues.filter((ally) => entityInBurst(center, distance, ally));
      return {
        center,
        centerTarget,
        enemies,
        allies,
        score: evaluate(enemies, allies),
      };
    })
    .filter((placement) => placement.enemies.length > 0)
    .toSorted(comparePlacements);
}

function entitiesInArea(action, values, center = null) {
  const distance = areaRegionDistance(action, null, 30);
  if (center) {
    return values.filter((entity) => {
      const reportedDistance = Number(entity?.distance);
      const entityCenter = targetCenter(entity);
      if (
        Number.isFinite(reportedDistance)
        && reportedDistance <= distance
        && (!entityCenter || !pathBlocked(center, entityCenter))
      ) return true;
      return entityInBurst(center, distance, entity);
    });
  }
  return values.filter((entity) => (entity?.distance ?? Infinity) <= distance);
}

function withPlacementPoints(action, placement) {
  const centerTargetPoint = placement.centerTarget ? targetCenter(placement.centerTarget) : null;
  const areaType = String(action?.targetingProfile?.type ?? "").toLowerCase();
  return {
    ...placement,
    areaPlacementCenter: !["cone", "line"].includes(areaType)
      ? (placement.center ?? centerTargetPoint)
      : null,
    areaPlacementAimPoint: ["cone", "line"].includes(areaType)
      ? (placement.aimPoint ?? centerTargetPoint)
      : null,
  };
}

function emptyPlacement(action, enemies = [], allies = []) {
  return withPlacementPoints(action, {
    enemies,
    allies,
    centerTarget: null,
    center: null,
    aimPoint: null,
    score: enemies.length * BASE_ENEMY_VALUE - allies.length * ALLY_PENALTY,
    areaPlacementOptions: [],
  });
}

export function scoredAreaPlacement(action, context, { enemyValues = [], allyValues = [], maxCastRange = Infinity } = {}) {
  const type = String(action?.targetingProfile?.type ?? "area").toLowerCase();
  const distance = areaRegionDistance(action, null, 30);
  const origin = targetCenter(context?.token);

  if (["cone", "line"].includes(type) && origin) {
    const placements = directionalAreaPlacements(type, action, context, origin, enemyValues, allyValues, maxCastRange);
    return bestPlacementWithOptions(action, placements, enemyValues, allyValues) ?? emptyPlacement(action);
  }

  if (!["burst", "emanation"].includes(type)) {
    return origin
      ? emptyPlacement(action)
      : emptyPlacement(action, entitiesInArea(action, enemyValues), entitiesInArea(action, allyValues));
  }

  if (type === "emanation") {
    return origin
      ? emptyPlacement(
        action,
        entitiesInArea(action, enemyValues, origin),
        entitiesInArea(action, allyValues, origin),
      )
      : emptyPlacement(action, entitiesInArea(action, enemyValues), entitiesInArea(action, allyValues));
  }

  if (!origin) {
    return emptyPlacement(action, entitiesInArea(action, enemyValues), entitiesInArea(action, allyValues));
  }

  const placements = burstAreaPlacements(action, context, origin, enemyValues, allyValues, maxCastRange);
  return bestPlacementWithOptions(action, placements, enemyValues, allyValues)
    ?? emptyPlacement(action, entitiesInArea(action, enemyValues), entitiesInArea(action, allyValues));
}
