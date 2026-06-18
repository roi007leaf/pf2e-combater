import { readCombatState } from "../rules/combat-state.js";

const ABILITY_SLUGS = ["str", "dex", "con", "int", "wis", "cha"];

function numericValue(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return Object.values(collection);
}

function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function readSkills(actor) {
  return Object.fromEntries(
    Object.entries(actor?.system?.skills ?? {}).map(([slug, skill]) => [
      slug,
      {
        rank: numericValue(skill?.rank, 0),
        mod: numericValue(skill?.mod ?? skill?.totalModifier, 0),
      },
    ]),
  );
}

function readAbilities(actor) {
  return Object.fromEntries(
    ABILITY_SLUGS.map((slug) => {
      const ability = actor?.system?.abilities?.[slug];
      return [slug, numericValue(ability?.mod, 0)];
    }),
  );
}

function readHp(actor) {
  const hp = actor?.system?.attributes?.hp ?? {};
  const value = numericValue(hp.value, 0);
  const max = numericValue(hp.max, 0);
  return {
    value,
    max,
    percent: max > 0 ? Math.max(0, Math.min(1, value / max)) : 1,
  };
}

function readSpeed(actor) {
  // Prepared PF2e actors expose land Speed under system.movement.speeds.land;
  // the older/compendium shape uses system.attributes.speed.
  const land = actor?.system?.movement?.speeds?.land;
  const fromMovement = numericValue(land?.value ?? land?.total ?? land?.base, null);
  if (fromMovement !== null) return fromMovement;

  const speed = actor?.system?.attributes?.speed;
  return numericValue(
    speed?.value
      ?? speed?.total
      ?? speed,
    25,
  );
}

function traitSlug(trait) {
  return String(trait?.slug ?? trait?.name ?? trait ?? "").toLowerCase();
}

function reachFromTraits(traits) {
  const slugs = (Array.isArray(traits) ? traits : [])
    .map(traitSlug)
    .filter(Boolean);
  const numericReach = slugs
    .map((trait) => trait.match(/^reach-(\d+)$/)?.[1])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (numericReach.length) return Math.max(...numericReach);
  if (slugs.includes("reach")) return 10;
  return null;
}

function strikeReach(strike) {
  return reachFromTraits([
    ...(Array.isArray(strike?.traits) ? strike.traits : []),
    ...(Array.isArray(strike?.weaponTraits) ? strike.weaponTraits : []),
    ...readTraitSlugs(strike?.item),
  ]);
}

function itemReach(item) {
  return reachFromTraits(readTraitSlugs(item));
}

function readReach(actor) {
  const explicitReach = actor?.system?.attributes?.reach;
  const candidates = [
    numericValue(explicitReach?.base, null),
    numericValue(explicitReach?.value, null),
    numericValue(explicitReach, null),
    ...collectionValues(actor?.system?.actions)
      .filter((strike) => strike?.type === "strike" || strike?.canAttack)
      .map(strikeReach),
    ...collectionValues(actor?.itemTypes?.melee).map(itemReach),
  ].filter((value) => Number.isFinite(value) && value > 0);

  return candidates.length ? Math.max(...candidates) : 5;
}

function readDefenses(actor) {
  const saves = actor?.system?.saves ?? {};
  return {
    ac: numericValue(actor?.system?.attributes?.ac?.value, null),
    fortitude: numericValue(saves.fortitude?.dc, null),
    reflex: numericValue(saves.reflex?.dc, null),
    will: numericValue(saves.will?.dc, null),
  };
}

function readTraitSlugs(item) {
  const traits = item?.system?.traits;
  const value = traits?.value ?? traits;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function isShieldLike(item) {
  const category = systemValue(item?.system?.category);
  return item?.type === "shield"
    || (item?.type === "armor" && category === "shield")
    || (item?.type === "weapon" && readTraitSlugs(item).includes("shield"));
}

function isEquipped(item) {
  if (item?.isEquipped === true) return true;
  if (item?.isEquipped === false) return false;

  const equipped = item?.system?.equipped;
  if (equipped === true) return true;
  if (equipped === false) return false;
  if (equipped?.value === true) return true;
  if (equipped?.value === false) return false;

  const carryType = systemValue(item?.system?.carryType) ?? systemValue(equipped?.carryType);
  return carryType === "held" || carryType === "worn";
}

function readHasShield(actor) {
  return collectionValues(actor?.items).some((item) => isShieldLike(item) && isEquipped(item));
}

function normalizeSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function conditionSlug(condition) {
  if (typeof condition === "string") return normalizeSlug(condition);
  const raw = condition?.slug
    ?? condition?.system?.slug?.value
    ?? condition?.system?.slug
    ?? condition?.name?.slugify?.()
    ?? condition?.name;
  return normalizeSlug(raw);
}

function readClassItems(actor) {
  const typedClasses = collectionValues(actor?.itemTypes?.class);
  const typedIds = new Set(typedClasses.map((item) => item?.id ?? item?._id).filter(Boolean));
  const fallbackClasses = collectionValues(actor?.items)
    .filter((item) => item?.type === "class")
    .filter((item) => !typedIds.has(item?.id ?? item?._id));
  return [...typedClasses, ...fallbackClasses];
}

function classSlug(item) {
  return conditionSlug(
    item?.system?.slug?.value
      ?? item?.system?.slug
      ?? item?.slug
      ?? item?.name,
  );
}

function readClassSlugs(actor) {
  const itemSlugs = readClassItems(actor).map(classSlug);
  const detailsClass = actor?.system?.details?.class;
  const detailSlugs = [
    detailsClass?.slug,
    detailsClass?.value,
    detailsClass,
  ].map(conditionSlug);

  return [...new Set([...itemSlugs, ...detailSlugs].filter(Boolean))];
}

function conditionValue(condition) {
  return numericValue(
    condition?.system?.value?.value
      ?? condition?.system?.value
      ?? condition?.system?.badge?.value
      ?? condition?.value,
    null,
  );
}

export function readConditions(actor) {
  const conditions = collectionValues(actor?.itemTypes?.condition);
  const entries = conditions
    .map((condition) => [conditionSlug(condition), conditionValue(condition)])
    .filter(([slug]) => Boolean(slug));

  return {
    slugs: entries.map(([slug]) => slug),
    values: Object.fromEntries(entries),
  };
}

function effectSlug(effect) {
  return conditionSlug(effect);
}

function effectSummary(effect) {
  const slug = effectSlug(effect);
  if (!slug) return null;
  return {
    id: effect?.id ?? effect?._id ?? null,
    uuid: effect?.uuid ?? null,
    name: effect?.name ?? effect?.label ?? slug,
    slug,
    sourceId: effect?.sourceId ?? effect?.system?.source?.value ?? effect?.system?.source?.id ?? null,
  };
}

export function readEffects(actor) {
  const typedEffects = collectionValues(actor?.itemTypes?.effect);
  const typedIds = new Set(typedEffects.map((effect) => effect?.id ?? effect?._id).filter(Boolean));
  const fallbackEffects = collectionValues(actor?.items)
    .filter((item) => item?.type === "effect")
    .filter((item) => !typedIds.has(item?.id ?? item?._id));

  return [...typedEffects, ...fallbackEffects]
    .map(effectSummary)
    .filter(Boolean);
}

export function readActorProfile(actor) {
  if (!actor) return null;

  const reach = readReach(actor);
  const classSlugs = readClassSlugs(actor);

  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    actorType: actor.type,
    level: numericValue(actor.level ?? actor.system?.details?.level?.value, 0),
    classSlug: classSlugs[0] ?? null,
    classSlugs,
    skills: readSkills(actor),
    abilities: readAbilities(actor),
    conditions: readConditions(actor),
    effects: readEffects(actor),
    combatState: readCombatState(actor),
    hp: readHp(actor),
    speed: readSpeed(actor),
    reach,
    meleeReach: reach,
    defenses: readDefenses(actor),
    hasShield: readHasShield(actor),
    handsFree: numericValue(actor.system?.attributes?.handsFree, null),
  };
}
