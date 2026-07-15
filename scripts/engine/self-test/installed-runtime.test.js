import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspectInstalledRuntimeContract } from "../../runtime/installed-smoke.js";

const foundryAppPath = process.env.FOUNDRY_APP_PATH
  ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const foundryDataPath = process.env.FOUNDRY_DATA_PATH
  ?? path.join(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data");
const pf2ePath = path.join(foundryDataPath, "systems", "pf2e");

const report = inspectInstalledRuntimeContract({
  moduleManifest: JSON.parse(readFileSync(new URL("../../../module.json", import.meta.url), "utf8")),
  foundryManifest: JSON.parse(readFileSync(path.join(foundryAppPath, "package.json"), "utf8")),
  pf2eManifest: JSON.parse(readFileSync(path.join(pf2ePath, "system.json"), "utf8")),
  foundryTokenSource: readFileSync(path.join(foundryAppPath, "client", "documents", "token.mjs"), "utf8"),
  pf2eSource: readFileSync(path.join(pf2ePath, "pf2e.mjs"), "utf8"),
});

assert.equal(report.ok, true, report.failures.join("\n"));
assert.equal(report.foundry.version, "14.364.0");
assert.equal(report.pf2e.version, "8.3.0");
assert.deepEqual(report.contracts, {
  nativeMovement: true,
  recordedMovementUndo: true,
  movementMeasurement: true,
  movementHook: true,
  pf2eActionLookup: true,
  pf2eActionUse: true,
  spellCast: true,
  spellSlotState: true,
  itemMacro: true,
});

console.log(`PF2e Combater installed runtime smoke passed: Foundry ${report.foundry.version}, PF2e ${report.pf2e.version}`);
