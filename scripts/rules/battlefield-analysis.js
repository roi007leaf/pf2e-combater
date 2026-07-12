import { canvasLinePathBlocked, gridReachDistanceFeet, numeric } from "./canvas-geometry.js";
import { movementPlacementForCenter } from "./token-geometry.js";
import { entityKey as targetKey } from "../foundry-data.js";

function point(value) {
  const center = value?.center ?? value?.token?.center;
  if (!center) return null;

  const x = numeric(center.x, NaN);
  const y = numeric(center.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function gridMetrics() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return {
    sceneDistance,
    pixelSize,
    pixelsPerFoot: pixelSize / sceneDistance,
  };
}

function conditionSlugs(entity) {
  const conditions = entity?.conditions;
  if (!conditions) return [];
  if (Array.isArray(conditions)) {
    return conditions.map((condition) => condition?.slug ?? condition).filter(Boolean);
  }
  return Array.isArray(conditions.slugs) ? conditions.slugs : [];
}

function detectionState(entity) {
  return String(entity?.visionerDetectionState ?? entity?.detectionState ?? entity?.visibility ?? "").toLowerCase();
}

function canUseKnownEnemy(entity, context) {
  if (context?.isGM === true) return true;
  const state = detectionState(entity);
  if (state === "undetected" || state === "unnoticed") return false;
  if (entity?.attackTargetable === false) return false;
  const slugs = conditionSlugs(entity);
  return !slugs.includes("undetected") && !slugs.includes("unnoticed");
}

function enemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? context?.targets ?? context?.battlefield?.targets ?? [];
}

export function entityThreatReach(entity) {
  const reach = Number(
    entity?.threatReach
      ?? entity?.reach
      ?? entity?.meleeReach
      ?? entity?.profile?.reach
      ?? entity?.profile?.meleeReach,
  );
  return Number.isFinite(reach) && reach >= 0 ? reach : 5;
}

export function distanceFromCenterToEntity(context, center, entity) {
  const entityCenter = point(entity);
  if (!center || !entityCenter) return Infinity;

  const metrics = gridMetrics();
  const actorRect = movementPlacementForCenter(center, context?.token, metrics.pixelSize);
  const entityRect = movementPlacementForCenter(entityCenter, entity, metrics.pixelSize);
  return gridReachDistanceFeet(actorRect, entityRect, metrics);
}

export function threatsAtCenter(context, center) {
  if (!center) return [];

  return enemies(context)
    .filter((enemy) => canUseKnownEnemy(enemy, context))
    .filter((enemy) => {
      const enemyCenter = point(enemy);
      if (!enemyCenter || canvasLinePathBlocked(center, enemyCenter)) return false;
      return distanceFromCenterToEntity(context, center, enemy) <= entityThreatReach(enemy);
    });
}

export function lineThreatsAtCenter(context, center, { maxRange = 60 } = {}) {
  if (!center) return [];

  return enemies(context)
    .filter((enemy) => canUseKnownEnemy(enemy, context))
    .filter((enemy) => {
      const enemyCenter = point(enemy);
      if (!enemyCenter || canvasLinePathBlocked(center, enemyCenter)) return false;
      const distance = distanceFromCenterToEntity(context, center, enemy);
      return distance > entityThreatReach(enemy) && distance <= maxRange;
    });
}

// Deliberately not memoized: threat/line-of-sight detection reads live canvas wall geometry
// (canvasLinePathBlocked), which can change independently of the context object -- caching on
// context identity alone would go stale if walls move between calls with the same context.
export function battlefieldPressure(context) {
  const actorCenter = point(context?.token);
  const meleeThreats = threatsAtCenter(context, actorCenter);
  const lineThreatValues = lineThreatsAtCenter(context, actorCenter);
  const nearestEnemy = enemies(context)
    .filter((enemy) => canUseKnownEnemy(enemy, context))
    .toSorted((left, right) =>
      distanceFromCenterToEntity(context, actorCenter, left)
        - distanceFromCenterToEntity(context, actorCenter, right),
    )[0] ?? null;

  return {
    actorCenter,
    meleeThreats,
    meleeThreatKeys: new Set(meleeThreats.map(targetKey).filter(Boolean)),
    lineThreats: lineThreatValues,
    nearestEnemy,
    inMeleeThreat: meleeThreats.length > 0,
    hasOpenEnemyLine: lineThreatValues.length > 0,
  };
}

export function threatCountAtCenter(context, center) {
  return threatsAtCenter(context, center).length;
}

export function compareTacticalCenters(context, left, right, { target = null, preferFartherFromTarget = false } = {}) {
  const leftThreats = threatCountAtCenter(context, left);
  const rightThreats = threatCountAtCenter(context, right);
  if (leftThreats !== rightThreats) return leftThreats - rightThreats;

  const leftCost = numeric(left?.cost, Infinity);
  const rightCost = numeric(right?.cost, Infinity);
  if (leftCost !== rightCost) return leftCost - rightCost;

  if (target) {
    const leftDistance = distanceFromCenterToEntity(context, left, target);
    const rightDistance = distanceFromCenterToEntity(context, right, target);
    if (leftDistance !== rightDistance) {
      return preferFartherFromTarget ? rightDistance - leftDistance : leftDistance - rightDistance;
    }
  }

  return 0;
}
