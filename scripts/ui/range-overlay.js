import { previewLayer } from "./preview-layer.js";
import { t } from "../i18n.js";
import {
  canvasGridSize as gridSize,
  canvasPixelsPerFoot as pixelScale,
  canvasPoint as point,
  canvasTokenById,
  numeric,
} from "../rules/canvas-geometry.js";

// Visual-only guidance: a ring at a spell's max range around the caster, with the
// canvas dimmed outside it. It never blocks placing a template or picking a target —
// it just shows how far the spell can reach. No ring is drawn for spells with no
// meaningful placement choice (self / emanation / touch-only / unlimited range).

const RING_COLOR = 0x8ab4ff;
const DIM_COLOR = 0x05070b;
const DIM_ALPHA = 0.3;

// On-screen font size held constant across zoom by counter-scaling the labels.
const LABEL_SCREEN_PX = 26;

let rangeContainer = null;
let placementOrigin = null;
let placementMaxFeet = null;
let placementLabel = null;
let capLabel = null;
let panHookId = null;

function tokenCenter(token) {
  if (!token) return null;
  return point(token.center) ?? point({
    x: numeric(token.document?.x ?? token.x, 0) + (numeric(token.document?.width ?? token.width, 1) * gridSize()) / 2,
    y: numeric(token.document?.y ?? token.y, 0) + (numeric(token.document?.height ?? token.height, 1) * gridSize()) / 2,
  });
}

function isSpellAction(action) {
  const candidates = [action, action?.action].filter(Boolean);
  return candidates.some((source) =>
    String(source?.source ?? "").startsWith("spell")
    || source?.activityProfile?.spell === true
    || source?.item?.type === "spell");
}

function rangeFromSource(source) {
  const range = source?.targetingProfile?.maxRange
    ?? source?.targetingProfile?.range
    ?? source?.range?.max
    ?? source?.range?.increment;
  const feet = Number(range);
  return Number.isFinite(feet) && feet > 0 ? feet : null;
}

function baseRangeFeet(action) {
  if (!isSpellAction(action)) return null;
  for (const source of [action, action?.action].filter(Boolean)) {
    const feet = rangeFromSource(source);
    if (feet != null) return feet;
  }
  return null;
}

// A range bonus injected by the caller — e.g. +30 ft when a Reach Spell (rangeBuff)
// step precedes this spell in the plan.
function rangeBonusFeet(action) {
  for (const source of [action, action?.action].filter(Boolean)) {
    const bonus = Number(source?.rangeBonusFeet);
    if (Number.isFinite(bonus) && bonus > 0) return bonus;
  }
  return 0;
}

// Effective spell max range in feet, or null when there is no ring to draw. Reads the
// same fields scoring.maxRange / spell-classifier's readRangeProfile populate, looking
// at both the step and its nested action. Self / emanation / unlimited spells carry no
// maxRange and so resolve to null. A rangeBonusFeet (Reach Spell) extends the range:
// touch (≤5 ft) becomes 30 ft, any other range gains the bonus.
export function spellRangeFeet(action) {
  const base = baseRangeFeet(action);
  if (base == null) return null;
  const bonus = rangeBonusFeet(action);
  if (bonus <= 0) return base;
  return base <= 5 ? Math.max(base, 30) : base + bonus;
}

// { origin, radiusPx } in canvas pixel coords, or null. The origin is the caster
// token center (measured from center — no footprint expansion). `scale` overrides the
// canvas-derived feet→pixel scale, for tests running without a canvas.
export function computeRangeRing(context, action, { scale } = {}) {
  const feet = spellRangeFeet(action);
  if (feet == null) return null;

  const token = canvasTokenById(context?.token?.id ?? context?.token?.uuid);
  const origin = tokenCenter(token) ?? point(context?.token?.center) ?? point(context?.token);
  if (!origin) return null;

  const resolvedScale = Number.isFinite(Number(scale)) ? Number(scale) : pixelScale();
  return { origin, radiusPx: feet * resolvedScale, feet };
}

function dimRect() {
  const dimensions = globalThis.canvas?.dimensions;
  const rect = dimensions?.rect ?? dimensions?.sceneRect;
  if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
    return { x: numeric(rect.x, 0), y: numeric(rect.y, 0), width: rect.width, height: rect.height };
  }
  return { x: 0, y: 0, width: numeric(dimensions?.width, 0), height: numeric(dimensions?.height, 0) };
}

function alphaFilter(PIXI) {
  const AlphaFilter = PIXI?.AlphaFilter ?? PIXI?.filters?.AlphaFilter;
  if (typeof AlphaFilter !== "function") return null;
  try {
    return new AlphaFilter(1);
  } catch (_error) {
    try {
      return new AlphaFilter();
    } catch (_innerError) {
      return null;
    }
  }
}

// Dims the scene outside the in-range disc using the "spotlight" recipe: a full-scene
// dim rect, then an ERASE-blended circle that punches the disc out of the dim. The
// container is isolated with a filter so ERASE cuts only the dim — never the map
// behind it. If ERASE or the isolating filter is unavailable, the dim is skipped
// entirely (ring only) rather than dimming the whole scene.
function appendDim(container, ring) {
  const PIXI = globalThis.PIXI;
  const rect = dimRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  if (PIXI?.BLEND_MODES?.ERASE == null) return;
  const filter = alphaFilter(PIXI);
  if (!filter) return;

  const dim = new PIXI.Graphics();
  dim.beginFill(DIM_COLOR, DIM_ALPHA);
  dim.drawRect(rect.x, rect.y, rect.width, rect.height);
  dim.endFill();
  container.addChild(dim);

  const cut = new PIXI.Graphics();
  cut.beginFill(0xffffff, 1);
  cut.drawCircle(ring.origin.x, ring.origin.y, ring.radiusPx);
  cut.endFill();
  cut.blendMode = PIXI.BLEND_MODES.ERASE;
  container.addChild(cut);

  // Render the container to its own texture so the ERASE circle only clears the dim.
  // Filter bounds are auto-computed from the dim graphics — do not set filterArea, as a
  // mismatched coordinate space would clip the overlay.
  container.filters = [filter];
}

function appendBoundary(container, ring) {
  const PIXI = globalThis.PIXI;
  const graphics = new PIXI.Graphics();
  // Dark outline then a colored stroke — same two-pass style as the movement
  // preview's waypoint indicators. Drawn after the ERASE cut so it stays visible.
  graphics.lineStyle(5, 0x101418, 0.7);
  graphics.drawCircle(ring.origin.x, ring.origin.y, ring.radiusPx);
  graphics.lineStyle(2.5, RING_COLOR, 0.9);
  graphics.drawCircle(ring.origin.x, ring.origin.y, ring.radiusPx);
  container.addChild(graphics);
}

// "Range 60 ft" — the cap label shown on the range ring.
export function rangeLabelText(feet) {
  const rounded = Math.round(numeric(feet, 0));
  return `Range ${rounded} ft`;
}

function labelFontSize() {
  return LABEL_SCREEN_PX;
}

function canvasZoom() {
  const zoom = Number(globalThis.canvas?.stage?.scale?.x);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

// Counter-scale for a world-space label so it renders at a constant on-screen size
// regardless of canvas zoom (labels live on canvas.stage, which scales with zoom).
function labelScreenScale() {
  return Math.min(8, Math.max(0.2, 1 / canvasZoom()));
}

function applyLabelScale(label) {
  label?.scale?.set?.(labelScreenScale());
}

function rescaleActiveLabels() {
  applyLabelScale(capLabel);
  applyLabelScale(placementLabel);
}

// Rescale the range labels live as the user zooms, so they stay readable.
function ensurePanHook() {
  if (panHookId != null) return;
  const Hooks = globalThis.Hooks;
  if (typeof Hooks?.on !== "function") return;
  panHookId = Hooks.on("canvasPan", rescaleActiveLabels);
}

function labelStyle(fontSize, danger = false) {
  return {
    fontFamily: "Signika, sans-serif",
    fontSize,
    fontWeight: "700",
    fill: danger ? "#ff6b6b" : "#f0eee8",
    stroke: "#101418",
    strokeThickness: Math.max(3, Math.round(fontSize * 0.24)),
  };
}

function createTextLabel(text, style) {
  const Text = globalThis.PIXI?.Text;
  if (!Text) return null;
  let label;
  try {
    label = new Text(text, style);
  } catch (_error) {
    label = new Text({ text, style });
  }
  // Bake at a higher resolution so counter-scaling up (when zoomed out) stays crisp.
  if (label) label.resolution = 2;
  return label;
}

function placeLabel(label, x, y) {
  label.roundPixels = true;
  if (typeof label.position?.set === "function") label.position.set(x, y);
  else {
    label.x = x;
    label.y = y;
  }
}

// The cap label ("Range 60 ft") at the top of the ring, in the movement preview's
// label style.
function appendLabel(container, ring) {
  const fontSize = labelFontSize();
  const label = createTextLabel(rangeLabelText(ring.feet), labelStyle(fontSize));
  if (!label) return;
  label.anchor?.set?.(0.5, 1);
  label.alpha = 0.95;
  applyLabelScale(label);
  placeLabel(label, ring.origin.x, ring.origin.y - ring.radiusPx - fontSize * labelScreenScale() * 0.3);
  container.addChild(label);
  capLabel = label;
}

// Feet between two canvas-pixel points, using the canvas grid scale.
function distanceFeet(from, to) {
  const pixels = Math.hypot(to.x - from.x, to.y - from.y);
  const scale = pixelScale();
  return scale > 0 ? pixels / scale : pixels;
}

function clearPlacementLabel() {
  placementOrigin = null;
  placementMaxFeet = null;
  if (!placementLabel) return;
  const label = placementLabel;
  placementLabel = null;
  label.parent?.removeChild?.(label);
  label.destroy?.();
}

// Live readout that follows the template as it is dragged, showing the current
// caster → template distance in feet (red once it passes the spell's max range).
// Driven by the area-picker's move callback during placement.
export function updateRangePlacement(rawPoint) {
  const target = point(rawPoint);
  const PIXI = globalThis.PIXI;
  if (!target || !placementOrigin || !PIXI?.Text) return;
  const layer = previewLayer();
  if (!layer?.addChild) return;

  const feet = distanceFeet(placementOrigin, target);
  const overRange = placementMaxFeet != null && feet > placementMaxFeet + 0.5;
  const fontSize = labelFontSize();
  const text = t("Chip.RangeFt", "{range} ft", { range: Math.round(feet) });

  if (!placementLabel) {
    placementLabel = createTextLabel(text, labelStyle(fontSize, overRange));
    if (!placementLabel) return;
    placementLabel.anchor?.set?.(0.5, 1);
    placementLabel.zIndex = 10_002; // above the action-preview markers
    layer.sortableChildren = true;
    layer.addChild(placementLabel);
    ensurePanHook();
  } else {
    placementLabel.text = text;
    if (placementLabel.style) placementLabel.style.fill = overRange ? "#ff6b6b" : "#f0eee8";
  }
  placementLabel.alpha = 0.98;
  applyLabelScale(placementLabel);
  placeLabel(placementLabel, target.x, target.y - gridSize() * 0.35);
}

export function clearRangeOverlay() {
  clearPlacementLabel();
  capLabel = null; // destroyed with the container below
  if (!rangeContainer) return;
  const container = rangeContainer;
  rangeContainer = null;
  container.parent?.removeChild?.(container);
  container.destroy?.({ children: true });
}

// Shows (or replaces) the range overlay for a spell action. Returns the ring it drew,
// or null when there is nothing to draw. Used both during the area-placement loop and
// for single-target hover guidance.
export function showRangeOverlay(context, action) {
  clearRangeOverlay();

  const PIXI = globalThis.PIXI;
  if (!PIXI?.Container || !PIXI?.Graphics) return null;

  const ring = computeRangeRing(context, action);
  if (!ring) return null;

  const layer = previewLayer();
  if (!layer?.addChild) return null;

  const container = new PIXI.Container();
  container.eventMode = "none";
  container.interactive = false;
  container.interactiveChildren = false;
  appendDim(container, ring);
  appendBoundary(container, ring);
  appendLabel(container, ring);

  container.zIndex = 9_999; // beneath the action-preview markers (10_001) and movement (10_000)
  layer.sortableChildren = true;
  layer.addChild(container);
  rangeContainer = container;
  ensurePanHook();

  // Remember the caster origin / max range so updateRangePlacement can show the live
  // distance to the template as it is dragged.
  placementOrigin = ring.origin;
  placementMaxFeet = ring.feet;
  return ring;
}
