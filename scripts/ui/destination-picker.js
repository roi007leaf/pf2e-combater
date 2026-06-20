let activeCleanup = null;

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function point(value) {
  const x = numeric(value?.x ?? value?.[0]);
  const y = numeric(value?.y ?? value?.[1]);
  return x === null || y === null ? null : { x, y };
}

function gridSize() {
  const size = numeric(globalThis.canvas?.grid?.size);
  return size && size > 0 ? size : 1;
}

function callGrid(method, ...args) {
  try {
    return point(method?.(...args));
  } catch (_error) {
    return null;
  }
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
  const stage = globalThis.canvas?.stage;
  const local = callGrid(event?.data?.getLocalPosition?.bind(event.data), stage)
    ?? callGrid(event?.getLocalPosition?.bind(event), stage);
  if (local) return local;

  const globalPoint = point(event?.global ?? event?.data?.global);
  if (globalPoint && typeof stage?.toLocal === "function") {
    const stageLocal = callGrid(stage.toLocal.bind(stage), globalPoint);
    if (stageLocal) return stageLocal;
  }
  return globalPoint;
}

function addPointerHandler(stage, handler) {
  if (typeof stage?.on === "function") {
    stage.on("pointerdown", handler);
    return () => {
      if (typeof stage.off === "function") stage.off("pointerdown", handler);
      else stage.removeListener?.("pointerdown", handler);
    };
  }
  if (typeof stage?.addEventListener === "function") {
    stage.addEventListener("pointerdown", handler);
    return () => stage.removeEventListener?.("pointerdown", handler);
  }
  return null;
}

function isPrimaryPointerEvent(event) {
  const button = event?.button
    ?? event?.data?.button
    ?? event?.nativeEvent?.button
    ?? event?.originalEvent?.button;
  return button === undefined || button === null || button === 0;
}

export function cancelDestinationPicker() {
  const cleanup = activeCleanup;
  activeCleanup = null;
  cleanup?.();
}

export function chooseDestination({ onChoose } = {}) {
  cancelDestinationPicker();

  const stage = globalThis.canvas?.stage;
  if (!stage || typeof onChoose !== "function") return null;

  const handler = (event) => {
    if (!isPrimaryPointerEvent(event)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();

    try {
      const rawPoint = eventCanvasPoint(event);
      if (!rawPoint) return;
      onChoose(snappedCenter(rawPoint));
    } finally {
      cancelDestinationPicker();
    }
  };

  const cleanup = addPointerHandler(stage, handler);
  if (!cleanup) return null;
  activeCleanup = cleanup;
  return { cancel: cancelDestinationPicker };
}
