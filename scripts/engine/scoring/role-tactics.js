import { scoredAreaPlacement } from "./area.js";
import { aggroProfile } from "../../rules/aggro.js";
import {
  actionGrantsQuickened,
  bestBuffRecipient,
  targetAlreadyHasBuff,
} from "./buffs.js";
import { attackableEnemies } from "./targets.js";
import { contextAllies, contextEnemies } from "../target-pool.js";
import {
  canUseTargetDefenses,
  damageAdjustment,
  damageAverage,
  hasAnyCondition,
  hasCondition,
  hasRequiredCondition,
  hpPercent,
  inRange,
  isAreaAction,
  maxRange,
  saveScoreDelta,
} from "./facts.js";
import {
  activityMoveReach,
  enemyInMelee,
  inActionReach,
  inProfileReach,
  isCurated,
  nearbyCorpse,
  plural,
  profileReach,
  selfReference,
} from "./tactic-helpers.js";
import { pf2eSave, t } from "../../i18n.js";

function saveIntelCategory(action) {
  return action?.saveProfile?.stat === "perception" ? "perception" : "saves";
}

export function scoreCuratedRoleTactics(context, action, {
  role,
  profile,
  target,
  score,
  reasons,
  targetDamageAdjustment,
  targetSaveScore,
  pressure,
} = {}) {
  let nextScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  const nextReasons = Array.isArray(reasons) ? reasons : [];
  let areaHitCount = null;
  let areaPlacementCenter = null;
  let areaPlacementAimPoint = null;

  if (isCurated(action) && role === "healing") {
    const injuredAlly = contextAllies(context).find((ally) => hpPercent(ally) < 0.5);
    if (hpPercent(profile) < 0.5) {
      nextScore += 34;
      nextReasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: selfReference(context).name }));
    } else if (injuredAlly) {
      nextScore += 34;
      nextReasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: injuredAlly.name }));
    } else {
      nextScore -= 10;
      nextReasons.push(t("ScoreReason.NoAllyIsBadly", "No ally is badly injured."));
    }
  }

  if (isCurated(action) && (role === "damage" || role === "weapon-strike") && target && inRange(action, target) && !action.activityProfile?.drawsWeapon) {
    const average = damageAverage(action);
    nextScore += Number.isFinite(average) ? 18 + Math.min(28, Math.round(average * 1.2)) : 18;
    nextReasons.push(t("ScoreReason.CanDamage", "{action} can damage {target}.", { action: action.name, target: target.name }));
    if (targetDamageAdjustment) {
      nextScore += targetDamageAdjustment.scoreDelta;
      nextReasons.push(...targetDamageAdjustment.reasons);
    }
  }

  if (action.activityProfile?.drawsWeapon && target) {
    const weaponName = action.activityProfile.weaponName ?? action.item?.name ?? action.name;
    if (inActionReach(profile, action, target)) {
      // Drawing a weapon costs an action. It is the strong play only when no
      // enemy is already in melee reach; otherwise an in-hand Strike on the
      // adjacent enemy is the better use of the turn.
      nextScore += enemyInMelee(context) ? 18 : 82;
      nextReasons.unshift(t("ScoreReason.DrawAndStrike", "Draw {p0} and Strike {p1}.", { p0: weaponName, p1: target.name }));
    } else {
      nextScore -= 40;
      nextReasons.unshift(t("ScoreReason.IsStillOutOfRange", "{p0} is still out of range after drawing.", { p0: weaponName }));
    }
  }

  const aggro = target ? aggroProfile(context, target) : null;
  if (aggro?.gmOnly && aggro.roles.length && aggro.score > 0) {
    nextReasons.push(t("ScoreReason.AggroPriority", "Aggro priority: {roles}.", { roles: aggro.roles.join(", ") }));
  }

  if (isCurated(action) && role === "debuff" && target) {
    nextScore += 20;
    nextReasons.push(t("ScoreReason.DebuffPressure", "Debuff spell can pressure {target}.", { target: target.name }));
  }

  if (isCurated(action) && role === "setup" && target) {
    nextScore += action.activityProfile?.precisionDamageSetup ? 28 : 20;
    nextReasons.unshift(t("ScoreReason.SetsUpStrongerFollowUp", "{p0} sets up stronger follow-up attacks.", { p0: action.name }));
  }

  if (isCurated(action) && role === "mobility") {
    const strideCount = Number(action.activityProfile?.strideCount ?? 1);
    const distance = Number(target?.distance ?? Infinity);
    const moveReach = activityMoveReach(profile, action, strideCount);
    if (action.activityProfile?.retreat && enemyInMelee(context)) {
      nextScore += 24;
      nextReasons.unshift(t("ScoreReason.CanDisengageFromMelee", "{p0} can disengage from melee.", { p0: action.name }));
    } else if (target && distance > profileReach(profile) && distance <= moveReach) {
      nextScore += 18;
      nextReasons.unshift(t("ScoreReason.CanImprovePositionToward", "{p0} can improve position toward {p1}.", { p0: action.name, p1: target.name }));
    } else {
      nextScore += 8;
      nextReasons.unshift(t("ScoreReason.ImprovesPosition", "{p0} improves position.", { p0: action.name }));
    }
    if (action.activityProfile?.safeMovement) {
      nextScore += 6;
      nextReasons.push(t("ScoreReason.MovementReducesReactionRisk", "Movement reduces reaction risk."));
    }
  }

  if (isCurated(action) && role === "drain" && target) {
    const required = action.activityProfile?.requiresAnyTargetCondition ?? [];
    if (required.length && !hasAnyCondition(target, required)) {
      nextScore -= 28;
      nextReasons.unshift(t("ScoreReason.NeedsAGrabbedRestrainedParalyzed", "{p0} needs a grabbed, restrained, paralyzed, or unconscious target.", { p0: action.name }));
    } else {
      nextScore += hpPercent(profile) < 0.5 ? 58 : 42;
      nextReasons.unshift(t("ScoreReason.CanDrainAndRecoverHit", "{p0} can drain {p1} and recover Hit Points.", { p0: action.name, p1: target.name }));
    }
  }

  if (isCurated(action) && role === "self-healing") {
    const corpse = nearbyCorpse(context, profile);
    if (action.activityProfile?.requiresCorpse && !corpse) {
      nextScore -= 24;
      nextReasons.unshift(t("ScoreReason.NeedsAnAdjacentCorpse", "{p0} needs an adjacent corpse.", { p0: action.name }));
    } else {
      nextScore += hpPercent(profile) < 0.5 ? 46 : 20;
      nextReasons.unshift(corpse ? t("ScoreReason.CanUse", "{p0} can use {p1}.", { p0: action.name, p1: corpse.name }) : t("ScoreReason.CanRecoverHitPoints", "{p0} can recover Hit Points.", { p0: action.name }));
    }
  }

  if (isCurated(action) && role === "resource-recovery") {
    nextScore += 8;
    nextReasons.unshift(t("ScoreReason.CanRecoverAnExpendedCombat", "{p0} can recover an expended combat resource.", { p0: action.name }));
  }

  if (isCurated(action) && role === "transformation") {
    nextScore += 6;
    nextReasons.unshift(t("ScoreReason.MayAlterMovementOrAttack", "{p0} may alter movement or attack options.", { p0: action.name }));
  }

  if (isCurated(action) && role === "area-damage") {
    const placement = scoredAreaPlacement(action, context, {
      enemyValues: attackableEnemies(context),
      allyValues: contextAllies(context),
      maxCastRange: maxRange(action),
    });
    const enemiesInArea = placement.enemies;
    const alliesInArea = placement.allies;
    areaHitCount = enemiesInArea.length;
    areaPlacementCenter = placement.areaPlacementCenter;
    areaPlacementAimPoint = placement.areaPlacementAimPoint;
    if (enemiesInArea.length > 0) {
      nextScore += enemiesInArea.length === 1
        ? 14
        : 34 + enemiesInArea.length * 18;
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      nextReasons.unshift(t("ScoreReason.CanHit", "{p0} can hit {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
    } else {
      nextScore -= 28;
      nextReasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
    }
    if (alliesInArea.length > 0) {
      nextScore -= alliesInArea.length * 18;
      nextReasons.push(t(alliesInArea.length === 1 ? "ScoreReason.AlliesInAreaOne" : "ScoreReason.AlliesInAreaMany", alliesInArea.length === 1 ? "{count} ally may be in the area." : "{count} allies may be in the area.", { count: alliesInArea.length }));
    } else if (enemiesInArea.length > 1 && placement.centerTarget) {
      nextScore += 8;
      nextReasons.push(t("ScoreReason.BestAreaPlacementAvoids", "Best area placement avoids allies."));
    }
    const saveDeltas = enemiesInArea
      .filter((enemy) => canUseTargetDefenses(context, enemy, saveIntelCategory(action)))
      .map((enemy) => saveScoreDelta(context, action, enemy, profile))
      .filter(Boolean);
    const damageDeltas = enemiesInArea
      .map((enemy) => damageAdjustment(context, action, enemy))
      .filter(Boolean);
    const tacticalDelta = Math.round(
      saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.5
      + damageDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.5,
    );
    nextScore += tacticalDelta;
    const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
    if (bestSave) nextReasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
    for (const entry of damageDeltas.slice(0, 2)) nextReasons.push(...entry.reasons);
  }

  if (isCurated(action) && role === "save-damage" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const needsSetup = requiredCondition && !hasRequiredCondition(target, requiredCondition);
    const average = damageAverage(action);
    nextScore += requiredCondition ? 52 : 34;
    if (Number.isFinite(average)) nextScore += Math.min(30, Math.round(average));
    nextReasons.unshift(needsSetup
      ? t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition })
      : t("ScoreReason.CanForceASave", "{p0} can force a {p1} save.", { p0: action.name, p1: action.saveProfile?.stat ?? "save" }));
    if (targetSaveScore) {
      nextScore += targetSaveScore.scoreDelta;
      nextReasons.push(targetSaveScore.label);
    }
    if (targetDamageAdjustment) {
      nextScore += targetDamageAdjustment.scoreDelta;
      nextReasons.push(...targetDamageAdjustment.reasons);
    }
  }

  if (isCurated(action) && role === "grab" && target) {
    if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
      nextScore -= 14;
      nextReasons.unshift(t("ScoreReason.IsAlreadyGrabbed", "{p0} is already grabbed.", { p0: target.name }));
    } else if (inProfileReach(profile, target)) {
      nextScore += 42;
      nextReasons.unshift(t("ScoreReason.CanGrab", "{p0} can grab {p1}.", { p0: action.name, p1: target.name }));
    } else {
      nextScore -= 24;
      nextReasons.unshift(t("ScoreReason.TargetIsOutOfReach", "{p0} target is out of reach.", { p0: action.name }));
    }
  }

  if (isCurated(action) && (role === "control" || role === "debuff") && isAreaAction(action, role)) {
    const placement = scoredAreaPlacement(action, context, {
      enemyValues: attackableEnemies(context),
      allyValues: contextAllies(context),
      maxCastRange: maxRange(action),
    });
    const enemiesInArea = placement.enemies;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    areaHitCount = enemiesInArea.length;
    areaPlacementCenter = placement.areaPlacementCenter;
    areaPlacementAimPoint = placement.areaPlacementAimPoint;

    if (!enemiesInArea.length) {
      nextScore -= 24;
      nextReasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
    } else if (
      appliedConditions.length
      && enemiesInArea.every((enemy) => appliedConditions.some((condition) => hasCondition(enemy, condition)))
    ) {
      nextScore -= 8;
      nextReasons.unshift(t("ScoreReason.AreaTargetsAlreadyHave", "{p0} area targets already have {p1}.", { p0: action.name, p1: appliedConditions[0] }));
    } else {
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      nextScore += (appliedConditions.length ? 30 : 22) + enemiesInArea.length * 12;
      nextReasons.unshift(t("ScoreReason.CanAffect", "{p0} can affect {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
      const saveDeltas = enemiesInArea
        .filter((enemy) => canUseTargetDefenses(context, enemy, saveIntelCategory(action)))
        .map((enemy) => saveScoreDelta(context, action, enemy, profile))
        .filter(Boolean);
      const tacticalDelta = Math.round(
        saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.4,
      );
      nextScore += tacticalDelta;
      const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
      if (bestSave) nextReasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
    }
  } else if (isCurated(action) && (role === "control" || role === "debuff") && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    const appliedCondition = appliedConditions[0];
    if (requiredCondition && !hasRequiredCondition(target, requiredCondition)) {
      nextScore -= 24;
      nextReasons.unshift(t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition }));
    } else if (appliedConditions.some((condition) => hasCondition(target, condition))) {
      nextScore -= 10;
      nextReasons.unshift(t("ScoreReason.AlreadyHas", "{p0} already has {p1}.", { p0: target.name, p1: appliedCondition }));
    } else {
      nextScore += appliedCondition ? 42 : 32;
      nextReasons.unshift(t("ScoreReason.CanControl", "{p0} can control {p1}.", { p0: action.name, p1: target.name }));
      if (targetSaveScore) {
        nextScore += targetSaveScore.scoreDelta;
        nextReasons.push(targetSaveScore.label);
      }
    }
  }

  if (isCurated(action) && role === "reaction-attack") {
    nextScore += 26;
    nextReasons.unshift(t("ScoreReason.ReactionCanPunishTheCurrent", "Reaction can punish the current trigger."));
  }

  if (isCurated(action) && role === "defense" && action.slug === "drop-prone") {
    // Prone only grants Off-Guard (a flat -2 circumstance penalty to the prone creature's own AC
    // against every attacker alike) -- the remaster removed the old rule where ranged attacks
    // against a prone target took a penalty and melee attacks gained a bonus. So dropping prone with
    // any live threat nearby (melee or ranged) is a pure downside on its own: worse AC, worse own
    // attacks, nothing offsetting it. The only real defensive payoff is a follow-up Take Cover
    // (+4 circumstance AC vs ranged specifically), which is scored separately when actually taken.
    // The actor's own ranged attacks are worse while prone regardless of why it dropped prone,
    // so this penalty applies uniformly across every branch below.
    const rangedAttackPenalty = profile.equippedRangedWeapon ? -10 : 0;
    if (pressure.inMeleeThreat || pressure.hasOpenEnemyLine) {
      nextScore += rangedAttackPenalty - 30;
      nextReasons.unshift(t("ScoreReason.ProneNoDefenseBenefit", "Off-Guard applies to every attacker alike, so dropping prone gives no defensive benefit against melee or ranged on its own."));
    } else {
      nextScore += rangedAttackPenalty - 10;
      nextReasons.unshift(t("ScoreReason.NoThreatForProne", "No current threat makes dropping prone worthwhile."));
    }
  } else if (isCurated(action) && role === "defense") {
    nextScore += hpPercent(profile) < 0.5 ? 34 : 18;
    nextReasons.unshift(t("ScoreReason.DefensiveReactionIsAvailableFor", "Defensive reaction is available for the trigger."));
  }

  if (isCurated(action) && role === "buff") {
    const recipient = bestBuffRecipient(context, action);
    const allyTarget = recipient?.type === "ally";
    const grantsQuickened = actionGrantsQuickened(action);
    let buffValue = Math.max(0, Number(recipient?.value) || 0);
    if (action.activityProfile?.attackBuff || action.activityProfile?.damageBuff) {
      const attackerCount = [profile, ...contextAllies(context)].filter((entity) => hpPercent(entity) > 0).length;
      buffValue += Math.min(24, 6 + attackerCount * 4);
    }
    if (grantsQuickened) buffValue += 24;
    if (action.activityProfile?.acBuff || action.activityProfile?.saveBuff || action.activityProfile?.resistance) {
      buffValue += contextEnemies(context).length ? 10 : 4;
    }
    if (action.activityProfile?.removesCondition) {
      const constrained = [profile, ...contextAllies(context)].some((entity) =>
        hasAnyCondition(entity, ["grabbed", "restrained", "immobilized", "slowed", "stunned", "paralyzed"]),
      );
      buffValue += constrained ? 28 : 0;
    }
    if (recipient?.entity && targetAlreadyHasBuff(recipient.entity, action)) {
      buffValue -= 36;
      nextReasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipient.entity.name ?? t("ScoreReason.TargetWord", "Target"), action: action.name }));
    }
    nextScore += buffValue;
    nextReasons.unshift(grantsQuickened ? t("ScoreReason.GrantsQuickened", "{p0} grants quickened.", { p0: action.name }) : allyTarget ? t("ScoreReason.CanBoost", "{p0} can boost {p1}.", { p0: action.name, p1: recipient.entity?.name ?? "an ally" }) : t("ScoreReason.GrantsTheActorABeneficial", "{p0} grants the actor a beneficial effect.", { p0: action.name }));
  }

  if (isCurated(action) && role === "stealth-defense") {
    const recipient = bestBuffRecipient(context, action);
    const recipientName = recipient?.type === "ally" ? recipient.entity?.name ?? "an ally" : "the actor";
    nextScore += 22 + Math.max(0, Number(recipient?.value) || 0);
    if (targetAlreadyHasBuff(recipient?.entity, action)) {
      nextScore -= 44;
      nextReasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipientName, action: action.name }));
    }
    nextReasons.unshift(t("ScoreReason.CanMakeHarderToTarget", "{p0} can make {p1} harder to target.", { p0: action.name, p1: recipientName }));
  }

  if (isCurated(action) && role === "summon") {
    nextScore += 14;
    nextReasons.unshift(t("ScoreReason.BringsAnAllyOrConstruct", "{p0} brings an ally or construct onto the battlefield.", { p0: action.name }));
  }

  // Last-resort options: recognized but no tactical pattern. Push well below the
  // basics so they only surface when nothing stronger fills the turn.
  if (role === "utility") {
    nextScore -= 30;
    nextReasons.unshift(t("ScoreReason.IsAvailableNoStrongerPattern", "{p0} is available; no stronger pattern recognized.", { p0: action.name }));
  }

  // Releasing a held weapon is a free action, so it never competes for the turn's action budget
  // -- without a further penalty it would win as costless filler over doing nothing at all. Nothing
  // in this engine's planning currently benefits from a freed hand (no somatic-spell or two-handed
  // draw logic consumes it), so there is never a real reason for Auto-fill to pick this on its own;
  // it stays available to browse and add manually for the rare case a player actually wants it.
  if (action.activityProfile?.dropsWeapon) {
    nextScore -= 60;
    nextReasons.unshift(t("ScoreReason.DropsAWeaponForNo", "{p0} drops a weapon for no tactical benefit.", { p0: action.name }));
  }

  if (role === "exploration-utility") {
    nextScore -= contextEnemies(context).length ? 46 : 18;
    nextReasons.unshift(t("ScoreReason.IsMostlyExplorationUtility", "{p0} is mostly exploration utility.", { p0: action.name }));
  }

  if (role === "combat-utility") {
    nextScore += contextEnemies(context).length ? 4 : -8;
    nextReasons.unshift(t("ScoreReason.HasSituationalCombatUtility", "{p0} has situational combat utility.", { p0: action.name }));
  }

  if (role === "sustain-control") {
    nextScore += contextEnemies(context).length ? 18 : 4;
    nextReasons.unshift(t("ScoreReason.CanMaintainOngoingControl", "{p0} can maintain ongoing control.", { p0: action.name }));
  }

  return {
    score: nextScore,
    reasons: nextReasons,
    areaHitCount,
    areaPlacementCenter,
    areaPlacementAimPoint,
  };
}
