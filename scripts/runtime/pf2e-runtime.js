import { collectionValues } from "../foundry-data.js";

function slugToCamel(slug) {
  return String(slug ?? "")
    .toLowerCase()
    .replace(/-([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

function variantList(systemAction) {
  const variants = systemAction?.variants;
  if (!variants) return [];
  if (Array.isArray(variants)) return variants;
  if (Array.isArray(variants.contents)) return variants.contents;
  if (typeof variants[Symbol.iterator] === "function") return Array.from(variants);
  return [];
}

function variantKey(variant) {
  return variant?.slug ?? variant?.id ?? null;
}

function resolvedVariant(systemAction, requested) {
  const variants = variantList(systemAction);
  if (variants.length <= 1) return null;
  const requestedKey = String(requested ?? "").trim();
  const match = requestedKey
    ? variants.find((variant) => variantKey(variant) === requestedKey)
    : null;
  return variantKey(match ?? variants[0]);
}

export function createFoundryPf2eAdapter({ getGame = () => globalThis.game } = {}) {
  return Object.freeze({
    pf2e: () => getGame()?.pf2e ?? null,
    values: (collection) => collectionValues(collection, { compact: true }),
  });
}

export function createFixturePf2eAdapter({ pf2e = null, values = collectionValues } = {}) {
  return Object.freeze({
    pf2e: () => pf2e,
    values: (collection) => values(collection, { compact: true }),
  });
}

// Deep Module for PF2e version-sensitive shapes. Callers and tests use this Interface; only
// Adapters know where game.pf2e and Foundry collections live.
export function createPf2eRuntime(adapter) {
  if (!adapter || typeof adapter.pf2e !== "function" || typeof adapter.values !== "function") {
    throw new TypeError("PF2e runtime adapter is invalid");
  }

  function readActor(actor) {
    return {
      actions: adapter.values(actor?.system?.actions),
      spellcasting: adapter.values(actor?.spellcasting ?? actor?.itemTypes?.spellcastingEntry),
      tokenMarks: actor?.synthetics?.tokenMarks ?? null,
    };
  }

  function actionBySlug(slug) {
    const collection = adapter.pf2e()?.actions ?? null;
    if (!collection) return null;
    const fromGet = typeof collection.get === "function" ? collection.get(slug) : null;
    return fromGet ?? collection[slug] ?? collection[slugToCamel(slug)] ?? null;
  }

  async function useAction(slug, options = {}, { variant = null } = {}) {
    const systemAction = actionBySlug(slug);
    if (typeof systemAction?.use === "function") {
      const key = resolvedVariant(systemAction, variant);
      const result = await systemAction.use({ ...options, ...(key ? { variant: key } : {}) });
      return result ?? { executed: true };
    }
    if (typeof systemAction === "function") {
      const result = await systemAction(options);
      return result ?? { executed: true };
    }
    return null;
  }

  async function castSpell(entry, item, options = {}) {
    if (typeof entry?.cast !== "function") return null;
    return await entry.cast(item, options);
  }

  async function setSlotExpended(entry, rank, slotId, expended) {
    if (typeof entry?.setSlotExpendedState !== "function") return false;
    await entry.setSlotExpendedState(rank, slotId, expended);
    return true;
  }

  async function rollItem(item, event) {
    const rollItemMacro = adapter.pf2e()?.rollItemMacro;
    if (!item?.uuid || typeof rollItemMacro !== "function") return null;
    return await rollItemMacro(item.uuid, event);
  }

  return Object.freeze({ readActor, useAction, castSpell, setSlotExpended, rollItem });
}

export const pf2eRuntime = createPf2eRuntime(createFoundryPf2eAdapter());
