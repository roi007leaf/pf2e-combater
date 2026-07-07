import { battlefieldPressure } from "../../rules/battlefield-analysis.js";
import { targetHasMarkState } from "../../rules/combat-state.js";
import { isSelfCenteredAreaAction } from "../action/requirements.js";
import { bestBuffRecipient } from "./buffs.js";
import { scoreActivityProfileTactics } from "./activity-tactics.js";
import { scoreCuratedRoleTactics } from "./role-tactics.js";
import { attackableEnemies } from "./targets.js";
import {
  contextAllies,
  contextEnemies,
  firstContextTarget,
  targetReference,
} from "../target-pool.js";
import {
  damageAdjustment,
  hasCondition,
  hasEffect,
  hasSpellcastingCapability,
  hpPercent,
  inRange,
  isAttackLikeAction,
  isMeleeStrikeFallback,
  isOffensiveRole,
  isSpellAction,
  makesAttackRoll,
  maxRange,
  requiresTargetableEnemy,
  saveScoreDelta,
  volleyRange,
} from "./facts.js";
import {
  baseScore,
  bleedingAlly,
  defaultReason,
  dyingAlly,
  enemyInMelee,
  includesStand,
  isCurated,
  profileReach,
  selfReference,
} from "./tactic-helpers.js";
import { t } from "../../i18n.js";

export { baseScore, defaultReason, includesStand } from "./tactic-helpers.js";

function strikeDamageScore(averageDamage) {
  // Capped main term keeps a single Strike from dominating cross-role comparisons. The small
  // uncapped tiebreaker then keeps strike-vs-strike ordering monotonic once both cap out, so a
  // harder-hitting weapon still wins -- e.g. a 2d12+12 Pincer (avg 25) beats a 2d10+10 beam (avg 21)
  // at the same range instead of tying at the 40 ceiling.
  return Math.min(averageDamage * 2, 40) + averageDamage * 0.25;
}

export function suggestedTargetFor(context, action, role, preferredTarget = firstContextTarget(context)) {
  const target = preferredTarget;
  const needsTargetableEnemy = requiresTargetableEnemy(action, role);

  if (isSelfCenteredAreaAction(action)) return null;

  if (action.source === "strike") {
    return target ? targetReference(target, "enemy") : null;
  }

  if (["step", "stride"].includes(action.slug)) {
    return target ? targetReference(target, "enemy") : null;
  }

  if (
    role === "defense"
    || ["raise-a-shield", "take-cover", "hide", "sneak"].includes(action.slug)
  ) {
    return selfReference(context);
  }

  if (role === "healing") {
    const dying = dyingAlly(context);
    if (dying) return targetReference(dying, "ally");
    const bleeding = bleedingAlly(context);
    if (bleeding) return targetReference(bleeding, "ally");
    const injuredAlly = contextAllies(context).find((ally) => hpPercent(ally) < 0.5);
    if (injuredAlly) return targetReference(injuredAlly, "ally");
    return selfReference(context);
  }

  if (["buff", "stealth-defense", "setup", "summon", "utility", "combat-utility", "exploration-utility", "sustain-control", "transformation", "mobility", "recovery"].includes(role)) {
    const targeting = action.targetingProfile ?? {};
    if (role === "buff" || role === "stealth-defense") {
      const recipient = bestBuffRecipient(context, action);
      if (recipient) return recipient.type === "self"
        ? selfReference(context)
        : targetReference(recipient.entity, recipient.type);
    }
    // Enemy-targeted setups (Taunt, Feint, Hunt Prey, off-guard setups) point at
    // the enemy; ally/self effects point at an ally or the actor.
    if (targeting.enemy || needsTargetableEnemy) {
      if (target) return targetReference(target, "enemy");
      const enemy = needsTargetableEnemy ? attackableEnemies(context)[0] : contextEnemies(context)[0];
      if (enemy) return targetReference(enemy, "enemy");
    }
    if (targeting.ally && !targeting.self) {
      const ally = contextAllies(context)[0];
      if (ally) return targetReference(ally, "ally");
    }
    return selfReference(context);
  }

  const seeksEnemy = needsTargetableEnemy
    || isOffensiveRole(role)
    || isAttackLikeAction(action, role)
    || action?.targetingProfile?.enemy === true;
  if (!seeksEnemy) return selfReference(context);
  if (target && inRange(action, target)) return targetReference(target, "enemy");
  return null;
}

export function scoreRoleTactics(context, action, { role, profile, target } = {}) {
  const reasons = [...(action.reasons ?? [])];
  const targetDamageAdjustment = damageAdjustment(context, action, target);
  const targetSaveScore = saveScoreDelta(context, action, target, profile);
  const pressure = battlefieldPressure(context);
  let areaHitCount = null;
  let areaPlacementCenter = null;
  let areaPlacementAimPoint = null;
  let score = baseScore(action);

  if (Number(action.interactDrawCost) > 0) {
    reasons.push(t("ScoreReason.IncludesInteractToDraw", "Includes Interact to draw or retrieve the consumable."));
  }

  if (action.source === "strike" && inRange(action, target)) {
    score += 24;
    reasons.push(maxRange(action) > 10 ? "Target is in range." : "Melee target is in reach.");

    // Prefer harder-hitting strikes strongly enough that a real weapon can beat
    // an agile unarmed fallback even after one prior attack.
    const average = Number(action.averageDamage);
    if (Number.isFinite(average) && average > 0) {
      score += strikeDamageScore(average);
      reasons.push(t("ScoreReason.AverageDamage", "Average damage about {amount}.", { amount: Math.round(average) }));
    }
    if (targetDamageAdjustment) {
      score += targetDamageAdjustment.scoreDelta;
      reasons.push(...targetDamageAdjustment.reasons);
    }

    // Volley weapons take a -2 to attack within their volley range; firing one point-blank is
    // worse than repositioning to optimal range (or a kite composite that moves out first).
    const volley = volleyRange(action);
    if (volley > 0 && Number(target?.distance ?? Infinity) <= volley) {
      score -= 10;
      reasons.push(t("ScoreReason.VolleyPenalty", "Volley weapon takes a -2 penalty within {range} ft.", { range: volley }));
    }
  }

  // Prone imposes a -2 circumstance penalty on your attack rolls (Strikes, spell attacks, Athletics
  // maneuvers). Dock attack-roll actions so the planner leans toward Standing first when it can spare
  // the action. Applies per attack, so it also correctly favors Stand over multiple prone Strikes.
  // (Weighted like other -2 penalties here: ~3 points per point of attack penalty.)
  if (makesAttackRoll(action) && hasCondition(profile, "prone")) {
    score -= 6;
    reasons.push(t("ScoreReason.ProneAttackPenalty", "Attacking while prone takes a -2 circumstance penalty."));
  }

  if (["step", "stride", "stand-stride"].includes(action.slug) && action.source === "generic" && target) {
    const distance = Number(target.distance ?? Infinity);
    const reach = profileReach(profile);
    if (distance <= reach) {
      // A reposition that closes no distance has no tactical value, so it must score below the
      // unused-action penalty -- otherwise the planner pads a spare action with a pointless
      // "Stride to the same square". A -26 nudge off the +42 generic base still left it at +16
      // and kept getting padded; force it negative. (Still selectable manually in the browser.)
      score = -10;
      reasons.push(t("ScoreReason.TargetAlreadyInReach", "Target already in reach; repositioning is low priority."));
    } else {
      score += action.slug === "step" ? 4 : 8;
      reasons.push(t("ScoreReason.ClosesDistanceTowardThe", "Closes distance toward the target."));
    }
  }

  if (includesStand(action)) {
    if (!hasCondition(profile, "prone")) {
      score = -999;
      reasons.push(t("ScoreReason.ActorIsNotProne", "Actor is not prone."));
    } else {
      score += 18;
      reasons.push(t("ScoreReason.RemovesProneAndRestores", "Removes prone and restores normal movement."));

      if (enemyInMelee(context)) {
        score += 22;
        reasons.push(t("ScoreReason.StandingRemovesMeleeAttack", "Standing removes melee attack penalty and off-guard risk."));
      }

      const needsMovement = attackableEnemies(context).some((enemy) => {
        const distance = Number(enemy?.distance);
        return Number.isFinite(distance) && distance > profileReach(profile);
      });
      if (needsMovement) {
        score += 14;
        reasons.push(t("ScoreReason.StandingUnlocksStrideAnd", "Standing unlocks Stride and Step options."));
      }
    }
  }

  if (action.slug === "retch") {
    if (!hasCondition(profile, "sickened")) {
      score = -999;
      reasons.push(t("ScoreReason.ActorIsNotSickened", "Actor is not sickened."));
    } else {
      score += 30;
      reasons.push(t("ScoreReason.RetchCanReduceSickened", "Retch can reduce sickened."));
      if (enemyInMelee(context)) {
        score += 6;
        reasons.push(t("ScoreReason.ReducingSickenedHelpsUnder", "Reducing sickened helps under melee pressure."));
      }
    }
  }

  if (action.activityProfile?.targetMark && target) {
    const mark = action.activityProfile.targetMark;
    if (targetHasMarkState(target, mark) || hasCondition(target, mark) || hasEffect(target, mark)) {
      score -= 200;
      reasons.push(t("ScoreReason.TargetAlreadyMark", "{target} already has {mark}.", { target: target.name, mark }));
    }
  }

  if (action.slug === "demoralize" && target && !hasCondition(target, "frightened")) {
    score += 22;
    reasons.push(t("ScoreReason.TargetIsNotFrightened", "Target is not frightened."));
  }

  if (action.slug === "trip" && target && !hasCondition(target, "prone")) {
    score += 18;
    reasons.push(t("ScoreReason.TargetIsStandingAnd", "Target is standing and can be knocked prone."));
  }

  if (action.slug === "grapple" && target && !hasCondition(target, "grabbed")) {
    score += 16;
    reasons.push(t("ScoreReason.TargetIsNotGrabbed", "Target is not grabbed."));
  }

  if (action.slug === "disarm" && target) {
    score += 10;
    reasons.push(t("ScoreReason.CanPressureEnemyWeapon", "Can pressure enemy weapon or held item."));
  }

  if (action.slug === "reposition" && target) {
    score += 12;
    reasons.push(t("ScoreReason.CanMoveTargetInto", "Can move target into a better square."));
  }

  if (action.slug === "shove" && target) {
    score += 12;
    reasons.push(t("ScoreReason.CanPushTargetOut", "Can push target out of position."));
  }

  if (action.slug === "feint" && enemyInMelee(context) && !hasCondition(target, "off-guard")) {
    score += 18;
    reasons.push(t("ScoreReason.TargetIsInMelee", "Target is in melee and not off-guard."));
  }

  if (action.slug === "create-a-diversion" && target && !hasCondition(profile, "hidden")) {
    score += 12;
    reasons.push(t("ScoreReason.CanCreateAHidden", "Can create a hidden opening."));
  }

  if (action.slug === "tumble-through" && target && !hasCondition(target, "off-guard")) {
    score += 14;
    reasons.push(t("ScoreReason.CanMoveThroughEnemy", "Can move through enemy and set up off-guard pressure."));
  }

  if (["balance", "climb", "swim"].includes(action.slug)) {
    score += 6;
    reasons.push(t("ScoreReason.TerrainMakesThisMovement", "Terrain makes this movement action relevant."));
  }

  if (action.slug === "force-open") {
    score += 8;
    reasons.push(t("ScoreReason.ObstacleOrObjectCan", "Obstacle or object can be forced open."));
  }

  if (action.slug === "seek") {
    score += 8;
    reasons.push(t("ScoreReason.UsefulWhenHiddenEnemies", "Useful when hidden enemies or hazards may matter."));
  }

  if (action.slug === "sense-motive" && target) {
    score += 6;
    reasons.push(t("ScoreReason.UsefulWhenEnemyIntent", "Useful when enemy intent is unclear."));
  }

  if (action.slug === "recall-knowledge" && target) {
    score += 16;
    reasons.push(t("ScoreReason.IdentifyDefenses", "Identify {target} defenses and weaknesses.", { target: target.name }));
  }

  if (action.slug === "raise-a-shield" && profile.hasShield) {
    score += hpPercent(profile) < 0.5 ? 24 : 12;
    reasons.push(t("ScoreReason.ShieldEquipped", "Shield equipped."));
    if (pressure.inMeleeThreat || pressure.hasOpenEnemyLine) {
      score += 12;
      reasons.push(t("ScoreReason.EnemiesHaveAClear", "Enemies have a clear attack line."));
    }
  }

  if (action.slug === "take-cover") {
    score += hpPercent(profile) < 0.5 ? 18 : 10;
    reasons.push(t("ScoreReason.CoverIsAvailable", "Cover is available."));
    if (pressure.hasOpenEnemyLine) {
      score += 18;
      reasons.push(t("ScoreReason.OpenEnemyLineMakes", "Open enemy line makes cover valuable."));
    }
  }

  if (action.slug === "escape") {
    score += 30;
    reasons.push(t("ScoreReason.ActorIsGrabbedOr", "Actor is grabbed or restrained."));
  }

  if (action.slug === "hide") {
    score += 12;
    reasons.push(t("ScoreReason.CoverOrConcealmentSupports", "Cover or concealment supports hiding."));
  }

  if (action.slug === "sneak") {
    score += 10;
    reasons.push(t("ScoreReason.CanRepositionWhileHidden", "Can reposition while hidden or covered."));
  }

  if (action.slug === "steal" && target) {
    score -= 4;
    reasons.push(t("ScoreReason.CombatTheftIsSituational", "Combat theft is situational."));
  }

  if (action.slug === "palm-an-object") {
    score -= 2;
    reasons.push(t("ScoreReason.NearbyObjectCanBe", "Nearby object can be palmed, but combat value is situational."));
  }

  if (action.slug === "command-an-animal") {
    score += 18;
    reasons.push(t("ScoreReason.CompanionOrMinionCan", "Companion or minion can contribute this turn."));
  }

  if (action.slug === "administer-first-aid") {
    const ally = dyingAlly(context) ?? bleedingAlly(context);
    if (ally) {
      score += 36;
      reasons.push(t("ScoreReason.AllyNeedsAid", "{ally} needs immediate aid.", { ally: ally.name }));
    }
  }

  if (action.slug === "stabilize") {
    const ally = dyingAlly(context);
    if (ally) {
      score += 40;
      reasons.push(t("ScoreReason.AllyDying", "{ally} is dying.", { ally: ally.name }));
    }
  }

  const curatedRoleTactics = scoreCuratedRoleTactics(context, action, {
    role,
    profile,
    target,
    score,
    reasons,
    targetDamageAdjustment,
    targetSaveScore,
    pressure,
  });
  score = curatedRoleTactics.score;
  areaHitCount = curatedRoleTactics.areaHitCount;
  areaPlacementCenter = curatedRoleTactics.areaPlacementCenter;
  areaPlacementAimPoint = curatedRoleTactics.areaPlacementAimPoint;

  if (action.slug === "rage" && !hasCondition(profile, "rage") && !hasCondition(profile, "raging")) {
    score += 46;
    reasons.push(t("ScoreReason.RageSetsUpThis", "Rage sets up this turn's attack."));
  }

  const activityProfileTactics = scoreActivityProfileTactics(context, action, {
    profile,
    target,
    score,
    reasons,
    pressure,
  });
  score = activityProfileTactics.score;

  if (isCurated(action) && (action.curated?.friendlyFireRisk ?? action.friendlyFireRisk)) {
    if (contextAllies(context).some((ally) => (ally?.distance ?? Infinity) <= 20)) score -= 18;
    reasons.push(t("ScoreReason.AreaSpellHasFriendly", "Area spell has friendly-fire risk."));
  }

  if (hasSpellcastingCapability(context)) {
    if (isSpellAction(action)) {
      score += 18;
      reasons.push(t("ScoreReason.SpellcasterSpellOptionIs", "Spellcaster spell option is preferred over melee fallback."));
    } else if (isMeleeStrikeFallback(action)) {
      score -= 18;
      reasons.push(t("ScoreReason.SpellcasterMeleeStrikeIs", "Spellcaster melee Strike is lower priority than spell options."));
    }
  }

  return {
    score,
    reasons,
    areaHitCount,
    areaPlacementCenter,
    areaPlacementAimPoint,
  };
}
