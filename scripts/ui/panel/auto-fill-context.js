import { currentTargetSelection } from "../../engine/action/executor.js";
import { contextEnemies, contextTargets } from "../../engine/target-pool.js";

function targetIdentityValues(target) {
  return [
    target?.id,
    target?.uuid,
    target?.token?.id,
    target?.token?.uuid,
  ].filter(Boolean).map(String);
}

export function currentAutoFillTargetIds(lockedTargetIds = []) {
  const lockedIds = Array.isArray(lockedTargetIds) ? lockedTargetIds.map(String).filter(Boolean) : [];
  const selectedIds = lockedIds.length ? lockedIds : currentTargetSelection().targetTokenIds.map(String);
  return [...new Set(selectedIds)].sort();
}

export function currentAutoFillTargetKey(lockedTargetIds = []) {
  return currentAutoFillTargetIds(lockedTargetIds).join("|");
}

export function contextWithCurrentAutoFillTargets(context, lockedTargetIds = []) {
  const selectedIds = new Set(currentAutoFillTargetIds(lockedTargetIds));
  if (!selectedIds.size) return context;
  // A locked target may not be the user's current target, so look through every enemy as well.
  const pool = [...contextTargets(context), ...contextEnemies(context)];
  const selectedTargets = [...new Map(pool
    .filter((target) => targetIdentityValues(target).some((id) => selectedIds.has(id)))
    .map((target) => [targetIdentityValues(target)[0], target])).values()];
  if (!selectedTargets.length) return context;
  return {
    ...context,
    targets: selectedTargets,
    enemies: selectedTargets,
    battlefield: {
      ...(context.battlefield ?? {}),
      targets: selectedTargets,
      enemies: selectedTargets,
    },
  };
}
