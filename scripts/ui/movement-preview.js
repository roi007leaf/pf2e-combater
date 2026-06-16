const MOVEMENT_SLUGS = new Set(["stride", "step"]);
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

function profileSpeed(context) {
  const profile = context?.actor?.profile ?? context?.profile ?? {};
  const speed = profile.speed?.value ?? profile.speed ?? profile.landSpeed;
  return numeric(speed, 25) || 25;
}

function movementDistanceFeet(context, step) {
  if (step?.slug === "step") return 5;
  if (step?.slug === "stride") return profileSpeed(context);
  return 0;
}

function reachableCenters(origin, distanceFeet, gridSize) {
  const cells = Math.floor(distanceFeet / gridSize);
  const centers = [];
  for (let dx = -cells; dx <= cells; dx += 1) {
    for (let dy = -cells; dy <= cells; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy)) * gridSize;
      if (distance > distanceFeet) continue;
      centers.push({
        x: origin.x + dx * gridSize,
        y: origin.y + dy * gridSize,
      });
    }
  }
  return centers;
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

function recommendedPlacement(context, origin, reachable, footprint, gridSize) {
  const target = context?.battlefield?.targets?.[0] ?? context?.targets?.[0] ?? null;
  const targetCenter = point(target);
  if (!targetCenter || !reachable.length) return null;

  const targetPlacement = placementForCenter(targetCenter, tokenFootprint(target), gridSize);
  return reachable.map((center) => placementForCenter(center, footprint, gridSize)).toSorted((left, right) => {
    const leftDistance = rectangleDistance(left, targetPlacement);
    const rightDistance = rectangleDistance(right, targetPlacement);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return Math.hypot(origin.x - left.center.x, origin.y - left.center.y)
      - Math.hypot(origin.x - right.center.x, origin.y - right.center.y);
  })[0] ?? null;
}

// Distinct colour per Stride in a move-and-strike composite, so each leg of the
// path reads as its own move when hovering.
const STRIDE_COLORS = [0x5aa0e0, 0xe0b35a, 0x9b6dd6];

function isStrideStrikeStep(step) {
  return step?.activityProfile?.includesStrike === true
    && Number(step?.activityProfile?.strideCount) >= 1;
}

function snapToOrigin(value, origin, gridSize) {
  return origin + Math.round((value - origin) / gridSize) * gridSize;
}

// Where each Stride lands on the way to the target: split the straight path from
// the origin to the final (in-reach) cell into `strideCount` equal legs.
function strideStrikePath(context, step, gridSize) {
  const origin = point(context?.token);
  if (!origin) return null;

  const strideCount = Math.max(1, Math.floor(Number(step?.activityProfile?.strideCount) || 1));
  const speed = profileSpeed(context);
  const footprint = tokenFootprint(context?.token);
  const centers = reachableCenters(origin, strideCount * speed, gridSize);
  const destination = recommendedPlacement(context, origin, centers, footprint, gridSize);
  if (!destination) return null;

  const destCenter = destination.center;
  const stridePath = [];
  for (let index = 1; index <= strideCount; index += 1) {
    const fraction = index / strideCount;
    const center = index === strideCount
      ? destCenter
      : {
        x: snapToOrigin(origin.x + (destCenter.x - origin.x) * fraction, origin.x, gridSize),
        y: snapToOrigin(origin.y + (destCenter.y - origin.y) * fraction, origin.y, gridSize),
      };
    const placement = placementForCenter(center, footprint, gridSize);
    stridePath.push({
      index,
      center,
      placement,
      marker: xMarkerForPlacement(placement),
      color: STRIDE_COLORS[(index - 1) % STRIDE_COLORS.length],
    });
  }

  return { origin, strideCount, destinationCenter: destCenter, footprint, stridePath };
}

export function movementPreviewForStep(context, step, options = {}) {
  const gridSize = numeric(options.gridSize, 5) || 5;

  if (isStrideStrikeStep(step)) {
    const path = strideStrikePath(context, step, gridSize);
    return path ? { enabled: true, slug: step.slug, ...path } : { enabled: false };
  }

  if (!MOVEMENT_SLUGS.has(step?.slug)) return { enabled: false };

  const origin = point(context?.token);
  if (!origin) return { enabled: false };

  const distanceFeet = movementDistanceFeet(context, step);
  const footprint = tokenFootprint(context?.token);
  const centers = reachableCenters(origin, distanceFeet, gridSize);
  const placements = centers.map((center) => placementForCenter(center, footprint, gridSize));
  const recommendation = recommendedPlacement(context, origin, centers, footprint, gridSize);
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

function canvasContext(context) {
  const activeToken = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const target = context?.battlefield?.targets?.[0] ?? context?.targets?.[0] ?? null;
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
    graphics.moveTo(from.x * scale, from.y * scale);
    graphics.lineTo(waypoint.center.x * scale, waypoint.center.y * scale);
    drawPlacement(graphics, waypoint.placement, scale, waypoint.color, 0.16, waypoint.color, 0.6);
    drawXMarker(graphics, waypoint.marker, scale, waypoint.color);
    from = waypoint.center;
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
  const rawContext = canvasContext(context);
  const toScene = (center) => center ? ({ x: center.x / scale, y: center.y / scale }) : null;
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
  const preview = movementPreviewForStep(sceneContext, step, { gridSize: sceneDistance });
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
