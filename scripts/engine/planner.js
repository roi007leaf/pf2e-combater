import { actionBudget, quickenedEligible } from "./action/budget.js";
import { slugify as normalizeSlug } from "./action/text.js";
import { combineConfidence } from "./confidence.js";
import { normalizedActionFacts } from "./action/facts.js";
import { scoredAreaPlacement } from "./scoring/area.js";
import { attackableEnemies } from "./scoring/targets.js";
import { maxRange } from "./scoring/facts.js";
import {
  actionKey,
  currentAttackRange,
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
  targetForCandidate,
  targetHasCondition,
  targetIdentity,
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
import { createPlanRescorer } from "./planner/rescoring.js";
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
import { contextAllies, contextEnemies, contextTargets } from "./target-pool.js";
import { t } from "../i18n.js";
import { contextActorDocument } from "./actor-context.js";
import { readMovementAvailability } from "../readers/generic-action-reader.js";
import { actionReloadCost, npcWeaponNeedsReloadAfterSteps } from "./npc-reload-state.js";
import {
  boundedPlanPreferenceDelta,
  deterministicPlanPreferenceAdjustment,
} from "../state/preference-profile.js";
import { HARD_BLOCK_SCORE, MAP_PENALTY_BY_ATTACK_INDEX, mapScoreCost } from "./scoring/weights.js";
import {
  resolveTacticPersonality,
  tacticPersonalityAdjustment,
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
const ORPHAN_SETUP_PENALTY = 20;
const MAX_APPROACH_CANDIDATES = 3;
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
  if (candidate?.autoFillEligible === false) return false;
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
  return actionReloadCost(candidate);
}

function hasOffensiveFollowUp(steps) {
  return steps.some((step) => isAttackAction(step) || normalizedActionFacts(step).resolution.offensive);
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

function planAttackRollSetupsAreUseful(steps) {
  return steps.every((step, index) => {
    const facts = normalizedActionFacts(step);
    const requiresAttackRoll = step?.activityProfile?.nextAttackRollBuff === true
      || ["sure-strike", "true-strike"].includes(facts.identity.slug);
    if (!requiresAttackRoll) return true;
    return steps.slice(index + 1).some((followUp) =>
      normalizedActionFacts(followUp).resolution.type === "attack",
    );
  });
}

function planAreasHitEnemies(context, steps, reservedSteps, cache) {
  return steps.every((step, index) => {
    const facts = normalizedActionFacts(step);
    if (!facts.targeting.area || !facts.resolution.offensive) return true;
    const origin = projectContextFromPlanState(context, createPlanState(context, {
      steps: [...reservedSteps, ...steps.slice(0, index)],
    }));
    const enemies = attackableEnemies(origin);
    // Positionless contexts cannot resolve geometry; live canvas contexts can.
    if (!origin.token?.center || !enemies.every((enemy) => enemy.center ?? enemy.token?.center)) return true;
    const key = JSON.stringify([actionKey(step), origin.token.center, facts.targeting.areaType,
      step.targetingProfile?.distance, maxRange(step), enemies.map((enemy) => [enemy.id, enemy.center ?? enemy.token?.center])]);
    if (!cache.has(key)) {
      cache.set(key, scoredAreaPlacement(step, origin, {
        enemyValues: enemies, allyValues: contextAllies(origin), maxCastRange: maxRange(step),
      }).enemies.length > 0);
    }
    return cache.get(key);
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
  if (step?.slug === "escape") return -3;
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
  // Hunted Shot / Flurry of Blows: each of its Strikes takes and advances MAP on its own.
  if (candidate.activityProfile?.mapAppliesPerStrike === true) {
    return Math.max(1, (candidate.activityProfile?.includes ?? []).filter((atom) => atom === "strike").length);
  }
  return 1;
}

function quickenedCapacity(candidate, repeatReloadCost = 0, context = {}) {
  if (quickenedEligible(candidate, candidate.actionCost, context)) return 1;
  // Haste's extra Stride/Strike can pay for one atom of a Stride -> Strike composite.
  const atoms = candidate?.activityProfile?.includes ?? [];
  if (Number(candidate?.actionCost) >= 2 && atoms.some((atom) => quickenedEligible({ slug: atom }, 1, context))) return 1;
  if (repeatReloadCost > 0 && isStrikeAction(candidate) && quickenedEligible({ slug: "strike" }, 1, context)) return 1;
  return 0;
}

export { mapScoreCost };

// MAP a step pays when its first attack lands at attackCount. A per-Strike multiattack (Hunted Shot)
// was scored with its own Strikes at MAP 0 and -5; starting later pushes every one of them down a tier,
// so it pays the difference per Strike rather than once for the whole step.
export function stepMapScoreCost(candidate, score, attackCount) {
  const strikes = candidate?.activityProfile?.mapAppliesPerStrike === true ? attacksTowardMap(candidate) : 1;
  if (strikes <= 1) return mapScoreCost({ score }, mapPenalty(candidate, attackCount));
  const each = { score: score / strikes };
  let cost = 0;
  for (let index = 0; index < strikes; index += 1) {
    cost += mapScoreCost(each, mapPenalty(candidate, attackCount + index)) - mapScoreCost(each, mapPenalty(candidate, index));
  }
  return cost;
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]));
}

function withMapAt(step, penalty, attackIndex) {
  const base = step.mapBase;
  return {
    ...step,
    mapPenalty: penalty,
    attackIndex,
    score: base.score - stepMapScoreCost(step, base.score, attackIndex - 1),
    reason: [
      base.reload,
      penalty > 0 ? t("Plan.MapPenalty", "{reason} MAP -{penalty}.", { reason: base.reason, penalty }).trim() : base.reason,
      base.volley,
    ].filter(Boolean).join(" "),
  };
}

// The search charges MAP in the order it happened to pick attacks, and orderPlanSteps reorders steps
// afterwards. Re-deal the plan's Strikes into the order that loses least to MAP (the big hit first,
// the agile one last), then recompute each attack's penalty from its final position.
// A standing multi-Strike (Hunted Shot) re-deals like a Strike; anything that moves stays put.
function isRedealableAttack(step) {
  if (isStrikeAction(step)) return true;
  return step?.activityProfile?.mapAppliesPerStrike === true && !(Number(step.activityProfile.strideCount) > 0);
}

export function rebalancePlanMap(steps) {
  const strikeSlots = steps.flatMap((step, index) => (step?.mapBase && isRedealableAttack(step) ? [index] : []));
  const attacks = steps.filter((step) => step?.mapBase);
  if (strikeSlots.length < 2 || strikeSlots.length > 4) return steps;
  const start = Math.min(...attacks.map((step) => (Number(step.attackIndex) || 1) - 1));
  const strikes = strikeSlots.map((index) => steps[index]);
  const deal = (order) => {
    const next = [...steps];
    strikeSlots.forEach((slot, position) => { next[slot] = order[position]; });
    let attackCount = start;
    let cost = 0;
    const dealt = next.map((step) => {
      if (!step?.mapBase) return step;
      const penalty = mapPenalty(step, attackCount);
      const placed = withMapAt(step, penalty, attackCount + 1);
      cost += stepMapScoreCost(step, step.mapBase.score, attackCount);
      attackCount += attacksTowardMap(step);
      return placed;
    });
    return { dealt, cost };
  };
  let best = deal(strikes);
  for (const order of permutations(strikes)) {
    const dependencyBroken = order.some((step, index) => order.slice(index + 1).some((later) => stepDependsOnStep(step, later)));
    if (dependencyBroken) continue;
    const candidate = deal(order);
    if (candidate.cost < best.cost) best = candidate;
  }
  return best.dealt;
}

function isMovementStep(step) {
  return isPlainMovement(step) || Number(step?.activityProfile?.strideCount) > 0;
}

function strikeWeaponKey(action) {
  const item = action?.item ?? action?.strike?.item;
  return item?.id ?? item?.uuid ?? null;
}

// Out-of-range actions the planner may use once an earlier step closes the distance. A weapon that
// already has a move-and-strike composite is left to the composite (it carries a checked attack
// square); the rest are capped so they can't crowd the search.
function approachPool(approachCandidates, eligibleCandidates, context, budget, searchPool) {
  // Nothing can close the distance without a plain move in the search.
  if (!searchPool.some(isPlainMovement)) return [];
  const compositeWeapons = new Set(eligibleCandidates
    .filter((candidate) => candidate?.activityProfile?.includesStrike && Number(candidate?.activityProfile?.strideCount) > 0)
    .map(strikeWeaponKey).filter(Boolean));
  return (approachCandidates ?? [])
    .filter((candidate) => candidate?.needsApproach)
    .filter((candidate) => !compositeWeapons.has(strikeWeaponKey(candidate)))
    .filter((candidate) => autoFillEligibleCandidate(context, candidate))
    .filter((candidate) => turnIntentCandidateAllowed(context?.turnIntent, candidate))
    .filter((candidate) => Number.isFinite(candidate.actionCost) && candidate.actionCost >= 0 && candidate.actionCost < budget.totalActions)
    .toSorted((left, right) => Number(right.source === "strike") - Number(left.source === "strike")
      || (Number(right.score) || 0) - (Number(left.score) || 0))
    .slice(0, MAX_APPROACH_CANDIDATES);
}

function approachReaches(context, candidate) {
  const target = targetForCandidate(context, candidate);
  const range = currentAttackRange(candidate) ?? 5;
  return Number(target?.distance ?? Infinity) <= range;
}

function isAttackPayoff(step) {
  return isAttackAction(step) || step?.activityProfile?.includesStrike === true;
}

function isPlainMovement(step) {
  if (step?.activityProfile?.includesStrike === true) return false;
  return /(?:^|-)(?:stride|step)$/.test(normalizeSlug(step?.slug ?? step?.id));
}

function isAttackSetup(step) {
  return /(?:^|-)(?:feint|create-a-diversion)$/.test(normalizeSlug(step?.slug ?? step?.id));
}

// Setup steps that nothing in the plan pays off: a Diversion or Feint with no attack after it, or a
// plain Stride/Step followed by non-attack filler while an attack was on offer. These score on their
// own ("closes distance", "creates an opening") but waste the action in that plan.
export function orphanSetupSteps(steps, candidates = []) {
  const attackOnOffer = candidates.some((candidate) =>
    candidate?.available !== false && Number(candidate?.score) > 0 && isAttackPayoff(candidate));
  return steps.filter((step, index) => {
    const later = steps.slice(index + 1);
    if (later.some(isAttackPayoff)) return false;
    if (isAttackSetup(step)) return true;
    return attackOnOffer && isPlainMovement(step) && later.some((next) => !isPlainMovement(next));
  });
}

const candidateRankCache = new WeakMap();

// Rank by actionKey, not identity: MAP'd attack copies are new objects and must pay their
// candidate's rank like any other step.
function candidateRank(sortedCandidates, step) {
  let ranks = candidateRankCache.get(sortedCandidates);
  if (!ranks) {
    ranks = new Map();
    sortedCandidates.forEach((candidate, index) => {
      const key = actionKey(candidate);
      if (!ranks.has(key)) ranks.set(key, index);
    });
    candidateRankCache.set(sortedCandidates, ranks);
  }
  return ranks.get(actionKey(step)) ?? 0;
}

export function planScore(context, steps, sortedCandidates, budget) {
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const stepScore = steps.reduce((total, step) => total + step.score - candidateRank(sortedCandidates, step), 0);

  return stepScore
    + targetConditionChainBonus(context, steps)
    - orphanSetupSteps(steps, sortedCandidates).length * ORPHAN_SETUP_PENALTY
    - (budget.totalActions - totalCost) * UNUSED_ACTION_PENALTY;
}

function toPlan(context, steps, sortedCandidates, budget, resolvedTactic = null, simulation = null) {
  const executionOrder = applyTurnIntentToPlan(context?.turnIntent, orderPlanSteps(steps));
  const simulated = simulation ? simulation.rescorer.simulate(context, simulation.initialState, executionOrder) : executionOrder;
  const orderedSteps = rebalancePlanMap(simulated);
  const evaluation = evaluatePlan(context, orderedSteps);
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const targets = context.targets ?? context.battlefield?.targets ?? [];
  const tacticalScore = planScore(context, orderedSteps, sortedCandidates, budget);
  const tacticPlanAdjustment = tacticPersonalityPlanAdjustment(context, orderedSteps, resolvedTactic, sortedCandidates);
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
    orphanSetups: orphanSetupSteps(orderedSteps, sortedCandidates).length,
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

function withProjectedConditionalBonuses(context, candidate) {
  const bonuses = candidate.activityProfile?.conditionalBonuses ?? [];
  if (!bonuses.length) return candidate;
  const reference = targetForCandidate(context, candidate);
  const ids = new Set([
    reference?.id, reference?.uuid, reference?.actor?.id, reference?.actor?.uuid,
    reference?.token?.id, reference?.token?.uuid,
  ].filter(Boolean).map(String));
  const entities = [...contextTargets(context), ...contextEnemies(context)];
  const target = entities.find((entity) => targetIdentity(entity).some((alias) => ids.has(alias)))
    ?? (!ids.size ? entities.find((entity) => entity.name === reference?.name) : null)
    ?? reference;
  const spent = bonuses.filter((bonus) => targetHasCondition(target, bonus.condition));
  if (!spent.length) return candidate;
  const spentConditions = new Set(spent.map((bonus) => bonus.condition));
  const profile = candidate.activityProfile ?? {};
  const projectedCandidate = {
    ...candidate,
    activityProfile: {
      ...profile,
      ...(Array.isArray(profile.appliesConditions)
        ? { appliesConditions: profile.appliesConditions.filter((condition) => !spentConditions.has(condition)) }
        : {}),
      ...(spentConditions.has(profile.appliesCondition) ? { appliesCondition: null } : {}),
    },
  };
  const role = candidate.curated?.role ?? candidate.role;
  const originalTactic = tacticPersonalityAdjustment(context, candidate, { role });
  const projectedTactic = tacticPersonalityAdjustment(context, projectedCandidate, { role });
  const spentReasons = new Set(spent.map((bonus) => bonus.reason));
  if (originalTactic.scoreDelta !== projectedTactic.scoreDelta) {
    for (const reason of originalTactic.reasons) spentReasons.add(reason);
  }
  const reasons = (candidate.reasons ?? []).filter((reason) => !spentReasons.has(reason));
  if (originalTactic.scoreDelta !== projectedTactic.scoreDelta) {
    reasons.push(...projectedTactic.reasons);
  }
  return {
    ...projectedCandidate,
    score: candidate.score - spent.reduce((total, bonus) => total + bonus.score, 0)
      - (originalTactic.scoreDelta - projectedTactic.scoreDelta),
    reasons,
    reason: reasons[0] ?? candidate.reason,
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
  return !hasNegativeStep && !(plan?.orphanSetups > 0) && Number(plan?.totalCost) >= Number(budget?.totalActions);
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

export function buildTurnPlans(context, candidates, { reservedSteps = [], includeCoverage = true, includePendingQuickened = true, approachCandidates = [] } = {}) {
  if (includePendingQuickened && context?.actionTracker?.quickenedPending
    && context.actionTracker.nextTurnPool?.quickenedActions > 0 && context.quickenedAllowed?.length) {
    // A future recommendation is separate from this turn's search: it cannot buy a
    // fourth action now, satisfy a prerequisite, reserve a resource, or increase MAP.
    const currentPlans = buildTurnPlans(context, candidates, { reservedSteps, includeCoverage, includePendingQuickened: false, approachCandidates });
    const futureContext = {
      ...context,
      turnActionPool: { ...context.actionTracker.nextTurnPool, normalActions: 0, quickenedActions: 1, totalActions: 1 },
      actionsSpent: { normal: 0, quickened: 0, total: 0 },
      turnIntent: null,
    };
    const allowed = candidates.filter((action) => quickenedEligible(action, action.actionCost, context));
    const recommendation = buildTurnPlans(futureContext, allowed, { includeCoverage: false, includePendingQuickened: false })
      .find((plan) => plan.steps.length === 1)?.steps[0];
    if (!recommendation) return currentPlans;
    return currentPlans.map((plan) => ({
      ...plan,
      steps: [...plan.steps, { ...recommendation, quickenedNextTurn: true }],
      nextTurnCost: 1,
    }));
  }
  const budget = turnIntentActionBudget(context?.turnIntent, actionBudget(context));
  const planningActor = contextActorDocument(context, { allowActorFallback: true });
  const initialPlanState = createPlanState(context, { steps: reservedSteps });
  const initialProjectedContext = projectContextFromPlanState(context, initialPlanState);
  const requiresEscape = entityHasAnyCondition(initialProjectedContext.profile ?? initialProjectedContext.actor?.profile, ["restrained"]);
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
  // Escape must survive candidate narrowing and lead the search while Restrained.
  const requiredEscape = requiresEscape ? eligibleCandidates.find((candidate) => candidate.slug === "escape") : null;
  if (requiredEscape) {
    sortedCandidates = [requiredEscape, ...sortedCandidates.filter((candidate) => actionKey(candidate) !== actionKey(requiredEscape))];
  }
  const requiredCandidate = requiredTurnIntentCandidate(context?.turnIntent, eligibleCandidates);
  if (requiredCandidate && !sortedCandidates.some((candidate) => actionKey(candidate) === actionKey(requiredCandidate))) {
    sortedCandidates = [requiredCandidate, ...sortedCandidates];
  }

  sortedCandidates = [...sortedCandidates, ...approachPool(approachCandidates, eligibleCandidates, context, budget, sortedCandidates)];
  const rescorer = createPlanRescorer(context, initialPlanState);
  const rescore = rescorer.rescore;
  const simulation = { rescorer, initialState: initialPlanState };

  const plans = [];
  const areaHitCache = new Map();
  const seenPlans = new Set();
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
      && planAttackRollSetupsAreUseful(orderPlanSteps(steps))
      && planAreasHitEnemies(context, orderPlanSteps(steps), reservedSteps, areaHitCache)
    ) {
      const key = steps.map(actionKey).join("|");
        if (!seen.has(key)) {
          seen.add(key);
        offerPlan(targetPlans, toPlan(context, [...steps], sortedCandidates, budget, resolvedTactic, simulation), cap, budget);
      }
    }

    for (let index = startIndex; index < candidatePool.length; index += 1) {
      const candidate = candidatePool[index];
      const prerequisiteSteps = steps.length || !planState.lastStep ? steps : [planState.lastStep];
      // An approach candidate is only legal once an earlier move has brought its target in range;
      // check that cheaply before paying for a re-score.
      const mover = candidate.needsApproach ? steps.findLast(isMovementStep) : null;
      if (candidate.needsApproach && (!mover || !approachReaches(projectedContext, candidate))) continue;
      const inherited = inheritPlannedTarget(projectedContext, candidate, prerequisiteSteps);
      // Re-score against the board the earlier steps leave behind; the re-score already accounts
      // for conditions those steps applied, so the conditional-bonus adjustment is for the rest.
      const rescored = rescore(projectedContext, planState, inherited);
      if (!rescored) continue;
      let linkedCandidate = rescored === inherited ? withProjectedConditionalBonuses(projectedContext, inherited) : rescored;
      if (candidate.needsApproach) {
        if (!approachReaches(projectedContext, linkedCandidate)) continue;
        linkedCandidate = {
          ...linkedCandidate,
          activityProfile: { ...(linkedCandidate.activityProfile ?? {}), requiresProjectedAfterKey: actionKey(mover) },
        };
      }
      if (entityHasAnyCondition(projectedContext.profile ?? projectedContext.actor?.profile, ["restrained"]) && linkedCandidate.slug !== "escape") continue;
      if (!readMovementAvailability(projectedContext, linkedCandidate).available) continue;
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

      const npcReloadRequired = strikeAction && npcWeaponNeedsReloadAfterSteps(
        planningActor,
        linkedCandidate,
        [...reservedSteps, ...steps],
      );
      const repeatReloadCost = strikeAction && (currentUses > 0 || npcReloadRequired) ? reloadCost(linkedCandidate) : 0;
      const candidateActionCost = Number(linkedCandidate.actionCost) + repeatReloadCost;

      let nextNormalCost = normalCost + candidateActionCost;
      const nextQuickenedEligibleActions = quickenedEligibleActions + quickenedCapacity(candidate, repeatReloadCost, context);
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
          mapBase: {
            score: linkedCandidate.score - projectedVolley,
            reason: linkedCandidate.reason ?? "",
            reload: repeatReloadCost > 0 ? t("Plan.ReloadsBeforeFiring", "Reloads before firing {name}.", { name: linkedCandidate.name }) : "",
            volley: projectedVolley > 0 ? t("Plan.VolleyMoved", "Volley -2 when fired from the moved-in position.") : "",
          },
          score: linkedCandidate.score - stepMapScoreCost(linkedCandidate, linkedCandidate.score, planState.attackCount) - projectedVolley,
          reason: [
            repeatReloadCost > 0 ? t("Plan.ReloadsBeforeFiring", "Reloads before firing {name}.", { name: linkedCandidate.name }) : "",
            penalty > 0 ? t("Plan.MapPenalty", "{reason} MAP -{penalty}.", { reason: linkedCandidate.reason ?? "", penalty }).trim() : linkedCandidate.reason,
            projectedVolley > 0 ? t("Plan.VolleyMoved", "Volley -2 when fired from the moved-in position.") : "",
          ].filter(Boolean).join(" "),
        }
        : linkedCandidate;

      usedActions.set(key, currentUses + 1);
      steps.push(plannedCandidate);
      const nextStartIndex = linkedCandidate.slug === "escape" || (requiresPreviousAction(linkedCandidate) && candidateActionCost === 0)
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
