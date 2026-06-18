const MOVEMENT_SLUGS = new Set(["stride", "step", "stand-stride"]);
const MAX_REACHABLE_MARKERS = 48;
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

function tokenFootprint(value) {
  const token = value?.token ?? value ?? {};
  const document = token.document ?? token;
  return {
    widthCells: Math.max(1, numeric(token.width ?? document.width, 1) || 1),
    heightCells: Math.max(1, numeric(token.height ?? document.height, 1) || 1),
  };
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

function movementDistanceFeet(context, step) {
  if (step?.slug === "step") return 5;
  if (step?.slug === "stride" || step?.slug === "stand-stride") return profileSpeed(context);
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
  const bestCosts = new Map([[`${origin.x},${origin.y}`, 0]]);
  const queue = [{ center: origin, cost: 0, route: [] }];
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

        const stepCost = Math.max(Math.abs(dx), Math.abs(dy)) * gridSize;
        const cost = current.cost + stepCost;
        if (cost > distanceFeet) continue;

        const key = `${center.x},${center.y}`;
        if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
        bestCosts.set(key, cost);
        const routeCenter = { ...center, cost };
        const route = [...current.route, routeCenter];
        const reachableCenter = { ...routeCenter, route };
        centers.push(reachableCenter);
        queue.push({ center: routeCenter, cost, route });
      }
    }
  }

  return centers;
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function movementStepCost(from, to) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

function movementHeuristic(from, to) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
}

function routePriority(node, destination) {
  const heuristic = movementHeuristic(node.center, destination);
  const euclidean = Math.hypot(destination.x - node.center.x, destination.y - node.center.y);
  return node.cost + heuristic + euclidean * 0.001;
}

function directRouteToCenter(origin, destination, distanceFeet, gridSize, options = {}) {
  const cells = Math.floor(distanceFeet / gridSize);
  const maxOffset = cells * gridSize;
  const destinationKey = pointKey(destination);
  const bestCosts = new Map([[pointKey(origin), 0]]);
  const open = [{ center: origin, cost: 0, route: [] }];

  while (open.length) {
    open.sort((left, right) => routePriority(left, destination) - routePriority(right, destination));
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

        const cost = current.cost + movementStepCost(current.center, center);
        if (cost > distanceFeet) continue;

        const key = pointKey(center);
        if ((bestCosts.get(key) ?? Infinity) <= cost) continue;
        bestCosts.set(key, cost);
        const routeCenter = { ...center, cost };
        open.push({
          center: routeCenter,
          cost,
          route: [...current.route, routeCenter],
        });
      }
    }
  }

  return null;
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

// Distinct colour per Stride in a move-and-strike composite, so each leg of the
// path reads as its own move when hovering.
const STRIDE_COLORS = [0x5aa0e0, 0xe0b35a, 0x9b6dd6];

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
    color: STRIDE_COLORS[0],
  }, {
    index: 2,
    center: origin,
    trail: inboundRoute,
    placement: originPlacement,
    marker: xMarkerForPlacement(originPlacement),
    color: STRIDE_COLORS[1],
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
      color: STRIDE_COLORS[(index - 1) % STRIDE_COLORS.length],
    });
  }

  return { origin, strideCount, destinationCenter: destCenter, footprint, stridePath };
}

export function movementPreviewForStep(context, step, options = {}) {
  const gridSize = numeric(options.gridSize, 5) || 5;
  const movementOptions = {
    ...options,
    collisionToken: options.collisionToken ?? canvasTokenById(context?.token?.id ?? context?.token?.uuid),
  };

  if (isStrideStrikeStep(step)) {
    const path = step?.activityProfile?.retreatAfterStrike === true
      ? retreatStrideStrikePath(context, step, gridSize, movementOptions)
      : strideStrikePath(context, step, gridSize, movementOptions);
    return path ? { enabled: true, slug: step.slug, ...path } : { enabled: false };
  }

  if (!MOVEMENT_SLUGS.has(step?.slug)) return { enabled: false };

  const origin = point(context?.token);
  if (!origin) return { enabled: false };

  const distanceFeet = movementDistanceFeet(context, step);
  const footprint = tokenFootprint(context?.token);
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
    footprint,
    reachableCenters: centers,
    reachablePlacements: placements,
    reachableMarkers: markers,
    recommendedCenter: recommendation?.center ?? null,
    recommendedPlacement: recommendation,
    recommendedMarker,
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

  return {
    ...context,
    token: {
      ...(context?.token ?? {}),
      center: tokenCenter(activeToken) ?? context?.token?.center,
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
            center: tokenCenter(targetToken) ?? target?.token?.center,
            width: numeric(targetToken?.document?.width ?? targetToken?.width ?? target?.token?.width, 1) || 1,
            height: numeric(targetToken?.document?.height ?? targetToken?.height ?? target?.token?.height, 1) || 1,
          },
        }]
        : [],
    },
  };
}

function previewLayer() {
  return globalThis.canvas?.interface ?? globalThis.canvas?.controls ?? globalThis.canvas?.stage ?? null;
}

function previewGridSize() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return { sceneDistance, pixelSize };
}

function drawPlacement(graphics, placement, scale, fill, alpha, line, lineAlpha) {
  graphics.lineStyle(1, line, lineAlpha);
  graphics.beginFill(fill, alpha);
  graphics.drawRect(
    placement.x * scale,
    placement.y * scale,
    placement.width * scale,
    placement.height * scale,
  );
  graphics.endFill();
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

function drawStridePath(graphics, origin, stridePath, scale) {
  let from = origin;
  for (const waypoint of stridePath) {
    graphics.lineStyle(2, waypoint.color, 0.7);
    const trail = waypoint.trail?.length ? waypoint.trail : [waypoint.center];
    for (const point of trail) {
      graphics.moveTo(from.x * scale, from.y * scale);
      graphics.lineTo(point.x * scale, point.y * scale);
      from = point;
    }
    drawPlacement(graphics, waypoint.placement, scale, waypoint.color, 0.16, waypoint.color, 0.6);
    drawXMarker(graphics, waypoint.marker, scale, waypoint.color);
  }
}

export function clearMovementPreview() {
  if (!previewGraphics) return;
  previewGraphics.destroy?.({ children: true });
  previewGraphics.parent?.removeChild?.(previewGraphics);
  previewGraphics = null;
}

export function showMovementPreview(context, step) {
  clearMovementPreview();

  const PIXI = globalThis.PIXI;
  const layer = previewLayer();
  if (!PIXI?.Graphics || !layer?.addChild) return null;

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
  const sceneStep = step
    ? {
      ...step,
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
  if (!preview.enabled) return null;

  const graphics = new PIXI.Graphics();
  if (preview.stridePath) {
    drawStridePath(graphics, preview.origin, preview.stridePath, scale);
  } else {
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, 0x66c78f, 0.12, 0x66c78f, 0.32);
    }
    if (preview.recommendedPlacement) {
      drawPlacement(graphics, preview.recommendedPlacement, scale, 0xe0b35a, 0.34, 0xf0eee8, 0.9);
      drawXMarker(graphics, preview.recommendedMarker, scale);
    }
  }

  graphics.zIndex = 10_000;
  layer.sortableChildren = true;
  layer.addChild(graphics);
  previewGraphics = graphics;
  return preview;
}
