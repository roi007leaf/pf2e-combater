import { t } from "../i18n.js";

const REAL_COMBAT_ROLES = new Set([
  "area-damage",
  "control",
  "damage",
  "debuff",
  "drain",
  "grab",
  "mobility-attack",
  "multiattack",
  "save-damage",
]);

function isNpcContext(context) {
  return context?.profile?.actorType === "npc"
    || context?.actor?.profile?.actorType === "npc"
    || context?.actor?.document?.type === "npc";
}

function isRealCombatOption(action) {
  const role = action?.role;
  return action?.available !== false
    && (
      action?.source === "strike"
      || action?.activityProfile?.includesStrike === true
      || action?.attackTrait === true
      || REAL_COMBAT_ROLES.has(role)
      || Boolean(action?.damageProfile)
      || Boolean(action?.saveProfile)
    );
}

function isLowConfidenceUtility(action) {
  return action?.role === "utility"
    && action?.confidence === "low"
    && action?.source === "system-inferred";
}

function enemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? context?.targets ?? context?.battlefield?.targets ?? [];
}

function allies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function profileReach(context) {
  const reach = Number(
    context?.profile?.reach
      ?? context?.actor?.profile?.reach
      ?? context?.actor?.document?.system?.attributes?.reach?.base
      ?? 5,
  );
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function hasCondition(entity, slug) {
  const conditions = entity?.conditions;
  if (!conditions) return false;
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => condition === slug || condition?.slug === slug);
  }
  if (Array.isArray(conditions.slugs) && conditions.slugs.includes(slug)) return true;
  const value = Number(conditions.values?.[slug]);
  return Number.isFinite(value) && value > 0;
}

function targetHasAnyCondition(target, slugs) {
  return slugs.some((slug) => hasCondition(target, slug));
}

function inReach(context, target) {
  const distance = Number(target?.distance);
  return Number.isFinite(distance) && distance <= profileReach(context);
}

function nearbyEnemyCount(context, distance = 30) {
  return enemies(context).filter((enemy) => (enemy?.distance ?? Infinity) <= distance).length;
}

export function npcTacticRejection(context, action, detectedActions) {
  if (!isNpcContext(context) || !isLowConfidenceUtility(action)) return "";
  const hasBetterCombatOption = detectedActions
    .filter((candidate) => candidate !== action)
    .some(isRealCombatOption);
  return hasBetterCombatOption
    ? t("NpcReason.HiddenLowConfidence", "Low-confidence NPC utility hidden because stronger combat options exist.")
    : "";
}

export function npcTacticAdjustment(context, action, { target = null, areaHitCount = null } = {}) {
  if (!isNpcContext(context)) return { scoreDelta: 0, reasons: [] };

  const family = action?.activityProfile?.npcFamily;
  if (!family) return { scoreDelta: 0, reasons: [] };

  const reasons = [];
  let scoreDelta = 0;

  if (family === "breath-weapon") {
    const hitCount = Number.isFinite(areaHitCount) ? areaHitCount : nearbyEnemyCount(context, 30);
    if (hitCount >= 2) {
      scoreDelta += 34;
      reasons.push(t("NpcReason.NpcSignatureAreaAbilityCan", "NPC signature area ability can catch multiple enemies."));
    } else if (hitCount === 1) {
      scoreDelta += 8;
      reasons.push(t("NpcReason.NpcSignatureAreaAbilityHas", "NPC signature area ability has a valid target."));
    } else {
      scoreDelta -= 24;
      reasons.push(t("NpcReason.NpcSignatureAreaAbilityHas2", "NPC signature area ability has no good target."));
    }
    if (!allies(context).length || hitCount >= 2) scoreDelta += 6;
  }

  if (family === "grab-rider") {
    if (targetHasAnyCondition(target, ["grabbed", "restrained"])) {
      scoreDelta -= 20;
      reasons.push(t("NpcReason.TargetIsAlreadyHeld", "Target is already held."));
    } else if (target && inReach(context, target)) {
      scoreDelta += 22;
      reasons.push(t("NpcReason.NpcGrabRiderStartsA", "NPC grab rider starts a stronger control chain."));
    }
  }

  if (family === "grab-followup" || family === "swallow-whole") {
    if (targetHasAnyCondition(target, ["grabbed", "restrained"])) {
      scoreDelta += family === "swallow-whole" ? 42 : 28;
      reasons.push(t("NpcReason.NpcFollowUpPaysOff", "NPC follow-up pays off an already held target."));
    } else {
      scoreDelta -= 28;
      reasons.push(t("NpcReason.NpcFollowUpNeedsA", "NPC follow-up needs a held target first."));
    }
  }

  if (family === "gaze") {
    scoreDelta += enemies(context).length ? 18 : -12;
    reasons.push(t("NpcReason.NpcGazeAbilityPressuresEnemies", "NPC gaze ability pressures enemies without closing distance."));
  }

  if (family === "aura") {
    const nearby = nearbyEnemyCount(context, 15);
    scoreDelta += nearby ? 12 + nearby * 4 : 4;
    reasons.push(t("NpcReason.NpcAuraHasBattlefieldValue", "NPC aura has battlefield value while enemies stay nearby."));
  }

  if (family === "recharge") {
    scoreDelta += 18;
    reasons.push(t("NpcReason.NpcRechargeActionCanRestore", "NPC recharge action can restore a signature ability."));
  }

  if (family === "troop-action" || family === "trample") {
    const count = enemies(context).length;
    scoreDelta += count >= 2 ? 22 : 8;
    reasons.push(t("NpcReason.NpcMovementAttackIsStronger", "NPC movement attack is stronger into clustered enemies."));
  }

  if (family === "death-trigger") {
    scoreDelta -= 80;
    reasons.push(t("NpcReason.DeathTriggerAbilityIsNot", "Death-trigger ability is not a normal turn plan."));
  }

  return { scoreDelta, reasons };
}
