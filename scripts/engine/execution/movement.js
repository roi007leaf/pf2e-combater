import { movementFootprintForToken, movementOriginForContext, movementRouteForStep } from "../movement-route.js";
import { executionPatch, revertEnvelope } from "./results.js";
import { canvasTokenById, targetTokenId, tokenId } from "./targets.js";
import { canvasGridDistance as gridDistance, canvasGridSize as gridSize } from "../../rules/canvas-geometry.js";
import { t } from "../../i18n.js";
import { pf2eTokenMovementActionForStep } from "../../rules/movement-cost.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point(value) {
  const x = numeric(value?.x);
  const y = numeric(value?.y);
  if (x === null || y === null) return null;
  // Preserve a vertical-movement target elevation when present so it survives down to the move call.
  const elevation = numeric(value?.elevation);
  return elevation === null ? { x, y } : { x, y, elevation };
}

export function destinationFromStep(step, choices = {}) {
  return point(choices.destination) ?? point(step?.destination);
}

export function movementPlanFromStep(step, choices = {}) {
  return choices.movementPlan ?? step?.movementPlan ?? null;
}

// A teleportation action (e.g. Translocate) picks a destination like a Stride but is delivered
// instantly: it casts the spell and repositions the token with no movement animation.
export function isTeleportAction(action) {
  return action?.activityProfile?.teleport === true;
}

function movementValidationPlan(action, destination, movementPlan) {
  if (movementPlan) return movementPlan;
  if (isTeleportAction(action)) return null;
  return { native: false, waypoints: [destination] };
}

function movementValidationPreview(context, action, destination, movementPlan = null) {
  const token = canvasTokenById(tokenId(context));
  const origin = movementOriginForContext(context, { collisionToken: token, gridSize: gridSize() });
  if (!origin) return { enabled: false };

  const movementAction = pf2eTokenMovementActionForStep(action);
  const validationPlan = movementValidationPlan(action, destination, movementPlan);
  const route = movementRouteForStep(context, {
    ...(action ?? {}),
    movementAction,
    destination,
    ...(validationPlan ? { movementPlan: validationPlan } : {}),
    requiresDestination: true,
  }, {
    actor: token?.actor ?? context?.actor,
    collisionToken: token,
    gridSize: gridSize(),
    gridDistance: gridDistance(),
    movementAction,
    origin,
    originElevation: numeric(token?.document?.elevation ?? context?.token?.document?.elevation ?? context?.token?.elevation, 0) || 0,
  });
  return {
    enabled: route.enabled,
    explicitDestination: Boolean(destination),
    destinationAvailable: route.reachable,
    destinationIllegalReason: route.reachable ? "" : route.reason,
  };
}

function executorFootprint(token, context) {
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

function activeCombatant(combat) {
  return combat?.combatant ?? (Array.isArray(combat?.turns) ? combat.turns[combat.turn] : null) ?? null;
}

function tokenIdentityValues(token, context) {
  const document = token?.document ?? token ?? {};
  return [
    token?.id,
    token?.uuid,
    document?.id,
    document?.uuid,
    tokenId(context),
    context?.combatant?.tokenId,
    context?.combatant?.token?.id,
    context?.combatant?.token?.uuid,
  ].filter(Boolean).map(String);
}

function combatantTokenIdentityValues(combatant) {
  return [
    combatant?.tokenId,
    combatant?.token?.id,
    combatant?.token?.uuid,
    combatant?.token?.document?.id,
    combatant?.token?.document?.uuid,
  ].filter(Boolean).map(String);
}

function canMoveOnCurrentTurn(context, token) {
  const combat = context?.combat ?? context?.combatant?.combat ?? globalThis.game?.combat ?? null;
  if (!combat) return true;

  const active = activeCombatant(combat);
  const activeIds = combatantTokenIdentityValues(active);
  if (!activeIds.length) return true;

  const tokenIds = tokenIdentityValues(token, context);
  return activeIds.some((id) => tokenIds.includes(id));
}

function tokenWaypointForDestination(destination, token, context, action) {
  const size = gridSize();
  const footprint = executorFootprint(token, context);
  const elevation = numeric(destination?.elevation);
  return {
    x: destination.x - (footprint.width * size) / 2,
    y: destination.y - (footprint.height * size) / 2,
    action: pf2eTokenMovementActionForStep(action),
    // A vertical Stride (fly/burrow) ends at the chosen elevation; flat moves leave it untouched.
    ...(elevation === null ? {} : { elevation }),
    explicit: true,
    checkpoint: true,
    snapped: true,
  };
}

// Current top-left of the token, captured before a move so revert can reposition it. Elevation is
// captured too so reverting a vertical Stride drops the token back to where it took off.
export function movementOrigin(token, document, context) {
  const elevation = numeric(document?.elevation ?? token?.document?.elevation ?? context?.token?.elevation);
  const withElevation = (origin) => (origin && elevation !== null ? { ...origin, elevation } : origin);
  const docX = numeric(document?.x);
  const docY = numeric(document?.y);
  if (docX !== null && docY !== null) return withElevation({ x: docX, y: docY });
  const center = point(token?.center) ?? point(context?.token?.center);
  if (!center) return null;
  const size = gridSize();
  const footprint = executorFootprint(token, context);
  return withElevation({
    x: center.x - (footprint.width * size) / 2,
    y: center.y - (footprint.height * size) / 2,
  });
}

function samePoint(left, right) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

function customMovementWaypoints(destination, movementPlan) {
  if (movementPlan?.native !== false || !Array.isArray(movementPlan.waypoints)) return [];
  const waypoints = movementPlan.waypoints.map((waypoint) => point(waypoint)).filter(Boolean);
  if (destination && !samePoint(waypoints.at(-1), destination)) waypoints.push(destination);
  return waypoints;
}

// Forward path of top-left token positions (origin first, destination last). Captured so revert
// can retrace the waypoints in reverse rather than cutting a straight line back to the origin.
function movementPathPoints({ origin, destination, movementPlan, token, context, action }) {
  if (!origin) return null;
  const waypointCenters = Array.isArray(movementPlan?.waypoints)
    ? movementPlan.waypoints.map((waypoint) => point(waypoint)).filter(Boolean)
    : [];
  const centers = [...waypointCenters];
  if (destination && !samePoint(centers.at(-1), destination)) centers.push(destination);
  if (!centers.length) return [origin];
  const tail = centers.map((center) => {
    const waypoint = tokenWaypointForDestination(center, token, context, action);
    // Keep each leg's elevation so reverting a multi-height flight retraces those heights.
    return waypoint.elevation === undefined
      ? { x: waypoint.x, y: waypoint.y }
      : { x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation };
  });
  return [origin, ...tail];
}

async function startPlannedMovement(document, movementPlan) {
  if (!movementPlan?.id || typeof document?.startMovement !== "function") return false;
  if (document?.movement?.state !== "planned") return false;
  if (document?.movement?.id && document.movement.id !== movementPlan.id) return false;
  return document.startMovement(movementPlan.id);
}

export async function executeMovement({ context, step, action, choices }) {
  const destination = destinationFromStep(step, choices);
  const movementPlan = movementPlanFromStep(step, choices);
  if (!destination) {
    return { status: "needs-choice", choices: ["destination"], patch: {} };
  }

  const token = canvasTokenById(tokenId(context));
  const preview = movementValidationPreview(context, action, destination, movementPlan);
  if (preview.enabled && preview.explicitDestination && preview.destinationAvailable === false) {
    return {
      status: "failed",
      patch: executionPatch({ destination }, "failed", { error: preview.destinationIllegalReason || t("Exec.DestinationUnavailable", "Destination is unavailable.") }),
      error: preview.destinationIllegalReason || t("Exec.DestinationUnavailable", "Destination is unavailable."),
    };
  }

  const document = token?.document ?? context?.combatant?.token ?? context?.token?.document;
  const origin = movementOrigin(token, document, context);
  const moveTokenId = targetTokenId(token) ?? tokenId(context);
  const path = movementPathPoints({ origin, destination, movementPlan, token, context, action });
  const movementRevert = origin && moveTokenId
    ? revertEnvelope([{ kind: "movement", tokenId: moveTokenId, origin, ...(path && path.length > 1 ? { path } : {}) }])
    : null;
  if (!canMoveOnCurrentTurn(context, token)) {
    return {
      status: "failed",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "failed", { error: t("Exec.MoveOnlyOnTurn", "Token can only move on its turn.") }),
      error: t("Exec.MoveOnlyOnTurn", "Token can only move on its turn."),
    };
  }

  const plannedStarted = await startPlannedMovement(document, movementPlan);
  if (plannedStarted) {
    return {
      status: "done",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "done", { result: t("Exec.StartedMovement", "Started planned movement."), revert: movementRevert }),
    };
  }

  if (movementPlan?.id && document?.movement?.state === "planned") {
    return {
      status: "failed",
      patch: executionPatch({ destination, movementPlan }, "failed", { error: t("Exec.MovementStale", "Planned movement is stale. Choose destination again.") }),
      error: t("Exec.MovementStale", "Planned movement is stale. Choose destination again."),
    };
  }

  const customWaypoints = customMovementWaypoints(destination, movementPlan);
  if (customWaypoints.length && typeof document?.move === "function") {
    for (const waypointDestination of customWaypoints) {
      const waypoint = tokenWaypointForDestination(waypointDestination, token, context, action);
      const moved = await document.move(waypoint, { method: "api", showRuler: true });
      if (!moved) {
        return {
          status: "failed",
          patch: executionPatch({ destination, movementPlan }, "failed", { error: t("Exec.MovementPrevented", "Movement was prevented.") }),
          error: t("Exec.MovementPrevented", "Movement was prevented."),
        };
      }
    }
    return {
      status: "done",
      patch: executionPatch({ destination, movementPlan }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
    };
  }

  const waypoint = tokenWaypointForDestination(destination, token, context, action);
  if (typeof document?.move === "function") {
    const moved = await document.move(waypoint, { method: "api", showRuler: true });
    if (!moved) {
      return {
        status: "failed",
        patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "failed", { error: t("Exec.MovementPrevented", "Movement was prevented.") }),
        error: t("Exec.MovementPrevented", "Movement was prevented."),
      };
    }
    return {
      status: "done",
      patch: executionPatch({ destination, ...(movementPlan ? { movementPlan } : {}) }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
    };
  }

  if (typeof document?.update !== "function") {
    return {
      status: "failed",
      patch: executionPatch({ destination }, "failed", { error: t("Exec.NoTokenDocument", "Token document is not available.") }),
      error: t("Exec.NoTokenDocument", "Token document is not available."),
    };
  }

  await document.update({
    x: waypoint.x,
    y: waypoint.y,
  });
  return {
    status: "done",
    patch: executionPatch({ destination }, "done", { result: t("Exec.MovedToken", "Moved token."), revert: movementRevert }),
  };
}

// Place the token at the destination instantly (no movement animation). `origin` is captured by the
// caller BEFORE the spell is cast: some teleport spells reposition the token themselves, and reading
// the origin afterwards would record the destination, leaving revert with nothing to undo. Returns a
// movement revert op so undoing the step returns the token to where it teleported from.
export async function teleportTokenTo(context, action, destination, origin) {
  const token = canvasTokenById(tokenId(context));
  const document = token?.document ?? context?.combatant?.token ?? context?.token?.document;
  if (!document) return null;
  const moveTokenId = targetTokenId(token) ?? tokenId(context);
  const waypoint = tokenWaypointForDestination(destination, token, context, action);
  if (waypoint && typeof document.update === "function") {
    const elevation = numeric(waypoint.elevation);
    await document.update(
      { x: waypoint.x, y: waypoint.y, ...(elevation === null ? {} : { elevation }) },
      { animate: false },
    );
  }
  return origin && moveTokenId ? { kind: "movement", tokenId: moveTokenId, origin } : null;
}
