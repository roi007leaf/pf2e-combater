import { createAreaRegionData } from "../engine/action-executor.js";

let activeCleanup = null;
let activeOnCancel = null;

const AREA_SHAPES = new Set(["burst", "cone", "cube", "cylinder", "emanation", "line", "ring", "square"]);

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
    canvas?.stage,
    canvas?.app?.stage,
    canvas?.app?.renderer?.stage,
    canvas?.app?.view,
    canvas?.app?.canvas,
    canvas?.app?.renderer?.view,
    canvas?.app?.renderer?.canvas,
    canvas?.app?.renderer?.events?.domElement,
    globalThis.document?.getElementById?.("board"),
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

function addPointerHandler(handler) {
  const cleanups = [];
  for (const target of pointerTargets()) {
    if (typeof target?.on === "function") {
      target.on("pointerdown", handler);
      cleanups.push(() => {
        if (typeof target.off === "function") target.off("pointerdown", handler);
        else target.removeListener?.("pointerdown", handler);
      });
    } else if (typeof target?.addEventListener === "function") {
      target.addEventListener("pointerdown", handler, { capture: true });
      cleanups.push(() => target.removeEventListener?.("pointerdown", handler, { capture: true }));
    }
  }
  if (!cleanups.length) return null;
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function isPrimaryPointerEvent(event) {
  const button = event?.button
    ?? event?.data?.button
    ?? event?.nativeEvent?.button
    ?? event?.originalEvent?.button;
  return button === undefined || button === null || button === 0;
}

function actionShape(action) {
  const value = String(
    action?.targetingProfile?.type
    ?? action?.targetingProfile?.shape
    ?? action?.area?.type
    ?? "burst",
  ).toLowerCase();
  return AREA_SHAPES.has(value) ? value : "burst";
}

function actionDistance(action) {
  return numeric(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius ?? action?.area?.value, 5) ?? 5;
}

function actionWidth(action) {
  return numeric(action?.targetingProfile?.width ?? action?.area?.width, globalThis.canvas?.grid?.size ?? 5) ?? 5;
}

function userColor() {
  return String(globalThis.game?.user?.color?.toString?.() ?? globalThis.game?.user?.color ?? "#f0b34a");
}

function originCenter(context) {
  const tokenId = context?.token?.id ?? context?.token?.uuid ?? context?.combatant?.tokenId;
  const token = (globalThis.canvas?.tokens?.placeables ?? []).find((entry) => {
    const document = entry?.document ?? entry;
    return entry?.id === tokenId || entry?.uuid === tokenId || document?.id === tokenId || document?.uuid === tokenId;
  });
  return point(token?.center) ?? point(context?.token?.center) ?? null;
}

function rotationFromOrigin(context, center) {
  const origin = originCenter(context);
  if (!origin) return 0;
  const radians = Math.atan2(center.y - origin.y, center.x - origin.x);
  return Math.round((radians * 180) / Math.PI);
}

function markerLabel(shape, distance) {
  const name = shape.charAt(0).toUpperCase() + shape.slice(1);
  return `${name} ${distance} ft`;
}

function initialAreaMarker({ context, action }) {
  const shape = actionShape(action);
  const distance = actionDistance(action);
  const center = point(globalThis.canvas?.mousePosition) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  return {
    shape,
    center,
    distance,
    width: actionWidth(action),
    rotation: rotationFromOrigin(context, center),
    originTokenId: context?.token?.id ?? context?.token?.uuid ?? null,
    label: markerLabel(shape, distance),
  };
}

function normalizeShape(shape) {
  return shape?.toObject?.() ?? shape;
}

function firstRegionShape(document) {
  const shapes = document?.shapes ?? document?._source?.shapes ?? document?.source?.shapes;
  if (Array.isArray(shapes)) return normalizeShape(shapes[0]);
  if (typeof shapes?.[Symbol.iterator] === "function") return normalizeShape([...shapes][0]);
  return null;
}

function markerFromRegionShape({ context, action, shape, fallback }) {
  const data = normalizeShape(shape) ?? {};
  const type = actionShape(action);
  const distance = actionDistance(action);
  const center = point(data) ?? point(fallback?.center) ?? point(context?.token?.center) ?? { x: 0, y: 0 };
  return {
    shape: type,
    center,
    distance,
    width: actionWidth(action),
    rotation: numeric(data.rotation ?? fallback?.rotation, rotationFromOrigin(context, center)) ?? 0,
    originTokenId: context?.token?.id ?? context?.token?.uuid ?? null,
    label: markerLabel(type, distance),
  };
}

function placementRegionData({ context, action, marker }) {
  const data = createAreaRegionData({ context, action, marker });
  data.color = userColor();
  data.highlightMode = "coverage";
  data.displayMeasurements = true;
  data.visibility = globalThis.CONST?.REGION_VISIBILITY?.ALWAYS ?? data.visibility;
  if (globalThis.game?.user?.id) {
    data.ownership = { [globalThis.game.user.id]: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3 };
  }
  if (globalThis.canvas?.level?.id) data.levels = [globalThis.canvas.level.id];
  return data;
}

function stopAreaPicker({ notifyCancel = true } = {}) {
  const cleanup = activeCleanup;
  const onCancel = activeOnCancel;
  activeCleanup = null;
  activeOnCancel = null;
  cleanup?.();
  if (notifyCancel) onCancel?.();
}

export function cancelAreaPicker() {
  stopAreaPicker();
}

function notifyNativePlacementFailure(error) {
  const message = error?.message ? `Area template preview failed: ${error.message}` : "Area template preview failed.";
  globalThis.console?.warn?.("pf2e-combater | Area template preview failed", error);
  globalThis.ui?.notifications?.warn?.(message);
}

async function activateSceneControls(control, tool = "select") {
  const controls = globalThis.ui?.controls;
  let activatedControl = false;
  try {
    if (typeof controls?.activate === "function") {
      await controls.activate({ control, tool });
      activatedControl = true;
    } else if (typeof controls?.render === "function") {
      await controls.render({ control, tool });
      activatedControl = true;
    } else if (typeof controls?.initialize === "function") {
      await controls.initialize({ layer: control, tool });
      activatedControl = true;
    }
  } catch (error) {
    globalThis.console?.warn?.(`pf2e-combater | Failed to activate ${control} controls`, error);
  }

  try {
    const layer = globalThis.canvas?.[control];
    if (typeof layer?.activate === "function") {
      layer.activate({ tool });
      return;
    }
  } catch (error) {
    globalThis.console?.warn?.(`pf2e-combater | Failed to activate ${control} layer`, error);
  }

  if (!activatedControl) {
    globalThis.console?.warn?.(`pf2e-combater | No ${control} controls or layer activation API was available.`);
  }
}

function deactivateTokenLayerForRegionPlacement() {
  const tokens = globalThis.canvas?.tokens;
  if (tokens?.active !== true) return;
  try {
    if (typeof tokens.deactivate === "function") tokens.deactivate();
  } catch (error) {
    globalThis.console?.warn?.("pf2e-combater | Failed to deactivate token layer before Region placement", error);
  }
}

function regionPlacementTool(action) {
  const shape = actionShape(action);
  if (shape === "cone") return "cone";
  if (shape === "line" || shape === "square" || shape === "cube") return "rectangle";
  return "circle";
}

async function activateRegionPlacementControls(action) {
  await activateSceneControls("regions", regionPlacementTool(action));
  deactivateTokenLayerForRegionPlacement();
}

function restoreTokenControls() {
  void activateSceneControls("tokens", "select");
}

function chooseNativeAreaMarker({ context, action, onChoose, onCancel }) {
  if (typeof globalThis.canvas?.regions?.placeRegion !== "function") return null;

  const initialMarker = initialAreaMarker({ context, action });
  const data = placementRegionData({ context, action, marker: initialMarker });
  let latestMarker = initialMarker;
  let settled = false;
  let placementConfirmed = false;

  const cleanup = () => {
    if (!settled) globalThis.canvas?.regions?._cancelPlacement?.();
    restoreTokenControls();
  };
  activeCleanup = cleanup;
  activeOnCancel = typeof onCancel === "function" ? onCancel : null;

  void (async () => {
    try {
      await activateRegionPlacementControls(action);
      if (activeCleanup !== cleanup) return;

      const placementPromise = globalThis.canvas.regions.placeRegion(data, {
        create: false,
        onChange: ({ document, shape }) => {
          latestMarker = markerFromRegionShape({
            context,
            action,
            shape: shape ?? firstRegionShape(document),
            fallback: latestMarker,
          });
        },
        preConfirm: ({ document, shape }) => {
          placementConfirmed = true;
          latestMarker = markerFromRegionShape({
            context,
            action,
            shape: shape ?? firstRegionShape(document),
            fallback: latestMarker,
          });
          return true;
        },
      });

      if (typeof placementPromise?.then !== "function") {
        throw new Error("canvas.regions.placeRegion did not return a promise.");
      }

      const document = await placementPromise;
      settled = true;
      if (activeCleanup !== cleanup) return;
      if (!document) {
        stopAreaPicker();
        return;
      }
      if (!placementConfirmed) {
        activeCleanup = null;
        activeOnCancel = null;
        return;
      }
      const marker = markerFromRegionShape({
        context,
        action,
        shape: firstRegionShape(document),
        fallback: latestMarker,
      });
      onChoose(marker);
      stopAreaPicker({ notifyCancel: false });
    } catch (error) {
      settled = true;
      notifyNativePlacementFailure(error);
      if (activeCleanup === cleanup) stopAreaPicker();
    }
  })();

  return { cancel: cancelAreaPicker };
}

export function chooseAreaMarker({ context, action, onChoose, onCancel } = {}) {
  cancelAreaPicker();

  if (typeof onChoose !== "function") return null;

  if (typeof globalThis.canvas?.regions?.placeRegion === "function") {
    return chooseNativeAreaMarker({ context, action, onChoose, onCancel });
  }

  let handled = false;
  const handler = (event) => {
    if (handled) return;
    if (!isPrimaryPointerEvent(event)) return;
    const canvasElement = canvasDomTarget();
    if (canvasElement && event?.target && event.target !== canvasElement && !canvasElement.contains?.(event.target)) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();

    try {
      const rawPoint = eventCanvasPoint(event);
      if (!rawPoint) return;
      handled = true;
      const center = snappedCenter(rawPoint);
      const shape = actionShape(action);
      const distance = actionDistance(action);
      onChoose({
        shape,
        center,
        distance,
        width: actionWidth(action),
        rotation: rotationFromOrigin(context, center),
        originTokenId: context?.token?.id ?? context?.token?.uuid ?? null,
        label: markerLabel(shape, distance),
      });
    } finally {
      if (handled) stopAreaPicker({ notifyCancel: false });
    }
  };

  const cleanup = addPointerHandler(handler);
  if (!cleanup) return null;
  activeCleanup = cleanup;
  activeOnCancel = typeof onCancel === "function" ? onCancel : null;
  return { cancel: cancelAreaPicker };
}
