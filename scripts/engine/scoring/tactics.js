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
  actionTraitSlugs,
  damageAdjustment,
  hasCondition,
  hasEffect,
  hasSpellcastingCapability,
  hpPercent,
  inRange,
  isAttackLikeAction,
  isMeleeStrikeFallback,
  isRangedStrike,
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
  inActionReach,
  isCurated,
  profileReach,
  selfReference,
  strikeDamageScore,
} from "./tactic-helpers.js";
import { t } from "../../i18n.js";
import { HARD_BLOCK_SCORE } from "./weights.js";
import { healingRecipientAllowed, isEidolonOnlySpell } from "./gates.js";
import { recallKnowledgeAttemptState } from "../../rules/recall-knowledge.js";
import { canUseIntelCategory, isNpcIntelTarget } from "../../rules/intel-ledger.js";
import { contextActorDocument } from "../actor-context.js";

export { baseScore, defaultReason, includesStand } from "./tactic-helpers.js";

function deadlyStrikeScore(action, criticalChance) {
  const trait = actionTraitSlugs(action).find((slug) => /^deadly-(?:[1-3])?d\d+$/.test(slug));
  if (!trait) return 0;
  const match = trait.match(/^deadly-([1-3])?d(\d+)$/);
  const dice = Number(match[1]) || 1;
  const faces = Number(match[2]);
  const chance = Number.isFinite(criticalChance) ? criticalChance : 0.1;
  return Math.round(dice * ((faces + 1) / 2) * chance * 2);
}

// Fatal raises the weapon's dice to the fatal die on a critical hit and adds one more such die.
function fatalStrikeScore(action, criticalChance) {
  const trait = actionTraitSlugs(action).find((slug) => /^fatal-d\d+$/.test(slug));
  if (!trait) return 0;
  const faces = Number(trait.slice("fatal-d".length));
  const damage = action?.item?.system?.damage ?? action?.strike?.item?.system?.damage ?? {};
  const dice = Math.max(1, Number(damage.dice) || 1);
  const baseFaces = Number(String(damage.die ?? "d6").replace(/^d/, "")) || 6;
  const chance = Number.isFinite(criticalChance) ? criticalChance : 0.1;
  const critGain = dice * Math.max(0, faces - baseFaces) + (faces + 1) / 2;
  return Math.round(critGain * chance * 2);
}

function strikeAttackBonus(action) {
  const strike = action?.strike ?? {};
  const values = [strike.totalModifier, strike.variants?.[0]?.modifier, action?.attackBonus];
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

const OFF_GUARD_SOURCES = ["off-guard", "flat-footed", "prone", "grabbed", "restrained", "paralyzed", "unconscious", "blinded"];

function targetConditionValue(target, slug) {
  const conditions = target?.conditions ?? {};
  const slugs = Array.isArray(conditions) ? conditions.map((entry) => entry?.slug ?? entry) : conditions.slugs ?? [];
  if (!slugs.includes(slug)) return 0;
  const value = Number(Array.isArray(conditions) ? conditions.find((entry) => (entry?.slug ?? entry) === slug)?.value : conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

// AC the attack actually faces: off-guard (from any of its sources) is -2; frightened, clumsy and
// sickened lower AC by their value (status penalties don't stack, so the worst one counts).
export function targetAcPenalty(target) {
  const offGuard = OFF_GUARD_SOURCES.some((slug) => targetConditionValue(target, slug) > 0) ? 2 : 0;
  const status = Math.max(targetConditionValue(target, "frightened"), targetConditionValue(target, "sickened"));
  return offGuard + status + targetConditionValue(target, "clumsy");
}

// Hit chance at MAP 0: the target's AC when it's known, else a moderate-AC creature of your own level
// (GM Core creature table, roughly 13 + 1.5 x level) -- never the hidden real level or AC.
function strikeHitChance(action, target, profile) {
  const bonus = strikeAttackBonus(action);
  if (bonus === null) return null;
  const knownAc = Number(target?.ac);
  const level = Number(profile?.level);
  const ac = Number.isFinite(knownAc) && knownAc > 0
    ? knownAc
    : Number.isFinite(level) ? Math.round(13 + 1.5 * Math.max(-1, level)) : null;
  if (ac === null) return null;
  return Math.min(0.95, Math.max(0.05, (21 - (ac - targetAcPenalty(target) - bonus)) / 20));
}

// -2 to attack per range increment past the first (PF2e range penalty), ~3 points per point.
function rangeIncrementPenalty(action, target) {
  const increment = Number(action?.range?.increment);
  const distance = Number(target?.distance);
  if (!(increment > 0) || !Number.isFinite(distance) || distance <= increment) return 0;
  return (Math.ceil(distance / increment) - 1) * 6;
}

// What a lasting debuff is worth beyond your own next attacks (those are priced by the planner's
// step-by-step re-scoring): each ally attacking the target before it fades gains ~5% per point, and
// the target's own rolls suffer too. Scales with the party instead of a flat bonus.
function partyDebuffValue(context, points) {
  const allies = Math.min(3, contextAllies(context).filter((ally) => ally?.hpPercent !== 0).length);
  return Math.round(points * (8 + allies * 3));
}

// The defensive side of the same scale: an AC point is worth more the more enemies can attack you
// this round, and more again when you're low.
function selfDefenseValue(profile, threats, points) {
  const value = points * (6 + Math.min(3, threats) * 6);
  return Math.round(hpPercent(profile) < 0.5 ? value * 1.5 : value);
}

// Re-applying a condition the target already has wastes the action: enough to outweigh any role
// bonus (a Debuffer's +36) so it never leads a plan.
const REDUNDANT_DEBUFF_PENALTY = 45;

function conditionLevel(target, slug) {
  const conditions = target?.conditions ?? {};
  const slugs = Array.isArray(conditions) ? conditions.map((entry) => entry?.slug ?? entry) : conditions.slugs ?? [];
  if (!slugs.includes(slug)) return 0;
  const value = Number(Array.isArray(conditions) ? conditions.find((entry) => (entry?.slug ?? entry) === slug)?.value : conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function demoralizeTactic(acc, { context, target }) {
  if (!target) return;
  const frightened = conditionLevel(target, "frightened");
  if (frightened >= 2) {
    // A success gives frightened 1, a critical success 2: nothing to gain.
    acc.score -= REDUNDANT_DEBUFF_PENALTY;
    acc.reasons.push(t("ScoreReason.AlreadyFrightened", "{name} is already frightened {value}.", { name: target.name, value: frightened }));
    return;
  }
  if (frightened >= 1) return;
  acc.score += 4 + partyDebuffValue(context, 1);
  acc.reasons.push(t("ScoreReason.TargetIsNotFrightened", "Target is not frightened."));
}

function tripTactic(acc, { context, target }) {
  if (!target) return;
  if (hasCondition(target, "prone")) {
    acc.score = HARD_BLOCK_SCORE;
    acc.reasons.push(t("ScoreReason.AlreadyProne", "{name} is already prone.", { name: target.name }));
    return;
  }
  // Prone: off-guard (-2 AC) to the party's attacks until it spends an action to Stand.
  acc.score += Math.round(partyDebuffValue(context, 2) * 0.6) + 6;
  acc.reasons.push(t("ScoreReason.TargetIsStandingAnd", "Target is standing and can be knocked prone."));
}

function grappleTactic(acc, { context, target }) {
  if (!target) return;
  if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
    acc.score -= REDUNDANT_DEBUFF_PENALTY;
    acc.reasons.push(t("ScoreReason.AlreadyGrabbed", "{name} is already grabbed.", { name: target.name }));
    return;
  }
  // Grabbed: off-guard to the party and it can't move away.
  acc.score += Math.round(partyDebuffValue(context, 2) * 0.6) + 4;
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

// Feint and Create a Diversion only set up your own next attack; the planner's re-scoring credits
// that payoff on the attack itself (weighted by the check's success), so the action alone is small.
function feintTactic(acc, { context, target }) {
  if (!(enemyInMelee(context) && !hasCondition(target, "off-guard"))) return;
  acc.score += 6;
  acc.reasons.push(t("ScoreReason.TargetIsInMelee", "Target is in melee and not off-guard."));
}

function createADiversionTactic(acc, { profile, target }) {
  if (!(target && !hasCondition(profile, "hidden"))) return;
  acc.score += 4;
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

const RECALL_CATEGORIES = ["saves", "weaknesses", "resistances", "immunities", "actions"];

function recallKnowledgeTactic(acc, { context, target }) {
  if (!target) return;
  // A failed attempt blocks further Recall Knowledge on this creature; each success already spent
  // leaves less to learn (and the DC climbs), so repeats are worth less every time.
  const state = recallKnowledgeAttemptState(contextActorDocument(context, { allowActorFallback: true }), target);
  if (state.blocked) {
    acc.score = HARD_BLOCK_SCORE;
    acc.reasons.push(t("ScoreReason.RecallKnowledgeBlocked", "Recall Knowledge on {target} already failed.", { target: target.name }));
    return;
  }
  // What the party still doesn't know decides how much there is to learn (the party's own ledger
  // only: a GM sees everything, so nothing is unknown there).
  const playerView = context?.isGM !== true && isNpcIntelTarget(target);
  const unknown = playerView ? RECALL_CATEGORIES.filter((category) => !canUseIntelCategory(context, target, category)).length : 0;
  const learnable = playerView ? (unknown ? unknown * 7 : -10) : 0;
  const value = Math.max(2, 16 + learnable - state.attempts * 7);
  acc.score += value;
  if (state.attempts > 0) {
    acc.reasons.push(t("ScoreReason.RecallKnowledgeRepeat", "Already recalled {count}x about {target}; less left to learn.", { count: state.attempts, target: target.name }));
  }
  acc.reasons.push(t("ScoreReason.IdentifyDefenses", "Identify {target} defenses and weaknesses.", { target: target.name }));
}

// Enemies that can hit you in melee right now (their reach, 5 ft by default).
function meleeThreatCount(context, pressure) {
  const byDistance = contextEnemies(context).filter((enemy) => enemy?.hpPercent !== 0
    && Number(enemy?.distance ?? Infinity) <= (Number(enemy?.meleeReach ?? enemy?.reach) || 5)).length;
  return Math.max(byDistance, pressure.meleeThreats?.length ?? 0);
}

function raiseAShieldTactic(acc, { context, profile, pressure }) {
  if (!profile.hasShield) return;
  // +2 AC against everyone who can attack you before your next turn.
  const threats = meleeThreatCount(context, pressure) + (pressure.hasOpenEnemyLine ? 1 : 0);
  acc.score += selfDefenseValue(profile, threats, 2);
  acc.reasons.push(t("ScoreReason.ShieldEquipped", "Shield equipped."));
  if (threats > 0) acc.reasons.push(t("ScoreReason.EnemiesHaveAClear", "Enemies have a clear attack line."));
}

function takeCoverTactic(acc, { profile, pressure }) {
  // Cover (+2 AC) only matters against attacks that come from range.
  const rangedThreats = pressure.hasOpenEnemyLine ? 2 : 0;
  acc.score += selfDefenseValue(profile, rangedThreats, 2);
  acc.reasons.push(t("ScoreReason.CoverIsAvailable", "Cover is available."));
  if (rangedThreats) acc.reasons.push(t("ScoreReason.OpenEnemyLineMakes", "Open enemy line makes cover valuable."));
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

// Act Together: the summoner's action also gives the eidolon one of its own. Planned like a commanded
// companion's sub-turn with a one-action budget (a Strike if it already reaches, else a Stride in).
function actTogetherTactic(acc, { context }) {
  const eidolons = context?.eidolons ?? [];
  if (!eidolons.length) return;
  acc.minionPlan = planMinionSubturn({ ...context, minions: eidolons }, { minionActionBudget: 1 });
  if (acc.minionPlan) {
    acc.score += 24 + acc.minionPlan.scoreDelta;
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
  "act-together": actTogetherTactic,
  "administer-first-aid": administerFirstAidTactic,
  stabilize: stabilizeTactic,
};

export function suggestedTargetFor(context, action, role, preferredTarget = firstContextTarget(context)) {
  const target = preferredTarget;
  const needsTargetableEnemy = requiresTargetableEnemy(action, role);

  if (isSelfCenteredAreaAction(action)) return null;

  // Boost Eidolon, Lifelink Surge, Evolution Surge...: only the summoner's eidolon can take them.
  if (isEidolonOnlySpell(action)) {
    const eidolon = context?.eidolons?.[0];
    return eidolon ? targetReference(eidolon, "ally") : null;
  }

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
    const profile = context?.profile ?? context?.actor?.profile ?? {};
    const rangeKnown = action?.targetingProfile?.reach === true || Number(action?.targetingProfile?.maxRange) > 0
      || String(action?.skill ?? action?.statistic ?? "").toLowerCase() === "medicine";
    // In range, and not already healed earlier in this plan: spread heals across the party.
    const healingAllies = contextAllies(context)
      .filter((ally) => !rangeKnown || !Number.isFinite(Number(ally?.distance)) || inActionReach(profile, action, ally))
      .filter((ally) => !hasCondition(ally, "healed"))
      .filter((ally) => healingRecipientAllowed(action, ally));
    const dying = healingAllies.find((ally) => hasCondition(ally, "dying"));
    if (dying) return targetReference(dying, "ally");
    // Stabilize has no one else to go to: name the dying ally even out of reach (a Stride comes first).
    if (/(?:^|-)stabilize$/.test(String(action?.slug ?? action?.id ?? "").toLowerCase())) {
      const farDying = contextAllies(context).filter((ally) => hasCondition(ally, "dying") && healingRecipientAllowed(action, ally))
        .toSorted((left, right) => (Number(left?.distance) || Infinity) - (Number(right?.distance) || Infinity))[0];
      if (farDying) return targetReference(farDying, "ally");
    }
    const bleeding = healingAllies.find((ally) => hasCondition(ally, "persistent-bleed"));
    if (bleeding) return targetReference(bleeding, "ally");
    const injuredAlly = healingAllies
      .filter((ally) => hpPercent(ally) < 0.75)
      .toSorted((left, right) => hpPercent(left) - hpPercent(right))[0];
    const selfHurt = hpPercent(profile) < 0.75 && !hasCondition(profile, "healed");
    if (injuredAlly && (!selfHurt || hpPercent(injuredAlly) < hpPercent(profile))) return targetReference(injuredAlly, "ally");
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

const UNARMED_WITH_WEAPON_PENALTY = 60;
const DRAW_ARMS_LATER_TURNS_BONUS = 25;

// Any real (non-unarmed) weapon already in hand.
function hasHeldWeapon(context) {
  const actor = contextActorDocument(context);
  return (actor?.itemTypes?.weapon ?? []).some((weapon) => String(weapon?.system?.category ?? "") !== "unarmed"
    && String(weapon?.system?.equipped?.carryType ?? "") === "held");
}

function isBasicUnarmed(item) {
  return item?.slug === "basic-unarmed" || item?.id === "xxPF2ExUNARMEDxx";
}

function hasDrawableWeapon(context) {
  const actor = contextActorDocument(context);
  // Monks fight with their fists on purpose.
  if (!actor || actor.type === "npc" || actor.class?.slug === "monk") return false;
  return (actor.itemTypes?.weapon ?? []).some((weapon) => {
    const carry = String(weapon?.system?.equipped?.carryType ?? "");
    const category = String(weapon?.system?.category ?? "");
    return category !== "unarmed" && ["worn", "held"].includes(carry) && weapon?.system?.quantity !== 0;
  });
}

export function scoreRoleTactics(context, action, { role, profile, target, criticalChance = null, backingStrike = null, extraStrikeValue = 0 } = {}) {
  const reasons = [...(action.reasons ?? [])];
  const targetDamageAdjustment = damageAdjustment(context, action, target);
  const targetSaveScore = saveScoreDelta(context, action, target, profile);
  const pressure = battlefieldPressure(context);
  let areaHitCount = null;
  let areaPlacementCenter = null;
  let areaPlacementAimPoint = null;
  let areaPlacementOptions = [];
  let minionPlan = null;
  const conditionalBonuses = [];
  let score = baseScore(action);

  if (Number(action.interactDrawCost) > 0) {
    reasons.push(t("ScoreReason.IncludesInteractToDraw", "Includes Interact to draw or retrieve the consumable."));
  }

  // A fist is the fallback for an empty hand, not the plan when a real weapon is one Draw away.
  // Same for a Sudden Charge or Power Attack that would land with the fist.
  if ((isBasicUnarmed(action.item) || (action.activityProfile?.requiresBackingStrike && isBasicUnarmed(backingStrike?.item)))
    && hasDrawableWeapon(context)) {
    score -= UNARMED_WITH_WEAPON_PENALTY;
    reasons.push(t("ScoreReason.DrawWeaponInstead", "A weapon is a Draw away; a fist is the fallback."));
  }
  // Drawing a real weapon when only fists are ready also arms every later turn, not just this Strike.
  if (action.activityProfile?.drawsWeapon === true && action.activityProfile?.includesStrike === true
    && !isBasicUnarmed(action.item) && !hasHeldWeapon(context)
    && !actionTraitSlugs(action).includes("bomb")) {
    score += DRAW_ARMS_LATER_TURNS_BONUS;
    reasons.push(t("ScoreReason.DrawArmsLaterTurns", "The drawn weapon stays ready for later turns."));
  }
  // Draw -> Strike hits with the drawn weapon: weigh its damage like a ready Strike's, so the rapier
  // beats the main-gauche.
  if (action.activityProfile?.drawsWeapon === true && action.activityProfile?.includesStrike === true && action.source !== "strike") {
    const average = Number(action.averageDamage);
    if (Number.isFinite(average) && average > 0) {
      score += strikeDamageScore(average);
      reasons.push(t("ScoreReason.AverageDamage", "Average damage about {amount}.", { amount: Math.round(average) }));
    }
  }

  if (action.source === "strike" && inRange(action, target)) {
    score += 24;
    reasons.push(maxRange(action) > 10 ? "Target is in range." : "Melee target is in reach.");

    // Prefer harder-hitting strikes strongly enough that a real weapon can beat
    // an agile unarmed fallback even after one prior attack.
    const average = Number(action.averageDamage);
    if (Number.isFinite(average) && average > 0) {
      const damageScore = strikeDamageScore(average);
      score += damageScore;
      reasons.push(t("ScoreReason.AverageDamage", "Average damage about {amount}.", { amount: Math.round(average) }));
      // Without the native roll preflight, weigh the damage by the chance to hit, so a +15 rapier
      // beats a +11 pistol with the same damage. Centered on a typical 60% so scales stay comparable.
      const hitChance = criticalChance === null || criticalChance === undefined ? strikeHitChance(action, target, profile) : null;
      if (hitChance !== null) {
        const delta = Math.round(Math.max(-15, Math.min(10, damageScore * (hitChance / 0.6 - 1))));
        if (delta) {
          score += delta;
          reasons.push(t("ScoreReason.HitChance", "About {percent}% to hit.", { percent: Math.round(hitChance * 100) }));
        }
      }
    }
    const deadlyScore = deadlyStrikeScore(action, criticalChance);
    if (deadlyScore > 0) {
      score += deadlyScore;
      reasons.push(t("ScoreReason.DeadlyCritical", "Deadly adds critical damage potential (+{amount}).", { amount: deadlyScore }));
    }
    const fatalScore = fatalStrikeScore(action, criticalChance);
    if (fatalScore > 0) {
      score += fatalScore;
      reasons.push(t("ScoreReason.FatalCritical", "Fatal adds critical damage potential (+{amount}).", { amount: fatalScore }));
    }
    const rangePenalty = rangeIncrementPenalty(action, target);
    if (rangePenalty > 0) {
      score -= rangePenalty;
      reasons.push(t("ScoreReason.RangeIncrementPenalty", "Beyond the first range increment: -{amount} to hit.", { amount: rangePenalty / 3 }));
    }
    if (action.attackEffects?.some((effect) => /\bdoom(?:ing|ed)?\b/i.test(String(effect)))
      && !hasCondition(target, "doomed")) {
      score += 18;
      const reason = t("ScoreReason.StrikeCanDoom", "Strike can make the target doomed.");
      reasons.push(reason);
      conditionalBonuses.push({ condition: "doomed", score: 18, reason });
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

  if (action.activityProfile?.retreat === true) {
    score += selfDefenseValue(profile, Number(action.activityProfile.threatsEscaped) || 1, 2);
    reasons.push(t("ScoreReason.RetreatOutOfReach", "Gets out of reach of {count} enemies.", { count: Number(action.activityProfile.threatsEscaped) || 1 }));
  }

  // No enemy to close on: a move is still a move (pick any square), just not one Auto-fill pads with.
  if (["step", "stride"].includes(action.slug) && action.source === "generic" && !target) {
    score = -10;
    reasons.push(t("ScoreReason.MoveAnywhere", "Move to any square you choose."));
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

      // Prone next to an enemy: -2 on your own attacks and off-guard for the enemy's whole turn.
      if (enemyInMelee(context)) {
        score += 60;
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
    backingStrike,
    extraStrikeValue,
  });
  score = activityProfileTactics.score;
  const outOfReach = activityProfileTactics.outOfReach === true;

  if (isCurated(action) && (action.curated?.friendlyFireRisk ?? action.friendlyFireRisk)) {
    if (contextAllies(context).some((ally) => (ally?.distance ?? Infinity) <= 20)) score -= 18;
    reasons.push(t("ScoreReason.AreaSpellHasFriendly", "Area spell has friendly-fire risk."));
  }

  // An eidolon's Strike is the eidolon fighting, not the summoner falling back to a weapon.
  if (hasSpellcastingCapability(context) && action.activityProfile?.eidolonStrike !== true) {
    if (isSpellAction(action)) {
      score += 18;
      reasons.push(t("ScoreReason.SpellcasterSpellOptionIs", "Spellcaster spell option is preferred over melee fallback."));
    } else if (isMeleeStrikeFallback(action)) {
      score -= 18;
      reasons.push(t("ScoreReason.SpellcasterMeleeStrikeIs", "Spellcaster melee Strike is lower priority than spell options."));
    } else if (action?.source === "strike" && isRangedStrike(action)) {
      // Ranged weapons too: with only the rapier penalised, a caster shot adjacent enemies point-blank.
      score -= 18;
      reasons.push(t("ScoreReason.SpellcasterRangedStrikeIs", "Spellcaster weapon Strike is lower priority than spell options."));
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
    conditionalBonuses,
    outOfReach,
  };
}
