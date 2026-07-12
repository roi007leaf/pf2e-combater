import { collectionValues } from "../foundry-data.js";

export function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function canvasPoint(value) {
  const source = value?.center ?? value;
  const x = numeric(source?.x ?? source?.[0], NaN);
  const y = numeric(source?.y ?? source?.[1], NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function canvasGridSize() {
  return numeric(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size, 1) || 1;
}

export function canvasGridDistance() {
  return numeric(
    globalThis.canvas?.dimensions?.distance
      ?? globalThis.canvas?.scene?.grid?.distance
      ?? globalThis.canvas?.grid?.distance,
    5,
  ) || 5;
}

export function canvasDistancePixels(distance) {
  const pixelsPerUnit = numeric(globalThis.canvas?.dimensions?.distancePixels);
  if (pixelsPerUnit && pixelsPerUnit > 0) return distance * pixelsPerUnit;
  return (numeric(distance, 5) / canvasGridDistance()) * canvasGridSize();
}

export function canvasPixelsPerFoot() {
  return canvasDistancePixels(1);
}

export function contextTokenId(context) {
  return context?.token?.id
    ?? context?.token?.uuid
    ?? context?.combatant?.tokenId
    ?? context?.combatant?.token?.id
    ?? context?.combatant?.token?.uuid
    ?? null;
}

function canvasTokenCollection(tokens) {
  if (tokens == null || typeof tokens === "number") {
    return globalThis.canvas?.tokens?.placeables ?? globalThis.canvas?.tokens ?? [];
  }
  return tokens;
}

export function canvasTokenById(id, tokens = null) {
  if (!id) return null;
  return collectionValues(canvasTokenCollection(tokens)).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id
      || token?.uuid === id
      || document?.id === id
      || document?.uuid === id;
  }) ?? null;
}

export function scaledPoint(value, scale = 1) {
  return { x: numeric(value?.x) * scale, y: numeric(value?.y) * scale };
}

export function canvasRayForPoints(from, to) {
  // Ray moved to foundry.canvas.geometry.Ray in v13; prefer it so we don't hit the deprecated global.
  const Ray = globalThis.foundry?.canvas?.geometry?.Ray ?? globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
  return Ray ? new Ray(from, to) : { A: from, B: to };
}

function wallPlaceables(walls = globalThis.canvas?.walls) {
  if (Array.isArray(walls)) return walls;
  return walls?.placeables ?? [];
}

export function wallDocument(wall) {
  return wall?.document ?? wall ?? {};
}

export function doorTypeValue(document) {
  return document.door ?? document.doorType ?? document.type;
}

export function doorStateValue(document) {
  return document.ds ?? document.doorState ?? document.state;
}

export function wallBlocksMovement(wall) {
  const document = wallDocument(wall);
  const movement = document.move ?? document.movement;
  if (Number(movement) === 0) return false;

  const door = doorTypeValue(document);
  const state = doorStateValue(document);
  const hasDoor = Number(door) > 0
    || ["door", "secret"].includes(String(door ?? "").toLowerCase());
  if (hasDoor && (Number(state) === 1 || String(state ?? "").toLowerCase() === "open")) return false;
  return true;
}

export function wallBlocksLine(wall) {
  const document = wallDocument(wall);
  const sight = document.sight ?? document.vision;
  const movement = document.move ?? document.movement;
  if (Number(sight) === 0 && Number(movement) === 0) return false;

  const door = doorTypeValue(document);
  const state = doorStateValue(document);
  const hasDoor = Number(door) > 0
    || ["door", "secret"].includes(String(door ?? "").toLowerCase());
  if (hasDoor && (Number(state) === 1 || String(state ?? "").toLowerCase() === "open")) return false;
  return true;
}

export function isLockedDoorWall(wall) {
  const document = wallDocument(wall);
  const door = doorTypeValue(document);
  const state = doorStateValue(document);
  const hasDoor = Number(door) > 0
    || ["door", "secret"].includes(String(door ?? "").toLowerCase());
  return hasDoor && (
    Number(state) === 2
    || document.locked === true
    || String(state ?? "").toLowerCase() === "locked"
  );
}

export function wallEndpoints(wall) {
  const document = wallDocument(wall);
  const coords = document.c ?? document.coords;
  if (Array.isArray(coords) && coords.length >= 4) {
    return [{ x: Number(coords[0]), y: Number(coords[1]) }, { x: Number(coords[2]), y: Number(coords[3]) }];
  }
  if (wall?.A && wall?.B) return [wall.A, wall.B];
  if (document.A && document.B) return [document.A, document.B];
  return null;
}

export function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function orientation(start, end, point) {
  const value = (end.y - start.y) * (point.x - end.x) - (end.x - start.x) * (point.y - end.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

export function pointOnSegment(point, start, end) {
  return point.x <= Math.max(start.x, end.x) + 0.0001
    && point.x + 0.0001 >= Math.min(start.x, end.x)
    && point.y <= Math.max(start.y, end.y) + 0.0001
    && point.y + 0.0001 >= Math.min(start.y, end.y);
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

export function wallSegment(wall) {
  const endpoints = wallEndpoints(wall);
  if (!endpoints) return null;
  const [start, end] = endpoints;
  const values = [start.x, start.y, end.x, end.y].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [{ x: values[0], y: values[1] }, { x: values[2], y: values[3] }];
}

function wallSegmentsBlock(from, to, options = {}, predicate = wallBlocksMovement) {
  const walls = wallPlaceables(options.walls);
  if (!Array.isArray(walls) || !walls.length) return false;

  return walls.some((wall) => {
    if (!predicate(wall)) return false;
    const segment = wallSegment(wall);
    return segment ? segmentsIntersect(from, to, segment[0], segment[1]) : false;
  });
}

export function wallSegmentsBlockMovement(from, to, options = {}) {
  return wallSegmentsBlock(from, to, options, wallBlocksMovement);
}

export function wallSegmentsBlockLine(from, to, options = {}) {
  return wallSegmentsBlock(from, to, options, wallBlocksLine);
}

export function canvasWallCollisionBlocked(from, to, types, options = {}) {
  const walls = options.walls ?? globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") return false;
  if (Array.isArray(walls.placeables) && walls.placeables.length === 0) return false;

  const ray = canvasRayForPoints(from, to);
  for (const type of types) {
    try {
      if (walls.checkCollision(ray, { type, mode: "any" })) return true;
    } catch (_error) {
      // Foundry versions disagree on collision type names.
    }
  }
  return false;
}

export function canvasMovementPathBlocked(from, to, options = {}) {
  if (typeof options.pathBlocked === "function") return Boolean(options.pathBlocked(from, to));

  const scale = numeric(options.collisionScale, 1) || 1;
  const collisionFrom = scaledPoint(from, scale);
  const collisionTo = scaledPoint(to, scale);
  const token = options.collisionToken ?? options.token;

  if (typeof token?.checkCollision === "function") {
    try {
      if (token.checkCollision(collisionTo, { type: "move", mode: "any", origin: collisionFrom })) return true;
    } catch (_error) {
      // Fall through to wall-layer collision.
    }
  }

  return canvasWallCollisionBlocked(collisionFrom, collisionTo, ["move", "movement"], options)
    || wallSegmentsBlockMovement(collisionFrom, collisionTo, options);
}

export function canvasAttackPathBlocked(from, to, options = {}) {
  if (typeof options.attackPathBlocked === "function") return Boolean(options.attackPathBlocked(from, to));

  const scale = numeric(options.collisionScale, 1) || 1;
  const collisionFrom = scaledPoint(from, scale);
  const collisionTo = scaledPoint(to, scale);
  return canvasWallCollisionBlocked(collisionFrom, collisionTo, ["sight", "move", "movement"], options)
    || wallSegmentsBlockLine(collisionFrom, collisionTo, options);
}

export function canvasLinePathBlocked(from, to, options = {}) {
  const scale = numeric(options.collisionScale, 1) || 1;
  const collisionFrom = scaledPoint(from, scale);
  const collisionTo = scaledPoint(to, scale);
  return canvasWallCollisionBlocked(collisionFrom, collisionTo, ["sight", "move", "movement"], options)
    || wallSegmentsBlockLine(collisionFrom, collisionTo, options);
}

export function hasAttackCollisionLayer(options = {}) {
  const walls = options.walls ?? globalThis.canvas?.walls;
  return typeof walls?.checkCollision === "function"
    || wallPlaceables(walls).some?.(wallBlocksMovement) === true;
}

export function hasMovementCollisionLayer(token = null, options = {}) {
  const walls = options.walls ?? globalThis.canvas?.walls;
  return typeof walls?.checkCollision === "function"
    || typeof token?.checkCollision === "function"
    || wallPlaceables(walls).some?.(wallBlocksMovement) === true;
}

export function rectangleDistance(left, right) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.hypot(dx, dy);
}

export function rectangleDistanceFeet(left, right, metrics) {
  return rectangleDistance(left, right) / numeric(metrics?.pixelsPerFoot, 1);
}

export function gridReachDistance(left, right, gridSize) {
  const overlaps = left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
  if (overlaps) return 0;
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.max(dx, dy) + gridSize;
}

export function gridReachDistanceFeet(left, right, metrics) {
  return gridReachDistance(left, right, numeric(metrics?.pixelSize, 1)) / numeric(metrics?.pixelsPerFoot, 1);
}

export function perimeterSamplePoints(placement, gridSize) {
  if (!placement) return [];

  const size = numeric(gridSize, 1) || 1;
  const columns = Math.max(1, Math.round(placement.width / size));
  const rows = Math.max(1, Math.round(placement.height / size));
  const inset = size * 0.05;
  const points = [];

  for (let column = 0; column < columns; column += 1) {
    const x = placement.x + (column + 0.5) * size;
    points.push({ x, y: placement.y + inset });
    points.push({ x, y: placement.y + placement.height - inset });
  }

  for (let row = 0; row < rows; row += 1) {
    const y = placement.y + (row + 0.5) * size;
    points.push({ x: placement.x + inset, y });
    points.push({ x: placement.x + placement.width - inset, y });
  }

  return points;
}

export function nearestPoints(points, target, limit) {
  return points
    .toSorted((left, right) =>
      Math.hypot(left.x - target.x, left.y - target.y)
      - Math.hypot(right.x - target.x, right.y - target.y),
    )
    .slice(0, limit);
}

export function canReachPlacementPerimeter(placement, targetPlacement, gridSize, options = {}) {
  const pathBlocked = typeof options.pathBlocked === "function"
    ? options.pathBlocked
    : (from, to) => canvasAttackPathBlocked(from, to, options);
  if (pathBlocked(placement.center, targetPlacement.center)) return false;

  const originPoints = nearestPoints(
    [placement.center, ...perimeterSamplePoints(placement, gridSize)].filter(Boolean),
    targetPlacement.center,
    8,
  );
  const targetPoints = nearestPoints(
    perimeterSamplePoints(targetPlacement, gridSize),
    placement.center,
    16,
  );
  const targets = targetPoints.length ? targetPoints : [targetPlacement.center];

  return originPoints.some((origin) =>
    targets.some((target) => !pathBlocked(origin, target)),
  );
}
