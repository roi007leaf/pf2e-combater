import { MODULE_ID } from "../constants.js";
import { REACTION_CHECKER_ID, REACTION_USED_EFFECT_SLUG, reactionUsed, readiedAction } from "../state/turn-controls.js";

// Canvas markers for turn state: a readied action (dashed amber ring plus a
// bullseye badge, top-right) and a spent reaction (orange circular-arrow badge,
// top-left). Static drawings only; the canvas renders continuously, so an
// animated marker would cost every frame.
const READY_KEY = "_combaterReadyMarker";
const REACTION_KEY = "_combaterReactionMarker";
const COLOR = 0xf5c45c;
const BADGE_FILL = 0x2c261b;
const REACTION_COLOR = 0xf1a05a;
const REACTION_FILL = 0x2a1d14;

function combatantForToken(token) {
  const combat = globalThis.game?.combat;
  if (!combat?.started) return null;
  const combatant = token?.combatant ?? token?.document?.combatant
    ?? combat.combatants?.find?.((entry) => entry.tokenId === token?.id);
  return combatant && combatant.parent?.id === combat.id ? combatant : null;
}

// Player characters announce their Ready at the table. A GM creature's readied
// action or spent reaction stays hidden from players who don't own it.
function markerVisibleTo(token, user = globalThis.game?.user) {
  const actor = token?.actor ?? token?.document?.actor;
  return Boolean(user?.isGM || actor?.hasPlayerOwner || actor?.isOwner);
}

function tokenSize(token) {
  const width = token.w ?? token.width;
  const height = token.h ?? token.height;
  return { width, height, size: Math.max(width, height) };
}

function drawReadyMarker(token) {
  const PIXI = globalThis.PIXI;
  const { width, height, size } = tokenSize(token);
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

// A circular arrow (the "reaction" symbol) in a top-left badge.
function drawReactionMarker(token) {
  const PIXI = globalThis.PIXI;
  const { width, height, size } = tokenSize(token);
  const marker = new PIXI.Container();
  marker.eventMode = "none";
  const badgeRadius = Math.max(9, size * 0.16);
  const centerX = badgeRadius * 0.4;
  const centerY = badgeRadius * 0.4;
  const badge = new PIXI.Graphics();
  badge.lineStyle(Math.max(1.5, size * 0.025), REACTION_COLOR, 1).beginFill(REACTION_FILL, 0.95)
    .drawCircle(centerX, centerY, badgeRadius).endFill();
  marker.addChild(badge);
  const arrow = new PIXI.Graphics();
  const arcRadius = badgeRadius * 0.52;
  const stroke = Math.max(1.4, badgeRadius * 0.16);
  const start = -Math.PI * 0.15;
  const end = Math.PI * 1.35;
  arrow.lineStyle(stroke, REACTION_COLOR, 1);
  arrow.moveTo(centerX + Math.cos(start) * arcRadius, centerY + Math.sin(start) * arcRadius);
  arrow.arc(centerX, centerY, arcRadius, start, end);
  // Arrowhead at the start of the arc, pointing back around the circle.
  const tipX = centerX + Math.cos(start) * arcRadius;
  const tipY = centerY + Math.sin(start) * arcRadius;
  const head = badgeRadius * 0.34;
  arrow.lineStyle(0).beginFill(REACTION_COLOR, 1)
    .drawPolygon([tipX - head, tipY - head * 0.15, tipX + head * 0.55, tipY - head * 0.25, tipX + head * 0.1, tipY + head * 0.75])
    .endFill();
  marker.addChild(arrow);
  marker.combaterSize = `${width}x${height}`;
  return marker;
}

function syncMarker(token, key, show, draw) {
  const existing = token[key];
  const live = existing && !existing.destroyed && existing.parent === token ? existing : null;
  const { width, height } = tokenSize(token);
  if (!show || (live && live.combaterSize !== `${width}x${height}`)) {
    if (live) live.destroy({ children: true });
    token[key] = null;
    if (!show) return;
  } else if (live) return;
  token[key] = token.addChild(draw(token));
}

export function syncReadyMarker(token) {
  if (!token || token.destroyed || token.isPreview || token._original) return;
  const combatant = combatantForToken(token);
  const visible = markerVisibleTo(token);
  syncMarker(token, READY_KEY, Boolean(combatant && readiedAction(combatant)) && visible, drawReadyMarker);
  syncMarker(token, REACTION_KEY, Boolean(combatant && reactionUsed(combatant)) && visible, drawReactionMarker);
}

function syncAll() {
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) syncReadyMarker(token);
}

function changesTurnFlags(changed) {
  const keys = Object.keys(changed ?? {});
  return [MODULE_ID, REACTION_CHECKER_ID].some((scope) => changed?.flags?.[scope] !== undefined
    || keys.some((key) => key.startsWith(`flags.${scope}`)));
}

export function registerReadyMarkerHooks() {
  const hooks = globalThis.Hooks;
  hooks.on("refreshToken", (token) => syncReadyMarker(token));
  hooks.on("canvasReady", syncAll);
  for (const event of ["createCombat", "deleteCombat", "updateCombat", "deleteCombatant"]) hooks.on(event, syncAll);
  hooks.on("updateCombatant", (_combatant, changed) => {
    if (changesTurnFlags(changed)) syncAll();
  });
  // Sundry's "Reaction Used" effect lives on the actor, not the combatant.
  for (const event of ["createItem", "updateItem", "deleteItem"]) {
    hooks.on(event, (item) => {
      if ((item?.slug ?? item?.system?.slug) === REACTION_USED_EFFECT_SLUG) syncAll();
    });
  }
}
