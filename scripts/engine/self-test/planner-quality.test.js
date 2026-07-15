import assert from "node:assert/strict";
import { fighterContext, fixtureCandidates } from "../fixtures.js";
import {
  formatPlannerQualityReport,
  runPlannerQualityLab,
} from "../planner/quality-lab.js";
import { plannerQualityScenarios } from "../planner/quality-scenarios.js";

const report = runPlannerQualityLab(plannerQualityScenarios);
assert.equal(report.passed, true, report.scenarios.flatMap((scenario) => scenario.failures).join("\n"));
assert.equal(report.summary.qualityScore, 100);
assert.equal(report.summary.scenarioCount, plannerQualityScenarios.length);
assert.equal(report.scenarios.every((scenario) => scenario.metrics.deterministic), true);
assert.equal(report.scenarios.find((scenario) => scenario.id === "wide-pool-coverage")?.metrics.candidateCoverage, 1);
assert.match(formatPlannerQualityReport(report), /6\/6 scenarios passed \| 100% quality/);

const failingReport = runPlannerQualityLab([{
  id: "intentional-failure",
  context: fighterContext,
  candidates: fixtureCandidates,
  expect: { rankedPlans: [{ rank: 1, includes: ["impossible-action"] }] },
}]);
assert.equal(failingReport.passed, false);
assert.match(failingReport.scenarios[0].failures[0], /missing impossible-action/);
assert.match(formatPlannerQualityReport(failingReport), /FAIL intentional-failure/);

assert.throws(
  () => runPlannerQualityLab([
    { id: "duplicate", context: fighterContext, candidates: [] },
    { id: "duplicate", context: fighterContext, candidates: [] },
  ]),
  /Duplicate planner quality scenario id/,
);

console.log("PF2e Combater planner quality lab test passed");
