// Local coverage runner. Reads PF2e system LevelDB packs directly and classifies
// every feat / action / class-feature / spell, writing a gap report to disk.
//
//   node scripts/dev/run-coverage.mjs
//
// Requires the dev dependency `classic-level` and a local PF2e system install.
import { ClassicLevel } from "classic-level";
import { writeFileSync, readFileSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { coverageForItems } from "./coverage.js";

const UNKNOWNS_OUT = resolve(process.cwd(), "docs/coverage-unknowns.json");

const SYSTEM_ROOT = resolve(
  process.cwd(),
  "../../systems/pf2e",
);
const SYSTEM_MANIFEST = JSON.parse(readFileSync(join(SYSTEM_ROOT, "system.json"), "utf8"));
const PACKS = (SYSTEM_MANIFEST.packs ?? [])
  .filter((pack) => pack.type === "Item")
  .map((pack) => ({
    name: pack.name ?? pack.path?.split("/").at(-1) ?? pack.label,
    label: pack.label,
    path: resolve(SYSTEM_ROOT, pack.path),
  }));
const OUT = resolve(process.cwd(), "docs/coverage-report.md");

// Foundry holds an exclusive LevelDB lock while running, so read disposable
// copies instead of the live packs.
const SCRATCH = join(tmpdir(), "pf2e-combater-coverage");
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

async function readPack(pack) {
  const copy = join(SCRATCH, pack.name);
  cpSync(pack.path, copy, {
    recursive: true,
    filter: (src) => !src.endsWith("\\LOCK") && !src.endsWith("/LOCK"),
  });
  const db = new ClassicLevel(copy, {
    keyEncoding: "utf8",
    valueEncoding: "json",
  });
  await db.open();
  const items = [];
  for await (const value of db.values()) {
    if (value && typeof value === "object" && value.type && value.type !== "Folder") items.push(value);
  }
  await db.close();
  return items;
}

function section(title, rows) {
  if (!rows.length) return `### ${title}\n\n_none_\n`;
  return `### ${title}\n\n${rows.join("\n")}\n`;
}

const allItems = [];
const perPack = {};
for (const name of PACKS) {
  try {
    const items = await readPack(name);
    perPack[name.name] = items.length;
    allItems.push(...items);
    process.stdout.write(`read ${name.name}: ${items.length} items\n`);
  } catch (error) {
    process.stdout.write(`SKIP ${name.name}: ${error.message}\n`);
  }
}

const report = coverageForItems(allItems);

const roleRows = Object.entries(report.byRole)
  .sort((a, b) => b[1] - a[1])
  .map(([role, count]) => `- \`${role}\`: ${count}`);

const classRows = Object.entries(report.unknownByClass)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([cls, names]) => `- **${cls}** (${names.length}): ${names.slice(0, 40).join(", ")}${names.length > 40 ? " ..." : ""}`);

const buffRows = report.likelyBuffGaps.slice(0, 200).map((name) => `- ${name}`);
const lowConfidenceRows = report.lowConfidence
  .slice(0, 200)
  .map((entry) => `- ${entry.name} [${entry.classTrait}] -> \`${entry.role}\``);
const utilityFallbackRows = report.utilityFallbacks
  .slice(0, 200)
  .map((entry) => `- ${entry.name} [${entry.classTrait}] -> \`${entry.role}\``);
const likelyMisclassifiedBuffRows = report.likelyMisclassifiedBuffs
  .slice(0, 200)
  .map((entry) => `- ${entry.name} [${entry.classTrait}] -> \`${entry.role}\``);

// Group unknown by their most distinctive trait so we can spot whole families to fix.
const traitBuckets = {};
for (const entry of report.unknown) {
  for (const trait of entry.traits) {
    (traitBuckets[trait] ??= new Set()).add(entry.name);
  }
}
const traitRows = Object.entries(traitBuckets)
  .map(([trait, names]) => [trait, names.size])
  .filter(([, count]) => count >= 3)
  .sort((a, b) => b[1] - a[1])
  .map(([trait, count]) => `- \`${trait}\`: ${count}`);

const md = `# PF2e Combater - Classifier Coverage Report

Generated from all local PF2e system Item packs (${PACKS.length} packs).

Packs read: ${Object.entries(perPack).map(([k, v]) => `${k}=${v}`).join(", ")}

## Summary

- Total items: **${report.total}**
- Active (combat-usable) actions: **${report.activeCount}**
- Classified: **${report.classifiedCount}** (${report.coveragePct}%)
- Unknown (active but unclassified): **${report.unknownCount}**

## Quality audit buckets

- Low-confidence classified: **${report.quality.lowConfidenceCount}**
- Utility/generic fallback classified: **${report.quality.utilityFallbackCount}**
- Likely buff/support but classified elsewhere: **${report.quality.likelyMisclassifiedBuffCount}**

## Classified by role

${roleRows.join("\n")}

## Unknown - trait families (count >= 3, biggest fix leverage)

${traitRows.join("\n")}

${section("Unknown - likely buff/support (need a buff role)", buffRows)}

${section("Quality - low confidence classified", lowConfidenceRows)}

${section("Quality - utility/generic fallbacks", utilityFallbackRows)}

${section("Quality - likely buff/support misclassified", likelyMisclassifiedBuffRows)}

${section("Unknown - grouped by class", classRows)}
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
writeFileSync(
  UNKNOWNS_OUT,
  JSON.stringify(
    report.unknown.map((entry) => ({
      name: entry.name,
      classTrait: entry.classTrait,
      traits: entry.traits,
      save: entry.save,
      hasDamage: entry.hasDamage,
      area: entry.area,
      range: entry.range,
      desc: entry.desc,
    })),
    null,
    2,
  ),
);
process.stdout.write(`\nWrote ${OUT}\n`);
process.stdout.write(`Wrote ${UNKNOWNS_OUT} (${report.unknown.length} entries)\n`);
process.stdout.write(`Coverage: ${report.classifiedCount}/${report.activeCount} (${report.coveragePct}%), ${report.unknownCount} unknown\n`);
