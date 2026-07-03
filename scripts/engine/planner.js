import { combineConfidence } from "./confidence.js";
import { contextTriggerEvents } from "../rules/event-context.js";
import { scoreCandidate } from "./scoring.js";
import { t } from "../i18n.js";

const BASE_ACTIONS = 3;
const MAX_CANDIDATES = 12;
const PRIMARY_CANDIDATES = 8;
const CONDITION_SETUP_CANDIDATES = 4;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const MAP_SCORE_WEIGHT = 3;
const TARGET_CONDITION_CHAIN_BONUS = 36;
const GRAB_RIDER_CHAIN_BONUS = 24;
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_ALLOWED_SLUGS = new Set(["strike", "stride"]);
const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const BASIC_MOVE_SLUGS = new Set(["crawl", "step", "stride"]);
const GENERATED_STRIKE_COMPOSITE_PREFIXES = [
  "stand-stride-strike-",
  "stride-strike-stride-",
  "stride-away-strike-",
  "stride-strike-",
  "draw-strike-",
];
const COMPOSITE_MOVE_PART_NAMES = new Set(["crawl", "draw", "interact", "stand", "step", "stride", "stride-away"]);
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

function conditionValue(conditions, slug) {
  if (!conditions) return 0;
  const slugs = Array.isArray(conditions.slugs) ? conditions.slugs : [];
  if (!slugs.includes(slug)) return 0;

  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function effectMatchesSlug(effect, slug) {
  const normalized = normalizeSlug(slug);
  const values = [
    effect?.slug,
    effect?.name,
    effect?.label,
    effect?.system?.slug?.value,
    effect?.system?.slug,
  ].map(normalizeSlug);
  return values.some((value) => value === normalized || value === `effect-${normalized}`);
}

function effectValue(effects, slug) {
  if (!Array.isArray(effects)) return 0;
  const effect = effects.find((entry) => effectMatchesSlug(entry, slug));
  if (!effect) return 0;

  const value = Number(effect?.value ?? effect?.system?.value?.value ?? effect?.system?.badge?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function profileStateValue(profile, slug) {
  return Math.max(
    conditionValue(profile?.conditions, slug),
    effectValue(profile?.effects, slug),
  );
}

function spentNormalActions(context) {
  const spent = Number(
    context?.actionsSpent?.normal
      ?? context?.actionsSpent?.total
      ?? context?.profile?.actionsSpent?.normal
      ?? context?.profile?.actionsSpent?.total
      ?? 0,
  );
  return Number.isFinite(spent) && spent > 0 ? spent : 0;
}

export function actionBudget(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const slowed = profileStateValue(profile, "slowed");
  const stunned = profileStateValue(profile, "stunned");
  const quickened = profileStateValue(profile, "quickened");
  const spent = spentNormalActions(context);
  const normalActions = Math.max(0, BASE_ACTIONS - slowed - stunned - spent);

  return {
    normalActions,
    quickenedActions: quickened > 0 ? 1 : 0,
    totalActions: normalActions + (quickened > 0 ? 1 : 0),
    slowed,
    stunned,
    quickened,
    spent,
  };
}

function actionKey(candidate) {
  return candidate.id ?? candidate.slug ?? candidate.name;
}

function hasAgileTrait(candidate) {
  const traits = candidate.traits ?? candidate.weaponTraits ?? candidate.item?.system?.traits?.value ?? [];
  return Array.isArray(traits) && traits.includes("agile");
}

function planNumericPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function gridFeetPerPixel() {
  const size = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size);
  const distance = Number(globalThis.canvas?.scene?.grid?.distance ?? globalThis.canvas?.grid?.distance);
  return Number.isFinite(size) && size > 0 && Number.isFinite(distance) && distance > 0 ? distance / size : 1;
}

// Where the actor stands after the prior plan steps: a move-and-strike composite's attack square,
// or a committed Stride destination. Null when nothing moved the actor (base score already fits).
function priorProjectedCenter(steps) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const center = planNumericPoint(steps[index]?.activityProfile?.attackCenter)
      ?? planNumericPoint(steps[index]?.destination);
    if (center) return center;
  }
  return null;
}

function candidateTraitSlugs(candidate) {
  const values = [
    ...(Array.isArray(candidate?.traits) ? candidate.traits : []),
    ...(Array.isArray(candidate?.weaponTraits) ? candidate.weaponTraits : []),
    ...(Array.isArray(candidate?.item?.system?.traits?.value) ? candidate.item.system.traits.value : []),
  ];
  return values.map((trait) => String(trait?.slug ?? trait?.name ?? trait ?? "").toLowerCase()).filter(Boolean);
}

function candidateVolleyRange(candidate) {
  for (const trait of candidateTraitSlugs(candidate)) {
    const match = trait.match(/^volley-(\d+)$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

function candidateTargetCenter(candidate) {
  const target = candidate?.preferredTarget ?? candidate?.suggestedTarget ?? candidate?.target;
  return planNumericPoint(target?.token?.center) ?? planNumericPoint(target?.center);
}

// Per-step projected volley penalty: a Volley weapon fired from where a prior move lands the actor
// may be within its volley range even when the unmoved base position was not. Only the penalty the
// base score did NOT already include is added here, so scoring's base-position penalty isn't doubled.
function projectedVolleyPenalty(candidate, steps) {
  if (candidate?.source !== "strike") return 0;
  const volley = candidateVolleyRange(candidate);
  if (volley <= 0) return 0;

  const baseDistance = Number(candidate?.preferredTarget?.distance ?? Infinity);
  if (Number.isFinite(baseDistance) && baseDistance <= volley) return 0;

  const origin = priorProjectedCenter(steps);
  const targetCenter = candidateTargetCenter(candidate);
  if (!origin || !targetCenter) return 0;

  const projected = Math.hypot(targetCenter.x - origin.x, targetCenter.y - origin.y) * gridFeetPerPixel();
  return projected <= volley ? 10 : 0;
}

export function isAttackAction(candidate) {
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

function isSpellAction(candidate) {
  return String(candidate?.source ?? "").startsWith("spell");
}

function isStrikeLikeCandidate(candidate) {
  return isStrikeAction(candidate)
    || candidate?.activityProfile?.includesStrike === true
    || candidate?.activityProfile?.drawsWeapon === true;
}

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

function conditionValues(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}

function targetConditionRequirementOptions(candidate) {
  const profile = candidate?.activityProfile ?? {};
  const any = conditionValues(profile.requiresAnyTargetCondition).map(normalizeSlug).filter(Boolean);
  if (any.length) return [any];
  return conditionValues(profile.requiresTargetCondition)
    .map(normalizeSlug)
    .filter(Boolean)
    .map((condition) => [condition]);
}

function requiresTargetCondition(candidate) {
  return targetConditionRequirementOptions(candidate).length > 0;
}

function conditionSatisfies(requirement, condition) {
  if (requirement === condition) return true;
  return requirement === "grabbed" && condition === "restrained";
}

function candidateAppliedConditions(candidate) {
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

function stepSatisfiesTargetConditionRequirement(step, optionGroup) {
  const applied = candidateAppliedConditions(step);
  if (!applied.size) return false;
  return optionGroup.some((requirement) =>
    [...applied].some((condition) => conditionSatisfies(requirement, condition)),
  );
}

function isGrabRider(candidate) {
  return candidate?.activityProfile?.npcFamily === "grab-rider"
    || (candidate?.activityProfile?.includesGrab === true
      && previousActionRequirements(candidate).some((requirement) =>
        ["strike", "after-strike"].includes(normalizeSlug(requirement)),
      ));
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

function includesStand(step) {
  const includes = Array.isArray(step?.activityProfile?.includes) ? step.activityProfile.includes : [];
  return step?.slug === "stand"
    || step?.activityProfile?.removesCondition === "prone"
    || includes.map((entry) => String(entry ?? "").toLowerCase()).includes("stand");
}

function isCrawl(step) {
  const includes = Array.isArray(step?.activityProfile?.includes) ? step.activityProfile.includes : [];
  return step?.slug === "crawl"
    || Number(step?.activityProfile?.crawlDistance) > 0
    || includes.map((entry) => String(entry ?? "").toLowerCase()).includes("crawl");
}

function requiresProneForCover(step) {
  return step?.slug === "take-cover" && step?.activityProfile?.requiresProneCover === true;
}

// Stride/Step and athletic movement are illegal while prone (only Crawl or Stand-then-move).
// Crawl is intentionally allowed.
const PRONE_INCOMPATIBLE_MOVES = new Set(["stride", "step", "high-jump", "long-jump", "tumble-through"]);

function appliesProne(step) {
  // Match a slug that CONTAINS "drop-prone" — the live candidate's slug is the action id
  // ("generic-drop-prone"), not the bare "drop-prone", so an exact check missed it.
  const slug = String(step?.slug ?? "").toLowerCase();
  if (slug.includes("drop-prone") || step?.executable === "drop-prone") return true;
  const profile = step?.activityProfile ?? {};
  const applied = [profile.appliesCondition, ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : [])];
  return applied.includes("prone");
}

// Does this step Stride/Step WITHOUT first Standing? Such movement is illegal while prone. Catches
// bare Stride/Step AND move-and-strike composites (e.g. "stride-away-strike-dart", strideCount > 0)
// whose slug isn't a bare move slug. Stand-then-move (includesStand) and Crawl stay legal.
function stridesWithoutStanding(step) {
  if (includesStand(step)) return false;
  const profile = step?.activityProfile ?? {};
  if (PRONE_INCOMPATIBLE_MOVES.has(String(step?.slug ?? "").toLowerCase())) return true;
  if (Number(profile.strideCount) > 0) return true;
  const includes = Array.isArray(profile.includes) ? profile.includes.map((part) => String(part).toLowerCase()) : [];
  return includes.includes("stride") || includes.includes("step");
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}

function previousActionRequirements(candidate) {
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

function requiresPreviousAction(candidate) {
  return previousActionRequirements(candidate).length > 0;
}

function isNonCantripSpell(candidate) {
  if (!isSpellAction(candidate)) return false;
  if (candidate?.isCantrip === true) return false;
  const rank = Number(candidate?.castRank ?? candidate?.rank);
  return Number.isFinite(rank) ? rank > 0 : candidate?.isCantrip === false;
}

function stepSatisfiesPreviousRequirement(step, requirement) {
  if (!step) return false;
  const key = normalizeSlug(requirement);
  if (key === "previous-action") return true;
  if (key === "spell" || key === "spell-cast") return isSpellAction(step);
  if (key === "non-cantrip-spell") return isNonCantripSpell(step);
  if (key === "strike" || key === "after-strike") return isStrikeLikeCandidate(step);
  if (key === "attack") return isAttackAction(step);
  return false;
}

function stepSatisfiesPreviousRequirements(step, requirements) {
  const meaningful = requirements.filter((requirement) => requirement !== "previous-action");
  const valuesToCheck = meaningful.length ? meaningful : requirements;
  return valuesToCheck.every((requirement) => stepSatisfiesPreviousRequirement(step, requirement));
}

function contextSatisfiesPreviousRequirements(context, requirements) {
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

function requiresAfterStrike(requirements) {
  return requirements.some((requirement) => {
    const key = normalizeSlug(requirement);
    return key === "strike" || key === "after-strike";
  });
}

function isRangedAttackStep(step) {
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

function stepCanApplyNpcGrab(context, step) {
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

function requiresConcreteNpcGrabStrike(candidate, requirements) {
  return isGrabRider(candidate) && requiresAfterStrike(requirements);
}

function targetAlreadyHeldForNpcGrab(context, candidate) {
  const target = targetForCandidate(context, candidate);
  return targetHasCondition(target, "grabbed") || targetHasCondition(target, "restrained");
}

function previousActionSatisfied(context, candidate, steps) {
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

function profileSpeed(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const value = Number(profile.speed?.value ?? profile.speed ?? profile.landSpeed);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

function profileReach(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const value = Number(profile.reach?.value ?? profile.reach ?? profile.meleeReach);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

function targetNeedsRepeatedStride(context, candidate, attackPathAvailable = false) {
  if (attackPathAvailable) return false;
  if (candidate?.slug !== "stride" || candidate?.source !== "generic") return false;
  const target = targetForCandidate(context, candidate);
  const distance = Number(target?.distance);
  if (!Number.isFinite(distance)) return false;
  return distance > profileSpeed(context) + profileReach(context);
}

function isRepeatablePlanningAction(context, candidate, attackPathAvailable = false) {
  if (targetNeedsRepeatedStride(context, candidate, attackPathAvailable)) return true;
  return candidate.source === "strike";
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

function allowsPostChargeTumbleThrough(context) {
  const battlefield = context?.battlefield ?? {};
  return Boolean(context?.postChargeTumbleThrough || battlefield.postChargeTumbleThrough);
}

function isMoveAndStrike(step) {
  return step?.activityProfile?.includesStrike === true
    && Number(step?.activityProfile?.strideCount) > 0;
}

function endsAwayFromMelee(step) {
  const profile = step?.activityProfile ?? {};
  const targeting = step?.targetingProfile ?? {};
  if (profile.retreatToOrigin === true) return false;
  return profile.retreatBeforeStrike === true
    || profile.retreatAfterStrike === true
    || targeting.retreatBeforeStrike === true
    || targeting.retreatAfterStrike === true;
}

function isMeleeOnlyAction(candidate) {
  const targeting = candidate?.targetingProfile ?? {};
  const range = currentAttackRange(candidate);
  return candidate?.requiresEnemyInReach === true
    || targeting.requiresEnemyInReach === true
    || targeting.reach === true
    || targeting.melee === true
    || targeting.meleeOnly === true
    || GENERIC_ATTACK_SLUGS.has(candidate?.slug)
    || (candidate?.source === "strike" && Number.isFinite(range) && range <= 5);
}

function contextTargets(context) {
  return context?.targets ?? context?.battlefield?.targets ?? [];
}

function contextEnemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? contextTargets(context);
}

function targetIdentity(value) {
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

function targetForCandidate(context, candidate) {
  const fallback = contextTargets(context)[0] ?? contextEnemies(context)[0] ?? null;
  const reference = candidate?.preferredTarget ?? candidate?.suggestedTarget ?? fallback;
  if (!reference) return null;
  if (Number.isFinite(Number(reference.distance))) return reference;

  const ids = new Set(targetIdentity(reference));
  return [...contextTargets(context), ...contextEnemies(context)]
    .find((target) => targetIdentity(target).some((id) => ids.has(id)))
    ?? fallback;
}

function targetHasCondition(target, requirement) {
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

function samePlannedTarget(context, candidate, step) {
  const candidateTarget = targetForCandidate(context, candidate);
  const stepTarget = targetForCandidate(context, step);
  if (!candidateTarget || !stepTarget) return true;

  const candidateIds = new Set(targetIdentity(candidateTarget));
  const stepIds = targetIdentity(stepTarget);
  if (!candidateIds.size || !stepIds.length) return true;
  return stepIds.some((id) => candidateIds.has(id));
}

function sameTargetReference(left, right) {
  if (!left || !right) return false;
  const leftIds = new Set(targetIdentity(left));
  const rightIds = targetIdentity(right);
  if (!leftIds.size || !rightIds.length) return false;
  return rightIds.some((id) => leftIds.has(id));
}

function previousActionTargetSourceStep(candidate, steps) {
  const requirements = previousActionRequirements(candidate);
  if (!requirements.length) return null;

  const shouldInheritTarget = requirements.some((requirement) =>
    ["strike", "after-strike", "attack"].includes(normalizeSlug(requirement)),
  );
  if (!shouldInheritTarget) return null;

  const previousStep = steps.at(-1);
  return stepSatisfiesPreviousRequirements(previousStep, requirements) ? previousStep : null;
}

function grabbedSetupTargetSourceStep(candidate, steps) {
  const appliesGrabbed = [...candidateAppliedConditions(candidate)].some((condition) =>
    conditionSatisfies("grabbed", condition),
  );
  if (!appliesGrabbed) return null;

  const previousStep = steps.at(-1);
  if (!previousStep) return null;
  return isStrikeLikeCandidate(previousStep) ? previousStep : null;
}

function targetConditionSourceStep(context, candidate, steps) {
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

function inheritPlannedTarget(context, candidate, steps) {
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

function plannedStepSatisfiesTargetCondition(context, candidate, step, optionGroup) {
  return samePlannedTarget(context, candidate, step)
    && stepSatisfiesTargetConditionRequirement(step, optionGroup);
}

function targetConditionSatisfied(context, candidate, steps) {
  const optionGroups = targetConditionRequirementOptions(candidate);
  if (!optionGroups.length) return true;

  const target = targetForCandidate(context, candidate);
  return optionGroups.every((group) =>
    group.some((requirement) => targetHasCondition(target, requirement))
    || steps.some((step) => plannedStepSatisfiesTargetCondition(context, candidate, step, group)),
  );
}

function currentAttackRange(candidate) {
  const values = [
    candidate?.range?.max,
    candidate?.targetingProfile?.maxRange,
    candidate?.targetingProfile?.range,
    candidate?.range?.increment,
    candidate?.activityProfile?.strikeReach,
  ].map(Number);
  const range = values.find((value) => Number.isFinite(value) && value > 0);
  if (range) return range;
  return candidate?.source === "strike" ? 5 : null;
}

function generatedStrikeActionKey(candidate) {
  const values = [
    candidate?.id,
    candidate?.slug,
  ].map((value) => String(value ?? "").toLowerCase()).filter(Boolean);

  for (const value of values) {
    for (const prefix of GENERATED_STRIKE_COMPOSITE_PREFIXES) {
      if (!value.startsWith(prefix)) continue;
      const suffix = value.slice(prefix.length);
      if (!suffix) continue;
      return suffix.startsWith("strike-") ? suffix : `strike-${suffix}`;
    }
  }
  return null;
}

function strikeLeafName(candidate) {
  const directName = candidate?.strike?.label
    ?? candidate?.strike?.name
    ?? candidate?.strike?.item?.name
    ?? candidate?.item?.name;
  if (directName) return String(directName);

  const parts = String(candidate?.name ?? "")
    .split(" -> ")
    .map((part) => part.trim())
    .filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (!COMPOSITE_MOVE_PART_NAMES.has(normalizeSlug(parts[index]))) return parts[index];
  }
  return String(candidate?.name ?? "Strike").trim() || "Strike";
}

function strikeDamageScoreEstimate(averageDamage) {
  return Math.min(averageDamage * 2, 40) + averageDamage * 0.25;
}

function followUpStrikeScore(candidate) {
  const average = Number(
    candidate?.damageProfile?.average
      ?? candidate?.activityProfile?.averageDamage
      ?? candidate?.averageDamage,
  );
  const directScore = 46 + 24 + (Number.isFinite(average) && average > 0 ? strikeDamageScoreEstimate(average) : 0);
  const compositeScore = Number(candidate?.score);
  const projectedScore = Number.isFinite(compositeScore) ? compositeScore - 55 : directScore;
  return Math.max(52, directScore, projectedScore);
}

function projectedFollowUpStrikeCandidate(candidate) {
  if (!isMoveAndStrike(candidate)) return null;
  if (Number(candidate?.actionCost) >= BASE_ACTIONS) return null;

  const id = generatedStrikeActionKey(candidate);
  if (!id) return null;

  const range = currentAttackRange(candidate);
  const sourceKey = actionKey(candidate);
  return {
    ...candidate,
    id,
    slug: "strike",
    name: strikeLeafName(candidate),
    actionCost: 1,
    cost: 1,
    source: "strike",
    executable: "strike",
    attackTrait: true,
    available: true,
    range: Number.isFinite(range) && range > 0 ? { ...(candidate.range ?? {}), max: range } : candidate.range,
    score: followUpStrikeScore(candidate),
    reason: t("Plan.ProjectedFollowUpStrike", "{name} is in range after the movement.", { name: strikeLeafName(candidate) }),
    activityProfile: {
      ...(candidate.activityProfile ?? {}),
      includes: ["strike"],
      includesStrike: true,
      strideCount: 0,
      retreatBeforeStrike: false,
      retreatAfterStrike: false,
      requiresProjectedAfterKey: sourceKey,
    },
  };
}

function projectedTakeCoverAfterProneCandidate(candidate) {
  if (!appliesProne(candidate)) return null;
  return {
    id: "take-cover",
    slug: "take-cover",
    name: t("Action.TakeCover", "Take Cover"),
    actionCost: 1,
    cost: 1,
    source: "generic",
    role: "defense",
    confidence: "medium",
    executable: "pf2e-action",
    detected: true,
    available: true,
    score: 28,
    reason: t("Plan.TakeCoverAfterProne", "Take Cover after dropping prone."),
    activityProfile: {
      includes: ["take-cover"],
      requiresProneCover: true,
      requiresProjectedAfterKey: actionKey(candidate),
    },
  };
}

function withProjectedFollowUpStrikeCandidates(candidates) {
  return candidates.flatMap((candidate) => {
    const followUps = [
      projectedFollowUpStrikeCandidate(candidate),
      projectedTakeCoverAfterProneCandidate(candidate),
    ].filter(Boolean);
    return followUps.length ? [candidate, ...followUps] : [candidate];
  });
}

function projectedFollowUpSatisfied(context, candidate, steps) {
  const sourceKey = candidate?.activityProfile?.requiresProjectedAfterKey;
  if (!sourceKey) return true;
  if (!steps.some((step) => actionKey(step) === sourceKey)) return false;

  const origin = priorProjectedCenter(steps);
  const targetCenter = candidateTargetCenter(candidate);
  if (!origin || !targetCenter) return true;

  const range = currentAttackRange(candidate);
  if (!Number.isFinite(range) || range <= 0) return true;

  const distance = Math.hypot(targetCenter.x - origin.x, targetCenter.y - origin.y) * gridFeetPerPixel();
  return distance <= range + 1e-6;
}

function reachesCurrentTarget(context, candidate) {
  if (!isAttackAction(candidate)) return false;

  const range = currentAttackRange(candidate);
  if (!Number.isFinite(range) || range <= 0) return false;

  const target = targetForCandidate(context, candidate);
  const distance = Number(target?.distance);
  return Number.isFinite(distance) && distance <= range;
}

function canPairRepeatedStride(context, candidate, steps, attackPathAvailable = false) {
  return targetNeedsRepeatedStride(context, candidate, attackPathAvailable)
    && steps.every((step) =>
      !BASIC_MOVE_SLUGS.has(step?.slug) || targetNeedsRepeatedStride(context, step, attackPathAvailable),
    );
}

function hasAttackPathAvailable(context, candidates) {
  return candidates.some((candidate) =>
    isAttackAction(candidate)
    && (reachesCurrentTarget(context, candidate) || isMoveAndStrike(candidate)),
  );
}

function hasPlanConflict(context, candidate, steps, attackPathAvailable = false) {
  if (candidate?.variantGroup && steps.some((step) => step?.variantGroup === candidate.variantGroup)) {
    return true;
  }

  if (includesStand(candidate) && steps.some(includesStand)) {
    return true;
  }

  if (
    (includesStand(candidate) && steps.some((step) => isCrawl(step) || requiresProneForCover(step)))
    || ((isCrawl(candidate) || requiresProneForCover(candidate)) && steps.some(includesStand))
  ) {
    return true;
  }

  if (
    BASIC_MOVE_SLUGS.has(candidate.slug)
    && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug))
    && !canPairRepeatedStride(context, candidate, steps, attackPathAvailable)
  ) {
    return true;
  }

  // "Drop Prone -> Stride" is nonsensical: you can't Stride/Step while prone (only Crawl/Stand),
  // and the planner won't slip a Stand between them. Forbid pairing a prone-applying action with any
  // striding action in either order — including move-and-strike composites (e.g.
  // "stride-away-strike-dart") whose slug isn't a bare move slug.
  if (
    (appliesProne(candidate) && steps.some(stridesWithoutStanding))
    || (stridesWithoutStanding(candidate) && steps.some(appliesProne))
  ) {
    return true;
  }

  // Prone gives the actor a -2 circumstance penalty to attack rolls. Don't build plans that spend
  // an action becoming prone and then attack in the same turn (or attack first, then pad with prone).
  if (
    (appliesProne(candidate) && steps.some(isAttackAction))
    || (isAttackAction(candidate) && steps.some(appliesProne))
  ) {
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

  const candidateEndsAway = endsAwayFromMelee(candidate);
  const existingEndsAway = steps.some(endsAwayFromMelee);
  const candidateMeleeOnly = isMeleeOnlyAction(candidate);
  const existingMeleeOnly = steps.some(isMeleeOnlyAction);
  if (
    (existingEndsAway && candidateMeleeOnly)
    || (candidateEndsAway && existingMeleeOnly)
  ) {
    return true;
  }

  // If an attack already reaches from the current square, don't spend a generic
  // Step/Stride just to pair it with that attack. Movement for closing remains
  // available when the attack is actually out of range.
  if (
    (basicMove && steps.some((step) => reachesCurrentTarget(context, step)))
    || (reachesCurrentTarget(context, candidate) && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug)))
  ) {
    return true;
  }

  const hasSuddenCharge = steps.some((step) => step.slug === "sudden-charge");
  const hasTumbleThrough = steps.some((step) => step.slug === "tumble-through");
  const pairingChargeAndTumble = (candidate.slug === "tumble-through" && hasSuddenCharge)
    || (candidate.slug === "sudden-charge" && hasTumbleThrough);
  return pairingChargeAndTumble && !allowsPostChargeTumbleThrough(context);
}

function targetConditionChainBonus(context, steps) {
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
    .filter((candidate) => Number.isFinite(candidate.actionCost))
    .filter((candidate) => candidate.actionCost >= 0 && candidate.actionCost <= budget.totalActions)
    .filter((candidate) => Number.isFinite(candidate.score))
    .toSorted((left, right) => right.score - left.score);
  const sortedCandidates = withProjectedFollowUpStrikeCandidates(selectPlanningCandidates(eligibleCandidates));

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
