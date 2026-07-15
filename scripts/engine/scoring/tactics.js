import { battlefieldPressure } from "../../rules/battlefield-analysis.js";
import { targetHasMarkState } from "../../rules/combat-state.js";
import { planMinionSubturn } from "../../rules/minion-planner.js";
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
import { HARD_BLOCK_SCORE } from "./weights.js";

export { baseScore, defaultReason, includesStand } from "./tactic-helpers.js";

function strikeDamageScore(averageDamage) {
  // Capped main term keeps a single Strike from dominating cross-role comparisons. The small
  // uncapped tiebreaker then keeps strike-vs-strike ordering monotonic once both cap out, so a
  // harder-hitting weapon still wins -- e.g. a 2d12+12 Pincer (avg 25) beats a 2d10+10 beam (avg 21)
  // at the same range instead of tying at the 40 ceiling.
  return Math.min(averageDamage * 2, 40) + averageDamage * 0.25;
}

function demoralizeTactic(acc, { target }) {
  if (!(target && !hasCondition(target, "frightened"))) return;
  acc.score += 22;
  acc.reasons.push(t("ScoreReason.TargetIsNotFrightened", "Target is not frightened."));
}

function tripTactic(acc, { target }) {
  if (!(target && !hasCondition(target, "prone"))) return;
  acc.score += 18;
  acc.reasons.push(t("ScoreReason.TargetIsStandingAnd", "Target is standing and can be knocked prone."));
}

function grappleTactic(acc, { target }) {
  if (!(target && !hasCondition(target, "grabbed"))) return;
  acc.score += 16;
  acc.reasons.push(t("ScoreReason.TargetIsNotGrabbed", "Target is not grabbed."));
}

function disarmTactic(acc, { target }) {
  if (!target) return;
  acc.score += 10;
  acc.reasons.push(t("ScoreReason.CanPressureEnemyWeapon", "Can pressure enemy weapon or held item."));
}

function repositionTactic(acc, { target }) {
  if (!target) return;
  acc.score += 12;
  acc.reasons.push(t("ScoreReason.CanMoveTargetInto", "Can move target into a better square."));
}

function shoveTactic(acc, { target }) {
  if (!target) return;
  acc.score += 12;
  acc.reasons.push(t("ScoreReason.CanPushTargetOut", "Can push target out of position."));
}

function feintTactic(acc, { context, target }) {
  if (!(enemyInMelee(context) && !hasCondition(target, "off-guard"))) return;
  acc.score += 18;
  acc.reasons.push(t("ScoreReason.TargetIsInMelee", "Target is in melee and not off-guard."));
}

function createADiversionTactic(acc, { profile, target }) {
  if (!(target && !hasCondition(profile, "hidden"))) return;
  acc.score += 12;
  acc.reasons.push(t("ScoreReason.CanCreateAHidden", "Can create a hidden opening."));
}

function tumbleThroughTactic(acc, { target }) {
  if (!(target && !hasCondition(target, "off-guard"))) return;
  acc.score += 14;
  acc.reasons.push(t("ScoreReason.CanMoveThroughEnemy", "Can move through enemy and set up off-guard pressure."));
}

function terrainMovementTactic(acc) {
  acc.score += 6;
  acc.reasons.push(t("ScoreReason.TerrainMakesThisMovement", "Terrain makes this movement action relevant."));
}

function forceOpenTactic(acc) {
  acc.score += 8;
  acc.reasons.push(t("ScoreReason.ObstacleOrObjectCan", "Obstacle or object can be forced open."));
}

function seekTactic(acc) {
  acc.score += 8;
  acc.reasons.push(t("ScoreReason.UsefulWhenHiddenEnemies", "Useful when hidden enemies or hazards may matter."));
}

function senseMotiveTactic(acc, { target }) {
  if (!target) return;
  acc.score += 6;
  acc.reasons.push(t("ScoreReason.UsefulWhenEnemyIntent", "Useful when enemy intent is unclear."));
}

function recallKnowledgeTactic(acc, { target }) {
  if (!target) return;
  acc.score += 16;
  acc.reasons.push(t("ScoreReason.IdentifyDefenses", "Identify {target} defenses and weaknesses.", { target: target.name }));
}

function raiseAShieldTactic(acc, { profile, pressure }) {
  if (!profile.hasShield) return;
  acc.score += hpPercent(profile) < 0.5 ? 24 : 12;
  acc.reasons.push(t("ScoreReason.ShieldEquipped", "Shield equipped."));
  if (pressure.inMeleeThreat || pressure.hasOpenEnemyLine) {
    acc.score += 12;
    acc.reasons.push(t("ScoreReason.EnemiesHaveAClear", "Enemies have a clear attack line."));
  }
}

function takeCoverTactic(acc, { profile, pressure }) {
  acc.score += hpPercent(profile) < 0.5 ? 18 : 10;
  acc.reasons.push(t("ScoreReason.CoverIsAvailable", "Cover is available."));
  if (pressure.hasOpenEnemyLine) {
    acc.score += 18;
    acc.reasons.push(t("ScoreReason.OpenEnemyLineMakes", "Open enemy line makes cover valuable."));
  }
}

function escapeTactic(acc) {
  acc.score += 30;
  acc.reasons.push(t("ScoreReason.ActorIsGrabbedOr", "Actor is grabbed or restrained."));
}

function hideTactic(acc) {
  acc.score += 12;
  acc.reasons.push(t("ScoreReason.CoverOrConcealmentSupports", "Cover or concealment supports hiding."));
}

function sneakTactic(acc) {
  acc.score += 10;
  acc.reasons.push(t("ScoreReason.CanRepositionWhileHidden", "Can reposition while hidden or covered."));
}

function stealTactic(acc, { target }) {
  if (!target) return;
  acc.score -= 4;
  acc.reasons.push(t("ScoreReason.CombatTheftIsSituational", "Combat theft is situational."));
}

function palmAnObjectTactic(acc) {
  acc.score -= 2;
  acc.reasons.push(t("ScoreReason.NearbyObjectCanBe", "Nearby object can be palmed, but combat value is situational."));
}

function commandAnAnimalTactic(acc, { context, action }) {
  acc.minionPlan = planMinionSubturn(context, {
    minionActionBudget: action.activityProfile?.minionActionBudget,
  });
  acc.score += 18;
  acc.reasons.push(t("ScoreReason.CompanionOrMinionCan", "Companion or minion can contribute this turn."));
  if (acc.minionPlan) {
    acc.score += acc.minionPlan.scoreDelta;
    acc.reasons.push(...acc.minionPlan.reasons);
  }
}

function administerFirstAidTactic(acc, { context }) {
  const ally = dyingAlly(context) ?? bleedingAlly(context);
  if (!ally) return;
  acc.score += 36;
  acc.reasons.push(t("ScoreReason.AllyNeedsAid", "{ally} needs immediate aid.", { ally: ally.name }));
}

function stabilizeTactic(acc, { context }) {
  const ally = dyingAlly(context);
  if (!ally) return;
  acc.score += 40;
  acc.reasons.push(t("ScoreReason.AllyDying", "{ally} is dying.", { ally: ally.name }));
}

const SLUG_TACTICS = {
  demoralize: demoralizeTactic,
  trip: tripTactic,
  grapple: grappleTactic,
  disarm: disarmTactic,
  reposition: repositionTactic,
  shove: shoveTactic,
  feint: feintTactic,
  "create-a-diversion": createADiversionTactic,
  "tumble-through": tumbleThroughTactic,
  balance: terrainMovementTactic,
  climb: terrainMovementTactic,
  swim: terrainMovementTactic,
  "force-open": forceOpenTactic,
  seek: seekTactic,
  "sense-motive": senseMotiveTactic,
  "recall-knowledge": recallKnowledgeTactic,
  "raise-a-shield": raiseAShieldTactic,
  "take-cover": takeCoverTactic,
  escape: escapeTactic,
  hide: hideTactic,
  sneak: sneakTactic,
  steal: stealTactic,
  "palm-an-object": palmAnObjectTactic,
  "command-an-animal": commandAnAnimalTactic,
  "administer-first-aid": administerFirstAidTactic,
  stabilize: stabilizeTactic,
};

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
  let areaPlacementOptions = [];
  let minionPlan = null;
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
      score = HARD_BLOCK_SCORE;
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
      score = HARD_BLOCK_SCORE;
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

  const slugAcc = { score, reasons, minionPlan };
  SLUG_TACTICS[action.slug]?.(slugAcc, { context, action, profile, target, pressure });
  score = slugAcc.score;
  minionPlan = slugAcc.minionPlan;

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
  areaPlacementOptions = curatedRoleTactics.areaPlacementOptions;

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
    areaPlacementOptions,
    minionPlan,
  };
}
