import { findCuratedSpell } from "../catalog/spells/index.js";
import { heightenedSpellForRank, spellBaseRank, spellNameForRank } from "../engine/spell/heightening.js";
import { classifySpell } from "../engine/spell/classifier.js";
import { parseActionText, slugify } from "../engine/action/text.js";
import { contextActorDocument } from "../engine/actor-context.js";
import { hasEnemyWithinRange } from "../engine/target-pool.js";
import { bestReadyStrikeAverageDamage } from "./action/reader.js";
import { collectionValues, systemValue } from "../foundry-data.js";
import { t } from "../i18n.js";

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readSpellActions(context) {
  const actor = contextActorDocument(context);
  return collectionValues(actor?.itemTypes?.spell).flatMap((item) => {
    const slug = slugify(item.slug ?? item.system?.slug ?? item.name);
    const curated = findCuratedSpell(slug);
    const entry = findSpellcastingEntry(actor, item);
    const rank = spellRank(item);
    const preparedType = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase() || null;
    const variantGroup = `spell-${item.id ?? item._id ?? slug}`;
    const castRanks = readSpellCastRanks(item, entry);

    return castRanks.flatMap((castRank) => {
      const effectiveItem = heightenedSpellForRank(item, castRank);
      const inferred = classifySpell(effectiveItem);
      const curatedForRank = curatedSpellForCastRank(curated, castRank);
      const tactic = mergeSpellTactic(curatedForRank, inferred);
      if (!curated && tactic?.role === "weapon-strike") {
        const averageDamage = bestReadyStrikeAverageDamage(actor, context);
        if (averageDamage !== null) {
          tactic.activityProfile = { ...tactic.activityProfile, averageDamage };
        }
      }
      const maxRange = Number(tactic?.targetingProfile?.maxRange ?? tactic?.targetingProfile?.range);
      const enemyInRange = tactic?.targetingProfile?.enemy !== true || hasEnemyWithinRange(context, maxRange);
      const source = curated ? "spell-curated" : (inferred ? "spell-inferred" : "spell-unknown");
      const parsedTime = readSpellActionCost(effectiveItem);
      const actionCosts = curatedForRank?.actionCost !== undefined
        ? [curatedForRank.actionCost]
        : (parsedTime.actionCosts ?? [parsedTime.actionCost]);
      const spellAvailability = readSpellAvailability(actor, item, entry, castRank);
      const rankSuffix = Number.isFinite(castRank) && castRank !== rank ? `-r${castRank}` : "";
      const actionIdBase = `${variantGroup}${rankSuffix}`;

      return actionCosts.map((actionCost) => ({
        ...(tactic ?? {}),
        id: actionCosts.length > 1 ? `${actionIdBase}-${actionCost}a` : actionIdBase,
        name: spellNameForRank(curatedForRank?.name ?? item.name, rank, castRank),
        slug,
        actionCost,
        actualActionCost: parsedTime.actionCost,
        actionCostOptions: actionCosts,
        actionGlyph: effectiveItem.actionGlyph ?? item.actionGlyph ?? null,
        source,
        confidence: tactic?.confidence ?? "low",
        executable: tactic?.executable ?? "open-item",
        detected: true,
        available: parsedTime.combat && actionCost !== Infinity && spellAvailability.available && enemyInRange,
        // A spell that's itself unavailable (no active entry, no slots, etc.) should say so, even
        // when there's also no target in range -- that reason is more fundamental than range.
        unavailableReason: !spellAvailability.available
          ? spellAvailability.reason
          : (enemyInRange ? "" : t("Avail.NoTargetWithin", "No target within {range} feet.", { range: maxRange })),
        item,
        effectiveItem,
        curated: curatedForRank ?? curated,
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
        castRank,
        heightened: Number.isFinite(castRank) && Number.isFinite(rank) && castRank > rank,
        isCantrip: isCantrip(item),
        isFocusSpell: isFocusSpell(item, entry),
        spellDc: readSpellDc(actor, item, entry),
        spellcastingEntryId: entry?.id ?? entry?._id ?? null,
        spellcastingEntryUuid: entry?.uuid ?? null,
        spellcastingEntryType: preparedType,
        spellcastingEntryLabel: readSpellcastingEntryLabel(entry),
        spellcastingEntryTradition: readSpellcastingEntryTradition(entry),
        spellResource: readSpellResource(actor, item, entry, castRank),
        location: systemValue(item.system?.location),
        time: systemValue(effectiveItem.system?.time) ?? "2",
      }));
    });
  });
}

// Wands, scrolls, and spell gems embed a single stored spell (system.spell) rather than living in
// a spellcasting entry's slots. Foundry's own ConsumablePF2e#embeddedSpell getter builds a real
// spell document from that data; casting it goes through actor.spellcasting (whichever entry's
// tradition/rank can cast it), never a slot on that entry. readSpellActions can't see these because
// it only walks actor.itemTypes.spell.
const CONSUMABLE_SPELL_CATEGORIES = new Set(["scroll", "wand", "spell-gem"]);

function consumableSpellItems(actor) {
  return collectionValues(actor?.itemTypes?.consumable).filter((item) =>
    CONSUMABLE_SPELL_CATEGORIES.has(String(systemValue(item?.system?.category) ?? "").toLowerCase())
    && Boolean(item?.system?.spell),
  );
}

function consumableEmbeddedSpell(item) {
  try {
    return item?.embeddedSpell ?? null;
  } catch (_error) {
    return null;
  }
}

function consumableUses(item) {
  const uses = item?.uses ?? item?.system?.uses;
  return { value: numericCount(uses?.value) ?? 0, max: numericCount(uses?.max) };
}

// Mirrors the system's own Spellcasting#canCastConsumable, but keeps the winning entry (highest DC)
// instead of just a boolean, so the candidate can report a real spellcasting entry's DC/tradition.
function bestConsumableCastingEntry(actor, spell, item) {
  let best = null;
  for (const entry of collectionValues(actor?.spellcasting)) {
    if (!entry?.statistic || typeof entry.canCast !== "function") continue;
    if (!entry.canCast(spell, { origin: item })) continue;
    const dc = Number(entry.statistic?.dc?.value);
    const bestDc = Number(best?.statistic?.dc?.value ?? -Infinity);
    if (!best || (Number.isFinite(dc) && dc > bestDc)) best = entry;
  }
  return best;
}

function readConsumableSpellAvailability(item, entry) {
  const quantity = numericCount(item?.system?.quantity);
  if (quantity !== null && quantity <= 0) {
    return { available: false, reason: t("Avail.ConsumableZero", "Consumable quantity is 0.") };
  }
  const uses = consumableUses(item);
  if (uses.max !== null && uses.value <= 0) {
    return { available: false, reason: t("Avail.NoUses", "No uses remaining.") };
  }
  if (!entry) {
    return { available: false, reason: t("Avail.NoMatchingSpellcasting", "No spellcasting entry can cast this item's spell.") };
  }
  return { available: true, reason: "" };
}

// Wand/scroll/spell-gem actions execute via the physical item's own .consume(), which internally
// picks the same best-DC entry and casts through it -- so spellcastingEntryId/Uuid stay null here
// (a non-null id would route execution through entry.cast() instead, skipping the item's own
// charge/quantity decrement).
export function readConsumableSpellActions(context) {
  const actor = contextActorDocument(context);
  return consumableSpellItems(actor).flatMap((item) => {
    const embeddedSpell = consumableEmbeddedSpell(item);
    if (!embeddedSpell) return [];

    const slug = slugify(embeddedSpell.slug ?? embeddedSpell.system?.slug ?? embeddedSpell.name);
    const curated = findCuratedSpell(slug);
    const rank = spellRank(embeddedSpell);
    const inferred = classifySpell(embeddedSpell);
    const curatedForRank = curatedSpellForCastRank(curated, rank);
    const tactic = mergeSpellTactic(curatedForRank, inferred);
    if (!curated && tactic?.role === "weapon-strike") {
      const averageDamage = bestReadyStrikeAverageDamage(actor, context);
      if (averageDamage !== null) tactic.activityProfile = { ...tactic.activityProfile, averageDamage };
    }
    const maxRange = Number(tactic?.targetingProfile?.maxRange ?? tactic?.targetingProfile?.range);
    const enemyInRange = tactic?.targetingProfile?.enemy !== true || hasEnemyWithinRange(context, maxRange);
    const source = curated ? "spell-curated" : (inferred ? "spell-inferred" : "spell-unknown");
    const parsedTime = readSpellActionCost(embeddedSpell);
    const actionCosts = curatedForRank?.actionCost !== undefined
      ? [curatedForRank.actionCost]
      : (parsedTime.actionCosts ?? [parsedTime.actionCost]);
    const bestEntry = bestConsumableCastingEntry(actor, embeddedSpell, item);
    const availability = readConsumableSpellAvailability(item, bestEntry);
    const variantGroup = `consumable-spell-${item.id ?? item._id ?? slug}`;

    return actionCosts.map((actionCost) => ({
      ...(tactic ?? {}),
      id: actionCosts.length > 1 ? `${variantGroup}-${actionCost}a` : variantGroup,
      name: curatedForRank?.name ?? embeddedSpell.name,
      slug,
      actionCost,
      actualActionCost: parsedTime.actionCost,
      actionCostOptions: actionCosts,
      actionGlyph: embeddedSpell.actionGlyph ?? null,
      source,
      confidence: tactic?.confidence ?? "low",
      executable: tactic?.executable ?? "open-item",
      detected: true,
      available: parsedTime.combat && actionCost !== Infinity && availability.available && enemyInRange,
      unavailableReason: !availability.available
        ? availability.reason
        : (enemyInRange ? "" : t("Avail.NoTargetWithin", "No target within {range} feet.", { range: maxRange })),
      item,
      effectiveItem: embeddedSpell,
      curated: curatedForRank ?? curated,
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
      heightened: false,
      isCantrip: isCantrip(embeddedSpell),
      isFocusSpell: false,
      spellDc: numericValue(bestEntry?.statistic?.dc?.value),
      spellcastingEntryId: null,
      spellcastingEntryUuid: null,
      spellcastingEntryType: null,
      spellcastingEntryLabel: bestEntry ? readSpellcastingEntryLabel(bestEntry) : "",
      spellcastingEntryTradition: bestEntry ? readSpellcastingEntryTradition(bestEntry) : "",
      spellResource: { type: "item", label: countLabel(t("SpellRes.Uses", "Uses"), consumableUses(item).value, consumableUses(item).max), tooltip: "" },
      location: null,
      time: systemValue(embeddedSpell.system?.time) ?? "2",
      consumableItem: item,
    }));
  });
}

function compactSaveProfile(tactic) {
  const stat = String(tactic?.save ?? tactic?.saveProfile?.stat ?? "").toLowerCase();
  if (!["fortitude", "reflex", "will"].includes(stat)) return null;
  return {
    ...(tactic?.saveProfile ?? {}),
    stat,
    basic: tactic?.saveProfile?.basic ?? null,
  };
}

function compactTargetingProfile(tactic) {
  const model = String(tactic?.targetModel ?? "").toLowerCase();
  if (!model) return null;
  if (model === "self") return { self: true };
  if (model === "single-ally") return { ally: true, self: true };
  if (model === "single-enemy") return { enemy: true };
  if (model === "two-enemies") return { enemy: true, maxTargets: 2 };
  if (model === "area") return { area: true, enemy: true };
  return null;
}

function compactDamageProfile(tactic) {
  const types = Array.isArray(tactic?.damageTypes)
    ? tactic.damageTypes.map((type) => String(type).toLowerCase()).filter(Boolean)
    : [];
  if (!types.length) return null;
  return {
    type: types[0],
    types,
  };
}

function compactActivityProfile(tactic) {
  const profile = {};
  if (Array.isArray(tactic?.damageTypes) && tactic.damageTypes.length) {
    profile.damageTypes = tactic.damageTypes.map((type) => String(type).toLowerCase()).filter(Boolean);
  }
  if (tactic?.attack === true) profile.spellAttack = true;
  if (tactic?.variableActionCost === true) profile.damageScalesWithActions = true;
  return Object.keys(profile).length ? profile : null;
}

function mergeObjects(...objects) {
  const merged = Object.assign({}, ...objects.filter((object) => object && typeof object === "object"));
  return Object.keys(merged).length ? merged : null;
}

function mergeArrays(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).filter(Boolean))];
}

function rankOverrideFor(curated, castRank) {
  const rank = Number(castRank);
  const overrides = curated?.rankOverrides;
  if (!overrides || !Number.isFinite(rank)) return null;
  return overrides[rank] ?? overrides[String(rank)] ?? null;
}

function curatedSpellForCastRank(curated, castRank) {
  const override = rankOverrideFor(curated, castRank);
  if (!override || typeof override !== "object") return curated;
  const base = { ...curated };
  delete base.rankOverrides;
  return {
    ...base,
    ...override,
    activityProfile: mergeObjects(base.activityProfile, override.activityProfile),
    targetingProfile: mergeObjects(base.targetingProfile, override.targetingProfile),
    saveProfile: mergeObjects(base.saveProfile, override.saveProfile),
    damageProfile: mergeObjects(base.damageProfile, override.damageProfile),
    setupFor: mergeArrays(base.setupFor, override.setupFor),
    reasons: mergeArrays(override.reasons, base.reasons),
  };
}

function preferredSpellRole(curated, inferred) {
  const curatedRole = curated?.role;
  const inferredRole = inferred?.role;
  if (!curatedRole) return inferredRole;
  if (!inferredRole) return curatedRole;
  if (curatedRole === "damage" && ["save-damage", "area-damage"].includes(inferredRole)) return inferredRole;
  if (curatedRole === "control" && inferredRole === "sustain-control") return inferredRole;
  return curatedRole;
}

function mergeSpellTactic(curated, inferred) {
  if (!curated) return inferred;
  if (!inferred) {
    return {
      ...curated,
      saveProfile: compactSaveProfile(curated),
      targetingProfile: compactTargetingProfile(curated),
      damageProfile: compactDamageProfile(curated),
      activityProfile: compactActivityProfile(curated),
    };
  }

  const role = preferredSpellRole(curated, inferred);
  return {
    ...inferred,
    ...curated,
    role,
    activityProfile: mergeObjects(inferred.activityProfile, compactActivityProfile(curated), curated.activityProfile),
    targetingProfile: mergeObjects(compactTargetingProfile(curated), inferred.targetingProfile, curated.targetingProfile),
    saveProfile: mergeObjects(compactSaveProfile(curated), inferred.saveProfile, curated.saveProfile),
    damageProfile: mergeObjects(compactDamageProfile(curated), inferred.damageProfile, curated.damageProfile),
    setupFor: mergeArrays(inferred.setupFor, curated.setupFor),
    reasons: mergeArrays(curated.reasons, inferred.reasons),
    confidence: curated.confidence ?? inferred.confidence,
    executable: curated.executable ?? inferred.executable,
  };
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

function readSpellAvailability(actor, item, entry = findSpellcastingEntry(actor, item), castRank = spellRank(item)) {
  if (!item) return { available: false, reason: t("Avail.MissingSpell", "Missing spell.") };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: t("Avail.SpellDisabled", "Spell is disabled.") };
  }

  const hasExplicitLocation = Boolean(spellLocation(item));
  if (hasExplicitLocation && !spellcastingEntryActive(entry)) {
    return { available: false, reason: t("Avail.SpellNoActiveEntry", "Spell is not assigned to an active spellcasting entry.") };
  }

  if (!entry) {
    return isCantrip(item)
      ? { available: true, reason: "" }
      : { available: false, reason: t("Avail.NoSpellcastingEntry", "No spellcasting entry found.") };
  }
  if (!spellcastingEntryActive(entry)) {
    return { available: false, reason: t("Avail.EntryNotActive", "Spellcasting entry is not active.") };
  }

  const preparedType = String(systemValue(entry.system?.prepared) ?? "").toLowerCase();
  if (preparedType === "focus") {
    return focusAvailable(actor);
  }

  if (preparedType === "prepared") {
    return preparedSpellAvailable(entry, item, isCantrip(item) ? null : castRank);
  }

  if (isCantrip(item)) return { available: true, reason: "" };

  if (preparedType === "innate") {
    return innateSpellAvailable(item);
  }

  if (preparedType === "items") {
    return itemSpellAvailable(entry, item);
  }

  if (preparedType === "spontaneous") {
    return slotAvailable(entry, castRank);
  }

  return { available: false, reason: t("Avail.UnknownPrepType", "Unknown spellcasting preparation type.") };
}

function spellcastingEntryActive(entry) {
  if (!entry) return false;
  return entry.visible !== false
    && entry.system?.visible !== false
    && entry.hidden !== true
    && entry.system?.hidden !== true
    && entry.disabled !== true
    && entry.system?.disabled !== true
    && entry.system?.enabled !== false;
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
    preparedSpell?.slug,
    preparedSpell?.system?.slug,
    preparedSpell?.spell?.id,
    preparedSpell?.spell?._id,
    preparedSpell?.spell?.uuid,
    preparedSpell?.spell?.sourceId,
    preparedSpell?.spell?.slug,
    preparedSpell?.spell?.system?.slug,
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
    return null;
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
  return spellBaseRank(spell);
}

function entrySlotRanks(entry) {
  return Object.keys(entry?.system?.slots ?? {})
    .map(slotRankNumber)
    .filter((rank) => Number.isFinite(rank))
    .toSorted((left, right) => left - right);
}

function preparedCastRanks(entry, spell, rank) {
  const ranks = entryPreparedSlotMatches(entry, spell)
    .map((match) => match.rank)
    .filter((matchRank) => Number.isFinite(matchRank));
  return ranks.length ? [...new Set(ranks)].toSorted((left, right) => left - right) : [rank];
}

function preparedSpellSignature(entry, spell) {
  const spellIds = new Set(spellIdentityValues(spell));
  return entryPreparedSpells(entry).some((preparedSpell) =>
    preparedSpell?.signature === true
    && preparedSpellIdentityValues(preparedSpell).some((id) => spellIds.has(id)),
  );
}

function spellLocationSignature(spell) {
  const location = spell?.system?.location;
  return location?.signature === true || systemValue(location?.signature) === true;
}

function spontaneousCastRanks(entry, spell, rank) {
  if (!spellLocationSignature(spell) && !preparedSpellSignature(entry, spell)) return [rank];

  const ranks = entrySlotRanks(entry).filter((slotRank) => {
    if (slotRank < rank) return false;
    const slot = slotForRank(entry, slotRank);
    return (slotMaximum(slot) ?? slotRemaining(slot) ?? 0) > 0;
  });
  return ranks.length ? [...new Set(ranks)].toSorted((left, right) => left - right) : [rank];
}

function readSpellCastRanks(spell, entry) {
  const rank = spellRank(spell);
  if (!Number.isFinite(rank) || isCantrip(spell)) return [rank];

  const preparedType = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase();
  if (preparedType === "focus" || isFocusSpell(spell, entry)) return [rank];
  if (preparedType === "prepared") return preparedCastRanks(entry, spell, rank);
  if (preparedType === "spontaneous") return spontaneousCastRanks(entry, spell, rank);
  return [rank];
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(systemValue(value));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function numericCount(...values) {
  for (const value of values) {
    const number = Number(systemValue(value));
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function readSpellcastingEntryTradition(entry) {
  return String(systemValue(
    entry?.system?.tradition
    ?? entry?.tradition
    ?? entry?.statistic?.tradition,
  ) ?? "").toLowerCase();
}

function readSpellcastingEntryLabel(entry) {
  if (!entry) return "";
  const name = String(entry.name ?? entry.label ?? "").trim();
  if (name) return name;
  const parts = [
    readSpellcastingEntryTradition(entry),
    systemValue(entry?.system?.prepared),
  ].map(titleCase).filter(Boolean);
  return [...new Set(parts)].join(" ");
}

function slotForRank(entry, rank) {
  if (!Number.isFinite(rank)) return null;
  return entry?.system?.slots?.[`slot${rank}`] ?? null;
}

function slotRemaining(slot) {
  return numericCount(slot?.value, slot?.remaining);
}

function slotMaximum(slot) {
  return numericCount(slot?.max, slot?.maximum, slot?.maxSlots);
}

function usesData(spell) {
  const uses = spell?.system?.location?.uses;
  if (!uses || typeof uses !== "object") {
    const value = numericCount(uses);
    return value === null ? null : { value, max: null };
  }
  const value = numericCount(uses?.value, uses?.remaining);
  const max = numericCount(uses?.max, uses?.maximum);
  return value === null && max === null ? null : { value: value ?? 0, max };
}

function countLabel(prefix, value, max = null) {
  return max !== null ? `${prefix} ${value}/${max}` : `${prefix} ${value}`;
}

function slotRankNumber(slotKey) {
  const rank = Number(String(slotKey).replace(/^slot/, ""));
  return Number.isFinite(rank) ? rank : null;
}

// Find every slot this spell is currently prepared in. A prepared copy does not always sit in the
// spell's base-rank slot: Divine Font auto-heightens Heal/Harm into the entry's highest-rank slot,
// so a base-rank-1 Heal lives only in slot2/slot3. Reading just the base-rank slot reported
// "Prepared 0/0" for those copies. Returns the matching prepared entries per slot, by rank.
function entryPreparedSlotMatches(entry, spell) {
  const slots = entry?.system?.slots ?? {};
  const spellIds = new Set(spellIdentityValues(spell));
  const matches = [];
  for (const [slotKey, slot] of Object.entries(slots)) {
    const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
    if (!prepared.length) continue;
    const matching = prepared.filter((preparedSpell) =>
      preparedSpellIdentityValues(preparedSpell).some((id) => spellIds.has(id)),
    );
    if (!matching.length) continue;
    matches.push({ rank: slotRankNumber(slotKey), prepared, matching });
  }
  return matches;
}

function readPreparedSpellResource(entry, spell, rank, castRank = rank) {
  const allMatches = entryPreparedSlotMatches(entry, spell);
  const rankMatches = Number.isFinite(castRank)
    ? allMatches.filter((slot) => slot.rank === castRank)
    : allMatches;
  const matches = rankMatches.length ? rankMatches : allMatches;
  // No prepared copy anywhere: keep reporting the base-rank slot so the chip still reads 0/0.
  const reportFallbackRank = Number.isFinite(castRank) ? castRank : rank;
  const slots = matches.length
    ? matches
    : [{ rank: reportFallbackRank, prepared: slotForRank(entry, reportFallbackRank)?.prepared ?? [], matching: [] }];

  const availableMatching = slots.reduce(
    (count, slot) => count + slot.matching.filter((preparedSpell) => preparedSpell?.expended !== true).length, 0,
  );
  const totalMatching = slots.reduce((count, slot) => count + slot.matching.length, 0);
  // Report the highest rank the spell is prepared at (Divine Font heightens to the top slot).
  const reportRank = slots.reduce(
    (best, slot) => (slot.rank !== null && (best === null || slot.rank > best) ? slot.rank : best), null,
  ) ?? rank;
  const rankSlot = slots.find((slot) => slot.rank === reportRank) ?? slots[slots.length - 1];
  const availableRank = rankSlot.prepared.filter((preparedSpell) => preparedSpell?.expended !== true).length;

  return {
    type: "prepared",
    rank: reportRank,
    label: t("SpellRes.Prepared", "Prepared {available}/{total}", { available: availableMatching, total: totalMatching }),
    tooltip: Number.isFinite(reportRank)
      ? t("SpellRes.PreparedTooltipRank", "Rank {rank} prepared slots: {available}/{total} unexpended.", { rank: reportRank, available: availableRank, total: rankSlot.prepared.length })
      : t("SpellRes.PreparedTooltip", "{available}/{total} prepared copies unexpended.", { available: availableMatching, total: totalMatching }),
    preparedAvailable: availableMatching,
    preparedTotal: totalMatching,
    rankAvailable: availableRank,
    rankTotal: rankSlot.prepared.length,
  };
}

function readSlotSpellResource(entry, rank) {
  const slot = slotForRank(entry, rank);
  const remaining = slotRemaining(slot) ?? 0;
  const max = slotMaximum(slot);
  return {
    type: "spontaneous",
    rank,
    label: countLabel(t("SpellRes.Slots", "Slots"), remaining, max),
    tooltip: Number.isFinite(rank)
      ? t("SpellRes.SlotsTooltipRank", "Rank {rank} spell slots: {count} left.", { rank, count: max !== null ? `${remaining}/${max}` : remaining })
      : t("SpellRes.SlotsTooltip", "{count} spell slots left.", { count: max !== null ? `${remaining}/${max}` : remaining }),
    remaining,
    max,
  };
}

function readFocusSpellResource(actor) {
  const focus = actor?.system?.resources?.focus;
  const value = numericCount(focus?.value) ?? 0;
  const max = numericCount(focus?.max) ?? numericCount(focus?.maximum);
  return {
    type: "focus",
    label: countLabel(t("SpellRes.Focus", "Focus"), value, max),
    tooltip: t("SpellRes.FocusTooltip", "{count} focus points left.", { count: max !== null ? `${value}/${max}` : value }),
    remaining: value,
    max,
  };
}

function readUseSpellResource(spell, type) {
  const uses = usesData(spell);
  if (!uses) return { type, label: titleCase(type), tooltip: "" };
  return {
    type,
    label: countLabel(t("SpellRes.Uses", "Uses"), uses.value, uses.max),
    tooltip: t("SpellRes.UsesTooltip", "{count} uses left.", { count: uses.max !== null ? `${uses.value}/${uses.max}` : uses.value }),
    remaining: uses.value,
    max: uses.max,
  };
}

function readSpellResource(actor, spell, entry, castRank = spellRank(spell)) {
  const rank = spellRank(spell);
  const preparedType = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase();
  if (isCantrip(spell)) {
    return { type: "cantrip", rank, label: t("SpellRes.NoSlot", "No slot"), tooltip: t("SpellRes.CantripTooltip", "Cantrip does not spend a spell slot.") };
  }
  if (preparedType === "focus" || isFocusSpell(spell, entry)) return readFocusSpellResource(actor);
  if (preparedType === "prepared") return readPreparedSpellResource(entry, spell, rank, castRank);
  if (preparedType === "spontaneous") return readSlotSpellResource(entry, castRank);
  if (preparedType === "innate") return readUseSpellResource(spell, "innate");
  if (preparedType === "items") return readUseSpellResource(spell, "item");
  return Number.isFinite(castRank) ? readSlotSpellResource(entry, castRank) : null;
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

function preparedSpellAvailable(entry, spell, castRank = spellRank(spell)) {
  const matches = entryPreparedSlotMatches(entry, spell)
    .filter((slot) => !Number.isFinite(castRank) || slot.rank === castRank);

  for (const slot of matches) {
    if (slot.matching.some((preparedSpell) => preparedSpell?.expended !== true)) {
      return { available: true, reason: "" };
    }
  }

  return { available: false, reason: t("Avail.PreparedExpended", "Prepared spell is not available or is expended.") };
}

function slotAvailable(entry, rank) {
  if (!Number.isFinite(rank)) return { available: false, reason: t("Avail.SpellRankUnavailable", "Spell rank unavailable.") };
  const slot = entry.system?.slots?.[`slot${rank}`];
  const remaining = Number(systemValue(slot?.value ?? slot?.remaining));
  if (Number.isFinite(remaining) && remaining > 0) return { available: true, reason: "" };

  const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
  if (prepared.some((preparedSpell) => preparedSpell?.expended === false)) {
    return { available: true, reason: "" };
  }

  return { available: false, reason: t("Avail.NoSpellSlots", "No spell slots remaining.") };
}

function spellLocationUses(spell) {
  const uses = Number(systemValue(spell.system?.location?.uses));
  if (Number.isFinite(uses)) return uses;
  return Number(systemValue(spell.system?.location?.uses?.value));
}

function innateSpellAvailable(spell) {
  const uses = spellLocationUses(spell);
  if (Number.isFinite(uses)) {
    return uses > 0
      ? { available: true, reason: "" }
      : { available: false, reason: t("Avail.InnateNoUses", "Innate spell has no uses remaining.") };
  }

  return { available: true, reason: "" };
}

function itemSpellAvailable(entry, spell) {
  const uses = spellLocationUses(spell);
  if (Number.isFinite(uses)) {
    return uses > 0
      ? { available: true, reason: "" }
      : { available: false, reason: t("Avail.ItemSpellNoUses", "Item spell has no uses remaining.") };
  }

  return slotAvailable(entry, spellRank(spell));
}

function focusAvailable(actor) {
  const focus = actor?.system?.resources?.focus;
  const value = Number(systemValue(focus?.value));
  if (Number.isFinite(value) && value > 0) return { available: true, reason: "" };
  return { available: false, reason: t("Avail.NoFocusPoints", "No focus points remaining.") };
}
