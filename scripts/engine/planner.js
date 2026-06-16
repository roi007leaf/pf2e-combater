import { combineConfidence } from "./confidence.js";

const BASE_ACTIONS = 3;
const MAX_CANDIDATES = 12;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const MAP_SCORE_WEIGHT = 3;
const QUICKENED_ALLOWED_SLUGS = new Set(["strike", "stride", "step"]);
const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const BASIC_MOVE_SLUGS = new Set(["step", "stride"]);
const AC_SETUP_CONDITIONS = new Set(["off-guard", "frightened", "clumsy", "sickened", "prone", "grabbed", "restrained"]);
const AC_PENALTY_FIELDS = [
  "acPenalty",
  "armorClassPenalty",
  "defensePenalty",
  "targetAcPenalty",
  "targetDefensePenalty",
];

function emptyPlan(context) {
  return {
    id: "empty",
    actor: context.actor,
    target: null,
    steps: [],
    totalCost: 0,
    score: 0,
    confidence: combineConfidence([]),
    summary: "No recommendation",
    reason: "No usable combat actions were detected.",
  };
}

function conditionValue(conditions, slug) {
  if (!conditions) return 0;
  const slugs = Array.isArray(conditions.slugs) ? conditions.slugs : [];
  if (!slugs.includes(slug)) return 0;

  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function actionBudget(context) {
  const conditions = context?.profile?.conditions;
  const slowed = conditionValue(conditions, "slowed");
  const stunned = conditionValue(conditions, "stunned");
  const quickened = conditionValue(conditions, "quickened");
  const normalActions = Math.max(0, BASE_ACTIONS - slowed - stunned);

  return {
    normalActions,
    quickenedActions: quickened > 0 ? 1 : 0,
    totalActions: normalActions + (quickened > 0 ? 1 : 0),
    slowed,
    stunned,
    quickened,
  };
}

function actionKey(candidate) {
  return candidate.id ?? candidate.slug ?? candidate.name;
}

function hasAgileTrait(candidate) {
  const traits = candidate.traits ?? candidate.weaponTraits ?? candidate.item?.system?.traits?.value ?? [];
  return Array.isArray(traits) && traits.includes("agile");
}

function isAttackAction(candidate) {
  return candidate.source === "strike"
    || candidate.activityProfile?.includesStrike === true
    || candidate.attackTrait === true
    || candidate.attack === true
    || GENERIC_ATTACK_SLUGS.has(candidate.slug)
    || (Array.isArray(candidate.traits) && candidate.traits.includes("attack"));
}

function isStrikeAction(candidate) {
  return candidate.source === "strike";
}

function hasOffensiveFollowUp(steps) {
  return steps.some((step) => isAttackAction(step));
}

function hasStrikeFollowUp(steps) {
  return steps.some((step) => isStrikeAction(step) || step.activityProfile?.includesStrike === true);
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
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

function setupPriority(step, allSteps) {
  if (
    BASIC_MOVE_SLUGS.has(step?.slug)
    && (hasOffensiveFollowUp(allSteps) || allSteps.some((other) => isOffensiveSetup(other)))
  ) {
    return -1;
  }

  const setupFor = Array.isArray(step?.setupFor) ? step.setupFor : [];
  if (setupFor.length) {
    const supportsPlannedStep = allSteps.some((candidate) =>
      setupFor.includes(candidate?.slug) || setupFor.includes(candidate?.role),
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
    const priorityDelta = setupPriority(left, steps) - setupPriority(right, steps);
    if (priorityDelta !== 0) return priorityDelta;
    return steps.indexOf(left) - steps.indexOf(right);
  });
}

function isRepeatableAttackAction(candidate) {
  return candidate.source === "strike";
}

function mapPenalty(candidate, attackIndex) {
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
function attacksTowardMap(candidate) {
  if (!isAttackAction(candidate)) return 0;
  const value = candidate.activityProfile?.mapAttacks;
  if (value === "variable") return 3;
  if (Number.isFinite(value)) return Math.max(0, value);
  return 1;
}

function canUseQuickened(candidate) {
  return candidate.actionCost === 1 && QUICKENED_ALLOWED_SLUGS.has(candidate.slug);
}

function allowsPostChargeTumbleThrough(context) {
  const battlefield = context?.battlefield ?? {};
  return Boolean(context?.postChargeTumbleThrough || battlefield.postChargeTumbleThrough);
}

function isMoveAndStrike(step) {
  return step?.activityProfile?.includesStrike === true
    && Number(step?.activityProfile?.strideCount) > 0;
}

function hasPlanConflict(context, candidate, steps) {
  if (BASIC_MOVE_SLUGS.has(candidate.slug) && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug))) {
    return true;
  }

  // A self-moving activity (Stride -> Strike, Sudden Charge, pounce) already closes
  // distance, so prepending a plain Step/Stride is wasted movement.
  const basicMove = BASIC_MOVE_SLUGS.has(candidate.slug);
  const moveStrike = isMoveAndStrike(candidate);
  if (
    (basicMove && steps.some(isMoveAndStrike))
    || (moveStrike && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug)))
  ) {
    return true;
  }

  const hasSuddenCharge = steps.some((step) => step.slug === "sudden-charge");
  const hasTumbleThrough = steps.some((step) => step.slug === "tumble-through");
  const pairingChargeAndTumble = (candidate.slug === "tumble-through" && hasSuddenCharge)
    || (candidate.slug === "sudden-charge" && hasTumbleThrough);
  return pairingChargeAndTumble && !allowsPostChargeTumbleThrough(context);
}

function planScore(steps, sortedCandidates, budget) {
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const stepScore = steps.reduce((total, step) => {
    const indexPenalty = sortedCandidates.indexOf(step);
    return total + step.score - Math.max(indexPenalty, 0);
  }, 0);

  return stepScore - (budget.totalActions - totalCost) * UNUSED_ACTION_PENALTY;
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
    score: planScore(orderedSteps, sortedCandidates, budget),
    confidence: combineConfidence(orderedSteps.map((step) => step.confidence)),
    summary: orderedSteps.map((step) => step.name).join(" -> "),
    reason: orderedSteps[0]?.reason ?? "",
  };
}

export function buildTurnPlans(context, candidates) {
  const budget = actionBudget(context);
  const sortedCandidates = candidates
    .filter((candidate) => Number.isFinite(candidate.actionCost))
    .filter((candidate) => candidate.actionCost >= 0 && candidate.actionCost <= budget.totalActions)
    .filter((candidate) => Number.isFinite(candidate.score))
    .toSorted((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES);

  const plans = [];
  const seenPlans = new Set();

  function visit(startIndex, steps, normalCost, quickenedCost, freeSteps, attackCount, strikeCount, usedActions) {
    if (plans.length >= MAX_PLANS) return;

    if (steps.length) {
      const key = steps.map(actionKey).join("|");
      if (!seenPlans.has(key)) {
        seenPlans.add(key);
        plans.push(toPlan(context, [...steps], sortedCandidates, budget));
      }
    }

    for (let index = startIndex; index < sortedCandidates.length; index += 1) {
      const candidate = sortedCandidates[index];
      const key = actionKey(candidate);
      const attackAction = isAttackAction(candidate);
      const strikeAction = isStrikeAction(candidate);
      const currentUses = usedActions.get(key) ?? 0;
      if (currentUses > 0 && !isRepeatableAttackAction(candidate)) continue;
      if (currentUses >= 3) continue;
      if (strikeAction && strikeCount >= MAX_STRIKE_STEPS) continue;
      if (hasPlanConflict(context, candidate, steps)) continue;

      let nextNormalCost = normalCost + candidate.actionCost;
      let nextQuickenedCost = quickenedCost;
      if (nextNormalCost > budget.normalActions && canUseQuickened(candidate)) {
        nextNormalCost = normalCost;
        nextQuickenedCost += 1;
      }
      const nextFreeSteps = freeSteps + (candidate.actionCost === 0 ? 1 : 0);
      if (
        nextNormalCost > budget.normalActions
        || nextQuickenedCost > budget.quickenedActions
        || nextFreeSteps > MAX_FREE_STEPS
      ) {
        continue;
      }

      const penalty = mapPenalty(candidate, attackCount);
      const plannedCandidate = attackAction
        ? {
          ...candidate,
          id: currentUses > 0 ? `${candidate.id ?? key}-map-${currentUses}` : candidate.id,
          mapPenalty: penalty,
          attackIndex: attackCount + 1,
          score: candidate.score - penalty * MAP_SCORE_WEIGHT,
          reason: penalty > 0 ? `${candidate.reason ?? ""} MAP -${penalty}.`.trim() : candidate.reason,
        }
        : candidate;

      usedActions.set(key, currentUses + 1);
      steps.push(plannedCandidate);
      visit(
        attackAction ? index : index + 1,
        steps,
        nextNormalCost,
        nextQuickenedCost,
        nextFreeSteps,
        attackAction ? attackCount + attacksTowardMap(candidate) : attackCount,
        strikeAction ? strikeCount + 1 : strikeCount,
        usedActions,
      );
      steps.pop();
      if (currentUses) usedActions.set(key, currentUses);
      else usedActions.delete(key);
    }
  }

  visit(0, [], 0, 0, 0, 0, 0, new Map());

  if (!plans.length) return [emptyPlan(context)];

  return plans.toSorted((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.totalCost - left.totalCost;
  });
}

export function bestTurnPlan(context, candidates) {
  return buildTurnPlans(context, candidates)[0] ?? emptyPlan(context);
}
