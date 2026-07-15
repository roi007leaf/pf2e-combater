const RENEWABLE_PERIODS = new Set(['round', 'turn', 'pt6s']);
const ENCOUNTER_PERIODS = new Set(['encounter', 'pt10m', '10 minutes', '10-minute']);

function primitiveValue(value) {
  if (value && typeof value === 'object' && 'value' in value) return primitiveValue(value.value);
  return value;
}

function numericValue(...values) {
  for (const value of values) {
    const primitive = primitiveValue(value);
    if (primitive === null || primitive === undefined || primitive === '') continue;
    const numeric = Number(primitive);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function normalizedPeriod(value) {
  return String(primitiveValue(value) ?? '')
    .trim()
    .toLowerCase();
}

function stableIdentity(...values) {
  for (const value of values) {
    const normalized = String(primitiveValue(value) ?? '').trim();
    if (normalized) return normalized;
  }
  return 'unknown';
}

function actionIdentity(action) {
  return stableIdentity(
    action?.variantGroup,
    action?.item?.uuid,
    action?.item?.id,
    action?.item?._id,
    action?.id,
    action?.slug,
    action?.name,
  );
}

function itemIdentity(action, item = action?.consumableItem ?? action?.item) {
  return stableIdentity(
    item?.uuid,
    item?.id,
    item?._id,
    action?.itemUuid,
    action?.itemId,
    actionIdentity(action),
  );
}

function spellcastingEntryIdentity(action) {
  return stableIdentity(
    action?.spellcastingEntryUuid,
    action?.spellcastingEntryId,
    action?.spellcastingEntryLabel,
    action?.location,
  );
}

function spellResourceCounts(resource) {
  if (!resource) return { remaining: null, max: null };
  if (String(resource.type ?? '').toLowerCase() === 'prepared') {
    return {
      remaining: numericValue(resource.preparedAvailable, resource.rankAvailable),
      max: numericValue(resource.preparedTotal, resource.rankTotal),
    };
  }
  return {
    remaining: numericValue(resource.remaining, resource.value, resource.current),
    max: numericValue(resource.max, resource.maximum),
  };
}

function itemResourceCounts(item, { includeQuantity = true } = {}) {
  const quantity = includeQuantity ? numericValue(item?.system?.quantity) : null;
  const uses = item?.uses ?? item?.system?.uses;
  const usesRemaining = numericValue(uses?.value, uses?.current, uses?.remaining);
  const usesMax = numericValue(uses?.max, uses?.maximum);

  if (usesRemaining !== null && usesMax !== null && usesMax > 0) {
    const stack = quantity !== null ? Math.max(0, Math.floor(quantity)) : 1;
    return {
      remaining: stack > 0 ? (stack - 1) * usesMax + usesRemaining : 0,
      max: stack * usesMax,
    };
  }
  if (quantity !== null) return { remaining: quantity, max: Math.max(1, quantity) };
  return { remaining: usesRemaining, max: usesMax };
}

function frequencyPeriodFromDescription(action) {
  if (action?.gatingProfile?.frequency !== true) return '';
  const description =
    primitiveValue(action?.item?.system?.description) ?? action?.item?.description ?? '';
  const text = String(description)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const match = text.match(/\bonce per (turn|round|encounter|10 minutes?|day)\b/i);
  return normalizedPeriod(match?.[1]);
}

function frequencyResource(action, item) {
  const frequency = item?.system?.frequency;
  const period = normalizedPeriod(frequency?.per) || frequencyPeriodFromDescription(action);
  if (!frequency && !period) return null;
  if (RENEWABLE_PERIODS.has(period)) return null;

  return {
    kind: ENCOUNTER_PERIODS.has(period) ? 'encounter' : 'limited',
    poolKey: `frequency:${itemIdentity(action, item)}`,
    remaining: numericValue(frequency?.value, frequency?.current, frequency?.remaining),
    max: numericValue(frequency?.max, frequency?.maximum),
  };
}

function spellResource(action) {
  const resource = action?.spellResource;
  const type = String(resource?.type ?? '').toLowerCase();
  const counts = spellResourceCounts(resource);
  const rank = numericValue(resource?.rank, action?.castRank, action?.rank) ?? 0;
  const spellLike =
    Boolean(resource) ||
    String(action?.source ?? '').startsWith('spell') ||
    action?.item?.type === 'spell';

  if (
    type === 'cantrip' ||
    action?.isCantrip === true ||
    action?.activityProfile?.cantrip === true
  ) {
    return { kind: 'renewable', poolKey: null, remaining: null, max: null };
  }
  if (
    type === 'focus' ||
    action?.isFocusSpell === true ||
    action?.activityProfile?.focus === true
  ) {
    return { kind: 'focus', poolKey: 'focus', ...counts };
  }
  if (type === 'prepared') {
    return {
      kind: 'slot',
      poolKey: `prepared:${spellcastingEntryIdentity(action)}:${actionIdentity(action)}:${rank}`,
      rank,
      ...counts,
    };
  }
  if (type === 'spontaneous' || type === 'flexible') {
    return {
      kind: 'slot',
      poolKey: `spell-slot:${spellcastingEntryIdentity(action)}:${rank}`,
      rank,
      ...counts,
    };
  }
  if (type === 'item') {
    const item = action?.consumableItem ?? action?.item;
    const physicalCounts = item ? itemResourceCounts(item) : counts;
    return {
      kind: 'consumable',
      poolKey: `item:${itemIdentity(action, item)}`,
      ...(physicalCounts.remaining !== null ? physicalCounts : counts),
    };
  }
  if (type === 'innate') {
    return {
      kind: 'innate',
      poolKey: `innate:${actionIdentity(action)}:${rank}`,
      rank,
      ...counts,
    };
  }
  if (spellLike && rank > 0) {
    return {
      kind: 'slot',
      poolKey: `spell-slot:${spellcastingEntryIdentity(action)}:${rank}`,
      rank,
      ...counts,
    };
  }
  return null;
}

export function readActionResource(action) {
  const resolved = action?.action ?? action;
  const spell = spellResource(resolved);
  if (spell) return spell;

  const item = resolved?.consumableItem ?? resolved?.item;
  if (!item) return null;
  if (item.type === 'consumable' || resolved?.type === 'consumable') {
    return {
      kind: 'consumable',
      poolKey: `item:${itemIdentity(resolved, item)}`,
      ...itemResourceCounts(item),
    };
  }

  const frequency = frequencyResource(resolved, item);
  if (frequency) return frequency;

  const counts = itemResourceCounts(item, { includeQuantity: false });
  if (counts.remaining !== null && counts.max !== null && counts.max > 0) {
    return {
      kind: 'limited',
      poolKey: `uses:${itemIdentity(resolved, item)}`,
      ...counts,
    };
  }
  return null;
}
