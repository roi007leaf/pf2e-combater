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

function healingTactic(acc, { context, action, profile }) {
  if (!isCurated(action)) return;
  const injuredAlly = contextAllies(context).find((ally) => hpPercent(ally) < 0.5);
  if (hpPercent(profile) < 0.5) {
    acc.score += 34;
    acc.reasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: selfReference(context).name }));
  } else if (injuredAlly) {
    acc.score += 34;
    acc.reasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: injuredAlly.name }));
  } else {
    acc.score -= 10;
    acc.reasons.push(t("ScoreReason.NoAllyIsBadly", "No ally is badly injured."));
  }
}

function damageTactic(acc, { action, target, targetDamageAdjustment }) {
  if (!isCurated(action) || !(target && inRange(action, target) && !action.activityProfile?.drawsWeapon)) return;
  const average = damageAverage(action);
  acc.score += Number.isFinite(average) ? 18 + Math.min(28, Math.round(average * 1.2)) : 18;
  acc.reasons.push(t("ScoreReason.CanDamage", "{action} can damage {target}.", { action: action.name, target: target.name }));
  if (targetDamageAdjustment) {
    acc.score += targetDamageAdjustment.scoreDelta;
    acc.reasons.push(...targetDamageAdjustment.reasons);
  }
}

function setupTactic(acc, { action, target }) {
  if (!isCurated(action) || !target) return;
  acc.score += action.activityProfile?.precisionDamageSetup ? 28 : 20;
  if (action.activityProfile?.createsConsumable === true) {
    acc.reasons.unshift(t("ScoreReason.QuickAlchemyCreatesAlchemicalTool", "{p0} creates a short-lived alchemical tool for this turn.", { p0: action.name }));
  } else {
    acc.reasons.unshift(t("ScoreReason.SetsUpStrongerFollowUp", "{p0} sets up stronger follow-up attacks.", { p0: action.name }));
  }
}

function mobilityTactic(acc, { context, action, profile, target }) {
  if (!isCurated(action)) return;
  const strideCount = Number(action.activityProfile?.strideCount ?? 1);
  const distance = Number(target?.distance ?? Infinity);
  const moveReach = activityMoveReach(profile, action, strideCount);
  if (action.activityProfile?.retreat && enemyInMelee(context)) {
    acc.score += 24;
    acc.reasons.unshift(t("ScoreReason.CanDisengageFromMelee", "{p0} can disengage from melee.", { p0: action.name }));
  } else if (target && distance > profileReach(profile) && distance <= moveReach) {
    acc.score += 18;
    acc.reasons.unshift(t("ScoreReason.CanImprovePositionToward", "{p0} can improve position toward {p1}.", { p0: action.name, p1: target.name }));
  } else {
    acc.score += 8;
    acc.reasons.unshift(t("ScoreReason.ImprovesPosition", "{p0} improves position.", { p0: action.name }));
  }
  if (action.activityProfile?.safeMovement) {
    acc.score += 6;
    acc.reasons.push(t("ScoreReason.MovementReducesReactionRisk", "Movement reduces reaction risk."));
  }
}

function drainTactic(acc, { action, profile, target }) {
  if (!isCurated(action) || !target) return;
  const required = action.activityProfile?.requiresAnyTargetCondition ?? [];
  if (required.length && !hasAnyCondition(target, required)) {
    acc.score -= 28;
    acc.reasons.unshift(t("ScoreReason.NeedsAGrabbedRestrainedParalyzed", "{p0} needs a grabbed, restrained, paralyzed, or unconscious target.", { p0: action.name }));
  } else {
    acc.score += hpPercent(profile) < 0.5 ? 58 : 42;
    acc.reasons.unshift(t("ScoreReason.CanDrainAndRecoverHit", "{p0} can drain {p1} and recover Hit Points.", { p0: action.name, p1: target.name }));
  }
}

function selfHealingTactic(acc, { context, action, profile }) {
  if (!isCurated(action)) return;
  const corpse = nearbyCorpse(context, profile);
  if (action.activityProfile?.requiresCorpse && !corpse) {
    acc.score -= 24;
    acc.reasons.unshift(t("ScoreReason.NeedsAnAdjacentCorpse", "{p0} needs an adjacent corpse.", { p0: action.name }));
  } else {
    acc.score += hpPercent(profile) < 0.5 ? 46 : 20;
    acc.reasons.unshift(corpse ? t("ScoreReason.CanUse", "{p0} can use {p1}.", { p0: action.name, p1: corpse.name }) : t("ScoreReason.CanRecoverHitPoints", "{p0} can recover Hit Points.", { p0: action.name }));
  }
}

function resourceRecoveryTactic(acc, { action }) {
  if (!isCurated(action)) return;
  acc.score += 8;
  acc.reasons.unshift(t("ScoreReason.CanRecoverAnExpendedCombat", "{p0} can recover an expended combat resource.", { p0: action.name }));
}

function transformationTactic(acc, { action }) {
  if (!isCurated(action)) return;
  acc.score += 6;
  acc.reasons.unshift(t("ScoreReason.MayAlterMovementOrAttack", "{p0} may alter movement or attack options.", { p0: action.name }));
}

function areaDamageTactic(acc, { context, action, profile }) {
  if (!isCurated(action)) return;
  const placement = scoredAreaPlacement(action, context, {
    enemyValues: attackableEnemies(context),
    allyValues: contextAllies(context),
    maxCastRange: maxRange(action),
  });
  const enemiesInArea = placement.enemies;
  const alliesInArea = placement.allies;
  acc.areaHitCount = enemiesInArea.length;
  acc.areaPlacementCenter = placement.areaPlacementCenter;
  acc.areaPlacementAimPoint = placement.areaPlacementAimPoint;
  acc.areaPlacementOptions = placement.areaPlacementOptions;
  if (enemiesInArea.length > 0) {
    acc.score += enemiesInArea.length === 1
      ? 14
      : 34 + enemiesInArea.length * 18;
    const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
    acc.reasons.unshift(t("ScoreReason.CanHit", "{p0} can hit {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
  } else {
    acc.score -= 28;
    acc.reasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
  }
  if (alliesInArea.length > 0) {
    acc.score -= alliesInArea.length * 18;
    acc.reasons.push(t(alliesInArea.length === 1 ? "ScoreReason.AlliesInAreaOne" : "ScoreReason.AlliesInAreaMany", alliesInArea.length === 1 ? "{count} ally may be in the area." : "{count} allies may be in the area.", { count: alliesInArea.length }));
  } else if (enemiesInArea.length > 1 && placement.areaPlacementCenter) {
    acc.score += 8;
    acc.reasons.push(t("ScoreReason.BestAreaPlacementAvoids", "Best area placement avoids allies."));
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
  acc.score += tacticalDelta;
  const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
  if (bestSave) acc.reasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
  for (const entry of damageDeltas.slice(0, 2)) acc.reasons.push(...entry.reasons);
}

function saveDamageTactic(acc, { action, target, targetSaveScore, targetDamageAdjustment }) {
  if (!isCurated(action) || !target) return;
  const requiredCondition = action.activityProfile?.requiresTargetCondition;
  const needsSetup = requiredCondition && !hasRequiredCondition(target, requiredCondition);
  const average = damageAverage(action);
  acc.score += requiredCondition ? 52 : 34;
  if (Number.isFinite(average)) acc.score += Math.min(30, Math.round(average));
  acc.reasons.unshift(needsSetup
    ? t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition })
    : t("ScoreReason.CanForceASave", "{p0} can force a {p1} save.", { p0: action.name, p1: action.saveProfile?.stat ?? "save" }));
  if (targetSaveScore) {
    acc.score += targetSaveScore.scoreDelta;
    acc.reasons.push(targetSaveScore.label);
  }
  if (targetDamageAdjustment) {
    acc.score += targetDamageAdjustment.scoreDelta;
    acc.reasons.push(...targetDamageAdjustment.reasons);
  }
}

function grabTactic(acc, { action, profile, target }) {
  if (!isCurated(action) || !target) return;
  if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
    acc.score -= 14;
    acc.reasons.unshift(t("ScoreReason.IsAlreadyGrabbed", "{p0} is already grabbed.", { p0: target.name }));
  } else if (inProfileReach(profile, target)) {
    acc.score += 42;
    acc.reasons.unshift(t("ScoreReason.CanGrab", "{p0} can grab {p1}.", { p0: action.name, p1: target.name }));
  } else {
    acc.score -= 24;
    acc.reasons.unshift(t("ScoreReason.TargetIsOutOfReach", "{p0} target is out of reach.", { p0: action.name }));
  }
}

function controlOrDebuffTactic(acc, { context, action, profile, target, targetSaveScore, role }) {
  if (!isCurated(action)) return;
  if (isAreaAction(action, role)) {
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
    acc.areaHitCount = enemiesInArea.length;
    acc.areaPlacementCenter = placement.areaPlacementCenter;
    acc.areaPlacementAimPoint = placement.areaPlacementAimPoint;
    acc.areaPlacementOptions = placement.areaPlacementOptions;

    if (!enemiesInArea.length) {
      acc.score -= 24;
      acc.reasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
    } else if (
      appliedConditions.length
      && enemiesInArea.every((enemy) => appliedConditions.some((condition) => hasCondition(enemy, condition)))
    ) {
      acc.score -= 8;
      acc.reasons.unshift(t("ScoreReason.AreaTargetsAlreadyHave", "{p0} area targets already have {p1}.", { p0: action.name, p1: appliedConditions[0] }));
    } else {
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      acc.score += (appliedConditions.length ? 30 : 22) + enemiesInArea.length * 12;
      acc.reasons.unshift(t("ScoreReason.CanAffect", "{p0} can affect {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
      const saveDeltas = enemiesInArea
        .filter((enemy) => canUseTargetDefenses(context, enemy, saveIntelCategory(action)))
        .map((enemy) => saveScoreDelta(context, action, enemy, profile))
        .filter(Boolean);
      const tacticalDelta = Math.round(
        saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.4,
      );
      acc.score += tacticalDelta;
      const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
      if (bestSave) acc.reasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
    }
  } else if (target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    const appliedCondition = appliedConditions[0];
    if (requiredCondition && !hasRequiredCondition(target, requiredCondition)) {
      acc.score -= 24;
      acc.reasons.unshift(t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition }));
    } else if (appliedConditions.some((condition) => hasCondition(target, condition))) {
      acc.score -= 10;
      acc.reasons.unshift(t("ScoreReason.AlreadyHas", "{p0} already has {p1}.", { p0: target.name, p1: appliedCondition }));
    } else {
      acc.score += appliedCondition ? 42 : 32;
      acc.reasons.unshift(t("ScoreReason.CanControl", "{p0} can control {p1}.", { p0: action.name, p1: target.name }));
      if (targetSaveScore) {
        acc.score += targetSaveScore.scoreDelta;
        acc.reasons.push(targetSaveScore.label);
      }
    }
  }
}

function reactionAttackTactic(acc, { action }) {
  if (!isCurated(action)) return;
  acc.score += 26;
  acc.reasons.unshift(t("ScoreReason.ReactionCanPunishTheCurrent", "Reaction can punish the current trigger."));
}

function defenseTactic(acc, { action, profile, pressure }) {
  if (!isCurated(action)) return;
  if (action.slug === "drop-prone") {
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
      acc.score += rangedAttackPenalty - 30;
      acc.reasons.unshift(t("ScoreReason.ProneNoDefenseBenefit", "Off-Guard applies to every attacker alike, so dropping prone gives no defensive benefit against melee or ranged on its own."));
    } else {
      acc.score += rangedAttackPenalty - 10;
      acc.reasons.unshift(t("ScoreReason.NoThreatForProne", "No current threat makes dropping prone worthwhile."));
    }
  } else {
    acc.score += hpPercent(profile) < 0.5 ? 34 : 18;
    acc.reasons.unshift(t("ScoreReason.DefensiveReactionIsAvailableFor", "Defensive reaction is available for the trigger."));
  }
}

function buffTactic(acc, { context, action }) {
  if (!isCurated(action)) return;
  // recipient.value (buffs.js) already scores attackBuff/damageBuff, extraAction, defensive
  // buffs, removesCondition, and an "already has this" penalty for the chosen recipient -- it is
  // the complete signal, not a starting point to layer more of the same weights on top of.
  const recipient = bestBuffRecipient(context, action);
  const allyTarget = recipient?.type === "ally";
  const grantsQuickened = actionGrantsQuickened(action);
  const buffValue = Number(recipient?.value) || 0;
  acc.score += buffValue;
  if (recipient?.entity && targetAlreadyHasBuff(recipient.entity, action)) {
    acc.reasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipient.entity.name ?? t("ScoreReason.TargetWord", "Target"), action: action.name }));
  }
  acc.reasons.unshift(grantsQuickened ? t("ScoreReason.GrantsQuickened", "{p0} grants quickened.", { p0: action.name }) : allyTarget ? t("ScoreReason.CanBoost", "{p0} can boost {p1}.", { p0: action.name, p1: recipient.entity?.name ?? "an ally" }) : t("ScoreReason.GrantsTheActorABeneficial", "{p0} grants the actor a beneficial effect.", { p0: action.name }));
}

function stealthDefenseTactic(acc, { context, action }) {
  if (!isCurated(action)) return;
  // Same principle as the buff block above: recipient.value already reflects an "already has
  // this" penalty, so it is not re-applied a second time here on top of the stealth-specific base.
  const recipient = bestBuffRecipient(context, action);
  const recipientName = recipient?.type === "ally" ? recipient.entity?.name ?? "an ally" : "the actor";
  acc.score += 22 + (Number(recipient?.value) || 0);
  if (targetAlreadyHasBuff(recipient?.entity, action)) {
    acc.reasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipientName, action: action.name }));
  }
  acc.reasons.unshift(t("ScoreReason.CanMakeHarderToTarget", "{p0} can make {p1} harder to target.", { p0: action.name, p1: recipientName }));
}

function summonTactic(acc, { action }) {
  if (!isCurated(action)) return;
  acc.score += 14;
  acc.reasons.unshift(t("ScoreReason.BringsAnAllyOrConstruct", "{p0} brings an ally or construct onto the battlefield.", { p0: action.name }));
}

// Last-resort options: recognized but no tactical pattern. Push well below the
// basics so they only surface when nothing stronger fills the turn. Unlike every tactic above,
// this one (and the three below it) apply regardless of curation status.
function utilityTactic(acc, { action }) {
  acc.score -= 30;
  acc.reasons.unshift(t("ScoreReason.IsAvailableNoStrongerPattern", "{p0} is available; no stronger pattern recognized.", { p0: action.name }));
}

function explorationUtilityTactic(acc, { context, action }) {
  acc.score -= contextEnemies(context).length ? 46 : 18;
  acc.reasons.unshift(t("ScoreReason.IsMostlyExplorationUtility", "{p0} is mostly exploration utility.", { p0: action.name }));
}

function combatUtilityTactic(acc, { context, action }) {
  acc.score += contextEnemies(context).length ? 4 : -8;
  acc.reasons.unshift(t("ScoreReason.HasSituationalCombatUtility", "{p0} has situational combat utility.", { p0: action.name }));
}

function sustainControlTactic(acc, { context, action }) {
  acc.score += contextEnemies(context).length ? 18 : 4;
  acc.reasons.unshift(t("ScoreReason.CanMaintainOngoingControl", "{p0} can maintain ongoing control.", { p0: action.name }));
}

// Three separate maps, not one -- the draws-weapon/aggro checks and the drops-weapon check are
// unconditional (they run for every role) and sit between the role tactics below at fixed points,
// so preserving the exact reason-ordering the UI has always shown means dispatching in three slots
// rather than one flat lookup.
const EARLY_ROLE_TACTICS = {
  healing: healingTactic,
  damage: damageTactic,
  "weapon-strike": damageTactic,
};

const ROLE_TACTICS = {
  setup: setupTactic,
  mobility: mobilityTactic,
  drain: drainTactic,
  "self-healing": selfHealingTactic,
  "resource-recovery": resourceRecoveryTactic,
  transformation: transformationTactic,
  "area-damage": areaDamageTactic,
  "save-damage": saveDamageTactic,
  grab: grabTactic,
  control: controlOrDebuffTactic,
  debuff: controlOrDebuffTactic,
  "reaction-attack": reactionAttackTactic,
  defense: defenseTactic,
  buff: buffTactic,
  "stealth-defense": stealthDefenseTactic,
  summon: summonTactic,
  utility: utilityTactic,
};

const LATE_ROLE_TACTICS = {
  "exploration-utility": explorationUtilityTactic,
  "combat-utility": combatUtilityTactic,
  "sustain-control": sustainControlTactic,
};

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
  const acc = {
    action,
    score: Number.isFinite(Number(score)) ? Number(score) : 0,
    reasons: Array.isArray(reasons) ? reasons : [],
    areaHitCount: null,
    areaPlacementCenter: null,
    areaPlacementAimPoint: null,
    areaPlacementOptions: [],
  };
  const deps = { context, action, profile, target, targetDamageAdjustment, targetSaveScore, pressure, role };

  EARLY_ROLE_TACTICS[role]?.(acc, deps);

  if (action.activityProfile?.drawsWeapon && target) {
    const weaponName = action.activityProfile.weaponName ?? action.item?.name ?? action.name;
    if (inActionReach(profile, action, target)) {
      // Drawing a weapon costs an action. It is the strong play only when no
      // enemy is already in melee reach; otherwise an in-hand Strike on the
      // adjacent enemy is the better use of the turn.
      acc.score += enemyInMelee(context) ? 18 : 82;
      acc.reasons.unshift(t("ScoreReason.DrawAndStrike", "Draw {p0} and Strike {p1}.", { p0: weaponName, p1: target.name }));
    } else {
      acc.score -= 40;
      acc.reasons.unshift(t("ScoreReason.IsStillOutOfRange", "{p0} is still out of range after drawing.", { p0: weaponName }));
    }
  }

  const aggro = target ? aggroProfile(context, target) : null;
  if (aggro?.gmOnly && aggro.roles.length && aggro.score > 0) {
    acc.reasons.push(t("ScoreReason.AggroPriority", "Aggro priority: {roles}.", { roles: aggro.roles.join(" -> ") }));
  }

  ROLE_TACTICS[role]?.(acc, deps);

  // Releasing a held weapon is a free action, so it never competes for the turn's action budget
  // -- without a further penalty it would win as costless filler over doing nothing at all. Nothing
  // in this engine's planning currently benefits from a freed hand (no somatic-spell or two-handed
  // draw logic consumes it), so there is never a real reason for Auto-fill to pick this on its own;
  // it stays available to browse and add manually for the rare case a player actually wants it.
  if (action.activityProfile?.dropsWeapon) {
    acc.score -= 60;
    acc.reasons.unshift(t("ScoreReason.DropsAWeaponForNo", "{p0} drops a weapon for no tactical benefit.", { p0: action.name }));
  }

  LATE_ROLE_TACTICS[role]?.(acc, deps);

  return {
    score: acc.score,
    reasons: acc.reasons,
    areaHitCount: acc.areaHitCount,
    areaPlacementCenter: acc.areaPlacementCenter,
    areaPlacementAimPoint: acc.areaPlacementAimPoint,
    areaPlacementOptions: acc.areaPlacementOptions,
  };
}
