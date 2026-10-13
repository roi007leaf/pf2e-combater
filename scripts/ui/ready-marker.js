import { MODULE_ID } from "../constants.js";
import { readiedAction } from "../state/turn-controls.js";

// Canvas marker for a creature holding a readied action: a dashed amber ring
// plus a bullseye badge. Static drawing only; the canvas renders continuously,
// so an animated marker would cost every frame.
const KEY = "_combaterReadyMarker";
const COLOR = 0xf5c45c;
const BADGE_FILL = 0x2c261b;

function readiedForToken(token) {
  const combat = globalThis.game?.combat;
  if (!combat?.started) return null;
  const combatant = token?.combatant ?? token?.document?.combatant
    ?? combat.combatants?.find?.((entry) => entry.tokenId === token?.id);
  if (!combatant || combatant.parent?.id !== combat.id) return null;
  return readiedAction(combatant);
}

// Player characters announce their Ready at the table. A GM creature's readied
// action stays hidden from players who don't own it.
function markerVisibleTo(token, user = globalThis.game?.user) {
  const actor = token?.actor ?? token?.document?.actor;
  return Boolean(user?.isGM || actor?.hasPlayerOwner || actor?.isOwner);
}

function drawMarker(token) {
  const PIXI = globalThis.PIXI;
  const width = token.w ?? token.width;
  const height = token.h ?? token.height;
  const size = Math.max(width, height);
  const marker = new PIXI.Container();
  marker.eventMode = "none";
  const ring = new PIXI.Graphics();
  const radius = size / 2 + Math.max(3, size * 0.05);
  const thickness = Math.max(2, size * 0.035);
  const segments = 16;
  const sweep = (Math.PI * 2) / segments;
  for (let index = 0; index < segments; index += 1) {
    const start = index * sweep;
    ring.lineStyle(thickness, COLOR, 0.95);
    ring.moveTo(width / 2 + Math.cos(start) * radius, height / 2 + Math.sin(start) * radius);
    ring.arc(width / 2, height / 2, radius, start, start + sweep * 0.6);
  }
  marker.addChild(ring);
  const badgeRadius = Math.max(9, size * 0.16);
  const badge = new PIXI.Graphics();
  badge.lineStyle(Math.max(1.5, thickness * 0.7), COLOR, 1).beginFill(BADGE_FILL, 0.95)
    .drawCircle(width - badgeRadius * 0.4, badgeRadius * 0.4, badgeRadius).endFill();
  marker.addChild(badge);
  // Drawn bullseye: canvas text can't rely on the Font Awesome web font.
  const centerX = width - badgeRadius * 0.4;
  const centerY = badgeRadius * 0.4;
  const icon = new PIXI.Graphics();
  icon.lineStyle(Math.max(1.2, badgeRadius * 0.14), COLOR, 1).drawCircle(centerX, centerY, badgeRadius * 0.58);
  icon.lineStyle(0).beginFill(COLOR, 1).drawCircle(centerX, centerY, badgeRadius * 0.24).endFill();
  marker.addChild(icon);
  marker.combaterSize = `${width}x${height}`;
  return marker;
}

export function syncReadyMarker(token) {
  if (!token || token.destroyed || token.isPreview || token._original) return;
  const existing = token[KEY];
  const live = existing && !existing.destroyed && existing.parent === token ? existing : null;
  const show = Boolean(readiedForToken(token)) && markerVisibleTo(token);
  const width = token.w ?? token.width;
  const height = token.h ?? token.height;
  if (!show || (live && live.combaterSize !== `${width}x${height}`)) {
    if (live) live.destroy({ children: true });
    token[KEY] = null;
    if (!show) return;
  } else if (live) return;
  token[KEY] = token.addChild(drawMarker(token));
}

function syncAll() {
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) syncReadyMarker(token);
}

export function registerReadyMarkerHooks() {
  const hooks = globalThis.Hooks;
  hooks.on("refreshToken", (token) => syncReadyMarker(token));
  hooks.on("canvasReady", syncAll);
  for (const event of ["createCombat", "deleteCombat", "updateCombat", "deleteCombatant"]) hooks.on(event, syncAll);
  hooks.on("updateCombatant", (_combatant, changed) => {
    if (changed?.flags?.[MODULE_ID] !== undefined || Object.keys(changed ?? {}).some((key) => key.startsWith(`flags.${MODULE_ID}`))) syncAll();
  });
}
