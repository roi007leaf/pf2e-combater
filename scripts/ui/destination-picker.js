import { movementBudgetForStep, movementFootprintForToken, movementPlanForDestination as engineMovementPlanForDestination, movementPlanForWaypoints as engineMovementPlanForWaypoints } from "../engine/movement-route.js";
import { t } from "../i18n.js";
import { canvasGridDistance as gridDistance, canvasGridSize as gridSize, canvasTokenById, contextTokenId as tokenId } from "../rules/canvas-geometry.js";
import { pf2eTokenMovementActionForStep } from "../rules/movement-cost.js";

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

// A token's footprint must have its TOP-LEFT on a grid line to align with the grid. For an odd
// footprint (1x1, 3x3, ...) that puts the CENTER on a cell center, but for an even one (2x2 Large,
// 4x4 Gargantuan, ...) the correctly-aligned center sits on a grid VERTEX instead -- always snapping
// to the nearest cell center (as this used to, regardless of footprint) put an even-sized token's
// box half a cell off the grid. `topLeftValue` is the near edge of the cell containing `rawValue`.
function snapAxisToFootprint(rawValue, topLeftValue, size, cells) {
  if (cells % 2 !== 0) return topLeftValue + size / 2;
  return rawValue - topLeftValue < size / 2 ? topLeftValue : topLeftValue + size;
}

function snappedCenter(rawPoint, footprint = { width: 1, height: 1 }) {
  const grid = globalThis.canvas?.grid;
  const size = gridSize();
  const topLeft = callGrid(grid?.getTopLeftPoint?.bind(grid), rawPoint)
    ?? { x: Math.floor(rawPoint.x / size) * size, y: Math.floor(rawPoint.y / size) * size };
  return {
    x: snapAxisToFootprint(rawPoint.x, topLeft.x, size, footprint.width),
    y: snapAxisToFootprint(rawPoint.y, topLeft.y, size, footprint.height),
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

// Live hover preview (the ghost/cost readout tracking the cursor before a click commits it) needs
// its own listener -- pointerdown/up only fire on an actual click, never as the mouse moves over
// the grid beforehand.
function addDomPointerMoveHandler(handler) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.addEventListener !== "function") continue;
    const onPointerMove = (event) => {
      if (!eventTargetsCanvas(event)) return;
      handler(event);
    };
    target.addEventListener("pointermove", onPointerMove, { capture: true });
    cleanups.push(() => target.removeEventListener?.("pointermove", onPointerMove, { capture: true }));
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function addStagePointerMoveHandler(handler) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.addEventListener === "function") continue;
    if (typeof target?.on === "function") {
      target.on("pointermove", handler);
      cleanups.push(() => {
        if (typeof target.off === "function") target.off("pointermove", handler);
        else target.removeListener?.("pointermove", handler);
      });
    }
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function addPointerMoveHandler(handler) {
  return addDomPointerMoveHandler(handler) ?? addStagePointerMoveHandler(handler);
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
  return ["fly", "burrow"].includes(pf2eTokenMovementActionForStep(action));
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

function movementActionAllowed(action) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return !actions || Object.prototype.hasOwnProperty.call(actions, action);
}

function actorSpeed(context, token, action) {
  const movementAction = pf2eTokenMovementActionForStep(action);
  const budget = movementBudgetForStep(context, {
    ...(action ?? {}),
    movementAction,
  }, {
    collisionToken: token,
    teleportFallback: 1000,
  });
  return Number.isFinite(budget) ? budget : 1000;
}

function planMovementOptions({ context, action, token }) {
  const movementAction = pf2eTokenMovementActionForStep(action);
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
  const movementFootprint = movementFootprintForToken(token);
  const footprint = { width: movementFootprint.widthCells, height: movementFootprint.heightCells };
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
  const planForWaypoints = (points) => {
    const movementAction = pf2eTokenMovementActionForStep(action);
    return engineMovementPlanForWaypoints(context, {
      ...(action ?? {}),
      movementAction,
    }, points, {
      actor: token?.actor ?? context?.actor,
      collisionToken: token,
      gridSize: gridSize(),
      gridDistance: gridDistance(),
      movementAction,
      originElevation,
    });
  };
  const previewMetadata = (points) => ({
    ...(points.length ? { movementPlan: planForWaypoints(points) } : {}),
    ...(vertical ? { elevation: pendingElevation } : {}),
  });
  // Shared by the click handler and the live hover preview below -- both need to answer "what would
  // committing to this destination right now cost". Before falling back to a naive straight-line
  // cost, ask the same obstacle/terrain-avoiding BFS that drives the reachable-area overlay whether
  // it already found a (possibly bent, cheaper) route here -- otherwise a square the overlay
  // highlights as reachable via a detour around difficult terrain gets rejected as "beyond movement
  // range" for assuming a direct line. Only applies to a still-straight, no-bend-yet candidate: once
  // waypoints exist and this is the next one being placed, that segment is a real drawn line and
  // must cost as one. A vertical (fly/burrow) pick still qualifies as long as it hasn't actually
  // changed height yet (no Shift+scroll used) -- the BFS is horizontal-only, so a real climb/descent
  // falls back to the straight-line-plus-vertical-cost path below, which already accounts for it.
  const candidatePlanFor = (candidateWaypoints, destination) => {
    const movementAction = pf2eTokenMovementActionForStep(action);
    const routedCandidate = (!vertical || pendingElevation === originElevation) && candidateWaypoints.length <= 1
      ? engineMovementPlanForDestination(context, {
        ...(action ?? {}),
        movementAction,
      }, destination, {
        actor: token?.actor ?? context?.actor,
        collisionToken: token,
        gridSize: gridSize(),
        gridDistance: gridDistance(),
        movementAction,
        originElevation,
      })
      : null;
    return routedCandidate
      ? routedCandidate
      : enableWaypoints
        ? planForWaypoints(candidateWaypoints)
        : planForWaypoints([destination]);
  };

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
      const destination = withElevation(snappedCenter(rawPoint, footprint));
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
      const candidateMovementPlan = candidatePlanFor(candidateWaypoints, destination);
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

  // Live hover preview: pointerdown/up (the handler above) only ever fire on an actual click, so
  // without this the destination overlay (ghost token, cost readout, colored box) only updated once
  // a waypoint was placed -- moving the mouse beforehand showed nothing. This tracks the cursor and
  // re-runs the same preview computation the click handler uses, without committing anything.
  // Always flagged hoverOnly (below), so the renderer routes it to a ghost-only overlay that never
  // touches the persistent reachable-area grid -- safe to keep live-tracking the cursor even mid-path.
  let lastHoverKey = null;
  const hoverCleanup = addPointerMoveHandler((event) => {
    if (handled) return;
    const rawPoint = eventCanvasPoint(event);
    if (!rawPoint) return;
    const destination = withElevation(snappedCenter(rawPoint, footprint));
    // Snapping already collapses most raw mouse movement onto the same grid square -- skip
    // redundant recompute/re-render when the cursor hasn't actually left it.
    const key = `${destination.x},${destination.y},${destination.elevation ?? ""}`;
    if (key === lastHoverKey) return;
    lastHoverKey = key;
    const candidateWaypoints = enableWaypoints ? [...waypoints, destination] : [];
    const candidateMovementPlan = candidatePlanFor(candidateWaypoints, destination);
    onPreview?.(destination, {
      hoverOnly: true,
      ...(candidateMovementPlan ? { movementPlan: candidateMovementPlan } : {}),
      ...(vertical ? { elevation: pendingElevation } : {}),
    });
  });

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
      const hover = rawPoint ? withElevation(snappedCenter(rawPoint, footprint)) : null;
      // Same reasoning as the pointermove hover handler above: before any waypoint is placed, this is
      // still just a preview of the first point's height, not a real commit -- it must not narrow the
      // reachable-area grid.
      onPreview?.(hover, { hoverOnly: true, ...previewMetadata(waypoints) });
    })
    : null;

  activeCleanup = () => {
    cleanup();
    hoverCleanup?.();
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
