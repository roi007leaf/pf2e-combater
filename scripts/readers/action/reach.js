import { entityKey as targetKey } from "../../foundry-data.js";
import { movementFootprintForToken, movementPlacementForCenter, reachableMovementCenters as engineReachableMovementCenters } from "../../engine/movement-route.js";
import {
  canvasAttackPathBlocked,
  canvasMovementPathBlocked,
  canvasTokenById,
  canReachPlacementPerimeter,
  gridReachDistanceFeet,
  hasAttackCollisionLayer,
  hasMovementCollisionLayer,
} from "../../rules/canvas-geometry.js";
import { footprintPathDistanceFeet } from "../../rules/token-geometry.js";
import { compareTacticalCenters } from "../../rules/battlefield-analysis.js";

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function actionCanReach(action, target) {
  if (!target) return false;
  const max = Number(action?.range?.max ?? action?.targetingProfile?.maxRange ?? action?.range?.increment);
  return Number.isFinite(max) && max >= 0 && (target.distance ?? Infinity) <= max;
}

export function readyStrikeCanReach(strikes, target) {
  return strikes.some((strike) => strike?.available !== false && actionCanReach(strike, target));
}

export function centerPoint(value) {
  const center = value?.center ?? value?.token?.center;
  if (!center) return null;

  const x = numeric(center.x, NaN);
  const y = numeric(center.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function movementGridMetrics() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return {
    sceneDistance,
    pixelSize,
    pixelsPerFoot: pixelSize / sceneDistance,
  };
}

const COLLISION_CACHE_LIMIT = 50000;
const movementCollisionCache = new Map();
const attackCollisionCache = new Map();

export function clearMovementCollisionCache() {
  movementCollisionCache.clear();
  attackCollisionCache.clear();
}

let lastCollisionCanvas;
let lastCollisionFingerprint;
function syncCollisionCacheForScene() {
  const canvas = globalThis.canvas;
  const fingerprint = `${canvas?.scene?.id ?? ""}|${(canvas?.walls?.placeables ?? []).length}`;
  if (canvas !== lastCollisionCanvas || fingerprint !== lastCollisionFingerprint) {
    clearMovementCollisionCache();
    lastCollisionCanvas = canvas;
    lastCollisionFingerprint = fingerprint;
  }
}

function segmentKey(from, to) {
  return `${from.x},${from.y}>${to.x},${to.y}`;
}

function computeMovementPathBlocked(from, to, token) {
  return canvasMovementPathBlocked(from, to, { collisionToken: token });
}

function movementPathBlocked(from, to, token = null) {
  const key = `${token?.id ?? token?.document?.id ?? ""}|${segmentKey(from, to)}`;
  const cached = movementCollisionCache.get(key);
  if (cached !== undefined) return cached;
  const blocked = computeMovementPathBlocked(from, to, token);
  if (movementCollisionCache.size < COLLISION_CACHE_LIMIT) movementCollisionCache.set(key, blocked);
  return blocked;
}

function attackPathBlocked(from, to) {
  const key = segmentKey(from, to);
  const cached = attackCollisionCache.get(key);
  if (cached !== undefined) return cached;
  const blocked = canvasAttackPathBlocked(from, to);
  if (attackCollisionCache.size < COLLISION_CACHE_LIMIT) attackCollisionCache.set(key, blocked);
  return blocked;
}

export function tokenPlacementForCenter(center, value, metrics) {
  return movementPlacementForCenter(center, value, metrics.pixelSize);
}

function movementPointKey(point) {
  return `${point.x},${point.y}`;
}

const reachableCentersCache = new Map();

export function movementReachableCenters(origin, distanceFeet, metrics, token = null, context = null, options = {}) {
  const cacheKey = [
    movementPointKey(origin),
    distanceFeet,
    token?.id ?? token?.document?.id ?? "",
    targetKey(options.allowedOverlapTarget) ?? "",
    (globalThis.canvas?.scene?.regions?.size ?? globalThis.canvas?.regions?.placeables?.length ?? 0),
  ].join("|");
  const cached = reachableCentersCache.get(cacheKey);
  if (cached) return cached;

  const seen = new Set();
  const centers = [];
  for (const center of engineReachableMovementCenters(origin, distanceFeet, {
    actor: token?.actor ?? null,
    collisionToken: token,
    context,
    allowedOverlapTarget: options.allowedOverlapTarget ?? null,
    gridDistance: metrics.sceneDistance,
    gridSize: metrics.pixelSize,
    pathBlocked: (from, to) => movementPathBlocked(from, to, token),
  })) {
    const key = movementPointKey(center);
    if (seen.has(key)) continue;
    seen.add(key);
    centers.push({
      x: center.x,
      y: center.y,
      ...(Number.isFinite(Number(center.cost)) ? { cost: Number(center.cost) } : {}),
      ...(Array.isArray(center.route) ? { route: center.route } : {}),
    });
  }
  reachableCentersCache.set(cacheKey, centers);
  return centers;
}

const reachableAttackCentersCache = new Map();

export function reachableAttackCenters(context, target, distanceFeet, reachFeet) {
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return [];

  const cacheKey = `${movementPointKey(origin)}|${distanceFeet}|${reachFeet}|${targetKey(target) ?? movementPointKey(targetCenter)}`;
  const cached = reachableAttackCentersCache.get(cacheKey);
  if (cached) return cached;

  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const metrics = movementGridMetrics();
  const attackerFootprint = movementFootprintForToken(context?.token);
  const targetRectangle = tokenPlacementForCenter(targetCenter, target, metrics);
  // gridReachDistanceFeet is a Chebyshev-style edge-gap-plus-one-grid-unit approximation -- it
  // agrees with PF2e's real distance rule for a direct-adjacency or purely-orthogonal check, but
  // confirmed live against Foundry's own engine (canvas.grid.measurePath), a diagonal one-square
  // gap prices at 15 ft under the real 5-10-5 alternating-diagonal rule, not the 10 ft the
  // approximation reports -- so it could accept an attackCenter that only *looks* in reach.
  // footprintPathDistanceFeet uses the real, footprint-aware measurePath distance instead.
  const result = movementReachableCenters(origin, distanceFeet, metrics, collisionToken, context, {
    allowedOverlapTarget: Number(reachFeet) === 0 ? target : null,
  })
    .filter((center) => {
      const attackerRectangle = tokenPlacementForCenter(center, attackerFootprint, metrics);
      const distance = footprintPathDistanceFeet(center, attackerFootprint, targetCenter, target, metrics.pixelSize);
      return Number.isFinite(distance) && distance <= reachFeet
        && canReachPlacementPerimeter(attackerRectangle, targetRectangle, metrics.pixelSize, { pathBlocked: attackPathBlocked });
    });
  reachableAttackCentersCache.set(cacheKey, result);
  return result;
}

export function canMoveIntoReach(context, target, distanceFeet, reachFeet) {
  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return true;
  if (!hasMovementCollisionLayer(collisionToken)) return true;
  return reachableAttackCenters(context, target, distanceFeet, reachFeet).length > 0;
}

export function bestReachableAttackCenter(context, target, distanceFeet, reachFeet, options = {}) {
  return reachableAttackCenters(context, target, distanceFeet, reachFeet)
    .toSorted((left, right) =>
      compareTacticalCenters(context, left, right, {
        target,
        preferFartherFromTarget: options.preferFartherFromTarget === true,
      }),
    )[0] ?? null;
}

export function canReturnToOrigin(context, fromCenter, distanceFeet) {
  const origin = centerPoint(context?.token);
  if (!origin || !fromCenter) return false;

  const collisionToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const metrics = movementGridMetrics();
  const originKey = movementPointKey(origin);
  return movementReachableCenters(fromCenter, distanceFeet, metrics, collisionToken, context)
    .some((center) => movementPointKey(center) === originKey);
}

export function distanceFromCenterToTarget(context, center, target) {
  const targetCenter = centerPoint(target);
  if (!center || !targetCenter) return Infinity;

  const metrics = movementGridMetrics();
  const attackerRectangle = tokenPlacementForCenter(center, context?.token, metrics);
  const targetRectangle = tokenPlacementForCenter(targetCenter, target, metrics);
  return gridReachDistanceFeet(attackerRectangle, targetRectangle, metrics);
}

export function targetThreatReach(target) {
  const reach = Number(target?.reach ?? target?.meleeReach ?? target?.profile?.reach ?? target?.profile?.meleeReach);
  return Number.isFinite(reach) && reach >= 0 ? reach : 5;
}

export function allyThreatensTarget(ally, target, metrics) {
  const allyCenter = centerPoint(ally);
  const targetCenter = centerPoint(target);
  if (!allyCenter || !targetCenter) return false;
  const allyRectangle = tokenPlacementForCenter(allyCenter, ally, metrics);
  const targetRectangle = tokenPlacementForCenter(targetCenter, target, metrics);
  return gridReachDistanceFeet(allyRectangle, targetRectangle, metrics) <= targetThreatReach(ally);
}

export function canStrikeTargetFromCurrentPosition(context, action, target) {
  const origin = centerPoint(context?.token);
  const targetCenter = centerPoint(target);
  if (!origin || !targetCenter) return true;
  if (!hasAttackCollisionLayer()) return true;

  const metrics = movementGridMetrics();
  const attackerRectangle = tokenPlacementForCenter(origin, context?.token, metrics);
  const targetRectangle = tokenPlacementForCenter(targetCenter, target, metrics);
  const range = Number(action?.range?.max ?? action?.range?.increment ?? action?.targetingProfile?.maxRange);
  const distance = footprintPathDistanceFeet(origin, context?.token, targetCenter, target, metrics.pixelSize);
  if (Number.isFinite(range) && range >= 0 && (!Number.isFinite(distance) || distance > range)) {
    return false;
  }

  return canReachPlacementPerimeter(attackerRectangle, targetRectangle, metrics.pixelSize, { pathBlocked: attackPathBlocked });
}

export function clearActionReachBuildCache() {
  reachableCentersCache.clear();
  reachableAttackCentersCache.clear();
  syncCollisionCacheForScene();
}
