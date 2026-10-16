import { actionBudget, quickenedEligible } from "./action/budget.js";
import { slugify as normalizeSlug } from "./action/text.js";
import { combineConfidence } from "./confidence.js";
import { normalizedActionFacts } from "./action/facts.js";
import { scoredAreaPlacement } from "./scoring/area.js";
import { attackableEnemies } from "./scoring/targets.js";
import { hpPercent as entityHpPercent, maxRange } from "./scoring/facts.js";
import { strikeDamageScore } from "./scoring/tactic-helpers.js";
import {
  actionKey,
  candidateTraitSlugs,
  currentAttackRange,
  inheritPlannedTarget,
  isAttackAction,
  isCompositionExtenderCandidate,
  isGrabRider,
  isPressAction,
  isSpellAction,
  isStrikeAction,
  isStrikeLikeCandidate,
  previousActionRequirements,
  previousActionSatisfied,
  pressStepsAfterAttack,
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
  isCompositionExtensionEligible,
  projectedFollowUpSatisfied,
  projectedVolleyPenalty,
  withLingeringCompositionCandidates,
  withProjectedFollowUpStrikeCandidates,
  withQuickenedCastingDiscountCandidates,
} from "./planner/projections.js";
import { planSignature } from "./planner/plan-signature.js";
import { createPlanRescorer } from "./planner/rescoring.js";
import { plannedMoveDestination } from "../readers/action/reach.js";
import { defenderCoverage, endPositionDanger, nearDeathExposure, planEndState } from "./planner/danger.js";
import { nextTurnReadiness } from "./planner/lookahead.js";
import { scoreCandidate } from "./scoring.js";
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
  isSpellstrikeStep,
  rechargesSpellstrike,
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
// The best one-action options always make the pool: a top-eight of two-action spells would
// otherwise leave nothing good for the third action.
const ONE_ACTION_FILLERS = 2;
const CONDITION_SETUP_CANDIDATES = 4;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
// How far a plan that leaves an action unused must outscore one that uses them all to rank above it.
const FULL_BUDGET_PREFERENCE_MARGIN = 60;
const MAX_SEARCH_STATES = 1024;
const MAX_COVERAGE_SEARCH_STATES = 48;
const MAX_COVERAGE_PLANS = 8;
const DIVERSITY_SCORE_WINDOW = 6;
const DIVERSITY_LOOKAHEAD = 12;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const ORPHAN_SETUP_PENALTY = 20;
const MAX_APPROACH_CANDIDATES = 5;
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

function selectPlanningCandidates(allCandidates) {
  // A stowed weapon's follow-up Strike rides along with its Draw (added at the end, over the cap)
  // instead of taking a slot from a real option.
  const followUps = allCandidates.filter((candidate) => candidate?.requiresDrawnWeaponId);
  const sortedCandidates = allCandidates.filter((candidate) => !candidate?.requiresDrawnWeaponId);
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
  for (const candidate of sortedCandidates.filter((entry) => Number(entry?.actionCost) === 1 && Number(entry?.score) > 0).slice(0, ONE_ACTION_FILLERS)) add(candidate);

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
  const drawnIds = new Set(selected.filter((candidate) => candidate?.activityProfile?.drawsWeapon === true)
    .map((candidate) => candidate?.item?.id).filter(Boolean));
  for (const followUp of followUps) {
    if (!drawnIds.has(followUp.requiresDrawnWeaponId) || selectedKeys.has(actionKey(followUp))) continue;
    selected.push(followUp);
    selectedKeys.add(actionKey(followUp));
  }
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

// A reload weapon is empty once any earlier step fired it -- a plain Strike, or a composite such as
// Stride Away -> Crossbow -- not only when the very same action repeats.
function isThrownOrBombStrike(candidate) {
  const traits = candidateTraitSlugs(candidate);
  return candidate?.altUsage === "thrown" || traits.includes("bomb")
    || (traits.some((trait) => trait.startsWith("thrown")) && isRangedCandidate(candidate));
}

function isRangedCandidate(candidate) {
  if (typeof candidate?.isRanged === "boolean") return candidate.isRanged;
  return Number(candidate?.range?.increment) > 0 || candidate?.item?.isRanged === true;
}

function weaponFiredEarlier(candidate, steps) {
  const weapons = new Set(weaponIdentityValues(candidate));
  if (!weapons.size) return false;
  return steps.some((step) => (isStrikeAction(step) || step?.activityProfile?.includesStrike === true)
    && step?.activityProfile?.reload !== true
    && weaponIdentityValues(step).some((weapon) => weapons.has(weapon)));
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
  return step?.activityProfile?.spellshape === true || step?.activityProfile?.rangeBuff === true
    || isCompositionExtenderCandidate(step)
    || candidateTraitSlugs(step).includes("spellshape");
}

const REACH_SPELL_FEET = 30;

// Reach Spell adds 30 ft (a touch spell becomes 30 ft). It's only worth the action when the spell
// it modifies can't reach its target without it but can with it -- never before a 500 ft spell.
function withReachSpellRange(spell) {
  const range = maxRange(spell);
  if (!Number.isFinite(range)) return null;
  const boosted = range <= 5 ? REACH_SPELL_FEET : range + REACH_SPELL_FEET;
  return {
    ...spell,
    range: { ...(spell.range ?? {}), max: boosted },
    targetingProfile: { ...(spell.targetingProfile ?? {}), maxRange: boosted },
    rangeBoostedFrom: range,
  };
}

export function rangeBuffHelpsSpell(context, spell) {
  const range = Number.isFinite(Number(spell?.rangeBoostedFrom)) ? Number(spell.rangeBoostedFrom) : maxRange(spell);
  const distance = Number(targetForCandidate(context, spell)?.distance);
  if (!Number.isFinite(range)) return true; // unknown range: can't rule it out (matches the scoring gate)
  if (!Number.isFinite(distance)) return false;
  const boosted = range <= 5 ? REACH_SPELL_FEET : range + REACH_SPELL_FEET;
  return distance > range && distance <= boosted;
}

function planSpellshapesAreUseful(context, steps) {
  return steps.every((step, index) => {
    if (!isSpellshapeSetup(step)) return true;
    const nextStep = steps[index + 1];
    // Lingering Composition only extends a composition cast right after it.
    if (isCompositionExtenderCandidate(step)) return Boolean(nextStep && isCompositionExtensionEligible(nextStep));
    if (!(nextStep && isSpellAction(nextStep) && !isSpellshapeSetup(nextStep))) return false;
    return step?.activityProfile?.rangeBuff !== true || rangeBuffHelpsSpell(context, nextStep);
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
  // Backing off ends the turn: attack first, then get out of reach.
  if (step?.activityProfile?.retreat === true) return 4;
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

  // Recall Knowledge first: what it reveals (the weak save, a weakness) should inform the attack.
  if (step?.slug === "recall-knowledge" && hasOffensiveFollowUp(allSteps)) return -0.5;
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
  const orderSource = step?.activityProfile?.orderAfterKey;
  if (orderSource && actionKey(source) === orderSource) return true;

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

  return pressStepsAfterAttack(dependencyOrderedSteps(priorityOrdered));
}

export function mapPenalty(candidate, attackIndex) {
  if (!isAttackAction(candidate)) return 0;
  if (candidate.activityProfile?.noAttackRoll === true) return 0;
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
    return Math.max(1, Number(candidate.activityProfile?.countedStrikes)
      || (candidate.activityProfile?.includes ?? []).filter((atom) => atom === "strike").length);
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
    let pressOpens = false;
    const dealt = next.map((step) => {
      if (!step?.mapBase) return step;
      if (attackCount === 0 && isPressAction(step)) pressOpens = true;
      const penalty = mapPenalty(step, attackCount);
      const placed = withMapAt(step, penalty, attackCount + 1);
      cost += stepMapScoreCost(step, step.mapBase.score, attackCount);
      attackCount += attacksTowardMap(step);
      return placed;
    });
    return { dealt, cost: pressOpens ? Infinity : cost };
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
  // Nothing can close the distance without a plain move (or Reach Spell, for a spell) in the search.
  if (!searchPool.some(isPlainMovement) && !searchPool.some((candidate) => candidate?.activityProfile?.rangeBuff === true)) return [];
  // A weapon with a Stride -> Strike combo still earns its second Strike once the combo is in reach.
  const eligible = (approachCandidates ?? [])
    .filter((candidate) => candidate?.needsApproach)
    .filter((candidate) => autoFillEligibleCandidate(context, candidate))
    .filter((candidate) => turnIntentCandidateAllowed(context?.turnIntent, candidate))
    .filter((candidate) => Number.isFinite(candidate.actionCost) && candidate.actionCost >= 0 && candidate.actionCost < budget.totalActions)
    .toSorted((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0));
  // Out-of-range spells score -999 from here, so a flat top-N fills up with Feint and Trip. Take the
  // best of each kind in turn: Strikes, spells, everything else.
  const kind = (candidate) => candidate.source === "strike" || candidate?.activityProfile?.includesStrike ? 0
    : String(candidate.source ?? "").startsWith("spell") ? 1 : 2;
  // A heal aimed at an ally (the dying one first) always makes the list: every approach candidate
  // scores -999 until re-scored, so an arbitrary five could leave the cleric's Heal out entirely.
  const patientHeals = eligible
    .filter((candidate) => normalizedActionFacts(candidate).role === "healing" && candidate?.suggestedTarget?.type === "ally")
    // Real HP back (Heal, Soothe) before Stabilize; the 2-action, 30-foot Heal before the touch one.
    .toSorted((left, right) => {
      const restores = (candidate) => /(?:^|-)(?:heal|harm|soothe|life-boost|breath-of-life|vital-beacon)(?:$|-)/.test(normalizeSlug(candidate?.slug ?? candidate?.name)) ? 2 : 0;
      return (restores(right) + Number(right.actionCost === 2)) - (restores(left) + Number(left.actionCost === 2));
    })
    .slice(0, 2);
  const queues = [0, 1, 2].map((key) => eligible.filter((candidate) => kind(candidate) === key && !patientHeals.includes(candidate)));
  const picked = [...patientHeals];
  while (picked.length < MAX_APPROACH_CANDIDATES && queues.some((queue) => queue.length)) {
    for (const queue of queues) if (queue.length && picked.length < MAX_APPROACH_CANDIDATES) picked.push(queue.shift());
  }
  return picked;
}

// The candidate's target as it stands on the projected board (allies too: a heal's patient).
function projectedTargetOf(context, candidate) {
  const reference = candidate?.preferredTarget ?? candidate?.suggestedTarget;
  const ids = new Set(targetIdentity(reference ?? {}));
  if (ids.size) {
    const found = [...contextTargets(context), ...contextEnemies(context), ...contextAllies(context)]
      .find((entity) => targetIdentity(entity).some((id) => ids.has(id)));
    if (found) return found;
  }
  return targetForCandidate(context, candidate);
}

const STAND_OFF_ROLES = new Set(["spell-damage", "ranged-striker", "artillery", "healer", "buffer", "debuffer", "support"]);
const OFFENSIVE_ROLES = new Set(["damage", "save-damage", "area-damage", "multiattack", "control", "debuff"]);

function rangedStandOffRange(tactic, candidates) {
  if (!STAND_OFF_ROLES.has(tactic?.effectiveRole ?? tactic?.role)) return null;
  const ranges = candidates
    .filter((candidate) => OFFENSIVE_ROLES.has(candidate?.role) && (candidate.score > HARD_BLOCK_SCORE || candidate.needsApproach))
    .map((candidate) => Number(candidate?.range?.max ?? candidate?.targetingProfile?.maxRange))
    .filter((range) => Number.isFinite(range) && range > 10);
  return ranges.length ? Math.min(60, Math.max(...ranges)) : null;
}

// A dying ally is an emergency: when this creature can heal or stabilize them (now or after
// moving), a plan that doesn't is worse than any damage it deals.
const DYING_NEGLECT_PENALTY = 120;
const DYING_APPROACH_BONUS = 50;
function dyingAllyNeglect(context, steps, candidates) {
  const dying = contextAllies(context).filter((ally) => entityHasAnyCondition(ally, ["dying"]) && !entityHasAnyCondition(ally, ["healed"]));
  if (!dying.length) return 0;
  const helps = (step) => step?.role === "healing" || normalizedActionFacts(step).role === "healing" || /(?:^|-)(?:heal|stabilize|battle-medicine|treat-wounds|administer-first-aid|soothe)$/.test(normalizeSlug(step?.slug ?? step?.id));
  if (steps.some(helps)) return 0;
  if (!(candidates ?? []).some(helps)) return 0;
  // Too far to heal this turn: closing the distance (a Stride toward them) is the help on offer, so
  // that next turn's heal lands.
  const dyingIds = new Set(dying.map((ally) => String(ally?.id ?? "")).filter(Boolean));
  const towardDying = steps.filter((step) => /-toward-/.test(String(step?.id ?? "")) && dyingIds.has(String(step?.suggestedTarget?.id ?? ""))).length;
  return towardDying ? Math.min(2, towardDying) * DYING_APPROACH_BONUS : -DYING_NEGLECT_PENALTY;
}

// Steps are scored on the turn's starting board, where a Sudden Charge backed by the fist is a
// fist hit. After a plain Draw in the same plan it lands with the drawn weapon: rebind its backing
// Strike to that weapon, and credit the fist penalty back plus the damage the weapon adds.
const DRAWN_BACKING_PENALTY_REFUND = 60;
function isFistStrike(strike) {
  return strike?.item?.slug === "basic-unarmed" || strike?.item?.id === "xxPF2ExUNARMEDxx";
}
function withDrawnWeaponBacking(steps) {
  let credit = 0;
  let drawn = null;
  const rebound = (steps ?? []).map((step) => {
    const profile = step?.activityProfile ?? {};
    if (profile.drawsWeapon === true && profile.includesStrike !== true && step?.item?.system?.range == null) {
      drawn = step.drawnStrike ?? null;
      return step;
    }
    if (!drawn || profile.requiresBackingStrike !== true || !isFistStrike(profile.backingStrike)) return step;
    credit += DRAWN_BACKING_PENALTY_REFUND
      + Math.max(0, strikeDamageScore(Number(drawn.averageDamage) || 0) - strikeDamageScore(Number(profile.backingStrike.averageDamage) || 0));
    return { ...step, activityProfile: { ...profile, backingStrike: drawn } };
  });
  return { steps: rebound, credit };
}

// An ally one hit from going down (under a quarter HP, not yet dying): when this creature can heal
// them this turn, a plan that heals nobody that hurt is worse, nearly as bad as leaving a dying ally.
const CRITICAL_ALLY_HP = 0.25;
const CRITICAL_ALLY_NEGLECT_PENALTY = 110;
function criticalAllyNeglect(context, steps, candidates) {
  const critical = contextAllies(context).filter((ally) => {
    const hp = entityHpPercent(ally);
    return Number.isFinite(hp) && hp > 0 && hp < CRITICAL_ALLY_HP && !entityHasAnyCondition(ally, ["dying", "dead"]);
  });
  if (!critical.length) return 0;
  const criticalIds = new Set(critical.map((ally) => String(ally?.id ?? "")).filter(Boolean));
  const heals = (step) => step?.role === "healing" || normalizedActionFacts(step).role === "healing";
  const target = (step) => String(step?.suggestedTarget?.id ?? step?.preferredTarget?.id ?? "");
  if (steps.some((step) => heals(step) && criticalIds.has(target(step)))) return 0;
  if (!(candidates ?? []).some((candidate) => heals(candidate) && criticalIds.has(target(candidate)))) return 0;
  return -CRITICAL_ALLY_NEGLECT_PENALTY;
}

// Spellstrike is scored on the turn's starting board, where a spent one is heavily penalised. When
// this plan recharges it first, that penalty doesn't apply: credit it back (and the usual payoff bonus).
const SPELLSTRIKE_RECHARGE_CREDIT = 138;
function spellstrikeRechargeCredit(context, steps) {
  if ((context?.profile ?? context?.actor?.profile)?.combatState?.spellstrikeNeedsRecharge !== true) return 0;
  const recharge = steps.findIndex(rechargesSpellstrike);
  const strike = steps.findIndex(isSpellstrikeStep);
  return recharge >= 0 && strike > recharge ? SPELLSTRIKE_RECHARGE_CREDIT : 0;
}

function isSwarmContext(context) {
  const raw = contextActorDocument(context)?.system?.traits?.value;
  return (raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : []).includes("swarm");
}

function approachReaches(context, candidate) {
  // Swarming Bites hits whoever the swarm is on top of; no particular target.
  if (candidate?.activityProfile?.inOwnSpace === true) {
    return contextEnemies(context).some((enemy) => Number(enemy?.distance) <= 0);
  }
  const target = projectedTargetOf(context, candidate);
  const strides = Number(candidate?.activityProfile?.strideCount) || 0;
  const speed = Number(context?.profile?.speed ?? context?.actor?.profile?.speed) || 25;
  const reach = Number(candidate?.activityProfile?.strikeReach) || currentAttackRange(candidate) || 5;
  const areaSize = candidate?.targetingProfile?.area === true ? Number(candidate.targetingProfile.distance) || 0 : 0;
  const range = strides > 0 ? speed * strides + reach
    : areaSize > 0 ? (Number(candidate?.targetingProfile?.maxRange ?? candidate?.range?.max) || 0) + areaSize
    : candidate?.activityProfile?.inOwnSpace === true ? 0
    : Number(candidate?.targetingProfile?.maxRange) > 0 ? Number(candidate.targetingProfile.maxRange)
      : currentAttackRange(candidate) ?? 5;
  return Number(target?.distance ?? Infinity) <= range;
}

// An out-of-reach heal needs a Stride toward its patient, not toward the enemy the plain Stride
// is aimed at: offer a copy of the Stride aimed at each such patient.
function strideTowardPatients(searchPool, approach) {
  const stride = searchPool.find((candidate) => isPlainMovement(candidate) && /(?:^|-)stride$/.test(normalizeSlug(candidate?.slug ?? candidate?.id)));
  if (!stride) return [];
  const patients = new Map();
  for (const candidate of approach) {
    const target = candidate?.suggestedTarget;
    if (normalizedActionFacts(candidate).role === "healing" && target?.type === "ally" && target.id) patients.set(target.id, target);
  }
  return [...patients.values()].map((patient) => ({
    ...stride,
    id: `${stride.id ?? stride.slug}-toward-${patient.id}`,
    suggestedTarget: patient,
    preferredTarget: patient,
    reason: t("Plan.StrideTowardAlly", "Stride toward {name}.", { name: patient.name }),
    reasons: [t("Plan.StrideTowardAlly", "Stride toward {name}.", { name: patient.name })],
  }));
}

// An area attack that catches nobody yet (a 15-foot cone, everyone 25 feet off) needs a Stride that
// ends close enough to aim it, not the plain Stride's stand-off square: offer that copy per target.
function strideIntoArea(searchPool, approach) {
  const stride = searchPool.find((candidate) => isPlainMovement(candidate) && /(?:^|-)stride$/.test(normalizeSlug(candidate?.slug ?? candidate?.id)));
  if (!stride) return [];
  const targets = new Map();
  for (const candidate of approach) {
    const profile = candidate?.targetingProfile ?? {};
    const target = candidate?.suggestedTarget;
    const size = Number(profile.distance) || 0;
    if (profile.area !== true || profile.enemy !== true || size <= 0 || !target?.id) continue;
    // Close enough that the template still reaches past the nearest creature to the ones behind it.
    const reach = Math.max(5, (Number(profile.maxRange ?? candidate?.range?.max) || 0) + size - 5);
    const known = targets.get(target.id);
    if (!known || reach < known.reach) targets.set(target.id, { target, reach });
  }
  return [...targets.values()].map(({ target, reach }) => ({
    ...stride,
    id: `${stride.id ?? stride.slug}-into-area-${target.id}`,
    suggestedTarget: target,
    preferredTarget: target,
    activityProfile: { ...(stride.activityProfile ?? {}), approachReach: reach },
    reason: t("Plan.StrideIntoArea", "Stride within area range of {name}.", { name: target.name }),
    reasons: [t("Plan.StrideIntoArea", "Stride within area range of {name}.", { name: target.name })],
  }));
}

function isAttackPayoff(step) {
  return isAttackAction(step) || step?.activityProfile?.includesStrike === true;
}

function isPlainMovement(step) {
  if (step?.activityProfile?.includesStrike === true) return false;
  return /(?:^|-)(?:stride|step)$/.test(normalizeSlug(step?.slug ?? step?.id));
}

function isAttackSetup(step) {
  // Feint, Create a Diversion, Bespell Strikes: all only pay off on a later attack this turn.
  return /(?:^|-)(?:feint|create-a-diversion|bespell-strikes|bespell-weapon)$/.test(normalizeSlug(step?.slug ?? step?.id));
}

// Setup steps that nothing in the plan pays off: a Diversion or Feint with no attack after it, or a
// plain Stride/Step followed by non-attack filler while an attack was on offer. These score on their
// own ("closes distance", "creates an opening") but waste the action in that plan.
export function orphanSetupSteps(steps, candidates = []) {
  // Only an attack usable without moving makes a Stride "padding": when every attack needs a move
  // first (enemy 40 ft away), a Stride is progress even if the rest of the turn is defensive.
  const attackOnOffer = candidates.some((candidate) =>
    candidate?.available !== false && !candidate?.needsApproach && !candidate?.requiresDrawnWeaponId && Number(candidate?.score) > 0 && isAttackPayoff(candidate)
    && !(Number(candidate?.activityProfile?.strideCount) > 0));
  const targetOf = (step) => step?.suggestedTarget?.id ?? step?.preferredTarget?.id ?? step?.targetingProfile?.preferredTargetId ?? null;
  return steps.filter((step, index) => {
    const later = steps.slice(index + 1);
    // Feint and Create a Diversion only open up the creature they targeted: a Strike on someone
    // else doesn't pay them off.
    if (/(?:^|-)(?:feint|create-a-diversion)$/.test(normalizeSlug(step?.slug ?? step?.id)) && targetOf(step)) {
      return !later.some((next) => isAttackPayoff(next) && (!targetOf(next) || targetOf(next) === targetOf(step)));
    }
    // Bespell Strikes / Bespell Weapon charge a Strike: a spell attack (Ignition) doesn't use them.
    if (/(?:^|-)(?:bespell-strikes|bespell-weapon)$/.test(normalizeSlug(step?.slug ?? step?.id))) {
      return !later.some((next) => next?.source === "strike" || next?.activityProfile?.includesStrike === true);
    }
    // Drain Bonded Item (and kin) only pays off when a slotted spell is cast after it this turn.
    if (step?.activityProfile?.recoversSpellResource === true && step?.activityProfile?.npcFamily !== "recharge") {
      return !later.some((next) => String(next?.source ?? "").startsWith("spell")
        && Number(next?.castRank ?? next?.rank) > 0
        && !candidateTraitSlugs(next).some((trait) => trait === "cantrip" || trait === "focus"));
    }
    const plainDraw = step?.activityProfile?.drawsWeapon === true && step?.activityProfile?.includesStrike !== true;
    if (!plainDraw && later.some(isAttackPayoff)) return false;
    if (isAttackSetup(step)) return true;
    // A plain Draw is wasted unless a later step attacks with the weapon it drew.
    if (step?.activityProfile?.drawsWeapon === true && step?.activityProfile?.includesStrike !== true) {
      const drawn = new Set(weaponIdentityValues(step));
      // A melee weapon drawn before a Sudden Charge (or kin) that would otherwise land with the fist.
      const meleeDraw = step?.item?.system?.range == null;
      return !later.some((next) => (isAttackPayoff(next) && weaponIdentityValues(next).some((weapon) => drawn.has(weapon)))
        || (meleeDraw && step.drawnStrike && next?.activityProfile?.requiresBackingStrike === true
          && (isFistStrike(next.activityProfile.backingStrike)
            || (next.activityProfile.backingStrike?.item?.id ?? next.activityProfile.backingStrike?.item?._id) === (step.item?.id ?? step.item?._id))));
    }
    // A move that brings an out-of-reach action into range (a heal on a distant ally) is paid off.
    if (later.some((next) => next?.needsApproach)) return false;
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
  const executionOrder = pressStepsAfterAttack(applyTurnIntentToPlan(context?.turnIntent, orderPlanSteps(steps)));
  const simulated = simulation ? simulation.rescorer.simulate(context, simulation.initialState, executionOrder) : executionOrder;
  const drawnBacking = withDrawnWeaponBacking(rebalancePlanMap(simulated));
  const orderedSteps = drawnBacking.steps;
  const evaluation = evaluatePlan(context, orderedSteps);
  const totalCost = steps.reduce((total, step) => total + step.actionCost, 0);
  const targets = context.targets ?? context.battlefield?.targets ?? [];
  // The enemy's turn: how many more (or fewer) enemies can hit you where this plan ends.
  const endState = simulation ? planEndState(context, simulation.initialState, orderedSteps) : null;
  const danger = simulation
    ? endPositionDanger(context, simulation.initialState, orderedSteps, resolvedTactic?.effectiveTemperament ?? resolvedTactic?.temperament, endState, resolvedTactic?.effectiveRole ?? resolvedTactic?.role)
    : { delta: 0, scoreDelta: 0 };
  // Next turn: Strides saved before you can attack again (a positioning turn has value).
  const readiness = simulation
    ? nextTurnReadiness(context, simulation.initialState, orderedSteps, sortedCandidates, endState)
    : { saved: 0, scoreDelta: 0 };
  const tacticalScore = planScore(context, orderedSteps, sortedCandidates, budget) + danger.scoreDelta + readiness.scoreDelta
    + dyingAllyNeglect(context, orderedSteps, sortedCandidates) + criticalAllyNeglect(context, orderedSteps, sortedCandidates)
    + drawnBacking.credit + spellstrikeRechargeCredit(context, orderedSteps)
    + (simulation ? defenderCoverage(context, simulation.initialState, orderedSteps, resolvedTactic?.effectiveRole ?? resolvedTactic?.role, endState).scoreDelta : 0)
    + (simulation ? nearDeathExposure(context, simulation.initialState, orderedSteps, resolvedTactic?.effectiveTemperament ?? resolvedTactic?.temperament, endState).scoreDelta : 0);
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
    danger,
    readiness,
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
  // A transitive key (a pairwise "full budget wins unless..." rule formed cycles and made the sort
  // arbitrary): plans with a wasted step (orphan setup, negative step) rank below clean ones; among
  // clean plans, leaving an action unused costs a fixed margin, so a 2-action Cataclysm still beats
  // a 3-action Mist but not a near-equal full turn.
  const tier = (plan) => ((plan?.orphanSetups > 0)
    || (plan?.steps ?? []).some((step) => Number.isFinite(step?.score) && step.score < 0) ? 1 : 0);
  const tierDelta = tier(left) - tier(right);
  if (tierDelta !== 0) return tierDelta;
  const rankScore = (plan) => Number(plan.score) - (planUsesFullBudget(plan, budget) ? 0 : FULL_BUDGET_PREFERENCE_MARGIN);
  const delta = rankScore(right) - rankScore(left);
  if (delta !== 0) return delta;
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

// Real-square destinations for planned Strides: the pathing is the costliest part of a search and
// the same (from, target, speed, reach) recurs across many plan prefixes. Cleared per search, since the
// board can change between searches.
const moveDestinationCache = new Map();
function cachedMoveDestination(projectedContext, target, speed, reach) {
  const from = projectedContext?.token?.center;
  const to = target?.center ?? target?.token?.center;
  const key = [from?.x, from?.y, target?.id, to?.x, to?.y, speed, reach].join("|");
  if (!moveDestinationCache.has(key)) moveDestinationCache.set(key, plannedMoveDestination(projectedContext, target, speed, reach));
  return moveDestinationCache.get(key);
}

export function buildTurnPlans(context, candidates, { reservedSteps = [], includeCoverage = true, includePendingQuickened = true, approachCandidates = [] } = {}) {
  moveDestinationCache.clear();
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
  // Where a caster or archer should stop when it Strides: at the range of its ranged attack, not
  // in melee. Melee roles keep closing to reach.
  const standOffRange = rangedStandOffRange(resolvedTactic, [...candidates, ...(approachCandidates ?? [])]);
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

  const approach = approachPool(approachCandidates, eligibleCandidates, context, budget, sortedCandidates);
  sortedCandidates = [...sortedCandidates, ...strideTowardPatients(sortedCandidates, approach), ...strideIntoArea(sortedCandidates, approach), ...approach];
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
      && planSpellshapesAreUseful(context, orderPlanSteps(steps))
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
      // Reach Spell right before an out-of-range spell can bring it in range without moving.
      const lastStep = steps.at(-1);
      const boosted = candidate.needsApproach && isSpellAction(candidate) && lastStep?.activityProfile?.rangeBuff === true
        ? withReachSpellRange(candidate) : null;
      const boostReaches = Boolean(boosted && approachReaches(projectedContext, boosted));
      const mover = candidate.needsApproach ? (boostReaches ? lastStep : steps.findLast(isMovementStep)) : null;
      if (candidate.needsApproach && !boostReaches && (!mover || !approachReaches(projectedContext, candidate))) continue;
      let linkedCandidate;
      if (boostReaches) {
        const scored = scoreCandidate({ ...projectedContext, skipNativePreflight: true }, { ...boosted, reason: undefined, reasons: undefined });
        if (!(scored.score > HARD_BLOCK_SCORE)) continue;
        linkedCandidate = { ...scored, needsApproach: true, rangeBoostedFrom: boosted.rangeBoostedFrom };
      } else {
        const inherited = inheritPlannedTarget(projectedContext, candidate, prerequisiteSteps);
        // Re-score against the board the earlier steps leave behind; the re-score already accounts
        // for conditions those steps applied, so the conditional-bonus adjustment is for the rest.
        const rescored = rescore(projectedContext, planState, inherited);
        if (!rescored) continue;
        linkedCandidate = rescored === inherited ? withProjectedConditionalBonuses(projectedContext, inherited) : rescored;
      }
      if (candidate.needsApproach) {
        if (!approachReaches(projectedContext, linkedCandidate)) continue;
        // An area attack re-aimed after moving must actually catch someone.
        if (linkedCandidate.targetingProfile?.area === true && linkedCandidate.activityProfile?.areaHitCount === 0) continue;
        // Name whoever the swarm ends up on, not the far-off target it was first scored against.
        const underneath = linkedCandidate.activityProfile?.inOwnSpace === true
          ? contextEnemies(projectedContext).find((enemy) => Number(enemy?.distance) <= 0) : null;
        const reference = underneath ? { id: underneath.id, name: underneath.name, type: "enemy" } : null;
        linkedCandidate = {
          ...linkedCandidate,
          ...(reference ? { suggestedTarget: reference, preferredTarget: reference } : {}),
          activityProfile: { ...(linkedCandidate.activityProfile ?? {}), requiresProjectedAfterKey: actionKey(mover) },
        };
      }
      // In reach only because an earlier step moved us (a Knockdown after Stride -> Jaws): it must
      // stay after that move when the plan is put in execution order.
      if (!candidate.needsApproach && !linkedCandidate.activityProfile?.requiresProjectedAfterKey && !linkedCandidate.activityProfile?.orderAfterKey) {
        const moved = steps.findLast(isMovementStep);
        if (moved && (linkedCandidate.targetingProfile?.enemy === true || isAttackAction(linkedCandidate))) {
          // Attacks without a listed range need melee reach; anything else needs only its own range
          // (Exploit Vulnerability has none, so it may still lead the plan before the move).
          const ownRange = Number(linkedCandidate.targetingProfile?.maxRange ?? linkedCandidate.range?.max);
          const range = currentAttackRange(linkedCandidate)
            ?? (isAttackAction(linkedCandidate) ? (Number(context.profile?.reach ?? context.profile?.meleeReach) || 5)
              : (ownRange > 0 ? ownRange : Infinity));
          const now = Number(projectedTargetOf(projectedContext, linkedCandidate)?.distance);
          const before = Number(projectedTargetOf(context, linkedCandidate)?.distance);
          if (now <= range && before > range) {
            linkedCandidate = { ...linkedCandidate, activityProfile: { ...(linkedCandidate.activityProfile ?? {}), orderAfterKey: actionKey(moved) } };
          }
        }
      }
      // On a real canvas, a plain Stride/Step gets an actual destination square, so distances to
      // every creature, danger and next-turn readiness use real geometry (and the draft step
      // arrives with it preset).
      if (isPlainMovement(linkedCandidate) && !linkedCandidate.destination && projectedContext.token?.center) {
        const target = projectedTargetOf(projectedContext, linkedCandidate);
        const step = /(?:^|-)step$/.test(normalizeSlug(linkedCandidate.slug ?? linkedCandidate.id));
        const speed = Number(projectedContext.profile?.speed ?? projectedContext.actor?.profile?.speed) || 25;
        // A swarm attacks the creatures in its own space: it Strides onto them, not next to them.
        const reach = isSwarmContext(projectedContext) ? 0
          : Number(linkedCandidate.activityProfile?.approachReach) > 0 ? Number(linkedCandidate.activityProfile.approachReach)
          : standOffRange && !contextAllies(projectedContext).includes(target) ? standOffRange
            : Number(projectedContext.profile?.reach ?? projectedContext.profile?.meleeReach) || 5;
        const destination = target ? cachedMoveDestination(projectedContext, target, step ? 5 : speed, reach) : null;
        if (destination) linkedCandidate = { ...linkedCandidate, destination: { x: destination.x, y: destination.y }, plannedDestination: true };
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
      // Press: only once the turn already has a multiple attack penalty.
      if (isPressAction(linkedCandidate) && !(planState.attackCount > 0)) continue;
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
      const firesWeapon = strikeAction || linkedCandidate?.activityProfile?.includesStrike === true;
      // Unloaded at turn start (PF2e ammunition tracking): the first shot needs its Reload too,
      // unless an explicit Reload of this weapon already came earlier in the plan.
      const firstShotUnloaded = firesWeapon && linkedCandidate?.startsUnloaded === true && currentUses === 0
        && !weaponFiredEarlier(linkedCandidate, [...reservedSteps, ...steps])
        && ![...reservedSteps, ...steps].some((step) => step?.executable === "reload-weapon" && strikeWeaponKey(step) === strikeWeaponKey(linkedCandidate));
      const repeatReloadCost = firesWeapon && (currentUses > 0 || npcReloadRequired || firstShotUnloaded || weaponFiredEarlier(linkedCandidate, [...reservedSteps, ...steps]))
        ? (Number(reloadCost(linkedCandidate)) > 0 ? reloadCost(linkedCandidate) : firstShotUnloaded ? 1 : 0) : 0;
      // A thrown weapon or bomb leaves your hand: throwing again needs another one drawn first.
      const redrawCost = firesWeapon && repeatReloadCost === 0 && isThrownOrBombStrike(linkedCandidate)
        && (currentUses > 0 || weaponFiredEarlier(linkedCandidate, [...reservedSteps, ...steps])) ? 1 : 0;
      const candidateActionCost = Number(linkedCandidate.actionCost) + repeatReloadCost + redrawCost;

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
          name: repeatReloadCost > 0 ? `Reload -> ${linkedCandidate.name}`
            : redrawCost > 0 ? t("Plan.DrawThen", "Draw -> {name}", { name: linkedCandidate.name }) : linkedCandidate.name,
          ...(redrawCost > 0 ? { redrawCost } : {}),
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
