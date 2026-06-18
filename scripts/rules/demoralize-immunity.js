const IMMUNITY_TERMS = [
  "immunity",
  "immune",
  "cooldown",
  "temporarily-immune",
  "temporary-immunity",
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function effectValues(entity) {
  const values = [
    ...(Array.isArray(entity?.effects) ? entity.effects : []),
    ...(Array.isArray(entity?.effectSlugs) ? entity.effectSlugs : []),
    ...(Array.isArray(entity?.conditions) ? entity.conditions : []),
    ...(Array.isArray(entity?.conditions?.slugs) ? entity.conditions.slugs : []),
  ];
  return values.filter(Boolean);
}

function effectTokens(effect) {
  if (typeof effect === "string") return [normalize(effect)];
  return [
    effect?.slug,
    effect?.name,
    effect?.label,
    effect?.id,
    effect?.uuid,
    effect?.sourceId,
    effect?.system?.slug?.value,
    effect?.system?.slug,
  ].map(normalize).filter(Boolean);
}

function isDemoralizeImmunityEffect(effect) {
  const tokens = effectTokens(effect);
  return tokens.some((token) =>
    token.includes("demoralize")
      && IMMUNITY_TERMS.some((term) => token.includes(term)),
  );
}

export function hasDemoralizeImmunity(entity) {
  return effectValues(entity).some(isDemoralizeImmunityEffect);
}
