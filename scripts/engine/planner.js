import { actionBudget } from "./action/budget.js";
import { slugify as normalizeSlug } from "./action/text.js";
import { combineConfidence } from "./confidence.js";
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
import {
  BASIC_MOVE_SLUGS,
  hasAttackPathAvailable,
  hasPlanConflict,
  includesStand,
  isRepeatablePlanningAction,
} from "./planner/conflicts.js";
import { t } from "../i18n.js";

export { isAttackAction } from "./planner/rules.js";

const MAX_CANDIDATES = 12;
const PRIMARY_CANDIDATES = 8;
const CONDITION_SETUP_CANDIDATES = 4;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const MAP_SCORE_WEIGHT = 3;
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_ALLOWED_SLUGS = new Set(["strike", "stride"]);
const SKILL_ACTION_SLUGS = new Set([
  "demoralize",
  "recall-knowledge",
  "create-a-diversion",
  "feint",
  "trip",
  "grapple",
  "disarm",
  "shove",
  "reposition",
  "tumble-through",
  "seek",
  "sense-motive",
]);
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
  const traits = candidate.traits ?? candidate.weaponTraits ?? candidate.item?.system?.traits?.value ?? [];
  return Array.isArray(traits) && traits.includes("agile");
}

// Where the actor stands after the prior plan steps: a move-and-strike composite's attack square,
// or a committed Stride destination. Null when nothing moved the actor (base score already fits).
// Per-step projected volley penalty: a Volley weapon fired from where a prior move lands the actor
// may be within its volley range even when the unmoved base position was not. Only the penalty the
// base score did NOT already include is added here, so scoring's base-position penalty isn't doubled.
// Matches the granting ability's own wording: "an arcane spontaneous spell." Rank caps ("8th level
// or lower") aren't enforced -- see the design doc for why this is an accepted simplification.
function isItemCandidate(candidate) {
  return candidate?.item?.type === "consumable"
    || candidate?.type === "consumable"
    || Number(candidate?.interactDrawCost) > 0;
}

function candidateCategory(candidate) {
  if (["healing", "defense", "buff", "stealth-defense", "self-healing"].includes(candidate?.role)) return "support";
  if (isStrikeLikeCandidate(candidate)) return "strike";
  if (isSpellAction(candidate)) return "spell";
  if (candidate?.activityProfile?.impulse === true) return "class";
  if (BASIC_MOVE_SLUGS.has(candidate?.slug) || candidate?.role === "mobility") return "movement";
  if (isItemCandidate(candidate)) return "item";
  if (candidate?.skill || SKILL_ACTION_SLUGS.has(candidate?.slug)) return "skill";
  if (["custom-curated", "system-inferred"].includes(candidate?.source)) return "class";
  return "other";
}

function autoFillEligibleCandidate(candidate) {
  const combatUse = String(candidate?.combatUse ?? candidate?.activityProfile?.combatUse ?? "auto").toLowerCase();
  const role = String(candidate?.role ?? "").toLowerCase();
  const utilitySubtype = String(candidate?.activityProfile?.utilitySubtype ?? "").toLowerCase();
  const confidence = String(candidate?.confidence ?? "").toLowerCase();
  if (PLANNER_EXCLUDED_COMBAT_USE.has(combatUse)) return false;
  if (PLANNER_EXCLUDED_UTILITY_ROLES.has(role) || PLANNER_EXCLUDED_UTILITY_ROLES.has(utilitySubtype)) return false;
  if (["utility", "combat-utility"].includes(role) && confidence === "low") return false;
  return true;
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
  return steps.some((step) => isStrikeAction(step) || step.activityProfile?.includesStrike === true);
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
  if (isAttackAction(step)) return 2;
  return 3;
}

function orderPlanSteps(steps) {
  return [...steps].toSorted((left, right) => {
    const leftRequirements = previousActionRequirements(left);
    const rightRequirements = previousActionRequirements(right);
    const leftRequiresRight = leftRequirements.length && stepSatisfiesPreviousRequirements(right, leftRequirements);
    const rightRequiresLeft = rightRequirements.length && stepSatisfiesPreviousRequirements(left, rightRequirements);
    if (leftRequiresRight && !rightRequiresLeft) return 1;
    if (rightRequiresLeft && !leftRequiresRight) return -1;

    const leftProjectedSource = left?.activityProfile?.requiresProjectedAfterKey;
    const rightProjectedSource = right?.activityProfile?.requiresProjectedAfterKey;
    if (leftProjectedSource && actionKey(right) === leftProjectedSource) return 1;
    if (rightProjectedSource && actionKey(left) === rightProjectedSource) return -1;

    const leftTargetConditionRequirements = targetConditionRequirementOptions(left);
    const rightTargetConditionRequirements = targetConditionRequirementOptions(right);
    const leftRequiresRightCondition = leftTargetConditionRequirements.some((group) =>
      stepSatisfiesTargetConditionRequirement(right, group),
    );
    const rightRequiresLeftCondition = rightTargetConditionRequirements.some((group) =>
      stepSatisfiesTargetConditionRequirement(left, group),
    );
    if (leftRequiresRightCondition && !rightRequiresLeftCondition) return 1;
    if (rightRequiresLeftCondition && !leftRequiresRightCondition) return -1;

    const priorityDelta = setupPriority(left, steps) - setupPriority(right, steps);
    if (priorityDelta !== 0) return priorityDelta;
    return steps.indexOf(left) - steps.indexOf(right);
  });
}

export function mapPenalty(candidate, attackIndex) {
  if (!isAttackAction(candidate)) return 0;
  if (attackIndex <= 0) return 0;
  const agile = hasAgileTrait(candidate);
  return attackIndex === 1
    ? (agile ? 4 : 5)
    : (agile ? 8 : 10);
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

function toPlan(context, steps, sortedCandidates, budget) {
  const orderedSteps = orderPlanSteps(steps);
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const targets = context.targets ?? context.battlefield?.targets ?? [];

  return {
    id: orderedSteps.map((step) => step.id).join("+"),
    actor: context.actor,
    target: targets[0] ?? null,
    steps: orderedSteps,
    totalCost,
    actionBudget: budget,
    score: planScore(context, orderedSteps, sortedCandidates, budget),
    confidence: combineConfidence(orderedSteps.map((step) => step.confidence)),
    summary: orderedSteps.map((step) => step.name).join(" -> "),
    reason: orderedSteps[0]?.reason ?? "",
  };
}

function planUsesFullBudget(plan, budget) {
  const hasNegativeStep = (plan?.steps ?? [])
    .some((step) => Number.isFinite(step?.score) && step.score < 0);
  return !hasNegativeStep && Number(plan?.totalCost) >= Number(budget?.totalActions);
}

export function buildTurnPlans(context, candidates) {
  const budget = actionBudget(context);
  // selectPlanningCandidates narrows the field to MAX_CANDIDATES (12) before the combinatorial
  // search below runs, for performance — a real actor can easily have 20-40+ legal candidates
  // (cantrips, spell ranks, strikes, item actions, skill actions), and searching all of them in
  // combination would be too expensive. But that means any candidate ranked outside the top 12
  // (and not lucky enough to win a "one per category" diversity slot) never reaches the search at
  // all, so it can never appear in any generated plan or alt-plan cycle slot — keep the full,
  // pre-narrowing list around so the coverage backfill below can still reach it.
  const eligibleCandidates = candidates
    .filter(autoFillEligibleCandidate)
    .filter((candidate) => Number.isFinite(candidate.actionCost))
    .filter((candidate) => candidate.actionCost >= 0 && candidate.actionCost <= budget.totalActions)
    .filter((candidate) => Number.isFinite(candidate.score))
    .toSorted((left, right) => right.score - left.score);
  const sortedCandidates = withLingeringCompositionCandidates(
    withProjectedFollowUpStrikeCandidates(
      withQuickenedCastingDiscountCandidates(selectPlanningCandidates(eligibleCandidates)),
    ),
  );

  const plans = [];
  const seenPlans = new Set();
  const attackPathAvailable = hasAttackPathAvailable(context, sortedCandidates);

  function visit(startIndex, steps, normalCost, quickenedEligibleActions, freeSteps, attackCount, strikeCount, usedActions, targetPlans = plans, cap = MAX_PLANS, candidatePool = sortedCandidates) {
    if (targetPlans.length >= cap) return;

    if (steps.length) {
      const key = steps.map(actionKey).join("|");
      if (!seenPlans.has(key)) {
        seenPlans.add(key);
        targetPlans.push(toPlan(context, [...steps], sortedCandidates, budget));
      }
    }

    for (let index = startIndex; index < candidatePool.length; index += 1) {
      const candidate = candidatePool[index];
      const linkedCandidate = inheritPlannedTarget(context, candidate, steps);
      const key = actionKey(candidate);
      const attackAction = isAttackAction(linkedCandidate);
      const strikeAction = isStrikeAction(linkedCandidate);
      const currentUses = usedActions.get(key) ?? 0;
      const repeatableAction = isRepeatablePlanningAction(context, linkedCandidate, attackPathAvailable);
      if (currentUses > 0 && !repeatableAction) continue;
      if (currentUses >= 3) continue;
      if (strikeAction && strikeCount >= MAX_STRIKE_STEPS) continue;
      if (!projectedFollowUpSatisfied(context, linkedCandidate, steps)) continue;
      if (!previousActionSatisfied(context, linkedCandidate, steps)) continue;
      if (!targetConditionSatisfied(context, linkedCandidate, steps)) continue;
      if (hasPlanConflict(context, linkedCandidate, steps, attackPathAvailable)) continue;

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

      const penalty = mapPenalty(linkedCandidate, attackCount);
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
          attackIndex: attackCount + 1,
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
        attackAction ? attackCount + attacksTowardMap(candidate) : attackCount,
        strikeAction ? strikeCount + 1 : strikeCount,
        usedActions,
        targetPlans,
        cap,
        candidatePool,
      );
      steps.pop();
      if (currentUses) usedActions.set(key, currentUses);
      else usedActions.delete(key);
    }
  }

  visit(0, [], 0, 0, 0, 0, 0, new Map());

  // Two ways a fully legal candidate can end up in zero generated plans, both silently, no matter
  // how many alt-plan cycle slots exist:
  // 1. It's in sortedCandidates, but the DFS above enumerates combinations in score-sorted order
  //    and stops at MAX_PLANS — a candidate pool near the cap can exhaust MAX_PLANS via
  //    combinations of the top-ranked few before ever trying a lower-ranked one.
  // 2. It never made it into sortedCandidates at all — selectPlanningCandidates narrows to
  //    MAX_CANDIDATES (12) before the DFS runs, and a candidate outside the top 12 only gets in
  //    via a "one per category" diversity slot, which a higher-ranked same-category candidate
  //    (e.g. another spell) can already claim.
  // Backfill a minimal single-step plan for each still-uncovered candidate from each pool so every
  // currently available action is reachable somewhere in the cycle.
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
      visit(index, [], 0, 0, 0, 0, 0, new Map(), coverageAttempt, 1, pool);
      const coveragePlan = coverageAttempt[0];
      if (coveragePlan?.steps.some((step) => actionKey(step) === key)) {
        plans.push(coveragePlan);
        coveredKeys.add(key);
      }
    }
  }
  backfillCoverage(sortedCandidates);
  backfillCoverage(eligibleCandidates);

  if (!plans.length) return [emptyPlan(context)];

  return plans.toSorted((left, right) => {
    const leftFull = planUsesFullBudget(left, budget);
    const rightFull = planUsesFullBudget(right, budget);
    if (leftFull !== rightFull) return rightFull ? 1 : -1;
    if (right.score !== left.score) return right.score - left.score;
    return right.totalCost - left.totalCost;
  });
}

export function bestTurnPlan(context, candidates) {
  return buildTurnPlans(context, candidates)[0] ?? emptyPlan(context);
}
