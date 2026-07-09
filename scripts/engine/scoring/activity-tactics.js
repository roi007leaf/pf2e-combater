import { threatsAtCenter } from "../../rules/battlefield-analysis.js";
import { attackableEnemies } from "./targets.js";
import {
  canUseTargetDefenses,
  hpPercent,
} from "./facts.js";
import {
  activityMoveReach,
  activityStrikeReach,
  inActionReach,
  isCurated,
  plural,
  profileMoveReach,
  profileReach,
  profileSpeed,
} from "./tactic-helpers.js";
import { t } from "../../i18n.js";

function attackCenter(action) {
  const center = action?.activityProfile?.attackCenter;
  const x = Number(center?.x);
  const y = Number(center?.y);
  const cost = Number(center?.cost);
  return Number.isFinite(x) && Number.isFinite(y)
    ? {
      x,
      y,
      ...(Number.isFinite(cost) ? { cost } : {}),
    }
    : null;
}

function routeBudgetUse(profile, action) {
  const center = attackCenter(action);
  const cost = Number(center?.cost);
  const strideCount = Number(action?.activityProfile?.strideCount ?? 0);
  if (!Number.isFinite(cost) || cost <= 0 || strideCount <= 0) return null;
  const budget = profileSpeed(profile) * strideCount;
  if (!Number.isFinite(budget) || budget <= 0) return null;
  return { cost, budget, remaining: budget - cost };
}

export function scoreActivityProfileTactics(context, action, {
  profile,
  target,
  score,
  reasons,
  pressure,
} = {}) {
  let nextScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const nextReasons = Array.isArray(reasons) ? reasons : [];

  if (action.slug === "sudden-charge" && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const chargeReach = speed * 2 + reach;

    if (distance > reach && distance <= chargeReach) {
      nextScore += 72;
      nextReasons.push(t("ScoreReason.ClosesAndAttacks", "Closes {distance} ft and attacks in one activity.", { distance }));
    } else if (distance <= reach) {
      nextScore -= 18;
      nextReasons.push(t("ScoreReason.AlreadyInReachSudden", "Already in reach; Sudden Charge has less value."));
    } else {
      nextScore -= 24;
      nextReasons.push(t("ScoreReason.TargetIsBeyondSudden", "Target is beyond Sudden Charge reach."));
    }
  }

  if (action.activityProfile?.includesStrike && action.activityProfile?.strideCount > 0 && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const moveReach = speed * Number(action.activityProfile.strideCount ?? 1) + activityStrikeReach(profile, action);
    const center = attackCenter(action);
    const destinationThreatCount = center ? threatsAtCenter(context, center).length : null;
    const routeUse = routeBudgetUse(profile, action);

    if (action.activityProfile?.retreatBeforeStrike) {
      nextScore += 66;
      nextReasons.unshift(t("ScoreReason.MovesOutOfMeleeBefore", "Moves out of melee before attacking {p0}.", { p0: target.name }));
      if (destinationThreatCount !== null && destinationThreatCount < pressure.meleeThreats.length) {
        nextScore += 20;
        nextReasons.push(t("ScoreReason.AttackSquareReducesMelee", "Attack square reduces melee exposure."));
      }
    } else if (distance > reach && distance <= moveReach) {
      nextScore += 60;
      nextReasons.unshift(t("ScoreReason.MovesIntoReachAndAttacks", "Moves into reach and attacks {p0}.", { p0: target.name }));
    } else if (distance <= reach) {
      nextScore += 18;
      nextReasons.unshift(t("ScoreReason.IsAlreadyInReachFor", "{p0} is already in reach for the attack.", { p0: target.name }));
    } else {
      nextScore -= 30;
      nextReasons.unshift(t("ScoreReason.TargetIsBeyondThisMove", "Target is beyond this move-and-attack activity."));
    }

    if (destinationThreatCount !== null && !action.activityProfile?.retreatBeforeStrike) {
      if (destinationThreatCount > Math.max(1, pressure.meleeThreats.length)) {
        nextScore -= 18 + destinationThreatCount * 4;
        nextReasons.push(t("ScoreReason.AttackSquareEndsIn", "Attack square ends in heavy enemy reach."));
      } else if (action.activityProfile?.retreatAfterStrike && action.activityProfile?.defensiveCoverState) {
        nextScore += 18;
        nextReasons.push(t("ScoreReason.PlanReturnsToCover", "Plan returns to cover after attacking."));
      }
    }

    if (routeUse) {
      const cost = Math.round(routeUse.cost);
      const budget = Math.round(routeUse.budget);
      nextReasons.push(t("ScoreReason.TerrainRouteCosts", "Terrain-aware route costs {cost} ft of {budget} ft.", { cost, budget }));
      if (routeUse.remaining <= 5) {
        nextScore -= 8;
        nextReasons.push(t("ScoreReason.RouteLeavesLittleMovement", "Route leaves little movement to spare."));
      } else if (routeUse.cost <= routeUse.budget * 0.6) {
        nextScore += 4;
        nextReasons.push(t("ScoreReason.RouteKeepsMovementFlexible", "Route keeps movement flexible."));
      }
    }
  }

  // Flank is a plain Stride (see positional-tactic-reader.js) that happens to land somewhere worth
  // Striding to -- it carries setsUpFlank instead of positionalTactic specifically so it does NOT
  // get atomized/treated as an attack (no MAP badge, and it still gets a normal destination-picker
  // button). GM-NPC preference and the ally-naming reason still apply the same as any other tactic.
  if (action.activityProfile?.setsUpFlank === true && canUseTargetDefenses(context)) {
    nextScore += 30;
    const allyName = action.activityProfile.flankAllyName ?? t("Reason.AnAlly", "an ally");
    const flankReach = activityStrikeReach(profile, action);
    nextReasons.unshift(t("ScoreReason.FlanksForAnOffGuard", "Strides within {p2}-foot reach to flank {p0} with {p1} for an off-guard Strike.", { p0: target?.name ?? "the target", p1: allyName, p2: flankReach }));
  }

  // GM-NPC preference for the positional move-and-strike tactics. Players still see the
  // composites in the browser, but only the GM auto-plan leads with them (consistent with
  // the existing aggro-only preference). The generators already gate skirmish on
  // fragile/ranged-primary, so reaching here means the tactic is warranted.
  if (action.activityProfile?.positionalTactic && canUseTargetDefenses(context)) {
    if (action.activityProfile.positionalTactic === "skirmish") {
      const fragile = hpPercent(profile) < 0.5;
      nextScore += fragile ? 26 : 18;
      nextReasons.unshift(fragile ? t("ScoreReason.FragileAttackerKitesOutOf", "Fragile attacker kites out of melee before striking from range.") : t("ScoreReason.FightsBetterAtRangeKites", "Fights better at range; kites out of melee before striking."));
      if (action.activityProfile?.meleeStrike && action.activityProfile?.finisher) {
        nextScore += 48;
        nextReasons.push(t("ScoreReason.KiteKeepsOffenseOnline", "Skirmish keeps pressure up while leaving melee."));
      }
    }
  }

  if (isCurated(action) && action.activityProfile?.strideCount > 0 && action.saveProfile && action.damageProfile) {
    const moveReach = profileMoveReach(profile, action.activityProfile.strideCount);
    const reachableEnemies = attackableEnemies(context).filter((enemy) => (enemy?.distance ?? Infinity) <= moveReach);
    if (reachableEnemies.length > 0) {
      nextScore += 24 + reachableEnemies.length * 12;
      nextReasons.unshift(t("ScoreReason.CanMoveThrough", "{p0} can move through {p1} {p2}.", { p0: action.name, p1: reachableEnemies.length, p2: plural(reachableEnemies.length, "enemy", "enemies") }));
    } else {
      nextScore -= 18;
      nextReasons.unshift(t("ScoreReason.NoEnemyIsReachableFor", "No enemy is reachable for {p0}.", { p0: action.name }));
    }
  }

  if (action.activityProfile?.focusedStrike && target && !action.activityProfile?.strideCount) {
    if (inActionReach(profile, action, target)) {
      nextScore += 72;
      nextReasons.unshift(t("ScoreReason.FocusesAttacksOn", "{p0} focuses attacks on {p1}.", { p0: action.name, p1: target.name }));
    } else {
      nextScore -= 40;
      nextReasons.unshift(t("ScoreReason.TargetIsOutOfRange", "{p0} target is out of range.", { p0: action.name }));
    }
  }

  if (action.activityProfile?.multiStrike) {
    // A "Stride into reach -> multiattack" combo (readStrideMultiattackActivities) carries its own
    // strideCount -- score its reach from where the Stride lands, not the actor's current position,
    // or the combo always looks unreachable and loses to a plain single-Strike combo that gets the
    // same treatment via activityMoveReach elsewhere in this function.
    const strideCount = action.activityProfile?.strideCount;
    const reach = strideCount > 0 ? activityMoveReach(profile, action, strideCount) : profileReach(profile);
    const inReach = (candidate) => Boolean(candidate && (candidate.distance ?? Infinity) <= reach);
    const reachableEnemies = attackableEnemies(context).filter(inReach);
    if (reachableEnemies.length >= 2) {
      nextScore += 76;
      nextReasons.unshift(t("ScoreReason.EnemiesAreInReachFor", "{p0} enemies are in reach for separate Strikes.", { p0: reachableEnemies.length }));
    } else if (inReach(target)) {
      nextScore += 36;
      nextReasons.unshift(t("ScoreReason.OnlyOneEnemyIsIn", "Only one enemy is in reach; focused offense is usually better."));
    } else {
      nextScore -= 40;
      nextReasons.unshift(t("ScoreReason.NoEnemyIsInReach", "No enemy is in reach for {p0}.", { p0: action.name }));
    }
  }

  return {
    score: nextScore,
    reasons: nextReasons,
  };
}
