const NON_PLANNABLE_ACTOR_TYPES = new Set(["hazard", "loot"]);

export function isPlannableActor(actor) {
  if (!actor) return false;
  const type = String(actor?.type ?? actor?.document?.type ?? "").toLowerCase();
  return !NON_PLANNABLE_ACTOR_TYPES.has(type);
}

export function combatantActor(combatant) {
  return combatant?.actor
    ?? combatant?.token?.actor
    ?? combatant?.token?.object?.actor
    ?? combatant?.tokenDocument?.actor
    ?? combatant?.document?.actor
    ?? null;
}

export function isPlannableCombatant(combatant) {
  return isPlannableActor(combatantActor(combatant));
}
