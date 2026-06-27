import { combineConfidence } from "./confidence.js";
import { contextTriggerEvents } from "../rules/event-context.js";

const BASE_ACTIONS = 3;
const MAX_CANDIDATES = 12;
const PRIMARY_CANDIDATES = 8;
const MAX_FREE_STEPS = 1;
const MAX_PLANS = 256;
const MAX_STRIKE_STEPS = 2;
const UNUSED_ACTION_PENALTY = 1;
const MAP_SCORE_WEIGHT = 3;
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_ALLOWED_SLUGS = new Set(["strike", "stride"]);
const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const BASIC_MOVE_SLUGS = new Set(["crawl", "step", "stride"]);
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

  for (const category of DIVERSE_CANDIDATE_CATEGORIES) {
    if (selected.some((candidate) => candidateCategory(candidate) === category)) continue;
    add(sortedCandidates.find((candidate) => candidateCategory(candidate) === category));
  }

  for (const candidate of sortedCandidates) add(candidate);
  return selected.toSorted((left, right) => {
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

// Stride and Step are illegal while prone (only Crawl or Stand-then-move). Crawl is fine.
const PRONE_INCOMPATIBLE_MOVES = new Set(["stride", "step"]);

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

function previousActionSatisfied(context, candidate, steps) {
  const requirements = previousActionRequirements(candidate);
  if (!requirements.length) return true;
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

function reachesCurrentTarget(context, candidate) {
  if (!isAttackAction(candidate)) return false;

  const range = currentAttackRange(candidate);
  if (!Number.isFinite(range) || range <= 0) return false;

  const target = targetForCandidate(context, candidate);
  const distance = Number(target?.distance);
  return Number.isFinite(distance) && distance <= range;
}

function hasPlanConflict(context, candidate, steps) {
  if (candidate?.variantGroup && steps.some((step) => step?.variantGroup === candidate.variantGroup)) {
    return true;
  }

  if (includesStand(candidate) && steps.some(includesStand)) {
    return true;
  }

  if (BASIC_MOVE_SLUGS.has(candidate.slug) && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug))) {
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
  const sortedCandidates = selectPlanningCandidates(candidates
    .filter((candidate) => Number.isFinite(candidate.actionCost))
    .filter((candidate) => candidate.actionCost >= 0 && candidate.actionCost <= budget.totalActions)
    .filter((candidate) => Number.isFinite(candidate.score))
    .toSorted((left, right) => right.score - left.score)
  );

  const plans = [];
  const seenPlans = new Set();

  function visit(startIndex, steps, normalCost, quickenedEligibleActions, freeSteps, attackCount, strikeCount, usedActions) {
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
      if (!previousActionSatisfied(context, candidate, steps)) continue;
      if (hasPlanConflict(context, candidate, steps)) continue;

      const repeatReloadCost = strikeAction && currentUses > 0 ? reloadCost(candidate) : 0;
      const candidateActionCost = Number(candidate.actionCost) + repeatReloadCost;

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

      const penalty = mapPenalty(candidate, attackCount);
      const plannedCandidate = attackAction
        ? {
          ...candidate,
          id: currentUses > 0 ? `${candidate.id ?? key}-map-${currentUses}` : candidate.id,
          name: repeatReloadCost > 0 ? `Reload -> ${candidate.name}` : candidate.name,
          actionCost: candidateActionCost,
          reloadCost: repeatReloadCost,
          activityProfile: repeatReloadCost > 0
            ? {
              ...(candidate.activityProfile ?? {}),
              reloadBeforeStrike: true,
              reloadCost: repeatReloadCost,
            }
            : candidate.activityProfile,
          mapPenalty: penalty,
          attackIndex: attackCount + 1,
          score: candidate.score - penalty * MAP_SCORE_WEIGHT,
          reason: [
            repeatReloadCost > 0 ? `Reloads before firing ${candidate.name}.` : "",
            penalty > 0 ? `${candidate.reason ?? ""} MAP -${penalty}.`.trim() : candidate.reason,
          ].filter(Boolean).join(" "),
        }
        : candidate;

      usedActions.set(key, currentUses + 1);
      steps.push(plannedCandidate);
      const nextStartIndex = requiresPreviousAction(candidate) && candidateActionCost === 0
        ? 0
        : attackAction ? index : index + 1;
      visit(
        nextStartIndex,
        steps,
        nextNormalCost,
        nextQuickenedEligibleActions,
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
