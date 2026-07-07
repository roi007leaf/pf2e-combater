import {
  currentAttackRange,
  isAttackAction,
  isCompositionExtenderCandidate,
  profileReach,
  targetForCandidate,
} from "./rules.js";
import {
  appliesProne,
  isCompositionExtensionEligible,
  isMoveAndStrike,
} from "./projections.js";

export const BASIC_MOVE_SLUGS = new Set(["crawl", "step", "stride"]);

const GENERIC_ATTACK_SLUGS = new Set(["trip", "grapple", "disarm", "shove", "reposition"]);
const PRONE_INCOMPATIBLE_MOVES = new Set(["stride", "step", "high-jump", "long-jump", "tumble-through"]);

export function includesStand(step) {
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

function stridesWithoutStanding(step) {
  if (includesStand(step)) return false;
  const profile = step?.activityProfile ?? {};
  if (PRONE_INCOMPATIBLE_MOVES.has(String(step?.slug ?? "").toLowerCase())) return true;
  if (Number(profile.strideCount) > 0) return true;
  const includes = Array.isArray(profile.includes) ? profile.includes.map((part) => String(part).toLowerCase()) : [];
  return includes.includes("stride") || includes.includes("step");
}

function profileSpeed(context) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const value = Number(profile.speed?.value ?? profile.speed ?? profile.landSpeed);
  return Number.isFinite(value) && value > 0 ? value : 25;
}

function targetNeedsRepeatedStride(context, candidate, attackPathAvailable = false) {
  if (attackPathAvailable) return false;
  if (candidate?.slug !== "stride" || candidate?.source !== "generic") return false;
  const target = targetForCandidate(context, candidate);
  const distance = Number(target?.distance);
  if (!Number.isFinite(distance)) return false;
  return distance > profileSpeed(context) + profileReach(context);
}

export function isRepeatablePlanningAction(context, candidate, attackPathAvailable = false) {
  if (targetNeedsRepeatedStride(context, candidate, attackPathAvailable)) return true;
  return candidate.source === "strike";
}

function allowsPostChargeTumbleThrough(context) {
  const battlefield = context?.battlefield ?? {};
  return Boolean(context?.postChargeTumbleThrough || battlefield.postChargeTumbleThrough);
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

export function hasAttackPathAvailable(context, candidates) {
  return candidates.some((candidate) =>
    isAttackAction(candidate)
    && (reachesCurrentTarget(context, candidate) || isMoveAndStrike(candidate)),
  );
}

export function hasPlanConflict(context, candidate, steps, attackPathAvailable = false) {
  if (candidate?.variantGroup && steps.some((step) => step?.variantGroup === candidate.variantGroup)) {
    return true;
  }

  const isPlainExtendableCantrip = (step) => isCompositionExtensionEligible(step)
    && !step?.activityProfile?.previousActionRequirements?.includes("lingering-composition");
  if (
    (isCompositionExtenderCandidate(candidate) && steps.some(isPlainExtendableCantrip))
    || (isPlainExtendableCantrip(candidate) && steps.some(isCompositionExtenderCandidate))
  ) {
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

  if (
    (appliesProne(candidate) && steps.some(stridesWithoutStanding))
    || (stridesWithoutStanding(candidate) && steps.some(appliesProne))
  ) {
    return true;
  }

  if (
    (appliesProne(candidate) && steps.some(isAttackAction))
    || (isAttackAction(candidate) && steps.some(appliesProne))
  ) {
    return true;
  }

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
