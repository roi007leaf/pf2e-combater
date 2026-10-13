import { actorMovementOptions, readActorSpeed } from "../readers/actor-profile.js";

function tokenDocument(combatant) {
  const token = combatant?.token ?? combatant?.tokenDocument;
  return token?.document ?? token;
}

function movementHistory(combatant) {
  const token = tokenDocument(combatant);
  const history = token?.movementHistory ?? token?._source?._movementHistory;
  return Array.isArray(history) ? history : null;
}

export function recordedMovementIds(combatant) {
  return [...new Set((movementHistory(combatant) ?? []).map((waypoint) => waypoint.movementId).filter(Boolean))];
}

function movementSpeed(actor, action, speeds) {
  const land = actor?.movement?.speeds?.land ?? actor?.system?.movement?.speeds?.land;
  if (action === "step" || action === "crawl") return Number(land?.[action]) || 5;
  return speeds.find((speed) => speed.action === action)?.speed ?? (action === "walk" ? readActorSpeed(actor) : null);
}

// Foundry persists each committed segment's cost (including terrain/diagonals),
// movement mode, and subpath. Reading it also works on other clients and after a reload.
// Null means an older runtime without recorded movement; use the local fallback there.
export function canvasMovementEntries(combatant, excludedMovementIds = []) {
  const history = movementHistory(combatant);
  if (!history) return null;
  const excluded = new Set(excludedMovementIds);
  const actor = combatant.actor;
  const speeds = actorMovementOptions(actor);
  const paths = [];
  let current = null;
  for (const waypoint of history) {
    const action = waypoint.action ?? "walk";
    const slug = action === "walk" ? "stride" : action;
    if (excluded.has(waypoint.movementId) || ["displace", "blink", "teleport"].includes(action)
      || globalThis.CONFIG?.Token?.movement?.actions?.[action]?.teleport) {
      current = null;
      continue;
    }
    const cost = Number(waypoint.cost);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const pathId = waypoint.subpathId ?? waypoint.movementId;
    if (!current || current.pathId !== pathId || current.action !== action) {
      current = { pathId, action, slug, distance: 0, speed: movementSpeed(actor, action, speeds) };
      paths.push(current);
    }
    current.distance += cost;
  }
  return paths.flatMap(({ slug, distance, speed }) => {
    // Unknown movement modes (such as a Jump without a recorded range) cannot
    // safely convert feet to multiple actions. They still spend one action.
    const count = speed > 0 ? Math.max(1, Math.ceil((distance - 0.0001) / speed)) : 1;
    return Array.from({ length: count }, () => ({ cost: 1, slug, movement: true, canvas: true }));
  });
}
