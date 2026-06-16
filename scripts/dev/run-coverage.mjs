// Local coverage runner. Reads PF2e system LevelDB packs directly and classifies
// every feat / action / class-feature / spell, writing a gap report to disk.
//
//   node scripts/dev/run-coverage.mjs
//
// Requires the dev dependency `classic-level` and a local PF2e system install.
import { ClassicLevel } from "classic-level";
import { writeFileSync, cpSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { coverageForItems } from "./coverage.js";

const UNKNOWNS_OUT = resolve(process.cwd(), "docs/coverage-unknowns.json");

const SYSTEM_PACKS = resolve(
  process.cwd(),
  "../../systems/pf2e/packs",
);
const PACKS = ["actions", "feats", "class-features", "ancestry-features", "spells"];
const OUT = resolve(process.cwd(), "docs/coverage-report.md");

// Foundry holds an exclusive LevelDB lock while running, so read disposable
// copies instead of the live packs.
const SCRATCH = join(tmpdir(), "pf2e-combater-coverage");
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

async function readPack(name) {
  const copy = join(SCRATCH, name);
  cpSync(`${SYSTEM_PACKS}/${name}`, copy, { recursive: true });
  const db = new ClassicLevel(copy, {
    keyEncoding: "utf8",
    valueEncoding: "json",
  });
  await db.open();
  const items = [];
  for await (const value of db.values()) {
    if (value && typeof value === "object" && value.type) items.push(value);
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
    perPack[name] = items.length;
    allItems.push(...items);
    process.stdout.write(`read ${name}: ${items.length} items\n`);
  } catch (error) {
    process.stdout.write(`SKIP ${name}: ${error.message}\n`);
  }
}

const report = coverageForItems(allItems);

const roleRows = Object.entries(report.byRole)
  .sort((a, b) => b[1] - a[1])
  .map(([role, count]) => `- \`${role}\`: ${count}`);

const classRows = Object.entries(report.unknownByClass)
  .sort((a, b) => b[1].length - a[1].length)
  .map(([cls, names]) => `- **${cls}** (${names.length}): ${names.slice(0, 40).join(", ")}${names.length > 40 ? " …" : ""}`);

const buffRows = report.likelyBuffGaps.slice(0, 200).map((name) => `- ${name}`);

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

const md = `# PF2e Combater — Classifier Coverage Report

Generated from local PF2e system packs: ${PACKS.map((p) => `\`${p}\``).join(", ")}.

Packs read: ${Object.entries(perPack).map(([k, v]) => `${k}=${v}`).join(", ")}

## Summary

- Total items: **${report.total}**
- Active (combat-usable) actions: **${report.activeCount}**
- Classified: **${report.classifiedCount}** (${report.coveragePct}%)
- Unknown (active but unclassified): **${report.unknownCount}**

## Classified by role

${roleRows.join("\n")}

## Unknown — trait families (count ≥ 3, biggest fix leverage)

${traitRows.join("\n")}

${section("Unknown — likely buff/support (need a buff role)", buffRows)}

${section("Unknown — grouped by class", classRows)}
`;

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
