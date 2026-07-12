import { readCombatState } from "../rules/combat-state.js";
import { KNOWN_SUBCLASS_SLUGS, SUBCLASS_TAGS } from "../rules/class-tactics-data/index.js";
import { actorItems, collectionValues, systemValue, traitSlugs } from "../foundry-data.js";

const ABILITY_SLUGS = ["str", "dex", "con", "int", "wis", "cha"];

function numericValue(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rankValue(value, fallback = 0) {
  if (value === null) return null;
  return numericValue(value, fallback);
}

function readSkillStat(skill, { fallbackRank = 0 } = {}) {
  return {
    rank: rankValue(skill?.rank, fallbackRank),
    mod: numericValue(skill?.mod ?? skill?.totalModifier ?? skill?.value, 0),
  };
}

function readSkills(actor) {
  const skills = Object.fromEntries(
    Object.entries(actor?.system?.skills ?? {}).map(([slug, skill]) => [
      slug,
      readSkillStat(skill),
    ]),
  );

  for (const [slug, skill] of Object.entries(actor?.skills ?? {})) {
    skills[slug] = readSkillStat(skill, { fallbackRank: skills[slug]?.rank ?? 0 });
  }

  const perception = actor?.perception ?? actor?.system?.perception;
  if (perception) {
    skills.perception = readSkillStat(perception, { fallbackRank: skills.perception?.rank ?? 0 });
  }
  return skills;
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

export function readActorSpeed(actor) {
  // Prepared PF2e actors expose land Speed under movement.speeds.land or system.movement.speeds.land;
  // the older/compendium shape uses system.attributes.speed.
  const realActor = actor?.document ?? actor;
  const land = realActor?.movement?.speeds?.land ?? realActor?.system?.movement?.speeds?.land;
  const fromMovement = numericValue(land?.value ?? land?.total ?? land?.base, null);
  if (fromMovement !== null) return fromMovement;

  const speed = realActor?.system?.attributes?.speed;
  return numericValue(
    speed?.value
      ?? speed?.total
      ?? speed,
    25,
  );
}

// PF2e creature speed keys (movement.speeds / system.movement.speeds) -> the Foundry movement-action a Stride uses
// when travelling on that speed. "land" is the default walking Stride.
const MOVEMENT_SPEED_ACTIONS = { land: "walk", fly: "fly", burrow: "burrow", swim: "swim", climb: "climb" };

function movementActionAvailable(action) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions;
  return !actions || Object.prototype.hasOwnProperty.call(actions, action);
}

// The movement types this actor can Stride with, in display order (walking first, then any extra
// speeds the actor actually has: fly, burrow, swim, climb). Each entry is { action, speed } where
// `action` is the Foundry movement-action slug and `speed` is that movement's value in feet. Used
// to offer a per-Stride movement-type picker and to size reachable range by the chosen speed.
export function actorMovementOptions(actor) {
  const realActor = actor?.document ?? actor;
  const speeds = {
    ...(realActor?.system?.movement?.speeds ?? {}),
    ...(realActor?.movement?.speeds ?? {}),
  };
  const seen = new Set();
  const options = [];
  const add = (action, speed) => {
    if (!action || seen.has(action) || !movementActionAvailable(action)) return;
    seen.add(action);
    options.push({ action, speed: numericValue(speed, 0) ?? 0 });
  };

  if (speeds && typeof speeds === "object") {
    for (const [type, data] of Object.entries(speeds)) {
      const action = MOVEMENT_SPEED_ACTIONS[type];
      if (!action || !data) continue;
      const value = numericValue(data.total ?? data.value ?? data.base, 0) ?? 0;
      // A non-walking speed only counts when the actor actually has it (value > 0).
      if (action !== "walk" && !(value > 0)) continue;
      add(action, value);
    }
  }

  // Legacy/compendium actors expose extra speeds under system.attributes.speed.otherSpeeds.
  const otherSpeeds = realActor?.system?.attributes?.speed?.otherSpeeds;
  if (Array.isArray(otherSpeeds)) {
    for (const speed of otherSpeeds) {
      const action = MOVEMENT_SPEED_ACTIONS[String(speed?.type ?? "").toLowerCase()];
      const value = numericValue(speed?.total ?? speed?.value, 0) ?? 0;
      if (action && action !== "walk" && value > 0) add(action, value);
    }
  }

  // Walking is always available as the baseline, even on the legacy/compendium data shape.
  if (!seen.has("walk")) add("walk", readActorSpeed(realActor));

  options.sort((left, right) => (left.action === "walk" ? -1 : right.action === "walk" ? 1 : 0));
  return options;
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
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (numericReach.length) return Math.max(...numericReach);
  if (slugs.includes("reach")) return 10;
  return null;
}

function strikeReach(strike) {
  return reachFromTraits([
    ...(Array.isArray(strike?.traits) ? strike.traits : []),
    ...(Array.isArray(strike?.weaponTraits) ? strike.weaponTraits : []),
    ...traitSlugs(strike?.item),
  ]);
}

function itemReach(item) {
  return reachFromTraits(traitSlugs(item));
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
  ].filter((value) => Number.isFinite(value) && value >= 0);

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

function isShieldLike(item) {
  const category = systemValue(item?.system?.category);
  return item?.type === "shield"
    || (item?.type === "armor" && category === "shield")
    || (item?.type === "weapon" && traitSlugs(item).includes("shield"));
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
  const heldShield = actor?.heldShield;
  if (heldShield && heldShield.isBroken !== true && heldShield.isDestroyed !== true) return true;
  return actorItems(actor).some((item) =>
    isShieldLike(item)
      && isEquipped(item)
      && item?.isBroken !== true
      && item?.isDestroyed !== true);
}

function itemHandsHeld(item) {
  const explicit = numericValue(item?.handsHeld ?? item?.system?.equipped?.handsHeld, null);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);

  const carryType = String(systemValue(item?.system?.equipped?.carryType) ?? "").toLowerCase();
  if (item?.isHeld !== true && carryType !== "held") return 0;
  const usageHands = numericValue(systemValue(item?.system?.usage?.hands), 1);
  return Number.isFinite(usageHands) ? Math.max(1, usageHands) : 1;
}

function readHandsFree(actor) {
  const nativeHandsFree = numericValue(
    actor?.handsFree
      ?? actor?.system?.hands?.free?.value
      ?? actor?.system?.attributes?.handsFree,
    null,
  );
  if (Number.isFinite(nativeHandsFree)) return Math.max(0, nativeHandsFree);

  const occupiedHands = actorItems(actor).reduce((total, item) => {
    const traits = traitSlugs(item);
    const category = String(systemValue(item?.system?.category) ?? "").toLowerCase();
    if (category === "unarmed" || traits.includes("unarmed") || traits.includes("free-hand")) return total;
    return total + itemHandsHeld(item);
  }, 0);
  return Math.max(0, 2 - occupiedHands);
}

function isRangedWeapon(item) {
  if (item?.type !== "weapon") return false;
  const range = numericValue(systemValue(item?.system?.range), null);
  return Number.isFinite(range) && range > 0;
}

function readHasRangedWeapon(actor) {
  return collectionValues(actor?.items).some((item) => isRangedWeapon(item) && isEquipped(item));
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

function readFeatureItems(actor) {
  const typedFeatures = [
    ...collectionValues(actor?.itemTypes?.feat),
    ...collectionValues(actor?.itemTypes?.classFeature),
    ...collectionValues(actor?.itemTypes?.classfeature),
  ];
  const typedIds = new Set(typedFeatures.map((item) => item?.id ?? item?._id).filter(Boolean));
  const fallbackFeatures = collectionValues(actor?.items)
    .filter((item) => ["feat", "feature", "classFeature", "classfeature"].includes(item?.type))
    .filter((item) => !typedIds.has(item?.id ?? item?._id));
  return [...typedFeatures, ...fallbackFeatures];
}

function traitOtherTags(item) {
  const tags = item?.system?.traits?.otherTags;
  if (Array.isArray(tags)) return tags.map(normalizeSlug).filter(Boolean);
  if (tags instanceof Set) return Array.from(tags).map(normalizeSlug).filter(Boolean);
  return [];
}

function isClassFeatureItem(item) {
  const category = normalizeSlug(item?.system?.category ?? item?.category);
  return category === "classfeature"
    || category === "class-feature"
    || item?.type === "classFeature"
    || item?.type === "classfeature";
}

function readSubclassEntries(actor) {
  return readFeatureItems(actor)
    .map((item) => {
      const slug = classSlug(item);
      const tags = traitOtherTags(item);
      const subclassTags = tags.filter((tag) => SUBCLASS_TAGS.has(tag));
      const knownSubclass = isClassFeatureItem(item) && KNOWN_SUBCLASS_SLUGS.has(slug);
      if (!subclassTags.length && !knownSubclass) return null;

      return {
        id: item?.id ?? item?._id ?? null,
        uuid: item?.uuid ?? null,
        name: item?.name ?? slug,
        slug,
        tags: subclassTags,
      };
    })
    .filter(Boolean);
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

function visibleEffect(effect) {
  return effect?.hidden !== true
    && effect?.visible !== false
    && effect?.isVisible !== false
    && effect?.system?.hidden !== true
    && effect?.system?.visible !== false;
}

export function readEffects(actor, { includeHidden = true } = {}) {
  const typedEffects = collectionValues(actor?.itemTypes?.effect);
  const typedIds = new Set(typedEffects.map((effect) => effect?.id ?? effect?._id).filter(Boolean));
  const fallbackEffects = collectionValues(actor?.items)
    .filter((item) => item?.type === "effect")
    .filter((item) => !typedIds.has(item?.id ?? item?._id));

  return [...typedEffects, ...fallbackEffects]
    .filter((effect) => includeHidden || visibleEffect(effect))
    .map(effectSummary)
    .filter(Boolean);
}

export function readActorProfile(actor) {
  if (!actor) return null;

  const reach = readReach(actor);
  const classSlugs = readClassSlugs(actor);
  const subclassEntries = readSubclassEntries(actor);

  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    actorType: actor.type,
    level: numericValue(actor.level ?? actor.system?.details?.level?.value, 0),
    classSlug: classSlugs[0] ?? null,
    classSlugs,
    subclassSlug: subclassEntries[0]?.slug ?? null,
    subclassSlugs: [...new Set(subclassEntries.map((entry) => entry.slug).filter(Boolean))],
    subclasses: subclassEntries,
    skills: readSkills(actor),
    abilities: readAbilities(actor),
    conditions: readConditions(actor),
    effects: readEffects(actor),
    combatState: readCombatState(actor),
    hp: readHp(actor),
    speed: readActorSpeed(actor),
    reach,
    meleeReach: reach,
    defenses: readDefenses(actor),
    hasShield: readHasShield(actor),
    equippedRangedWeapon: readHasRangedWeapon(actor),
    handsFree: readHandsFree(actor),
  };
}
