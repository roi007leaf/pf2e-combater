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
import { footprintPathDistanceFeet, movementFootprintForToken } from "../../rules/token-geometry.js";

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

// A move-and-strike composite (e.g. "Stride -> Tentacle") has its own attackCenter -- the landing
// square its Stride repositions the actor to. The first such step's landing square, if any.
function firstAttackCenter(steps) {
  for (const step of steps) {
    const center = step?.activityProfile?.attackCenter;
    if (center) return center;
  }
  return null;
}

// A plain, independent attack candidate's (no attackCenter of its own) target may only be in range
// from the actor's CURRENT (pre-plan) position -- if a move-and-strike composite is or becomes
// part of the same plan, repositioning the actor elsewhere, this candidate's own target can become
// unreachable once that move actually happens. Also catches the same-target case where the move
// was sized for a LONGER-reaching action (e.g. a 10-ft-reach Tentacle) than this candidate has
// (e.g. a 5-ft generic maneuver like Grapple, which has no explicit range of its own) -- the two
// must not be assumed interchangeable just because they're aimed at the same enemy. Falls back to
// the actor's generic melee reach (profileReach) for candidates with no explicit range, matching
// how the candidate-generation/availability checks elsewhere already treat a bare maneuver's reach.
function plainCandidateUnreachableFromCenter(context, plainCandidate, attackCenter) {
  if (!isAttackAction(plainCandidate) || plainCandidate?.activityProfile?.attackCenter) return false;

  const target = targetForCandidate(context, plainCandidate);
  const targetCenter = target?.token?.center ?? target?.center;
  if (!target || !targetCenter) return false;

  const range = currentAttackRange(plainCandidate) ?? profileReach(context);
  if (!Number.isFinite(range) || range <= 0) return false;

  const footprint = movementFootprintForToken(context?.token);
  const distance = footprintPathDistanceFeet(attackCenter, footprint, targetCenter, target);
  return !(Number.isFinite(distance) && distance <= range);
}

// Candidates can be combined in either order while a plan is built -- the move-and-strike
// composite might already be committed when a plain action is considered, or a plain action might
// already be committed when the composite is considered later. Check both directions.
function hasCommittedMoveTargetConflict(context, candidate, steps) {
  const candidateCenter = candidate?.activityProfile?.attackCenter;
  if (candidateCenter) {
    return steps.some((step) => plainCandidateUnreachableFromCenter(context, step, candidateCenter));
  }
  const committedCenter = firstAttackCenter(steps);
  if (!committedCenter) return false;
  return plainCandidateUnreachableFromCenter(context, candidate, committedCenter);
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

  if (hasCommittedMoveTargetConflict(context, candidate, steps)) {
    return true;
  }

  const hasSuddenCharge = steps.some((step) => step.slug === "sudden-charge");
  const hasTumbleThrough = steps.some((step) => step.slug === "tumble-through");
  const pairingChargeAndTumble = (candidate.slug === "tumble-through" && hasSuddenCharge)
    || (candidate.slug === "sudden-charge" && hasTumbleThrough);
  return pairingChargeAndTumble && !allowsPostChargeTumbleThrough(context);
}
