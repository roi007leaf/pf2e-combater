import { actionIncludes } from "../action/requirements.js";
import {
  hasCondition,
  hpPercent,
  inRange,
} from "./facts.js";
import {
  contextAllies,
  contextEnemies,
  firstContextTarget,
  selfTargetReference,
} from "../target-pool.js";
import { t } from "../../i18n.js";

export function selfReference(context) {
  return selfTargetReference(context, t("ScoreReason.SelfWord", "Self"));
}

export function includesStand(action) {
  return action?.slug === "stand"
    || actionIncludes(action, "stand")
    || action?.activityProfile?.removesCondition === "prone";
}

export function dyingAlly(context) {
  return contextAllies(context).find((ally) => hasCondition(ally, "dying"));
}

export function bleedingAlly(context) {
  return contextAllies(context).find((ally) => hasCondition(ally, "persistent-bleed"));
}

export function enemyInMelee(context) {
  const target = firstContextTarget(context);
  return Boolean(target && (target.distance ?? Infinity) <= 5);
}

export function profileSpeed(profile) {
  const speed = Number(profile?.speed ?? profile?.landSpeed);
  return Number.isFinite(speed) && speed > 0 ? speed : 25;
}

export function profileReach(profile) {
  const reach = Number(profile?.reach ?? profile?.meleeReach);
  return Number.isFinite(reach) && reach >= 0 ? reach : 5;
}

export function inProfileReach(profile, target) {
  return Boolean(target && (target.distance ?? Infinity) <= profileReach(profile));
}

export function inActionReach(profile, action, target) {
  if (action?.targetingProfile?.maxRange) return inRange(action, target);
  return inProfileReach(profile, target);
}

export function profileMoveReach(profile, strideCount = 1) {
  return profileSpeed(profile) * Math.max(1, Number(strideCount) || 1) + profileReach(profile);
}

export function activityStrikeReach(profile, action) {
  const reach = Number(action?.activityProfile?.strikeReach);
  return Number.isFinite(reach) && reach >= 0 ? reach : profileReach(profile);
}

export function activityMoveReach(profile, action, strideCount = 1) {
  const fixedDistance = Number(action?.activityProfile?.fixedDistance ?? action?.activityProfile?.maxDistance);
  if (Number.isFinite(fixedDistance) && fixedDistance > 0) return fixedDistance + activityStrikeReach(profile, action);
  return profileSpeed(profile) * Math.max(1, Number(strideCount) || 1) + activityStrikeReach(profile, action);
}

export function nearbyCorpse(context, profile) {
  const reach = profileReach(profile);
  return [...contextEnemies(context), ...contextAllies(context)].find((entity) =>
    (entity?.distance ?? Infinity) <= reach
      && (hpPercent(entity) <= 0 || hasCondition(entity, "dead") || hasCondition(entity, "destroyed")),
  );
}

export function plural(count, singular, pluralValue) {
  return count === 1 ? singular : pluralValue;
}

export function baseScore(action) {
  if (action.source === "spell-curated") return 50;
  if (action.source === "custom-curated") return 48;
  if (action.source === "strike") return 46;
  if (action.source === "system-inferred") return 44;
  if (action.source === "spell-inferred") return 44;
  if (action.source === "generic") return 42;
  return 20;
}

export function defaultReason(action) {
  if (action.source === "custom-curated") return "Actor-specific action is recognized.";
  if (action.source === "system-inferred") return "System action pattern is recognized.";
  if (action.source === "spell-curated") return "Curated spell is available.";
  if (action.source === "spell-inferred") return "Spell pattern is recognized.";
  return "Action is available.";
}

export function isCurated(action) {
  return action.source === "spell-curated"
    || action.source === "custom-curated"
    || action.source === "system-inferred"
    || action.source === "spell-inferred";
}
