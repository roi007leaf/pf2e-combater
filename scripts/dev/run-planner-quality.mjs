import {
  formatPlannerQualityReport,
  runPlannerQualityLab,
} from "../engine/planner/quality-lab.js";
import { plannerQualityScenarios } from "../engine/planner/quality-scenarios.js";
import { loadRecordedTurnScenarios } from "./recorded-turns.mjs";

const report = runPlannerQualityLab([...plannerQualityScenarios, ...await loadRecordedTurnScenarios()]);
const json = process.argv.includes("--json");
process.stdout.write(`${json ? JSON.stringify(report, null, 2) : formatPlannerQualityReport(report)}\n`);
if (!report.passed) process.exitCode = 1;
