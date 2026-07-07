import { currentTargetSelection } from "../../engine/action/executor.js";
import { contextTargets } from "../../engine/target-pool.js";

function targetIdentityValues(target) {
  return [
    target?.id,
    target?.uuid,
    target?.token?.id,
    target?.token?.uuid,
  ].filter(Boolean).map(String);
}

export function contextWithCurrentAutoFillTargets(context) {
  const selectedIds = new Set(currentTargetSelection().targetTokenIds.map(String));
  if (!selectedIds.size) return context;
  const selectedTargets = contextTargets(context)
    .filter((target) => targetIdentityValues(target).some((id) => selectedIds.has(id)));
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
