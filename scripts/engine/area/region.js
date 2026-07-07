import { isSelfCenteredAreaAction } from "../action/requirements.js";
import { canvasDistancePixels as distancePixels, canvasGridSize as gridSize, canvasPoint as point, canvasTokenById, contextTokenId, numeric } from "../../rules/canvas-geometry.js";
import { movementFootprintForToken } from "../../rules/token-geometry.js";

const AREA_MARKER_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);

function tokenFootprint(token, context) {
  const source = token && context?.token
    ? {
      ...context.token,
      ...token,
      width: token.width ?? context.token.width,
      height: token.height ?? context.token.height,
      document: token.document ?? context.token.document,
    }
    : (token ?? context?.token);
  const footprint = movementFootprintForToken(source);
  return {
    width: footprint.widthCells,
    height: footprint.heightCells,
  };
}

function tokenBase(context) {
  const token = canvasTokenById(contextTokenId(context));
  const size = gridSize();
  const center = point(token?.center) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const footprint = tokenFootprint(token, context);
  return {
    type: "token",
    x: center.x - (footprint.width * size) / 2,
    y: center.y - (footprint.height * size) / 2,
    width: footprint.width * size,
    height: footprint.height * size,
  };
}

export function areaRegionType(action, marker) {
  return String(
    marker?.shape
    ?? marker?.type
    ?? action?.targetingProfile?.type
    ?? action?.targetingProfile?.shape
    ?? action?.action?.targetingProfile?.type
    ?? action?.action?.targetingProfile?.shape
    ?? action?.area?.type
    ?? "burst",
  ).toLowerCase();
}

export function areaMarkerShape(action, fallback = "burst") {
  const value = areaRegionType(action, null);
  return AREA_MARKER_SHAPES.has(value) ? value : fallback;
}

export function areaRegionDistance(action, marker = null, fallback = 5) {
  return numeric(
    marker?.distance
      ?? marker?.radius
      ?? action?.targetingProfile?.distance
      ?? action?.targetingProfile?.radius
      ?? action?.action?.targetingProfile?.distance
      ?? action?.action?.targetingProfile?.radius,
    fallback,
  ) || fallback;
}

export function areaRegionWidth(action, marker = null, fallback = globalThis.canvas?.grid?.size ?? areaRegionDistance(action, marker)) {
  return numeric(
    marker?.width
      ?? action?.targetingProfile?.width
      ?? action?.action?.targetingProfile?.width,
    fallback,
  ) || areaRegionDistance(action, marker);
}

export function areaMarkerLabel(shape, distance) {
  return `${shape.charAt(0).toUpperCase()}${shape.slice(1)} ${distance} ft`;
}

export function createAreaRegionData({ context, action, marker }) {
  const center = point(marker?.center) ?? point(marker) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  const type = areaRegionType(action, marker);
  const distance = areaRegionDistance(action, marker);
  const width = areaRegionWidth(action, marker);
  const distancePx = distancePixels(distance);
  const widthPx = distancePixels(width);
  const rotation = numeric(marker?.rotation, 0) || 0;
  const baseShape = { x: center.x, y: center.y };
  let shape;

  if (type === "cone") {
    shape = { ...baseShape, type: "cone", radius: distancePx, angle: numeric(marker?.angle, 90) || 90, rotation };
  } else if (type === "line") {
    shape = { ...baseShape, type: "line", length: distancePx, width: widthPx, rotation };
  } else if (type === "cube" || type === "square") {
    shape = { ...baseShape, type: "rectangle", width: distancePx, height: distancePx, rotation };
  } else if (type === "emanation") {
    const base = isSelfCenteredAreaAction(action) ? tokenBase(context) : null;
    const halfFootprint = base ? Math.max(base.width, base.height) / 2 : 0;
    shape = { ...baseShape, type: "circle", radius: distancePx + halfFootprint };
  } else if (type === "ring") {
    shape = {
      ...baseShape,
      type: "ring",
      radius: distancePx,
      innerWidth: distancePixels(numeric(marker?.innerWidth ?? action?.targetingProfile?.innerWidth, Math.max(0, distance - width)) || 0),
      outerWidth: widthPx,
    };
  } else {
    shape = { ...baseShape, type: "circle", radius: distancePx };
  }

  const originUuid = action?.item?.uuid ?? action?.uuid ?? null;
  const flags = { pf2e: { areaShape: type } };
  if (originUuid) flags["pf2e-combater"] = { originUuid };

  return {
    name: marker?.label ?? action?.name ?? "Planned area",
    shapes: [shape],
    color: marker?.color ?? "#f0b34a",
    highlightMode: "coverage",
    displayMeasurements: true,
    visibility: globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? 1,
    flags,
  };
}

function pointInAreaShape(value, shape) {
  const dx = value.x - shape.x;
  const dy = value.y - shape.y;
  switch (shape.type) {
    case "circle":
    case "emanation":
      return dx * dx + dy * dy <= shape.radius * shape.radius;
    case "ring": {
      const distance = Math.hypot(dx, dy);
      const inner = Math.max(0, numeric(shape.radius, 0) - numeric(shape.outerWidth, 0));
      return distance <= shape.radius && distance >= inner;
    }
    case "cone": {
      const distance = Math.hypot(dx, dy);
      if (distance > shape.radius) return false;
      if (distance === 0) return true;
      const pointAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const half = (numeric(shape.angle, 90) || 90) / 2;
      const delta = ((((pointAngle - numeric(shape.rotation, 0)) % 360) + 540) % 360) - 180;
      return Math.abs(delta) <= half;
    }
    case "line": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const along = dx * cos + dy * sin;
      const perpendicular = -dx * sin + dy * cos;
      return along >= 0 && along <= shape.length && Math.abs(perpendicular) <= shape.width / 2;
    }
    case "rectangle": {
      const radians = (numeric(shape.rotation, 0) * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const localX = dx * cos + dy * sin;
      const localY = -dx * sin + dy * cos;
      return localX >= 0 && localX <= shape.width && localY >= 0 && localY <= shape.height;
    }
    default:
      return false;
  }
}

export function tokensInAreaMarker({ context, action, marker }) {
  const shape = createAreaRegionData({ context, action, marker })?.shapes?.[0];
  if (!shape) return [];
  return (globalThis.canvas?.tokens?.placeables ?? []).filter((token) => {
    const center = point(token?.center);
    return center && pointInAreaShape(center, shape);
  });
}
