import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RECORDED_DIR = fileURLToPath(new URL("../../tests/recorded-turns/", import.meta.url));

// Recorded turns (tests/recorded-turns/*.json, saved from the panel) as quality-lab scenarios.
export async function loadRecordedTurnScenarios(directory = RECORDED_DIR) {
  let files = [];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const scenarios = [];
  for (const file of files) {
    const turn = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    if (!turn?.context || !Array.isArray(turn.candidates) || !turn.expect) {
      throw new Error(`Recorded turn ${file} is missing context, candidates or expect.`);
    }
    scenarios.push({
      id: turn.id ?? path.basename(file, ".json"),
      name: turn.name ?? file,
      context: turn.context,
      candidates: turn.candidates,
      approachCandidates: turn.approachCandidates ?? [],
      reservedSteps: turn.reservedSteps ?? [],
      expect: { searchLimitHit: false, ...turn.expect },
    });
  }
  return scenarios;
}
