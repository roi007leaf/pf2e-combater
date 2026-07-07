const BACKING_STRIKE_FILTERS = {
  unarmed: (strike) => strike?.traits?.includes?.("unarmed") === true,
  "ranged-reload-zero": (strike) => strike?.item?.system?.range != null && strike.reload === 0,
};

export function backingStrikeFilterByPreset(preset) {
  return BACKING_STRIKE_FILTERS[preset];
}

function strikeOptions(values) {
  return (Array.isArray(values) ? values : [])
    .filter((strike) => strike?.source === "strike" || strike?.slug === "strike");
}

function heldItem(item) {
  const carryType = String(item?.carryType ?? item?.system?.equipped?.carryType ?? "").toLowerCase();
  const handsHeld = Number(item?.handsHeld ?? item?.system?.equipped?.handsHeld);
  return item?.isHeld === true || carryType === "held" || (Number.isFinite(handsHeld) && handsHeld > 0);
}

export function bestReadyStrikeFromOptions(values, filter = null) {
  const strikes = strikeOptions(values)
    .filter((strike) => (typeof filter === "function" ? filter(strike) : true));
  if (!strikes.length) return null;
  return strikes.toSorted((left, right) => (Number(right.averageDamage) || 0) - (Number(left.averageDamage) || 0))[0];
}

export function heldMeleeBackingStrikesFromOptions(values) {
  return strikeOptions(values)
    .filter((strike) => strike?.item?.system?.range == null)
    .filter((strike) => heldItem(strike?.item))
    .slice(0, 2);
}

export function bestReadyStrikeAverageDamageFromOptions(values) {
  const averages = strikeOptions(values)
    .map((strike) => Number(strike.averageDamage))
    .filter((value) => Number.isFinite(value) && value > 0);
  return averages.length ? Math.max(...averages) : null;
}

export function backingStrikeForAction(action, strikeValues) {
  if (!action?.activityProfile?.requiresDistinctTargets && !action?.activityProfile?.requiresBackingStrike) return null;
  const filter = backingStrikeFilterByPreset(action.activityProfile?.backingStrikeFilter);
  return bestReadyStrikeFromOptions(strikeValues, filter);
}

export function backingStrikesForAction(action, strikeValues) {
  return action?.activityProfile?.requiresDualBackingStrike
    ? heldMeleeBackingStrikesFromOptions(strikeValues)
    : null;
}
