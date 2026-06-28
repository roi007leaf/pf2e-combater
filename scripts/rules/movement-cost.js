function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampDifficulty(value) {
  return Math.max(1, Math.min(3, Math.trunc(numeric(value, 1)) || 1));
}

function collectionValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (Array.isArray(value.placeables)) return value.placeables;
  if (typeof value.values === "function") return Array.from(value.values());
  if (typeof value === "object") return Object.values(value).filter(Boolean);
  return [];
}

function toObject(value) {
  if (typeof value?.toObject === "function") {
    try {
      return value.toObject(false);
    } catch (_error) {
      try {
        return value.toObject();
      } catch (_innerError) {
        return value;
      }
    }
  }
  return value;
}

function movementActionSlug(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function pf2eMovementActionForSlug(slug) {
  const value = movementActionSlug(slug);
  if (value === "crawl") return "crawl";
  if (value === "step") return "step";
  return "walk";
}

export function pf2eMovementActionForStep(step) {
  const requested = movementActionSlug(step?.movementAction ?? step?.action?.movementAction);
  return requested || pf2eMovementActionForSlug(step?.slug ?? step?.action?.slug);
}

function behaviorDisabled(behavior) {
  return behavior?.disabled === true
    || behavior?.document?.disabled === true
    || behavior?.active === false
    || behavior?.document?.active === false;
}

function behaviorSystem(behavior) {
  return behavior?.system
    ?? behavior?.document?.system
    ?? behavior?._source?.system
    ?? toObject(behavior)?.system
    ?? {};
}

function pf2eBehaviorDifficulty(behavior, movementAction) {
  if (behaviorDisabled(behavior)) return 1;
  const type = String(behavior?.type ?? behavior?.document?.type ?? toObject(behavior)?.type ?? "");
  if (type !== "modifyMovementCost") return 1;

  const system = behaviorSystem(behavior);
  const difficulties = system?.difficulties ?? behavior?.difficulties ?? {};
  if (!difficulties || typeof difficulties !== "object") return 1;
  return clampDifficulty(difficulties[movementAction] ?? 1);
}

function regionBehaviors(region) {
  const document = region?.document ?? region;
  return collectionValues(region?.behaviors ?? document?.behaviors);
}

function regionShapes(region) {
  const document = region?.document ?? region;
  return collectionValues(region?.shapes ?? document?.shapes).map(toObject).filter(Boolean);
}

function scaledPoint(point, scale = 1) {
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function nativeRegionContainsPoint(region, point) {
  const subjects = [region, region?.document, region?.object].filter(Boolean);
  for (const subject of subjects) {
    if (typeof subject.testPoint === "function") {
      try {
        return subject.testPoint(point) === true;
      } catch (_error) {
        // Fall through to other region APIs.
      }
    }
    if (typeof subject.containsPoint === "function") {
      try {
        return subject.containsPoint(point) === true;
      } catch (_error) {
        // Fall through to other region APIs.
      }
    }
    if (typeof subject.polygonTree?.testPoint === "function") {
      try {
        return subject.polygonTree.testPoint(point, 0.75) === true;
      } catch (_error) {
        // Fall through to shape fallback.
      }
    }
  }
  return null;
}

function rectangleContains(shape, point) {
  const width = numeric(shape.width, 0);
  const height = numeric(shape.height, 0);
  const anchorX = numeric(shape.anchorX, 0);
  const anchorY = numeric(shape.anchorY, 0);
  const x = numeric(shape.x, 0) - width * anchorX;
  const y = numeric(shape.y, 0) - height * anchorY;
  return point.x >= x
    && point.x <= x + width
    && point.y >= y
    && point.y <= y + height;
}

function circleContains(shape, point) {
  const radius = numeric(shape.radius ?? shape.distance, 0);
  const x = numeric(shape.x, 0);
  const y = numeric(shape.y, 0);
  return Math.hypot(point.x - x, point.y - y) <= radius;
}

function polygonPoints(shape) {
  const points = shape.points ?? shape.vertices ?? [];
  if (!Array.isArray(points)) return [];
  if (points.every((entry) => typeof entry === "number")) {
    const pairs = [];
    for (let index = 0; index < points.length - 1; index += 2) {
      pairs.push({ x: numeric(points[index], 0), y: numeric(points[index + 1], 0) });
    }
    return pairs;
  }
  return points
    .map((entry) => ({ x: numeric(entry?.x, NaN), y: numeric(entry?.y, NaN) }))
    .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
}

function polygonContains(shape, point) {
  const points = polygonPoints(shape);
  if (points.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const last = points[previous];
    const intersects = ((current.y > point.y) !== (last.y > point.y))
      && point.x < ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function shapeContainsPoint(shape, point) {
  const type = String(shape?.type ?? "").toLowerCase();
  if (type === "rectangle") return rectangleContains(shape, point);
  if (["circle", "ellipse", "emanation", "ring"].includes(type)) return circleContains(shape, point);
  if (type === "polygon") return polygonContains(shape, point);
  return false;
}

function fallbackRegionContainsPoint(region, point) {
  let contains = false;
  for (const shape of regionShapes(region)) {
    if (!shapeContainsPoint(shape, point)) continue;
    contains = shape.hole === true ? false : true;
  }
  return contains;
}

function regionContainsPoint(region, point, options = {}) {
  const scale = numeric(options.collisionScale, 1) || 1;
  const scenePoint = {
    ...scaledPoint(point, scale),
    elevation: numeric(options.elevation ?? options.collisionToken?.document?.elevation, 0),
  };
  const nativeResult = nativeRegionContainsPoint(region, scenePoint);
  return nativeResult ?? fallbackRegionContainsPoint(region, scenePoint);
}

function terrainRegions(options = {}) {
  return collectionValues(
    options.regions
      ?? options.scene?.regions
      ?? globalThis.canvas?.scene?.regions
      ?? globalThis.canvas?.regions?.placeables
      ?? globalThis.canvas?.regions,
  );
}

export function pf2eTerrainDifficultyAt(point, options = {}) {
  if (typeof options.terrainDifficultyAt === "function") {
    return clampDifficulty(options.terrainDifficultyAt(point, options));
  }

  const movementAction = movementActionSlug(options.movementAction) || "walk";
  let difficulty = 1;
  for (const region of terrainRegions(options)) {
    if (!regionContainsPoint(region, point, options)) continue;
    for (const behavior of regionBehaviors(region)) {
      difficulty = Math.max(difficulty, pf2eBehaviorDifficulty(behavior, movementAction));
    }
  }
  return difficulty;
}

function ignoresAllTerrain(entries) {
  return collectionValues(entries).some((entry) =>
    entry === "all"
    || (entry?.environment === "all" && entry?.feature === "all"));
}

function terrainMitigationMultiplier(actor, difficulty) {
  const movementTerrain = actor?.system?.movement?.terrain;
  if (!movementTerrain) return 1;

  const ignoreAllDifficult = ignoresAllTerrain(movementTerrain.difficult?.ignored);
  if (difficulty === 3) {
    if (ignoresAllTerrain(movementTerrain.greater?.ignored)) return 0;
    return ignoreAllDifficult ? 0.5 : 1;
  }
  return ignoreAllDifficult ? 0 : 1;
}

function pf2eTerrainExtraCost(difficulty, gridDistance, actor) {
  if (difficulty <= 1) return 0;
  return (difficulty - 1) * gridDistance * terrainMitigationMultiplier(actor, difficulty);
}

// Per-diagonal cost multiplier for the SCENE's configured diagonal rule, so our reachability matches
// Foundry's own ruler. Mismatches here (e.g. assuming 5-10-5 on a Euclidean scene) let the BFS pick
// squares the ruler measures as beyond Speed — the "stride goes further than Speed" bug. Defaults to
// PF2e's 5-10-5 (ALTERNATING_1) when the rule is unknown (headless/tests).
function diagonalStepMultiplier(diagonalCount) {
  const diagonals = globalThis.CONST?.GRID_DIAGONALS;
  const rule = globalThis.canvas?.grid?.diagonals;
  if (diagonals) {
    if (rule === diagonals.EQUIDISTANT) return 1;
    if (rule === diagonals.RECTILINEAR) return 2;
    if (rule === diagonals.EXACT || rule === diagonals.APPROXIMATE) return Math.SQRT2;
    if (rule === diagonals.ALTERNATING_2) return diagonalCount % 2 === 1 ? 2 : 1;
  }
  // ALTERNATING_1 (PF2e 5-10-5) and fallback.
  return diagonalCount % 2 === 1 ? 1 : 2;
}

function movementStepCost(from, to, options = {}) {
  const gridDistance = numeric(options.gridDistance ?? options.gridSize, 5) || 5;
  let diagonalCount = numeric(options.startingDiagonalCount, 0) || 0;
  const isDiagonal = from.x !== to.x && from.y !== to.y;
  let cost = gridDistance;

  if (isDiagonal) {
    diagonalCount += 1;
    cost = gridDistance * diagonalStepMultiplier(diagonalCount);
  }

  const difficulty = pf2eTerrainDifficultyAt(to, options);
  const actor = options.actor ?? options.token?.actor ?? options.collisionToken?.actor ?? null;
  cost += pf2eTerrainExtraCost(difficulty, gridDistance, actor);
  return { cost, diagonalCount };
}

export function pf2eMovementSegmentCost(from, to, options = {}) {
  if (!from || !to) return { cost: 0, diagonalCount: numeric(options.startingDiagonalCount, 0) || 0 };
  const gridSize = numeric(options.gridSize, 5) || 5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const xSteps = Math.round(Math.abs(dx) / gridSize);
  const ySteps = Math.round(Math.abs(dy) / gridSize);
  const diagonalSteps = Math.min(xSteps, ySteps);
  const straightSteps = Math.abs(xSteps - ySteps);
  const signX = Math.sign(dx);
  const signY = Math.sign(dy);
  let diagonalCount = numeric(options.startingDiagonalCount, 0) || 0;
  let cost = 0;
  let current = { x: from.x, y: from.y };

  for (let index = 0; index < diagonalSteps; index += 1) {
    const next = { x: current.x + signX * gridSize, y: current.y + signY * gridSize };
    const movement = movementStepCost(current, next, { ...options, startingDiagonalCount: diagonalCount });
    cost += movement.cost;
    diagonalCount = movement.diagonalCount;
    current = next;
  }

  const straightAxis = xSteps > ySteps ? "x" : "y";
  const straightSign = straightAxis === "x" ? signX : signY;
  for (let index = 0; index < straightSteps; index += 1) {
    const next = {
      x: current.x + (straightAxis === "x" ? straightSign * gridSize : 0),
      y: current.y + (straightAxis === "y" ? straightSign * gridSize : 0),
    };
    const movement = movementStepCost(current, next, { ...options, startingDiagonalCount: diagonalCount });
    cost += movement.cost;
    diagonalCount = movement.diagonalCount;
    current = next;
  }

  return { cost, diagonalCount };
}

export function pf2eWaypointPathCost(origin, waypoints, options = {}) {
  let cost = 0;
  let from = origin;
  let diagonalCount = 0;
  for (const waypoint of waypoints) {
    const movement = pf2eMovementSegmentCost(from, waypoint, { ...options, startingDiagonalCount: diagonalCount });
    cost += movement.cost;
    diagonalCount = movement.diagonalCount;
    from = waypoint;
  }
  return { cost, diagonalCount };
}
