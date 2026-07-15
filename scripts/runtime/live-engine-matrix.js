import { MODULE_ID } from "../constants.js";
import { isSocketReady, requestLiveEngineMatrixPing } from "../socket.js";

function point(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const elevation = Number(value?.elevation);
  return Number.isFinite(elevation) ? { x, y, elevation } : { x, y };
}

function currentPoint(document) {
  return point(document) ?? { x: 0, y: 0 };
}

function samePoint(left, right) {
  if (!left || !right || left.x !== right.x || left.y !== right.y) return false;
  const leftElevation = Number(left.elevation);
  const rightElevation = Number(right.elevation);
  if (!Number.isFinite(leftElevation) && !Number.isFinite(rightElevation)) return true;
  return leftElevation === rightElevation;
}

function regionIds(document) {
  const regions = document?.regions;
  if (!regions) return [];
  const values = Array.isArray(regions)
    ? regions
    : (typeof regions.values === "function" ? Array.from(regions.values()) : Array.from(regions));
  return values
    .map((region) => String(region?.id ?? region ?? ""))
    .filter(Boolean)
    .toSorted();
}

function movementHistory(document) {
  return Array.isArray(document?._source?._movementHistory)
    ? document._source._movementHistory
    : [];
}

function result(id, status, summary, details = {}) {
  return Object.freeze({ id, status, summary, details: Object.freeze(details) });
}

function report(results, session) {
  const failures = results.filter((entry) => entry.status === "failed");
  return Object.freeze({
    ok: failures.length === 0,
    session: Object.freeze(session),
    results: Object.freeze(results),
    failures: Object.freeze(failures.map((entry) => `${entry.id}: ${entry.summary}`)),
  });
}

function movementWaypoints(token, movement, gridSize) {
  if (Array.isArray(movement?.waypoints)) {
    return movement.waypoints.map(point).filter(Boolean);
  }
  if (!Array.isArray(movement?.deltas)) return [];
  const origin = currentPoint(token?.document ?? token);
  return movement.deltas
    .map((delta) => {
      const x = Number(delta?.x);
      const y = Number(delta?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x: origin.x + x * gridSize,
        y: origin.y + y * gridSize,
        ...(origin.elevation === undefined ? {} : { elevation: origin.elevation }),
      };
    })
    .filter(Boolean);
}

function nativeWaypoints(waypoints, action) {
  return waypoints.map((waypoint) => ({
    ...waypoint,
    action,
    explicit: true,
    checkpoint: true,
    snapped: true,
  }));
}

async function restoreOrigin(document, movementId, origin) {
  if (typeof document?.revertRecordedMovement === "function") {
    try {
      const reverted = await document.revertRecordedMovement(movementId);
      if (reverted && samePoint(currentPoint(document), origin)) return true;
    } catch (_error) {
      // Fall through to direct cleanup. This is test-harness recovery, not engine Undo.
    }
  }
  if (typeof document?.update !== "function") return false;
  await document.update(origin);
  return samePoint(currentPoint(document), origin);
}

export function createFoundryLiveEngineAdapter({
  getGame = () => globalThis.game,
  getCanvas = () => globalThis.canvas,
  getHooks = () => globalThis.Hooks,
  socketReady = isSocketReady,
  socketPing = requestLiveEngineMatrixPing,
} = {}) {
  return Object.freeze({
    session: () => {
      const game = getGame();
      return {
        ready: game?.ready === true,
        foundryVersion: String(game?.version ?? game?.release?.version ?? ""),
        systemId: String(game?.system?.id ?? ""),
        systemVersion: String(game?.system?.version ?? ""),
        userId: String(game?.user?.id ?? ""),
        isGM: game?.user?.isGM === true,
      };
    },
    selectedToken: () => getCanvas()?.tokens?.controlled?.[0] ?? null,
    tokenById: (id) => getCanvas()?.tokens?.get?.(id) ?? null,
    gridSize: () => Number(getCanvas()?.grid?.size ?? getCanvas()?.dimensions?.size) || 100,
    actionBySlug: (slug) => getGame()?.pf2e?.actions?.get?.(slug) ?? null,
    socketReady,
    socketPing,
    randomId: () => globalThis.foundry?.utils?.randomID?.() ?? `live-${Date.now()}`,
    onHook: (name, listener) => getHooks()?.on?.(name, listener) ?? null,
    offHook: (name, id) => getHooks()?.off?.(name, id),
  });
}

export function createFixtureLiveEngineAdapter(overrides = {}) {
  return Object.freeze({
    session: () => ({ ready: true, foundryVersion: "14.test", systemId: "pf2e", systemVersion: "test", userId: "gm", isGM: true }),
    selectedToken: () => null,
    tokenById: () => null,
    gridSize: () => 100,
    actionBySlug: () => null,
    socketReady: () => false,
    socketPing: async () => null,
    randomId: () => "live-matrix-test",
    onHook: () => null,
    offHook: () => {},
    ...overrides,
  });
}

export function createLiveEngineMatrix(adapter) {
  const required = ["session", "selectedToken", "tokenById", "gridSize", "actionBySlug", "socketReady", "socketPing", "randomId", "onHook", "offHook"];
  if (!adapter || required.some((key) => typeof adapter[key] !== "function")) {
    throw new TypeError("Live engine matrix adapter is invalid");
  }

  async function runMovementCheck(options, session) {
    const movement = options?.movement;
    if (!movement) return result("movement-round-trip", "skipped", "No movement route requested.");
    if (options?.allowMutations !== true) {
      return result("movement-round-trip", "skipped", "Set allowMutations to run movement and native Undo.");
    }
    if (session.isGM !== true) {
      return result("movement-round-trip", "failed", "Movement matrix requires a GM session.");
    }

    const token = movement.tokenId ? adapter.tokenById(movement.tokenId) : adapter.selectedToken();
    const document = token?.document ?? token;
    if (!token || !document) return result("movement-round-trip", "failed", "Select a token or provide movement.tokenId.");
    if (typeof token.measureMovementPath !== "function" || typeof document.move !== "function" || typeof document.revertRecordedMovement !== "function") {
      return result("movement-round-trip", "failed", "Selected token lacks native movement measurement, move, or recorded Undo.");
    }

    const route = movementWaypoints(token, movement, adapter.gridSize());
    if (route.length < 2) {
      return result("movement-round-trip", "failed", "Provide at least two waypoints or relative deltas.");
    }

    const action = String(movement.action ?? "walk");
    const waypoints = nativeWaypoints(route, action);
    const origin = currentPoint(document);
    const regionsBefore = regionIds(document);
    const movementId = adapter.randomId();
    const hookEvents = [];
    const hookIds = [];
    for (const hook of ["preMoveToken", "moveToken", "recordToken", "stopToken"]) {
      const id = adapter.onHook(hook, (movedDocument, move) => {
        if (movedDocument === document && (!move?.id || move.id === movementId)) hookEvents.push(hook);
      });
      hookIds.push([hook, id]);
    }

    let cleanupRestored = false;
    try {
      const measurement = token.measureMovementPath(waypoints, { preview: false });
      const moved = await document.move(waypoints, { id: movementId, method: "api", showRuler: false });
      const destination = currentPoint(document);
      const regionsAfter = regionIds(document);
      const historyRecorded = movementHistory(document).some((entry) => entry?.movementId === movementId);
      const reverted = await document.revertRecordedMovement(movementId);
      const restored = samePoint(currentPoint(document), origin);
      const regionsRestored = regionIds(document);
      const hooksObserved = hookEvents.includes("moveToken") && hookEvents.includes("recordToken");
      const passed = moved !== false && historyRecorded && reverted !== false && restored && hooksObserved;
      return result(
        "movement-round-trip",
        passed ? "passed" : "failed",
        passed ? "Native multi-waypoint movement and recorded Undo passed." : "Native movement round trip did not preserve every required behavior.",
        {
          movementId,
          measuredCost: Number(measurement?.cost ?? 0),
          moved: moved !== false,
          historyRecorded,
          reverted: reverted !== false,
          restored,
          origin,
          destination,
          hookEvents: Object.freeze([...hookEvents]),
          regionsBefore: Object.freeze(regionsBefore),
          regionsAfter: Object.freeze(regionsAfter),
          regionsRestored: Object.freeze(regionsRestored),
        },
      );
    } catch (error) {
      return result("movement-round-trip", "failed", error?.message ?? String(error));
    } finally {
      for (const [hook, id] of hookIds) adapter.offHook(hook, id);
      if (!samePoint(currentPoint(document), origin)) {
        cleanupRestored = await restoreOrigin(document, movementId, origin);
      }
      if (!cleanupRestored && !samePoint(currentPoint(document), origin)) {
        console.error(`${MODULE_ID} | Live movement matrix could not restore token ${document?.id ?? "unknown"}`);
      }
    }
  }

  async function run(options = {}) {
    const session = adapter.session();
    const results = [];
    const sessionReady = session.ready === true && session.systemId === "pf2e";
    results.push(result(
      "authenticated-session",
      sessionReady ? "passed" : "failed",
      sessionReady ? "Authenticated PF2e world is ready." : "Authenticated PF2e world is not ready.",
      { foundryVersion: session.foundryVersion, systemVersion: session.systemVersion, userId: session.userId, isGM: session.isGM },
    ));

    const actionSlug = String(options.actionSlug ?? "seek");
    const systemAction = adapter.actionBySlug(actionSlug);
    const actionReady = typeof systemAction?.use === "function" || typeof systemAction === "function";
    results.push(result(
      "pf2e-system-action",
      actionReady ? "passed" : "failed",
      actionReady ? `PF2e action ${actionSlug} is live.` : `PF2e action ${actionSlug} is unavailable.`,
    ));

    if (!adapter.socketReady()) {
      results.push(result("socket-round-trip", "failed", "socketlib is not ready."));
    } else {
      const nonce = adapter.randomId();
      const response = await adapter.socketPing({ nonce });
      const socketPassed = response?.nonce === nonce && response?.isGM === true;
      results.push(result(
        "socket-round-trip",
        socketPassed ? "passed" : "failed",
        socketPassed ? "socketlib GM round trip passed." : "socketlib GM round trip failed.",
        { gmUserId: String(response?.userId ?? "") },
      ));
    }

    results.push(await runMovementCheck(options, session));
    return report(results, session);
  }

  return Object.freeze({ run });
}

export function respondLiveEngineMatrixPing({ nonce } = {}) {
  if (globalThis.game?.user?.isGM !== true) return null;
  return Object.freeze({ nonce: String(nonce ?? ""), isGM: true, userId: String(globalThis.game.user.id ?? "") });
}

export const liveEngineMatrix = createLiveEngineMatrix(createFoundryLiveEngineAdapter());

export function runLiveEngineMatrix(options = {}) {
  return liveEngineMatrix.run(options);
}
