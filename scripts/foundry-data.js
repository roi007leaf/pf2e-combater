export function collectionValues(collection, { compact = false } = {}) {
  let values = [];
  if (!collection) {
    values = [];
  } else if (Array.isArray(collection)) {
    values = collection;
  } else if (Array.isArray(collection.contents)) {
    values = collection.contents;
  } else if (Array.isArray(collection.placeables)) {
    values = collection.placeables;
  } else if (collection instanceof Map) {
    values = Array.from(collection.values());
  } else if (typeof collection.values === "function") {
    values = Array.from(collection.values());
  } else if (typeof collection[Symbol.iterator] === "function") {
    values = Array.from(collection);
  } else if (typeof collection === "object") {
    values = Object.values(collection);
  }
  return compact ? values.filter(Boolean) : values;
}

export function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

export function entityKey(entity) {
  const key = entity?.id
    ?? entity?.uuid
    ?? entity?.token?.id
    ?? entity?.token?.uuid
    ?? entity?.name
    ?? null;
  return key === null || key === "" ? null : String(key);
}

export function traitSlugs(document) {
  const traits = document?.system?.traits;
  const value = systemValue(traits);
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function documentId(document) {
  return document?.id ?? document?._id ?? null;
}

export function actorItems(actor, type = null) {
  if (type) {
    const typed = collectionValues(actor?.itemTypes?.[type]);
    const typedIds = new Set(typed.map(documentId).filter(Boolean));
    const fallback = collectionValues(actor?.items)
      .filter((item) => item?.type === type)
      .filter((item) => !typedIds.has(documentId(item)));
    return [...typed, ...fallback];
  }

  const typed = Object.values(actor?.itemTypes ?? {}).flatMap((collection) => collectionValues(collection));
  const typedIds = new Set(typed.map(documentId).filter(Boolean));
  const fallback = collectionValues(actor?.items)
    .filter((item) => !typedIds.has(documentId(item)));
  return [...typed, ...fallback];
}
