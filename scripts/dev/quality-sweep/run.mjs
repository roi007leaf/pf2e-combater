// Auto-fill quality sweep: every PF2e iconic (highest level build, companions skipped) x every
// situation x Auto + the player tactics that fit its class, through the live
// buildCandidates -> buildTurnPlans pipeline, judged automatically.
//
//   npm run planner:sweep [-- [nameRegex] [situationRegex] [roleRegex]] [--refresh] [--show <judge>]
//
// Exits 1 when a GATED judge (see judges.mjs) fires on a top-1 plan. Full per-scenario results go to
// scripts/dev/quality-sweep/.cache/results.json. Needs the local PF2e system install (iconics.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR, loadIconics } from "./iconics.mjs";
import { buildContext, fmtPlan, highestLevelBuilds, runPipeline, SITUATIONS, TP, useIconics } from "./harness.mjs";
import { GATED_JUDGES, judgePlan, SLOW_PLANNING_MS } from "./judges.mjs";

const CLASS_ROLES = {
  fighter: ["melee-striker", "defender", "ranged-striker"], barbarian: ["melee-striker", "defender"], champion: ["defender", "melee-striker", "healer"],
  ranger: ["ranged-striker", "skirmisher", "melee-striker"], rogue: ["skirmisher", "melee-striker", "debuffer"], swashbuckler: ["skirmisher", "melee-striker", "debuffer"],
  monk: ["skirmisher", "melee-striker"], investigator: ["melee-striker", "debuffer", "support"], gunslinger: ["ranged-striker", "skirmisher"],
  inventor: ["melee-striker", "support"], thaumaturge: ["melee-striker", "debuffer"], magus: ["melee-striker", "spell-damage"],
  cleric: ["healer", "buffer", "spell-damage"], druid: ["spell-damage", "healer", "debuffer"], bard: ["buffer", "support", "debuffer"],
  sorcerer: ["spell-damage", "debuffer", "buffer"], wizard: ["spell-damage", "debuffer"], witch: ["spell-damage", "debuffer", "buffer"],
  psychic: ["spell-damage", "debuffer"], oracle: ["healer", "spell-damage", "debuffer"], alchemist: ["ranged-striker", "support", "healer"],
  kineticist: ["spell-damage", "ranged-striker"], animist: ["healer", "spell-damage", "buffer"], exemplar: ["melee-striker", "skirmisher"],
  commander: ["support", "buffer", "melee-striker"], guardian: ["defender", "melee-striker"], summoner: ["melee-striker", "spell-damage", "buffer"],
};

const argv = process.argv.slice(2);
const refresh = argv.includes("--refresh");
const showIndex = argv.indexOf("--show");
const showJudge = showIndex >= 0 ? argv[showIndex + 1] : null;
const positional = argv.filter((arg, i) => !arg.startsWith("--") && !(showIndex >= 0 && i === showIndex + 1));
const [nameF, sitF, roleF] = positional.map((s) => (s && s !== "*" ? new RegExp(s, "i") : null));

useIconics(await loadIconics({ refresh, log: (line) => console.log(line) }));
const names = highestLevelBuilds().filter((n) => !nameF || nameF.test(n));
const sits = Object.keys(SITUATIONS).filter((s) => !sitF || sitF.test(s));

const results = [];
const t0 = Date.now();
for (const name of names) {
  const cls = buildContext(name, "adjacent", "auto")._meta.clsSlug;
  const roles = ["auto", ...(CLASS_ROLES[cls] ?? [])].filter((r) => !roleF || roleF.test(r));
  for (const sit of sits) for (const role of roles) {
    const rec = { name, cls, sit, role, flags: [] };
    try {
      const ctx = buildContext(name, sit, role);
      const r = runPipeline(ctx);
      rec.effRole = TP.resolveTacticPersonality(ctx).effectiveRole;
      rec.candMs = r.candMs;
      rec.planMs = r.planMs;
      rec.top = r.plans.slice(0, 3).map(fmtPlan);
      rec.flags = r.plans.slice(0, 3).flatMap((p, i) => judgePlan(ctx, r.build, p, i + 1));
      if (r.planMs > SLOW_PLANNING_MS) rec.flags.push({ judge: "slow-planning", rank: 0, msg: `${r.planMs.toFixed(0)} ms` });
      rec.cands = r.build.candidates.toSorted((a, b) => b.score - a.score).slice(0, 14).map((c) => `${c.name}[${c.actionCost}]=${Math.round(c.score)}`);
      rec.appr = r.build.approachable.map((c) => `${c.name}=${Math.round(c.score)}`);
    } catch (e) {
      rec.crash = String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ");
      rec.flags.push({ judge: "crash", rank: 0, msg: rec.crash });
    }
    results.push(rec);
  }
}

mkdirSync(CACHE_DIR, { recursive: true });
const resultsFile = join(CACHE_DIR, "results.json");
writeFileSync(resultsFile, JSON.stringify(results, null, 1));

const isTop1 = (f) => f.rank <= 1;
const ms = results.filter((r) => r.planMs !== undefined).map((r) => r.planMs).sort((a, b) => a - b);
const counts = {};
for (const r of results) for (const f of r.flags) {
  counts[f.judge] ??= { gated: GATED_JUDGES.includes(f.judge) ? "yes" : "", top1: 0, top3: 0 };
  counts[f.judge].top3++;
  if (isTop1(f)) counts[f.judge].top1++;
}
const sortedCounts = Object.fromEntries(Object.entries(counts).sort(([, a], [, b]) => b.top1 - a.top1 || b.top3 - a.top3));
console.log(`scenarios ${results.length}, crashes ${results.filter((r) => r.crash).length}, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`planMs median ${ms[Math.floor(ms.length / 2)]?.toFixed(0)} p90 ${ms[Math.floor(ms.length * 0.9)]?.toFixed(0)} max ${ms.at(-1)?.toFixed(0)}`);
if (Object.keys(sortedCounts).length) console.table(sortedCounts);
else console.log("no judge fired");

const printRecord = (r, flags) => {
  console.log(`\n## ${r.name} | ${r.sit} | ${r.role}${r.effRole ? `->${r.effRole}` : ""} | ${r.planMs?.toFixed(0) ?? "-"}ms`);
  for (const f of flags) console.log(`   [${f.judge} #${f.rank}] ${f.msg}`);
  (r.top ?? []).forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
};
if (showJudge) {
  for (const r of results) {
    const flags = r.flags.filter((f) => f.judge === showJudge);
    if (flags.length) printRecord(r, flags);
  }
}

const failures = results.filter((r) => r.flags.some((f) => isTop1(f) && GATED_JUDGES.includes(f.judge)));
if (failures.length) {
  console.log(`\nFAIL: gated judges fired on ${failures.length} top-1 plan(s):`);
  for (const r of failures.slice(0, 20)) printRecord(r, r.flags.filter((f) => isTop1(f) && GATED_JUDGES.includes(f.judge)));
  process.exitCode = 1;
} else {
  console.log(`\nPASS: no gated judge (${GATED_JUDGES.join(", ")}) on a top-1 plan. Results: ${resultsFile}`);
}
