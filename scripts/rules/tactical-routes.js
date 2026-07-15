import { canAttackTarget, contextAllies, contextEnemies, contextTargets } from "../engine/target-pool.js";
import { t } from "../i18n.js";

export const TACTICAL_ROUTE_MODES = Object.freeze([
  "approach",
  "shortest",
  "safe",
  "cover",
  "flank",
  "escape",
]);

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  const center = value?.center ?? value?.token?.center ?? value;
  const x = numeric(center?.x, NaN);
  const y = numeric(center?.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function footprint(value) {
  const source = value?.token ?? value ?? {};
  return {
    width: Math.max(0.5, numeric(source?.width ?? source?.document?.width, 1) || 1),
    height: Math.max(0.5, numeric(source?.height ?? source?.document?.height, 1) || 1),
  };
}

function rectangleFor(value, gridSize, shapeSource = value) {
  const center = point(value);
  if (!center) return null;
  const shape = footprint(shapeSource);
  const width = shape.width * gridSize;
  const height = shape.height * gridSize;
  return {
    left: center.x - width / 2,
    right: center.x + width / 2,
    top: center.y - height / 2,
    bottom: center.y + height / 2,
  };
}

function rectangleDistance(left, right) {
  if (!left || !right) return Infinity;
  const dx = Math.max(0, left.left - right.right, right.left - left.right);
  const dy = Math.max(0, left.top - right.bottom, right.top - left.bottom);
  return Math.hypot(dx, dy);
}

function moverDistance(context, center, entity, gridSize) {
  return rectangleDistance(
    rectangleFor(center, gridSize, context?.token),
    rectangleFor(entity, gridSize),
  );
}

function entityDistance(left, right, gridSize) {
  return rectangleDistance(rectangleFor(left, gridSize), rectangleFor(right, gridSize));
}

function threatReach(entity) {
  const reach = Number(
    entity?.threatReach
      ?? entity?.reach
      ?? entity?.meleeReach
      ?? entity?.profile?.reach
      ?? entity?.profile?.meleeReach,
  );
  return Number.isFinite(reach) && reach >= 0 ? reach : 5;
}

function knownEnemies(context) {
  return contextEnemies(context).filter((enemy) => context?.isGM === true || canAttackTarget(enemy));
}

function routeOrigin(context, origin) {
  return point(origin)
    ?? point(context?.token?.plannedCenter)
    ?? point(context?.token);
}

function routeNodes(context, center, origin) {
  const start = routeOrigin(context, origin);
  const values = [
    ...(start ? [{ ...start, cost: 0 }] : []),
    ...(Array.isArray(center?.route) ? center.route : []),
    center,
  ];
  const nodes = [];
  for (const value of values) {
    const centerPoint = point(value);
    if (!centerPoint) continue;
    const cumulativeCost = numeric(value?.cost, NaN);
    const previous = nodes.at(-1);
    if (previous?.center.x === centerPoint.x && previous?.center.y === centerPoint.y) {
      if (Number.isFinite(cumulativeCost)) previous.cost = cumulativeCost;
      continue;
    }
    nodes.push({ center: centerPoint, cost: cumulativeCost });
  }
  return nodes;
}

function openEnemyLines(center, enemies, lineBlocked) {
  return enemies.filter((enemy) => {
    const enemyCenter = point(enemy);
    if (!enemyCenter) return false;
    return typeof lineBlocked !== "function" || lineBlocked(center, enemyCenter) !== true;
  }).length;
}

function meleeThreats(context, center, enemies, gridSize) {
  return enemies.filter((enemy) => moverDistance(context, center, enemy, gridSize) <= threatReach(enemy)).length;
}

function routeSegmentWeight(from, to) {
  const costDelta = to.cost - from.cost;
  if (Number.isFinite(costDelta) && costDelta > 0) return costDelta;
  return Math.hypot(to.center.x - from.center.x, to.center.y - from.center.y);
}

function routeExposure(context, center, enemies, gridSize, lineBlocked, origin) {
  const nodes = routeNodes(context, center, origin);
  const samples = nodes.map((node) => ({
    ...node,
    lines: openEnemyLines(node.center, enemies, lineBlocked),
    threats: meleeThreats(context, node.center, enemies, gridSize),
  }));
  let pathLines = 0;
  let pathThreats = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    const weight = routeSegmentWeight(from, to);
    // Trapezoidal integration makes risk proportional to PF2e movement budget spent on each
    // segment. Stored route-node count alone must never make an otherwise identical path safer.
    pathLines += weight * (from.lines + to.lines) / 2;
    pathThreats += weight * (from.threats + to.threats) / 2;
  }
  return { pathLines, pathThreats };
}

function normalizedDot(origin, left, right) {
  const center = point(origin);
  const leftPoint = point(left);
  const rightPoint = point(right);
  if (!center || !leftPoint || !rightPoint) return 1;
  const leftX = leftPoint.x - center.x;
  const leftY = leftPoint.y - center.y;
  const rightX = rightPoint.x - center.x;
  const rightY = rightPoint.y - center.y;
  const divisor = Math.hypot(leftX, leftY) * Math.hypot(rightX, rightY);
  return divisor > 0 ? ((leftX * rightX) + (leftY * rightY)) / divisor : 1;
}

function flankMetrics(context, step, center, target, gridSize) {
  if (!target) return { valid: 1, opposite: 1 };
  const reach = numeric(step?.activityProfile?.strikeReach ?? step?.range?.max ?? context?.profile?.reach, 5);
  const allies = contextAllies(context)
    .filter((ally) => point(ally))
    .filter((ally) => entityDistance(ally, target, gridSize) <= threatReach(ally));
  if (!allies.length || moverDistance(context, center, target, gridSize) > reach) return { valid: 1, opposite: 1 };
  return {
    valid: 0,
    opposite: Math.min(...allies.map((ally) => normalizedDot(target, center, ally))),
  };
}

export function tacticalRouteModeForStep(step, fallback = "approach") {
  const mode = String(step?.routeMode ?? step?.action?.routeMode ?? fallback).toLowerCase();
  return TACTICAL_ROUTE_MODES.includes(mode) ? mode : fallback;
}

export function tacticalRouteModeLabel(mode) {
  switch (mode) {
    case "shortest": return t("Route.Shortest", "Shortest");
    case "safe": return t("Route.Safe", "Safest");
    case "cover": return t("Route.Cover", "Seek Cover");
    case "flank": return t("Route.Flank", "Flank");
    case "escape": return t("Route.Escape", "Escape");
    default: return t("Route.Approach", "Approach");
  }
}

export function availableTacticalRouteModes(context, step) {
  const enemies = knownEnemies(context);
  const hasTarget = Boolean(
    point(step?.preferredTarget)
    || contextTargets(context).some((target) => point(target))
    || enemies.some((enemy) => point(enemy)),
  );
  const hasEnemies = enemies.some((enemy) => point(enemy));
  const hasAllies = contextAllies(context).some((ally) => point(ally));
  const modes = [];
  if (hasTarget) modes.push("approach", "shortest");
  if (hasEnemies) modes.push("safe", "cover");
  if (hasTarget && hasAllies) modes.push("flank");
  if (hasEnemies) modes.push("escape");
  return modes.length ? modes : ["approach"];
}

export function nextTacticalRouteMode(context, step) {
  const modes = availableTacticalRouteModes(context, step);
  const current = tacticalRouteModeForStep(step);
  const index = modes.indexOf(current);
  return modes[(index + 1 + modes.length) % modes.length];
}

export function tacticalRouteMetrics(context, step, center, {
  target = null,
  lineBlocked = null,
  origin = null,
  gridSize: rawGridSize = 5,
} = {}) {
  const gridSize = numeric(rawGridSize, 5) || 5;
  const enemies = knownEnemies(context).filter((enemy) => point(enemy));
  const endpointThreats = meleeThreats(context, center, enemies, gridSize);
  const endpointLines = openEnemyLines(center, enemies, lineBlocked);
  const { pathLines, pathThreats } = routeExposure(
    context,
    center,
    enemies,
    gridSize,
    lineBlocked,
    origin,
  );
  const targetDistance = target ? moverDistance(context, center, target, gridSize) : Infinity;
  const enemyDistance = enemies.length
    ? Math.min(...enemies.map((enemy) => moverDistance(context, center, enemy, gridSize)))
    : 0;
  return {
    cost: numeric(center?.cost, Infinity),
    endpointLines,
    endpointThreats,
    enemyDistance,
    flank: flankMetrics(context, step, center, target, gridSize),
    pathLines,
    pathThreats,
    targetDistance,
    x: numeric(center?.x, 0),
    y: numeric(center?.y, 0),
  };
}

function compareValues(left, right, fields) {
  for (const [field, direction = 1] of fields) {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue === rightValue) continue;
    const difference = (leftValue - rightValue) * direction;
    if (difference !== 0) return difference;
  }
  return 0;
}

function metricsFor(context, step, center, options) {
  const cache = options.metricsCache;
  if (cache?.has(center)) return cache.get(center);
  const metrics = tacticalRouteMetrics(context, step, center, options);
  cache?.set(center, metrics);
  return metrics;
}

export function compareTacticalRouteCenters(context, step, left, right, options = {}) {
  const mode = tacticalRouteModeForStep(step, options.fallbackMode ?? "approach");
  const leftMetrics = metricsFor(context, step, left, options);
  const rightMetrics = metricsFor(context, step, right, options);
  let comparison = 0;
  switch (mode) {
    case "shortest":
      comparison = compareValues(
        leftMetrics,
        rightMetrics,
        options.costFirst ? [["cost"], ["targetDistance"]] : [["targetDistance"], ["cost"]],
      );
      break;
    case "safe":
      comparison = compareValues(leftMetrics, rightMetrics, [
        ["endpointThreats"], ["pathThreats"], ["endpointLines"], ["pathLines"], ["targetDistance"], ["cost"],
      ]);
      break;
    case "cover":
      comparison = compareValues(leftMetrics, rightMetrics, [
        ["endpointLines"], ["pathLines"], ["endpointThreats"], ["pathThreats"], ["targetDistance"], ["cost"],
      ]);
      break;
    case "flank":
      comparison = compareValues(
        { ...leftMetrics, flankValid: leftMetrics.flank.valid, flankOpposite: leftMetrics.flank.opposite },
        { ...rightMetrics, flankValid: rightMetrics.flank.valid, flankOpposite: rightMetrics.flank.opposite },
        [["flankValid"], ["flankOpposite"], ["endpointThreats"], ["targetDistance"], ["cost"]],
      );
      break;
    case "escape":
      comparison = compareValues(leftMetrics, rightMetrics, [
        ["endpointThreats"], ["endpointLines"], ["enemyDistance", -1], ["pathThreats"], ["pathLines"], ["cost"],
      ]);
      break;
    default:
      comparison = compareValues(leftMetrics, rightMetrics, [["targetDistance"], ["endpointThreats"], ["cost"]]);
      break;
  }
  return comparison || compareValues(leftMetrics, rightMetrics, [["x"], ["y"]]);
}
