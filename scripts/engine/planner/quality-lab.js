import { actionBudget } from "../action/budget.js";
import { normalizedActionFacts } from "../action/facts.js";
import { slugify } from "../action/text.js";
import { buildTurnPlans } from "../planner.js";

export const PLANNER_QUALITY_LAB_VERSION = 1;

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rounded(value, precision = 3) {
  const factor = 10 ** precision;
  return Math.round(numeric(value) * factor) / factor;
}

function normalizedReference(value) {
  return slugify(String(value ?? ""));
}

function actionReferences(action) {
  const facts = normalizedActionFacts(action);
  return new Set([
    action?.id,
    action?.slug,
    action?.actionKey,
    action?.name,
    facts.identity.id,
    facts.identity.slug,
  ].map(normalizedReference).filter(Boolean));
}

function primaryActionReference(action) {
  return String(
    action?.id
      ?? action?.slug
      ?? action?.actionKey
      ?? action?.name
      ?? normalizedActionFacts(action).identity.slug
      ?? "unknown",
  );
}

function actionMatches(action, reference) {
  return actionReferences(action).has(normalizedReference(reference));
}

function planIncludes(plan, reference) {
  return (plan?.steps ?? []).some((step) => actionMatches(step, reference));
}

function planHasOrderedSequence(plan, sequence) {
  const wanted = Array.isArray(sequence) ? sequence : [];
  if (!wanted.length) return true;
  let index = 0;
  for (const step of plan?.steps ?? []) {
    if (!actionMatches(step, wanted[index])) continue;
    index += 1;
    if (index >= wanted.length) return true;
  }
  return false;
}

function planRequirementFailures(plan, requirement = {}) {
  if (!plan) return ["plan is missing"];
  const failures = [];
  for (const reference of requirement.includes ?? []) {
    if (!planIncludes(plan, reference)) failures.push(`missing ${reference}`);
  }
  for (const reference of requirement.excludes ?? []) {
    if (planIncludes(plan, reference)) failures.push(`includes forbidden ${reference}`);
  }
  if (!planHasOrderedSequence(plan, requirement.sequence)) {
    failures.push(`missing ordered sequence ${(requirement.sequence ?? []).join(" -> ")}`);
  }
  if (Number.isFinite(Number(requirement.totalCost))
    && numeric(plan.totalCost, NaN) !== Number(requirement.totalCost)) {
    failures.push(`cost ${plan.totalCost} != ${requirement.totalCost}`);
  }
  return failures;
}

function entityReference(entity) {
  return entity?.id ?? entity?.uuid ?? entity?.name ?? null;
}

function planSnapshot(plan) {
  return {
    totalCost: numeric(plan?.totalCost),
    score: numeric(plan?.score),
    steps: (plan?.steps ?? []).map((step) => {
      const facts = normalizedActionFacts(step);
      const destination = step?.destination ?? step?.movementPlan?.destination;
      return {
        action: primaryActionReference(step),
        slug: facts.identity.slug,
        score: numeric(step?.score),
        mapPenalty: numeric(step?.mapPenalty),
        target: entityReference(step?.suggestedTarget ?? step?.preferredTarget),
        routeMode: step?.routeMode ?? null,
        destination: destination
          ? { x: numeric(destination.x), y: numeric(destination.y) }
          : null,
      };
    }),
  };
}

function planSummary(plan) {
  if (!plan) return null;
  return {
    actions: (plan.steps ?? []).map(primaryActionReference),
    totalCost: numeric(plan.totalCost),
    score: numeric(plan.score),
    summary: plan.summary ?? "",
  };
}

function planFeatures(plan) {
  const features = new Set();
  for (const step of plan?.steps ?? []) {
    const facts = normalizedActionFacts(step);
    features.add(`action:${facts.identity.slug}`);
    features.add(`category:${facts.category}`);
    const target = entityReference(step?.suggestedTarget ?? step?.preferredTarget);
    if (target) features.add(`target:${target}`);
    if (step?.routeMode) features.add(`route:${step.routeMode}`);
  }
  return features;
}

function planDistance(left, right) {
  const leftFeatures = planFeatures(left);
  const rightFeatures = planFeatures(right);
  const union = new Set([...leftFeatures, ...rightFeatures]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const feature of leftFeatures) {
    if (rightFeatures.has(feature)) intersection += 1;
  }
  return 1 - intersection / union.size;
}

function topAlternativeDiversity(plans) {
  if (plans.length < 2) return 0;
  const alternatives = plans.slice(1, 4);
  return rounded(
    alternatives.reduce((total, plan) => total + planDistance(plans[0], plan), 0)
      / alternatives.length,
  );
}

function candidateCoverage(candidates, plans) {
  if (!candidates.length) return 1;
  const covered = candidates.filter((candidate) => {
    const reference = primaryActionReference(candidate);
    return plans.some((plan) => planIncludes(plan, reference));
  }).length;
  return rounded(covered / candidates.length);
}

function stablePlans(plans) {
  return JSON.stringify(plans.map(planSnapshot));
}

function currentTime() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function validateScenarios(scenarios) {
  if (!Array.isArray(scenarios) || !scenarios.length) {
    throw new TypeError("Planner quality lab requires at least one scenario.");
  }
  const ids = new Set();
  for (const scenario of scenarios) {
    const id = String(scenario?.id ?? "").trim();
    if (!id) throw new TypeError("Every planner quality scenario requires an id.");
    if (ids.has(id)) throw new TypeError(`Duplicate planner quality scenario id: ${id}`);
    if (!scenario?.context || typeof scenario.context !== "object") {
      throw new TypeError(`Planner quality scenario ${id} requires a context.`);
    }
    if (!Array.isArray(scenario.candidates)) {
      throw new TypeError(`Planner quality scenario ${id} requires candidates.`);
    }
    ids.add(id);
  }
}

function scenarioResult(scenario) {
  const options = { reservedSteps: scenario.reservedSteps ?? [] };
  const started = currentTime();
  const plans = buildTurnPlans(scenario.context, scenario.candidates, options);
  const plannerMs = rounded(currentTime() - started);
  const repeatedPlans = buildTurnPlans(scenario.context, scenario.candidates, options);
  const deterministic = stablePlans(plans) === stablePlans(repeatedPlans);
  const budgetState = actionBudget(scenario.context);
  const budget = numeric(budgetState.totalActions);
  const diagnostics = plans[0]?.searchDiagnostics ?? {};
  const completePlans = plans.filter((plan) => numeric(plan.totalCost) >= budget).length;
  const metrics = {
    budget,
    normalActions: numeric(budgetState.normalActions),
    quickenedActions: numeric(budgetState.quickenedActions),
    candidateCount: scenario.candidates.length,
    candidateCoverage: candidateCoverage(scenario.candidates, plans),
    completePlanRate: rounded(plans.length ? completePlans / plans.length : 0),
    deterministic,
    eligibleCandidates: numeric(diagnostics.eligibleCandidates),
    planCount: plans.length,
    plannerMs,
    searchLimitHit: diagnostics.searchLimitHit === true,
    searchedCandidates: numeric(diagnostics.searchedCandidates),
    statesExpanded: numeric(diagnostics.statesExpanded),
    statesPruned: numeric(diagnostics.statesPruned),
    topAlternativeDiversity: topAlternativeDiversity(plans),
    topPlanBudgetUse: rounded(budget > 0 ? numeric(plans[0]?.totalCost) / budget : 0),
  };
  const checks = [];
  const failures = [];
  function addCheck(id, passed, failure) {
    checks.push({ id, passed });
    if (!passed) failures.push(failure);
  }

  addCheck("deterministic", deterministic, "planner output changed between identical runs");
  const expected = scenario.expect ?? {};
  for (const requirement of expected.rankedPlans ?? []) {
    const rank = Math.max(1, Math.trunc(numeric(requirement.rank, 1)));
    const problems = planRequirementFailures(plans[rank - 1], requirement);
    addCheck(
      `rank-${rank}`,
      problems.length === 0,
      `rank ${rank}: ${problems.join(", ")}`,
    );
  }
  for (const [index, requirement] of (expected.anyPlans ?? []).entries()) {
    const matched = plans.some((plan) => planRequirementFailures(plan, requirement).length === 0);
    addCheck(
      `any-plan-${index + 1}`,
      matched,
      `no plan matched ${JSON.stringify(requirement)}`,
    );
  }
  for (const reference of expected.excludedFromAllPlans ?? []) {
    const excluded = plans.every((plan) => !planIncludes(plan, reference));
    addCheck(
      `excluded-${normalizedReference(reference)}`,
      excluded,
      `${reference} appeared in a plan`,
    );
  }
  for (const [index, constraint] of (expected.maxActionsPerPlan ?? []).entries()) {
    const maximum = Math.max(0, Math.trunc(numeric(constraint.max)));
    const references = constraint.actions ?? [];
    const respected = plans.every((plan) => (plan.steps ?? [])
      .filter((step) => references.some((reference) => actionMatches(step, reference))).length <= maximum);
    addCheck(
      `max-actions-${index + 1}`,
      respected,
      `a plan used more than ${maximum} of ${references.join(", ")}`,
    );
  }
  if (Number.isFinite(Number(expected.minPlanCount))) {
    addCheck(
      "min-plan-count",
      metrics.planCount >= Number(expected.minPlanCount),
      `plan count ${metrics.planCount} < ${expected.minPlanCount}`,
    );
  }
  if (Number.isFinite(Number(expected.minCandidateCoverage))) {
    addCheck(
      "min-candidate-coverage",
      metrics.candidateCoverage >= Number(expected.minCandidateCoverage),
      `candidate coverage ${metrics.candidateCoverage} < ${expected.minCandidateCoverage}`,
    );
  }
  if (Number.isFinite(Number(expected.minCompletePlanRate))) {
    addCheck(
      "min-complete-plan-rate",
      metrics.completePlanRate >= Number(expected.minCompletePlanRate),
      `complete plan rate ${metrics.completePlanRate} < ${expected.minCompletePlanRate}`,
    );
  }
  if (Number.isFinite(Number(expected.minTopAlternativeDiversity))) {
    addCheck(
      "min-top-alternative-diversity",
      metrics.topAlternativeDiversity >= Number(expected.minTopAlternativeDiversity),
      `top alternative diversity ${metrics.topAlternativeDiversity} < ${expected.minTopAlternativeDiversity}`,
    );
  }
  if (Number.isFinite(Number(expected.maxStatesExpanded))) {
    addCheck(
      "max-states-expanded",
      metrics.statesExpanded <= Number(expected.maxStatesExpanded),
      `states expanded ${metrics.statesExpanded} > ${expected.maxStatesExpanded}`,
    );
  }
  if (typeof expected.searchLimitHit === "boolean") {
    addCheck(
      "search-limit-hit",
      metrics.searchLimitHit === expected.searchLimitHit,
      `searchLimitHit ${metrics.searchLimitHit} != ${expected.searchLimitHit}`,
    );
  }

  return {
    id: scenario.id,
    name: scenario.name ?? scenario.id,
    passed: failures.length === 0,
    failures,
    checks,
    metrics,
    topPlan: planSummary(plans[0]),
  };
}

export function runPlannerQualityLab(scenarios) {
  validateScenarios(scenarios);
  const results = scenarios.map(scenarioResult);
  const checks = results.flatMap((result) => result.checks);
  const passedChecks = checks.filter((check) => check.passed).length;
  const passedScenarios = results.filter((result) => result.passed).length;
  return {
    version: PLANNER_QUALITY_LAB_VERSION,
    passed: passedScenarios === results.length,
    summary: {
      scenarioCount: results.length,
      passedScenarios,
      failedScenarios: results.length - passedScenarios,
      checks: checks.length,
      passedChecks,
      qualityScore: checks.length ? Math.round(passedChecks / checks.length * 100) : 100,
      plannerMs: rounded(results.reduce((total, result) => total + result.metrics.plannerMs, 0)),
      statesExpanded: results.reduce((total, result) => total + result.metrics.statesExpanded, 0),
      statesPruned: results.reduce((total, result) => total + result.metrics.statesPruned, 0),
    },
    scenarios: results,
  };
}

export function formatPlannerQualityReport(report) {
  const summary = report.summary;
  const lines = [
    "PF2e Combater Planner Quality Lab",
    `${summary.passedScenarios}/${summary.scenarioCount} scenarios passed | ${summary.qualityScore}% quality | ${summary.plannerMs} ms | ${summary.statesExpanded} states`,
  ];
  for (const scenario of report.scenarios) {
    const top = scenario.topPlan?.actions?.join(" -> ") || "No recommendation";
    lines.push(
      `${scenario.passed ? "PASS" : "FAIL"} ${scenario.id}: ${top} | coverage ${Math.round(scenario.metrics.candidateCoverage * 100)}% | diversity ${scenario.metrics.topAlternativeDiversity}`,
    );
    for (const failure of scenario.failures) lines.push(`  - ${failure}`);
  }
  return lines.join("\n");
}
