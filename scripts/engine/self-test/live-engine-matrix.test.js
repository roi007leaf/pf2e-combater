import assert from "node:assert/strict";
import {
  createFixtureLiveEngineAdapter,
  createLiveEngineMatrix,
} from "../../runtime/live-engine-matrix.js";

function hookBus() {
  const listeners = new Map();
  let nextId = 1;
  return {
    on(name, listener) {
      const id = nextId++;
      listeners.set(id, { name, listener });
      return id;
    },
    off(name, id) {
      if (listeners.get(id)?.name === name) listeners.delete(id);
    },
    emit(name, ...args) {
      for (const entry of listeners.values()) {
        if (entry.name === name) entry.listener(...args);
      }
    },
    size: () => listeners.size,
  };
}

const hooks = hookBus();
const origin = { x: 100, y: 200, elevation: 5 };
const document = {
  id: "token-1",
  ...origin,
  regions: new Set([{ id: "origin-region" }]),
  _source: { _movementHistory: [] },
  async move(waypoints, { id }) {
    hooks.emit("preMoveToken", this, { id });
    const destination = waypoints.at(-1);
    this.x = destination.x;
    this.y = destination.y;
    this.elevation = destination.elevation;
    this.regions = new Set([{ id: "destination-region" }]);
    this._source._movementHistory.unshift({ movementId: id });
    hooks.emit("moveToken", this, { id });
    hooks.emit("recordToken", this);
    return true;
  },
  async revertRecordedMovement(id) {
    const index = this._source._movementHistory.findIndex((entry) => entry.movementId === id);
    if (index < 0) return false;
    this._source._movementHistory.splice(index, 1);
    Object.assign(this, origin);
    this.regions = new Set([{ id: "origin-region" }]);
    return true;
  },
  async update(changes) {
    Object.assign(this, changes);
  },
};
const measurements = [];
const token = {
  id: "token-1",
  document,
  measureMovementPath(waypoints, options) {
    measurements.push({ waypoints, options });
    return { cost: 10 };
  },
};
const action = { use: async () => ({ ok: true }) };
const adapter = createFixtureLiveEngineAdapter({
  selectedToken: () => token,
  tokenById: (id) => id === token.id ? token : null,
  actionBySlug: (slug) => slug === "seek" ? action : null,
  socketReady: () => true,
  socketPing: async ({ nonce }) => ({ nonce, isGM: true, userId: "gm" }),
  randomId: () => "movement-1",
  onHook: (name, listener) => hooks.on(name, listener),
  offHook: (name, id) => hooks.off(name, id),
});
const matrix = createLiveEngineMatrix(adapter);
const liveReport = await matrix.run({
  allowMutations: true,
  movement: { deltas: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
});
assert.equal(liveReport.ok, true, liveReport.failures.join("\n"));
assert.deepEqual(liveReport.results.map((entry) => [entry.id, entry.status]), [
  ["authenticated-session", "passed"],
  ["pf2e-system-action", "passed"],
  ["socket-round-trip", "passed"],
  ["movement-round-trip", "passed"],
]);
const movementResult = liveReport.results.at(-1);
assert.equal(movementResult.details.historyRecorded, true);
assert.equal(movementResult.details.restored, true);
assert.deepEqual(movementResult.details.hookEvents, ["preMoveToken", "moveToken", "recordToken"]);
assert.deepEqual(movementResult.details.regionsBefore, ["origin-region"]);
assert.deepEqual(movementResult.details.regionsAfter, ["destination-region"]);
assert.deepEqual(movementResult.details.regionsRestored, ["origin-region"]);
assert.deepEqual({ x: document.x, y: document.y, elevation: document.elevation }, origin);
assert.equal(document._source._movementHistory.length, 0);
assert.equal(hooks.size(), 0, "live matrix should always remove temporary hook listeners");
assert.equal(measurements.length, 1);
assert.deepEqual(measurements[0].waypoints.map(({ x, y }) => ({ x, y })), [{ x: 200, y: 200 }, { x: 200, y: 300 }]);

const readOnlyReport = await matrix.run({ movement: { deltas: [{ x: 1, y: 0 }, { x: 1, y: 1 }] } });
assert.equal(readOnlyReport.results.at(-1).status, "skipped");
assert.deepEqual({ x: document.x, y: document.y, elevation: document.elevation }, origin);

const playerMatrix = createLiveEngineMatrix(createFixtureLiveEngineAdapter({
  session: () => ({ ready: true, foundryVersion: "14.test", systemId: "pf2e", systemVersion: "test", userId: "player", isGM: false }),
  selectedToken: () => token,
  actionBySlug: () => action,
  socketReady: () => true,
  socketPing: async ({ nonce }) => ({ nonce, isGM: true, userId: "gm" }),
}));
const playerReport = await playerMatrix.run({
  allowMutations: true,
  movement: { deltas: [{ x: 1, y: 0 }, { x: 1, y: 1 }] },
});
assert.equal(playerReport.ok, false);
assert.match(playerReport.failures.at(-1), /requires a GM session/);

const cleanupDocument = {
  id: "cleanup-token",
  ...origin,
  _source: { _movementHistory: [] },
  regions: new Set(),
  async move(waypoints) {
    Object.assign(this, waypoints.at(-1));
    throw new Error("movement interrupted");
  },
  async revertRecordedMovement() {
    return false;
  },
  async update(changes) {
    Object.assign(this, changes);
  },
};
const cleanupToken = {
  document: cleanupDocument,
  measureMovementPath: () => ({ cost: 5 }),
};
const cleanupMatrix = createLiveEngineMatrix(createFixtureLiveEngineAdapter({
  selectedToken: () => cleanupToken,
  actionBySlug: () => action,
  socketReady: () => true,
  socketPing: async ({ nonce }) => ({ nonce, isGM: true, userId: "gm" }),
}));
const cleanupReport = await cleanupMatrix.run({
  allowMutations: true,
  movement: { waypoints: [{ x: 200, y: 200 }, { x: 300, y: 200 }] },
});
assert.equal(cleanupReport.ok, false);
assert.match(cleanupReport.failures.at(-1), /movement interrupted/);
assert.deepEqual({ x: cleanupDocument.x, y: cleanupDocument.y, elevation: cleanupDocument.elevation }, origin, "failed matrix movement should restore token in finally");

assert.throws(() => createLiveEngineMatrix({}), /adapter is invalid/);

console.log("PF2e Combater live engine matrix test passed");
