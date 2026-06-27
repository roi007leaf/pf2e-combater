// Only movement/footprint geometry matters for a combat plan. Visibility (`hidden`) is
// deliberately excluded: modules like pf2e-visioner toggle per-observer visibility constantly,
// and including it here made every visibility flicker trigger a full (expensive) plan rebuild,
// which lagged the canvas the whole time the panel was open.
const GEOMETRY_KEYS = new Set(["x", "y", "elevation", "width", "height"]);
const MOVEMENT_KEYS = new Set(["x", "y", "elevation"]);
const MAX_MOVEMENT_ACTION_SPENDS = 3;
const tokenSnapshots = new Map();
const movementActionSpends = new Map();
const movementActionDistances = new Map();
const movementOrigins = new Map();

function tokenDocument(token) {
  return token?.document ?? token ?? {};
}

function tokenKey(token) {
  const document = tokenDocument(token);
  return document.uuid
    ?? token?.uuid
    ?? document.id
    ?? token?.id
    ?? null;
}

function identityValues(...values) {
  return values
    .flatMap((value) => {
      const document = tokenDocument(value);
      return [
        value?.id,
        value?.uuid,
        document.id,
        document.uuid,
      ];
    })
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value));
}

function combatantTokenValues(combatant) {
  const token = combatant?.token?.object
    ?? combatant?.token
    ?? combatant?.tokenDocument
    ?? combatant?.document?.token
    ?? null;
  return [
    combatant?.tokenId,
    combatant?.tokenUuid,
    ...identityValues(token),
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value));
}

function tokenMatchesCombatant(token, combatant) {
  const tokenIds = new Set(identityValues(token));
  if (!tokenIds.size) return false;
  return combatantTokenValues(combatant).some((id) => tokenIds.has(id));
}

function combatTurnKey(combat) {
  const combatant = combat?.combatant ?? null;
  const combatId = combat?.id ?? combat?.uuid ?? null;
  const combatantId = combatant?.id ?? combatant?.uuid ?? combatantTokenValues(combatant)[0] ?? null;
  if (!combatId || !combatantId) return null;
  return `${combatId}:${combat?.round ?? 0}:${combat?.turn ?? 0}:${combatantId}`;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tokenPosition(token) {
  const document = tokenDocument(token);
  const x = snapshotValue(token?.x, document.x);
  const y = snapshotValue(token?.y, document.y);
  if (x === null || y === null) return null;
  return {
    x: numeric(x, 0),
    y: numeric(y, 0),
    elevation: numeric(snapshotValue(token?.elevation, document.elevation), 0),
  };
}

function snapshotValue(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return null;
}

function tokenSnapshot(token) {
  const document = tokenDocument(token);
  // Snapshot the DOCUMENT position, never the placeable's live `token.x`/`token.y`. The placeable
  // position animates every frame (turn-marker bobs, float effects, movement tweens), so reading it
  // made each animation tick look like a move and triggered a full ~400ms plan rebuild ~6x/second —
  // the "lag while the window is open". The document only changes on a real move. Also no `hidden`:
  // visibility changes (e.g. pf2e-visioner) are not plan-relevant. Only real geometry counts.
  return JSON.stringify({
    x: snapshotValue(document.x, token?.x),
    y: snapshotValue(document.y, token?.y),
    elevation: snapshotValue(document.elevation, token?.elevation),
    width: snapshotValue(document.width, token?.width),
    height: snapshotValue(document.height, token?.height),
  });
}

function gridMetrics() {
  const sceneDistance = numeric(globalThis.canvas?.scene?.grid?.distance, 5) || 5;
  const pixelSize = numeric(globalThis.canvas?.grid?.size, sceneDistance) || sceneDistance;
  return {
    sceneDistance,
    pixelSize,
    pixelsPerFoot: pixelSize / sceneDistance,
  };
}

function pointFromValue(value) {
  const point = value?.center ?? value;
  if (!point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, elevation: numeric(point.elevation, 0) };
}

function movementWaypoints(changed, options = {}) {
  const candidates = [
    options?.waypoints,
    options?.movement?.waypoints,
    options?.animation?.waypoints,
    changed?.waypoints,
    changed?.movement?.waypoints,
    changed?.animation?.waypoints,
    changed?.path,
    changed?.route,
  ];
  const waypoints = candidates.find((candidate) => Array.isArray(candidate));
  return waypoints ? waypoints.map(pointFromValue).filter(Boolean) : [];
}

function movementTargetPosition(token, changed = null) {
  const current = tokenPosition(token);
  if (!changed) return current;
  if (!tokenUpdateAffectsMovement(changed)) return current;

  const document = tokenDocument(token);
  const x = snapshotValue(changed.x, changed.document?.x, token?.x, document.x);
  const y = snapshotValue(changed.y, changed.document?.y, token?.y, document.y);
  if (x === null || y === null) return current;
  return {
    x: numeric(x, current?.x ?? 0),
    y: numeric(y, current?.y ?? 0),
    elevation: numeric(
      snapshotValue(changed.elevation, changed.document?.elevation, token?.elevation, document.elevation),
      current?.elevation ?? 0,
    ),
  };
}

function measurePathFeet(points) {
  if (points.length < 2) return 0;

  try {
    const measured = globalThis.canvas?.grid?.measurePath?.(points);
    const distance = Number(measured?.distance ?? measured);
    if (Number.isFinite(distance)) return distance;
  } catch (_error) {
    // Fall back to Euclidean segment sum below.
  }

  const metrics = gridMetrics();
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + Math.hypot(point.x - previous.x, point.y - previous.y) / metrics.pixelsPerFoot;
  }, 0);
}

function movementSpeedFeet(combat) {
  const actor = combat?.combatant?.actor ?? {};
  const speed = numeric(
    actor?.profile?.speed
      ?? actor?.system?.attributes?.speed?.value
      ?? actor?.system?.movement?.speeds?.land?.value
      ?? actor?.system?.movement?.speeds?.land?.base
      ?? actor?.system?.movement?.speed?.value
      ?? actor?.system?.speed?.value,
    25,
  );
  return speed > 0 ? speed : 25;
}

function movementDistanceFeet({ combat, from, to, changed, options }) {
  if (!from || !to) return movementSpeedFeet(combat);

  const path = [from, ...movementWaypoints(changed, options), to];
  const distance = measurePathFeet(path);
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return distance;
}

function movementSpendCountForDistance(distance, speed) {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.max(1, Math.ceil((distance - 0.0001) / speed));
}

export function tokenUpdateAffectsCombatGeometry(changed) {
  if (!changed || typeof changed !== "object") return false;

  return Object.entries(changed).some(([key, value]) =>
    GEOMETRY_KEYS.has(key)
      || (value && typeof value === "object" && tokenUpdateAffectsCombatGeometry(value)),
  );
}

export function tokenUpdateAffectsMovement(changed) {
  if (!changed || typeof changed !== "object") return false;

  return Object.entries(changed).some(([key, value]) =>
    MOVEMENT_KEYS.has(key)
      || (value && typeof value === "object" && tokenUpdateAffectsMovement(value)),
  );
}

export function captureMovementOrigin(token, {
  changed = null,
  origins = movementOrigins,
} = {}) {
  if (changed && !tokenUpdateAffectsMovement(changed)) return false;

  const key = tokenKey(token);
  const origin = tokenPosition(token);
  if (!key || !origin) return false;

  origins.set(key, origin);
  return true;
}

export function markMovementActionSpent(token, {
  combat = globalThis.game?.combat,
  changed = null,
  options = null,
  origins = movementOrigins,
  spends = movementActionSpends,
  distances = movementActionDistances,
} = {}) {
  if (changed && !tokenUpdateAffectsMovement(changed)) return false;
  if (!combat?.started || !combat?.combatant) return false;
  if (!tokenMatchesCombatant(token, combat.combatant)) return false;

  const key = combatTurnKey(combat);
  if (!key) return false;

  const tokenId = tokenKey(token);
  const from = tokenId ? origins.get(tokenId) : null;
  if (tokenId) origins.delete(tokenId);
  const to = movementTargetPosition(token, changed);
  const previous = Number(spends.get(key) ?? 0);
  if (previous >= MAX_MOVEMENT_ACTION_SPENDS) return false;
  const speed = movementSpeedFeet(combat);
  const movementDistance = movementDistanceFeet({ combat, from, to, changed, options });
  if (!Number.isFinite(movementDistance) || movementDistance <= 0) return false;

  const totalDistance = Number(distances.get(key) ?? 0) + movementDistance;
  distances.set(key, totalDistance);

  const count = Math.min(
    movementSpendCountForDistance(totalDistance, speed),
    MAX_MOVEMENT_ACTION_SPENDS,
  );
  if (count <= previous) return false;
  spends.set(key, count);
  return true;
}

export function movementActionsSpent(combat = globalThis.game?.combat, spends = movementActionSpends) {
  const key = combatTurnKey(combat);
  if (!key) return 0;

  const spent = Number(spends.get(key) ?? 0);
  return Number.isFinite(spent) && spent > 0 ? spent : 0;
}

export function consumeTokenRefreshChange(token, snapshots = tokenSnapshots) {
  const key = tokenKey(token);
  if (!key) return true;

  const snapshot = tokenSnapshot(token);
  const previous = snapshots.get(key);
  snapshots.set(key, snapshot);
  return previous === undefined || previous !== snapshot;
}

export function clearTokenRefreshSnapshots(snapshots = tokenSnapshots) {
  snapshots.clear();
}

export function clearMovementActionSpends(spends = movementActionSpends, distances = movementActionDistances) {
  spends.clear();
  distances.clear();
}
