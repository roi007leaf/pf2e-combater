import { previewLayer } from "./preview-layer.js";
import { pf2eMovementActionForStep, pf2eMovementSegmentCost } from "../rules/movement-cost.js";
import { t } from "../i18n.js";

const MOVEMENT_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);
// Purely a render-count safety net -- the expensive BFS has already run by the time this applies,
// so raising it costs nothing but a few more cheap PIXI rectangles. 48 (a ~3-square radius) silently
// truncated the highlighted area for any ordinary PF2e Speed above ~15ft -- e.g. a plain 20ft Speed
// already reaches ~128 cells, so a real Stride's own highlight was being clipped to less than its
// actual range. 500 comfortably covers even a hasted/boosted 40-50ft Speed without ever clipping.
const MAX_REACHABLE_MARKERS = 500;
let previewGraphics = null;

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  const center = value?.center ?? value?.token?.center;
  if (!center) return null;
  const x = numeric(center.x, NaN);
  const y = numeric(center.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function directPoint(value) {
  const x = numeric(value?.x, NaN);
  const y = numeric(value?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function tokenFootprint(value) {
  const token = value?.token ?? value ?? {};
  const document = token.document ?? token;
  // A real canvas Token placeable's own .width/.height can report its RENDERED PIXEL size (e.g.
  // scaled by a token ring or art-scale setting) rather than the grid-unit footprint PF2e
  // positioning math expects. TokenDocument#width/#height are always in grid units, so prefer
  // those -- same fix already applied to this bug's other occurrences (action-preview.js's
  // tokenPlacement, action-reader.js's tokenFootprintPixels, action-executor.js's tokenFootprint).
  return {
    widthCells: Math.max(1, numeric(document.width ?? token.width, 1) || 1),
    heightCells: Math.max(1, numeric(document.height ?? token.height, 1) || 1),
  };
}

function contextAllies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? [];
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

// Mirrors action-reader.js's centerOccupiedByOtherToken for the scoring engine's BFS
// (movementReachableCenters), but reuses this file's own {widthCells, heightCells} -> pixel-rect
// conversion (placementForCenter) instead of action-reader.js's tokenFootprintPixels convention.
function centerOccupiedByOtherToken(context, center, footprint, gridSize) {
  const candidatePlacement = placementForCenter(center, footprint, gridSize);
  const others = [...contextAllies(context), ...contextEnemies(context)];
  return others.some((other) => {
    const otherCenter = point(other);
    if (!otherCenter) return false;
    const otherPlacement = placementForCenter(otherCenter, tokenFootprint(other), gridSize);
    return rectanglesOverlap(candidatePlacement, otherPlacement);
  });
}

function targetIdentity(value) {
  return value?.id
    ?? value?.uuid
    ?? value?.token?.id
    ?? value?.token?.uuid
    ?? null;
}

function targetName(value) {
  return value?.name ?? value?.token?.name ?? null;
}

function matchingTarget(value, values) {
  const identity = targetIdentity(value);
  if (identity) {
    const target = values.find((entry) => targetIdentity(entry) === identity);
    if (target) return target;
  }

  const name = targetName(value);
  if (!name) return null;
  return values.find((entry) => targetName(entry) === name) ?? null;
}

function targetValues(context) {
  return [
    ...(context?.battlefield?.targets ?? []),
    ...(context?.targets ?? []),
    ...(context?.battlefield?.enemies ?? []),
    ...(context?.enemies ?? []),
  ].filter(Boolean);
}

function previewTarget(context, step) {
  const values = targetValues(context);
  if (step?.preferredTarget) {
    const matchedTarget = matchingTarget(step.preferredTarget, values);
    if (matchedTarget) return matchedTarget;
    if (!values.length) return step.preferredTarget;
  }

  const preferredId = step?.targetingProfile?.preferredTargetId;
  const preferredName = step?.targetingProfile?.preferredTargetName;
  if (preferredId) {
    const target = values.find((entry) => targetIdentity(entry) === preferredId);
    if (target) return target;
  }
  if (preferredName) {
    const target = values.find((entry) => targetName(entry) === preferredName);
    if (target) return target;
  }
  return context?.battlefield?.targets?.[0] ?? context?.targets?.[0] ?? values[0] ?? null;
}

function profileSpeed(context) {
  const profile = context?.actor?.profile ?? context?.profile ?? {};
  const speed = profile.speed?.value ?? profile.speed ?? profile.landSpeed;
  return numeric(speed, 25) || 25;
}

// The Speed (feet) the previewed Stride travels on. A non-walking movement type (fly/burrow/swim/
// climb) uses that creature speed; everything else falls back to the land Speed from the profile.
function movementSpeedFeet(context, step, collisionToken) {
  const movementAction = pf2eMovementActionForStep(step);
  if (movementAction && !["walk", "step", "crawl"].includes(movementAction)) {
    const speed = collisionToken?.actor?.system?.movement?.speeds?.[movementAction];
    const value = numeric(speed?.total ?? speed?.value ?? speed?.base, NaN);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return profileSpeed(context);
}

// Signed elevation change to the chosen destination (positive = climbing), or 0 when the step has
// no vertical target.
function verticalElevationDelta(step, collisionToken) {
  // The live pending elevation (what Shift+scroll is dialing in for the next point) wins so the
  // start-token readout tracks the wheel even while a waypoint path is already laid down; fall back
  // to the committed destination's elevation when there's no active pick (e.g. execution preview).
  const target = numeric(step?.plannedElevation ?? step?.destination?.elevation, NaN);
  if (!Number.isFinite(target)) return 0;
  const origin = numeric(collisionToken?.document?.elevation, 0) || 0;
  return target - origin;
}

// Feet of Speed consumed by climbing/descending to the chosen elevation (vertical Strides only).
function verticalMovementFeet(step, collisionToken) {
  return Math.abs(verticalElevationDelta(step, collisionToken));
}

function movementDistanceFeet(context, step, collisionToken) {
  if (step?.slug === "crawl" || step?.slug === "step") return 5;
  if (step?.slug === "stride" || step?.slug === "stand-stride") {
    // Vertical movement eats into the horizontal range: the higher you climb, the less Speed remains
    // to travel across the ground, so the reachable squares shrink accordingly.
    return Math.max(0, movementSpeedFeet(context, step, collisionToken) - verticalMovementFeet(step, collisionToken));
  }
  return 0;
}

function reachableCenters(origin, distanceFeet, gridSize) {
  const cells = Math.floor(distanceFeet / gridSize);
  const maxOffset = cells * gridSize;
  const centers = [];
  for (let dx = -cells; dx <= cells; dx += 1) {
    for (let dy = -cells; dy <= cells; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      centers.push({
        x: origin.x + dx * gridSize,
        y: origin.y + dy * gridSize,
        maxOffset,
      });
    }
  }
  return centers;
}

function scaledPoint(value, scale) {
  return {
    x: value.x * scale,
    y: value.y * scale,
  };
}

function rayForPoints(from, to) {
  // Ray moved to foundry.canvas.geometry.Ray in v13; prefer it so we don't hit the deprecated global.
  const Ray = globalThis.foundry?.canvas?.geometry?.Ray ?? globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
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

function wallBlocksMovement(wall) {
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

function pointOnSegment(point, start, end) {
  return point.x <= Math.max(start.x, end.x)
    && point.x >= Math.min(start.x, end.x)
    && point.y <= Math.max(start.y, end.y)
    && point.y >= Math.min(start.y, end.y);
}

function orientation(start, end, point) {
  const value = (end.y - start.y) * (point.x - end.x) - (end.x - start.x) * (point.y - end.y);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
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

function wallSegmentsBlockMovement(from, to, options = {}) {
  const walls = Array.isArray(options.walls)
    ? options.walls
    : (options.walls?.placeables ?? globalThis.canvas?.walls?.placeables ?? []);
  if (!Array.isArray(walls) || !walls.length) return false;

  return walls.some((wall) => {
    if (!wallBlocksMovement(wall)) return false;
    const segment = wallSegment(wall);
    return segment ? segmentsIntersect(from, to, segment[0], segment[1]) : false;
  });
}

function pathBlocked(from, to, options = {}) {
  if (typeof options.pathBlocked === "function") return Boolean(options.pathBlocked(from, to));

  const scale = numeric(options.collisionScale, 1) || 1;
  const collisionTo = scaledPoint(to, scale);
  const collisionFrom = scaledPoint(from, scale);
  const token = options.collisionToken;
  if (typeof token?.checkCollision === "function") {
    try {
      if (token.checkCollision(collisionTo, { type: "move", mode: "any", origin: collisionFrom })) return true;
    } catch (_error) {
      // Fall through to wall-layer collision.
    }
  }

  const walls = options.walls ?? globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") {
    return wallSegmentsBlockMovement(collisionFrom, collisionTo, options);
  }

  const ray = rayForPoints(collisionFrom, collisionTo);
  for (const type of ["move", "movement"]) {
    try {
      if (walls.checkCollision(ray, { type, mode: "any" })) return true;
    } catch (_error) {
      // Foundry versions disagree on movement collision type names.
    }
  }
  return wallSegmentsBlockMovement(collisionFrom, collisionTo, options);
}

function attackPathBlocked(from, to, options = {}) {
  if (typeof options.attackPathBlocked === "function") return Boolean(options.attackPathBlocked(from, to));

  const scale = numeric(options.collisionScale, 1) || 1;
  const collisionFrom = scaledPoint(from, scale);
  const collisionTo = scaledPoint(to, scale);
  const walls = options.walls ?? globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") {
    return wallSegmentsBlockMovement(collisionFrom, collisionTo, options);
  }

  const ray = rayForPoints(collisionFrom, collisionTo);
  for (const type of ["sight", "move", "movement"]) {
    try {
      if (walls.checkCollision(ray, { type, mode: "any" })) return true;
    } catch (_error) {
      // Foundry versions disagree on collision type names.
    }
  }
  return wallSegmentsBlockMovement(collisionFrom, collisionTo, options);
}

function pointVisible(point, options = {}) {
  if (globalThis.game?.user?.isGM === true) return true;
  if (typeof options.pointVisible === "function") return Boolean(options.pointVisible(point));

  const visibility = options.visibility
    ?? globalThis.canvas?.visibility
    ?? globalThis.canvas?.effects?.visibility;
  if (typeof visibility?.testVisibility !== "function") return true;

  const scale = numeric(options.collisionScale, 1) || 1;
  const scenePoint = scaledPoint(point, scale);
  try {
    return visibility.testVisibility(scenePoint, { tolerance: 0, object: options.collisionToken }) !== false;
  } catch (_error) {
    try {
      return visibility.testVisibility(scenePoint) !== false;
    } catch (_innerError) {
      return true;
    }
  }
}

function reachableMovementCenters(origin, distanceFeet, gridSize, options = {}) {
  const candidates = reachableCenters(origin, distanceFeet, gridSize);
  const maxOffset = candidates[0]?.maxOffset ?? 0;
  const bestCosts = new Map([[`${origin.x},${origin.y},0`, 0]]);
  const queue = [{ center: origin, cost: 0, route: [], diagonalCount: 0 }];
  const centers = [];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const center = {
          x: current.center.x + dx * gridSize,
          y: current.center.y + dy * gridSize,
        };
        if (Math.abs(center.x - origin.x) > maxOffset || Math.abs(center.y - origin.y) > maxOffset) continue;
        if (!pointVisible(center, options)) continue;
        if (pathBlocked(current.center, center, options)) continue;

        const movement = movementSegmentCost(current.center, center, gridSize, current.diagonalCount, options);
        const cost = current.cost + movement.cost;
        if (cost > distanceFeet) continue;

        const key = `${center.x},${center.y},${movement.diagonalCount % 2}`;
        if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
        bestCosts.set(key, cost);
        const routeCenter = { ...center, cost };
        const route = [...current.route, routeCenter];
        const reachableCenter = { ...routeCenter, route };
        centers.push(reachableCenter);
        queue.push({ center: routeCenter, cost, route, diagonalCount: movement.diagonalCount });
      }
    }
  }

  // Post-filter (applied once after the BFS completes, mirroring action-reader.js's
  // movementReachableCenters) rather than rejecting occupied squares mid-expansion: this only
  // excludes occupied squares from being offered as a landing destination, it does not stop a
  // route from passing through an occupied square to reach a square beyond it.
  if (!options.context) return centers;
  const footprint = tokenFootprint(options.collisionToken ?? options.context?.token);
  return centers.filter((center) => !centerOccupiedByOtherToken(options.context, center, footprint, gridSize));
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function movementSegmentCost(from, to, gridSize, startingDiagonalCount = 0, options = {}) {
  return pf2eMovementSegmentCost(from, to, {
    ...options,
    gridSize,
    gridDistance: gridSize,
    startingDiagonalCount,
  });
}

function movementStepCost(from, to, gridSize = 5, startingDiagonalCount = 0, options = {}) {
  return movementSegmentCost(from, to, gridSize, startingDiagonalCount, options).cost;
}

function movementHeuristic(from, to, gridSize = 5) {
  return movementSegmentCost(from, to, gridSize).cost;
}

function routePriority(node, destination, gridSize) {
  const heuristic = movementHeuristic(node.center, destination, gridSize);
  const euclidean = Math.hypot(destination.x - node.center.x, destination.y - node.center.y);
  return node.cost + heuristic + euclidean * 0.001;
}

function directRouteToCenter(origin, destination, distanceFeet, gridSize, options = {}) {
  const cells = Math.floor(distanceFeet / gridSize);
  const maxOffset = cells * gridSize;
  const destinationKey = pointKey(destination);
  const bestCosts = new Map([[`${pointKey(origin)},0`, 0]]);
  const open = [{ center: origin, cost: 0, route: [], diagonalCount: 0 }];

  while (open.length) {
    open.sort((left, right) => routePriority(left, destination, gridSize) - routePriority(right, destination, gridSize));
    const current = open.shift();
    if (pointKey(current.center) === destinationKey) return current.route;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const center = {
          x: current.center.x + dx * gridSize,
          y: current.center.y + dy * gridSize,
        };
        if (Math.abs(center.x - origin.x) > maxOffset || Math.abs(center.y - origin.y) > maxOffset) continue;
        if (!pointVisible(center, options)) continue;
        if (pathBlocked(current.center, center, options)) continue;

        const movement = movementSegmentCost(current.center, center, gridSize, current.diagonalCount, options);
        const cost = current.cost + movement.cost;
        if (cost > distanceFeet) continue;

        const key = `${pointKey(center)},${movement.diagonalCount % 2}`;
        if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
        bestCosts.set(key, cost);
        const routeCenter = { ...center, cost };
        open.push({
          center: routeCenter,
          cost,
          route: [...current.route, routeCenter],
          diagonalCount: movement.diagonalCount,
        });
      }
    }
  }

  return null;
}

function explicitDestination(step) {
  const x = numeric(step?.destination?.x, NaN);
  const y = numeric(step?.destination?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const elevation = numeric(step?.destination?.elevation, NaN);
  if (Number.isFinite(elevation)) return { x, y, elevation };
  return { x, y };
}

function explicitDestinationReason(origin, destination, distanceFeet, gridSize, options = {}) {
  if (!pointVisible(destination, options)) return t("Move.NotVisible", "Destination is not visible.");
  if (movementSegmentCost(origin, destination, gridSize, 0, options).cost > distanceFeet) {
    return t("Move.BeyondRangeDest", "Destination is beyond movement range.");
  }
  return t("Move.NoPath", "No collision-free movement path to destination.");
}

function placementForCenter(center, footprint, gridSize) {
  return {
    center,
    x: center.x - (footprint.widthCells * gridSize) / 2,
    y: center.y - (footprint.heightCells * gridSize) / 2,
    width: footprint.widthCells * gridSize,
    height: footprint.heightCells * gridSize,
  };
}

function markerForCenter(center, gridSize) {
  return placementForCenter(center, { widthCells: 1, heightCells: 1 }, gridSize);
}

function xMarkerForPlacement(placement) {
  if (!placement) return null;
  return {
    strokes: [{
      start: { x: placement.x, y: placement.y },
      end: { x: placement.x + placement.width, y: placement.y + placement.height },
    }, {
      start: { x: placement.x + placement.width, y: placement.y },
      end: { x: placement.x, y: placement.y + placement.height },
    }],
  };
}

function samePoint(left, right) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

// Keep each waypoint's own elevation alongside its x/y so the preview can label per-leg heights.
function directPointWithElevation(value) {
  const base = directPoint(value);
  if (!base) return null;
  const elevation = numeric(value?.elevation, NaN);
  return Number.isFinite(elevation) ? { ...base, elevation } : base;
}

function explicitWaypointCenters(step, destinationCenter) {
  const waypoints = Array.isArray(step?.movementPlan?.waypoints)
    ? step.movementPlan.waypoints.map((waypoint) => directPointWithElevation(waypoint)).filter(Boolean)
    : [];
  if (!waypoints.length) return null;
  if (destinationCenter && !samePoint(waypoints.at(-1), destinationCenter)) waypoints.push(destinationCenter);
  return waypoints;
}

function validateWaypointPath(origin, waypoints, distanceFeet, gridSize, options = {}) {
  let from = origin;
  let cost = 0;
  let diagonalCount = 0;
  for (const waypoint of waypoints) {
    if (!pointVisible(waypoint, options)) {
      return { available: false, reason: t("Move.NotVisible", "Destination is not visible."), cost };
    }
    if (pathBlocked(from, waypoint, options)) {
      return { available: false, reason: t("Move.NoPath", "No collision-free movement path to destination."), cost };
    }

    const movement = movementSegmentCost(from, waypoint, gridSize, diagonalCount, options);
    cost += movement.cost;
    diagonalCount = movement.diagonalCount;
    if (cost > distanceFeet) {
      return { available: false, reason: t("Move.BeyondRange", "Waypoint path is beyond movement range."), cost };
    }
    from = waypoint;
  }
  return { available: true, reason: "", cost };
}

function distanceLabelText(distance) {
  const rounded = Math.round(distance * 10) / 10;
  return t("Chip.RangeFt", "{range} ft", { range: Number.isInteger(rounded) ? rounded : rounded.toFixed(1) });
}

function waypointSegmentLabels(origin, waypoints, gridSize, options = {}) {
  const labels = [];
  let from = origin;
  let total = 0;
  let diagonalCount = 0;
  for (const to of waypoints) {
    const movement = movementSegmentCost(from, to, gridSize, diagonalCount, options);
    total += movement.cost;
    diagonalCount = movement.diagonalCount;
    labels.push({
      text: distanceLabelText(total),
      from,
      to,
      center: {
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
      },
    });
    from = to;
  }
  return labels;
}

function reachableMarkers(origin, centers, recommendation, gridSize) {
  const recommendedCenter = recommendation?.center ?? null;
  return centers
    .filter((center) => center.x !== recommendedCenter?.x || center.y !== recommendedCenter?.y)
    .toSorted((left, right) => {
      const leftDistance = Math.hypot(origin.x - left.x, origin.y - left.y);
      const rightDistance = Math.hypot(origin.x - right.x, origin.y - right.y);
      return leftDistance - rightDistance;
    })
    .slice(0, MAX_REACHABLE_MARKERS)
    .map((center) => markerForCenter(center, gridSize));
}

function rectangleDistance(left, right) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.hypot(dx, dy);
}

function gridReachDistance(left, right, gridSize) {
  const dx = Math.max(right.x - (left.x + left.width), left.x - (right.x + right.width), 0);
  const dy = Math.max(right.y - (left.y + left.height), left.y - (right.y + right.height), 0);
  return Math.max(dx, dy) + gridSize;
}

function perimeterSamplePoints(placement, gridSize) {
  if (!placement) return [];

  const columns = Math.max(1, Math.round(placement.width / gridSize));
  const rows = Math.max(1, Math.round(placement.height / gridSize));
  const inset = gridSize * 0.05;
  const points = [];

  for (let column = 0; column < columns; column += 1) {
    const x = placement.x + (column + 0.5) * gridSize;
    points.push({ x, y: placement.y + inset });
    points.push({ x, y: placement.y + placement.height - inset });
  }

  for (let row = 0; row < rows; row += 1) {
    const y = placement.y + (row + 0.5) * gridSize;
    points.push({ x: placement.x + inset, y });
    points.push({ x: placement.x + placement.width - inset, y });
  }

  return points;
}

function nearestPoints(points, target, limit) {
  return points
    .toSorted((left, right) =>
      Math.hypot(left.x - target.x, left.y - target.y)
      - Math.hypot(right.x - target.x, right.y - target.y),
    )
    .slice(0, limit);
}

function canReachTargetPerimeter(placement, targetPlacement, gridSize, options = {}) {
  if (attackPathBlocked(placement.center, targetPlacement.center, options)) return false;

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
    targets.some((target) => !attackPathBlocked(origin, target, options)),
  );
}

function recommendedPlacement(context, step, origin, reachable, footprint, gridSize, { preferShortestRoute = false } = {}) {
  const target = previewTarget(context, step);
  const targetCenter = point(target);
  if (!targetCenter || !reachable.length) return null;

  const targetPlacement = placementForCenter(targetCenter, tokenFootprint(target), gridSize);
  return reachable.map((center) => placementForCenter(center, footprint, gridSize)).toSorted((left, right) => {
    if (preferShortestRoute) {
      const leftCost = numeric(left.center.cost, Infinity);
      const rightCost = numeric(right.center.cost, Infinity);
      if (leftCost !== rightCost) return leftCost - rightCost;
    }
    const leftDistance = rectangleDistance(left, targetPlacement);
    const rightDistance = rectangleDistance(right, targetPlacement);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return Math.hypot(origin.x - left.center.x, origin.y - left.center.y)
      - Math.hypot(origin.x - right.center.x, origin.y - right.center.y);
  })[0] ?? null;
}

function strikeReach(step) {
  const reach = numeric(step?.activityProfile?.strikeReach ?? step?.range?.max, 5);
  return reach > 0 ? reach : 5;
}

function strikeReachableCenters(context, step, reachable, footprint, gridSize, options = {}) {
  const target = previewTarget(context, step);
  const targetCenter = point(target);
  if (!targetCenter) return reachable;

  const targetPlacement = placementForCenter(targetCenter, tokenFootprint(target), gridSize);
  const reach = strikeReach(step);
  return reachable.filter((center) => {
    const placement = placementForCenter(center, footprint, gridSize);
    return gridReachDistance(placement, targetPlacement, gridSize) <= reach
      && canReachTargetPerimeter(placement, targetPlacement, gridSize, options);
  });
}

const STRIDE_COLORS = [0x5aa0e0, 0xe0b35a, 0x9b6dd6];

function colorNumber(value) {
  if (Number.isFinite(Number(value))) {
    const numericColor = Number(value);
    return numericColor >= 0 && numericColor <= 0xffffff ? numericColor : null;
  }

  const text = String(value ?? "").trim();
  const match = text.match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split("").map((part) => `${part}${part}`).join("")
    : match[1];
  return Number.parseInt(hex, 16);
}

function movementColor(fallback = STRIDE_COLORS[0]) {
  return colorNumber(globalThis.game?.user?.color) ?? fallback;
}

function strideMovementColor(index) {
  return movementColor(STRIDE_COLORS[index % STRIDE_COLORS.length]);
}

function isStrideStrikeStep(step) {
  return step?.activityProfile?.includesStrike === true
    && Number(step?.activityProfile?.strideCount) >= 1;
}

function routeWaypoint(route, strideIndex, strideCount, speed, destination) {
  if (strideIndex === strideCount || !route?.length) return destination;

  const totalCost = numeric(route.at(-1)?.cost ?? destination?.cost, 0);
  const shortRoute = totalCost > 0 && totalCost <= speed;
  const budget = shortRoute
    ? (totalCost * strideIndex) / strideCount
    : speed * strideIndex;
  let waypoint = route[0];
  for (const point of route) {
    if ((point.cost ?? Infinity) > budget) break;
    waypoint = point;
  }
  return waypoint ?? destination;
}

function retreatStrideStrikePath(context, step, gridSize, options = {}) {
  const origin = point(context?.token);
  if (!origin) return null;

  const speed = profileSpeed(context);
  const footprint = tokenFootprint(context?.token);
  const outboundCenters = reachableMovementCenters(origin, speed, gridSize, options);
  const fixedAttackCenter = point({ center: step?.activityProfile?.attackCenter });
  const attackCenters = fixedAttackCenter
    ? [fixedAttackCenter]
    : strikeReachableCenters(context, step, outboundCenters, footprint, gridSize, options);
  const destination = fixedAttackCenter
    ? placementForCenter(fixedAttackCenter, footprint, gridSize)
    : recommendedPlacement(context, step, origin, attackCenters, footprint, gridSize, {
      preferShortestRoute: true,
    });
  if (!destination) return null;

  const attackCenter = destination.center;
  const outboundRoute = directRouteToCenter(origin, attackCenter, speed, gridSize, options)
    ?? attackCenter.route
    ?? [attackCenter];
  const inboundRoute = directRouteToCenter(attackCenter, origin, speed, gridSize, options);
  if (!inboundRoute?.length || pointKey(inboundRoute.at(-1)) !== pointKey(origin)) return null;

  const attackPlacement = placementForCenter(attackCenter, footprint, gridSize);
  const originPlacement = placementForCenter(origin, footprint, gridSize);
  const stridePath = [{
    index: 1,
    center: attackCenter,
    trail: outboundRoute,
    placement: attackPlacement,
    marker: xMarkerForPlacement(attackPlacement),
    color: strideMovementColor(0),
  }, {
    index: 2,
    center: origin,
    trail: inboundRoute,
    placement: originPlacement,
    marker: xMarkerForPlacement(originPlacement),
    color: strideMovementColor(1),
  }];

  return {
    origin,
    strideCount: 2,
    destinationCenter: attackCenter,
    retreatCenter: origin,
    footprint,
    stridePath,
  };
}

// Where each Stride lands on the way to the target, following the same
// stepwise route used for collision checks.
function strideStrikePath(context, step, gridSize, options = {}) {
  const origin = point(context?.token);
  if (!origin) return null;

  const strideCount = Math.max(1, Math.floor(Number(step?.activityProfile?.strideCount) || 1));
  const speed = profileSpeed(context);
  const footprint = tokenFootprint(context?.token);
  const movementCenters = reachableMovementCenters(origin, strideCount * speed, gridSize, options);
  const fixedAttackCenter = point({ center: step?.activityProfile?.attackCenter });
  const centers = fixedAttackCenter
    ? [fixedAttackCenter]
    : strikeReachableCenters(context, step, movementCenters, footprint, gridSize, options);
  const destination = fixedAttackCenter
    ? placementForCenter(fixedAttackCenter, footprint, gridSize)
    : recommendedPlacement(context, step, origin, centers, footprint, gridSize, { preferShortestRoute: true });
  if (!destination) return null;

  const destCenter = destination.center;
  const route = directRouteToCenter(origin, destCenter, strideCount * speed, gridSize, options)
    ?? destCenter.route
    ?? [];
  const stridePath = [];
  let previousRouteIndex = -1;
  for (let index = 1; index <= strideCount; index += 1) {
    const center = routeWaypoint(route, index, strideCount, speed, destCenter);
    const routeIndex = route.findIndex((point) => point.x === center.x && point.y === center.y);
    const trail = routeIndex >= 0 ? route.slice(previousRouteIndex + 1, routeIndex + 1) : [center];
    previousRouteIndex = Math.max(previousRouteIndex, routeIndex);
    const placement = placementForCenter(center, footprint, gridSize);
    stridePath.push({
      index,
      center,
      trail,
      placement,
      marker: xMarkerForPlacement(placement),
      color: strideMovementColor(index - 1),
    });
  }

  return { origin, strideCount, destinationCenter: destCenter, footprint, stridePath };
}

function explicitMovementPreview(context, step, origin, distanceFeet, footprint, gridSize, options = {}) {
  const destinationCenter = explicitDestination(step);
  if (!destinationCenter) return null;

  const color = movementColor();
  const destinationVisible = pointVisible(destinationCenter, options);
  const destinationPlacement = destinationVisible ? placementForCenter(destinationCenter, footprint, gridSize) : null;
  const destinationMarker = xMarkerForPlacement(destinationPlacement);
  const waypointCenters = explicitWaypointCenters(step, destinationCenter);
  if (waypointCenters?.length) {
    const waypointValidation = destinationVisible
      ? validateWaypointPath(origin, waypointCenters, distanceFeet, gridSize, options)
      : { available: false, reason: t("Move.NotVisible", "Destination is not visible.") };
    const destinationAvailable = destinationVisible && waypointValidation.available === true;
    // Execution only needs to know whether the destination is legal — skip the expensive flood-fill
    // of the remaining reachable area (and its markers/labels), which exists purely for the hover
    // overlay. Validating the waypoint path above is cheap; the BFS is what made executing a Stride lag.
    if (options.validateOnly) {
      return {
        enabled: true,
        slug: step.slug,
        explicitDestination: true,
        origin,
        distanceFeet,
        footprint,
        destinationCenter,
        destinationPlacement,
        destinationMarker,
        destinationAvailable,
        destinationIllegalReason: destinationAvailable ? "" : waypointValidation.reason,
        movementColor: color,
      };
    }
    const remainingDistanceFeet = destinationAvailable
      ? Math.max(0, distanceFeet - waypointValidation.cost)
      : 0;
    const waypointOrigin = waypointCenters.at(-1) ?? destinationCenter;
    const remainingCenters = destinationAvailable && remainingDistanceFeet > 0
      ? reachableMovementCenters(waypointOrigin, remainingDistanceFeet, gridSize, options)
      : [];
    const remainingPlacements = remainingCenters.map((center) => placementForCenter(center, footprint, gridSize));
    const remainingMarkers = reachableMarkers(waypointOrigin, remainingCenters, null, gridSize);
    const segmentLabels = waypointSegmentLabels(origin, waypointCenters, gridSize, options);
    return {
      enabled: true,
      slug: step.slug,
      explicitDestination: true,
      origin,
      distanceFeet,
      footprint,
      destinationCenter,
      destinationPlacement,
      destinationMarker,
      destinationAvailable,
      destinationIllegalReason: destinationAvailable ? "" : waypointValidation.reason,
      stridePath: destinationAvailable
        ? [{
          index: 1,
          center: destinationCenter,
          trail: waypointCenters,
          placement: destinationPlacement,
          marker: destinationMarker,
          waypoints: waypointCenters,
          segmentLabels,
          color,
        }]
        : [],
      reachableCenters: remainingCenters,
      reachablePlacements: remainingPlacements,
      reachableMarkers: remainingMarkers,
      reachableMarkerColor: color,
      recommendedCenter: destinationAvailable ? destinationCenter : null,
      recommendedPlacement: destinationAvailable ? destinationPlacement : null,
      recommendedMarker: destinationAvailable ? destinationMarker : null,
      movementColor: color,
      segmentLabels,
    };
  }

  // Execution: skip the A* path search and just check range + visibility — Foundry's move API is the
  // final collision arbiter (it reports "Movement was prevented" if a wall blocks the way).
  if (options.validateOnly) {
    const withinRange = movementSegmentCost(origin, destinationCenter, gridSize, 0, options).cost <= distanceFeet;
    const available = destinationVisible && withinRange;
    return {
      enabled: true,
      slug: step.slug,
      explicitDestination: true,
      origin,
      distanceFeet,
      footprint,
      destinationCenter,
      destinationPlacement,
      destinationMarker,
      destinationAvailable: available,
      destinationIllegalReason: available
        ? ""
        : (destinationVisible ? t("Move.BeyondRangeDest", "Destination is beyond movement range.") : t("Move.NotVisible", "Destination is not visible.")),
      movementColor: color,
    };
  }

  const route = destinationVisible
    ? directRouteToCenter(origin, destinationCenter, distanceFeet, gridSize, options)
    : null;
  const destinationAvailable = destinationVisible
    && Array.isArray(route)
    && (route.length > 0 || pointKey(origin) === pointKey(destinationCenter));
  const stridePath = destinationAvailable
    ? [{
      index: 1,
      center: destinationCenter,
      trail: route,
      placement: destinationPlacement,
      marker: destinationMarker,
      color,
    }]
    : [];

  return {
    enabled: true,
    slug: step.slug,
    explicitDestination: true,
    origin,
    distanceFeet,
    footprint,
    destinationCenter,
    destinationPlacement,
    destinationMarker,
    destinationAvailable,
    destinationIllegalReason: destinationAvailable
      ? ""
      : (destinationVisible
        ? explicitDestinationReason(origin, destinationCenter, distanceFeet, gridSize, options)
        : t("Move.NotVisible", "Destination is not visible.")),
    stridePath,
    reachableCenters: [],
    reachablePlacements: [],
    reachableMarkers: [],
    reachableMarkerColor: color,
    recommendedCenter: destinationAvailable ? destinationCenter : null,
    recommendedPlacement: destinationAvailable ? destinationPlacement : null,
    recommendedMarker: destinationAvailable ? destinationMarker : null,
    movementColor: color,
  };
}

function teleportRangeFeet(step) {
  return numeric(
    step?.targetingProfile?.maxRange ?? step?.maxRange ?? step?.range?.max ?? step?.action?.targetingProfile?.maxRange,
    NaN,
  );
}

// A teleport (e.g. Translocate) reaches any space within the spell's range, ignoring terrain and the
// movement path. Rather than a filled grid (a 120-ft range covers hundreds of squares — too many to
// draw, and the per-square cap made it look far shorter than it is), the preview is a range ring
// marking the boundary plus the chosen destination.
function teleportPreview(step, origin, footprint, gridSize, options = {}) {
  const color = movementColor();
  const range = teleportRangeFeet(step);
  const hasRange = Number.isFinite(range) && range > 0;
  const inRange = (center) => !hasRange
    || movementSegmentCost(origin, center, gridSize, 0, options).cost <= range;

  const destinationCenter = explicitDestination(step);
  const destinationVisible = destinationCenter ? pointVisible(destinationCenter, options) : false;
  const destinationPlacement = destinationCenter && destinationVisible
    ? placementForCenter(destinationCenter, footprint, gridSize)
    : null;
  const destinationAvailable = destinationCenter ? destinationVisible && inRange(destinationCenter) : null;

  return {
    enabled: true,
    slug: step.slug,
    teleport: true,
    teleportRange: hasRange ? range : null,
    explicitDestination: Boolean(destinationCenter),
    origin,
    footprint,
    distanceFeet: hasRange ? range : 0,
    destinationCenter: destinationCenter ?? null,
    destinationPlacement,
    destinationMarker: xMarkerForPlacement(destinationPlacement),
    destinationAvailable,
    destinationIllegalReason: destinationAvailable === false
      ? (destinationVisible ? t("Move.BeyondSpellRange", "Destination is beyond the spell's range.") : t("Move.NotVisible", "Destination is not visible."))
      : "",
    reachableCenters: [],
    reachableMarkers: [],
    reachableMarkerColor: color,
    movementColor: color,
  };
}

export function movementPreviewForStep(context, step, options = {}) {
  const gridSize = numeric(options.gridSize, 5) || 5;
  const movementOptions = {
    ...options,
    actor: options.actor ?? context?.actor ?? context?.token?.actor,
    movementAction: options.movementAction ?? pf2eMovementActionForStep(step),
    collisionToken: options.collisionToken ?? canvasTokenById(context?.token?.id ?? context?.token?.uuid),
    context: options.context ?? context,
  };

  // A teleport picks a destination like a Stride but reaches by range, not a path — show its own
  // range-bounded preview rather than the (empty) stride preview for its non-movement slug.
  if (step?.activityProfile?.teleport === true || step?.action?.activityProfile?.teleport === true) {
    const teleportOrigin = point(context?.token);
    if (!teleportOrigin) return { enabled: false };
    return teleportPreview(step, teleportOrigin, tokenFootprint(context?.token), gridSize, movementOptions);
  }

  if (isStrideStrikeStep(step)) {
    const path = step?.activityProfile?.retreatAfterStrike === true
      ? retreatStrideStrikePath(context, step, gridSize, movementOptions)
      : strideStrikePath(context, step, gridSize, movementOptions);
    return path ? { enabled: true, slug: step.slug, ...path } : { enabled: false };
  }

  if (!MOVEMENT_SLUGS.has(step?.slug)) return { enabled: false };

  const origin = point(context?.token);
  if (!origin) return { enabled: false };

  const collisionToken = movementOptions.collisionToken;
  const distanceFeet = movementDistanceFeet(context, step, collisionToken);
  const elevationDelta = verticalElevationDelta(step, collisionToken);
  const originElevation = numeric(collisionToken?.document?.elevation, 0) || 0;
  const footprint = tokenFootprint(context?.token);
  const explicitPreview = explicitMovementPreview(context, step, origin, distanceFeet, footprint, gridSize, movementOptions);
  if (explicitPreview) return { ...explicitPreview, elevationDelta, originElevation };

  const color = movementColor();
  const centers = reachableMovementCenters(origin, distanceFeet, gridSize, movementOptions);
  const placements = centers.map((center) => placementForCenter(center, footprint, gridSize));
  const recommendation = recommendedPlacement(context, step, origin, centers, footprint, gridSize);
  const markers = reachableMarkers(origin, centers, recommendation, gridSize);
  const recommendedMarker = xMarkerForPlacement(recommendation);
  return {
    enabled: true,
    slug: step.slug,
    origin,
    distanceFeet,
    elevationDelta,
    originElevation,
    footprint,
    reachableCenters: centers,
    reachablePlacements: placements,
    reachableMarkers: markers,
    reachableMarkerColor: color,
    recommendedCenter: recommendation?.center ?? null,
    recommendedPlacement: recommendation,
    recommendedMarker,
    movementColor: color,
  };
}

function canvasTokenById(id) {
  if (!id) return null;
  return (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id || document?.id === id || document?.uuid === id;
  }) ?? null;
}

function tokenCenter(token) {
  if (!token) return null;
  if (token.center) return { x: token.center.x, y: token.center.y };
  const document = token.document ?? token;
  const size = globalThis.canvas?.grid?.size ?? 1;
  return {
    x: numeric(document.x ?? token.x, 0) + (numeric(document.width, 1) * size) / 2,
    y: numeric(document.y ?? token.y, 0) + (numeric(document.height, 1) * size) / 2,
  };
}

function canvasContext(context, step) {
  const activeToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const target = previewTarget(context, step);
  const targetToken = canvasTokenById(target?.token?.id ?? target?.token?.uuid ?? target?.id);
  const plannedCenter = directPoint(context?.token?.plannedCenter);
  const contextCenter = directPoint(context?.token?.center);
  const targetContextCenter = directPoint(target?.token?.center);

  return {
    ...context,
    token: {
      ...(context?.token ?? {}),
      center: plannedCenter ?? contextCenter ?? tokenCenter(activeToken) ?? context?.token?.center,
      width: numeric(activeToken?.document?.width ?? activeToken?.width ?? context?.token?.width, 1) || 1,
      height: numeric(activeToken?.document?.height ?? activeToken?.height ?? context?.token?.height, 1) || 1,
    },
    battlefield: {
      ...(context?.battlefield ?? {}),
      targets: target
        ? [{
          ...target,
          token: {
            ...(target.token ?? {}),
            center: targetContextCenter ?? tokenCenter(targetToken) ?? target?.token?.center,
            width: numeric(targetToken?.document?.width ?? targetToken?.width ?? target?.token?.width, 1) || 1,
            height: numeric(targetToken?.document?.height ?? targetToken?.height ?? target?.token?.height, 1) || 1,
          },
        }]
        : [],
    },
  };
}

function previewGridSize() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return { sceneDistance, pixelSize };
}

function drawPlacement(graphics, placement, scale, fill, alpha, line, lineAlpha, lineWidth = 2) {
  const x = placement.x * scale;
  const y = placement.y * scale;
  const width = placement.width * scale;
  const height = placement.height * scale;

  graphics.lineStyle(0, line, 0);
  graphics.beginFill(fill, alpha);
  graphics.drawRect(
    x,
    y,
    width,
    height,
  );
  graphics.endFill();

  graphics.lineStyle(lineWidth + 2, 0x101418, Math.min(0.9, lineAlpha + 0.2));
  graphics.drawRect(x, y, width, height);
  graphics.lineStyle(lineWidth, line, lineAlpha);
  graphics.drawRect(x, y, width, height);
}

function drawXMarker(graphics, marker, scale, color = 0xf0eee8) {
  if (!marker?.strokes?.length) return;

  graphics.lineStyle(4, 0x101418, 0.82);
  for (const stroke of marker.strokes) {
    graphics.moveTo(stroke.start.x * scale, stroke.start.y * scale);
    graphics.lineTo(stroke.end.x * scale, stroke.end.y * scale);
  }

  graphics.lineStyle(2, color, 0.95);
  for (const stroke of marker.strokes) {
    graphics.moveTo(stroke.start.x * scale, stroke.start.y * scale);
    graphics.lineTo(stroke.end.x * scale, stroke.end.y * scale);
  }
}

// Ring marking where the Stride begins, sized to the actor's footprint (like the destination X), so
// the overlay reads as "from here to there". `scale` is px-per-foot; pixelSize is px-per-cell.
function drawOriginMarker(graphics, origin, footprint, scale, color = 0x66c78f) {
  if (!origin || typeof graphics.drawCircle !== "function") return;
  const { pixelSize } = previewGridSize();
  const cells = Math.max(1, Math.min(footprint?.widthCells ?? 1, footprint?.heightCells ?? 1));
  const radius = (cells * pixelSize) / 2;
  const x = origin.x * scale;
  const y = origin.y * scale;
  graphics.beginFill(0x101418, 0.12);
  graphics.lineStyle(4, 0x101418, 0.82);
  graphics.drawCircle(x, y, radius);
  graphics.lineStyle(2, color, 0.95);
  graphics.drawCircle(x, y, radius);
  graphics.endFill();
}

// Label text for a point sitting at `elevation` (absolute feet) — the elevation itself, marked ▲/▼
// for above/below the start. Returns null when the point is at the start elevation (unchanged), so
// only points whose height actually changed get tagged.
function elevationLabelText(elevation, originElevation) {
  const origin = numeric(originElevation, 0) || 0;
  const value = numeric(elevation, NaN);
  if (!Number.isFinite(value) || value === origin) return null;
  return value > origin
    ? t("Move.ElevationUp", "▲ {feet} ft", { feet: value })
    : t("Move.ElevationDown", "▼ {feet} ft", { feet: value });
}

function elevationLabelStyle(elevation, originElevation, fontSize) {
  const above = (numeric(elevation, 0) || 0) > (numeric(originElevation, 0) || 0);
  return {
    fontFamily: "Signika, sans-serif",
    fontSize,
    fontWeight: "700",
    fill: above ? "#8fd0f0" : "#f0b88f",
    stroke: "#101418",
    strokeThickness: Math.max(3, Math.round(fontSize * 0.24)),
  };
}

// Floating readout above the point being placed, showing the elevation it will sit at (the value
// itself, not the increment) so the player sees where the vertical Stride lands as they scroll.
function drawElevationLabel(graphics, anchor, elevation, originElevation, footprint, scale) {
  if (!anchor || typeof graphics.addChild !== "function") return;
  const text = elevationLabelText(elevation, originElevation);
  if (!text) return;
  const fontSize = Math.round(Math.max(16, Math.min(28, scale * 0.9)));
  const label = createTextLabel(text, elevationLabelStyle(elevation, originElevation, fontSize));
  if (!label) return;
  const { pixelSize } = previewGridSize();
  const cells = Math.max(1, Math.min(footprint?.widthCells ?? 1, footprint?.heightCells ?? 1));
  const offset = (cells * pixelSize) / 2 + fontSize;
  setLabelPosition(label, anchor.x * scale, anchor.y * scale - offset);
  graphics.addChild(label);
}

function drawWaypointIndicators(graphics, waypoints, scale, color) {
  if (typeof graphics.drawCircle !== "function" || !Array.isArray(waypoints)) return;
  let index = 0;
  for (const waypoint of waypoints) {
    index += 1;
    const radius = index === waypoints.length ? 10 : 8;
    graphics.lineStyle(radius + 4, 0x101418, 0.86);
    graphics.drawCircle(waypoint.x * scale, waypoint.y * scale, radius);
    graphics.lineStyle(radius, color, 0.96);
    graphics.drawCircle(waypoint.x * scale, waypoint.y * scale, radius);
  }
}

// A small readout beside each waypoint that sits at a changed elevation, showing the elevation it
// rests at (the value itself) so a path that climbs, levels off, then dives is legible per leg.
function drawWaypointElevationLabels(graphics, waypoints, originElevation, scale) {
  if (typeof graphics.addChild !== "function" || !Array.isArray(waypoints)) return;
  const fontSize = Math.round(Math.max(13, Math.min(22, scale * 0.7)));
  for (const waypoint of waypoints) {
    const text = elevationLabelText(waypoint?.elevation, originElevation);
    if (!text) continue;
    const label = createTextLabel(text, elevationLabelStyle(waypoint.elevation, originElevation, fontSize));
    if (!label) continue;
    setLabelPosition(label, waypoint.x * scale, waypoint.y * scale - (fontSize + 12));
    graphics.addChild(label);
  }
}

function createTextLabel(text, style) {
  const Text = globalThis.PIXI?.Text;
  if (!Text) return null;
  try {
    return new Text(text, style);
  } catch (_error) {
    return new Text({ text, style });
  }
}

function setLabelPosition(label, x, y) {
  label.anchor?.set?.(0.5, 0.5);
  label.alpha = 0.92;
  label.roundPixels = true;
  if (typeof label.position?.set === "function") label.position.set(x, y);
  else {
    label.x = x;
    label.y = y;
  }
}

function drawSegmentLabels(graphics, labels, scale) {
  if (typeof graphics.addChild !== "function" || !Array.isArray(labels)) return;
  const fontSize = Math.round(Math.max(16, Math.min(28, scale * 0.9)));
  const style = {
    fontFamily: "Signika, sans-serif",
    fontSize,
    fontWeight: "700",
    fill: "#f0eee8",
    stroke: "#101418",
    strokeThickness: Math.max(3, Math.round(fontSize * 0.24)),
  };
  for (const label of labels) {
    const text = createTextLabel(label.text, style);
    if (!text) continue;
    setLabelPosition(text, label.center.x * scale, label.center.y * scale - 10);
    graphics.addChild(text);
  }
}

function drawStridePath(graphics, origin, stridePath, scale, originElevation = 0) {
  let from = origin;
  for (const waypoint of stridePath) {
    const trail = waypoint.trail?.length ? waypoint.trail : [waypoint.center];
    // Dark outline first so the thicker stride line stays legible over busy maps.
    let outlineFrom = from;
    graphics.lineStyle(8, 0x101418, 0.7);
    for (const point of trail) {
      graphics.moveTo(outlineFrom.x * scale, outlineFrom.y * scale);
      graphics.lineTo(point.x * scale, point.y * scale);
      outlineFrom = point;
    }
    graphics.lineStyle(5, waypoint.color, 0.9);
    for (const point of trail) {
      graphics.moveTo(from.x * scale, from.y * scale);
      graphics.lineTo(point.x * scale, point.y * scale);
      from = point;
    }
    drawPlacement(graphics, waypoint.placement, scale, waypoint.color, 0.05, waypoint.color, 0.96, 3);
    drawXMarker(graphics, waypoint.marker, scale, waypoint.color);
    drawWaypointIndicators(graphics, waypoint.waypoints, scale, waypoint.color);
    // Label intermediate waypoints with their own heights; the final point (destination) is labelled
    // by the live readout above, so drop it here to avoid a doubled tag.
    drawWaypointElevationLabels(graphics, waypoint.waypoints?.slice(0, -1), originElevation, scale);
    drawSegmentLabels(graphics, waypoint.segmentLabels, scale);
  }
}

export function clearMovementPreview() {
  if (!previewGraphics) return;
  const graphics = previewGraphics;
  previewGraphics = null;
  graphics.parent?.removeChild?.(graphics);
  graphics.destroy?.({ children: true });
}

function computeMovementPreview(context, step) {
  const { sceneDistance, pixelSize } = previewGridSize();
  const scale = pixelSize / sceneDistance;
  const rawContext = canvasContext(context, step);
  const toScene = (center) => center
    ? ({
      ...center,
      x: center.x / scale,
      y: center.y / scale,
      ...(Array.isArray(center.route) ? { route: center.route.map((point) => toScene(point)) } : {}),
    })
    : null;
  const toSceneToken = (token) => token
    ? ({ ...token, center: toScene(token.center) })
    : token;
  const toSceneMovementPlan = (movementPlan) => movementPlan
    ? {
      ...movementPlan,
      ...(Array.isArray(movementPlan.waypoints)
        ? { waypoints: movementPlan.waypoints.map((waypoint) => toScene(waypoint)).filter(Boolean) }
        : {}),
      ...(movementPlan.origin ? { origin: toScene(movementPlan.origin) } : {}),
      ...(movementPlan.destination ? { destination: toScene(movementPlan.destination) } : {}),
    }
    : movementPlan;
  const sceneStep = step
    ? {
      ...step,
      ...(step.destination ? { destination: toScene(step.destination) } : {}),
      ...(step.movementPlan ? { movementPlan: toSceneMovementPlan(step.movementPlan) } : {}),
      preferredTarget: step.preferredTarget
        ? { ...step.preferredTarget, token: toSceneToken(step.preferredTarget.token) }
        : step.preferredTarget,
      activityProfile: step.activityProfile
        ? {
          ...step.activityProfile,
          ...(step.activityProfile.attackCenter ? { attackCenter: toScene(step.activityProfile.attackCenter) } : {}),
          ...(step.activityProfile.retreatCenter ? { retreatCenter: toScene(step.activityProfile.retreatCenter) } : {}),
        }
        : step.activityProfile,
    }
    : step;
  const sceneContext = {
    ...rawContext,
    token: {
      ...(rawContext.token ?? {}),
      center: toScene(rawContext.token?.center),
      width: rawContext.token?.width,
      height: rawContext.token?.height,
    },
    battlefield: {
      ...(rawContext.battlefield ?? {}),
      targets: (rawContext.battlefield?.targets ?? []).map((target) => ({
        ...target,
        token: {
          ...(target.token ?? {}),
          center: toScene(target.token?.center),
          width: target.token?.width,
          height: target.token?.height,
        },
      })),
    },
  };
  const preview = movementPreviewForStep(sceneContext, sceneStep, { gridSize: sceneDistance, collisionScale: scale });
  return { preview, scale };
}

// Corner points of a stepwise route (origin-exclusive, destination-inclusive) given in scene
// coords, returned in pixel coords. Only points where the step direction changes are kept, so
// a straight route yields none and only genuinely bent routes need waypoints.
export function routeCornerWaypoints(origin, route, scale = 1) {
  if (!origin || !Array.isArray(route) || route.length < 2) return [];
  const points = [origin, ...route];
  const corners = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (Math.sign(current.x - prev.x) !== Math.sign(next.x - current.x)
      || Math.sign(current.y - prev.y) !== Math.sign(next.y - current.y)) {
      corners.push({ x: current.x * scale, y: current.y * scale });
    }
  }
  return corners;
}

// Real routed cost/path (canvas pixel coords) to a SPECIFIC candidate destination, using the same
// obstacle- and terrain-avoiding BFS that drives the reachable-area overlay -- so a square the
// overlay highlights as reachable is never rejected by a caller's own naive straight-line cost
// estimate, which ignores a cheaper detour (e.g. around difficult terrain) the BFS actually found.
// Returns null when the point isn't one of the BFS's own reachable landing squares (genuinely out
// of range, blocked, or occupied) -- callers should fall back to their own validation in that case.
export function movementRouteToPoint(context, step, destinationPoint) {
  if (!destinationPoint) return null;
  // Force the base "reachable area" branch regardless of any destination already on the step --
  // this answers "can the BFS route to THIS point", not "validate the step's existing destination".
  const queryStep = { ...(step ?? {}), destination: undefined, movementPlan: undefined };
  const { preview, scale } = computeMovementPreview(context, queryStep);
  if (!preview?.enabled || !preview.origin || !Array.isArray(preview.reachableCenters)) return null;

  const sceneDestination = { x: destinationPoint.x / scale, y: destinationPoint.y / scale };
  const epsilon = 0.01;
  const match = preview.reachableCenters.find((center) =>
    Math.abs(center.x - sceneDestination.x) < epsilon && Math.abs(center.y - sceneDestination.y) < epsilon);
  if (!match) return null;

  const waypoints = routeCornerWaypoints(preview.origin, match.route, scale);
  return {
    cost: numeric(match.cost, 0),
    destination: { x: match.x * scale, y: match.y * scale },
    ...(waypoints.length ? { waypoints } : {}),
  };
}

// Recommended landing (and corner waypoints, when the route bends) for a movement step, in
// canvas pixel coords. Reuses the hover-preview computation so coordinate handling lives in
// one place. Returns null when there is no recommendation.
export function recommendedMovementForStep(context, step) {
  const { preview, scale } = computeMovementPreview(context, step);
  if (!preview?.enabled) return null;
  const recommended = preview.recommendedCenter ?? preview.destinationCenter ?? null;
  if (!recommended) return null;
  const destination = { x: recommended.x * scale, y: recommended.y * scale };
  const waypoints = routeCornerWaypoints(preview.origin, recommended.route, scale);
  return { destination, ...(waypoints.length ? { waypoints } : {}) };
}

export function showMovementPreview(context, step) {
  clearMovementPreview();

  const PIXI = globalThis.PIXI;
  const layer = previewLayer();
  if (!PIXI?.Graphics || !layer?.addChild) return null;

  const { preview, scale } = computeMovementPreview(context, step);
  if (!preview.enabled) return null;

  const graphics = new PIXI.Graphics();
  if (preview.teleport) {
    // Range ring marking how far the teleport reaches, plus the chosen destination X (red if out of range).
    const ringColor = preview.movementColor ?? 0x66c78f;
    if (Number.isFinite(preview.teleportRange) && preview.teleportRange > 0 && typeof graphics.drawCircle === "function") {
      const cx = preview.origin.x * scale;
      const cy = preview.origin.y * scale;
      const radius = preview.teleportRange * scale;
      graphics.beginFill(ringColor, 0.04);
      graphics.lineStyle(6, 0x101418, 0.6);
      graphics.drawCircle(cx, cy, radius);
      graphics.lineStyle(3, ringColor, 0.9);
      graphics.drawCircle(cx, cy, radius);
      graphics.endFill();
    }
    if (preview.destinationPlacement) {
      const color = preview.destinationAvailable === false ? 0xc94f4f : (preview.movementColor ?? 0xe0b35a);
      drawPlacement(graphics, preview.destinationPlacement, scale, color, 0.06, color, 1, 3);
      drawXMarker(graphics, preview.destinationMarker, scale, color);
    }
  } else if (preview.stridePath?.length) {
    drawStridePath(graphics, preview.origin, preview.stridePath, scale, preview.originElevation);
    const markerColor = preview.reachableMarkerColor ?? preview.movementColor ?? 0x66c78f;
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, markerColor, 0.025, markerColor, 0.88, 2);
    }
  } else if (preview.explicitDestination && preview.destinationPlacement) {
    const color = preview.destinationAvailable ? (preview.movementColor ?? 0xe0b35a) : 0xc94f4f;
    drawPlacement(graphics, preview.destinationPlacement, scale, color, 0.06, color, 1, 3);
    drawXMarker(graphics, preview.destinationMarker, scale, color);
  } else {
    // Show only the reachable squares — no recommended-destination X. The X read as a
    // selection even though the player hadn't chosen a destination yet.
    const markerColor = preview.reachableMarkerColor ?? preview.movementColor ?? 0x66c78f;
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, markerColor, 0.025, markerColor, 0.88, 2);
    }
  }

  // Circle the Stride's starting square so it's clear where the movement begins.
  drawOriginMarker(graphics, preview.origin, preview.footprint, scale, preview.movementColor ?? 0x66c78f);
  // Pin the live readout to the point being placed (destination), showing the elevation it lands at.
  const pendingElevation = Number.isFinite(preview.elevationDelta)
    ? (Number(preview.originElevation) || 0) + preview.elevationDelta
    : NaN;
  drawElevationLabel(graphics, preview.destinationCenter ?? preview.origin, pendingElevation, preview.originElevation, preview.footprint, scale);

  graphics.zIndex = 10_000;
  layer.sortableChildren = true;
  layer.addChild(graphics);
  previewGraphics = graphics;
  return preview;
}
