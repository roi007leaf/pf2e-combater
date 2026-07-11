import { pf2eMovementActionForStep, pf2eMovementSegmentCost } from "../rules/movement-cost.js";
import { movementFootprintForToken, movementPlacementForCenter } from "../rules/token-geometry.js";

export { movementFootprintForToken, movementPlacementForCenter } from "../rules/token-geometry.js";

const MOVEMENT_SLUGS = new Set(["crawl", "stride", "step", "stand-stride"]);
const NOT_VISIBLE_REASON = "Destination is not visible.";
const OCCUPIED_REASON = "Destination is occupied.";
const NO_PATH_REASON = "No collision-free movement path to destination.";
const BEYOND_RANGE_REASON = "Destination is beyond movement range.";
const WAYPOINT_BEYOND_RANGE_REASON = "Waypoint path is beyond movement range.";
const BEYOND_SPELL_RANGE_REASON = "Destination is beyond the spell's range.";

export function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function directPoint(value) {
  const x = numeric(value?.x, NaN);
  const y = numeric(value?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function directPointWithElevation(value) {
  const base = directPoint(value);
  if (!base) return null;
  const elevation = numeric(value?.elevation, NaN);
  return Number.isFinite(elevation) ? { ...base, elevation } : base;
}

function point(value) {
  return directPoint(value?.center ?? value?.token?.center ?? value);
}

function samePoint(left, right) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

function pointKey(value) {
  return `${value.x},${value.y}`;
}

function routeGridSize(options = {}) {
  return numeric(options.gridSize ?? options.gridDistance, 5) || 5;
}

function routeGridDistance(options = {}) {
  return numeric(options.gridDistance ?? options.gridSize, 5) || 5;
}

function movementCostOptions(options = {}, diagonalCount = 0) {
  const gridSize = routeGridSize(options);
  return {
    ...options,
    gridSize,
    gridDistance: routeGridDistance(options),
    startingDiagonalCount: diagonalCount,
  };
}

export function movementRouteSegmentCost(from, to, options = {}, diagonalCount = 0) {
  return pf2eMovementSegmentCost(from, to, movementCostOptions(options, diagonalCount));
}

function profileSpeed(context, fallback = 25) {
  const profile = context?.actor?.profile ?? context?.profile ?? {};
  const speed = profile.speed?.value ?? profile.speed ?? profile.landSpeed;
  return numeric(speed, fallback);
}

function contextToken(context, options = {}) {
  if (options.collisionToken) return options.collisionToken;
  if (typeof options.tokenLookup === "function") {
    const id = context?.token?.id ?? context?.token?.uuid ?? context?.combatant?.token?.id ?? null;
    const token = options.tokenLookup(id, context, options);
    if (token) return token;
  }
  return context?.token ?? null;
}

function movementSpeedFeet(context, step, options = {}) {
  const movementAction = pf2eMovementActionForStep(step);
  const token = contextToken(context, options);
  const speedKey = movementAction === "walk" ? "land" : movementAction;
  const speed = speedKey
    ? token?.actor?.movement?.speeds?.[speedKey]
      ?? token?.actor?.system?.movement?.speeds?.[speedKey]
      ?? context?.actor?.document?.movement?.speeds?.[speedKey]
      ?? context?.actor?.document?.system?.movement?.speeds?.[speedKey]
      ?? context?.actor?.movement?.speeds?.[speedKey]
      ?? context?.actor?.system?.movement?.speeds?.[speedKey]
    : null;
  const value = numeric(speed?.value ?? speed?.total ?? speed?.base, NaN);
  if (Number.isFinite(value) && value > 0) return value;
  const profile = profileSpeed(context, NaN);
  if (Number.isFinite(profile) && profile > 0) return profile;
  const stepDistance = numeric(step?.movementDistance ?? step?.distance, NaN);
  if (Number.isFinite(stepDistance) && stepDistance > 0) return stepDistance;
  return 25;
}

function teleportRangeFeet(step) {
  return numeric(
    step?.targetingProfile?.maxRange
      ?? step?.maxRange
      ?? step?.range?.max
      ?? step?.action?.targetingProfile?.maxRange,
    NaN,
  );
}

export function movementBudgetForStep(context, step, options = {}) {
  if (step?.activityProfile?.teleport === true || step?.action?.activityProfile?.teleport === true) {
    const range = teleportRangeFeet(step);
    return Number.isFinite(range) && range > 0 ? range : numeric(options.teleportFallback, Infinity);
  }
  if (step?.slug === "crawl" || step?.slug === "step") return 5;
  // A dynamically-slugged action (e.g. Flank's "flank-strike-tentacle") can still be a genuine plain
  // Stride -- requiresDestination is the same canonical "this needs a manually/auto-picked
  // destination" signal requiresDestinationForAction() already uses to show the destination-picker
  // button, so it must get the real Speed here too, not silently fall through to a budget of 0 (which
  // made every non-origin destination, including a correctly pre-computed one, look beyond range).
  if (step?.slug === "stride" || step?.slug === "stand-stride" || step?.requiresDestination === true) {
    return movementSpeedFeet(context, step, options);
  }
  return 0;
}

function movementBudgetTargetElevation(step, options = {}) {
  return numeric(
    options.plannedElevation
      ?? options.destination?.elevation
      ?? step?.plannedElevation
      ?? step?.destination?.elevation
      ?? step?.movementPlan?.destination?.elevation,
    NaN,
  );
}

export function movementHorizontalBudgetForStep(context, step, options = {}) {
  const budget = movementBudgetForStep(context, step, options);
  if (step?.slug !== "stride" && step?.slug !== "stand-stride") return budget;

  const targetElevation = movementBudgetTargetElevation(step, options);
  if (!Number.isFinite(targetElevation)) return budget;
  return Math.max(0, budget - Math.abs(targetElevation - originElevation(context, options)));
}

export function movementOriginForContext(context, options = {}) {
  const explicit = directPoint(options.origin ?? options.step?.movementPlan?.origin);
  if (explicit) return explicit;

  const token = contextToken(context, options);
  const center = directPoint(context?.token?.plannedCenter)
    ?? directPoint(context?.token?.center)
    ?? directPoint(token?.center);
  if (center) return center;

  const document = token?.document ?? context?.combatant?.token ?? context?.token?.document ?? {};
  const x = numeric(document.x ?? token?.x ?? context?.token?.x, NaN);
  const y = numeric(document.y ?? token?.y ?? context?.token?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const gridSize = routeGridSize(options);
  const width = Math.max(1, numeric(document.width ?? token?.width ?? context?.token?.width, 1) || 1);
  const height = Math.max(1, numeric(document.height ?? token?.height ?? context?.token?.height, 1) || 1);
  return {
    x: x + (width * gridSize) / 2,
    y: y + (height * gridSize) / 2,
  };
}

function originElevation(context, options = {}) {
  const token = contextToken(context, options);
  return numeric(
    options.originElevation
      ?? token?.document?.elevation
      ?? token?.elevation
      ?? context?.token?.document?.elevation
      ?? context?.token?.elevation,
    0,
  ) || 0;
}

function withOriginElevation(origin, context, options = {}) {
  if (!origin) return null;
  return { ...origin, elevation: originElevation(context, options) };
}

function pointElevation(value, fallback) {
  return numeric(value?.elevation, fallback);
}

function verticalSegmentCost(from, to) {
  if (!Number.isFinite(Number(to?.elevation))) return 0;
  const fromElevation = pointElevation(from, 0);
  const toElevation = pointElevation(to, fromElevation);
  return Math.abs(toElevation - fromElevation);
}

export function waypointPathCost(origin, waypoints, options = {}) {
  let from = origin;
  let cost = 0;
  let diagonalCount = 0;
  for (const waypoint of waypoints ?? []) {
    const movement = movementRouteSegmentCost(from, waypoint, options, diagonalCount);
    cost += movement.cost + verticalSegmentCost(from, waypoint);
    diagonalCount = movement.diagonalCount;
    from = waypoint;
  }
  return { cost, diagonalCount };
}

function pathBlocked(from, to, options = {}) {
  return typeof options.pathBlocked === "function"
    ? options.pathBlocked(from, to, options) === true
    : false;
}

function pointVisible(value, options = {}) {
  return typeof options.pointVisible === "function"
    ? options.pointVisible(value, options) !== false
    : true;
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function contextAllies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? [];
}

function centerOccupiedByOtherToken(context, center, footprint, gridSize) {
  const candidatePlacement = movementPlacementForCenter(center, footprint, gridSize);
  const others = [...contextAllies(context), ...contextEnemies(context)];
  return others.some((other) => {
    const otherCenter = point(other);
    if (!otherCenter) return false;
    const otherPlacement = movementPlacementForCenter(otherCenter, other, gridSize);
    return rectanglesOverlap(candidatePlacement, otherPlacement);
  });
}

function centerOccupiedByEnemyToken(context, center, footprint, gridSize) {
  const candidatePlacement = movementPlacementForCenter(center, footprint, gridSize);
  return contextEnemies(context).some((enemy) => {
    const enemyCenter = point(enemy);
    if (!enemyCenter) return false;
    const enemyPlacement = movementPlacementForCenter(enemyCenter, enemy, gridSize);
    return rectanglesOverlap(candidatePlacement, enemyPlacement);
  });
}

function destinationOccupied(context, destination, options = {}) {
  if (typeof options.isOccupied === "function") return options.isOccupied(destination, context, options) === true;
  const gridSize = routeGridSize(options);
  return centerOccupiedByOtherToken(context, destination, movementFootprintForToken(contextToken(context, options)), gridSize);
}

export function movementDestinationForStep(step, options = {}) {
  return directPointWithElevation(options.destination ?? step?.destination ?? step?.movementPlan?.destination);
}

export function movementWaypointsForStep(step, destination, options = {}) {
  const rawWaypoints = Array.isArray(options.waypoints)
    ? options.waypoints
    : (Array.isArray(step?.movementPlan?.waypoints) ? step.movementPlan.waypoints : []);
  const waypoints = rawWaypoints.map((waypoint) => directPointWithElevation(waypoint)).filter(Boolean);
  if (!waypoints.length) return null;
  if (destination && !samePoint(waypoints.at(-1), destination)) waypoints.push(destination);
  return waypoints;
}

export function movementPlanForWaypoints(context, step, waypoints, options = {}) {
  const cleanWaypoints = (waypoints ?? []).map((waypoint) => directPointWithElevation(waypoint)).filter(Boolean);
  const origin = withOriginElevation(
    movementOriginForContext(context, { ...options, step }),
    context,
    options,
  );
  if (!origin) return null;
  return {
    native: false,
    waypoints: cleanWaypoints,
    cost: waypointPathCost(origin, cleanWaypoints, options).cost,
    maxCost: movementBudgetForStep(context, step, options),
  };
}

export function movementPlanForDestination(context, step, destination, options = {}) {
  const route = movementRouteForStep(context, { ...(step ?? {}), destination }, options);
  if (route?.reachable !== true) return null;
  return {
    native: false,
    waypoints: route.waypoints?.length ? route.waypoints : [destination],
    cost: route.cost,
    maxCost: route.maxCost,
  };
}

export function routeCornerWaypoints(origin, route, scale = 1) {
  if (!origin || !Array.isArray(route) || route.length < 2) return [];
  const points = [origin, ...route];
  const corners = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (Math.sign(current.x - previous.x) !== Math.sign(next.x - current.x)
      || Math.sign(current.y - previous.y) !== Math.sign(next.y - current.y)) {
      corners.push({ x: current.x * scale, y: current.y * scale });
    }
  }
  return corners;
}

function movementHeuristic(from, to, options = {}) {
  return movementRouteSegmentCost(from, to, options).cost;
}

function routePriority(node, destination, options = {}) {
  const heuristic = movementHeuristic(node.center, destination, options);
  const euclidean = Math.hypot(destination.x - node.center.x, destination.y - node.center.y);
  return node.cost + heuristic + euclidean * 0.001;
}

export function reachableMovementCenters(origin, distanceFeet, options = {}) {
  if (!origin || !Number.isFinite(Number(distanceFeet)) || distanceFeet <= 0) return [];

  const gridSize = routeGridSize(options);
  const cells = Math.floor(distanceFeet / routeGridDistance(options));
  const maxOffset = cells * gridSize;
  const maxDistance = distanceFeet + 0.0001;
  const bestCosts = new Map([[`${pointKey(origin)},0`, 0]]);
  const queue = [{ center: origin, cost: 0, route: [], diagonalCount: 0 }];
  const centers = [];
  const footprint = options.context ? movementFootprintForToken(contextToken(options.context, options)) : null;

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
        if (footprint && centerOccupiedByEnemyToken(options.context, center, footprint, gridSize)) continue;

        const movement = movementRouteSegmentCost(current.center, center, options, current.diagonalCount);
        const cost = current.cost + movement.cost;
        if (!Number.isFinite(cost) || cost > maxDistance) continue;

        const key = `${pointKey(center)},${movement.diagonalCount % 2}`;
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

  if (!options.context) return centers;
  return centers.filter((center) => !centerOccupiedByOtherToken(options.context, center, footprint, gridSize));
}

export function directMovementRouteToCenter(origin, destination, budget, options = {}) {
  const gridSize = routeGridSize(options);
  const cells = Math.floor(budget / routeGridDistance(options));
  const maxOffset = cells * gridSize;
  const destinationKey = pointKey(destination);
  const bestCosts = new Map([[`${pointKey(origin)},0`, 0]]);
  const open = [{ center: origin, cost: 0, route: [], diagonalCount: 0 }];
  const footprint = options.context ? movementFootprintForToken(contextToken(options.context, options)) : null;

  while (open.length) {
    open.sort((left, right) => routePriority(left, destination, options) - routePriority(right, destination, options));
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
        if (footprint && centerOccupiedByEnemyToken(options.context, center, footprint, gridSize)) continue;

        const movement = movementRouteSegmentCost(current.center, center, options, current.diagonalCount);
        const cost = current.cost + movement.cost;
        if (cost > budget) continue;

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

function routeHorizontalCost(origin, route, destination, options = {}) {
  const lastCost = route?.at(-1)?.cost;
  if (Number.isFinite(lastCost)) return lastCost;
  return waypointPathCost(origin, route?.length ? route : [destination], options).cost;
}

function disabledRoute(reason = "") {
  return {
    enabled: false,
    origin: null,
    destination: null,
    reachable: false,
    cost: 0,
    maxCost: 0,
    route: [],
    reason,
  };
}

function emptyRoute(origin, maxCost) {
  return {
    enabled: true,
    origin,
    destination: null,
    reachable: false,
    cost: 0,
    maxCost,
    route: [],
    reason: "",
  };
}

function unavailableRoute(origin, destination, maxCost, cost, reason, route = []) {
  return {
    enabled: true,
    origin,
    destination,
    reachable: false,
    cost,
    maxCost,
    route,
    reason,
  };
}

function availableRoute(origin, destination, maxCost, cost, route, waypoints) {
  return {
    enabled: true,
    origin,
    destination,
    reachable: true,
    cost,
    maxCost,
    route,
    ...(waypoints?.length ? { waypoints } : {}),
    reason: "",
  };
}

function validateWaypointRoute(context, origin, destination, waypoints, maxCost, options = {}) {
  let from = origin;
  let cost = 0;
  let diagonalCount = 0;
  const route = [];

  for (const waypoint of waypoints) {
    if (!pointVisible(waypoint, options)) {
      return unavailableRoute(origin, destination, maxCost, cost, NOT_VISIBLE_REASON, route);
    }
    if (pathBlocked(from, waypoint, options)) {
      return unavailableRoute(origin, destination, maxCost, cost, NO_PATH_REASON, route);
    }
    const movement = movementRouteSegmentCost(from, waypoint, options, diagonalCount);
    cost += movement.cost + verticalSegmentCost(from, waypoint);
    diagonalCount = movement.diagonalCount;
    route.push({ ...waypoint, cost });
    if (cost > maxCost) {
      return unavailableRoute(origin, destination, maxCost, cost, WAYPOINT_BEYOND_RANGE_REASON, route);
    }
    from = waypoint;
  }

  if (destinationOccupied(context, destination, options)) {
    return unavailableRoute(origin, destination, maxCost, cost, OCCUPIED_REASON, route);
  }
  const explicitWaypoints = route.slice(0, -1).map(({ cost: _cost, ...waypoint }) => waypoint);
  return availableRoute(origin, destination, maxCost, cost, route, explicitWaypoints);
}

function teleportRouteForStep(context, step, origin, destination, maxCost, options = {}) {
  if (!destination) return emptyRoute(origin, maxCost);
  if (!pointVisible(destination, options)) return unavailableRoute(origin, destination, maxCost, 0, NOT_VISIBLE_REASON);
  if (destinationOccupied(context, destination, options)) return unavailableRoute(origin, destination, maxCost, 0, OCCUPIED_REASON);

  const movement = movementRouteSegmentCost(origin, destination, options, 0);
  const cost = movement.cost;
  if (cost > maxCost) {
    return unavailableRoute(origin, destination, maxCost, cost, BEYOND_SPELL_RANGE_REASON, [destination]);
  }
  return availableRoute(origin, destination, maxCost, cost, [destination], undefined);
}

function movementRouteForDestination(context, origin, destination, maxCost, options = {}) {
  if (!pointVisible(destination, options)) return unavailableRoute(origin, destination, maxCost, 0, NOT_VISIBLE_REASON);
  if (destinationOccupied(context, destination, options)) return unavailableRoute(origin, destination, maxCost, 0, OCCUPIED_REASON);

  const verticalCost = verticalSegmentCost(origin, destination);
  const horizontalBudget = Math.max(0, maxCost - verticalCost);
  const route = directMovementRouteToCenter(origin, destination, horizontalBudget, { ...options, context });
  if (!Array.isArray(route)) {
    const directCost = movementRouteSegmentCost(origin, destination, options, 0).cost + verticalCost;
    const reason = directCost > maxCost ? BEYOND_RANGE_REASON : NO_PATH_REASON;
    return unavailableRoute(origin, destination, maxCost, directCost, reason);
  }

  const horizontalCost = routeHorizontalCost(origin, route, destination, options);
  const cost = horizontalCost + verticalCost;
  if (cost > maxCost) return unavailableRoute(origin, destination, maxCost, cost, BEYOND_RANGE_REASON, route);
  const waypoints = routeCornerWaypoints(origin, route);
  return availableRoute(origin, destination, maxCost, cost, route, waypoints);
}

export function movementRouteForStep(context, step, options = {}) {
  const teleport = step?.activityProfile?.teleport === true || step?.action?.activityProfile?.teleport === true;
  // A dynamically-slugged action (e.g. Flank's "flank-strike-tentacle") can still be a genuine plain
  // Stride -- requiresDestination is the same canonical signal requiresDestinationForAction() already
  // uses to show the destination-picker button, so a step that gets that button must also get a real
  // route here, not silently fall through to disabledRoute() just because its slug isn't literally
  // "stride" (which previously made a correctly pre-computed destination look beyond range).
  if (!teleport && !MOVEMENT_SLUGS.has(step?.slug) && step?.requiresDestination !== true) return disabledRoute();

  const origin = withOriginElevation(
    movementOriginForContext(context, { ...options, step }),
    context,
    options,
  );
  if (!origin) return disabledRoute();

  const maxCost = movementBudgetForStep(context, step, options);
  const destination = movementDestinationForStep(step, options);
  if (maxCost <= 0) return disabledRoute();
  if (!destination) return emptyRoute(origin, maxCost);

  if (teleport) return teleportRouteForStep(context, step, origin, destination, maxCost, options);

  const waypoints = movementWaypointsForStep(step, destination, options);
  if (waypoints?.length) {
    return validateWaypointRoute(context, origin, destination, waypoints, maxCost, options);
  }
  return movementRouteForDestination(context, origin, destination, maxCost, options);
}
