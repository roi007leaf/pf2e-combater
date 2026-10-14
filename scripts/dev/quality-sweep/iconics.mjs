// Iconic character sources for the quality sweep, read from the installed PF2e system's `iconics`
// Actor pack. Paizo data is never committed: the extract is cached per system version under
// scripts/dev/quality-sweep/.cache/ (gitignored). Pass --refresh to re-read the pack.
import { ClassicLevel } from "classic-level";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CACHE_DIR = fileURLToPath(new URL("./.cache/", import.meta.url));
const SYSTEM_ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)), "../../systems/pf2e");

function systemManifest() {
  const file = join(SYSTEM_ROOT, "system.json");
  if (!existsSync(file)) throw new Error(`PF2e system not found at ${SYSTEM_ROOT} (the sweep needs a local Foundry install).`);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function extractIconics(packPath) {
  // Copy first: Foundry may hold the LevelDB LOCK while it runs.
  const scratch = join(tmpdir(), "pf2e-combater-quality-sweep-iconics");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  cpSync(packPath, scratch, { recursive: true, filter: (src) => !/[\\/]LOCK$/.test(src) });
  const db = new ClassicLevel(scratch, { keyEncoding: "utf8", valueEncoding: "json" });
  const actors = {};
  const items = {};
  try {
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith("!actors!")) actors[value._id] = value;
      else if (key.startsWith("!actors.items!")) {
        const actorId = key.slice("!actors.items!".length).split(".")[0];
        (items[actorId] ??= []).push(value);
      }
    }
  } finally {
    await db.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  const result = {};
  for (const [id, actor] of Object.entries(actors)) {
    if (actor.type !== "character") continue;
    const embedded = items[id] ?? (Array.isArray(actor.items) ? actor.items.filter((item) => typeof item === "object") : []);
    result[actor.name] = { ...actor, items: embedded };
  }
  return result;
}

export async function loadIconics({ refresh = false, log = () => {} } = {}) {
  const manifest = systemManifest();
  const cacheFile = join(CACHE_DIR, `iconics-pf2e-${manifest.version}.json`);
  if (!refresh && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
  const pack = (manifest.packs ?? []).find((entry) => entry.name === "iconics" && entry.type === "Actor");
  if (!pack) throw new Error("PF2e system has no `iconics` Actor pack.");
  log(`extracting iconics from PF2e ${manifest.version} pack...`);
  const iconics = await extractIconics(resolve(SYSTEM_ROOT, pack.path));
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(iconics));
  log(`cached ${Object.keys(iconics).length} iconics -> ${cacheFile}`);
  return iconics;
}
