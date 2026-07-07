// Local spell catalogue runner. Reads PF2e system Item packs directly and writes
// Auto-fill/Browse combat-use audit files for every system spell.
//
//   node scripts/dev/run-spell-catalog-audit.mjs
//
// Requires the dev dependency `classic-level` and a local PF2e system install.
import { ClassicLevel } from "classic-level";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spellCatalogAuditForItems, spellCatalogAuditMarkdown } from "./spell-catalog-audit.js";

const SYSTEM_ROOT = resolve(process.cwd(), "../../systems/pf2e");
const SYSTEM_MANIFEST = JSON.parse(readFileSync(join(SYSTEM_ROOT, "system.json"), "utf8"));
const PACKS = (SYSTEM_MANIFEST.packs ?? [])
  .filter((pack) => pack.type === "Item")
  .map((pack) => ({
    name: pack.name ?? pack.path?.split("/").at(-1) ?? pack.label,
    label: pack.label,
    path: resolve(SYSTEM_ROOT, pack.path),
  }));
const OUT_MD = resolve(process.cwd(), "docs/spell-catalog-audit.md");
const OUT_JSON = resolve(process.cwd(), "docs/spell-catalog-audit.json");
const SCRATCH = join(tmpdir(), "pf2e-combater-spell-catalog-audit");

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
    if (value && typeof value === "object" && value.type === "spell") items.push(value);
  }
  await db.close();
  return items;
}

const allSpells = [];
const perPack = {};
for (const pack of PACKS) {
  try {
    const spells = await readPack(pack);
    if (!spells.length) continue;
    perPack[pack.name] = spells.length;
    allSpells.push(...spells);
    process.stdout.write(`read ${pack.name}: ${spells.length} spells\n`);
  } catch (error) {
    process.stdout.write(`SKIP ${pack.name}: ${error.message}\n`);
  }
}

const report = spellCatalogAuditForItems(allSpells);
const sourceLabel = `${report.total} local PF2e system spells (${Object.entries(perPack).map(([key, value]) => `${key}=${value}`).join(", ")})`;
mkdirSync(dirname(OUT_MD), { recursive: true });
writeFileSync(OUT_MD, spellCatalogAuditMarkdown(report, { sourceLabel }));
writeFileSync(
  OUT_JSON,
  JSON.stringify({
    summary: {
      total: report.total,
      activeCount: report.activeCount,
      skippedCount: report.skippedCount,
      byCombatUse: report.byCombatUse,
    },
    buckets: report.buckets,
  }, null, 2),
);
process.stdout.write(`\nWrote ${OUT_MD}\n`);
process.stdout.write(`Wrote ${OUT_JSON}\n`);
process.stdout.write(`Spells: ${report.total}; active: ${report.activeCount}; auto: ${report.byCombatUse.auto}; browse-only: ${report.byCombatUse["browse-only"]}; review: ${report.byCombatUse.review}\n`);
