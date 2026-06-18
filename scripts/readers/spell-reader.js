import { findCuratedSpell } from "../catalog/spells/index.js";
import { classifySpell } from "../engine/spell-classifier.js";
import { parseActionText, slugify } from "./action-reader.js";

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return Object.values(collection);
}

function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function isActorDocument(value) {
  return Boolean(value && typeof value === "object" && (value.system || value.items || value.itemTypes));
}

function contextActor(context) {
  if (isActorDocument(context?.actor?.document)) return context.actor.document;
  if (isActorDocument(context?.combatant?.actor)) return context.combatant.actor;
  if (isActorDocument(context?.actor?.object)) return context.actor.object;
  if (isActorDocument(context?.actor)) return context.actor;
  return null;
}

export function readSpellActions(context) {
  const actor = contextActor(context);
  return collectionValues(actor?.itemTypes?.spell).flatMap((item) => {
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    const curated = findCuratedSpell(slug);
    const inferred = curated ? null : classifySpell(item);
    const tactic = curated ?? inferred;
    const parsedTime = readSpellActionCost(item);
    const actionCosts = curated?.actionCost !== undefined
      ? [curated.actionCost]
      : (parsedTime.actionCosts ?? [parsedTime.actionCost]);
    const entry = findSpellcastingEntry(actor, item);
    const spellAvailability = readSpellAvailability(actor, item, entry);
    const source = curated ? "spell-curated" : (inferred ? "spell-inferred" : "spell-unknown");
    const rank = spellRank(item);
    const variantGroup = `spell-${item.id ?? item._id ?? slug}`;

    return actionCosts.map((actionCost) => ({
      ...(tactic ?? {}),
      id: actionCosts.length > 1 ? `${variantGroup}-${actionCost}a` : variantGroup,
      name: curated?.name ?? item.name,
      slug,
      actionCost,
      actualActionCost: parsedTime.actionCost,
      actionCostOptions: actionCosts,
      actionGlyph: item.actionGlyph ?? null,
      source,
      confidence: tactic?.confidence ?? "low",
      executable: tactic?.executable ?? "open-item",
      detected: true,
      available: parsedTime.combat && actionCost !== Infinity && spellAvailability.available,
      unavailableReason: spellAvailability.reason,
      item,
      curated,
      variantGroup,
      variableActionCost: actionCosts.length > 1,
      role: tactic?.role ?? "unknown",
      activityProfile: tactic?.activityProfile ?? null,
      targetingProfile: tactic?.targetingProfile ?? null,
      saveProfile: tactic?.saveProfile ?? null,
      damageProfile: tactic?.damageProfile ?? null,
      setupFor: tactic?.setupFor ?? [],
      reasons: tactic?.reasons ?? [],
      rank,
      castRank: rank,
      isCantrip: isCantrip(item),
      isFocusSpell: isFocusSpell(item, entry),
      spellDc: readSpellDc(actor, item, entry),
      spellcastingEntryId: entry?.id ?? entry?._id ?? null,
      spellcastingEntryUuid: entry?.uuid ?? null,
      spellcastingEntryType: String(systemValue(entry?.system?.prepared) ?? "").toLowerCase() || null,
      location: systemValue(item.system?.location),
      time: systemValue(item.system?.time) ?? "2",
    }));
  });
}

export function readSpellActionCost(item) {
  const value = systemValue(item?.system?.time) ?? "2";
  const text = String(value).trim().toLowerCase();

  if (/\b(minute|minutes|hour|hours|day|days)\b/.test(text)) {
    return { actionCost: Infinity, combat: false };
  }
  if (text.includes("reaction")) return { actionCost: "reaction", combat: true };
  if (text.includes("free")) return { actionCost: 0, combat: true };

  const ranged = parseActionRange(text);
  if (ranged.length) return { actionCost: ranged[0], actionCosts: ranged, combat: true };

  const parsedText = parseActionText(text);
  if (parsedText !== null) return { actionCost: parsedText, combat: true };

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return { actionCost: numeric, combat: true };
  }

  return { actionCost: 2, combat: true };
}

const ACTION_WORD_NUMBERS = { one: 1, two: 2, three: 3 };

function actionNumber(value) {
  const normalized = String(value ?? "").toLowerCase();
  return ACTION_WORD_NUMBERS[normalized] ?? Number(normalized);
}

function parseActionRange(text) {
  const match = String(text ?? "").match(/\b([123]|one|two|three)\s*(?:to|-)\s*([123]|one|two|three)\b/);
  if (!match) return [];
  const start = actionNumber(match[1]);
  const end = actionNumber(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const min = Math.max(0, Math.min(start, end));
  const max = Math.min(3, Math.max(start, end));
  const values = [];
  for (let cost = min; cost <= max; cost += 1) values.push(cost);
  return values;
}

function readSpellAvailability(actor, item, entry = findSpellcastingEntry(actor, item)) {
  if (!item) return { available: false, reason: "Missing spell." };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: "Spell is disabled." };
  }
  if (isCantrip(item)) return { available: true, reason: "" };

  if (!entry) return { available: false, reason: "No spellcasting entry found." };

  const preparedType = String(systemValue(entry.system?.prepared) ?? "").toLowerCase();
  if (preparedType === "focus") {
    return focusAvailable(actor);
  }

  if (preparedType === "prepared") {
    return preparedSpellAvailable(entry, item);
  }

  if (preparedType === "innate") {
    return innateSpellAvailable(item);
  }

  if (preparedType === "spontaneous") {
    return slotAvailable(entry, spellRank(item));
  }

  return { available: false, reason: "Unknown spellcasting preparation type." };
}

function spellLocation(spell) {
  const location = systemValue(spell?.system?.location);
  if (location && typeof location === "object") {
    return systemValue(location.value ?? location.id ?? location.uuid);
  }
  return location;
}

function spellIdentityValues(spell) {
  return [
    spell?.id,
    spell?._id,
    spell?.uuid,
    spell?.sourceId,
    spell?.system?.slug,
    spell?.slug,
  ]
    .filter(Boolean)
    .map((value) => String(value));
}

function entryIdentityValues(entry) {
  return [
    entry?.id,
    entry?._id,
    entry?.uuid,
    entry?.system?.slug,
    entry?.slug,
  ]
    .filter(Boolean)
    .map((value) => String(value));
}

function preparedSpellIdentityValues(preparedSpell) {
  return [
    preparedSpell?.id,
    preparedSpell?._id,
    preparedSpell?.spellId,
    preparedSpell?.itemId,
    preparedSpell?.uuid,
    preparedSpell?.sourceId,
  ]
    .filter(Boolean)
    .map((value) => String(value));
}

function entryPreparedSpells(entry) {
  const slots = entry?.system?.slots ?? {};
  return Object.values(slots).flatMap((slot) => Array.isArray(slot?.prepared) ? slot.prepared : []);
}

function entryContainsSpell(entry, spell) {
  const spellIds = new Set(spellIdentityValues(spell));
  if (!spellIds.size) return false;
  return entryPreparedSpells(entry)
    .some((preparedSpell) => preparedSpellIdentityValues(preparedSpell).some((id) => spellIds.has(id)));
}

function findSpellcastingEntry(actor, spell) {
  const location = spellLocation(spell);
  const entries = collectionValues(actor?.itemTypes?.spellcastingEntry);
  if (!entries.length) return null;

  if (location) {
    const locationText = String(location);
    const exact = entries.find((entry) => entryIdentityValues(entry).includes(locationText));
    if (exact) return exact;
  }

  const slotMatch = entries.find((entry) => entryContainsSpell(entry, spell));
  if (slotMatch) return slotMatch;

  return entries.length === 1 ? entries[0] : null;
}

function isCantrip(spell) {
  const traits = spell.system?.traits?.value ?? [];
  const rank = spellRank(spell);
  return traits.includes("cantrip") || rank === 0;
}

function isFocusSpell(spell, entry) {
  const traits = spell?.system?.traits?.value ?? [];
  const prepared = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase();
  return traits.includes("focus") || prepared === "focus";
}

function spellRank(spell) {
  const rank = Number(spell.rank ?? spell.system?.level?.value ?? spell.system?.rank?.value);
  return Number.isFinite(rank) ? rank : null;
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(systemValue(value));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function readSpellDc(actor, spell, entry) {
  return numericValue(
    spell?.spellcasting?.statistic?.dc?.value,
    spell?.spellcasting?.dc?.value,
    spell?.system?.spellcasting?.statistic?.dc?.value,
    spell?.system?.dc?.value,
    entry?.statistic?.dc?.value,
    entry?.statistic?.dc,
    entry?.system?.statistic?.dc?.value,
    entry?.system?.spelldc?.dc,
    entry?.system?.dc?.value,
    actor?.system?.attributes?.spellDC?.value,
    actor?.system?.spellcasting?.dc?.value,
  );
}

function preparedSpellAvailable(entry, spell) {
  const slots = entry.system?.slots ?? {};
  const spellId = spell.id ?? spell._id;

  for (const slot of Object.values(slots)) {
    const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
    const match = prepared.find((preparedSpell) => {
      const id = preparedSpell?.id ?? preparedSpell?.spellId ?? preparedSpell?._id;
      return id && id === spellId;
    });
    if (match && match.expended !== true) return { available: true, reason: "" };
  }

  return { available: false, reason: "Prepared spell is not available or is expended." };
}

function slotAvailable(entry, rank) {
  if (!Number.isFinite(rank)) return { available: false, reason: "Spell rank unavailable." };
  const slot = entry.system?.slots?.[`slot${rank}`];
  const remaining = Number(systemValue(slot?.value ?? slot?.remaining));
  if (Number.isFinite(remaining) && remaining > 0) return { available: true, reason: "" };

  const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
  if (prepared.some((preparedSpell) => preparedSpell?.expended === false)) {
    return { available: true, reason: "" };
  }

  return { available: false, reason: "No spell slots remaining." };
}

function innateSpellAvailable(spell) {
  const uses = Number(systemValue(spell.system?.location?.uses));
  if (Number.isFinite(uses)) {
    return uses > 0
      ? { available: true, reason: "" }
      : { available: false, reason: "Innate spell has no uses remaining." };
  }

  return { available: true, reason: "" };
}

function focusAvailable(actor) {
  const focus = actor?.system?.resources?.focus;
  const value = Number(systemValue(focus?.value));
  if (Number.isFinite(value) && value > 0) return { available: true, reason: "" };
  return { available: false, reason: "No focus points remaining." };
}
