import { pf2eMovementSegmentCost } from "../rules/movement-cost.js";
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

function actorSpeed(context, token, action) {
  const slug = actionSlug(action);
  if (slug === "crawl" || slug === "step") return 5;

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

function movementPlanForWaypoints(context, action, token, waypoints) {
  const cleanWaypoints = waypoints.map((waypoint) => ({ x: waypoint.x, y: waypoint.y }));
  const maxCost = actorSpeed(context, token, action);
  const movementAction = movementActionForAction(action);
  return {
    native: false,
    waypoints: cleanWaypoints,
    cost: waypointPathCost(tokenCenter(context, token), cleanWaypoints, {
      actor: token?.actor ?? context?.actor,
      collisionToken: token,
      movementAction,
    }),
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
  let handled = false;
  let waypoints = [];
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
        const destination = waypoints.at(-1) ?? null;
        const metadata = destination
          ? { movementPlan: movementPlanForWaypoints(context, action, token, waypoints) }
          : {};
        onPreview?.(destination, metadata);
        return;
      }

      const rawPoint = eventCanvasPoint(event);
      if (!rawPoint) return;
      const destination = snappedCenter(rawPoint);
      const waypointPick = enableWaypoints && eventShiftKey(event);
      const waypointFinalize = waypointPick && eventClickCount(event) >= 2;
      const candidateWaypoints = enableWaypoints
        ? waypointFinalize && samePoint(waypoints.at(-1), destination)
          ? [...waypoints]
          : [...waypoints, destination]
        : [];
      const candidateMovementPlan = enableWaypoints
        ? movementPlanForWaypoints(context, action, token, candidateWaypoints)
        : null;
      const metadata = candidateMovementPlan && (waypointPick || waypointFinalize || waypoints.length)
        ? { movementPlan: candidateMovementPlan }
        : {};

      if (candidateMovementPlan && candidateMovementPlan.cost > candidateMovementPlan.maxCost) {
        globalThis.ui?.notifications?.warn?.(t("Move.BeyondRangeDest", "Destination is beyond movement range."));
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
  activeCleanup = cleanup;
  activeOnCancel = typeof onCancel === "function" ? onCancel : null;
  return { cancel: cancelDestinationPicker };
}
