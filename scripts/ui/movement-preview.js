import { previewLayer } from "./preview-layer.js";
import { pf2eMovementActionForStep } from "../rules/movement-cost.js";
import {
  canvasAttackPathBlocked,
  canvasGridDistance,
  canvasGridSize,
  canvasMovementPathBlocked,
  canvasTokenById,
  canReachPlacementPerimeter,
  gridReachDistance,
  rectangleDistance,
  scaledPoint,
} from "../rules/canvas-geometry.js";
import {
  directMovementRouteToCenter as engineDirectMovementRouteToCenter,
  movementBudgetForStep,
  movementDestinationForStep,
  movementFootprintForToken as tokenFootprint,
  movementHorizontalBudgetForStep,
  movementOriginForContext,
  movementPlacementForCenter as placementForCenter,
  movementRouteSegmentCost,
  movementRouteForStep,
  movementWaypointsForStep,
  reachableMovementCenters as engineReachableMovementCenters,
  routeCornerWaypoints as engineRouteCornerWaypoints,
} from "../engine/movement-route.js";
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

function pathBlocked(from, to, options = {}) {
  return canvasMovementPathBlocked(from, to, options);
}

function attackPathBlocked(from, to, options = {}) {
  return canvasAttackPathBlocked(from, to, options);
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

function movementRouteOptions(gridSize, options = {}) {
  return {
    ...options,
    gridSize,
    gridDistance: gridSize,
    pathBlocked: (from, to) => pathBlocked(from, to, options),
    pointVisible: (center) => pointVisible(center, options),
  };
}

function movementPreviewOrigin(context, gridSize, options = {}) {
  return movementOriginForContext(context, {
    ...options,
    gridSize,
  });
}

function reachableMovementCenters(origin, distanceFeet, gridSize, options = {}) {
  return engineReachableMovementCenters(origin, distanceFeet, movementRouteOptions(gridSize, options));
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

function movementRoutePreviewForStep(context, step, origin, gridSize, options = {}) {
  return movementRouteForStep(context, step, {
    ...movementRouteOptions(gridSize, options),
    origin,
  });
}

function movementWaypointRouteForPreview(context, step, origin, waypoints, gridSize, options = {}) {
  const destination = waypoints?.at(-1) ?? movementDestinationForStep(step);
  return movementRoutePreviewForStep(context, {
    ...step,
    destination,
    movementPlan: {
      ...(step?.movementPlan ?? {}),
      waypoints: waypoints ?? step?.movementPlan?.waypoints ?? [],
    },
  }, origin, gridSize, options);
}

// A hint box is deliberately always exactly 1 cell (not the actor's real footprint) -- drawing the
// full footprint at every reachable square would heavily overlap for a fast, Large-or-bigger actor.
// `placementForCenter`'s `center - gridSize/2` math assumes `center` is a cell CENTER, which only
// holds for an odd footprint (1x1, 3x3, ...); an even one (2x2 Large, 4x4 Gargantuan, ...) naturally
// lands its own BFS candidate centers on grid VERTICES instead (same parity split as
// destination-picker.js's snapAxisToFootprint), which that formula offsets by half a cell. Flooring
// to the containing cell's top-left is correct for either parity: for an odd footprint's cell-center
// input it reproduces the exact same box as before; for an even footprint's vertex input it picks
// one of the 4 touching cells (a deterministic, always-valid choice for what's just a visual hint).
function markerForCenter(center, gridSize) {
  return {
    center,
    x: Math.floor(center.x / gridSize) * gridSize,
    y: Math.floor(center.y / gridSize) * gridSize,
    width: gridSize,
    height: gridSize,
  };
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
    const movement = movementRouteSegmentCost(from, to, movementRouteOptions(gridSize, options), diagonalCount);
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
      && canReachPlacementPerimeter(placement, targetPlacement, gridSize, {
        pathBlocked: (from, to) => attackPathBlocked(from, to, options),
      });
  });
}

const STRIDE_COLORS = [0x5aa0e0, 0xe0b35a, 0x9b6dd6];
// Border for a landing-square box (an intermediate stop along a path -- the final landing square
// gets a ghost token instead), always this bright cream regardless of the fill color, which can
// match the path/stride-index color and make the box hard to pick out from the surrounding grid.
const DESTINATION_BORDER_COLOR = 0xf0eee8;
// Fixed, meaning-based colors for the movement/destination overlay -- not tied to the player's own
// Foundry color (game.user.color previously drove this), so the overlay reads the same legend for
// every user: green for anywhere reachable, gold for the specific square you're about to commit to,
// red for anywhere out of reach.
const AVAILABLE_COLOR = 0x66c78f;
const DESTINATION_COLOR = 0xe0b35a;
const UNAVAILABLE_COLOR = 0xc94f4f;

function strideMovementColor(index) {
  return STRIDE_COLORS[index % STRIDE_COLORS.length];
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
  const origin = movementPreviewOrigin(context, gridSize, options);
  if (!origin) return null;

  const speed = movementBudgetForStep(context, { ...step, slug: "stride" }, options);
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
  const outboundRoute = engineDirectMovementRouteToCenter(origin, attackCenter, speed, movementRouteOptions(gridSize, options))
    ?? attackCenter.route
    ?? [attackCenter];
  const inboundRoute = engineDirectMovementRouteToCenter(attackCenter, origin, speed, movementRouteOptions(gridSize, options));
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
  const origin = movementPreviewOrigin(context, gridSize, options);
  if (!origin) return null;

  const strideCount = Math.max(1, Math.floor(Number(step?.activityProfile?.strideCount) || 1));
  const speed = movementBudgetForStep(context, { ...step, slug: "stride" }, options);
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
  const route = engineDirectMovementRouteToCenter(origin, destCenter, strideCount * speed, movementRouteOptions(gridSize, options))
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
  const destinationCenter = movementDestinationForStep(step);
  if (!destinationCenter) return null;

  const color = DESTINATION_COLOR;
  const destinationVisible = pointVisible(destinationCenter, options);
  const destinationPlacement = destinationVisible ? placementForCenter(destinationCenter, footprint, gridSize) : null;
  const destinationMarker = xMarkerForPlacement(destinationPlacement);
  const routePlan = movementRoutePreviewForStep(context, step, origin, gridSize, options);
  const waypointCenters = movementWaypointsForStep(step, destinationCenter);
  if (waypointCenters?.length) {
    const destinationAvailable = destinationVisible && routePlan.reachable === true;
    // Execution only needs to know whether the destination is legal — skip the expensive flood-fill
    // of the remaining reachable area (and its markers/labels), which exists purely for the hover
    // overlay. Reading the route verdict above is cheap; the BFS is what made executing a Stride lag.
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
        destinationIllegalReason: destinationAvailable ? "" : routePlan.reason,
        movementColor: color,
      };
    }
    const remainingDistanceFeet = destinationAvailable
      ? Math.max(0, routePlan.maxCost - routePlan.cost)
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
      destinationIllegalReason: destinationAvailable ? "" : routePlan.reason,
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
      reachableMarkerColor: AVAILABLE_COLOR,
      recommendedCenter: destinationAvailable ? destinationCenter : null,
      recommendedPlacement: destinationAvailable ? destinationPlacement : null,
      recommendedMarker: destinationAvailable ? destinationMarker : null,
      movementColor: color,
      segmentLabels,
    };
  }

  // Validation callers need only the route verdict, not overlay markers.
  if (options.validateOnly) {
    const available = destinationVisible && routePlan.reachable === true;
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
      destinationIllegalReason: available ? "" : routePlan.reason,
      movementColor: color,
    };
  }

  const route = destinationVisible ? routePlan.route : null;
  const destinationAvailable = destinationVisible && routePlan.reachable === true;
  // A single plain destination (no manually-placed waypoints) gets the same distance readout a
  // multi-waypoint Stride already shows on its own trail -- waypointSegmentLabels with a single-
  // point "path" is exactly a one-segment origin-to-destination label.
  const segmentLabels = destinationAvailable
    ? waypointSegmentLabels(origin, [destinationCenter], gridSize, options)
    : [];
  const stridePath = destinationAvailable
    ? [{
      index: 1,
      center: destinationCenter,
      trail: route,
      placement: destinationPlacement,
      marker: destinationMarker,
      segmentLabels,
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
    destinationIllegalReason: destinationAvailable ? "" : routePlan.reason,
    stridePath,
    reachableCenters: [],
    reachablePlacements: [],
    reachableMarkers: [],
    reachableMarkerColor: AVAILABLE_COLOR,
    recommendedCenter: destinationAvailable ? destinationCenter : null,
    recommendedPlacement: destinationAvailable ? destinationPlacement : null,
    recommendedMarker: destinationAvailable ? destinationMarker : null,
    movementColor: color,
  };
}

// A teleport (e.g. Translocate) reaches any space within the spell's range, ignoring terrain and the
// movement path. Rather than a filled grid (a 120-ft range covers hundreds of squares — too many to
// draw, and the per-square cap made it look far shorter than it is), the preview is a range ring
// marking the boundary plus the chosen destination.
function teleportPreview(context, step, origin, footprint, gridSize, options = {}) {
  const color = DESTINATION_COLOR;
  const routePlan = movementRoutePreviewForStep(context, step, origin, gridSize, options);
  const range = movementBudgetForStep(context, step, options);
  const hasRange = Number.isFinite(range) && range > 0;

  const destinationCenter = movementDestinationForStep(step);
  const destinationVisible = destinationCenter ? pointVisible(destinationCenter, options) : false;
  const destinationPlacement = destinationCenter && destinationVisible
    ? placementForCenter(destinationCenter, footprint, gridSize)
    : null;
  const destinationAvailable = destinationCenter ? destinationVisible && routePlan.reachable === true : null;

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
      ? routePlan.reason
      : "",
    reachableCenters: [],
    reachableMarkers: [],
    reachableMarkerColor: AVAILABLE_COLOR,
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
    const teleportOrigin = movementPreviewOrigin(context, gridSize, movementOptions);
    if (!teleportOrigin) return { enabled: false };
    return teleportPreview(context, step, teleportOrigin, tokenFootprint(context?.token), gridSize, movementOptions);
  }

  if (isStrideStrikeStep(step)) {
    const path = step?.activityProfile?.retreatAfterStrike === true
      ? retreatStrideStrikePath(context, step, gridSize, movementOptions)
      : strideStrikePath(context, step, gridSize, movementOptions);
    return path ? { enabled: true, slug: step.slug, ...path } : { enabled: false };
  }

  // A dynamically-slugged action (e.g. "flank-strike-tentacle") can still be a genuine plain Stride
  // needing the full destination-picker/reachable-area preview -- requiresDestination is the same
  // canonical "this needs a manually-picked destination" signal requiresDestinationForAction()
  // already uses to decide whether the panel shows a "Select destination" button at all, so a step
  // that gets the button must also get the preview when that button is clicked.
  if (!MOVEMENT_SLUGS.has(step?.slug) && step?.requiresDestination !== true) return { enabled: false };

  const origin = movementPreviewOrigin(context, gridSize, movementOptions);
  if (!origin) return { enabled: false };

  const collisionToken = movementOptions.collisionToken;
  const distanceFeet = movementHorizontalBudgetForStep(context, step, movementOptions);
  const elevationDelta = verticalElevationDelta(step, collisionToken);
  const originElevation = numeric(collisionToken?.document?.elevation, 0) || 0;
  const footprint = tokenFootprint(context?.token);
  const color = AVAILABLE_COLOR;
  const centers = reachableMovementCenters(origin, distanceFeet, gridSize, movementOptions);
  const placements = centers.map((center) => placementForCenter(center, footprint, gridSize));
  const recommendation = recommendedPlacement(context, step, origin, centers, footprint, gridSize);
  const markers = reachableMarkers(origin, centers, recommendation, gridSize);
  const recommendedMarker = xMarkerForPlacement(recommendation);
  const bareReachablePreview = {
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

  // A hover candidate previews "what would clicking HERE cost" without collapsing the reachable-area
  // grid down to "remaining budget after landing there" -- unlike a real committed destination
  // (explicitMovementPreview below), which intentionally narrows since the player has actually
  // committed to ending movement there. The grid stays exactly the general/unnarrowed view; only the
  // candidate's own ghost/cost data is layered on top of it.
  if (step?.hoverOnly === true) {
    const destinationCenter = movementDestinationForStep(step);
    if (!destinationCenter) return bareReachablePreview;
    const destinationVisible = pointVisible(destinationCenter, movementOptions);
    const destinationPlacement = destinationVisible ? placementForCenter(destinationCenter, footprint, gridSize) : null;
    // Once at least one waypoint is already committed, "is this point within Speed of the ORIGIN
    // directly" ignores the mandatory detour through that waypoint entirely -- a point well within
    // direct range can easily exceed Speed once forced through an out-of-the-way waypoint first
    // (extra distance, and often worse PF2e 5-10-5 diagonal parity too). Validate the FULL bent path
    // in that case; only fall back to the plain origin BFS membership check (which also accounts for
    // wall/obstacle detours a straight-line check would miss) when there's no waypoint yet to route
    // through. The general reachable-area GRID needs the same correction -- it must reflect what's
    // still reachable from the LAST COMMITTED waypoint with whatever budget remains after it, not the
    // origin's full, unconstrained Speed. This grid depends only on the committed waypoints (never on
    // wherever the cursor currently is), so it still stays stable while hovering, exactly like the
    // origin-only bareReachablePreview did before any waypoint existed.
    //
    // The caller's own movementPlan.waypoints (destination-picker.js's candidatePlanFor) already ends
    // with this same hover destination -- movementWaypointsForStep's own dedup means
    // passing destinationCenter here is safe whether or not the caller already included it, so slicing
    // off the last entry reliably yields ONLY the truly prior/committed waypoints either way. Passing
    // `null` instead (as if the destination were never in that array) double-counted the destination as
    // its own "committed" waypoint, which both silently self-cancelled in the cost check (a harmless
    // zero-length repeat) AND made the grid re-center on wherever the cursor currently was instead of
    // staying anchored to the last REAL commit.
    const allWaypointCenters = movementWaypointsForStep(step, destinationCenter);
    const priorWaypointCenters = allWaypointCenters?.length > 1 ? allWaypointCenters.slice(0, -1) : null;
    if (priorWaypointCenters?.length) {
      const priorRoute = movementWaypointRouteForPreview(context, step, origin, priorWaypointCenters, gridSize, movementOptions);
      const remainingDistanceFeet = priorRoute.reachable ? Math.max(0, priorRoute.maxCost - priorRoute.cost) : 0;
      const waypointOrigin = priorWaypointCenters.at(-1);
      const remainingCenters = priorRoute.reachable && remainingDistanceFeet > 0
        ? reachableMovementCenters(waypointOrigin, remainingDistanceFeet, gridSize, movementOptions)
        : [];
      const remainingPlacements = remainingCenters.map((center) => placementForCenter(center, footprint, gridSize));
      const remainingMarkers = reachableMarkers(waypointOrigin, remainingCenters, null, gridSize);
      const candidateRoute = movementWaypointRouteForPreview(
        context,
        step,
        origin,
        [...priorWaypointCenters, destinationCenter],
        gridSize,
        movementOptions,
      );
      const reachable = priorRoute.reachable && candidateRoute.reachable;
      return {
        ...bareReachablePreview,
        reachableCenters: remainingCenters,
        reachablePlacements: remainingPlacements,
        reachableMarkers: remainingMarkers,
        explicitDestination: true,
        destinationCenter,
        destinationPlacement,
        destinationMarker: xMarkerForPlacement(destinationPlacement),
        destinationAvailable: destinationVisible && reachable,
      };
    }
    const reachable = centers.some((center) => center.x === destinationCenter.x && center.y === destinationCenter.y);
    return {
      ...bareReachablePreview,
      explicitDestination: true,
      destinationCenter,
      destinationPlacement,
      destinationMarker: xMarkerForPlacement(destinationPlacement),
      destinationAvailable: destinationVisible && reachable,
    };
  }

  const explicitPreview = explicitMovementPreview(context, step, origin, distanceFeet, footprint, gridSize, movementOptions);
  if (explicitPreview) return { ...explicitPreview, elevationDelta, originElevation };

  return bareReachablePreview;
}

function tokenCenter(token) {
  if (!token) return null;
  if (token.center) return { x: token.center.x, y: token.center.y };
  const document = token.document ?? token;
  const size = canvasGridSize();
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
  const sceneDistance = canvasGridDistance();
  const pixelSize = canvasGridSize();
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

// The token's own portrait texture, loaded from its document's canonical image path rather than
// introspecting the live placeable's internal mesh/children -- a Token is a container with many
// other textured children (status icons, target reticle, ring decoration, bars), so grabbing "any
// child with a .texture" risked silently matching one of those instead of the actual portrait,
// producing a ghost with the wrong size/art entirely. The image is already loaded (the real token
// is on screen using it), so PIXI.Texture.from() returns the cached texture immediately, no reload.
//
// A Dynamic Token Ring pairs its own dedicated ring.subject.texture with ring.subject.scale -- that
// image is prepared (cropped/composed) specifically to fill correctly at that scale, and can be a
// different image entirely from the generic document.texture.src. Applying subject.scale to the
// generic texture instead mismatches a scale factor with the wrong source image, which is what
// produced a ghost that was sized closer but still visibly off. Use the ring's own subject texture
// whenever the ring is enabled, matching exactly what Foundry itself renders inside the ring.
function liveTokenTexture(token) {
  const ring = token?.document?.ring;
  const src = (ring?.enabled === true && ring?.subject?.texture) || token?.document?.texture?.src;
  if (!src) return null;
  const Texture = globalThis.PIXI?.Texture;
  if (typeof Texture?.from !== "function") return null;
  try {
    return Texture.from(src);
  } catch (_error) {
    return null;
  }
}

// document.texture.scaleX/scaleY is Foundry's own "Image Scale" field on the Token Configuration
// sheet -- the ring-independent baseline for how large a token's art renders, always present whether
// or not a ring is enabled. Once a Dynamic Token Ring (Foundry v12+) IS enabled, Foundry's ring
// rendering takes over sizing the portrait entirely instead: the raw document.ring.subject.scale a
// module author configures is only an INPUT to a further internal computation (the live, rendered
// `Token#ring` -- a TokenRing instance, distinct from the raw document.ring flags -- exposes the
// actual final multiplier Foundry derived from it as `scaleCorrection * subjectScaleAdjustment *
// scaleAdjustmentX/Y`). subjectScaleAdjustment in particular compensates for however much of the
// frame the ring's own decorative border art eats into, a factor with no equivalent anywhere in the
// raw document flags -- there is no way to reproduce it by formula from document data alone. Confirmed
// against a real token (console-verified): document.ring.subject.scale was 2, but the live ring's
// true combined multiplier was 2 * 1.31897... = 2.638, matching the token's actual rendered mesh
// width/height exactly. Read the live values directly rather than re-deriving them.
function ghostSpriteScale(token) {
  const ring = token?.ring;
  if (token?.document?.ring?.enabled === true && ring) {
    const correction = numeric(ring.scaleCorrection, 1) || 1;
    const subjectAdjustment = numeric(ring.subjectScaleAdjustment, 1) || 1;
    const adjustX = numeric(ring.scaleAdjustmentX, 1) || 1;
    const adjustY = numeric(ring.scaleAdjustmentY, 1) || 1;
    return { x: correction * subjectAdjustment * adjustX, y: correction * subjectAdjustment * adjustY };
  }
  const x = numeric(token?.document?.texture?.scaleX, 1);
  const y = numeric(token?.document?.texture?.scaleY, 1);
  return { x: x > 0 ? x : 1, y: y > 0 ? y : 1 };
}

// A translucent copy of the actor's own token art at a candidate landing square, so the preview
// shows what will actually be there instead of only an abstract colored box. Best-effort: silently
// omitted (never a hard error) if this Foundry version doesn't expose a token texture the way any of
// the above paths expect, or PIXI.Sprite isn't available (e.g. this file's own headless self-tests).
// `placement` is the SAME {x, y, width, height} (scene units) object drawPlacement/drawXMarker
// already render the destination box/X from -- reusing it (rather than separately recomputing a size
// from footprint * gridSize) guarantees the ghost's un-ringed footprint size is pixel-identical to
// that box; the ring subject scale on top of it then matches the real token's rendered size.
function drawGhostToken(graphics, token, center, placement, scale) {
  if (!center || !placement || typeof graphics.addChild !== "function") return;
  const Sprite = globalThis.PIXI?.Sprite;
  if (typeof Sprite !== "function") return;
  const texture = liveTokenTexture(token);
  if (!texture) return;

  try {
    const sprite = new Sprite(texture);
    sprite.eventMode = "none";
    sprite.interactive = false;
    sprite.alpha = 0.55;
    sprite.anchor?.set?.(0.5, 0.5);
    const spriteScale = ghostSpriteScale(token);
    const width = numeric(placement.width, 0) * scale * spriteScale.x;
    const height = numeric(placement.height, 0) * scale * spriteScale.y;
    if (width > 0) sprite.width = width;
    if (height > 0) sprite.height = height;
    const rotation = numeric(token?.document?.rotation, 0);
    if (rotation) sprite.rotation = (rotation * Math.PI) / 180;
    if (typeof sprite.position?.set === "function") sprite.position.set(center.x * scale, center.y * scale);
    else {
      sprite.x = center.x * scale;
      sprite.y = center.y * scale;
    }
    graphics.addChild(sprite);
  } catch (_error) {
    // Best-effort visual flourish -- never let a texture/sprite quirk break the rest of the preview.
  }
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

function drawStridePath(graphics, origin, stridePath, scale, originElevation = 0, liveToken = null) {
  let from = origin;
  for (let index = 0; index < stridePath.length; index += 1) {
    const waypoint = stridePath[index];
    const isFinalLanding = index === stridePath.length - 1;
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
    // Only the final landing square gets the actor's own ghost token -- one per intermediate stop
    // (each stride of a composite, or each waypoint of a custom path) piled up as overlapping token
    // art on top of the trail lines/labels, which read as confusing clutter, not helpful information.
    if (isFinalLanding) {
      drawGhostToken(graphics, liveToken, waypoint.center, waypoint.placement, scale);
    } else {
      drawPlacement(graphics, waypoint.placement, scale, waypoint.color, 0.05, DESTINATION_BORDER_COLOR, 0.96, 3);
      drawXMarker(graphics, waypoint.marker, scale, waypoint.color);
    }
    drawWaypointIndicators(graphics, waypoint.waypoints, scale, waypoint.color);
    // Label intermediate waypoints with their own heights; the final point (destination) is labelled
    // by the live readout above, so drop it here to avoid a doubled tag.
    drawWaypointElevationLabels(graphics, waypoint.waypoints?.slice(0, -1), originElevation, scale);
    drawSegmentLabels(graphics, waypoint.segmentLabels, scale);
  }
}

export function clearMovementPreview() {
  clearHoverGhost();
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
      plannedCenter: toScene(rawContext.token?.plannedCenter),
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

export { engineRouteCornerWaypoints as routeCornerWaypoints };

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

  const waypoints = engineRouteCornerWaypoints(preview.origin, match.route, scale);
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
  const waypoints = engineRouteCornerWaypoints(preview.origin, recommended.route, scale);
  return { destination, ...(waypoints.length ? { waypoints } : {}) };
}

export function showMovementPreview(context, step) {
  clearMovementPreview();

  const PIXI = globalThis.PIXI;
  const layer = previewLayer();
  if (!PIXI?.Graphics || !layer?.addChild) return null;

  const { preview, scale } = computeMovementPreview(context, step);
  if (!preview.enabled) return null;

  const liveToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const graphics = new PIXI.Graphics();
  if (preview.teleport) {
    // Range ring marking how far the teleport reaches (green, matching "available"), plus the
    // chosen destination box (gold if reachable, red if beyond the spell's range).
    if (Number.isFinite(preview.teleportRange) && preview.teleportRange > 0 && typeof graphics.drawCircle === "function") {
      const cx = preview.origin.x * scale;
      const cy = preview.origin.y * scale;
      const radius = preview.teleportRange * scale;
      graphics.beginFill(AVAILABLE_COLOR, 0.04);
      graphics.lineStyle(6, 0x101418, 0.6);
      graphics.drawCircle(cx, cy, radius);
      graphics.lineStyle(3, AVAILABLE_COLOR, 0.9);
      graphics.drawCircle(cx, cy, radius);
      graphics.endFill();
    }
    if (preview.destinationPlacement) {
      // A reachable destination shows only the actor's own ghost token -- the box/X was redundant
      // once the ghost already marks the spot, and reusing them together read as visual clutter. An
      // unreachable one has no real "landing" to ghost, so it keeps the plain red box/X instead.
      if (preview.destinationAvailable === false) {
        drawPlacement(graphics, preview.destinationPlacement, scale, UNAVAILABLE_COLOR, 0.06, UNAVAILABLE_COLOR, 1, 3);
        drawXMarker(graphics, preview.destinationMarker, scale, UNAVAILABLE_COLOR);
      } else {
        drawGhostToken(graphics, liveToken, preview.destinationCenter, preview.destinationPlacement, scale);
      }
    }
  } else if (preview.stridePath?.length) {
    // The remaining reachable area after the path is always green, matching every other
    // "available" square. drawStridePath itself ghosts the final landing square only
    // (stridePath is only ever populated with a legal, reachable route).
    drawStridePath(graphics, preview.origin, preview.stridePath, scale, preview.originElevation, liveToken);
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, AVAILABLE_COLOR, 0.025, AVAILABLE_COLOR, 0.88, 2);
    }
  } else if (preview.explicitDestination) {
    // A hover-only candidate keeps the general reachable-area grid fully visible underneath its own
    // ghost/box -- for a real committed destination this array is always empty, so the loop is a
    // no-op there.
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, AVAILABLE_COLOR, 0.025, AVAILABLE_COLOR, 0.88, 2);
    }
    if (preview.destinationPlacement) {
      // Same box-vs-ghost split as the teleport branch above.
      if (!preview.destinationAvailable) {
        drawPlacement(graphics, preview.destinationPlacement, scale, UNAVAILABLE_COLOR, 0.06, UNAVAILABLE_COLOR, 1, 3);
        drawXMarker(graphics, preview.destinationMarker, scale, UNAVAILABLE_COLOR);
      } else {
        drawGhostToken(graphics, liveToken, preview.destinationCenter, preview.destinationPlacement, scale);
      }
    }
  } else {
    // Show only the reachable squares — no recommended-destination X. The X read as a
    // selection even though the player hadn't chosen a destination yet.
    for (const marker of preview.reachableMarkers ?? []) {
      drawPlacement(graphics, marker, scale, AVAILABLE_COLOR, 0.025, AVAILABLE_COLOR, 0.88, 2);
    }
  }

  // Circle the Stride's starting square so it's clear where the movement begins.
  drawOriginMarker(graphics, preview.origin, preview.footprint, scale, AVAILABLE_COLOR);
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

let hoverGraphics = null;

export function clearHoverGhost() {
  if (!hoverGraphics) return;
  const graphics = hoverGraphics;
  hoverGraphics = null;
  graphics.parent?.removeChild?.(graphics);
  graphics.destroy?.({ children: true });
}

// A lightweight, independently-updated overlay for the destination candidate under the cursor --
// deliberately separate from showMovementPreview's persistent reachable-area grid (a couple hundred
// individual rectangles for a typical Speed), which must never be cleared/redrawn on every
// mouse-move frame -- doing so made the grid appear to flicker down to just whatever was near the
// cursor instead of staying a stable, full view. Hovering only ever touches this small, separate
// graphics object; the grid stays exactly as it was until a real click commits a destination/
// waypoint (which calls showMovementPreview again, replacing this ghost with its own).
export function showHoverGhost(context, step, destinationPoint) {
  clearHoverGhost();

  const PIXI = globalThis.PIXI;
  const layer = previewLayer();
  if (!PIXI?.Graphics || !layer?.addChild || !destinationPoint) return null;

  const queryStep = { ...(step ?? {}), destination: destinationPoint, hoverOnly: true };
  const { preview, scale } = computeMovementPreview(context, queryStep);
  if (!preview?.enabled || !preview.destinationPlacement) return null;

  const liveToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const graphics = new PIXI.Graphics();
  if (preview.destinationAvailable === false) {
    drawPlacement(graphics, preview.destinationPlacement, scale, UNAVAILABLE_COLOR, 0.06, UNAVAILABLE_COLOR, 1, 3);
    drawXMarker(graphics, preview.destinationMarker, scale, UNAVAILABLE_COLOR);
  } else {
    drawGhostToken(graphics, liveToken, preview.destinationCenter, preview.destinationPlacement, scale);
  }
  const pendingElevation = Number.isFinite(preview.elevationDelta)
    ? (Number(preview.originElevation) || 0) + preview.elevationDelta
    : NaN;
  drawElevationLabel(graphics, preview.destinationCenter, pendingElevation, preview.originElevation, preview.footprint, scale);

  graphics.zIndex = 10_001; // above the persistent reachable-area grid (10_000)
  layer.sortableChildren = true;
  layer.addChild(graphics);
  hoverGraphics = graphics;
  return preview;
}
