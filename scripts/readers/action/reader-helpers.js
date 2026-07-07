import { entityKey as targetKey } from "../../foundry-data.js";
import { canAttackTarget, contextEnemies, contextTargets } from "../../engine/target-pool.js";

const MOVE_ACTION_SLUGS = new Set([
  "balance",
  "climb",
  "crawl",
  "high-jump",
  "long-jump",
  "sneak",
  "stand",
  "step",
  "stride",
  "swim",
  "tumble-through",
]);
const IMMOBILIZING_CONDITIONS = new Set([
  "grappled",
  "grabbed",
  "immobilised",
  "immobilized",
  "paralyzed",
  "petrified",
  "restrained",
  "unconscious",
]);
const PRONE_ALLOWED_MOVE_ACTION_SLUGS = new Set(["crawl", "stand"]);

export function contextProfile(context) {
  return context?.profile ?? context?.actor?.profile ?? {};
}

export function hasCondition(entity, slug) {
  const conditions = entity?.conditions;
  if (!conditions) return false;
  if (Array.isArray(conditions)) {
    return conditions.some((condition) => condition === slug || condition?.slug === slug);
  }
  if (Array.isArray(conditions.slugs) && conditions.slugs.includes(slug)) return true;
  const value = Number(conditions.values?.[slug]);
  if (Number.isFinite(value)) return value > 0;
  return false;
}

export function canStandBeforeMovement(profile) {
  return movementBlockingCondition(profile, { slug: "stride" }) === "prone"
    && !movementBlockingCondition(profile, { slug: "stand", traits: ["move"] });
}

export function uniqueTargets(context) {
  const seen = new Set();
  const targets = [];
  for (const target of [...contextTargets(context), ...contextEnemies(context)]) {
    if (!canAttackTarget(target)) continue;
    const key = targetKey(target);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    targets.push(target);
  }
  return targets;
}

export function meleeReach(profile) {
  const reach = Number(profile?.reach ?? profile?.meleeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

export function movementRange(profile) {
  const speed = Number(profile?.speed ?? profile?.landSpeed);
  return Number.isFinite(speed) && speed > 0 ? speed : 30;
}

export function normalizedTraits(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((trait) => trait?.slug ?? trait?.name ?? trait);
  if (value instanceof Set) return Array.from(value);
  return [];
}

export function activityUsesMovement(activityProfile) {
  const includes = Array.isArray(activityProfile?.includes) ? activityProfile.includes : [];
  return Number(activityProfile?.strideCount) > 0
    || includes.some((entry) => ["move", "stride"].includes(String(entry ?? "").toLowerCase()));
}

export function actionUsesMovement(action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  if (MOVE_ACTION_SLUGS.has(slug)) return true;
  if (normalizedTraits(action?.traits).some((trait) => String(trait ?? "").toLowerCase() === "move")) return true;
  return activityUsesMovement(action?.activityProfile);
}

export function movementBlockingCondition(profile, action) {
  for (const slug of IMMOBILIZING_CONDITIONS) {
    if (hasCondition(profile, slug)) return slug;
  }
  const slug = String(action?.slug ?? "").toLowerCase();
  if (hasCondition(profile, "prone") && !PRONE_ALLOWED_MOVE_ACTION_SLUGS.has(slug)) return "prone";
  return null;
}
