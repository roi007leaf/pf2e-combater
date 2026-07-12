import { slugify as normalizeSlug } from "../action/text.js";
import { contextEnemies, contextTargets } from "../target-pool.js";
import { contextTriggerEvents } from "../../rules/event-context.js";
import { scoreCandidate } from "../scoring.js";

const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const TARGET_CONDITION_CHAIN_BONUS = 36;
const GRAB_RIDER_CHAIN_BONUS = 24;

export function actionKey(candidate) {
  return candidate.id ?? candidate.slug ?? candidate.name;
}


export function candidateTraitSlugs(candidate) {
  const values = [
    ...(Array.isArray(candidate?.traits) ? candidate.traits : []),
    ...(Array.isArray(candidate?.weaponTraits) ? candidate.weaponTraits : []),
    ...(Array.isArray(candidate?.item?.system?.traits?.value) ? candidate.item.system.traits.value : []),
  ];
  return values.map((trait) => String(trait?.slug ?? trait?.name ?? trait ?? "").toLowerCase()).filter(Boolean);
}


export function isAttackAction(candidate) {
  return candidate.source === "strike"
    || candidate.activityProfile?.includesStrike === true
    || candidate.attackTrait === true
    || candidate.attack === true
    || GENERIC_ATTACK_SLUGS.has(candidate.slug)
    || (Array.isArray(candidate.traits) && candidate.traits.includes("attack"));
}


export function isStrikeAction(candidate) {
  return candidate.source === "strike";
}


export function isSpellAction(candidate) {
  return String(candidate?.source ?? "").startsWith("spell");
}


export function isActionDiscountCandidate(candidate) {
  return candidate?.activityProfile?.actionDiscount === true;
}


export function isStrikeLikeCandidate(candidate) {
  return isStrikeAction(candidate)
    || candidate?.activityProfile?.includesStrike === true
    || candidate?.activityProfile?.drawsWeapon === true;
}


export function conditionValues(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}


export function targetConditionRequirementOptions(candidate) {
  const profile = candidate?.activityProfile ?? {};
  const any = conditionValues(profile.requiresAnyTargetCondition).map(normalizeSlug).filter(Boolean);
  if (any.length) return [any];
  return conditionValues(profile.requiresTargetCondition)
    .map(normalizeSlug)
    .filter(Boolean)
    .map((condition) => [condition]);
}


export function requiresTargetCondition(candidate) {
  return targetConditionRequirementOptions(candidate).length > 0;
}


export function conditionSatisfies(requirement, condition) {
  if (requirement === condition) return true;
  return requirement === "grabbed" && condition === "restrained";
}


export function candidateAppliedConditions(candidate) {
  const profile = candidate?.activityProfile ?? {};
  const conditions = [
    ...conditionValues(profile.appliesCondition),
    ...conditionValues(profile.appliesConditions),
    ...conditionValues(profile.appliedCondition),
    ...conditionValues(profile.conditions),
    ...conditionValues(candidate?.appliesConditions),
  ].map(normalizeSlug).filter(Boolean);
  if (profile.includesGrab === true || candidate?.slug === "grapple") conditions.push("grabbed");
  return new Set(conditions);
}


export function stepSatisfiesTargetConditionRequirement(step, optionGroup) {
  const applied = candidateAppliedConditions(step);
  if (!applied.size) return false;
  return optionGroup.some((requirement) =>
    [...applied].some((condition) => conditionSatisfies(requirement, condition)),
  );
}


export function isGrabRider(candidate) {
  return candidate?.activityProfile?.npcFamily === "grab-rider"
    || (candidate?.activityProfile?.includesGrab === true
      && previousActionRequirements(candidate).some((requirement) =>
        ["strike", "after-strike"].includes(normalizeSlug(requirement)),
      ));
}


export function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}


export function previousActionRequirements(candidate) {
  const eventTriggers = values(candidate?.gatingProfile?.eventTriggers).map(normalizeSlug);
  const explicit = [
    ...values(candidate?.activityProfile?.previousActionRequirements),
    ...values(candidate?.gatingProfile?.previousActionRequirements),
  ].map(normalizeSlug);
  if (candidate?.activityProfile?.requiresPreviousStrike === true
    || candidate?.gatingProfile?.requiresPreviousStrike === true) {
    explicit.push("after-strike");
  }
  if (explicit.length) return [...new Set(explicit)];
  return eventTriggers.includes("previous-action") ? ["previous-action"] : [];
}


export function requiresPreviousAction(candidate) {
  return previousActionRequirements(candidate).length > 0;
}


export function isNonCantripSpell(candidate) {
  if (!isSpellAction(candidate)) return false;
  if (candidate?.isCantrip === true) return false;
  const rank = Number(candidate?.castRank ?? candidate?.rank);
  return Number.isFinite(rank) ? rank > 0 : candidate?.isCantrip === false;
}


export function stepSatisfiesPreviousRequirement(step, requirement) {
  if (!step) return false;
  const key = normalizeSlug(requirement);
  if (key === "previous-action") return true;
  if (key === "spell" || key === "spell-cast") return isSpellAction(step);
  if (key === "non-cantrip-spell") return isNonCantripSpell(step);
  if (key === "strike" || key === "after-strike") return isStrikeLikeCandidate(step);
  if (key === "attack") return isAttackAction(step);
  if (key === "quickened-casting") return isActionDiscountCandidate(step);
  if (key === "lingering-composition") return isCompositionExtenderCandidate(step);
  return false;
}


export function stepSatisfiesPreviousRequirements(step, requirements) {
  const meaningful = requirements.filter((requirement) => requirement !== "previous-action");
  const valuesToCheck = meaningful.length ? meaningful : requirements;
  return valuesToCheck.every((requirement) => stepSatisfiesPreviousRequirement(step, requirement));
}


export function contextSatisfiesPreviousRequirements(context, requirements) {
  const events = contextTriggerEvents(context);
  if (!events.size) return false;
  const meaningful = requirements.filter((requirement) => requirement !== "previous-action");
  if (!meaningful.length) return events.has("previous-action");
  return meaningful.every((requirement) => {
    const key = normalizeSlug(requirement);
    if (key === "non-cantrip-spell") return events.has("non-cantrip-spell");
    if (key === "spell" || key === "spell-cast") return events.has("spell-cast");
    if (key === "strike" || key === "after-strike") return events.has("after-strike");
    return events.has(key);
  });
}


export function requiresAfterStrike(requirements) {
  return requirements.some((requirement) => {
    const key = normalizeSlug(requirement);
    return key === "strike" || key === "after-strike";
  });
}


export function isRangedAttackStep(step) {
  const range = currentAttackRange(step);
  if (Number.isFinite(range) && range > 15) return true;
  const traits = candidateTraitSlugs(step);
  return traits.some((trait) =>
    trait === "ranged"
    || trait.startsWith("thrown-")
    || trait.startsWith("range-")
    || trait.startsWith("volley-"),
  );
}


export function profileReach(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const value = Number(profile.reach?.value ?? profile.reach ?? profile.meleeReach);
  return Number.isFinite(value) && value >= 0 ? value : 5;
}


export function stepCanApplyNpcGrab(context, step) {
  if (!isStrikeLikeCandidate(step) || isRangedAttackStep(step)) return false;

  const profileReachValue = profileReach(context);
  const strikeReach = Number(currentAttackRange(step) ?? step?.activityProfile?.strikeReach ?? profileReachValue);
  if (Number.isFinite(strikeReach) && strikeReach > profileReachValue) return false;

  const strideCount = Number(step?.activityProfile?.strideCount ?? 0);
  if (strideCount > 0) return true;

  const target = targetForCandidate(context, step);
  const distance = Number(target?.distance);
  return !Number.isFinite(distance) || distance <= profileReachValue;
}


export function requiresConcreteNpcGrabStrike(candidate, requirements) {
  return isGrabRider(candidate) && requiresAfterStrike(requirements);
}


export function targetAlreadyHeldForNpcGrab(context, candidate) {
  const target = targetForCandidate(context, candidate);
  return targetHasCondition(target, "grabbed") || targetHasCondition(target, "restrained");
}


export function previousActionSatisfied(context, candidate, steps) {
  const requirements = previousActionRequirements(candidate);
  if (!requirements.length) return true;
  if (requiresConcreteNpcGrabStrike(candidate, requirements)) {
    if (targetAlreadyHeldForNpcGrab(context, candidate)) return true;
    const previousStep = steps.at(-1);
    return stepSatisfiesPreviousRequirements(previousStep, requirements)
      && stepCanApplyNpcGrab(context, previousStep);
  }
  if (contextSatisfiesPreviousRequirements(context, requirements)) return true;
  return stepSatisfiesPreviousRequirements(steps.at(-1), requirements);
}


export function targetIdentity(value) {
  return [
    value?.id,
    value?.uuid,
    value?.actor?.id,
    value?.actor?.uuid,
    value?.token?.id,
    value?.token?.uuid,
    value?.name,
  ]
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => String(entry));
}


export function targetForCandidate(context, candidate) {
  const fallback = contextTargets(context)[0] ?? contextEnemies(context)[0] ?? null;
  // A distinct-target multiattack (Double Attack, Bladestorm, ...) hits several DIFFERENT
  // creatures; its own preferredTarget/suggestedTarget describe a single "best overall target"
  // (e.g. whichever token is currently targeted in Foundry) that may not be either creature it
  // actually struck. A grab-rider follow-up inheriting "the previous strike's target" from this
  // step must land on one of the real distinctTargets, not that unrelated single-target guess.
  const distinctTargets = candidate?.activityProfile?.distinctTargets;
  const primaryDistinctTarget = Array.isArray(distinctTargets) ? distinctTargets[0] : null;
  const reference = primaryDistinctTarget ?? candidate?.preferredTarget ?? candidate?.suggestedTarget ?? fallback;
  if (!reference) return null;
  if (Number.isFinite(Number(reference.distance))) return reference;

  const ids = new Set(targetIdentity(reference));
  return [...contextTargets(context), ...contextEnemies(context)]
    .find((target) => targetIdentity(target).some((id) => ids.has(id)))
    ?? fallback;
}


export function targetHasCondition(target, requirement) {
  const conditions = target?.conditions;
  if (!conditions) return false;

  const matches = (slug) => conditionSatisfies(requirement, normalizeSlug(slug));
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => matches(condition?.slug ?? condition?.name ?? condition));
  }
  if (Array.isArray(conditions.slugs) && conditions.slugs.some(matches)) return true;

  return Object.entries(conditions.values ?? {}).some(([slug, value]) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && matches(slug);
  });
}


export function samePlannedTarget(context, candidate, step) {
  const candidateTarget = targetForCandidate(context, candidate);
  const stepTarget = targetForCandidate(context, step);
  if (!candidateTarget || !stepTarget) return true;

  const candidateIds = new Set(targetIdentity(candidateTarget));
  const stepIds = targetIdentity(stepTarget);
  if (!candidateIds.size || !stepIds.length) return true;
  return stepIds.some((id) => candidateIds.has(id));
}


export function sameTargetReference(left, right) {
  if (!left || !right) return false;
  const leftIds = new Set(targetIdentity(left));
  const rightIds = targetIdentity(right);
  if (!leftIds.size || !rightIds.length) return false;
  return rightIds.some((id) => leftIds.has(id));
}


export function previousActionTargetSourceStep(candidate, steps) {
  const requirements = previousActionRequirements(candidate);
  if (!requirements.length) return null;

  const shouldInheritTarget = requirements.some((requirement) =>
    ["strike", "after-strike", "attack"].includes(normalizeSlug(requirement)),
  );
  if (!shouldInheritTarget) return null;

  const previousStep = steps.at(-1);
  return stepSatisfiesPreviousRequirements(previousStep, requirements) ? previousStep : null;
}


export function grabbedSetupTargetSourceStep(candidate, steps) {
  const appliesGrabbed = [...candidateAppliedConditions(candidate)].some((condition) =>
    conditionSatisfies("grabbed", condition),
  );
  if (!appliesGrabbed) return null;

  const previousStep = steps.at(-1);
  if (!previousStep) return null;
  return isStrikeLikeCandidate(previousStep) ? previousStep : null;
}


export function targetConditionSourceStep(context, candidate, steps) {
  const optionGroups = targetConditionRequirementOptions(candidate);
  if (!optionGroups.length || !steps.length) return null;

  const currentTarget = targetForCandidate(context, candidate);
  let sourceStep = null;

  for (const group of optionGroups) {
    if (group.some((requirement) => targetHasCondition(currentTarget, requirement))) continue;

    const step = steps.toReversed().find((candidateStep) =>
      stepSatisfiesTargetConditionRequirement(candidateStep, group),
    );
    if (!step) return null;
    if (sourceStep && !samePlannedTarget(context, sourceStep, step)) return null;
    sourceStep = step;
  }

  return sourceStep;
}


export function inheritPlannedTarget(context, candidate, steps) {
  const sourceStep = targetConditionSourceStep(context, candidate, steps)
    ?? grabbedSetupTargetSourceStep(candidate, steps)
    ?? previousActionTargetSourceStep(candidate, steps);
  if (!sourceStep) return candidate;

  const inheritedTarget = targetForCandidate(context, sourceStep);
  if (!inheritedTarget) return candidate;

  const currentTarget = targetForCandidate(context, candidate);
  if (sameTargetReference(currentTarget, inheritedTarget)) return candidate;

  // scoreCandidate seeds its reasons from action.reasons (so a caller can annotate an action
  // before scoring and keep that note). candidate.reasons/reason here are the STALE text from
  // scoring the candidate standalone against its original (wrong, pre-inheritance) target, so
  // they must be cleared, not carried forward, or the recompute below just appends fresh reasons
  // after the stale ones instead of replacing them.
  return scoreCandidate(context, { ...candidate, reason: undefined, reasons: undefined, preferredTarget: inheritedTarget });
}


export function plannedStepSatisfiesTargetCondition(context, candidate, step, optionGroup) {
  return samePlannedTarget(context, candidate, step)
    && stepSatisfiesTargetConditionRequirement(step, optionGroup);
}


export function targetConditionSatisfied(context, candidate, steps) {
  const optionGroups = targetConditionRequirementOptions(candidate);
  if (!optionGroups.length) return true;

  const target = targetForCandidate(context, candidate);
  return optionGroups.every((group) =>
    group.some((requirement) => targetHasCondition(target, requirement))
    || steps.some((step) => plannedStepSatisfiesTargetCondition(context, candidate, step, group)),
  );
}


export function currentAttackRange(candidate) {
  const values = [
    candidate?.range?.max,
    candidate?.targetingProfile?.maxRange,
    candidate?.targetingProfile?.range,
    candidate?.range?.increment,
    candidate?.activityProfile?.strikeReach,
  ]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number);
  const range = values.find((value) => Number.isFinite(value) && value >= 0);
  if (range !== undefined) return range;
  return candidate?.source === "strike" ? 5 : null;
}


export function isCompositionExtenderCandidate(candidate) {
  return candidate?.slug === "lingering-composition" || candidate?.activityProfile?.compositionExtender === true;
}


export function targetConditionChainBonus(context, steps) {
  let bonus = 0;

  for (const payoff of steps) {
    const groups = targetConditionRequirementOptions(payoff);
    if (!groups.length) continue;

    const source = steps.find((step) =>
      step !== payoff
      && groups.some((group) => plannedStepSatisfiesTargetCondition(context, payoff, step, group)),
    );
    if (!source) continue;

    bonus += TARGET_CONDITION_CHAIN_BONUS;
    if (isGrabRider(source)) bonus += GRAB_RIDER_CHAIN_BONUS;
  }

  return bonus;
}
