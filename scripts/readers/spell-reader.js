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
  return collectionValues(actor?.itemTypes?.spell).map((item) => {
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    const curated = findCuratedSpell(slug);
    const inferred = curated ? null : classifySpell(item);
    const tactic = curated ?? inferred;
    const parsedTime = readSpellActionCost(item);
    const actionCost = curated?.actionCost ?? parsedTime.actionCost;
    const spellAvailability = readSpellAvailability(actor, item);
    const available = parsedTime.combat && actionCost !== Infinity && spellAvailability.available;
    const source = curated ? "spell-curated" : (inferred ? "spell-inferred" : "spell-unknown");

    return {
      ...(tactic ?? {}),
      id: `spell-${item.id ?? slug}`,
      name: curated?.name ?? item.name,
      slug,
      actionCost,
      actualActionCost: parsedTime.actionCost,
      actionGlyph: item.actionGlyph ?? null,
      source,
      confidence: tactic?.confidence ?? "low",
      executable: tactic?.executable ?? "open-item",
      detected: true,
      available,
      unavailableReason: spellAvailability.reason,
      item,
      curated,
      role: tactic?.role ?? "unknown",
      activityProfile: tactic?.activityProfile ?? null,
      targetingProfile: tactic?.targetingProfile ?? null,
      saveProfile: tactic?.saveProfile ?? null,
      damageProfile: tactic?.damageProfile ?? null,
      setupFor: tactic?.setupFor ?? [],
      reasons: tactic?.reasons ?? [],
      rank: item.rank ?? item.system?.level?.value ?? null,
      location: systemValue(item.system?.location),
      time: systemValue(item.system?.time) ?? "2",
    };
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

  const parsedText = parseActionText(text);
  if (parsedText !== null) return { actionCost: parsedText, combat: true };

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return { actionCost: numeric, combat: true };
  }

  return { actionCost: 2, combat: true };
}

function readSpellAvailability(actor, item) {
  if (!item) return { available: false, reason: "Missing spell." };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: "Spell is disabled." };
  }
  if (isCantrip(item)) return { available: true, reason: "" };

  const entry = findSpellcastingEntry(actor, item);
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

function findSpellcastingEntry(actor, spell) {
  const location = systemValue(spell.system?.location);
  const entries = collectionValues(actor?.itemTypes?.spellcastingEntry);
  if (!location) return null;
  return entries.find((entry) => entry?.id === location || entry?._id === location || entry?.uuid === location) ?? null;
}

function isCantrip(spell) {
  const traits = spell.system?.traits?.value ?? [];
  const rank = spellRank(spell);
  return traits.includes("cantrip") || rank === 0;
}

function spellRank(spell) {
  const rank = Number(spell.rank ?? spell.system?.level?.value ?? spell.system?.rank?.value);
  return Number.isFinite(rank) ? rank : null;
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
