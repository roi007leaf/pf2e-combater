const GEOMETRY_KEYS = new Set(["x", "y", "elevation", "hidden", "width", "height"]);
const MOVEMENT_KEYS = new Set(["x", "y", "elevation"]);
const MAX_MOVEMENT_ACTION_SPENDS = 3;
const tokenSnapshots = new Map();
const movementActionSpends = new Map();

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

function snapshotValue(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return null;
}

function tokenSnapshot(token) {
  const document = tokenDocument(token);
  return JSON.stringify({
    x: snapshotValue(token?.x, document.x),
    y: snapshotValue(token?.y, document.y),
    elevation: snapshotValue(token?.elevation, document.elevation),
    hidden: snapshotValue(token?.hidden, document.hidden),
    width: snapshotValue(token?.width, document.width),
    height: snapshotValue(token?.height, document.height),
  });
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

export function markMovementActionSpent(token, {
  combat = globalThis.game?.combat,
  changed = null,
  spends = movementActionSpends,
} = {}) {
  if (changed && !tokenUpdateAffectsMovement(changed)) return false;
  if (!combat?.started || !combat?.combatant) return false;
  if (!tokenMatchesCombatant(token, combat.combatant)) return false;

  const key = combatTurnKey(combat);
  if (!key) return false;

  const previous = Number(spends.get(key) ?? 0);
  if (previous >= MAX_MOVEMENT_ACTION_SPENDS) return false;
  spends.set(key, previous + 1);
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

export function clearMovementActionSpends(spends = movementActionSpends) {
  spends.clear();
}
