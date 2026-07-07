export function contextTargets(context) {
  return context?.targets ?? context?.battlefield?.targets ?? [];
}

export function firstContextTarget(context) {
  return contextTargets(context)[0] ?? null;
}

export function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? contextTargets(context);
}

export function contextAllies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function targetConditionSlugs(entity) {
  const conditions = entity?.conditions;
  if (!conditions) return [];
  if (Array.isArray(conditions)) {
    return conditions.map((condition) => condition?.slug ?? condition).filter(Boolean);
  }
  return Array.isArray(conditions.slugs) ? conditions.slugs : [];
}

function targetConditionActive(entity, slug) {
  const conditions = entity?.conditions;
  if (!conditions) return false;
  if (targetConditionSlugs(entity).includes(slug)) return true;
  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0;
}

export function detectionState(entity) {
  return String(entity?.visionerDetectionState ?? entity?.detectionState ?? entity?.visibility ?? "").toLowerCase();
}

export function canAttackTarget(entity) {
  if (entity?.attackTargetable === false) return false;
  const state = detectionState(entity);
  if (state === "undetected" || state === "unnoticed") return false;
  return !targetConditionActive(entity, "undetected") && !targetConditionActive(entity, "unnoticed");
}

export function targetReference(entity, fallbackType = "target", fallbackName = "Unknown target") {
  if (!entity) return null;
  return {
    type: fallbackType,
    id: entity.id ?? entity.actor?.id ?? null,
    uuid: entity.uuid ?? entity.actor?.uuid ?? null,
    name: entity.name ?? entity.actor?.name ?? fallbackName,
  };
}

export function selfTargetReference(context, fallbackName = "Self") {
  const actor = context?.actor ?? context?.combatant?.actor ?? null;
  const token = context?.token ?? null;
  if (!actor && !token) return { type: "self", name: fallbackName };
  return {
    type: "self",
    id: token?.id ?? actor?.id ?? actor?.document?.id ?? null,
    uuid: token?.uuid ?? actor?.uuid ?? actor?.document?.uuid ?? null,
    name: token?.name ?? actor?.name ?? actor?.document?.name ?? fallbackName,
  };
}

export function hasEnemyWithinRange(context, maxRange) {
  if (!Number.isFinite(maxRange)) return true;
  const pool = [...contextTargets(context), ...contextEnemies(context)];
  return pool.some((target) => (target?.distance ?? Infinity) <= maxRange);
}
