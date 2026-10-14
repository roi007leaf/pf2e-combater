import {
  candidateAppliedConditions,
  candidateTraitSlugs,
  conditionSatisfies,
  currentAttackRange,
  isAttackAction,
  isCompositionExtenderCandidate,
  profileReach,
  samePlannedTarget,
  targetForCandidate,
} from "./rules.js";
import {
  appliesProne,
  isCompositionExtensionEligible,
  isMoveAndStrike,
} from "./projections.js";
import { footprintPathDistanceFeet, movementFootprintForToken } from "../../rules/token-geometry.js";
import { contextActorDocument } from "../actor-context.js";
import { commanderTacticState } from "../../integrations/commanderer.js";
import { isConfluxSpell } from "../../rules/spellstrike-state.js";

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
  // On a real board the context is projected past earlier moves (it carries the planned square):
  // still out of reach means another Stride helps. Without geometry, fall back to Speed + reach.
  return context?.token?.plannedCenter
    ? distance > profileReach(context)
    : distance > profileSpeed(context) + profileReach(context);
}

export function isRepeatablePlanningAction(context, candidate, attackPathAvailable = false) {
  if (targetNeedsRepeatedStride(context, candidate, attackPathAvailable)) return true;
  return candidate.source === "strike" || isRepeatableSwarmAttack(context, candidate);
}

// A swarm's 1-action damage ability (Swarming Bites) is its whole offense and has no frequency:
// it can use it every action, like a Strike.
function isRepeatableSwarmAttack(context, candidate) {
  if (Number(candidate?.actionCost) !== 1 || !["save-damage", "damage"].includes(candidate?.role)) return false;
  if (String(candidate?.source ?? "").startsWith("spell")) return false;
  const raw = contextActorDocument(context)?.system?.traits?.value;
  const traits = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  if (!traits.includes("swarm")) return false;
  const item = candidate?.item;
  if (item?.system?.frequency) return false;
  return !/can['’]t use .* again|once per/i.test(String(item?.system?.description?.value ?? ""));
}

function allowsPostChargeTumbleThrough(context) {
  const battlefield = context?.battlefield ?? {};
  return Boolean(context?.postChargeTumbleThrough || battlefield.postChargeTumbleThrough);
}

function isStanceAction(step) {
  const slug = String(step?.slug ?? "").toLowerCase();
  const name = String(step?.name ?? "").toLowerCase();
  const traits = Array.isArray(step?.traits) ? step.traits.map((trait) => String(trait).toLowerCase()) : [];
  return step?.activityProfile?.stance === true
    || traits.includes("stance")
    || slug.endsWith("-stance")
    || name.includes(" stance");
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
  if (!Number.isFinite(range) || range < 0) return false;

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
  if (!Number.isFinite(range) || range < 0) return false;

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

function appliesHeldCondition(candidate) {
  return [...candidateAppliedConditions(candidate)]
    .some((condition) => conditionSatisfies("grabbed", condition));
}

function hasSameTargetHoldConflict(context, candidate, steps) {
  if (!appliesHeldCondition(candidate)) return false;
  const candidateTarget = targetForCandidate(context, candidate);
  if (!candidateTarget) return false;
  return steps.some((step) =>
    appliesHeldCondition(step)
    && targetForCandidate(context, step)
    && samePlannedTarget(context, candidate, step),
  );
}

// Another Stride is progress while the target is still out of reach from where the earlier moves end
// (the context here is projected past them). A straight-line check against Speed alone missed walls:
// the path around them is longer than the distance, so one Stride rarely gets there.
function canPairRepeatedStride(context, candidate, steps, attackPathAvailable = false) {
  if (attackPathAvailable || candidate?.slug !== "stride" || candidate?.source !== "generic") return false;
  if (!steps.every((step) => !BASIC_MOVE_SLUGS.has(step?.slug) || step?.slug === "stride")) return false;
  return targetNeedsRepeatedStride(context, candidate, attackPathAvailable);
}

export function hasAttackPathAvailable(context, candidates) {
  // Only an attack that can actually be made: an unreachable or blocked composite isn't a path.
  return candidates.some((candidate) =>
    candidate?.available !== false && !candidate?.needsApproach && Number(candidate?.score) > 0
    && isAttackAction(candidate)
    && (reachesCurrentTarget(context, candidate) || isMoveAndStrike(candidate)),
  );
}

// PF2e: a commander may use several tactics a round, but each character answers only one tactic per
// round. A tactic everyone answers leaves nobody for a second one; otherwise the responders the
// tactics need can't exceed the squad (the commander counts as a squadmate).
const RESPONDERS_NEEDED = { one: 1, two: 2, "up-to-2": 1, "up-to-3": 1 };
function tacticResponderConflict(context, candidate, steps) {
  const isTactic = (step) => (step?.item?.system?.traits?.value ?? []).includes("tactic");
  if (!isTactic(candidate)) return false;
  const tactics = [...steps.filter(isTactic), candidate];
  if (tactics.length < 2) return false;
  const actor = contextActorDocument(context);
  const states = tactics.map((step) => commanderTacticState(actor, step.item));
  if (states.some((state) => !state)) return false;
  if (states.some((state) => state.definition?.selection === "all")) return true;
  const needed = states.reduce((total, state) => total + (RESPONDERS_NEEDED[state.definition?.selection] ?? 1), 0);
  return needed > states[0].members.length + 1;
}

// Spellstrike is spent once used and stays spent until Recharge Spellstrike or a conflux spell:
// walk the plan so far to know whether it is charged when this step would come.
export function isSpellstrikeStep(step) {
  return step?.activityProfile?.spellstrike === true || /(?:^|-)spellstrike$/.test(String(step?.slug ?? "").toLowerCase()) && !String(step?.slug ?? "").toLowerCase().startsWith("recharge");
}
export function rechargesSpellstrike(step) {
  return step?.activityProfile?.rechargeSpellstrike === true || isConfluxSpell(step?.item);
}
function spellstrikeUncharged(context, candidate, steps) {
  if (!isSpellstrikeStep(candidate)) return false;
  let charged = (context?.profile ?? context?.actor?.profile)?.combatState?.spellstrikeNeedsRecharge !== true;
  for (const step of steps) {
    if (rechargesSpellstrike(step)) charged = true;
    else if (isSpellstrikeStep(step)) charged = false;
  }
  return !charged;
}

function normalizeRuneSlug(value) {
  const slug = String(value ?? "").toLowerCase();
  return /(?:^|-)trace-rune$/.test(slug) ? "trace-rune" : /(?:^|-)invoke-rune$/.test(slug) ? "invoke-rune" : "";
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

  // A drawn weapon stays in hand: drawing the same rapier twice wastes an action (thrown weapons
  // and bombs draw another one, so they can repeat).
  // A thrown weapon only needs drawing again once the plan has actually thrown it.
  const drawnItemId = (step) => step?.activityProfile?.drawsWeapon === true
    && !candidateTraitSlugs(step).includes("bomb")
    ? step?.item?.id ?? null : null;
  const thrownItem = (step, id) => (step?.item?.id ?? null) === id
    && (step?.altUsage === "thrown" || Number(step?.range?.increment) > 0);
  // Hands: every weapon drawn this turn (that isn't thrown away again) needs a free hand; a third
  // Draw with both hands full is impossible.
  const handsFree = Number(context?.profile?.handsFree ?? context?.actor?.profile?.handsFree);
  if (Number.isFinite(handsFree) && candidate?.activityProfile?.drawsWeapon === true && !candidateTraitSlugs(candidate).includes("bomb")) {
    const handsOf = (step) => Math.max(1, Number(step?.item?.system?.usage?.hands ?? step?.item?.hands) || 1);
    const kept = [...steps, candidate].filter((step) => step?.activityProfile?.drawsWeapon === true
      && !candidateTraitSlugs(step).includes("bomb")
      && !(step?.altUsage === "thrown" || Number(step?.range?.increment) > 0 && candidateTraitSlugs(step).some((trait) => trait.startsWith("thrown"))));
    const ids = new Set();
    const needed = kept.reduce((total, step) => {
      const id = step?.item?.id ?? step?.id;
      if (ids.has(id)) return total;
      ids.add(id);
      return total + handsOf(step);
    }, 0);
    if (needed > handsFree) return true;
  }
  const drawn = drawnItemId(candidate);
  if (drawn && steps.some((step) => drawnItemId(step) === drawn)
    && !steps.some((step) => thrownItem(step, drawn))) return true;

  if (tacticResponderConflict(context, candidate, steps)) return true;
  if (spellstrikeUncharged(context, candidate, steps)) return true;

  // Invoke Rune works on the creature bearing the rune: when this plan traces one, invoke it there.
  const runeSlug = (step) => normalizeRuneSlug(step?.slug ?? step?.id);
  const runeTarget = (step) => step?.suggestedTarget?.id ?? step?.preferredTarget?.id ?? null;
  const traced = [...steps, candidate].filter((step) => runeSlug(step) === "trace-rune" && runeTarget(step));
  const invoked = [...steps, candidate].filter((step) => runeSlug(step) === "invoke-rune" && runeTarget(step));
  if (traced.length && invoked.some((step) => !traced.some((trace) => runeTarget(trace) === runeTarget(step)))) return true;

  // A stowed weapon's Strike only exists once this plan has drawn it.
  if (candidate?.requiresDrawnWeaponId
    && !steps.some((step) => step?.activityProfile?.drawsWeapon === true && (step?.item?.id ?? null) === candidate.requiresDrawnWeaponId)) return true;

  // A fist right after drawing a weapon: Strike with the weapon you just drew instead.
  const isFist = (step) => step?.item?.slug === "basic-unarmed" || step?.item?.id === "xxPF2ExUNARMEDxx";
  const drewWeapon = (step) => step?.activityProfile?.drawsWeapon === true
    || (step?.activityProfile?.includes ?? []).includes("draw") || /\bquick draw\b/i.test(String(step?.name ?? ""));
  if (isFist(candidate) && steps.some(drewWeapon)) return true;

  // PF2e: one flourish per turn, and one composition per turn.
  const isFlourish = (step) => candidateTraitSlugs(step).includes("flourish");
  if (isFlourish(candidate) && steps.some(isFlourish)) return true;
  if (isCompositionExtensionEligible(candidate) && steps.some(isCompositionExtensionEligible)) return true;

  if (includesStand(candidate) && steps.some(includesStand)) {
    return true;
  }

  if (isStanceAction(candidate) && steps.some(isStanceAction)) {
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

  // "Don't walk if the attack already reaches" -- except for an approach candidate, which only
  // reaches on the projected board *because of* that move.
  if (
    (basicMove && steps.some((step) => !step.needsApproach && reachesCurrentTarget(context, step)))
    || (!candidate.needsApproach && reachesCurrentTarget(context, candidate) && steps.some((step) => BASIC_MOVE_SLUGS.has(step.slug)))
  ) {
    return true;
  }

  if (hasCommittedMoveTargetConflict(context, candidate, steps)) {
    return true;
  }

  if (hasSameTargetHoldConflict(context, candidate, steps)) {
    return true;
  }

  const hasSuddenCharge = steps.some((step) => step.slug === "sudden-charge");
  const hasTumbleThrough = steps.some((step) => step.slug === "tumble-through");
  const pairingChargeAndTumble = (candidate.slug === "tumble-through" && hasSuddenCharge)
    || (candidate.slug === "sudden-charge" && hasTumbleThrough);
  return pairingChargeAndTumble && !allowsPostChargeTumbleThrough(context);
}
