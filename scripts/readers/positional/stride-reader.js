import { slugify } from "../../engine/action/text.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../../engine/target-pool.js";
import {
  bestReachableAttackCenter,
  canMoveIntoReach,
  readyStrikeCanReach,
} from "../action/reach.js";
import { t } from "../../i18n.js";
import {
  canStandBeforeMovement,
  contextProfile,
  meleeReach,
  movementBlockingCondition,
  movementRange,
} from "../action/reader-helpers.js";
import { strikeMeleeReach } from "./tactic-helpers.js";

function strideStrikePlan(context, profile, strike, readyStrikes, maxStrides = 2) {
  const reach = strikeMeleeReach(strike);
  const speed = movementRange(profile);
  const oneStride = speed + reach;
  const twoStrides = speed * 2 + reach;
  for (const target of [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget)) {
    const distance = target?.distance ?? Infinity;
    if (readyStrikeCanReach(readyStrikes, target)) continue;
    if (maxStrides >= 1 && distance <= oneStride) {
      const attackCenter = bestReachableAttackCenter(context, target, speed, reach);
      if (attackCenter) return { target, strides: 1, attackCenter };
      if (canMoveIntoReach(context, target, speed, reach)) return { target, strides: 1 };
    }
    if (maxStrides >= 2 && distance <= twoStrides) {
      const attackCenter = bestReachableAttackCenter(context, target, speed * 2, reach);
      if (attackCenter) return { target, strides: 2, attackCenter };
      if (canMoveIntoReach(context, target, speed * 2, reach)) return { target, strides: 2 };
    }
  }
  return null;
}

export function readStrideStrikeActivities(context, readyStrikes) {
  const profile = contextProfile(context);
  const standFirst = canStandBeforeMovement(profile);
  if (!standFirst && movementBlockingCondition(profile, { slug: "stride" })) return [];

  const seenTargets = new Set();
  return readyStrikes.flatMap((strike) => {
    const reach = strikeMeleeReach(strike);
    const plan = strideStrikePlan(context, profile, strike, readyStrikes, standFirst ? 1 : 2);
    if (!plan) return [];
    const { target, strides, attackCenter } = plan;
    const actionCost = strides + 1 + (standFirst ? 1 : 0);
    if (actionCost > 3) return [];

    const key = target.id ?? target.name;
    if (seenTargets.has(key)) return [];
    seenTargets.add(key);

    const slug = slugify(strike.name ?? strike.slug ?? "strike");
    const movePrefix = `${standFirst ? t("Action.StandArrow", "Stand -> ") : ""}${t("Action.StrideArrow", "Stride -> ").repeat(strides)}`;
    return [{
      id: `${standFirst ? "stand-" : ""}stride-strike-${strike.id ?? slug}`,
      name: `${movePrefix}${strike.name}`,
      slug: `${standFirst ? "stand-" : ""}stride-strike-${slug}`,
      actionCost,
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
        includes: [...(standFirst ? ["stand"] : []), ...Array(strides).fill("stride"), "strike"],
        includesStrike: true,
        removesCondition: standFirst ? "prone" : null,
        strideCount: strides,
        strikeReach: reach,
        attackCenter,
      },
      targetingProfile: {
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      attackTrait: true,
      setupFor: [],
      reasons: [standFirst
        ? t("Reason.StandStrideStrike", "Stand, Stride into reach, and Strike {target}.", { target: target.name })
        : strides > 1
          ? t("Reason.StrideTwiceStrike", "Stride twice into reach and Strike {target}.", { target: target.name })
          : t("Reason.StrideStrike", "Stride into reach and Strike {target}.", { target: target.name })],
    }];
  });
}

function strideMultiattackPlan(context, profile, reach, maxStrides) {
  const speed = movementRange(profile);
  for (const target of [...contextTargets(context), ...contextEnemies(context)].filter(canAttackTarget)) {
    const distance = target?.distance ?? Infinity;
    if (distance <= reach) continue;
    if (maxStrides >= 1 && distance <= speed + reach) {
      const attackCenter = bestReachableAttackCenter(context, target, speed, reach);
      if (attackCenter) return { target, strides: 1, attackCenter };
      if (canMoveIntoReach(context, target, speed, reach)) return { target, strides: 1 };
    }
    if (maxStrides >= 2 && distance <= speed * 2 + reach) {
      const attackCenter = bestReachableAttackCenter(context, target, speed * 2, reach);
      if (attackCenter) return { target, strides: 2, attackCenter };
      if (canMoveIntoReach(context, target, speed * 2, reach)) return { target, strides: 2 };
    }
  }
  return null;
}

export function readStrideMultiattackActivities(context, generatedActivities) {
  const profile = contextProfile(context);
  const standFirst = canStandBeforeMovement(profile);
  if (!standFirst && movementBlockingCondition(profile, { slug: "stride" })) return [];

  const multiattacks = generatedActivities.filter((action) =>
    action.available !== false
    && action.activityProfile?.requiresBackingStrike
    && (action.activityProfile?.includes ?? []).every((part) => part === "strike"));
  if (!multiattacks.length) return [];

  const reach = meleeReach(profile);
  const plan = strideMultiattackPlan(context, profile, reach, standFirst ? 1 : 2);
  if (!plan) return [];
  const { target, strides, attackCenter } = plan;

  return multiattacks.flatMap((action) => {
    const actionCost = strides + action.actionCost + (standFirst ? 1 : 0);
    if (actionCost > 3) return [];

    const movePrefix = `${standFirst ? t("Action.StandArrow", "Stand -> ") : ""}${t("Action.StrideArrow", "Stride -> ").repeat(strides)}`;
    return [{
      ...action,
      id: `${standFirst ? "stand-" : ""}stride-${action.id ?? action.slug}`,
      name: `${movePrefix}${action.name}`,
      slug: `${standFirst ? "stand-" : ""}stride-${action.slug}`,
      actionCost,
      source: "system-inferred",
      preferredTarget: target,
      role: "mobility-attack",
      activityProfile: {
        ...action.activityProfile,
        includes: [...(standFirst ? ["stand"] : []), ...Array(strides).fill("stride"), ...action.activityProfile.includes],
        strideCount: strides,
        strikeReach: reach,
        attackCenter,
        removesCondition: standFirst ? "prone" : null,
        precedingMoveAtomCount: strides + (standFirst ? 1 : 0),
        abilityActionCost: action.actionCost,
      },
      targetingProfile: {
        ...action.targetingProfile,
        enemy: true,
        reachAfterMove: true,
        preferredTargetId: target.id ?? null,
        preferredTargetName: target.name ?? null,
      },
      setupFor: [],
      reasons: [standFirst
        ? t("Reason.StandStrideMultiattack", "Stand, Stride into reach, and use {action} on {target}.", { action: action.name, target: target.name })
        : strides > 1
          ? t("Reason.StrideTwiceMultiattack", "Stride twice into reach and use {action} on {target}.", { action: action.name, target: target.name })
          : t("Reason.StrideMultiattack", "Stride into reach and use {action} on {target}.", { action: action.name, target: target.name })],
    }];
  });
}
