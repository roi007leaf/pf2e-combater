import { classifySystemAction } from "../engine/action-classifier.js";
import { classifySpell } from "../engine/spell-classifier.js";
import { readActionCost, slugify } from "../readers/action-reader.js";
import { readSpellActionCost } from "../readers/spell-reader.js";
import { findCustomAction } from "../catalog/custom-actions.js";
import { findCuratedSpell } from "../catalog/spells/index.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";

const ACTION_TYPES = new Set(["action", "feat", "feature", "consumable"]);
const GENERIC_SLUGS = new Set(GENERIC_ACTIONS.map((action) => action.slug));

function itemSlug(item) {
  return slugify(item?.system?.slug ?? item?.slug ?? item?.name);
}

const CLASS_TRAITS = new Set([
  "alchemist", "barbarian", "bard", "champion", "cleric", "druid", "fighter",
  "gunslinger", "inventor", "investigator", "kineticist", "magus", "monk",
  "oracle", "psychic", "ranger", "rogue", "sorcerer", "summoner", "swashbuckler",
  "thaumaturge", "witch", "wizard", "exemplar", "animist", "guardian", "runesmith",
]);

const OFFENSIVE_TRAITS = new Set(["attack", "spellshape", "metamagic"]);

function traitList(item) {
  const traits = item?.system?.traits;
  const value = traits?.value ?? traits;
  if (Array.isArray(value)) return value.map((trait) => String(trait).toLowerCase());
  if (value instanceof Set) return Array.from(value).map((trait) => String(trait).toLowerCase());
  return [];
}

function classTraitOf(traits) {
  return traits.find((trait) => CLASS_TRAITS.has(trait)) ?? "(none)";
}

function descriptionText(item) {
  const raw = item?.system?.description?.value ?? item?.system?.description ?? "";
  return String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// A buff/support spell or ability has no save, no damage, no area, no attack —
// it just helps the actor or an ally. These are the biggest current gap.
function looksLikeBuff(item, traits) {
  const system = item?.system ?? {};
  const hasOffense = OFFENSIVE_TRAITS.has([...traits].find((t) => OFFENSIVE_TRAITS.has(t)))
    || system.defense?.save?.statistic
    || system.save?.value
    || (system.damage && Object.keys(system.damage).length > 0)
    || system.area;
  if (hasOffense) return false;
  return /\bgain(?:s)?\b|\bbonus\b|\btemporary hit points\b|\bbless|heroism|haste|shield\b|\benhance|\bgrant/i
    .test(descriptionText(item) + " " + (item?.name ?? ""));
}

function structuralHints(item) {
  const system = item?.system ?? {};
  return {
    save: system.defense?.save?.statistic ?? system.save?.value ?? null,
    hasDamage: Boolean(system.damage && Object.keys(system.damage).length > 0),
    area: system.area ?? null,
    range: system.range?.value ?? system.range ?? null,
    desc: descriptionText(item).slice(0, 220),
  };
}

export function classifyItemForCoverage(item) {
  const type = item?.type;
  const traits = traitList(item);
  const base = {
    name: item?.name ?? "(unnamed)",
    type,
    classTrait: classTraitOf(traits),
    traits,
    ...structuralHints(item),
  };

  const slug = itemSlug(item);

  if (type === "spell") {
    const cost = readSpellActionCost(item);
    if (!cost.combat) return { ...base, skipped: "non-combat-cast-time" };
    const curated = findCuratedSpell(slug);
    const tactic = curated ?? classifySpell(item);
    return {
      ...base,
      source: curated ? "spell-curated" : (tactic ? "spell-inferred" : "spell-unknown"),
      role: tactic?.role ?? null,
      classified: Boolean(tactic),
      likelyBuff: !tactic && looksLikeBuff(item, traits),
    };
  }

  if (!ACTION_TYPES.has(type)) return { ...base, skipped: "not-an-action" };

  const cost = readActionCost(item);
  if (cost.passive || cost.actionCost === null || cost.actionCost === undefined) {
    return { ...base, skipped: "passive-or-no-cost" };
  }

  // The real readers cover an item if it is in the generic catalog, the curated
  // catalog, or the structural classifier — mirror all three here.
  if (GENERIC_SLUGS.has(slug)) {
    return { ...base, source: "generic", role: "generic", classified: true };
  }
  const curated = findCustomAction(slug);
  const tactic = curated ?? classifySystemAction(item, cost);
  return {
    ...base,
    source: curated ? "custom-curated" : (tactic ? "system-inferred" : "unknown"),
    role: tactic?.role ?? null,
    classified: Boolean(tactic),
    likelyBuff: !tactic && looksLikeBuff(item, traits),
  };
}

export function coverageForItems(items) {
  const results = items.map(classifyItemForCoverage);
  const active = results.filter((entry) => !entry.skipped);
  const classified = active.filter((entry) => entry.classified);
  const unknown = active.filter((entry) => !entry.classified);

  const byRole = {};
  for (const entry of classified) {
    byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
  }

  const unknownByClass = {};
  for (const entry of unknown) {
    (unknownByClass[entry.classTrait] ??= []).push(entry.name);
  }

  return {
    total: results.length,
    activeCount: active.length,
    classifiedCount: classified.length,
    unknownCount: unknown.length,
    coveragePct: active.length ? Math.round((classified.length / active.length) * 100) : 0,
    byRole,
    unknownByClass,
    likelyBuffGaps: unknown.filter((entry) => entry.likelyBuff).map((entry) => entry.name),
    unknown,
    results,
  };
}

// ---- Foundry-only collectors (no-ops / throw outside Foundry) ----

function actorItems(actor) {
  const collection = actor?.items;
  if (!collection) return [];
  return typeof collection.values === "function" ? Array.from(collection.values()) : Array.from(collection);
}

export function runActorCoverage(actor) {
  const report = coverageForItems(actorItems(actor));
  logReport(`Actor: ${actor?.name ?? "?"}`, report);
  return report;
}

export async function runCompendiumCoverage({ limit = Infinity } = {}) {
  const packs = Array.from(globalThis.game?.packs ?? []).filter((pack) => pack.documentName === "Item");
  const items = [];
  for (const pack of packs) {
    if (items.length >= limit) break;
    const docs = await pack.getDocuments();
    for (const doc of docs) {
      if (doc.type === "spell" || ACTION_TYPES.has(doc.type)) items.push(doc);
    }
  }
  const report = coverageForItems(items);
  logReport(`Compendium sweep (${items.length} items from ${packs.length} packs)`, report);
  return report;
}

function logReport(label, report) {
  const log = globalThis.console;
  log.log(`=== PF2e Combater coverage — ${label} ===`);
  log.log(`Active actions: ${report.activeCount} | classified: ${report.classifiedCount} (${report.coveragePct}%) | unknown: ${report.unknownCount}`);
  log.table?.(report.byRole);
  log.log("Unknown by class trait:");
  log.table?.(
    Object.fromEntries(Object.entries(report.unknownByClass).map(([cls, names]) => [cls, names.length])),
  );
  log.log("Likely buff/support gaps:", report.likelyBuffGaps);
  log.log("Full unknown list:", report.unknown.map((entry) => `${entry.name} [${entry.classTrait}] {${entry.traits.join(",")}}`));
}
