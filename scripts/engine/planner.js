import { actionBudget } from "./action/budget.js";
import { slugify as normalizeSlug } from "./action/text.js";
import { combineConfidence } from "./confidence.js";
import { normalizedActionFacts } from "./action/facts.js";
import {
  actionKey,
  inheritPlannedTarget,
  isAttackAction,
  isGrabRider,
  isSpellAction,
  isStrikeAction,
  isStrikeLikeCandidate,
  previousActionRequirements,
  previousActionSatisfied,
  requiresPreviousAction,
  requiresTargetCondition,
  stepSatisfiesPreviousRequirements,
  stepSatisfiesTargetConditionRequirement,
  targetConditionChainBonus,
  targetConditionRequirementOptions,
  targetConditionSatisfied,
  values,
} from "./planner/rules.js";
import {
  projectedFollowUpSatisfied,
  projectedVolleyPenalty,
  withLingeringCompositionCandidates,
  withProjectedFollowUpStrikeCandidates,
  withQuickenedCastingDiscountCandidates,
} from "./planner/projections.js";
import { planSignature } from "./planner/plan-signature.js";
import {
  advancePlanState,
  createPlanState,
  evaluatePlan,
  planStateSignature,
  projectContextFromPlanState,
} from "./plan-state.js";
import {
  BASIC_MOVE_SLUGS,
  hasAttackPathAvailable,
  hasPlanConflict,
  includesStand,
  isRepeatablePlanningAction,
} from "./planner/conflicts.js";
import { contextAllies } from "./target-pool.js";
import { t } from "../i18n.js";
import {
  boundedPlanPreferenceDelta,
  deterministicPlanPreferenceAdjustment,
} from "../state/preference-profile.js";
import { HARD_BLOCK_SCORE, MAP_PENALTY_BY_ATTACK_INDEX } from "./scoring/weights.js";
import {
  resolveTacticPersonality,
  tacticPersonalityPlanAdjustment,
} from "../rules/tactic-personality.js";
import {
  activeTurnIntentCount,
  applyTurnIntentToPlan,
  requiredTurnIntentCandidate,
  turnIntentActionBudget,
  turnIntentCandidateAllowed,
  turnIntentPlanAllowed,
} from "./planner/turn-intent.js";

export { isAttackAction } from "./planner/rules.js";

const MAX_CANDIDATES = 12;
const PRIMARY_CANDIDATES = 8;
const CONDITION_SETUP_CANDIDATES = 4;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
const MAX_SEARCH_STATES = 1024;
const MAX_COVERAGE_SEARCH_STATES = 48;
const MAX_COVERAGE_PLANS = 8;
const DIVERSITY_SCORE_WINDOW = 6;
const DIVERSITY_LOOKAHEAD = 12;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const MAP_SCORE_WEIGHT = 3;
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_ALLOWED_SLUGS = new Set(["strike", "stride"]);
const DIVERSE_CANDIDATE_CATEGORIES = [
  "strike",
  "class",
  "skill",
  "support",
  "movement",
  "item",
  "spell",
];
const AC_SETUP_CONDITIONS = new Set(["off-guard", "frightened", "clumsy", "sickened", "prone", "grabbed", "restrained"]);
const AC_PENALTY_FIELDS = [
  "acPenalty",
  "armorClassPenalty",
  "defensePenalty",
  "targetAcPenalty",
  "targetDefensePenalty",
];
const PLANNER_EXCLUDED_UTILITY_ROLES = new Set(["exploration-utility"]);
const PLANNER_EXCLUDED_COMBAT_USE = new Set(["browse-only", "context-only", "never-auto-fill"]);

function emptyPlan(context) {
  return {
    id: "empty",
    actor: context.actor,
    target: null,
    steps: [],
    totalCost: 0,
    score: 0,
    confidence: combineConfidence([]),
    summary: t("Plan.NoRecommendation", "No recommendation"),
    reason: t("Plan.NoUsableActions", "No usable combat actions were detected."),
  };
}

function hasAgileTrait(candidate) {
  return normalizedActionFacts(candidate).traits.includes("agile");
}

// Where the actor stands after the prior plan steps: a move-and-strike composite's attack square,
// or a committed Stride destination. Null when nothing moved the actor (base score already fits).
// Per-step projected volley penalty: a Volley weapon fired from where a prior move lands the actor
// may be within its volley range even when the unmoved base position was not. Only the penalty the
// base score did NOT already include is added here, so scoring's base-position penalty isn't doubled.
// Matches the granting ability's own wording: "an arcane spontaneous spell." Rank caps ("8th level
// or lower") aren't enforced -- see the design doc for why this is an accepted simplification.
function candidateCategory(candidate) {
  return normalizedActionFacts(candidate).category;
}

function bossAutoFillCandidateAllowed(resolvedTactic, candidate) {
  if (resolvedTactic?.effectiveRole !== "boss") return true;
  return candidateCategory(candidate) !== "skill";
}

function arrayValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [value];
}

function conditionSlugs(entity) {
  const conditions = entity?.conditions;
  if (!conditions) return new Set();
  if (Array.isArray(conditions)) {
    return new Set(conditions.map((condition) => normalizeSlug(condition?.slug ?? condition?.name ?? condition)).filter(Boolean));
  }
  return new Set([
    ...arrayValues(conditions.slugs),
    ...Object.entries(conditions.values ?? {})
      .filter(([, value]) => Number(value) > 0)
      .map(([slug]) => slug),
  ].map(normalizeSlug).filter(Boolean));
}

function entityHasAnyCondition(entity, conditions) {
  const wanted = arrayValues(conditions).map(normalizeSlug).filter(Boolean);
  if (!wanted.length) return false;
  const current = conditionSlugs(entity);
  return wanted.some((condition) => current.has(condition));
}

function contextAutoFillMatches(context, candidate) {
  const gate = candidate?.activityProfile?.contextAutoFill;
  if (!gate || typeof gate !== "object") return false;
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  if (entityHasAnyCondition(profile, gate.selfAnyCondition)) return true;
  if (arrayValues(gate.alliesAnyCondition).length) {
    return contextAllies(context).some((ally) => entityHasAnyCondition(ally, gate.alliesAnyCondition));
  }
  return false;
}

function autoFillEligibleCandidate(context, candidate) {
  const facts = normalizedActionFacts(candidate);
  const { combatUse, role, utilitySubtype } = facts;
  if (combatUse === "context-only" && contextAutoFillMatches(context, candidate)) return true;
  if (PLANNER_EXCLUDED_COMBAT_USE.has(combatUse)) return false;
  if (PLANNER_EXCLUDED_UTILITY_ROLES.has(role) || PLANNER_EXCLUDED_UTILITY_ROLES.has(utilitySubtype)) return false;
  if (!facts.automation.confidenceAllowsAutoFill) return false;
  return true;
}

function isMajorCriticalFailureAttackSkill(candidate) {
  const facts = normalizedActionFacts(candidate);
  return facts.resolution.attack
    && Boolean(facts.resolution.skill)
    && facts.resolution.criticalFailureRisk === "major";
}

function selectPlanningCandidates(sortedCandidates) {
  const selected = [];
  const selectedKeys = new Set();

  function add(candidate) {
    if (!candidate || selected.length >= MAX_CANDIDATES) return;
    const key = actionKey(candidate);
    if (selectedKeys.has(key)) return;
    selected.push(candidate);
    selectedKeys.add(key);
  }

  for (const candidate of sortedCandidates.slice(0, PRIMARY_CANDIDATES)) add(candidate);

  for (const payoff of sortedCandidates.filter(requiresTargetCondition).slice(0, PRIMARY_CANDIDATES)) {
    for (const group of targetConditionRequirementOptions(payoff)) {
      let added = 0;
      const setupCandidates = sortedCandidates
        .filter((candidate) => candidate !== payoff && stepSatisfiesTargetConditionRequirement(candidate, group))
        .toSorted((left, right) => Number(isGrabRider(right)) - Number(isGrabRider(left)));
      for (const setup of setupCandidates) {
        if (added >= CONDITION_SETUP_CANDIDATES) break;
        add(setup);
        added += 1;
      }
    }
  }

  for (const category of DIVERSE_CANDIDATE_CATEGORIES) {
    if (selected.some((candidate) => candidateCategory(candidate) === category)) continue;
    add(sortedCandidates.find((candidate) => candidateCategory(candidate) === category));
  }

  for (const candidate of sortedCandidates) add(candidate);
  return selected.toSorted((left, right) => {
    const targetConditionDelta = Number(requiresTargetCondition(left)) - Number(requiresTargetCondition(right));
    if (targetConditionDelta !== 0) return targetConditionDelta;
    const previousDelta = Number(requiresPreviousAction(left)) - Number(requiresPreviousAction(right));
    if (previousDelta !== 0) return previousDelta;
    const criticalFailureRiskDelta = Number(isMajorCriticalFailureAttackSkill(right))
      - Number(isMajorCriticalFailureAttackSkill(left));
    if (criticalFailureRiskDelta !== 0) return criticalFailureRiskDelta;
    return selected.indexOf(left) - selected.indexOf(right);
  });
}

function reloadCost(candidate) {
  const value = Number(
    candidate?.reload
      ?? candidate?.activityProfile?.reloadCost
      ?? candidate?.item?.system?.reload?.value
      ?? candidate?.item?.system?.reload,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasOffensiveFollowUp(steps) {
  return steps.some((step) => isAttackAction(step));
}

function hasStrikeFollowUp(steps) {
  return steps.some((step) => {
    const { resolution } = normalizedActionFacts(step);
    return resolution.strike || resolution.includesStrike;
  });
}

function weaponIdentityValues(action) {
  return [
    action?.activityProfile?.weaponId,
    action?.activityProfile?.weaponName,
    action?.weapon?.id,
    action?.weapon?.name,
    action?.backingStrike?.item?.id,
    action?.backingStrike?.item?.name,
    action?.item?.type === "weapon" ? action.item.id : null,
    action?.item?.type === "weapon" ? action.item.name : null,
  ].map(normalizeSlug).filter(Boolean);
}

function planReloadsAreUseful(steps) {
  return steps.every((step) => {
    if (step?.activityProfile?.reload !== true && !String(step?.slug ?? "").startsWith("reload-")) return true;
    const reloadWeapons = new Set(weaponIdentityValues(step));
    return steps.some((candidate) => {
      if (candidate === step || (!isStrikeAction(candidate) && candidate?.activityProfile?.includesStrike !== true)) return false;
      const attackWeapons = weaponIdentityValues(candidate);
      return reloadWeapons.size === 0 || attackWeapons.some((weapon) => reloadWeapons.has(weapon));
    });
  });
}

function isSpellshapeSetup(step) {
  return step?.activityProfile?.spellshape === true || step?.activityProfile?.rangeBuff === true;
}

function planSpellshapesAreUseful(steps) {
  return steps.every((step, index) => {
    if (!isSpellshapeSetup(step)) return true;
    const nextStep = steps[index + 1];
    return Boolean(nextStep && isSpellAction(nextStep) && !isSpellshapeSetup(nextStep));
  });
}

function truthyPenalty(value) {
  if (value === true) return true;
  const number = Number(value);
  return Number.isFinite(number) && number !== 0;
}

function appliesAcSetupCondition(profile) {
  return [
    ...values(profile?.appliesCondition),
    ...values(profile?.appliesConditions),
    ...values(profile?.appliedCondition),
    ...values(profile?.conditions),
  ]
    .map((condition) => String(condition?.slug ?? condition?.name ?? condition).toLowerCase())
    .some((condition) => AC_SETUP_CONDITIONS.has(condition));
}

function appliesAcPenalty(profile) {
  return AC_PENALTY_FIELDS.some((field) => truthyPenalty(profile?.[field]));
}

function isOffensiveSetup(step) {
  const profile = step?.activityProfile ?? {};
  const setupFor = Array.isArray(step?.setupFor) ? step.setupFor : [];
  return step?.slug === "demoralize"
    || step?.slug === "feint"
    || step?.role === "setup"
    || setupFor.some((target) => ["strike", "attack", "damage"].includes(target))
    || appliesAcSetupCondition(profile)
    || appliesAcPenalty(profile);
}

function candidateSetupKeys(candidate) {
  return [
    candidate?.slug,
    candidate?.role,
    candidate?.source,
    candidate?.tacticSlug,
    candidate?.activityProfile?.tacticSlug,
    candidate?.activityProfile?.nextAction,
  ].map(normalizeSlug).filter(Boolean);
}

function setupPriority(step, allSteps) {
  if (requiresPreviousAction(step)) return 1;

  if (includesStand(step)) return -2;

  if (step?.activityProfile?.preMovementSetup === true && hasStrikeFollowUp(allSteps)) return -1.5;

  if (
    BASIC_MOVE_SLUGS.has(step?.slug)
    && (hasOffensiveFollowUp(allSteps) || allSteps.some((other) => isOffensiveSetup(other)))
  ) {
    return -1;
  }

  const setupFor = Array.isArray(step?.setupFor) ? step.setupFor : [];
  if (setupFor.length) {
    const setupKeys = setupFor.map(normalizeSlug);
    const supportsPlannedStep = allSteps.some((candidate) =>
      candidateSetupKeys(candidate).some((key) => setupKeys.includes(key)),
    );
    if (supportsPlannedStep) return 0;
  }

  if (step?.slug === "demoralize" && hasOffensiveFollowUp(allSteps)) return 0;
  if (step?.slug === "feint" && hasStrikeFollowUp(allSteps)) return 1;
  if (isOffensiveSetup(step) && hasOffensiveFollowUp(allSteps)) return 1;
  if (isMajorCriticalFailureAttackSkill(step) && hasOffensiveFollowUp(allSteps)) return 1.5;
  if (isAttackAction(step)) return 2;
  return 3;
}

function stepDependsOnStep(step, source) {
  const requirements = previousActionRequirements(step);
  if (requirements.length && stepSatisfiesPreviousRequirements(source, requirements)) return true;

  const projectedSource = step?.activityProfile?.requiresProjectedAfterKey;
  if (projectedSource && actionKey(source) === projectedSource) return true;

  return targetConditionRequirementOptions(step).some((group) =>
    stepSatisfiesTargetConditionRequirement(source, group),
  );
}

function dependencyOrderedSteps(steps) {
  const ordered = [...steps];
  let changed = true;

  while (changed) {
    changed = false;
    for (let index = 0; index < ordered.length; index += 1) {
      const dependent = ordered[index];
      const sourceIndex = ordered.findIndex((source, candidateIndex) =>
        candidateIndex > index
        && stepDependsOnStep(dependent, source)
        && !stepDependsOnStep(source, dependent),
      );
      if (sourceIndex < 0) continue;

      const [source] = ordered.splice(sourceIndex, 1);
      ordered.splice(index, 0, source);
      changed = true;
      break;
    }
  }

  return ordered;
}

function orderPlanSteps(steps) {
  const priorityOrdered = [...steps].toSorted((left, right) => {
    const leftDependsOnRight = stepDependsOnStep(left, right);
    const rightDependsOnLeft = stepDependsOnStep(right, left);
    if (leftDependsOnRight && !rightDependsOnLeft) return 1;
    if (rightDependsOnLeft && !leftDependsOnRight) return -1;

    const priorityDelta = setupPriority(left, steps) - setupPriority(right, steps);
    if (priorityDelta !== 0) return priorityDelta;
    return steps.indexOf(left) - steps.indexOf(right);
  });

  return dependencyOrderedSteps(priorityOrdered);
}

export function mapPenalty(candidate, attackIndex) {
  if (!isAttackAction(candidate)) return 0;
  if (attackIndex <= 0) return 0;
  // PF2e's MAP stops getting worse after the second extra attack, so a 3rd+ attack in one turn
  // is still capped at the same penalty as the 2nd.
  const tier = MAP_PENALTY_BY_ATTACK_INDEX[Math.min(attackIndex, 2)];
  return hasAgileTrait(candidate) ? tier.agile : tier.standard;
}

// How many attacks this action advances the multiple attack penalty by. Most
// attacks advance it by 1, but some activities count as several (e.g. Focused
// Assault "counts as a number of attacks equal to the number of heads") or none.
export function attacksTowardMap(candidate) {
  if (!isAttackAction(candidate)) return 0;
  const value = candidate.activityProfile?.mapAttacks;
  if (value === "variable") return 3;
  if (Number.isFinite(value)) return Math.max(0, value);
  return 1;
}

function quickenedCapacity(candidate, repeatReloadCost = 0) {
  if (candidate.actionCost === 1 && QUICKENED_ALLOWED_SLUGS.has(candidate.slug)) return 1;
  if (repeatReloadCost > 0 && isStrikeAction(candidate)) return 1;
  return 0;
}

function planScore(context, steps, sortedCandidates, budget) {
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const stepScore = steps.reduce((total, step) => {
    const indexPenalty = sortedCandidates.indexOf(step);
    return total + step.score - Math.max(indexPenalty, 0);
  }, 0);

  return stepScore
    + targetConditionChainBonus(context, steps)
    - (budget.totalActions - totalCost) * UNUSED_ACTION_PENALTY;
}

function toPlan(context, steps, sortedCandidates, budget, resolvedTactic = null) {
  const orderedSteps = applyTurnIntentToPlan(context?.turnIntent, orderPlanSteps(steps));
  const evaluation = evaluatePlan(context, orderedSteps);
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const targets = context.targets ?? context.battlefield?.targets ?? [];
  const tacticalScore = planScore(context, orderedSteps, sortedCandidates, budget);
  const tacticPlanAdjustment = tacticPersonalityPlanAdjustment(context, orderedSteps, resolvedTactic);
  const componentScoreDelta = orderedSteps.reduce(
    (total, step) => total + (Number(step?.preference?.scoreDelta) || 0),
    0,
  );
  const directPreference = deterministicPlanPreferenceAdjustment(context, { steps: orderedSteps, totalCost });
  const preferenceScoreDelta = boundedPlanPreferenceDelta(componentScoreDelta, directPreference.scoreDelta);
  const preferenceQueueDemoted = directPreference.negative === true;

  return {
    id: orderedSteps.map((step) => step.id).join("+"),
    actor: context.actor,
    target: targets[0] ?? null,
    steps: orderedSteps,
    totalCost,
    actionBudget: budget,
    score: tacticalScore + tacticPlanAdjustment.scoreDelta - componentScoreDelta + preferenceScoreDelta,
    tactic: tacticPlanAdjustment,
    preference: {
      ...directPreference,
      componentScoreDelta,
      scoreDelta: preferenceScoreDelta,
      queueDemoted: preferenceQueueDemoted,
    },
    evaluation: {
      score: evaluation.score,
      legal: evaluation.legal,
      projectedState: evaluation.projectedState,
      reasons: evaluation.reasons,
    },
    confidence: combineConfidence(orderedSteps.map((step) => step.confidence)),
    summary: orderedSteps.map((step) => step.name).join(" -> "),
    reason: orderedSteps[0]?.reason ?? "",
    turnIntent: {
      activeCount: activeTurnIntentCount(context?.turnIntent),
      constrained: activeTurnIntentCount(context?.turnIntent) > 0,
    },
  };
}

function dedupePlans(plans) {
  const deduped = [];
  const seen = new Set();
  for (const plan of plans) {
    const signature = planSignature(plan);
    if (signature && seen.has(signature)) continue;
    if (signature) seen.add(signature);
    deduped.push(plan);
  }
  return deduped;
}

function planUsesFullBudget(plan, budget) {
  const hasNegativeStep = (plan?.steps ?? [])
    .some((step) => Number.isFinite(step?.score) && step.score < 0);
  return !hasNegativeStep && Number(plan?.totalCost) >= Number(budget?.totalActions);
}

function comparePlanQuality(left, right, budget) {
  const leftDemoted = left.preference?.queueDemoted === true;
  const rightDemoted = right.preference?.queueDemoted === true;
  if (leftDemoted !== rightDemoted) return leftDemoted ? 1 : -1;
  const leftFull = planUsesFullBudget(left, budget);
  const rightFull = planUsesFullBudget(right, budget);
  if (leftFull !== rightFull) return rightFull ? 1 : -1;
  if (right.score !== left.score) return right.score - left.score;
  return right.totalCost - left.totalCost;
}

function offerPlan(plans, plan, cap, budget) {
  if (plans.length < cap) {
    plans.push(plan);
    return;
  }
  let worstIndex = 0;
  for (let index = 1; index < plans.length; index += 1) {
    if (comparePlanQuality(plans[index], plans[worstIndex], budget) > 0) worstIndex = index;
  }
  if (comparePlanQuality(plan, plans[worstIndex], budget) < 0) plans[worstIndex] = plan;
}

function plannerStateKey({ startIndex, normalCost, quickenedEligibleActions, freeSteps, usedActions, planState }) {
  const uses = [...usedActions.entries()]
    .toSorted(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, count]) => `${key}:${count}`)
    .join(",");
  return [
    startIndex,
    normalCost,
    quickenedEligibleActions,
    freeSteps,
    uses,
    planStateSignature(planState),
  ].join("|");
}

function partialPlanValue(steps) {
  return steps.reduce((total, step) => total + (Number(step?.score) || 0), 0);
}

function createSearch(maxStates) {
  return { maxStates, expanded: 0, pruned: 0, limitHit: false, bestByState: new Map() };
}

function planFeatureKeys(plan) {
  return new Set((plan?.steps ?? []).flatMap((step) => [
    `action:${actionKey(step)}`,
    `category:${candidateCategory(step)}`,
    step?.suggestedTarget?.id ? `target:${step.suggestedTarget.id}` : null,
    step?.destination ? `destination:${step.destination.x},${step.destination.y},${step.destination.elevation ?? ""}` : null,
    step?.routeMode ? `route:${step.routeMode}` : null,
  ].filter(Boolean)));
}

function planSimilarity(left, right) {
  const leftFeatures = planFeatureKeys(left);
  const rightFeatures = planFeatureKeys(right);
  const union = new Set([...leftFeatures, ...rightFeatures]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const feature of leftFeatures) if (rightFeatures.has(feature)) intersection += 1;
  return intersection / union.size;
}

function diversifyPlanOrder(sortedPlans, budget) {
  if (sortedPlans.length < 3) return sortedPlans;
  const ordered = [sortedPlans[0]];
  const remaining = sortedPlans.slice(1, DIVERSITY_LOOKAHEAD);
  const tail = sortedPlans.slice(DIVERSITY_LOOKAHEAD);
  while (remaining.length) {
    const anchor = remaining[0];
    const anchorFull = planUsesFullBudget(anchor, budget);
    const anchorDemoted = anchor.preference?.queueDemoted === true;
    const candidates = remaining
      .slice(0, DIVERSITY_LOOKAHEAD)
      .filter((plan) => planUsesFullBudget(plan, budget) === anchorFull)
      .filter((plan) => (plan.preference?.queueDemoted === true) === anchorDemoted)
      .filter((plan) => Number(anchor.score) - Number(plan.score) <= DIVERSITY_SCORE_WINDOW);
    const pool = candidates.length ? candidates : [anchor];
    const chosen = pool.toSorted((left, right) => {
      const leftSimilarity = Math.max(...ordered.map((plan) => planSimilarity(left, plan)));
      const rightSimilarity = Math.max(...ordered.map((plan) => planSimilarity(right, plan)));
      if (leftSimilarity !== rightSimilarity) return leftSimilarity - rightSimilarity;
      return comparePlanQuality(left, right, budget);
    })[0];
    ordered.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return [...ordered, ...tail];
}

export function buildTurnPlans(context, candidates, { reservedSteps = [], includeCoverage = true } = {}) {
  const budget = turnIntentActionBudget(context?.turnIntent, actionBudget(context));
  const initialPlanState = createPlanState(context, { steps: reservedSteps });
  const resolvedTactic = resolveTacticPersonality(context);
  // selectPlanningCandidates narrows the field to MAX_CANDIDATES (12) before the combinatorial
  // search below runs, for performance — a real actor can easily have 20-40+ legal candidates
  // (cantrips, spell ranks, strikes, item actions, skill actions), and searching all of them in
  // combination would be too expensive. But that means any candidate ranked outside the top 12
  // (and not lucky enough to win a "one per category" diversity slot) never reaches the search at
  // all, so it can never appear in any generated plan or alt-plan cycle slot — keep the full,
  // pre-narrowing list around so the coverage backfill below can still reach it.
  const eligibleCandidates = candidates
    .filter((candidate) => autoFillEligibleCandidate(context, candidate))
    .filter((candidate) => bossAutoFillCandidateAllowed(resolvedTactic, candidate))
    .filter((candidate) => turnIntentCandidateAllowed(context?.turnIntent, candidate))
    .filter((candidate) => Number.isFinite(candidate.actionCost))
    .filter((candidate) => candidate.actionCost >= 0 && candidate.actionCost <= budget.totalActions)
    .filter((candidate) => Number.isFinite(candidate.score))
    .filter((candidate) => candidate.score > HARD_BLOCK_SCORE)
    .toSorted((left, right) => right.score - left.score);
  let sortedCandidates = withLingeringCompositionCandidates(
    withProjectedFollowUpStrikeCandidates(
      withQuickenedCastingDiscountCandidates(selectPlanningCandidates(eligibleCandidates)),
    ),
  );
  const requiredCandidate = requiredTurnIntentCandidate(context?.turnIntent, eligibleCandidates);
  if (requiredCandidate && !sortedCandidates.some((candidate) => actionKey(candidate) === actionKey(requiredCandidate))) {
    sortedCandidates = [requiredCandidate, ...sortedCandidates];
  }

  const plans = [];
  const seenPlans = new Set();
  const initialProjectedContext = projectContextFromPlanState(context, initialPlanState);
  const attackPathAvailable = hasAttackPathAvailable(initialProjectedContext, sortedCandidates);

  const mainSearch = createSearch(MAX_SEARCH_STATES);

  function visit(startIndex, steps, normalCost, quickenedEligibleActions, freeSteps, usedActions, planState, targetPlans = plans, cap = MAX_PLANS, candidatePool = sortedCandidates, search = mainSearch, seen = seenPlans) {
    if (search.expanded >= search.maxStates) {
      search.limitHit = true;
      return;
    }
    search.expanded += 1;
    const stateKey = plannerStateKey({
      startIndex,
      normalCost,
      quickenedEligibleActions,
      freeSteps,
      usedActions,
      planState,
    });
    const stateValue = partialPlanValue(steps);
    const previousStateValue = search.bestByState.get(stateKey);
    if (previousStateValue !== undefined && previousStateValue >= stateValue) {
      search.pruned += 1;
      return;
    }
    search.bestByState.set(stateKey, stateValue);
    const projectedContext = projectContextFromPlanState(context, planState);

    if (
      steps.length
      && turnIntentPlanAllowed(context?.turnIntent, steps)
      && planReloadsAreUseful(steps)
      && planSpellshapesAreUseful(orderPlanSteps(steps))
    ) {
      const key = steps.map(actionKey).join("|");
        if (!seen.has(key)) {
          seen.add(key);
        offerPlan(targetPlans, toPlan(context, [...steps], sortedCandidates, budget, resolvedTactic), cap, budget);
      }
    }

    for (let index = startIndex; index < candidatePool.length; index += 1) {
      const candidate = candidatePool[index];
      const prerequisiteSteps = steps.length || !planState.lastStep ? steps : [planState.lastStep];
      const linkedCandidate = inheritPlannedTarget(projectedContext, candidate, prerequisiteSteps);
      const key = actionKey(candidate);
      const attackAction = isAttackAction(linkedCandidate);
      const strikeAction = isStrikeAction(linkedCandidate);
      const currentUses = usedActions.get(key) ?? 0;
      const repeatableAction = isRepeatablePlanningAction(projectedContext, linkedCandidate, attackPathAvailable);
      if (currentUses > 0 && !repeatableAction) continue;
      if (currentUses >= 3) continue;
      if (strikeAction && planState.strikeCount >= MAX_STRIKE_STEPS) continue;
      if (!projectedFollowUpSatisfied(context, linkedCandidate, steps)) continue;
      if (!previousActionSatisfied(projectedContext, linkedCandidate, prerequisiteSteps)) continue;
      if (!targetConditionSatisfied(projectedContext, linkedCandidate, steps)) continue;
      if (hasPlanConflict(projectedContext, linkedCandidate, steps, attackPathAvailable)) continue;
      const nextPlanState = advancePlanState(context, planState, linkedCandidate);
      if (!nextPlanState.resourceLegal) continue;

      const repeatReloadCost = strikeAction && currentUses > 0 ? reloadCost(linkedCandidate) : 0;
      const candidateActionCost = Number(linkedCandidate.actionCost) + repeatReloadCost;

      let nextNormalCost = normalCost + candidateActionCost;
      const nextQuickenedEligibleActions = quickenedEligibleActions + quickenedCapacity(candidate, repeatReloadCost);
      const quickenedApplied = Math.min(
        budget.quickenedActions,
        nextQuickenedEligibleActions,
        Math.max(0, nextNormalCost - budget.normalActions),
      );
      const nextFreeSteps = freeSteps + (candidateActionCost === 0 ? 1 : 0);
      if (
        nextNormalCost - quickenedApplied > budget.normalActions
        || nextFreeSteps > MAX_FREE_STEPS
      ) {
        continue;
      }

      const penalty = mapPenalty(linkedCandidate, planState.attackCount);
      const projectedVolley = attackAction ? projectedVolleyPenalty(linkedCandidate, steps) : 0;
      const plannedCandidate = attackAction
        ? {
          ...linkedCandidate,
          id: currentUses > 0 ? `${linkedCandidate.id ?? key}-map-${currentUses}` : linkedCandidate.id,
          name: repeatReloadCost > 0 ? `Reload -> ${linkedCandidate.name}` : linkedCandidate.name,
          actionCost: candidateActionCost,
          reloadCost: repeatReloadCost,
          activityProfile: repeatReloadCost > 0
            ? {
              ...(linkedCandidate.activityProfile ?? {}),
              reloadBeforeStrike: true,
              reloadCost: repeatReloadCost,
            }
            : linkedCandidate.activityProfile,
          mapPenalty: penalty,
          attackIndex: planState.attackCount + 1,
          score: linkedCandidate.score - penalty * MAP_SCORE_WEIGHT - projectedVolley,
          reason: [
            repeatReloadCost > 0 ? t("Plan.ReloadsBeforeFiring", "Reloads before firing {name}.", { name: linkedCandidate.name }) : "",
            penalty > 0 ? t("Plan.MapPenalty", "{reason} MAP -{penalty}.", { reason: linkedCandidate.reason ?? "", penalty }).trim() : linkedCandidate.reason,
            projectedVolley > 0 ? t("Plan.VolleyMoved", "Volley -2 when fired from the moved-in position.") : "",
          ].filter(Boolean).join(" "),
        }
        : linkedCandidate;

      usedActions.set(key, currentUses + 1);
      steps.push(plannedCandidate);
      const nextStartIndex = requiresPreviousAction(linkedCandidate) && candidateActionCost === 0
        ? 0
        : repeatableAction ? index : index + 1;
      visit(
        nextStartIndex,
        steps,
        nextNormalCost,
        nextQuickenedEligibleActions,
        nextFreeSteps,
        usedActions,
        nextPlanState,
        targetPlans,
        cap,
        candidatePool,
        search,
        seen,
      );
      steps.pop();
      if (currentUses) usedActions.set(key, currentUses);
      else usedActions.delete(key);
    }
  }

  visit(0, [], 0, 0, 0, new Map(), initialPlanState);

  // Two ways a fully legal candidate can end up in zero generated plans, both silently, no matter
  // how many alt-plan cycle slots exist:
  // 1. It's in sortedCandidates, but the DFS above enumerates combinations in score-sorted order
  //    and stops at MAX_PLANS — a candidate pool near the cap can exhaust MAX_PLANS via
  //    combinations of the top-ranked few before ever trying a lower-ranked one.
  // 2. It never made it into sortedCandidates at all — selectPlanningCandidates narrows to
  //    MAX_CANDIDATES (12) before the DFS runs, and a candidate outside the top 12 only gets in
  //    via a "one per category" diversity slot, which a higher-ranked same-category candidate
  //    (e.g. another spell) can already claim.
  // Run a bounded coverage search with each still-uncovered candidate promoted to the front, so
  // every available action remains reachable in a complete legal turn somewhere in the cycle.
  const coveredKeys = new Set(plans.flatMap((plan) => plan.steps.map(actionKey)));
  function backfillCoverage(pool) {
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const key = actionKey(candidate);
      if (coveredKeys.has(key)) continue;
      // A negative score means the scoring engine has flagged this as actively bad standalone (the
      // canonical case: a bare Stride/Step with nothing to chain into — see CombaterPanel.js's
      // isRedundantAutoFillMove, which strips exactly this shape back out when a plan is applied to
      // the draft). Backfilling it produced a "valid" 1-step plan that immediately reduced to zero
      // steps once applied, showing an empty draft. Only backfill candidates worth showing at all.
      if (Number(candidate.score) < 0) continue;
      const coverageAttempt = [];
      const coveragePool = [candidate, ...pool.filter((entry) => entry !== candidate)];
      const coverageSearch = createSearch(MAX_COVERAGE_SEARCH_STATES);
      visit(
        0,
        [],
        0,
        0,
        0,
        new Map(),
        initialPlanState,
        coverageAttempt,
        MAX_COVERAGE_PLANS,
        coveragePool,
        coverageSearch,
        new Set(),
      );
      const coveragePlan = coverageAttempt
        .filter((plan) => plan.steps.some((step) => actionKey(step) === key))
        .toSorted((left, right) => comparePlanQuality(left, right, budget))[0];
      if (coveragePlan?.steps.some((step) => actionKey(step) === key)) {
        plans.push(coveragePlan);
        coveredKeys.add(key);
      }
    }
  }
  if (includeCoverage) {
    backfillCoverage(sortedCandidates);
    backfillCoverage(eligibleCandidates);
  }

  if (!plans.length) return [emptyPlan(context)];

  const sortedPlans = dedupePlans(plans.toSorted((left, right) => comparePlanQuality(left, right, budget)));
  const diagnostics = {
    eligibleCandidates: eligibleCandidates.length,
    searchedCandidates: sortedCandidates.length,
    statesExpanded: mainSearch.expanded,
    statesPruned: mainSearch.pruned,
    searchLimitHit: mainSearch.limitHit,
    planCap: MAX_PLANS,
  };
  for (const plan of sortedPlans) plan.searchDiagnostics = diagnostics;
  return diversifyPlanOrder(sortedPlans, budget);
}

export function bestTurnPlan(context, candidates) {
  return buildTurnPlans(context, candidates)[0] ?? emptyPlan(context);
}
