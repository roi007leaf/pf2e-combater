import { findCuratedSpell } from "../catalog/spells/index.js";
import { slugify } from "../engine/action/text.js";
import { classifySpell } from "../engine/spell/classifier.js";
import { readSpellActionCost } from "../readers/spell-reader.js";

const SPELL_COMBAT_USE_BUCKETS = [
  "auto",
  "browse-only",
  "context-only",
  "never-auto-fill",
  "review",
];

function itemSlug(item) {
  return slugify(item?.system?.slug ?? item?.slug ?? item?.name);
}

function traitList(item) {
  const traits = item?.system?.traits;
  const value = traits?.value ?? traits;
  if (Array.isArray(value)) return value.map((trait) => String(trait).toLowerCase());
  if (value instanceof Set) return Array.from(value).map((trait) => String(trait).toLowerCase());
  return [];
}

function descriptionText(item) {
  const raw = item?.system?.description?.value ?? item?.system?.description ?? "";
  return String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function mergeTactic(curated, inferred) {
  if (!curated) return inferred;
  return {
    ...(inferred ?? {}),
    ...curated,
    role: curated.role ?? inferred?.role,
    confidence: curated.confidence ?? inferred?.confidence,
    activityProfile: {
      ...(inferred?.activityProfile ?? {}),
      ...(curated.activityProfile ?? {}),
      ...(curated.combatUse ? { combatUse: curated.combatUse } : {}),
    },
  };
}

function defaultCombatUse(tactic) {
  const combatUse = String(tactic?.combatUse ?? tactic?.activityProfile?.combatUse ?? "").toLowerCase();
  if (combatUse) return combatUse;
  const role = String(tactic?.role ?? "").toLowerCase();
  const utilitySubtype = String(tactic?.activityProfile?.utilitySubtype ?? "").toLowerCase();
  const confidence = String(tactic?.confidence ?? "").toLowerCase();
  if (!role || role === "unknown") return "review";
  if (role === "exploration-utility" || utilitySubtype === "exploration-utility") return "browse-only";
  if (["utility", "combat-utility"].includes(role) && confidence === "low") return "context-only";
  return "auto";
}

function bucketName(combatUse) {
  if (combatUse === "browse-only") return "browseOnly";
  if (combatUse === "context-only") return "contextOnly";
  if (combatUse === "never-auto-fill") return "neverAutoFill";
  return combatUse;
}

function auditEntry(item) {
  const slug = itemSlug(item);
  const inferred = classifySpell(item);
  const curated = findCuratedSpell(slug);
  const tactic = mergeTactic(curated, inferred);
  const combatUse = defaultCombatUse(tactic);
  return {
    name: item?.name ?? "(unnamed)",
    slug,
    rank: Number(item?.system?.level?.value ?? item?.system?.level ?? 0),
    traits: traitList(item),
    source: curated ? "spell-curated" : (tactic ? "spell-inferred" : "spell-unknown"),
    role: tactic?.role ?? null,
    combatUse,
    confidence: tactic?.confidence ?? null,
    curated: Boolean(curated),
    desc: descriptionText(item).slice(0, 220),
  };
}

export function classifySpellForCatalogAudit(item) {
  if (item?.type !== "spell") return null;
  const cost = readSpellActionCost(item);
  if (!cost.combat) {
    return {
      name: item?.name ?? "(unnamed)",
      slug: itemSlug(item),
      skipped: "non-combat-cast-time",
    };
  }
  return auditEntry(item);
}

export function spellCatalogAuditForItems(items) {
  const spells = items.filter((item) => item?.type === "spell");
  const entries = spells.map(classifySpellForCatalogAudit);
  const active = entries.filter((entry) => entry && !entry.skipped);
  const skipped = entries.filter((entry) => entry?.skipped);
  const buckets = {
    auto: [],
    browseOnly: [],
    contextOnly: [],
    neverAutoFill: [],
    review: [],
    unknown: [],
    lowConfidence: [],
    utilityFallback: [],
    curatedOverrides: [],
  };
  const byCombatUse = Object.fromEntries(SPELL_COMBAT_USE_BUCKETS.map((key) => [key, 0]));

  for (const entry of active) {
    const combatUse = SPELL_COMBAT_USE_BUCKETS.includes(entry.combatUse) ? entry.combatUse : "review";
    byCombatUse[combatUse] += 1;
    buckets[bucketName(combatUse)].push(entry);
    if (!entry.role) buckets.unknown.push(entry);
    if (entry.confidence === "low") buckets.lowConfidence.push(entry);
    if (["utility", "exploration-utility"].includes(entry.role)) buckets.utilityFallback.push(entry);
    if (entry.curated) buckets.curatedOverrides.push(entry);
  }

  return {
    total: spells.length,
    activeCount: active.length,
    skippedCount: skipped.length,
    byCombatUse,
    buckets,
    entries: active,
    skipped,
  };
}

function row(entry) {
  return `- ${entry.name} (\`${entry.slug}\`, rank ${entry.rank}) -> \`${entry.role ?? "unknown"}\`, ${entry.confidence ?? "unknown"} confidence`;
}

function section(title, entries) {
  const rows = entries.map(row);
  return `## ${title}\n\n${rows.length ? rows.join("\n") : "_none_"}\n`;
}

export function spellCatalogAuditMarkdown(report, { sourceLabel = "provided spell items" } = {}) {
  return `# PF2e Combater - Spell Catalog Audit

Generated from ${sourceLabel}.

## Summary

- Spell items: **${report.total}**
- Combat-castable spells: **${report.activeCount}**
- Non-combat cast-time skipped: **${report.skippedCount}**
- Auto-fill eligible: **${report.byCombatUse.auto}**
- Browse-only: **${report.byCombatUse["browse-only"]}**
- Context-only: **${report.byCombatUse["context-only"]}**
- Never auto-fill: **${report.byCombatUse["never-auto-fill"]}**
- Needs review: **${report.byCombatUse.review}**

${section("Auto-fill Eligible", report.buckets.auto)}

${section("Browse-only Utility", report.buckets.browseOnly)}

${section("Context-only", report.buckets.contextOnly)}

${section("Needs Review", report.buckets.review)}

${section("Low Confidence", report.buckets.lowConfidence)}

${section("Utility Fallbacks", report.buckets.utilityFallback)}

${section("Curated Overrides", report.buckets.curatedOverrides)}
`;
}
