function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

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

function footprint(value, metrics) {
  const token = value?.token ?? value ?? {};
  const document = token.document ?? token;
  return {
    width: Math.max(1, numeric(token.width ?? document.width, 1) || 1) * metrics.pixelSize,
    height: Math.max(1, numeric(token.height ?? document.height, 1) || 1) * metrics.pixelSize,
  };
}

function rectangleForCenter(center, size) {
  return {
    center,
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function gridReachDistance(left, right, metrics) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return (Math.max(dx, dy) + metrics.pixelSize) / metrics.pixelsPerFoot;
}

function rayForPoints(from, to) {
  const Ray = globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
  return Ray ? new Ray(from, to) : { A: from, B: to };
}

function wallDocument(wall) {
  return wall?.document ?? wall ?? {};
}

function doorTypeValue(document) {
  return document.door ?? document.doorType ?? document.type;
}

function doorStateValue(document) {
  return document.ds ?? document.doorState ?? document.state;
}

function wallBlocksLine(wall) {
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

function wallEndpoints(wall) {
  const document = wallDocument(wall);
  const coords = document.c ?? document.coords;
  if (Array.isArray(coords) && coords.length >= 4) {
    return [{ x: Number(coords[0]), y: Number(coords[1]) }, { x: Number(coords[2]), y: Number(coords[3]) }];
  }
  if (wall?.A && wall?.B) return [wall.A, wall.B];
  if (document.A && document.B) return [document.A, document.B];
  return null;
}

function pointOnSegment(value, start, end) {
  return value.x <= Math.max(start.x, end.x)
    && value.x >= Math.min(start.x, end.x)
    && value.y <= Math.max(start.y, end.y)
    && value.y >= Math.min(start.y, end.y);
}

function orientation(start, end, value) {
  const determinant = (end.y - start.y) * (value.x - end.x) - (end.x - start.x) * (value.y - end.y);
  if (Math.abs(determinant) < 0.0001) return 0;
  return determinant > 0 ? 1 : 2;
}

function segmentsIntersect(a, b, c, d) {
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

function wallSegment(wall) {
  const endpoints = wallEndpoints(wall);
  if (!endpoints) return null;
  const [start, end] = endpoints;
  const values = [start.x, start.y, end.x, end.y].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [{ x: values[0], y: values[1] }, { x: values[2], y: values[3] }];
}

function wallSegmentsBlockLine(from, to) {
  const walls = globalThis.canvas?.walls?.placeables ?? [];
  if (!Array.isArray(walls) || !walls.length) return false;

  return walls.some((wall) => {
    if (!wallBlocksLine(wall)) return false;
    const segment = wallSegment(wall);
    return segment ? segmentsIntersect(from, to, segment[0], segment[1]) : false;
  });
}

function pathBlocked(from, to) {
  const walls = globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") return wallSegmentsBlockLine(from, to);

  const ray = rayForPoints(from, to);
  for (const type of ["sight", "move", "movement"]) {
    try {
      if (walls.checkCollision(ray, { type, mode: "any" })) return true;
    } catch (_error) {
      // Foundry versions disagree on collision type names.
    }
  }
  return wallSegmentsBlockLine(from, to);
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
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

export function distanceFromCenterToEntity(context, center, entity) {
  const entityCenter = point(entity);
  if (!center || !entityCenter) return Infinity;

  const metrics = gridMetrics();
  const actorRect = rectangleForCenter(center, footprint(context?.token, metrics));
  const entityRect = rectangleForCenter(entityCenter, footprint(entity, metrics));
  return gridReachDistance(actorRect, entityRect, metrics);
}

export function threatsAtCenter(context, center) {
  if (!center) return [];

  return enemies(context)
    .filter((enemy) => canUseKnownEnemy(enemy, context))
    .filter((enemy) => {
      const enemyCenter = point(enemy);
      if (!enemyCenter || pathBlocked(center, enemyCenter)) return false;
      return distanceFromCenterToEntity(context, center, enemy) <= entityThreatReach(enemy);
    });
}

export function lineThreatsAtCenter(context, center, { maxRange = 60 } = {}) {
  if (!center) return [];

  return enemies(context)
    .filter((enemy) => canUseKnownEnemy(enemy, context))
    .filter((enemy) => {
      const enemyCenter = point(enemy);
      if (!enemyCenter || pathBlocked(center, enemyCenter)) return false;
      const distance = distanceFromCenterToEntity(context, center, enemy);
      return distance > entityThreatReach(enemy) && distance <= maxRange;
    });
}

function targetKey(entity) {
  return String(entity?.id ?? entity?.uuid ?? entity?.token?.id ?? entity?.token?.uuid ?? entity?.name ?? "");
}

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
