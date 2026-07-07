import { slugify } from "../../engine/action/text.js";
import { actionBudget } from "../../engine/action/budget.js";
import {
  centerPoint,
  distanceFromCenterToTarget,
  reachableAttackCenters,
  targetThreatReach,
} from "../action/reach.js";
import { compareTacticalCenters } from "../../rules/battlefield-analysis.js";
import { pf2eActionName, t } from "../../i18n.js";
import {
  contextProfile,
  meleeReach,
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

function actorHpPercent(profile) {
  const nested = Number(profile?.hp?.percent);
  if (Number.isFinite(nested)) return nested;
  const flat = Number(profile?.hpPercent);
  if (Number.isFinite(flat)) return flat;
  return 1;
}

const OFFENSIVE_SPELL_ROLES = new Set(["damage", "save-damage", "area-damage"]);

function isOffensiveRangedSpell(spell, reach) {
  if (spell?.available !== true) return false;
  if (!OFFENSIVE_SPELL_ROLES.has(spell?.role)) return false;
  if (spell?.targetingProfile?.enemy !== true) return false;
  const range = Number(spell?.targetingProfile?.maxRange);
  return Number.isFinite(range) && range > reach;
}

function skirmishFinishers(readyStrikes, spells, reach) {
  const finishers = [];
  for (const strike of readyStrikes) {
    if (!isRangedStrike(strike)) continue;
    const strikeReach = rangedStrikeReach(strike);
    if (strikeReach <= 5) continue;
    finishers.push({ kind: "strike", ref: strike, reach: strikeReach, actionCost: 1, average: candidateAverageDamage(strike) });
  }
  for (const spell of spells) {
    if (!isOffensiveRangedSpell(spell, reach)) continue;
    finishers.push({
      kind: "spell",
      ref: spell,
      reach: Number(spell.targetingProfile.maxRange),
      actionCost: Math.max(1, Number(spell.actionCost) || 1),
      average: candidateAverageDamage(spell),
    });
  }
  return finishers;
}

function bestMeleeDamage(readyStrikes) {
  return readyStrikes
    .filter((strike) => !isRangedStrike(strike))
    .reduce((best, strike) => Math.max(best, candidateAverageDamage(strike)), 0);
}

function retreatSquareForFinisher(context, target, finisher, speed, threatReach) {
  return reachableAttackCenters(context, target, speed, finisher.reach)
    .filter((center) => distanceFromCenterToTarget(context, center, target) > threatReach)
    .toSorted((left, right) => {
      const tactical = compareTacticalCenters(context, left, right, { target, preferFartherFromTarget: true });
      if (tactical !== 0) return tactical;
      const leftDistance = distanceFromCenterToTarget(context, left, target);
      const rightDistance = distanceFromCenterToTarget(context, right, target);
      if (leftDistance !== rightDistance) return rightDistance - leftDistance;
      return (left.cost ?? Infinity) - (right.cost ?? Infinity);
    })[0] ?? null;
}

function bestFinisherForTarget(context, target, finishers, speed, threatReach) {
  let best = null;
  for (const finisher of finishers) {
    const attackCenter = retreatSquareForFinisher(context, target, finisher, speed, threatReach);
    if (!attackCenter) continue;
    const better = !best
      || finisher.average > best.average
      || (finisher.average === best.average && finisher.actionCost < best.actionCost);
    if (better) best = { ...finisher, attackCenter };
  }
  return best;
}

function skirmishKitePlan(context, profile, readyStrikes, spells, budget) {
  const origin = centerPoint(context?.token);
  const speed = movementRange(profile);
  if (!origin || speed <= 0) return null;

  const actorMelee = meleeReach(profile);
  const finishers = skirmishFinishers(readyStrikes, spells, actorMelee);
  if (!finishers.length) return null;

  const fragile = actorHpPercent(profile) < 0.5;
  const bestMelee = bestMeleeDamage(readyStrikes);

  for (const target of uniqueTargets(context)) {
    const threatReach = targetThreatReach(target);
    const currentDistance = distanceFromCenterToTarget(context, origin, target);
    if (!Number.isFinite(currentDistance) || currentDistance > threatReach) continue;

    const finisher = bestFinisherForTarget(context, target, finishers, speed, threatReach);
    if (!finisher) continue;

    const rangedPrimary = finisher.average > 0 && finisher.average >= bestMelee;
    if (!fragile && !rangedPrimary) continue;

    const meleeStrike = readyStrikes.find((strike) =>
      !isRangedStrike(strike) && currentDistance <= strikeMeleeReach(strike),
    ) ?? null;
    const includeMelee = Boolean(meleeStrike) && (1 + 1 + finisher.actionCost) <= budget;
    if (!includeMelee && (1 + finisher.actionCost) > budget) continue;

    return {
      target,
      finisher,
      attackCenter: finisher.attackCenter,
      threatReach,
      meleeStrike: includeMelee ? meleeStrike : null,
    };
  }

  return null;
}

export function readSkirmishKiteActivities(context, readyStrikes, spells) {
  const profile = contextProfile(context);
  if (movementBlockingCondition(profile, { slug: "stride" })) return [];

  const budget = actionBudget(context).totalActions;
  if (budget < 2) return [];

  const plan = skirmishKitePlan(context, profile, readyStrikes, spells, budget);
  if (!plan) return [];

  const { target, finisher, attackCenter, threatReach, meleeStrike } = plan;
  const finisherName = finisher.ref.name ?? finisher.ref.slug ?? (finisher.kind === "spell" ? pf2eActionName("cast-a-spell", "Cast a Spell") : pf2eActionName("strike", "Strike"));
  const slug = slugify(finisherName);
  const verb = finisher.kind === "spell" ? t("Reason.CastVerb", "Cast") : finisherName;
  const namePrefix = meleeStrike ? `${meleeStrike.name} -> ` : "";

  return [{
    id: `skirmish-${finisher.kind}-${finisher.ref.id ?? slug}`,
    name: t("Action.SkirmishKite", "{prefix}Stride Away -> {finisher}", { prefix: namePrefix, finisher: finisherName }),
    slug: `skirmish-${finisher.kind}-${slug}`,
    actionCost: (meleeStrike ? 1 : 0) + 1 + finisher.actionCost,
    actionType: "action",
    source: "system-inferred",
    confidence: "medium",
    executable: "open-item",
    detected: true,
    available: true,
    item: finisher.ref.item ?? null,
    preferredTarget: target,
    role: "mobility-attack",
    activityProfile: {
      positionalTactic: "skirmish",
      meleeStrike,
      finisher: { kind: finisher.kind, ref: finisher.ref, actionCost: finisher.actionCost },
      includes: [...(meleeStrike ? ["strike"] : []), "stride", ...(finisher.kind === "strike" ? ["strike"] : [])],
      includesStrike: true,
      retreatBeforeStrike: true,
      strideCount: 1,
      strikeReach: finisher.reach,
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
    reasons: [meleeStrike
      ? t("Reason.KiteMelee", "Strike {target}, Stride out of reach, then {verb} from range.", { target: target.name, verb })
      : t("Reason.KiteRanged", "Stride out of {target}'s reach, then {verb} from range.", { target: target.name, verb })],
  }];
}
