import { entityKey as targetKey } from "../../foundry-data.js";
import { slugify } from "../../engine/action/text.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../../engine/target-pool.js";
import {
  actionCanReach,
  canReturnToOrigin,
  centerPoint,
  distanceFromCenterToTarget,
  reachableAttackCenters,
  readyStrikeCanReach,
  targetThreatReach,
} from "../action/reach.js";
import { compareTacticalCenters } from "../../rules/battlefield-analysis.js";
import { aggroTargetValue } from "../../rules/aggro.js";
import { isVisionerActive, readVisionerCoverState } from "../../integrations/visioner.js";
import { t } from "../../i18n.js";
import {
  contextProfile,
  movementBlockingCondition,
  movementRange,
  uniqueTargets,
} from "../action/reader-helpers.js";
import {
  candidateAverageDamage,
  isRangedStrike,
  rangedStrikeReach,
  strikeMeleeReach,
} from "./tactic-helpers.js";

function rangedRetreatStrikePlan(context, profile, strike) {
  if (!isRangedStrike(strike)) return null;

  const origin = centerPoint(context?.token);
  const reach = rangedStrikeReach(strike);
  const speed = movementRange(profile);
  if (!origin || reach <= 5 || speed <= 0) return null;

  for (const target of uniqueTargets(context)) {
    if (!actionCanReach(strike, target)) continue;

    const threatReach = targetThreatReach(target);
    const currentDistance = distanceFromCenterToTarget(context, origin, target);
    if (!Number.isFinite(currentDistance) || currentDistance > threatReach) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => distanceFromCenterToTarget(context, center, target) > threatReach)
      .toSorted((left, right) => {
        const tactical = compareTacticalCenters(context, left, right, { target, preferFartherFromTarget: true });
        if (tactical !== 0) return tactical;
        const leftDistance = distanceFromCenterToTarget(context, left, target);
        const rightDistance = distanceFromCenterToTarget(context, right, target);
        if (leftDistance !== rightDistance) return rightDistance - leftDistance;
        return (left.cost ?? Infinity) - (right.cost ?? Infinity);
      })[0] ?? null;

    if (attackCenter) return { target: shotTarget(context, strike, attackCenter, reach, target), escaping: target, attackCenter, threatReach };
  }

  return null;
}

// Who to escape and whom to shoot are different questions: from the new square, shoot whoever the
// aggro model ranks highest among the enemies the Strike reaches (the escaped one by default).
function shotTarget(context, strike, center, reach, escaping) {
  let best = escaping;
  let bestValue = aggroTargetValue(context, strike, "damage", escaping);
  for (const target of uniqueTargets(context)) {
    if (target === escaping || !canAttackTarget(target)) continue;
    if (!(distanceFromCenterToTarget(context, center, target) <= reach)) continue;
    const value = aggroTargetValue(context, strike, "damage", target);
    if (value > bestValue) { best = target; bestValue = value; }
  }
  return best;
}

export function readRangedRetreatStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const plan = rangedRetreatStrikePlan(context, profile, strike);
    if (!plan) return [];
    const { target, escaping, attackCenter, threatReach } = plan;

    const targetKeyValue = targetKey(target);
    if (targetKeyValue && seenTargets.has(targetKeyValue)) return [];
    if (targetKeyValue) seenTargets.add(targetKeyValue);

    const reach = rangedStrikeReach(strike);
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `stride-away-strike-${strike.id ?? slug}`,
      name: t("Action.StrideAwayStrike", "Stride Away -> {strike}", { strike: strike.name }),
      slug: `stride-away-strike-${slug}`,
      actionCost: 2,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "open-item",
      detected: true,
      available: true,
      item: strike.item ?? null,
      averageDamage: candidateAverageDamage(strike) || null,
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        includes: ["stride", "strike"],
        includesStrike: true,
        retreatBeforeStrike: true,
        strideCount: 1,
        strikeReach: reach,
        threatReach,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        retreatBeforeStrike: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [escaping === target
        ? t("Reason.StrideAwayStrike", "Stride away from {target}, then Strike with {strike}.", { target: target.name, strike: strike.name })
        : t("Reason.StrideAwayStrikeOther", "Stride away from {escaping}, then Strike {target} with {strike}.", { escaping: escaping.name, target: target.name, strike: strike.name })],
    }];
  });
}

const DEFENSIVE_COVER_STATES = new Set(["lesser", "standard", "greater"]);

function usefulCoverState(state) {
  const normalized = String(state ?? "").toLowerCase();
  return DEFENSIVE_COVER_STATES.has(normalized) ? normalized : null;
}

function originCoverFromTarget(context, target) {
  if (!isVisionerActive()) return null;
  return usefulCoverState(readVisionerCoverState(target, context));
}

function skirmishStrikePlan(context, profile, strike, readyStrikes) {
  const reach = strikeMeleeReach(strike);
  if (reach <= 5) return null;

  const speed = movementRange(profile);
  const meleeStrikes = readyStrikes.filter((ready) => !isRangedStrike(ready));
  for (const target of [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget)) {
    if (readyStrikeCanReach(meleeStrikes, target) || (target?.distance ?? Infinity) <= reach) continue;

    const coverState = originCoverFromTarget(context, target);
    if (!coverState) continue;

    const attackCenter = reachableAttackCenters(context, target, speed, reach)
      .filter((center) => canReturnToOrigin(context, center, speed))
      .toSorted((left, right) => compareTacticalCenters(context, left, right, { target }))[0] ?? null;
    if (attackCenter) return { target, coverState, attackCenter };
  }
  return null;
}

export function readSkirmishStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const plan = skirmishStrikePlan(context, profile, strike, readyStrikes);
    if (!plan) return [];
    const { target, coverState, attackCenter } = plan;

    const key = target.id ?? target.name;
    if (seenTargets.has(key)) return [];
    seenTargets.add(key);

    const reach = strikeMeleeReach(strike);
    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    return [{
      id: `stride-strike-stride-${strike.id ?? slug}`,
      name: t("Action.StrideStrikeStride", "Stride -> {strike} -> Stride", { strike: strike.name }),
      slug: `stride-strike-stride-${slug}`,
      actionCost: 3,
      actionType: "action",
      source: "system-inferred",
      confidence: "medium",
      executable: "open-item",
      detected: true,
      available: true,
      item: strike.item ?? null,
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        includes: ["stride", "strike", "stride"],
        includesStrike: true,
        retreatAfterStrike: true,
        retreatToOrigin: true,
        strideCount: 2,
        strikeReach: reach,
        defensiveCoverState: coverState,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        retreatAfterStrike: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [t("Reason.StrideReturnCover", "Stride to attack {target}, then return to {cover} cover.", { target: target.name, cover: coverState })],
    }];
  });
}
