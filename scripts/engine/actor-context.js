export function isActorDocument(value) {
  return Boolean(value && typeof value === "object" && (value.system || value.items || value.itemTypes));
}

export function contextActorDocument(context, { allowActorFallback = false } = {}) {
  const candidates = [
    context?.actor?.document,
    context?.combatant?.actor,
    context?.actor?.object,
    context?.actor,
  ];
  for (const candidate of candidates) {
    if (isActorDocument(candidate)) return candidate;
  }
  return allowActorFallback ? candidates.find(Boolean) ?? null : null;
}
