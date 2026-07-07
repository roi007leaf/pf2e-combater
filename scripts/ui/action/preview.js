import { clearMovementPreview, showMovementPreview } from "../movement-preview.js";
import { previewLayer } from "../preview-layer.js";
import { clearRangeOverlay, showRangeOverlay, spellRangeFeet } from "../range-overlay.js";
import { computeAreaMarker } from "../../engine/action/builder-projection.js";
import { areaRegionDistance, areaRegionType, areaRegionWidth } from "../../engine/area/region.js";
import { canvasDistancePixels as distancePixels, canvasGridSize as gridSize, canvasPoint as point, canvasTokenById, numeric } from "../../rules/canvas-geometry.js";

let actionPreviewGraphics = null;

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
  // document.width/height are the TokenDocument's grid-unit size (1, 2, 4...). The live Token
  // placeable's own .width/.height can be a pixel-space value on some Foundry/module combinations
  // (confirmed live: a Large creature rendered a rectangle thousands of pixels wide/tall because
  // token.width was already in pixels, then got multiplied by gridSize() a second time) — always
  // prefer the document's grid-unit field and only fall back to the placeable's when it's absent.
  const width = Math.max(1, numeric(document?.width ?? token?.width, 1)) * gridSize();
  const height = Math.max(1, numeric(document?.height ?? token?.height, 1)) * gridSize();
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
  const tokens = ids.map((id) => canvasTokenById(id)).filter(Boolean);
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

function resolvedTargetType(step) {
  return step?.suggestedTarget?.type
    ?? step?.action?.suggestedTarget?.type
    ?? null;
}

// Deliberately stricter than plannedTargetTokens: no fallback to targetingProfile
// preferredTargetId/Name matching or "first enemy in the list" guessing. Only resolves a
// token when the action's own scored suggestedTarget says "enemy" AND a real canvas token
// backs it up — a blind guess here is exactly what made a self-targeted action highlight a
// random enemy before this feature got disabled entirely.
function enemyTargetTokens(context, step) {
  if (resolvedTargetType(step) !== "enemy") return [];

  const ids = [
    ...(Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : []),
    ...(Array.isArray(step?.action?.targetTokenIds) ? step.action.targetTokenIds : []),
  ];
  const tokens = ids.map((id) => canvasTokenById(id)).filter(Boolean);
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
  return [];
}

function areaMarker(context, step) {
  return step?.areaMarker
    ?? step?.action?.areaMarker
    ?? computeAreaMarker(context, step)
    ?? computeAreaMarker(context, step?.action)
    ?? null;
}

// True for spells that place a template (burst/cone/line/emanation), whether or not the area has
// been positioned yet — they target an area, so the token-target highlight never applies to them.
function isAreaSpell(step) {
  const profile = step?.targetingProfile ?? step?.action?.targetingProfile ?? {};
  return profile.area === true
    || Boolean(profile.type ?? profile.shape)
    || (Array.isArray(profile.templates) && profile.templates.length > 0);
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

function drawAreaPreview(graphics, context, step) {
  const marker = areaMarker(context, step);
  const center = point(marker?.center ?? marker);
  if (!center) return null;
  const shape = areaRegionType(step, marker);
  const distance = distancePixels(areaRegionDistance(step, marker));
  const width = distancePixels(areaRegionWidth(step, marker, 5));
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
  return marker;
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

  const PIXI = globalThis.PIXI;

  // An executed step's movement is already spent, so the stride path is stale noise on hover.
  // Callers pass skipMovement for done steps; other overlays (target, area, range) still show.
  if (!skipMovement) {
    const movementPreview = showMovementPreview(context, step);
    if (movementPreview?.enabled) {
      // A move-and-strike composite (Flank, skirmish, etc.) only shows its stride path here --
      // nothing communicates WHICH enemy the Strike at the end targets, so it reads as a bare,
      // unexplained Stride. Layer the same green target highlight a plain Strike gets on top, so
      // hovering shows the full "move here, then hit this" picture instead of only the movement leg.
      if (step?.activityProfile?.includesStrike === true && PIXI?.Graphics) {
        const tokens = plannedTargetTokens(context, step);
        if (tokens.length) {
          const targetGraphics = new PIXI.Graphics();
          drawTargetPreview(targetGraphics, tokens);
          mountGraphics(targetGraphics);
        }
      }
      return { type: "movement", preview: movementPreview };
    }
  }

  if (!PIXI?.Graphics) return null;
  const graphics = new PIXI.Graphics();

  // A settled area template shows no range ring — the ring only guides placement, which
  // the area-placement loop handles. Clear any ring left over from that loop.
  const previewAreaMarker = drawAreaPreview(graphics, context, step);
  if (previewAreaMarker) {
    clearRangeOverlay();
    return mountGraphics(graphics) ? { type: "area", marker: previewAreaMarker } : null;
  }

  // Ranged spells get a hover preview (target highlight + range ring) as placement guidance.
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

  // Strikes and other non-spell actions: highlight the resolved target only when the action's
  // own scoring says it targets an enemy (suggestedTarget.type === "enemy"). Self-targeted
  // actions (Drop Prone, Raise a Shield) and ally-targeted ones (heals) never reach this — that
  // gate is what keeps this from repeating the old "random fallback enemy" bug.
  const enemyTokens = enemyTargetTokens(context, step);
  if (enemyTokens.length) {
    drawTargetPreview(graphics, enemyTokens);
    clearRangeOverlay();
    return mountGraphics(graphics) ? { type: "target", tokens: enemyTokens } : null;
  }

  graphics.destroy?.({ children: true });
  clearRangeOverlay();
  return null;
}
