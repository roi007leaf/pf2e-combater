import { pf2eMovementSegmentCost } from "../rules/movement-cost.js";
import { movementRouteToPoint } from "./movement-preview.js";
import { t } from "../i18n.js";

let activeCleanup = null;
let activeOnCancel = null;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function point(value) {
  const x = numeric(value?.x ?? value?.[0]);
  const y = numeric(value?.y ?? value?.[1]);
  return x === null || y === null ? null : { x, y };
}

function samePoint(left, right) {
  return !!left && !!right && left.x === right.x && left.y === right.y;
}

function tokenId(context) {
  return context?.token?.id
    ?? context?.token?.uuid
    ?? context?.combatant?.tokenId
    ?? context?.combatant?.token?.id
    ?? context?.combatant?.token?.uuid
    ?? null;
}

function canvasTokenById(id) {
  if (!id) return null;
  return (globalThis.canvas?.tokens?.placeables ?? []).find((token) => {
    const document = token?.document ?? token;
    return token?.id === id
      || token?.uuid === id
      || document?.id === id
      || document?.uuid === id;
  }) ?? null;
}

function gridSize() {
  const size = numeric(globalThis.canvas?.grid?.size);
  return size && size > 0 ? size : 1;
}

function gridDistance() {
  const distance = numeric(
    globalThis.canvas?.dimensions?.distance
    ?? globalThis.canvas?.scene?.grid?.distance
    ?? globalThis.canvas?.grid?.distance,
  );
  return distance && distance > 0 ? distance : 5;
}

function callGrid(method, ...args) {
  try {
    return point(method?.(...args));
  } catch (_error) {
    return null;
  }
}

function uniqueTargets(...targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target || seen.has(target)) return false;
    seen.add(target);
    return true;
  });
}

function stageTarget() {
  const canvas = globalThis.canvas;
  return canvas?.stage ?? canvas?.app?.stage ?? canvas?.app?.renderer?.stage ?? null;
}

function canvasDomTarget() {
  const canvas = globalThis.canvas;
  return canvas?.app?.view
    ?? canvas?.app?.canvas
    ?? canvas?.app?.renderer?.view
    ?? canvas?.app?.renderer?.canvas
    ?? canvas?.app?.renderer?.events?.domElement
    ?? globalThis.document?.getElementById?.("board")
    ?? null;
}

function pointerTargets() {
  const canvas = globalThis.canvas;
  return uniqueTargets(
    globalThis.window,
    globalThis.document,
    canvas?.app?.view,
    canvas?.app?.canvas,
    canvas?.app?.renderer?.view,
    canvas?.app?.renderer?.canvas,
    canvas?.app?.renderer?.events?.domElement,
    globalThis.document?.getElementById?.("board"),
    canvas?.stage,
    canvas?.app?.stage,
    canvas?.app?.renderer?.stage,
  );
}

function snappedCenter(rawPoint) {
  const grid = globalThis.canvas?.grid;
  const center = callGrid(grid?.getCenterPoint?.bind(grid), rawPoint);
  if (center) return center;

  const centerMode = globalThis.CONST?.GRID_SNAPPING_MODES?.CENTER;
  const snapped = callGrid(grid?.getSnappedPoint?.bind(grid), rawPoint, { mode: centerMode });
  if (snapped) return snapped;

  const topLeft = callGrid(grid?.getTopLeftPoint?.bind(grid), rawPoint);
  const size = gridSize();
  if (topLeft) return { x: topLeft.x + size / 2, y: topLeft.y + size / 2 };

  return {
    x: Math.floor(rawPoint.x / size) * size + size / 2,
    y: Math.floor(rawPoint.y / size) * size + size / 2,
  };
}

function eventCanvasPoint(event) {
  const stage = stageTarget();
  const local = callGrid(event?.data?.getLocalPosition?.bind(event.data), stage)
    ?? callGrid(event?.getLocalPosition?.bind(event), stage);
  if (local) return local;

  const client = point({
    x: event?.clientX ?? event?.nativeEvent?.clientX ?? event?.originalEvent?.clientX,
    y: event?.clientY ?? event?.nativeEvent?.clientY ?? event?.originalEvent?.clientY,
  });
  if (client) {
    const canvasClientPoint = callGrid(
      globalThis.canvas?.canvasCoordinatesFromClient?.bind(globalThis.canvas),
      client,
    );
    if (canvasClientPoint) return canvasClientPoint;

    const view = globalThis.canvas?.app?.view ?? globalThis.canvas?.app?.renderer?.view;
    const rect = typeof view?.getBoundingClientRect === "function" ? view.getBoundingClientRect() : null;
    if (rect) return { x: client.x - (numeric(rect.left) ?? 0), y: client.y - (numeric(rect.top) ?? 0) };
  }

  const mousePosition = point(globalThis.canvas?.mousePosition);
  if (mousePosition) return mousePosition;

  const globalPoint = point(event?.global ?? event?.data?.global);
  if (globalPoint && typeof stage?.toLocal === "function") {
    const stageLocal = callGrid(stage.toLocal.bind(stage), globalPoint);
    if (stageLocal) return stageLocal;
  }
  return globalPoint;
}

function addDomPointerHandler(handler, allowPointerEvent = isPrimaryPointerEvent) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.addEventListener === "function") {
      let pointerActive = false;
      let pointerId = null;
      let pointerDownEvent = null;
      const onPointerDown = (event) => {
        if (!allowPointerEvent(event)) return;
        if (!eventTargetsCanvas(event)) return;
        pointerActive = true;
        pointerId = event?.pointerId ?? null;
        pointerDownEvent = event;
        event?.target?.setPointerCapture?.(pointerId);
        suppressPointerEvent(event);
      };
      const onPointerUp = (event) => {
        if (!pointerActive) return;
        if (pointerId !== null && event?.pointerId !== undefined && event.pointerId !== pointerId) return;
        pointerActive = false;
        event.__pf2eCombaterDestinationPicker = true;
        event.__pf2eCombaterDestinationPickerPointerDown = pointerDownEvent;
        pointerDownEvent = null;
        event?.target?.releasePointerCapture?.(pointerId);
        handler(event);
      };
      const onClick = (event) => {
        if (eventTargetsCanvas(event)) suppressPointerEvent(event);
      };
      const onDoubleClick = (event) => {
        if (!allowPointerEvent(event)) return;
        if (!eventTargetsCanvas(event)) return;
        event.__pf2eCombaterDestinationPicker = true;
        suppressPointerEvent(event);
        handler(event);
      };
      const onContextMenu = (event) => {
        if (eventTargetsCanvas(event)) suppressPointerEvent(event);
      };
      target.addEventListener("pointerdown", onPointerDown, { capture: true });
      target.addEventListener("pointerup", onPointerUp, { capture: true });
      target.addEventListener("click", onClick, { capture: true });
      target.addEventListener("dblclick", onDoubleClick, { capture: true });
      target.addEventListener("contextmenu", onContextMenu, { capture: true });
      cleanups.push(() => {
        target.removeEventListener?.("pointerdown", onPointerDown, { capture: true });
        target.removeEventListener?.("pointerup", onPointerUp, { capture: true });
        target.removeEventListener?.("click", onClick, { capture: true });
        target.removeEventListener?.("dblclick", onDoubleClick, { capture: true });
        target.removeEventListener?.("contextmenu", onContextMenu, { capture: true });
      });
    }
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function addStagePointerHandler(handler) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.addEventListener === "function") continue;
    if (typeof target?.on === "function") {
      target.on("pointerdown", handler);
      cleanups.push(() => {
        if (typeof target.off === "function") target.off("pointerdown", handler);
        else target.removeListener?.("pointerdown", handler);
      });
    }
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function addPointerHandler(handler, allowPointerEvent = isPrimaryPointerEvent) {
  return addDomPointerHandler(handler, allowPointerEvent) ?? addStagePointerHandler(handler);
}

// Vertical movement (fly/burrow) lets the player raise/lower the target elevation while picking by
// holding Shift and scrolling. We capture the wheel in the capture phase on the canvas's ancestors so
// we can intercept it before Foundry's own zoom handler runs; the picker's handler decides whether
// to consume it (Shift held) or let it fall through to the normal canvas zoom.
function addWheelHandler(handler) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.addEventListener !== "function") continue;
    const onWheel = (event) => {
      // The listener is attached to several capture targets (window/document/canvas), so one wheel
      // tick reaches it multiple times — process the event once, or elevation jumps several steps.
      if (event.__pf2eCombaterWheelHandled) return;
      if (!eventTargetsCanvas(event)) return;
      event.__pf2eCombaterWheelHandled = true;
      handler(event);
    };
    target.addEventListener("wheel", onWheel, { capture: true, passive: false });
    cleanups.push(() => target.removeEventListener?.("wheel", onWheel, { capture: true }));
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

// The two PF2e Speeds that move through three dimensions, so the picker offers a vertical control.
function verticalMovementForAction(action) {
  return ["fly", "burrow"].includes(movementActionForAction(action));
}

function tokenElevation(token) {
  return numeric(token?.document?.elevation ?? token?.elevation) ?? 0;
}

function eventWheelDelta(event) {
  const delta = numeric(event?.deltaY ?? event?.nativeEvent?.deltaY ?? event?.originalEvent?.deltaY) ?? 0;
  if (delta < 0) return 1;
  if (delta > 0) return -1;
  return 0;
}

function isPrimaryPointerEvent(event) {
  const button = eventButton(event);
  return button === undefined || button === null || button === 0;
}

function eventButton(event) {
  const pointerDown = event?.__pf2eCombaterDestinationPickerPointerDown ?? null;
  return event?.button
    ?? event?.data?.button
    ?? event?.nativeEvent?.button
    ?? event?.originalEvent?.button
    ?? pointerDown?.button
    ?? pointerDown?.data?.button
    ?? pointerDown?.nativeEvent?.button
    ?? pointerDown?.originalEvent?.button;
}

function isDomPointerEvent(event) {
  const target = event?.target ?? event?.nativeEvent?.target ?? event?.originalEvent?.target;
  return !!target && (
    typeof target.closest === "function"
    || typeof target.nodeType === "number"
    || target === canvasDomTarget()
  );
}

function eventTargetsCanvas(event) {
  if (event?.__pf2eCombaterDestinationPicker === true) return true;
  if (!isDomPointerEvent(event)) return true;
  const canvasElement = canvasDomTarget();
  const target = event?.target ?? event?.nativeEvent?.target ?? event?.originalEvent?.target;
  return !canvasElement || !target || target === canvasElement || canvasElement.contains?.(target) === true;
}

function suppressPointerEvent(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
  event?.nativeEvent?.preventDefault?.();
  event?.nativeEvent?.stopPropagation?.();
  event?.nativeEvent?.stopImmediatePropagation?.();
  event?.originalEvent?.preventDefault?.();
  event?.originalEvent?.stopPropagation?.();
  event?.originalEvent?.stopImmediatePropagation?.();
}

function actionSlug(action) {
  return String(action?.slug ?? action?.action?.slug ?? action?.actionKey ?? "").toLowerCase();
}

function movementActionForAction(action) {
  const requested = String(action?.movementAction ?? action?.action?.movementAction ?? "").toLowerCase();
  if (requested === "step") return "walk";
  if (requested) return requested;

  const slug = actionSlug(action);
  if (slug === "crawl") return "crawl";
  return "walk";
}

function movementActionAllowed(action) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return !actions || Object.prototype.hasOwnProperty.call(actions, action);
}

// The actor's speed (feet) for a given movement-action key, read from the prepared PF2e creature
// speeds (system.movement.speeds, keyed by type; "walk" maps to "land"). Returns null when the
// actor has no such speed so the caller can fall back to the land speed.
function typedMovementSpeed(token, movementAction) {
  const speeds = token?.actor?.system?.movement?.speeds;
  if (!speeds || typeof speeds !== "object") return null;
  const type = movementAction === "walk" ? "land" : movementAction;
  const entry = speeds[type];
  const value = numeric(entry?.total ?? entry?.value ?? entry?.base);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function actorSpeed(context, token, action) {
  const slug = actionSlug(action);
  if (slug === "crawl" || slug === "step") return 5;

  // Teleportation (e.g. Translocate) is bounded by the spell's range, not movement speed. Fall back
  // to a large allowance when the range can't be read so it never blocks on speed.
  if (action?.activityProfile?.teleport === true) {
    const range = numeric(action?.targetingProfile?.maxRange ?? action?.maxRange ?? action?.range?.max);
    return Number.isFinite(range) && range > 0 ? range : 1000;
  }

  // A Stride travelling on a non-walking speed (fly/burrow/swim/climb) reaches as far as that
  // speed allows, not the land Speed. The chosen movement type rides on the step/action.
  const typed = typedMovementSpeed(token, movementActionForAction(action));
  if (typed !== null) return typed;

  const tokenSpeeds = token?.actor?.system?.movement?.speeds;
  const profile = context?.actor?.profile ?? context?.profile ?? {};
  const speed = tokenSpeeds?.land?.value
    ?? profile.speed?.value
    ?? profile.speed
    ?? profile.landSpeed
    ?? action?.movementDistance
    ?? action?.distance;
  return numeric(speed) ?? 25;
}

function planMovementOptions({ context, action, token }) {
  const movementAction = movementActionForAction(action);
  const distance = actorSpeed(context, token, action);
  return {
    ...(movementActionAllowed(movementAction) ? { allowedActions: [movementAction] } : {}),
    maxDistance: distance,
    maxCost: distance,
    preventDrop: true,
  };
}

function activateTokenForMovementPlanning(token) {
  try {
    if (typeof token?.layer?.activate === "function") token.layer.activate({ tool: "select" });
    else if (typeof globalThis.canvas?.tokens?.activate === "function") globalThis.canvas.tokens.activate({ tool: "select" });
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Failed to activate token layer for movement planning", error);
  }

  try {
    if (typeof token?.control === "function") {
      token.control({ releaseOthers: true });
      return;
    }
    if (typeof token?.object?.control === "function") token.object.control({ releaseOthers: true });
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Failed to control token for movement planning", error);
  }
}

function destinationCenter(position, token) {
  const center = point(position?.center);
  if (center) return center;

  const topLeft = point(position);
  if (!topLeft) return null;

  const size = gridSize();
  const width = Math.max(1, numeric(position?.width ?? token?.document?.width ?? token?.width, 1) || 1);
  const height = Math.max(1, numeric(position?.height ?? token?.document?.height ?? token?.height, 1) || 1);
  return {
    x: topLeft.x + (width * size) / 2,
    y: topLeft.y + (height * size) / 2,
  };
}

function tokenCenter(context, token) {
  const center = point(context?.token?.plannedCenter)
    ?? point(context?.token?.center)
    ?? point(token?.center);
  if (center) return center;

  const document = token?.document ?? context?.token?.document ?? {};
  const x = numeric(document.x ?? token?.x ?? context?.token?.x);
  const y = numeric(document.y ?? token?.y ?? context?.token?.y);
  if (x === null || y === null) return null;

  const size = gridSize();
  const width = Math.max(1, numeric(document.width ?? token?.width ?? context?.token?.width, 1) || 1);
  const height = Math.max(1, numeric(document.height ?? token?.height ?? context?.token?.height, 1) || 1);
  return {
    x: x + (width * size) / 2,
    y: y + (height * size) / 2,
  };
}

function movementSegmentCost(from, to, startingDiagonalCount = 0, options = {}) {
  if (!from || !to) return { cost: 0, diagonalCount: startingDiagonalCount };
  return pf2eMovementSegmentCost(from, to, {
    ...options,
    gridSize: gridSize(),
    gridDistance: gridDistance(),
    startingDiagonalCount,
  });
}

function waypointPathCost(origin, waypoints, options = {}) {
  let cost = 0;
  let from = origin;
  let diagonalCount = 0;
  for (const waypoint of waypoints) {
    const movement = movementSegmentCost(from, waypoint, diagonalCount, options);
    cost += movement.cost;
    diagonalCount = movement.diagonalCount;
    from = waypoint;
  }
  return cost;
}

// Total feet of vertical travel along origin -> wp1 -> wp2 -> ..., where each waypoint carries its
// own target elevation (so a path can climb, level off, then descend). Waypoints without an
// elevation hold the previous height.
function verticalPathCost(waypoints, originElevation = 0) {
  let cost = 0;
  let previous = numeric(originElevation) ?? 0;
  for (const waypoint of waypoints) {
    const elevation = numeric(waypoint?.elevation);
    const next = elevation === null ? previous : elevation;
    cost += Math.abs(next - previous);
    previous = next;
  }
  return cost;
}

function movementPlanForWaypoints(context, action, token, waypoints, { originElevation = 0 } = {}) {
  // Preserve each waypoint's own elevation so the executor can climb/descend per leg.
  const cleanWaypoints = waypoints.map((waypoint) => {
    const elevation = numeric(waypoint?.elevation);
    return elevation === null ? { x: waypoint.x, y: waypoint.y } : { x: waypoint.x, y: waypoint.y, elevation };
  });
  const maxCost = actorSpeed(context, token, action);
  const movementAction = movementActionForAction(action);
  const horizontalCost = waypointPathCost(tokenCenter(context, token), cleanWaypoints, {
    actor: token?.actor ?? context?.actor,
    collisionToken: token,
    movementAction,
  });
  return {
    native: false,
    waypoints: cleanWaypoints,
    // Flying/burrowing up or down counts toward Speed: every foot of elevation change along the path
    // costs a foot of movement, added on top of the horizontal distance.
    cost: horizontalCost + verticalPathCost(cleanWaypoints, originElevation),
    maxCost,
  };
}

function eventShiftKey(event) {
  const pointerDown = event?.__pf2eCombaterDestinationPickerPointerDown ?? null;
  return Boolean(
    event?.shiftKey
    ?? event?.data?.originalEvent?.shiftKey
    ?? event?.nativeEvent?.shiftKey
    ?? event?.originalEvent?.shiftKey
    ?? pointerDown?.shiftKey
    ?? pointerDown?.data?.originalEvent?.shiftKey
    ?? pointerDown?.nativeEvent?.shiftKey
    ?? pointerDown?.originalEvent?.shiftKey,
  );
}

function eventClickCount(event) {
  const pointerDown = event?.__pf2eCombaterDestinationPickerPointerDown ?? null;
  const counts = [
    event?.detail
    ?? event?.data?.originalEvent?.detail
    ?? event?.nativeEvent?.detail
    ?? event?.originalEvent?.detail,
    pointerDown?.detail
    ?? pointerDown?.data?.originalEvent?.detail
    ?? pointerDown?.nativeEvent?.detail
    ?? pointerDown?.originalEvent?.detail,
  ].map(numeric).filter((count) => Number.isFinite(count) && count > 0);
  return Math.max(1, ...counts);
}

function movementPlanFromResult(plan) {
  return {
    id: plan.id,
    origin: plan.origin,
    destination: plan.destination,
    waypoints: Array.isArray(plan.waypoints) ? plan.waypoints : [],
  };
}

function notifyNativeDestinationFailure(error) {
  const message = error?.message ? t("Picker.RulerFailedReason", "Destination ruler failed: {error}", { error: error.message }) : t("Picker.RulerFailed", "Destination ruler failed.");
  globalThis.console?.warn?.("pf2e-combater | Destination ruler failed", error);
  globalThis.ui?.notifications?.warn?.(message);
}

function stopDestinationPicker({ notifyCancel = true } = {}) {
  const cleanup = activeCleanup;
  const onCancel = activeOnCancel;
  activeCleanup = null;
  activeOnCancel = null;
  cleanup?.();
  if (notifyCancel) onCancel?.();
}

export function cancelDestinationPicker() {
  stopDestinationPicker();
}

function chooseNativeDestination({ context, action, onChoose, onCancel }) {
  const token = canvasTokenById(tokenId(context));
  if (typeof token?.planMovement !== "function") return null;

  const cleanup = () => {
    token.layer?._cancelMovementPlanning?.();
  };
  activeCleanup = cleanup;
  activeOnCancel = typeof onCancel === "function" ? onCancel : null;

  void (async () => {
    try {
      activateTokenForMovementPlanning(token);
      const plan = await token.planMovement(planMovementOptions({ context, action, token }));
      if (activeCleanup !== cleanup) return;
      activeCleanup = null;
      activeOnCancel = null;
      if (!plan) {
        onCancel?.();
        return;
      }

      const destination = destinationCenter(plan.destination, token);
      if (!destination) throw new Error(t("Picker.NoDestinationInPlan", "Movement plan did not include a destination."));
      onChoose(destination, { movementPlan: movementPlanFromResult(plan) });
    } catch (error) {
      notifyNativeDestinationFailure(error);
      if (activeCleanup === cleanup) stopDestinationPicker();
    }
  })();

  return { cancel: cancelDestinationPicker, native: true };
}

export function chooseDestination({
  context,
  action,
  onChoose,
  onCancel,
  onPreview,
  useNativeRuler = false,
  enableWaypoints = false,
} = {}) {
  cancelDestinationPicker();

  if (typeof onChoose !== "function") return null;

  if (useNativeRuler) {
    const nativePicker = chooseNativeDestination({ context, action, onChoose, onCancel });
    if (nativePicker) return nativePicker;
  }

  const token = canvasTokenById(tokenId(context));
  const vertical = verticalMovementForAction(action);
  const originElevation = vertical ? tokenElevation(token) : 0;
  // Working elevation: the height of the active (last-placed) waypoint, or — before any waypoint —
  // the height the first placed point will take. Shift+scroll moves it; a freshly placed waypoint
  // starts from it (carrying the previous waypoint's height) and becomes the new active one.
  let pendingElevation = originElevation;
  let handled = false;
  let waypoints = [];

  // Stamp the working elevation onto a freshly placed point so it flows to persistence/execution.
  const withElevation = (destination) =>
    vertical && destination ? { ...destination, elevation: pendingElevation } : destination;
  const planForWaypoints = (points) =>
    movementPlanForWaypoints(context, action, token, points, { originElevation });
  const previewMetadata = (points) => ({
    ...(points.length ? { movementPlan: planForWaypoints(points) } : {}),
    ...(vertical ? { elevation: pendingElevation } : {}),
  });

  const allowPickerPointerEvent = (event) =>
    isPrimaryPointerEvent(event) || (enableWaypoints && eventShiftKey(event) && eventButton(event) === 2);
  const handler = (event) => {
    if (handled) return;
    const waypointRemove = enableWaypoints && eventShiftKey(event) && eventButton(event) === 2;
    if (!isPrimaryPointerEvent(event) && !waypointRemove) return;
    if (!eventTargetsCanvas(event)) return;
    suppressPointerEvent(event);

    try {
      if (waypointRemove) {
        waypoints = waypoints.slice(0, -1);
        // Resume from the new tip's height so further scrolls/placements continue from there.
        if (vertical) pendingElevation = numeric(waypoints.at(-1)?.elevation) ?? originElevation;
        const destination = waypoints.at(-1) ?? null;
        onPreview?.(destination, destination ? previewMetadata(waypoints) : {});
        return;
      }

      const rawPoint = eventCanvasPoint(event);
      if (!rawPoint) return;
      const destination = withElevation(snappedCenter(rawPoint));
      const waypointPick = enableWaypoints && eventShiftKey(event);
      const waypointFinalize = waypointPick && eventClickCount(event) >= 2;
      const candidateWaypoints = enableWaypoints
        ? waypointFinalize && samePoint(waypoints.at(-1), destination)
          ? [...waypoints]
          : [...waypoints, destination]
        : [];
      // Even outside waypoint mode, a single click already picks a real destination -- compute its
      // plan too (as a one-point path) so the distance/cost readout shows without requiring the
      // player to lay down an actual waypoint first.
      // Before falling back to a naive straight-line cost, ask the same obstacle/terrain-avoiding
      // BFS that drives the reachable-area overlay whether it already found a (possibly bent, cheaper)
      // route here -- otherwise a square the overlay highlights as reachable via a detour around
      // difficult terrain gets rejected here as "beyond movement range" for assuming a direct line.
      // Only applies to a still-straight, no-bend-yet candidate: once the player has manually laid a
      // waypoint and is placing the next one, that segment is a real drawn line and must cost as one.
      const routedCandidate = !vertical && candidateWaypoints.length <= 1
        ? movementRouteToPoint(context, action, destination)
        : null;
      const candidateMovementPlan = routedCandidate
        ? {
          native: false,
          waypoints: routedCandidate.waypoints?.length ? routedCandidate.waypoints : [destination],
          cost: routedCandidate.cost,
          maxCost: actorSpeed(context, token, action),
        }
        : enableWaypoints
          ? planForWaypoints(candidateWaypoints)
          : planForWaypoints([destination]);
      const metadata = {
        ...(candidateMovementPlan ? { movementPlan: candidateMovementPlan } : {}),
        ...(vertical ? { elevation: pendingElevation } : {}),
      };

      if (candidateMovementPlan && candidateMovementPlan.cost > candidateMovementPlan.maxCost) {
        globalThis.ui?.notifications?.warn?.(action?.activityProfile?.teleport === true
          ? t("Move.BeyondSpellRange", "Destination is beyond the spell's range.")
          : t("Move.BeyondRangeDest", "Destination is beyond movement range."));
        return;
      }

      if (waypointPick && !waypointFinalize) {
        waypoints = candidateWaypoints;
        onPreview?.(destination, metadata);
        return;
      }

      handled = true;
      onChoose(destination, metadata);
    } finally {
      if (handled) stopDestinationPicker({ notifyCancel: false });
    }
  };

  const cleanup = addPointerHandler(handler, allowPickerPointerEvent);
  if (!cleanup) return null;

  // Shift+scroll adjusts the elevation of the active (last-placed) waypoint in place, in one-grid-step
  // increments while flying/burrowing. Placing the next waypoint (or double-clicking to finalize)
  // locks that height; the next waypoint then starts from it and becomes the one the wheel edits.
  // Before any waypoint is placed, the wheel sets the first point's height, previewed at the cursor.
  const wheelCleanup = vertical
    ? addWheelHandler((event) => {
      // Plain scroll keeps zooming the canvas; only Shift+scroll adjusts the flight/burrow elevation.
      if (!eventShiftKey(event)) return;
      suppressPointerEvent(event);
      const step = eventWheelDelta(event);
      if (!step) return;
      pendingElevation += step * gridDistance();
      if (waypoints.length) {
        // Edit the active waypoint's height directly so the readout sits on it; earlier waypoints
        // stay locked at the heights they were placed at.
        waypoints[waypoints.length - 1] = { ...waypoints[waypoints.length - 1], elevation: pendingElevation };
        onPreview?.(waypoints.at(-1), previewMetadata(waypoints));
        return;
      }
      const rawPoint = point(globalThis.canvas?.mousePosition);
      const hover = rawPoint ? withElevation(snappedCenter(rawPoint)) : null;
      onPreview?.(hover, previewMetadata(waypoints));
    })
    : null;

  activeCleanup = () => {
    cleanup();
    wheelCleanup?.();
  };
  activeOnCancel = typeof onCancel === "function" ? onCancel : null;
  if (vertical) {
    globalThis.ui?.notifications?.info?.(
      t("Picker.VerticalHint", "Hold Shift and scroll to set elevation (currently {feet} ft).", { feet: originElevation }),
    );
  }
  return { cancel: cancelDestinationPicker };
}
