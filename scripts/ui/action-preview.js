import { clearMovementPreview, showMovementPreview } from "./movement-preview.js";
import { previewLayer } from "./preview-layer.js";
import { clearRangeOverlay, showRangeOverlay, spellRangeFeet } from "./range-overlay.js";

let actionPreviewGraphics = null;

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  const source = value?.center ?? value;
  const x = numeric(source?.x ?? source?.[0], NaN);
  const y = numeric(source?.y ?? source?.[1], NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function gridSize() {
  return numeric(globalThis.canvas?.grid?.size, 1) || 1;
}

function gridDistance() {
  return numeric(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.grid?.distance, 5) || 5;
}

function distancePixels(distance) {
  return (numeric(distance, 5) / gridDistance()) * gridSize();
}

function canvasTokenById(id) {
  if (!id) return null;
  return (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id || token?.uuid === id || document?.id === id || document?.uuid === id;
  }) ?? null;
}

function tokenCenter(token) {
  return point(token?.center) ?? point({
    x: numeric(token?.document?.x ?? token?.x, 0) + (numeric(token?.document?.width ?? token?.width, 1) * gridSize()) / 2,
    y: numeric(token?.document?.y ?? token?.y, 0) + (numeric(token?.document?.height ?? token?.height, 1) * gridSize()) / 2,
  });
}

function tokenPlacement(token) {
  const center = tokenCenter(token);
  if (!center) return null;
  const document = token?.document ?? token;
  const width = Math.max(1, numeric(token?.width ?? document?.width, 1)) * gridSize();
  const height = Math.max(1, numeric(token?.height ?? document?.height, 1)) * gridSize();
  return {
    center,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

function targetIdentity(value) {
  return value?.id
    ?? value?.uuid
    ?? value?.token?.id
    ?? value?.token?.uuid
    ?? value?.document?.id
    ?? value?.document?.uuid
    ?? null;
}

function targetName(value) {
  return value?.name ?? value?.label ?? value?.token?.name ?? value?.document?.name ?? null;
}

function targetValues(context) {
  return [
    ...(context?.battlefield?.targets ?? []),
    ...(context?.targets ?? []),
    ...(context?.battlefield?.enemies ?? []),
    ...(context?.enemies ?? []),
  ].filter(Boolean);
}

function targetTokenFromValue(value) {
  return canvasTokenById(targetIdentity(value))
    ?? canvasTokenById(value?.token?.id)
    ?? canvasTokenById(value?.token?.uuid)
    ?? canvasTokenById(value?.document?.id)
    ?? canvasTokenById(value?.document?.uuid);
}

function plannedTargetTokens(context, step) {
  const ids = [
    ...(Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : []),
    ...(Array.isArray(step?.action?.targetTokenIds) ? step.action.targetTokenIds : []),
  ];
  const tokens = ids.map(canvasTokenById).filter(Boolean);
  if (tokens.length) return tokens;

  const directTargets = [
    step?.suggestedTarget,
    step?.preferredTarget,
    step?.target,
    step?.action?.suggestedTarget,
    step?.action?.preferredTarget,
    step?.action?.target,
  ].filter(Boolean);
  for (const target of directTargets) {
    const token = targetTokenFromValue(target);
    if (token) return [token];
  }

  const preferredId = step?.targetingProfile?.preferredTargetId ?? step?.action?.targetingProfile?.preferredTargetId;
  const preferredName = step?.targetingProfile?.preferredTargetName ?? step?.action?.targetingProfile?.preferredTargetName;
  const values = targetValues(context);
  const target = preferredId
    ? values.find((entry) => targetIdentity(entry) === preferredId)
    : preferredName
      ? values.find((entry) => targetName(entry) === preferredName)
      : null;
  const inferredToken = targetTokenFromValue(target ?? values[0]);
  return inferredToken ? [inferredToken] : [];
}

function areaMarker(step) {
  return step?.areaMarker ?? step?.action?.areaMarker ?? null;
}

// True for spells that place a template (burst/cone/line/emanation), whether or not the area has
// been positioned yet — they target an area, so the token-target highlight never applies to them.
function isAreaSpell(step) {
  const profile = step?.targetingProfile ?? step?.action?.targetingProfile ?? {};
  return profile.area === true
    || Boolean(profile.type ?? profile.shape)
    || (Array.isArray(profile.templates) && profile.templates.length > 0);
}

function areaShape(step, marker) {
  return String(
    marker?.shape
      ?? marker?.type
      ?? step?.targetingProfile?.type
      ?? step?.targetingProfile?.shape
      ?? step?.action?.targetingProfile?.type
      ?? "burst",
  ).toLowerCase();
}

function areaDistance(step, marker) {
  return numeric(
    marker?.distance
      ?? marker?.radius
      ?? step?.targetingProfile?.distance
      ?? step?.targetingProfile?.radius
      ?? step?.action?.targetingProfile?.distance,
    5,
  );
}

function areaWidth(step, marker) {
  return numeric(
    marker?.width
      ?? step?.targetingProfile?.width
      ?? step?.action?.targetingProfile?.width,
    5,
  );
}

function setupShapeStyle(graphics, fill, line, alpha = 0.1) {
  graphics.lineStyle?.(5, 0x101418, 0.85);
  graphics.beginFill?.(fill, alpha);
  return () => {
    graphics.endFill?.();
    graphics.lineStyle?.(3, line, 0.98);
  };
}

function drawRectShape(graphics, x, y, width, height, color = 0xf0b34a, alpha = 0.1) {
  const stroke = setupShapeStyle(graphics, color, color, alpha);
  graphics.drawRect?.(x, y, width, height);
  stroke();
  graphics.drawRect?.(x, y, width, height);
}

function drawCircleShape(graphics, center, radius, color = 0xf0b34a, alpha = 0.1) {
  const stroke = setupShapeStyle(graphics, color, color, alpha);
  graphics.drawCircle?.(center.x, center.y, radius);
  stroke();
  graphics.drawCircle?.(center.x, center.y, radius);
}

function drawLineShape(graphics, center, length, width, rotation, color = 0xf0b34a, alpha = 0.1) {
  const radians = (rotation * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const px = -dy * width / 2;
  const py = dx * width / 2;
  const sx = center.x;
  const sy = center.y;
  const ex = center.x + dx * length;
  const ey = center.y + dy * length;
  const points = [sx + px, sy + py, ex + px, ey + py, ex - px, ey - py, sx - px, sy - py];
  const stroke = setupShapeStyle(graphics, color, color, alpha);
  graphics.drawPolygon?.(points);
  stroke();
  graphics.drawPolygon?.(points);
}

function drawConeShape(graphics, center, radius, angle, rotation, color = 0xf0b34a, alpha = 0.1) {
  const start = ((rotation - angle / 2) * Math.PI) / 180;
  const end = ((rotation + angle / 2) * Math.PI) / 180;
  const stroke = setupShapeStyle(graphics, color, color, alpha);
  if (typeof graphics.arc === "function") {
    graphics.moveTo?.(center.x, center.y);
    graphics.lineTo?.(center.x + Math.cos(start) * radius, center.y + Math.sin(start) * radius);
    graphics.arc(center.x, center.y, radius, start, end);
    graphics.lineTo?.(center.x, center.y);
  } else {
    graphics.drawCircle?.(center.x, center.y, radius);
  }
  stroke();
  if (typeof graphics.arc === "function") {
    graphics.moveTo?.(center.x, center.y);
    graphics.lineTo?.(center.x + Math.cos(start) * radius, center.y + Math.sin(start) * radius);
    graphics.arc(center.x, center.y, radius, start, end);
    graphics.lineTo?.(center.x, center.y);
  } else {
    graphics.drawCircle?.(center.x, center.y, radius);
  }
}

function drawTargetPreview(graphics, tokens) {
  // No actor->target connector line: to a distant target it stretched a green line across the whole
  // scene on hover, which read as a full-scene overlay. Just outline the target token itself.
  for (const token of tokens) {
    const placement = tokenPlacement(token);
    if (!placement) continue;
    drawRectShape(graphics, placement.x, placement.y, placement.width, placement.height, 0x66c78f);
  }
}

function drawAreaPreview(graphics, step) {
  const marker = areaMarker(step);
  const center = point(marker?.center ?? marker);
  if (!center) return false;
  const shape = areaShape(step, marker);
  const distance = distancePixels(areaDistance(step, marker));
  const width = distancePixels(areaWidth(step, marker));
  const rotation = numeric(marker?.rotation, 0);

  // Outline only (alpha 0) — the dim area fill read as a heavy overlay; the shape ring is enough.
  if (shape === "line") {
    drawLineShape(graphics, center, distance, width, rotation, 0xf0b34a, 0);
  } else if (shape === "cone") {
    drawConeShape(graphics, center, distance, numeric(marker?.angle, 90) || 90, rotation, 0xf0b34a, 0);
  } else if (shape === "square" || shape === "cube") {
    drawRectShape(graphics, center.x - distance / 2, center.y - distance / 2, distance, distance, 0xf0b34a, 0);
  } else {
    drawCircleShape(graphics, center, distance, 0xf0b34a, 0);
  }
  return true;
}

function mountGraphics(graphics) {
  const layer = previewLayer();
  if (!layer?.addChild) return false;
  graphics.zIndex = 10_001;
  layer.sortableChildren = true;
  layer.addChild(graphics);
  actionPreviewGraphics = graphics;
  return true;
}

export function clearActionPreview() {
  clearMovementPreview();
  clearRangeOverlay();
  if (!actionPreviewGraphics) return;
  const graphics = actionPreviewGraphics;
  actionPreviewGraphics = null;
  graphics.parent?.removeChild?.(graphics);
  graphics.destroy?.({ children: true });
}

export function showActionPreview(context, step, { skipMovement = false } = {}) {
  clearActionPreview();

  // An executed step's movement is already spent, so the stride path is stale noise on hover.
  // Callers pass skipMovement for done steps; other overlays (target, area, range) still show.
  if (!skipMovement) {
    const movementPreview = showMovementPreview(context, step);
    if (movementPreview?.enabled) return { type: "movement", preview: movementPreview };
  }

  const PIXI = globalThis.PIXI;
  if (!PIXI?.Graphics) return null;
  const graphics = new PIXI.Graphics();

  // A settled area template shows no range ring — the ring only guides placement, which
  // the area-placement loop handles. Clear any ring left over from that loop.
  if (drawAreaPreview(graphics, step)) {
    clearRangeOverlay();
    return mountGraphics(graphics) ? { type: "area", marker: areaMarker(step) } : null;
  }

  // Only ranged spells get a hover preview (target highlight + range ring) as placement guidance.
  // Strikes and general actions — including self-targeted ones like Drop Prone — draw NOTHING:
  // the green target overlay was scene noise, and for self/no-target actions it highlighted a
  // random fallback enemy.
  const isRangedSpell = spellRangeFeet(step) != null;
  if (isRangedSpell) {
    // An area spell whose template isn't placed yet targets an AREA, not tokens — show only the
    // range ring (where the template can be dropped), never the green target-highlight dim.
    if (isAreaSpell(step)) {
      graphics.destroy?.({ children: true });
      const ring = showRangeOverlay(context, step);
      return ring ? { type: "range", ring } : null;
    }
    const tokens = plannedTargetTokens(context, step);
    if (tokens.length) {
      drawTargetPreview(graphics, tokens);
      showRangeOverlay(context, step);
      return mountGraphics(graphics) ? { type: "target", tokens } : null;
    }
    graphics.destroy?.({ children: true });
    const ring = showRangeOverlay(context, step);
    return ring ? { type: "range", ring } : null;
  }

  graphics.destroy?.({ children: true });
  clearRangeOverlay();
  return null;
}
