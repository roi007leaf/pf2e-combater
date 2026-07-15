import { normalizedActionFacts } from '../action/facts.js';

function availableUses(resource) {
  const remaining = Number(resource?.remaining);
  if (
    resource?.remaining !== null &&
    resource?.remaining !== undefined &&
    Number.isFinite(remaining)
  ) {
    return Math.max(0, Math.floor(remaining));
  }
  // Availability readers already rejected spent resources. When PF2e exposes a limited resource
  // without a numeric remaining count, reserve its one known-usable activation conservatively.
  return 1;
}

export function reservePlanResource(reservations, action) {
  const current = reservations instanceof Map ? reservations : new Map();
  const resource = normalizedActionFacts(action).economy.resource;
  if (!resource?.poolKey) return current;

  const used = current.get(resource.poolKey) ?? 0;
  if (used >= availableUses(resource)) return null;

  const next = new Map(current);
  next.set(resource.poolKey, used + 1);
  return next;
}

export function reservationsForPlan(actions = []) {
  let reservations = new Map();
  for (const action of actions) {
    if (String(action?.execution?.status ?? '').toLowerCase() === 'done') continue;
    const next = reservePlanResource(reservations, action);
    if (next) reservations = next;
  }
  return reservations;
}
