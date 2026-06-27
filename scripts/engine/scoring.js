import { hasDemoralizeImmunity } from "../rules/demoralize-immunity.js";
import { classTacticAdjustment } from "../rules/class-tactics.js";
import { battlefieldPressure, threatsAtCenter } from "../rules/battlefield-analysis.js";
import { aggroProfile, aggroTargetValue } from "../rules/aggro.js";
import { readCombatState, targetHasMarkState } from "../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../rules/exploit-vulnerability.js";
import { npcTacticAdjustment } from "../rules/npc-tactics.js";
import { SETTINGS, setting } from "../settings.js";
import { sanitizeScoredRecommendation } from "./recommendation-safety.js";

const KINETICIST_ELEMENT_SLUGS = new Set(["air", "earth", "fire", "metal", "water", "wood"]);
const ELEMENT_DAMAGE_FALLBACKS = {
  air: ["electricity"],
  earth: ["bludgeoning"],
  fire: ["fire"],
  metal: ["piercing", "slashing"],
  water: ["cold"],
  wood: ["vitality"],
};
const QUICKENING_SLUGS = new Set(["haste"]);

function firstTarget(context) {
  return context?.targets?.[0] ?? context?.battlefield?.targets?.[0] ?? null;
}

function allies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function enemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? context?.targets ?? context?.battlefield?.targets ?? [];
}

function actorTarget(context) {
  const actor = context?.actor ?? context?.combatant?.actor ?? null;
  const token = context?.token ?? null;
  if (!actor && !token) return { type: "self", name: "Self" };
  return {
    type: "self",
    id: token?.id ?? actor?.id ?? actor?.document?.id ?? null,
    uuid: token?.uuid ?? actor?.uuid ?? actor?.document?.uuid ?? null,
    name: token?.name ?? actor?.name ?? actor?.document?.name ?? "Self",
  };
}

function targetRef(entity, fallbackType = "target") {
  if (!entity) return null;
  return {
    type: fallbackType,
    id: entity.id ?? entity.actor?.id ?? null,
    uuid: entity.uuid ?? entity.actor?.uuid ?? null,
    name: entity.name ?? entity.actor?.name ?? "Unknown target",
  };
}

function entityKey(entity) {
  return String(entity?.id ?? entity?.uuid ?? entity?.token?.id ?? entity?.token?.uuid ?? entity?.name ?? "");
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return Array.from(collection.values());
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection === "object") return Object.values(collection);
  return [];
}

function slugText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function valueSlugs(value) {
  if (!value) return [];
  if (typeof value === "string") return [slugText(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(valueSlugs);
  if (value instanceof Set) return Array.from(value).flatMap(valueSlugs);
  if (value instanceof Map) return Array.from(value.values()).flatMap(valueSlugs);
  if (typeof value !== "object") return [slugText(value)].filter(Boolean);

  const direct = value.slug ?? value.name ?? value.label ?? value.type;
  if (direct) return [slugText(direct)].filter(Boolean);
  if (Array.isArray(value.value) || typeof value.value === "string") return valueSlugs(value.value);
  if (Array.isArray(value.traits)) return valueSlugs(value.traits);
  return [];
}

function readSetting(key, fallback) {
  try {
    const value = setting(key);
    return value === undefined ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

function contextActorDocument(context) {
  const candidates = [
    context?.actor?.document,
    context?.combatant?.actor,
    context?.actor?.object,
    context?.actor,
  ];
  return candidates.find((candidate) =>
    candidate && typeof candidate === "object" && (candidate.system || candidate.items || candidate.itemTypes),
  ) ?? null;
}

function itemSlug(item) {
  return slugText(item?.slug ?? item?.system?.slug?.value ?? item?.system?.slug ?? item?.name);
}

function actorItems(actor, type = null) {
  const typed = type ? collectionValues(actor?.itemTypes?.[type]) : [];
  const typedIds = new Set(typed.map((item) => item?.id ?? item?._id).filter(Boolean));
  const fallback = collectionValues(actor?.items)
    .filter((item) => !type || item?.type === type)
    .filter((item) => !typedIds.has(item?.id ?? item?._id));
  return [...typed, ...fallback];
}

function elementalBlastItem(actor) {
  return actorItems(actor, "action")
    .find((item) => itemSlug(item) === "elemental-blast")
    ?? null;
}

function kineticistElementProfiles(context, action) {
  const actor = contextActorDocument(context);
  const item = elementalBlastItem(actor);
  const selections = item?.flags?.pf2e?.damageSelections ?? {};
  const flag = actor?.flags?.pf2e?.kineticist?.elementalBlast;
  const profiles = new Map();

  const addProfile = (rawElement, rawTypes = []) => {
    const element = slugText(rawElement);
    if (!KINETICIST_ELEMENT_SLUGS.has(element)) return;

    const selected = selections?.[rawElement] ?? selections?.[element];
    const damageTypeValues = [
      selected,
      ...(Array.isArray(rawTypes) ? rawTypes : [rawTypes]),
      ...(ELEMENT_DAMAGE_FALLBACKS[element] ?? []),
    ];
    const damageTypesForElement = [...new Set(damageTypeValues.map(slugText).filter(Boolean))];
    const existing = profiles.get(element) ?? { element, damageTypes: [] };
    profiles.set(element, {
      element,
      damageTypes: [...new Set([...existing.damageTypes, ...damageTypesForElement])],
    });
  };

  if (flag && typeof flag === "object") {
    for (const entry of Object.values(flag)) {
      if (!entry || typeof entry !== "object" || !entry.element) continue;
      addProfile(entry.element, [
        entry.damageType,
        ...(Array.isArray(entry.damageTypes) ? entry.damageTypes : []),
      ]);
    }
  }

  if (action?.elementalBlastConfig?.element) {
    addProfile(action.elementalBlastConfig.element, [
      action.elementalBlastConfig.damageType,
      ...(Array.isArray(action.elementalBlastConfig.damageTypes) ? action.elementalBlastConfig.damageTypes : []),
      ...damageTypes(action),
    ]);
  }

  for (const trait of actionTraitSlugs(action)) {
    if (KINETICIST_ELEMENT_SLUGS.has(trait)) addProfile(trait, damageTypes(action));
  }

  return Array.from(profiles.values());
}

function targetActorDocument(target) {
  const actor = target?.actor?.document ?? target?.actor?.object ?? target?.actor;
  return actor && typeof actor === "object" ? actor : null;
}

function systemTraitSlugs(document) {
  return valueSlugs(document?.system?.traits?.value ?? document?.system?.traits);
}

function targetTraitSlugs(context, target) {
  const visible = [
    target?.traits,
    target?.traitSlugs,
    target?.system?.traits?.value,
    target?.system?.traits,
  ].flatMap(valueSlugs);

  const hidden = canUseTargetDefenses(context)
    ? systemTraitSlugs(targetActorDocument(target))
    : [];

  return new Set([...visible, ...hidden].filter(Boolean));
}

function hasSpellcastingCapability(context) {
  const actor = contextActorDocument(context);
  if (!actor) return false;

  if (collectionValues(actor?.itemTypes?.spell).length > 0) return true;
  if (collectionValues(actor?.itemTypes?.spellcastingEntry).length > 0) return true;
  if (collectionValues(actor?.spellcasting?.collections).length > 0) return true;
  if (collectionValues(actor?.spellcasting?.entries).length > 0) return true;
  if (collectionValues(actor?.system?.spellcasting?.entries).length > 0) return true;

  return collectionValues(actor?.items).some((item) =>
    item?.type === "spell" || item?.type === "spellcastingEntry",
  );
}

function actionTraitSlugs(action) {
  const values = [
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.weaponTraits) ? action.weaponTraits : []),
    ...(Array.isArray(action?.range?.traits) ? action.range.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ];
  return [...new Set(values
    .map((trait) => String(trait?.slug ?? trait?.name ?? trait ?? "").toLowerCase())
    .filter(Boolean))];
}

function isRangedStrike(action) {
  const traits = actionTraitSlugs(action);
  if (traits.some((trait) => trait === "ranged" || trait.startsWith("volley") || trait.startsWith("thrown-"))) {
    return true;
  }

  const increment = Number(action?.range?.increment ?? action?.item?.system?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return true;

  const max = Number(action?.range?.max ?? action?.targetingProfile?.maxRange);
  const reachTrait = traits.some((trait) => trait === "reach" || trait.startsWith("reach-"));
  return Number.isFinite(max) && max > 15 && !reachTrait;
}

function isMeleeStrikeFallback(action) {
  if (action?.source !== "strike" && action?.activityProfile?.drawsWeapon !== true) return false;
  return !isRangedStrike(action);
}

function maxRange(action) {
  const max = Number(action?.range?.max);
  if (Number.isFinite(max) && max > 0) return max;

  const profileMax = Number(action?.targetingProfile?.maxRange ?? action?.targetingProfile?.range);
  if (Number.isFinite(profileMax) && profileMax > 0) return profileMax;

  const increment = Number(action?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return increment;

  if (action.source === "strike") return 5;
  return Infinity;
}

function inRange(action, target) {
  if (!target) return false;
  return (target.distance ?? Infinity) <= maxRange(action);
}

// Volley N: a -2 attack penalty against targets within N feet (e.g. longbow = volley-30).
function volleyRange(action) {
  for (const trait of actionTraitSlugs(action)) {
    const match = trait.match(/^volley-(\d+)$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

function isSpellAction(action) {
  return String(action?.source ?? "").startsWith("spell");
}

function isOffensiveRole(role) {
  return ["damage", "area-damage", "save-damage", "control", "debuff", "grab"].includes(role);
}

function isAttackLikeAction(action, role) {
  return action?.source === "strike"
    || action?.activityProfile?.includesStrike === true
    || action?.attackTrait === true
    || ["mobility-attack", "multiattack"].includes(role)
    || isOffensiveRole(role);
}

function isAreaAction(action, role) {
  const type = String(action?.targetingProfile?.type ?? "").toLowerCase();
  return role === "area-damage"
    || action?.targetingProfile?.area === true
    || ["burst", "cone", "line", "emanation"].includes(type);
}

function isSelfCenteredAreaAction(action) {
  const type = String(action?.targetingProfile?.type ?? "").toLowerCase();
  return action?.targetingProfile?.selfCentered === true || type === "emanation";
}

function requiresTargetableEnemy(action, role) {
  if (isAreaAction(action, role)) return false;
  return action?.source === "strike"
    || isAttackLikeAction(action, role)
    || action?.targetingProfile?.enemy === true
    || action?.requiresTarget === true
    || action?.requiresEnemyInReach === true
    || action?.requiresNearbyEnemy === true
    || action?.requiresTumbleThroughOpportunity === true
    || Boolean(action?.targetSave)
    || Boolean(action?.targetDefense);
}

function detectionState(entity) {
  return String(entity?.visionerDetectionState ?? entity?.detectionState ?? entity?.visibility ?? "").toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function damageAverage(action) {
  const values = [
    action?.damageProfile?.average,
    action?.activityProfile?.averageDamage,
    action?.averageDamage,
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      const multiplier = action?.activityProfile?.damageScalesWithActions
        ? Math.max(1, Number(action?.actionCost) || 1)
        : 1;
      return number * multiplier;
    }
  }
  return null;
}

function damageTypes(action) {
  const values = [
    ...(Array.isArray(action?.damageProfile?.types) ? action.damageProfile.types : []),
    action?.damageProfile?.type,
    ...(Array.isArray(action?.activityProfile?.damageTypes) ? action.activityProfile.damageTypes : []),
  ];
  return [...new Set(values.filter(Boolean).map((value) => String(value).toLowerCase()))];
}

function defenseEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [];
}

function entryType(entry) {
  return slugText(
    entry?.type?.value
      ?? entry?.type
      ?? entry?.slug?.value
      ?? entry?.slug
      ?? entry?.label
      ?? entry?.name,
  );
}

function entryValue(entry) {
  const number = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  return Number.isFinite(number) ? number : 0;
}

function matchesDamageType(entry, type) {
  const defenseType = entryType(entry);
  if (!defenseType || !type) return false;
  if (defenseType === "all" || defenseType === type) return true;
  if (defenseType === "physical" && ["bludgeoning", "piercing", "slashing"].includes(type)) return true;
  return false;
}

function maxDefenseValue(entries, types) {
  if (!types.length) return 0;
  return Math.max(0, ...defenseEntries(entries)
    .filter((entry) => types.some((type) => matchesDamageType(entry, type)))
    .map(entryValue));
}

function hasImmunity(target, types) {
  if (!types.length) return false;
  return defenseEntries(target?.immunities)
    .some((entry) => types.some((type) => matchesDamageType(entry, type)));
}

function damageAdjustment(context, action, target) {
  if (!canUseTargetDefenses(context) || !target) return null;
  const types = damageTypes(action);
  if (!types.length) return null;

  const average = damageAverage(action);
  const resistance = maxDefenseValue(target.resistances, types);
  const weakness = maxDefenseValue(target.weaknesses, types);
  const immune = hasImmunity(target, types);
  const reasons = [];
  let scoreDelta = 0;

  if (immune) {
    scoreDelta -= 70;
    reasons.push(`${target.name} is immune to ${types.join("/")}.`);
  }
  if (resistance > 0) {
    scoreDelta -= Math.min(35, resistance * 3);
    reasons.push(`${target.name} resists ${types.join("/")} ${resistance}.`);
  }
  if (weakness > 0) {
    scoreDelta += Math.min(45, weakness * 4);
    reasons.push(`${target.name} has ${types.join("/")} weakness ${weakness}.`);
  }
  if (Number.isFinite(average) && average > 0 && resistance > average * 0.75) {
    scoreDelta -= 18;
    reasons.push("Resistance absorbs most expected damage.");
  }

  return scoreDelta || reasons.length ? { scoreDelta, reasons, immune, resistance, weakness } : null;
}

function spellDc(action, profile) {
  return numberOrNull(
    action?.spellDc
      ?? action?.saveProfile?.dc
      ?? profile?.spellDc
      ?? profile?.spellDC
      ?? profile?.spellcasting?.dc
      ?? profile?.attributes?.spellDC,
  );
}

function saveOutcomeChance(dc, saveDc) {
  if (!Number.isFinite(dc) || !Number.isFinite(saveDc)) return null;
  const saveMod = saveDc - 10;
  const outcomes = { criticalFailure: 0, failure: 0, success: 0, criticalSuccess: 0 };

  for (let roll = 1; roll <= 20; roll += 1) {
    const total = roll + saveMod;
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (roll === 20) degree = Math.min(3, degree + 1);
    if (roll === 1) degree = Math.max(0, degree - 1);

    if (degree === 0) outcomes.criticalFailure += 0.05;
    else if (degree === 1) outcomes.failure += 0.05;
    else if (degree === 2) outcomes.success += 0.05;
    else outcomes.criticalSuccess += 0.05;
  }

  return outcomes;
}

function saveExpectedMultiplier(action, target, profile) {
  const stat = action?.saveProfile?.stat;
  const dc = spellDc(action, profile);
  const saveDc = targetDc(target, stat);
  const odds = saveOutcomeChance(dc, saveDc);
  if (!odds) return null;

  if (action?.saveProfile?.basic) {
    return {
      multiplier: odds.criticalFailure * 2 + odds.failure + odds.success * 0.5,
      odds,
      dc,
      saveDc,
    };
  }

  return {
    multiplier: odds.criticalFailure * 1.5 + odds.failure,
    odds,
    dc,
    saveDc,
  };
}

function saveScoreDelta(context, action, target, profile) {
  if (!canUseTargetDefenses(context) || !action?.saveProfile?.stat || !target) return null;
  const saveDc = targetDc(target, action.saveProfile.stat);
  if (!Number.isFinite(saveDc)) return null;

  const expected = saveExpectedMultiplier(action, target, profile);
  if (expected) {
    const average = damageAverage(action);
    const multiplierDelta = Math.round((expected.multiplier - 0.7) * 34);
    const damageDelta = Number.isFinite(average) ? Math.round(Math.min(36, average * expected.multiplier * 0.7)) : 0;
    return {
      scoreDelta: multiplierDelta + damageDelta,
      label: `${titleCase(action.saveProfile.stat)} DC ${saveDc} vs spell DC ${expected.dc}.`,
      multiplier: expected.multiplier,
    };
  }

  return {
    scoreDelta: Math.max(-18, Math.min(18, 22 - saveDc)),
    label: `${titleCase(action.saveProfile.stat)} DC ${saveDc}.`,
  };
}

function targetCenter(entity) {
  const center = entity?.center ?? entity?.token?.center;
  const x = Number(center?.x);
  const y = Number(center?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function centerDistanceFeet(left, right, fallbackGridDistance = 5) {
  if (!left || !right) return Infinity;
  const gridSize = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size ?? 100);
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? fallbackGridDistance);
  if (!Number.isFinite(gridSize) || gridSize <= 0) return Infinity;
  return (Math.hypot(left.x - right.x, left.y - right.y) / gridSize) * (Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : fallbackGridDistance);
}

function pathBlocked(from, to) {
  if (!from || !to) return false;
  const walls = globalThis.canvas?.walls;
  if (typeof walls?.checkCollision !== "function") return false;
  const Ray = globalThis.foundry?.utils?.Ray;
  if (!Ray) return false;
  const ray = new Ray(from, to);
  return ["sight", "move", "movement"].some((type) => {
    try {
      return walls.checkCollision(ray, { type, mode: "any" });
    } catch (_error) {
      return false;
    }
  });
}

function vectorBetween(from, to) {
  if (!from || !to) return null;
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= 0) return null;
  return { x, y, length };
}

function angleBetween(left, right) {
  if (!left || !right) return Infinity;
  const dot = left.x * right.x + left.y * right.y;
  const denominator = left.length * right.length;
  if (!Number.isFinite(dot) || !Number.isFinite(denominator) || denominator <= 0) return Infinity;
  const ratio = Math.max(-1, Math.min(1, dot / denominator));
  return Math.acos(ratio) * (180 / Math.PI);
}

function lineDistanceFeet(origin, direction, point) {
  const target = vectorBetween(origin, point);
  if (!target || !direction) return Infinity;
  const projection = ((target.x * direction.x) + (target.y * direction.y)) / direction.length;
  if (projection < 0 || projection > direction.length) return Infinity;
  const cross = Math.abs(target.x * direction.y - target.y * direction.x) / direction.length;
  const gridSize = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.scene?.grid?.size ?? 100);
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance ?? 5);
  if (!Number.isFinite(gridSize) || gridSize <= 0) return Infinity;
  return (cross / gridSize) * (Number.isFinite(gridDistance) && gridDistance > 0 ? gridDistance : 5);
}

function directionalAreaContains(type, origin, direction, distance, entity) {
  const center = targetCenter(entity);
  const target = vectorBetween(origin, center);
  if (!target || pathBlocked(origin, center)) return false;

  const targetDistance = centerDistanceFeet(origin, center);
  if (targetDistance > distance) return false;

  if (type === "line") {
    return lineDistanceFeet(origin, direction, center) <= 2.5;
  }

  // PF2e cones are roughly 90-degree templates; use half-angle 45 degrees.
  return angleBetween(direction, target) <= 45;
}

function directionalAreaPlacement(type, action, context, origin, enemyValues, allyValues) {
  const distance = areaDistance(action);
  const maxCastRange = maxRange(action);
  const candidates = enemyValues
    .filter((enemy) => (enemy?.distance ?? Infinity) <= Math.min(distance, maxCastRange))
    .filter((enemy) => {
      const center = targetCenter(enemy);
      return center && !pathBlocked(origin, center);
    });

  if (!candidates.length) {
    return {
      enemies: [],
      allies: [],
      centerTarget: null,
    };
  }

  return candidates
    .map((centerTarget) => {
      const direction = vectorBetween(origin, targetCenter(centerTarget));
      const hitEnemies = enemyValues.filter((enemy) => directionalAreaContains(type, origin, direction, distance, enemy));
      const hitAllies = allyValues.filter((ally) => directionalAreaContains(type, origin, direction, distance, ally));
      return {
        centerTarget,
        enemies: hitEnemies,
        allies: hitAllies,
        score: hitEnemies.length * 3 - hitAllies.length * 4,
      };
    })
    .toSorted((left, right) => right.score - left.score)[0];
}

function areaPlacement(action, context) {
  const type = String(action?.targetingProfile?.type ?? "area").toLowerCase();
  const distance = areaDistance(action);
  const enemyValues = attackableEnemies(context);
  const allyValues = allies(context);
  const maxCastRange = maxRange(action);
  const origin = targetCenter(context?.token);

  if (["cone", "line"].includes(type) && origin) {
    return directionalAreaPlacement(type, action, context, origin, enemyValues, allyValues);
  }

  if (!["burst", "emanation"].includes(type)) {
    return origin
      ? { enemies: [], allies: [], centerTarget: null }
      : {
        enemies: entitiesInArea(action, enemyValues),
        allies: entitiesInArea(action, allyValues),
        centerTarget: null,
      };
  }

  if (type === "emanation") {
    return {
      enemies: enemyValues.filter((entity) => (entity?.distance ?? Infinity) <= distance),
      allies: allyValues.filter((entity) => (entity?.distance ?? Infinity) <= distance),
      centerTarget: null,
    };
  }

  if (!origin) {
    return {
      enemies: entitiesInArea(action, enemyValues),
      allies: entitiesInArea(action, allyValues),
      centerTarget: null,
    };
  }

  const candidates = enemyValues
    .filter((enemy) => (enemy?.distance ?? Infinity) <= maxCastRange)
    .filter((enemy) => {
      const center = targetCenter(enemy);
      return !center || !pathBlocked(origin, center);
    });

  if (!candidates.length) {
    return {
      enemies: entitiesInArea(action, enemyValues),
      allies: entitiesInArea(action, allyValues),
      centerTarget: null,
    };
  }

  return candidates
    .map((centerTarget) => {
      const center = targetCenter(centerTarget);
      if (!center) {
        return {
          centerTarget,
          enemies: [centerTarget],
          allies: [],
          score: 1,
        };
      }
      const hitEnemies = enemyValues.filter((enemy) => centerDistanceFeet(center, targetCenter(enemy)) <= distance);
      const hitAllies = allyValues.filter((ally) => centerDistanceFeet(center, targetCenter(ally)) <= distance);
      return {
        centerTarget,
        enemies: hitEnemies,
        allies: hitAllies,
        score: hitEnemies.length * 3 - hitAllies.length * 4,
      };
    })
    .toSorted((left, right) => right.score - left.score)[0];
}

function offensiveTargetValue(context, action, role, target) {
  if (!target) return -Infinity;
  if ((action?.targetingProfile?.maxRange || action?.range?.max || action?.range?.increment) && !inRange(action, target)) {
    return -Infinity;
  }

  const pressure = battlefieldPressure(context);
  let value = 0;
  if (pressure.meleeThreatKeys.has(entityKey(target))) value += 14;
  if (role === "grab" || action?.targetingProfile?.reach) {
    if (!inRange(action, target)) value -= 20;
  }
  if (action?.saveProfile?.stat && canUseTargetDefenses(context)) {
    const dc = targetDc(target, action.saveProfile.stat);
    if (Number.isFinite(dc)) value += 30 - dc;
  }

  const appliedConditions = [
    action?.activityProfile?.appliesCondition,
    ...(Array.isArray(action?.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
  ].filter(Boolean);
  if (appliedConditions.some((condition) => hasCondition(target, condition))) value -= 12;

  const adjustment = damageAdjustment(context, action, target);
  if (adjustment) value += adjustment.scoreDelta;
  value += aggroTargetValue(context, action, role, target);
  value += (1 - hpPercent(target)) * 4;
  return value;
}

function canAffectTarget(context, action, target) {
  if (action?.slug === "demoralize" && hasDemoralizeImmunity(target)) return false;
  if (isExtractElementAction(action) && !canExtractElementFromTarget(context, action, target)) return false;
  if (isExploitVulnerabilityAction(action) && hasExploitVulnerabilityMark(target)) return false;
  const mark = action?.activityProfile?.targetMark;
  if (mark && targetHasMarkState(target, mark)) return false;
  return true;
}

function targetPoolForAction(context, action, role, needsTargetableEnemy) {
  const values = needsTargetableEnemy
    ? attackableEnemies(context)
    : enemies(context);
  return values.filter((target) => canAffectTarget(context, action, target));
}

function bestTargetForAction(context, action, role) {
  const needsTargetableEnemy = requiresTargetableEnemy(action, role);
  if (isSelfCenteredAreaAction(action)) return null;

  if (
    action?.preferredTarget
    && (!needsTargetableEnemy || canAttackTarget(action.preferredTarget))
    && canAffectTarget(context, action, action.preferredTarget)
  ) {
    return action.preferredTarget;
  }

  const target = firstTarget(context);
  const enemyValues = targetPoolForAction(context, action, role, needsTargetableEnemy);

  if (action.source === "strike") {
    const reachable = enemyValues.filter((enemy) => inRange(action, enemy));
    if (reachable.length) {
      return reachable.toSorted((left, right) =>
        offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left),
      )[0];
    }
    return canAttackTarget(target) && canAffectTarget(context, action, target) ? target : null;
  }

  if (isOffensiveRole(role)) {
    const reachable = enemyValues.filter((enemy) => {
      const max = maxRange(action);
      return !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max;
    });
    if (reachable.length) {
      return reachable.toSorted((left, right) =>
        offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left),
      )[0];
    }
    return canAttackTarget(target) && canAffectTarget(context, action, target) ? target : (enemyValues[0] ?? null);
  }

  if (needsTargetableEnemy) {
    const reachable = enemyValues.filter((enemy) => {
      const max = maxRange(action);
      return !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max;
    });
    return reachable[0] ?? null;
  }

  return target;
}

function hpPercent(entity) {
  const nested = Number(entity?.hp?.percent);
  if (Number.isFinite(nested)) return nested;

  const flat = Number(entity?.hpPercent);
  if (Number.isFinite(flat)) return flat;

  return 1;
}

function hasCondition(entity, slug) {
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

function hasAnyCondition(entity, slugs) {
  return slugs.some((slug) => hasCondition(entity, slug));
}

function targetMarkLabel(mark) {
  return slugText(mark)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasEffect(entity, slug) {
  const normalized = String(slug ?? "").toLowerCase();
  return collectionValues(entity?.effects).some((effect) => {
    const values = [
      effect?.slug,
      effect?.name,
      effect?.label,
      effect?.sourceId,
    ].map((value) => String(value ?? "").toLowerCase());
    return values.some((value) => value === normalized || value.includes(normalized));
  });
}

function hasEffectSlug(entity, slug) {
  const normalized = slugText(slug);
  return collectionValues(entity?.effects).some((effect) => [
    effect?.slug,
    effect?.name,
    effect?.label,
    effect?.sourceId,
  ].map(slugText).some((value) => value === normalized || value.includes(normalized)));
}

function isChannelElementsAction(action) {
  return [
    action?.slug,
    action?.tacticSlug,
    action?.name,
  ].map(slugText).includes("channel-elements");
}

function kineticAuraActive(context, profile) {
  const states = [
    profile?.combatState,
    context?.combatState,
    context?.actor?.profile?.combatState,
  ];
  if (states.some((state) => state?.kineticistAuraActive === true || state?.channelElementsActive === true)) {
    return true;
  }

  const actorState = readCombatState(contextActorDocument(context));
  if (actorState.kineticistAuraActive === true || actorState.channelElementsActive === true) return true;

  return hasCondition(profile, "kinetic-aura")
    || hasCondition(profile, "channel-elements")
    || hasEffectSlug(profile, "kinetic-aura")
    || hasEffectSlug(profile, "channel-elements");
}

function activeBuffKeys(action) {
  const profile = action?.activityProfile ?? {};
  return [
    action?.slug,
    action?.name,
    profile.appliesCondition,
    ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : []),
    ...(profile.invisible ? ["invisible"] : []),
    ...(profile.hidden ? ["hidden", "undetected"] : []),
    ...(profile.concealed ? ["concealed"] : []),
  ].map(slugText).filter(Boolean);
}

function actionGrantsQuickened(action) {
  const profile = action?.activityProfile ?? {};
  if (profile.extraAction === true) return true;
  const slugs = activeBuffKeys(action);
  if (slugs.some((slug) => QUICKENING_SLUGS.has(slug) || slug === "quickened")) return true;
  return [
    profile.appliesCondition,
    ...(Array.isArray(profile.appliesConditions) ? profile.appliesConditions : []),
    ...(Array.isArray(action?.appliesConditions) ? action.appliesConditions : []),
  ].map(slugText).includes("quickened");
}

function targetAlreadyHasBuff(entity, action) {
  return activeBuffKeys(action).some((slug) => hasCondition(entity, slug) || hasEffect(entity, slug));
}

function selfEntity(context) {
  const ref = actorTarget(context);
  return {
    ...(context?.profile ?? {}),
    id: ref.id,
    uuid: ref.uuid,
    name: ref.name,
  };
}

function entityClassSlugs(entity) {
  return new Set([
    ...valueSlugs(entity?.classSlugs),
    ...valueSlugs(entity?.classes),
    ...valueSlugs(entity?.classSlug),
    ...valueSlugs(entity?.class),
    ...valueSlugs(entity?.traits),
  ]);
}

const MARTIAL_CLASS_SLUGS = new Set([
  "barbarian",
  "champion",
  "commander",
  "exemplar",
  "fighter",
  "guardian",
  "gunslinger",
  "inventor",
  "investigator",
  "kineticist",
  "magus",
  "monk",
  "ranger",
  "rogue",
  "swashbuckler",
  "thaumaturge",
]);

const SPELLCASTER_CLASS_SLUGS = new Set([
  "animist",
  "bard",
  "cleric",
  "druid",
  "oracle",
  "psychic",
  "sorcerer",
  "summoner",
  "witch",
  "wizard",
]);

function isMartialRecipient(entity) {
  const slugs = entityClassSlugs(entity);
  return [...slugs].some((slug) => MARTIAL_CLASS_SLUGS.has(slug))
    || entity?.hasStrike === true
    || Number(entity?.attackModifier) > 0;
}

function isSpellcasterRecipient(entity) {
  const slugs = entityClassSlugs(entity);
  return [...slugs].some((slug) => SPELLCASTER_CLASS_SLUGS.has(slug))
    || entity?.hasSpellcasting === true
    || Number(entity?.spellDc ?? entity?.spellDC) > 0;
}

function isPrimarySpellcaster(entity) {
  const slugs = entityClassSlugs(entity);
  const hasCasterClass = [...slugs].some((slug) => SPELLCASTER_CLASS_SLUGS.has(slug));
  const hasMartialClass = [...slugs].some((slug) => MARTIAL_CLASS_SLUGS.has(slug));
  return hasCasterClass && !hasMartialClass;
}

function buffRecipients(context, action) {
  const targeting = action?.targetingProfile ?? {};
  const recipients = [];
  if (targeting.self !== false) recipients.push({ entity: selfEntity(context), type: "self" });
  if (targeting.ally) {
    for (const ally of allies(context)) recipients.push({ entity: ally, type: "ally" });
  }
  return recipients.length ? recipients : [{ entity: selfEntity(context), type: "self" }];
}

function buffRecipientValue(context, action, recipient) {
  const entity = recipient?.entity;
  if (!entity || hpPercent(entity) <= 0) return -Infinity;

  const profile = action?.activityProfile ?? {};
  let value = recipient.type === "self" ? 8 : 12;

  if (targetAlreadyHasBuff(entity, action)) value -= 60;
  if (hpPercent(entity) < 0.5) value += 14;

  if (profile.attackBuff || profile.damageBuff) {
    if (isMartialRecipient(entity)) value += 24;
    else if (isSpellcasterRecipient(entity)) value += 8;
    else value += 12;
  }

  if (profile.extraAction) {
    value += isMartialRecipient(entity) || isSpellcasterRecipient(entity) ? 22 : 14;
  }

  if (profile.acBuff || profile.saveBuff || profile.resistance || profile.tempHp || profile.stealthDefense) {
    value += enemies(context).length ? 14 : 4;
    if (hpPercent(entity) < 0.75) value += 8;
  }

  if (profile.removesCondition) {
    const constrained = hasAnyCondition(entity, ["grabbed", "restrained", "immobilized", "slowed", "stunned", "paralyzed"]);
    value += constrained ? 42 : -16;
  }

  return value;
}

function bestBuffRecipient(context, action) {
  return buffRecipients(context, action)
    .map((recipient) => ({
      ...recipient,
      value: buffRecipientValue(context, action, recipient),
    }))
    .toSorted((left, right) => right.value - left.value)[0] ?? null;
}

function canAttackTarget(entity) {
  if (entity?.attackTargetable === false) return false;
  const state = detectionState(entity);
  if (state === "undetected" || state === "unnoticed") return false;
  return !hasCondition(entity, "undetected") && !hasCondition(entity, "unnoticed");
}

function attackableEnemies(context) {
  return enemies(context).filter(canAttackTarget);
}

function isExtractElementAction(action) {
  return [
    action?.slug,
    action?.tacticSlug,
    action?.name,
  ].map(slugText).includes("extract-element");
}

function targetDefenseValues(context, target, key) {
  const direct = defenseEntries(target?.[key]);
  if (!canUseTargetDefenses(context)) return direct;

  const document = targetActorDocument(target);
  const actorValues = defenseEntries(
    document?.system?.attributes?.[key]
      ?? document?.system?.[key],
  );
  return [...direct, ...actorValues];
}

function targetHasMatchingDefense(context, target, types) {
  if (!canUseTargetDefenses(context) || !types.length) return false;
  return ["resistances", "weaknesses", "immunities"].some((key) =>
    targetDefenseValues(context, target, key)
      .some((entry) => types.some((type) => matchesDamageType(entry, type))),
  );
}

function canExtractElementFromTarget(context, action, target) {
  if (!target) return false;

  const profiles = kineticistElementProfiles(context, action);
  if (!profiles.length) return false;

  const traits = targetTraitSlugs(context, target);
  if (profiles.some((profile) => traits.has(profile.element))) return true;

  const damageTypeSet = new Set(profiles.flatMap((profile) => profile.damageTypes));
  return targetHasMatchingDefense(context, target, Array.from(damageTypeSet));
}

function actionIncludes(action, slug) {
  const includes = Array.isArray(action?.activityProfile?.includes) ? action.activityProfile.includes : [];
  return includes.map((entry) => String(entry ?? "").toLowerCase()).includes(slug);
}

function includesStand(action) {
  return action?.slug === "stand"
    || actionIncludes(action, "stand")
    || action?.activityProfile?.removesCondition === "prone";
}

function dyingAlly(context) {
  return allies(context).find((ally) => hasCondition(ally, "dying"));
}

function bleedingAlly(context) {
  return allies(context).find((ally) => hasCondition(ally, "persistent-bleed"));
}

function enemyInMelee(context) {
  const target = firstTarget(context);
  return Boolean(target && (target.distance ?? Infinity) <= 5);
}

function profileSpeed(profile) {
  const speed = Number(profile?.speed ?? profile?.landSpeed);
  return Number.isFinite(speed) && speed > 0 ? speed : 25;
}

function profileReach(profile) {
  const reach = Number(profile?.reach ?? profile?.meleeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function inProfileReach(profile, target) {
  return Boolean(target && (target.distance ?? Infinity) <= profileReach(profile));
}

function inActionReach(profile, action, target) {
  if (action?.targetingProfile?.maxRange) return inRange(action, target);
  return inProfileReach(profile, target);
}

function profileMoveReach(profile, strideCount = 1) {
  return profileSpeed(profile) * Math.max(1, Number(strideCount) || 1) + profileReach(profile);
}

function activityMoveReach(profile, action, strideCount = 1) {
  const fixedDistance = Number(action?.activityProfile?.fixedDistance ?? action?.activityProfile?.maxDistance);
  if (Number.isFinite(fixedDistance) && fixedDistance > 0) return fixedDistance + profileReach(profile);
  return profileMoveReach(profile, strideCount);
}

function areaDistance(action) {
  const distance = Number(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius);
  return Number.isFinite(distance) && distance > 0 ? distance : 30;
}

function entitiesInArea(action, values) {
  const distance = areaDistance(action);
  return values.filter((entity) => (entity?.distance ?? Infinity) <= distance);
}

function nearbyCorpse(context, profile) {
  const reach = profileReach(profile);
  return [...enemies(context), ...allies(context)].find((entity) =>
    (entity?.distance ?? Infinity) <= reach
      && (hpPercent(entity) <= 0 || hasCondition(entity, "dead") || hasCondition(entity, "destroyed")),
  );
}

function plural(count, singular, pluralValue) {
  return count === 1 ? singular : pluralValue;
}

function baseScore(action) {
  if (action.source === "spell-curated") return 50;
  if (action.source === "custom-curated") return 48;
  if (action.source === "strike") return 46;
  if (action.source === "system-inferred") return 44;
  if (action.source === "spell-inferred") return 44;
  if (action.source === "generic") return 42;
  return 20;
}

function strikeDamageScore(averageDamage) {
  return Math.min(averageDamage * 2, 40);
}

function defaultReason(action) {
  if (action.source === "custom-curated") return "Actor-specific action is recognized.";
  if (action.source === "system-inferred") return "System action pattern is recognized.";
  if (action.source === "spell-curated") return "Curated spell is available.";
  if (action.source === "spell-inferred") return "Spell pattern is recognized.";
  return "Action is available.";
}

function isCurated(action) {
  return action.source === "spell-curated"
    || action.source === "custom-curated"
    || action.source === "system-inferred"
    || action.source === "spell-inferred";
}

function canUseTargetDefenses(context) {
  if (typeof context?.isGM === "boolean") return context.isGM;
  return globalThis.game?.user?.isGM === true;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signed(number) {
  return number >= 0 ? `+${number}` : String(number);
}

function skillEntry(profile, slug) {
  const skill = profile?.skills?.[slug];
  if (skill === undefined || skill === null) return null;
  if (Number.isFinite(Number(skill))) {
    return { mod: Number(skill), rank: null };
  }

  const mod = Number(skill.mod ?? skill.totalModifier ?? skill.value);
  if (!Number.isFinite(mod)) return null;

  const rank = Number(skill.rank ?? skill.proficiency?.rank);
  return {
    mod,
    rank: Number.isFinite(rank) ? rank : null,
  };
}

function isPlayerCharacterProfile(profile) {
  return String(profile?.actorType ?? profile?.type ?? "").toLowerCase() === "character";
}

function isNpcProfile(profile) {
  return String(profile?.actorType ?? profile?.type ?? "").toLowerCase() === "npc";
}

function trainedSkillRequirement(profile, action) {
  if (!readSetting(SETTINGS.hideUntrainedSkillActions, true)) return null;

  const skillSlug = String(action?.skill ?? "").toLowerCase();
  if (!skillSlug) return null;
  const skill = skillEntry(profile, skillSlug);
  const npc = isNpcProfile(profile);

  if (Number(skill?.rank) > 0) {
    return null;
  }

  if (npc && (!skill || skill.rank === null)) {
    return null;
  }

  if (!isPlayerCharacterProfile(profile) && !npc) {
    return null;
  }

  return {
    skill: skillSlug,
    reason: `Requires trained ${titleCase(skillSlug)}.`,
  };
}

function actionSkillDcSlug(action) {
  if (action.targetDefense) return action.targetDefense;
  if (action.targetSave) return action.targetSave;

  switch (action.slug) {
    case "demoralize":
      return "will";
    case "trip":
    case "disarm":
    case "tumble-through":
      return "reflex";
    case "grapple":
    case "reposition":
    case "shove":
      return "fortitude";
    case "feint":
    case "create-a-diversion":
      return "perception";
    default:
      return null;
  }
}

function numericDc(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function targetDc(target, dcSlug) {
  if (!target || !dcSlug) return null;
  if (dcSlug === "perception") {
    return numericDc(
      target.perception?.dc,
      target.perceptionDC,
      target.defenses?.perception,
      target.perception,
    );
  }

  return numericDc(
    target.saves?.[dcSlug]?.dc,
    target.saves?.[dcSlug],
    target.defenses?.[dcSlug],
    target[`${dcSlug}DC`],
  );
}

function successChance(mod, dc) {
  const needed = dc - mod;
  if (needed <= 1) return 0.95;
  if (needed > 20) return 0.05;
  return Math.max(0.05, Math.min(0.95, (21 - needed) / 20));
}

function skillCheckScore(profile, target, action) {
  if (!action.skill) return null;

  const skill = skillEntry(profile, action.skill);
  const dcSlug = actionSkillDcSlug(action);
  const dc = targetDc(target, dcSlug);
  if (!skill || !Number.isFinite(dc)) return null;

  const chance = successChance(skill.mod, dc);
  let scoreDelta = Math.round((chance - 0.5) * 40);
  const reasons = [`${titleCase(action.skill)} ${signed(skill.mod)} vs ${titleCase(dcSlug)} DC ${dc}.`];

  if (skill.rank === 0) {
    scoreDelta -= 6;
    reasons.push(`Untrained in ${titleCase(action.skill)}; reliability reduced.`);
  }

  if (chance < 0.35) {
    scoreDelta -= 4;
    reasons.push(`${titleCase(action.skill)} success odds are poor.`);
  }

  return {
    skill: action.skill,
    skillLabel: titleCase(action.skill),
    mod: skill.mod,
    rank: skill.rank,
    dcSlug,
    dcLabel: titleCase(dcSlug),
    dc,
    chance,
    scoreDelta,
    label: `${titleCase(action.skill)} ${signed(skill.mod)} vs ${titleCase(dcSlug)} DC ${dc}`,
    reasons,
  };
}

const ATHLETICS_MANEUVER_SLUGS = new Set(["grapple", "trip", "disarm", "shove", "reposition"]);

function ownSkillReliabilityScore(profile, action, context) {
  if (!ATHLETICS_MANEUVER_SLUGS.has(action?.slug) || action?.skill !== "athletics") return null;

  const skill = skillEntry(profile, "athletics");
  const spellcasterFallback = hasSpellcastingCapability(context) && (!isMartialRecipient(profile) || isPrimarySpellcaster(profile));
  const reasons = [];
  let scoreDelta = 0;

  if (!skill) {
    scoreDelta -= spellcasterFallback ? 70 : 20;
    reasons.push("No Athletics data; melee maneuvers are unreliable.");
  } else if (skill.rank === 0) {
    scoreDelta -= spellcasterFallback ? 110 : (profile?.actorType === "character" ? 80 : 42);
    reasons.push("Untrained Athletics makes melee maneuvers poor combat filler.");
  } else if (Number.isFinite(skill.mod) && skill.mod < 5) {
    scoreDelta -= spellcasterFallback ? 36 : 12;
    reasons.push("Low Athletics makes melee maneuvers unreliable.");
  }

  if (spellcasterFallback) {
    scoreDelta -= 12;
    reasons.push("Wizard-like spellcaster should prefer spells over Athletics maneuvers.");
  }

  return scoreDelta ? { scoreDelta, reasons } : null;
}

function suggestedTargetFor(context, action, role, preferredTarget = firstTarget(context)) {
  const target = preferredTarget;
  const needsTargetableEnemy = requiresTargetableEnemy(action, role);

  if (isSelfCenteredAreaAction(action)) return null;

  if (action.source === "strike") {
    return target ? targetRef(target, "enemy") : null;
  }

  if (["step", "stride"].includes(action.slug)) {
    return target ? targetRef(target, "enemy") : null;
  }

  if (
    role === "defense"
    || ["raise-a-shield", "take-cover", "hide", "sneak"].includes(action.slug)
  ) {
    return actorTarget(context);
  }

  if (role === "healing") {
    const dying = dyingAlly(context);
    if (dying) return targetRef(dying, "ally");
    const bleeding = bleedingAlly(context);
    if (bleeding) return targetRef(bleeding, "ally");
    const injuredAlly = allies(context).find((ally) => hpPercent(ally) < 0.5);
    if (injuredAlly) return targetRef(injuredAlly, "ally");
    return actorTarget(context);
  }

  if (["buff", "stealth-defense", "setup", "summon", "utility", "combat-utility", "exploration-utility", "sustain-control", "transformation", "mobility", "recovery"].includes(role)) {
    const targeting = action.targetingProfile ?? {};
    if (role === "buff" || role === "stealth-defense") {
      const recipient = bestBuffRecipient(context, action);
      if (recipient) return recipient.type === "self"
        ? actorTarget(context)
        : targetRef(recipient.entity, recipient.type);
    }
    // Enemy-targeted setups (Taunt, Feint, Hunt Prey, off-guard setups) point at
    // the enemy; ally/self effects point at an ally or the actor.
    if (targeting.enemy) {
      if (target) return targetRef(target, "enemy");
      const enemy = needsTargetableEnemy ? attackableEnemies(context)[0] : enemies(context)[0];
      if (enemy) return targetRef(enemy, "enemy");
    }
    if (targeting.ally && !targeting.self) {
      const ally = allies(context)[0];
      if (ally) return targetRef(ally, "ally");
    }
    return actorTarget(context);
  }

  if (target && inRange(action, target)) return targetRef(target, "enemy");
  return actorTarget(context);
}

function attackCenter(action) {
  const center = action?.activityProfile?.attackCenter;
  const x = Number(center?.x);
  const y = Number(center?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function spellTacticalAdjustment(action, role, context) {
  if (!isSpellAction(action)) return { scoreDelta: 0, reasons: [] };

  const profile = action?.activityProfile ?? {};
  const reasons = [];
  let scoreDelta = 0;

  if (action.isCantrip || profile.cantrip) {
    scoreDelta += ["damage", "save-damage", "control"].includes(role) ? 10 : 4;
    reasons.push("Cantrip conserves spell slots.");
  } else if (action.isFocusSpell || profile.focus) {
    scoreDelta += 10;
    reasons.push("Focus spell is recoverable after combat.");
  } else if (Number(action.rank ?? profile.rank) > 0) {
    const lowImpact = ["utility", "exploration-utility", "combat-utility"].includes(role)
      || (role === "area-damage" && (context?.battlefield?.enemies?.length ?? 0) <= 1);
    scoreDelta -= lowImpact ? 14 : 5;
    reasons.push("Uses a ranked spell slot.");
  }

  if (profile.sustained) {
    if (["control", "sustain-control", "buff", "summon"].includes(role)) {
      scoreDelta += 12;
      reasons.push("Sustained spell can keep affecting the fight.");
    } else {
      scoreDelta -= 4;
      reasons.push("Sustaining may cost later actions.");
    }
  } else if (profile.lastingDuration && ["control", "sustain-control", "buff", "stealth-defense", "defense", "summon"].includes(role)) {
    scoreDelta += 8;
    reasons.push("Duration can persist beyond this turn.");
  }

  if (profile.terrainControl || profile.wall || profile.areaDenial) {
    const enemyCount = enemies(context).length;
    scoreDelta += 14 + Math.min(12, enemyCount * 3);
    reasons.push("Battlefield control can restrict enemy movement.");
  }
  if (profile.obscuring) {
    scoreDelta += 8;
    reasons.push("Obscuring effect can break enemy lines of sight.");
  }
  if (profile.forcedMovement) {
    scoreDelta += 8;
    reasons.push("Forced movement can improve positioning.");
  }

  return { scoreDelta, reasons };
}

export function scoreCandidate(context, action) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const role = action.curated?.role ?? action.role;
  const requiredTraining = trainedSkillRequirement(profile, action);
  if (requiredTraining) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: requiredTraining.reason,
      reasons: [requiredTraining.reason],
    };
  }

  const target = bestTargetForAction(context, action, role);
  const suggestedTarget = suggestedTargetFor(context, action, role, target);
  const reasons = [...(action.reasons ?? [])];
  const skillCheck = canUseTargetDefenses(context) ? skillCheckScore(profile, target, action) : null;
  const ownSkillReliability = ownSkillReliabilityScore(profile, action, context);
  const targetDamageAdjustment = damageAdjustment(context, action, target);
  const targetSaveScore = saveScoreDelta(context, action, target, profile);
  const pressure = battlefieldPressure(context);
  const spellAdjustment = spellTacticalAdjustment(action, role, context);
  let areaHitCount = null;
  let score = baseScore(action);

  if (action.slug === "demoralize" && !target && attackableEnemies(context).some(hasDemoralizeImmunity)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "Target is temporarily immune to Demoralize.",
      reasons: ["Target is temporarily immune to Demoralize."],
    };
  }

  if (isExtractElementAction(action) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No valid elemental target.",
      reasons: ["No valid elemental target."],
    };
  }

  if (isExploitVulnerabilityAction(action) && !target && attackableEnemies(context).some(hasExploitVulnerabilityMark)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "Target is already exploited.",
      reasons: ["Target is already exploited."],
    };
  }

  const targetMark = action.activityProfile?.targetMark;
  if (targetMark && !target && attackableEnemies(context).some((enemy) => targetHasMarkState(enemy, targetMark))) {
    const label = targetMarkLabel(targetMark);
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: `Target already has ${label}.`,
      reasons: [`Target already has ${label}.`],
    };
  }

  if (Number(action.interactDrawCost) > 0) {
    reasons.push("Includes Interact to draw or retrieve the consumable.");
  }

  if (isChannelElementsAction(action) && kineticAuraActive(context, profile)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "Kinetic aura already active; Channel Elements is redundant.",
      reasons: ["Kinetic aura already active; Channel Elements is redundant."],
    };
  }

  if (action.source === "strike" && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No valid enemy target.",
      reasons: ["No valid enemy target."],
    };
  }

  if (isAttackLikeAction(action, role) && !isAreaAction(action, role) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No attackable enemy target.",
      reasons: ["No attackable enemy target."],
    };
  }

  if (requiresTargetableEnemy(action, role) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No targetable enemy target.",
      reasons: ["No targetable enemy target."],
    };
  }

  if (role === "area-damage" && !attackableEnemies(context).length) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No attackable enemy target.",
      reasons: ["No attackable enemy target."],
    };
  }

  if (["step", "stride"].includes(action.slug) && action.source === "generic" && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "No valid enemy target.",
      reasons: ["No valid enemy target."],
    };
  }

  if (action.source === "strike" && target && !inRange(action, target)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "Target is out of range.",
      reasons: ["Target is out of range."],
    };
  }

  if (action.source === "strike" && inRange(action, target)) {
    score += 24;
    reasons.push(maxRange(action) > 10 ? "Target is in range." : "Melee target is in reach.");

    // Prefer harder-hitting strikes strongly enough that a real weapon can beat
    // an agile unarmed fallback even after one prior attack.
    const average = Number(action.averageDamage);
    if (Number.isFinite(average) && average > 0) {
      score += strikeDamageScore(average);
      reasons.push(`Average damage about ${Math.round(average)}.`);
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
      reasons.push(`Volley weapon takes a -2 penalty within ${volley} ft.`);
    }
  }

  if (["step", "stride", "stand-stride"].includes(action.slug) && action.source === "generic" && target) {
    const distance = Number(target.distance ?? Infinity);
    const reach = profileReach(profile);
    if (distance <= reach) {
      // A reposition that closes no distance has no tactical value, so it must score below the
      // unused-action penalty — otherwise the planner pads a spare action with a pointless
      // "Stride to the same square". A -26 nudge off the +42 generic base still left it at +16
      // and kept getting padded; force it negative. (Still selectable manually in the browser.)
      score = -10;
      reasons.push("Target already in reach; repositioning is low priority.");
    } else {
      score += action.slug === "step" ? 4 : 8;
      reasons.push("Closes distance toward the target.");
    }
  }

  if (includesStand(action)) {
    if (!hasCondition(profile, "prone")) {
      score = -999;
      reasons.push("Actor is not prone.");
    } else {
      score += 18;
      reasons.push("Removes prone and restores normal movement.");

      if (enemyInMelee(context)) {
        score += 22;
        reasons.push("Standing removes melee attack penalty and off-guard risk.");
      }

      const needsMovement = attackableEnemies(context).some((enemy) => {
        const distance = Number(enemy?.distance);
        return Number.isFinite(distance) && distance > profileReach(profile);
      });
      if (needsMovement) {
        score += 14;
        reasons.push("Standing unlocks Stride and Step options.");
      }
    }
  }

  if (action.slug === "retch") {
    if (!hasCondition(profile, "sickened")) {
      score = -999;
      reasons.push("Actor is not sickened.");
    } else {
      score += 30;
      reasons.push("Retch can reduce sickened.");
      if (enemyInMelee(context)) {
        score += 6;
        reasons.push("Reducing sickened helps under melee pressure.");
      }
    }
  }

  if (action.activityProfile?.targetMark && target) {
    const mark = action.activityProfile.targetMark;
    if (targetHasMarkState(target, mark) || hasCondition(target, mark) || hasEffect(target, mark)) {
      score -= 200;
      reasons.push(`${target.name} already has ${mark}.`);
    }
  }

  if (action.slug === "demoralize" && target && !hasCondition(target, "frightened")) {
    score += 22;
    reasons.push("Target is not frightened.");
  }

  if (action.slug === "trip" && target && !hasCondition(target, "prone")) {
    score += 18;
    reasons.push("Target is standing and can be knocked prone.");
  }

  if (action.slug === "grapple" && target && !hasCondition(target, "grabbed")) {
    score += 16;
    reasons.push("Target is not grabbed.");
  }

  if (action.slug === "disarm" && target) {
    score += 10;
    reasons.push("Can pressure enemy weapon or held item.");
  }

  if (action.slug === "reposition" && target) {
    score += 12;
    reasons.push("Can move target into a better square.");
  }

  if (action.slug === "shove" && target) {
    score += 12;
    reasons.push("Can push target out of position.");
  }

  if (action.slug === "feint" && enemyInMelee(context) && !hasCondition(target, "off-guard")) {
    score += 18;
    reasons.push("Target is in melee and not off-guard.");
  }

  if (action.slug === "create-a-diversion" && target && !hasCondition(profile, "hidden")) {
    score += 12;
    reasons.push("Can create a hidden opening.");
  }

  if (action.slug === "tumble-through" && target && !hasCondition(target, "off-guard")) {
    score += 14;
    reasons.push("Can move through enemy and set up off-guard pressure.");
  }

  if (["balance", "climb", "swim"].includes(action.slug)) {
    score += 6;
    reasons.push("Terrain makes this movement action relevant.");
  }

  if (action.slug === "force-open") {
    score += 8;
    reasons.push("Obstacle or object can be forced open.");
  }

  if (action.slug === "seek") {
    score += 8;
    reasons.push("Useful when hidden enemies or hazards may matter.");
  }

  if (action.slug === "sense-motive" && target) {
    score += 6;
    reasons.push("Useful when enemy intent is unclear.");
  }

  if (action.slug === "recall-knowledge" && target) {
    score += 16;
    reasons.push(`Identify ${target.name} defenses and weaknesses.`);
  }

  if (action.slug === "raise-a-shield" && profile.hasShield) {
    score += hpPercent(profile) < 0.5 ? 24 : 12;
    reasons.push("Shield equipped.");
    if (pressure.inMeleeThreat || pressure.hasOpenEnemyLine) {
      score += 12;
      reasons.push("Enemies have a clear attack line.");
    }
  }

  if (action.slug === "take-cover") {
    score += hpPercent(profile) < 0.5 ? 18 : 10;
    reasons.push("Cover is available.");
    if (pressure.hasOpenEnemyLine) {
      score += 18;
      reasons.push("Open enemy line makes cover valuable.");
    }
  }

  if (action.slug === "escape") {
    score += 30;
    reasons.push("Actor is grabbed or restrained.");
  }

  if (action.slug === "hide") {
    score += 12;
    reasons.push("Cover or concealment supports hiding.");
  }

  if (action.slug === "sneak") {
    score += 10;
    reasons.push("Can reposition while hidden or covered.");
  }

  if (action.slug === "steal" && target) {
    score -= 4;
    reasons.push("Combat theft is situational.");
  }

  if (action.slug === "palm-an-object") {
    score -= 2;
    reasons.push("Nearby object can be palmed, but combat value is situational.");
  }

  if (action.slug === "command-an-animal") {
    score += 18;
    reasons.push("Companion or minion can contribute this turn.");
  }

  if (action.slug === "administer-first-aid") {
    const ally = dyingAlly(context) ?? bleedingAlly(context);
    if (ally) {
      score += 36;
      reasons.push(`${ally.name} needs immediate aid.`);
    }
  }

  if (action.slug === "stabilize") {
    const ally = dyingAlly(context);
    if (ally) {
      score += 40;
      reasons.push(`${ally.name} is dying.`);
    }
  }

  if (isCurated(action) && role === "healing") {
    const injuredAlly = allies(context).find((ally) => hpPercent(ally) < 0.5);
    if (hpPercent(profile) < 0.5) {
      score += 34;
      reasons.push(`${actorTarget(context).name} is badly injured.`);
    } else if (injuredAlly) {
      score += 34;
      reasons.push(`${injuredAlly.name} is badly injured.`);
    } else {
      score -= 10;
      reasons.push("No ally is badly injured.");
    }
  }

  if (isCurated(action) && role === "damage" && target && !action.activityProfile?.drawsWeapon) {
    const average = damageAverage(action);
    score += Number.isFinite(average) ? 18 + Math.min(28, Math.round(average * 1.2)) : 18;
    reasons.push(`${action.name} can damage ${target.name}.`);
    if (targetDamageAdjustment) {
      score += targetDamageAdjustment.scoreDelta;
      reasons.push(...targetDamageAdjustment.reasons);
    }
  }

  if (action.activityProfile?.drawsWeapon && target) {
    const weaponName = action.activityProfile.weaponName ?? action.item?.name ?? action.name;
    if (inActionReach(profile, action, target)) {
      // Drawing a weapon costs an action. It is the strong play only when no
      // enemy is already in melee reach; otherwise an in-hand Strike on the
      // adjacent enemy is the better use of the turn.
      score += enemyInMelee(context) ? 18 : 82;
      reasons.unshift(`Draw ${weaponName} and Strike ${target.name}.`);
    } else {
      score -= 40;
      reasons.unshift(`${weaponName} is still out of range after drawing.`);
    }
  }

  const aggro = target ? aggroProfile(context, target) : null;
  if (aggro?.gmOnly && aggro.roles.length && aggro.score > 0) {
    reasons.push(`Aggro priority: ${aggro.roles.join(", ")}.`);
  }

  if (isCurated(action) && role === "debuff" && target) {
    score += 20;
    reasons.push(`Debuff spell can pressure ${target.name}.`);
  }

  if (isCurated(action) && role === "setup" && target) {
    score += action.activityProfile?.precisionDamageSetup ? 28 : 20;
    reasons.unshift(`${action.name} sets up stronger follow-up attacks.`);
  }

  if (isCurated(action) && role === "mobility") {
    const strideCount = Number(action.activityProfile?.strideCount ?? 1);
    const distance = Number(target?.distance ?? Infinity);
    const moveReach = activityMoveReach(profile, action, strideCount);
    if (action.activityProfile?.retreat && enemyInMelee(context)) {
      score += 24;
      reasons.unshift(`${action.name} can disengage from melee.`);
    } else if (target && distance > profileReach(profile) && distance <= moveReach) {
      score += 18;
      reasons.unshift(`${action.name} can improve position toward ${target.name}.`);
    } else {
      score += 8;
      reasons.unshift(`${action.name} improves position.`);
    }
    if (action.activityProfile?.safeMovement) {
      score += 6;
      reasons.push("Movement reduces reaction risk.");
    }
  }

  if (isCurated(action) && role === "drain" && target) {
    const required = action.activityProfile?.requiresAnyTargetCondition ?? [];
    if (required.length && !hasAnyCondition(target, required)) {
      score -= 28;
      reasons.unshift(`${action.name} needs a grabbed, restrained, paralyzed, or unconscious target.`);
    } else {
      score += hpPercent(profile) < 0.5 ? 58 : 42;
      reasons.unshift(`${action.name} can drain ${target.name} and recover Hit Points.`);
    }
  }

  if (isCurated(action) && role === "self-healing") {
    const corpse = nearbyCorpse(context, profile);
    if (action.activityProfile?.requiresCorpse && !corpse) {
      score -= 24;
      reasons.unshift(`${action.name} needs an adjacent corpse.`);
    } else {
      score += hpPercent(profile) < 0.5 ? 46 : 20;
      reasons.unshift(corpse ? `${action.name} can use ${corpse.name}.` : `${action.name} can recover Hit Points.`);
    }
  }

  if (isCurated(action) && role === "resource-recovery") {
    score += 8;
    reasons.unshift(`${action.name} can recover an expended combat resource.`);
  }

  if (isCurated(action) && role === "transformation") {
    score += 6;
    reasons.unshift(`${action.name} may alter movement or attack options.`);
  }

  if (isCurated(action) && role === "area-damage") {
    const placement = areaPlacement(action, context);
    const enemiesInArea = placement.enemies;
    const alliesInArea = placement.allies;
    areaHitCount = enemiesInArea.length;
    if (enemiesInArea.length > 0) {
      score += enemiesInArea.length === 1
        ? 14
        : 34 + enemiesInArea.length * 18;
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      reasons.unshift(`${action.name} can hit ${enemiesInArea.length} ${plural(enemiesInArea.length, "enemy", "enemies")}${centerName}.`);
    } else {
      score -= 28;
      reasons.unshift(`No enemy is in ${action.name} area.`);
    }
    if (alliesInArea.length > 0) {
      score -= alliesInArea.length * 18;
      reasons.push(`${alliesInArea.length} ${plural(alliesInArea.length, "ally", "allies")} may be in the area.`);
    } else if (enemiesInArea.length > 1 && placement.centerTarget) {
      score += 8;
      reasons.push("Best area placement avoids allies.");
    }
    if (canUseTargetDefenses(context)) {
      const saveDeltas = enemiesInArea
        .map((enemy) => saveScoreDelta(context, action, enemy, profile))
        .filter(Boolean);
      const damageDeltas = enemiesInArea
        .map((enemy) => damageAdjustment(context, action, enemy))
        .filter(Boolean);
      const tacticalDelta = Math.round(
        saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.5
        + damageDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.5,
      );
      score += tacticalDelta;
      const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
      if (bestSave) reasons.push(`Area targets ${titleCase(action.saveProfile?.stat)} saves (${bestSave.label})`);
      for (const entry of damageDeltas.slice(0, 2)) reasons.push(...entry.reasons);
    }
  }

  if (isCurated(action) && role === "save-damage" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    if (requiredCondition && !hasCondition(target, requiredCondition)) {
      score -= 24;
      reasons.unshift(`${action.name} wants a ${requiredCondition} target.`);
    } else {
      const average = damageAverage(action);
      score += requiredCondition ? 52 : 34;
      if (Number.isFinite(average)) score += Math.min(30, Math.round(average));
      reasons.unshift(`${action.name} can force a ${action.saveProfile?.stat ?? "save"} save.`);
      if (targetSaveScore) {
        score += targetSaveScore.scoreDelta;
        reasons.push(targetSaveScore.label);
      }
      if (targetDamageAdjustment) {
        score += targetDamageAdjustment.scoreDelta;
        reasons.push(...targetDamageAdjustment.reasons);
      }
    }
  }

  if (isCurated(action) && role === "grab" && target) {
    if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
      score -= 14;
      reasons.unshift(`${target.name} is already grabbed.`);
    } else if (inProfileReach(profile, target)) {
      score += 42;
      reasons.unshift(`${action.name} can grab ${target.name}.`);
    } else {
      score -= 24;
      reasons.unshift(`${action.name} target is out of reach.`);
    }
  }

  if (isCurated(action) && role === "control" && isAreaAction(action, role)) {
    const placement = areaPlacement(action, context);
    const enemiesInArea = placement.enemies;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    areaHitCount = enemiesInArea.length;

    if (!enemiesInArea.length) {
      score -= 24;
      reasons.unshift(`No enemy is in ${action.name} area.`);
    } else if (
      appliedConditions.length
      && enemiesInArea.every((enemy) => appliedConditions.some((condition) => hasCondition(enemy, condition)))
    ) {
      score -= 8;
      reasons.unshift(`${action.name} area targets already have ${appliedConditions[0]}.`);
    } else {
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      score += (appliedConditions.length ? 30 : 22) + enemiesInArea.length * 12;
      reasons.unshift(`${action.name} can affect ${enemiesInArea.length} ${plural(enemiesInArea.length, "enemy", "enemies")}${centerName}.`);
      if (canUseTargetDefenses(context)) {
        const saveDeltas = enemiesInArea
          .map((enemy) => saveScoreDelta(context, action, enemy, profile))
          .filter(Boolean);
        const tacticalDelta = Math.round(
          saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.4,
        );
        score += tacticalDelta;
        const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
        if (bestSave) reasons.push(`Area targets ${titleCase(action.saveProfile?.stat)} saves (${bestSave.label})`);
      }
    }
  } else if (isCurated(action) && role === "control" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    const appliedCondition = appliedConditions[0];
    if (requiredCondition && !hasCondition(target, requiredCondition)) {
      score -= 24;
      reasons.unshift(`${action.name} wants a ${requiredCondition} target.`);
    } else if (appliedConditions.some((condition) => hasCondition(target, condition))) {
      score -= 10;
      reasons.unshift(`${target.name} already has ${appliedCondition}.`);
    } else {
      score += appliedCondition ? 42 : 32;
      reasons.unshift(`${action.name} can control ${target.name}.`);
      if (targetSaveScore) {
        score += targetSaveScore.scoreDelta;
        reasons.push(targetSaveScore.label);
      }
    }
  }

  if (isCurated(action) && role === "reaction-attack") {
    score += 26;
    reasons.unshift("Reaction can punish the current trigger.");
  }

  if (isCurated(action) && role === "defense") {
    score += hpPercent(profile) < 0.5 ? 34 : 18;
    reasons.unshift("Defensive reaction is available for the trigger.");
  }

  if (isCurated(action) && role === "buff") {
    const recipient = bestBuffRecipient(context, action);
    const allyTarget = recipient?.type === "ally";
    const grantsQuickened = actionGrantsQuickened(action);
    let buffValue = Math.max(0, Number(recipient?.value) || 0);
    if (action.activityProfile?.attackBuff || action.activityProfile?.damageBuff) {
      const attackerCount = [profile, ...allies(context)].filter((entity) => hpPercent(entity) > 0).length;
      buffValue += Math.min(24, 6 + attackerCount * 4);
    }
    if (grantsQuickened) buffValue += 24;
    if (action.activityProfile?.acBuff || action.activityProfile?.saveBuff || action.activityProfile?.resistance) {
      buffValue += enemies(context).length ? 10 : 4;
    }
    if (action.activityProfile?.removesCondition) {
      const constrained = [profile, ...allies(context)].some((entity) =>
        hasAnyCondition(entity, ["grabbed", "restrained", "immobilized", "slowed", "stunned", "paralyzed"]),
      );
      buffValue += constrained ? 28 : 0;
    }
    if (recipient?.entity && targetAlreadyHasBuff(recipient.entity, action)) {
      buffValue -= 36;
      reasons.push(`${recipient.entity.name ?? "Target"} already has ${action.name}.`);
    }
    score += buffValue;
    reasons.unshift(grantsQuickened
      ? `${action.name} grants quickened.`
      : allyTarget
        ? `${action.name} can boost ${recipient.entity?.name ?? "an ally"}.`
        : `${action.name} grants the actor a beneficial effect.`);
  }

  if (isCurated(action) && role === "stealth-defense") {
    const recipient = bestBuffRecipient(context, action);
    const recipientName = recipient?.type === "ally" ? recipient.entity?.name ?? "an ally" : "the actor";
    score += 22 + Math.max(0, Number(recipient?.value) || 0);
    if (targetAlreadyHasBuff(recipient?.entity, action)) {
      score -= 44;
      reasons.push(`${recipientName} already has ${action.name}.`);
    }
    reasons.unshift(`${action.name} can make ${recipientName} harder to target.`);
  }

  if (isCurated(action) && role === "summon") {
    score += 14;
    reasons.unshift(`${action.name} brings an ally or construct onto the battlefield.`);
  }

  // Last-resort options: recognized but no tactical pattern. Push well below the
  // basics so they only surface when nothing stronger fills the turn.
  if (role === "utility") {
    score -= 30;
    reasons.unshift(`${action.name} is available; no stronger pattern recognized.`);
  }

  if (role === "exploration-utility") {
    score -= enemies(context).length ? 46 : 18;
    reasons.unshift(`${action.name} is mostly exploration utility.`);
  }

  if (role === "combat-utility") {
    score += enemies(context).length ? 4 : -8;
    reasons.unshift(`${action.name} has situational combat utility.`);
  }

  if (role === "sustain-control") {
    score += enemies(context).length ? 18 : 4;
    reasons.unshift(`${action.name} can maintain ongoing control.`);
  }

  if (action.slug === "rage" && !hasCondition(profile, "rage") && !hasCondition(profile, "raging")) {
    score += 46;
    reasons.push("Rage sets up this turn's attack.");
  }

  if (action.slug === "sudden-charge" && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const chargeReach = speed * 2 + reach;

    if (distance > reach && distance <= chargeReach) {
      score += 72;
      reasons.push(`Closes ${distance} ft and attacks in one activity.`);
    } else if (distance <= reach) {
      score -= 18;
      reasons.push("Already in reach; Sudden Charge has less value.");
    } else {
      score -= 24;
      reasons.push("Target is beyond Sudden Charge reach.");
    }
  }

  if (action.activityProfile?.includesStrike && action.activityProfile?.strideCount > 0 && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const moveReach = speed * Number(action.activityProfile.strideCount ?? 1) + reach;
    const center = attackCenter(action);
    const destinationThreatCount = center ? threatsAtCenter(context, center).length : null;

    if (action.activityProfile?.retreatBeforeStrike) {
      score += 66;
      reasons.unshift(`Moves out of melee before attacking ${target.name}.`);
      if (destinationThreatCount !== null && destinationThreatCount < pressure.meleeThreats.length) {
        score += 20;
        reasons.push("Attack square reduces melee exposure.");
      }
    } else if (distance > reach && distance <= moveReach) {
      score += 60;
      reasons.unshift(`Moves into reach and attacks ${target.name}.`);
    } else if (distance <= reach) {
      score += 18;
      reasons.unshift(`${target.name} is already in reach for the attack.`);
    } else {
      score -= 30;
      reasons.unshift("Target is beyond this move-and-attack activity.");
    }

    if (destinationThreatCount !== null && !action.activityProfile?.retreatBeforeStrike) {
      if (destinationThreatCount > Math.max(1, pressure.meleeThreats.length)) {
        score -= 18 + destinationThreatCount * 4;
        reasons.push("Attack square ends in heavy enemy reach.");
      } else if (action.activityProfile?.retreatAfterStrike && action.activityProfile?.defensiveCoverState) {
        score += 18;
        reasons.push("Plan returns to cover after attacking.");
      }
    }
  }

  // GM-NPC preference for the positional move-and-strike tactics. Players still see the
  // composites in the browser, but only the GM auto-plan leads with them (consistent with
  // the existing aggro-only preference). The generators already gate skirmish on
  // fragile/ranged-primary, so reaching here means the tactic is warranted.
  if (action.activityProfile?.positionalTactic && canUseTargetDefenses(context)) {
    if (action.activityProfile.positionalTactic === "flank") {
      score += 30;
      reasons.unshift(`Flanks ${target?.name ?? "the target"} for an off-guard Strike.`);
    } else if (action.activityProfile.positionalTactic === "skirmish") {
      const fragile = hpPercent(profile) < 0.5;
      score += fragile ? 26 : 18;
      reasons.unshift(fragile
        ? "Fragile attacker kites out of melee before striking from range."
        : "Fights better at range; kites out of melee before striking.");
    }
  }

  if (isCurated(action) && action.activityProfile?.strideCount > 0 && action.saveProfile && action.damageProfile) {
    const moveReach = profileMoveReach(profile, action.activityProfile.strideCount);
    const reachableEnemies = attackableEnemies(context).filter((enemy) => (enemy?.distance ?? Infinity) <= moveReach);
    if (reachableEnemies.length > 0) {
      score += 24 + reachableEnemies.length * 12;
      reasons.unshift(`${action.name} can move through ${reachableEnemies.length} ${plural(reachableEnemies.length, "enemy", "enemies")}.`);
    } else {
      score -= 18;
      reasons.unshift(`No enemy is reachable for ${action.name}.`);
    }
  }

  if (action.activityProfile?.focusedStrike && target && !action.activityProfile?.strideCount) {
    if (inActionReach(profile, action, target)) {
      score += 72;
      reasons.unshift(`${action.name} focuses attacks on ${target.name}.`);
    } else {
      score -= 40;
      reasons.unshift(`${action.name} target is out of range.`);
    }
  }

  if (action.activityProfile?.multiStrike) {
    const reachableEnemies = attackableEnemies(context).filter((enemy) => inProfileReach(profile, enemy));
    if (reachableEnemies.length >= 2) {
      score += 76;
      reasons.unshift(`${reachableEnemies.length} enemies are in reach for separate Strikes.`);
    } else if (inProfileReach(profile, target)) {
      score += 36;
      reasons.unshift("Only one enemy is in reach; focused offense is usually better.");
    } else {
      score -= 40;
      reasons.unshift(`No enemy is in reach for ${action.name}.`);
    }
  }

  if (isCurated(action) && (action.curated?.friendlyFireRisk ?? action.friendlyFireRisk)) {
    if (allies(context).some((ally) => (ally?.distance ?? Infinity) <= 20)) score -= 18;
    reasons.push("Area spell has friendly-fire risk.");
  }

  if (hasSpellcastingCapability(context)) {
    if (isSpellAction(action)) {
      score += 18;
      reasons.push("Spellcaster spell option is preferred over melee fallback.");
    } else if (isMeleeStrikeFallback(action)) {
      score -= 18;
      reasons.push("Spellcaster melee Strike is lower priority than spell options.");
    }
  }

  const classAdjustment = classTacticAdjustment(profile, action, {
    context,
    target,
    role,
    traits: actionTraitSlugs(action),
    isSpell: isSpellAction(action),
    isMeleeStrike: isMeleeStrikeFallback(action),
    isRangedStrike: isRangedStrike(action),
    includesStrike: action.activityProfile?.includesStrike === true,
    reloadBeforeStrike: action.activityProfile?.reloadBeforeStrike === true || Number(action.reloadCost) > 0,
    consumable: action.item?.type === "consumable" || action.type === "consumable",
    isImpulse: actionTraitSlugs(action).includes("impulse")
      || action.activityProfile?.impulse === true
      || action.activityProfile?.overflow === true,
  });
  if (classAdjustment.scoreDelta) {
    score += classAdjustment.scoreDelta;
    reasons.push(...classAdjustment.reasons);
  }

  const npcAdjustment = npcTacticAdjustment(context, action, { target, role, areaHitCount });
  if (npcAdjustment.scoreDelta) {
    score += npcAdjustment.scoreDelta;
    reasons.push(...npcAdjustment.reasons);
  }

  if (spellAdjustment.scoreDelta) {
    score += spellAdjustment.scoreDelta;
    reasons.push(...spellAdjustment.reasons);
  }

  // A multi-action offensive action commits several actions to one effect (a
  // 2-action nuke, or a Stride -> Stride -> Strike that closes a gap and attacks).
  // The planner sums per-step scores, so without this it is out-summed by the cheap
  // 1-action fillers it displaces and never surfaces. Credit each extra action it
  // costs at a representative realized action value (~55) so it competes as the
  // whole-turn investment it is.
  const multiActionOffensive = String(action.source).startsWith("spell")
    ? ["damage", "area-damage", "save-damage", "control"].includes(role)
    : ["mobility-attack", "multiattack"].includes(role) && !includesStand(action);
  if (multiActionOffensive && Number(action.actionCost) >= 2 && score > baseScore(action)) {
    const extraActions = Math.min(2, Number(action.actionCost) - 1);
    const extraActionValue = role === "area-damage" && areaHitCount === 1 ? 20 : 55;
    score += extraActions * extraActionValue;
    reasons.push(`Commits ${action.actionCost} actions to one effect.`);
  }

  if (skillCheck) {
    score += skillCheck.scoreDelta;
    reasons.push(...skillCheck.reasons);
  }

  if (ownSkillReliability) {
    score += ownSkillReliability.scoreDelta;
    reasons.push(...ownSkillReliability.reasons);
  }

  return sanitizeScoredRecommendation({
    ...action,
    score,
    skillCheck,
    suggestedTarget,
    reason: reasons[0] ?? defaultReason(action),
    reasons,
  }, {
    isGM: canUseTargetDefenses(context),
    fallbackReason: defaultReason(action),
  });
}
