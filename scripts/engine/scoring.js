import { hasDemoralizeImmunity } from "../rules/demoralize-immunity.js";
import { classTacticAdjustment } from "../rules/class-tactics.js";
import { battlefieldPressure, threatsAtCenter } from "../rules/battlefield-analysis.js";
import { aggroProfile, aggroTargetValue } from "../rules/aggro.js";
import { readCombatState, targetHasMarkState } from "../rules/combat-state.js";
import { hasExploitVulnerabilityMark, isExploitVulnerabilityAction } from "../rules/exploit-vulnerability.js";
import { npcTacticAdjustment } from "../rules/npc-tactics.js";
import { SETTINGS, setting } from "../settings.js";
import { sanitizeScoredRecommendation } from "./recommendation-safety.js";
import { pf2eSave, t } from "../i18n.js";

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
// PF2e core rule: affecting a hidden creature (any attack roll or save-requiring effect) needs a
// DC 11 flat check first, independent of the attack roll or save itself. A flat check against DC
// 11 succeeds on a roll of 11 or higher — exactly half of a d20's outcomes.
const HIDDEN_TARGET_FLAT_CHECK_DISCOUNT = 0.5;

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
  if (!actor && !token) return { type: "self", name: t("ScoreReason.SelfWord", "Self") };
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

  // NOTE: actor.spellcasting.collections/.entries are NOT reliable signals here. PF2e injects a
  // synthetic RitualSpellcasting entry into every actor's spellcasting collections regardless of
  // whether it has any real spells (see ActorSpellcasting#prepareDataFromItems), so `.collections`
  // is non-empty for every creature in the game. Only the actual spell/spellcastingEntry items (or
  // the equivalent structural data) indicate real spellcasting.
  if (collectionValues(actor?.itemTypes?.spell).length > 0) return true;
  if (collectionValues(actor?.itemTypes?.spellcastingEntry).length > 0) return true;
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

// Actions that resolve with an ATTACK ROLL (Strikes, spell attacks, Athletics maneuvers). Prone's
// -2 circumstance penalty applies to attack rolls only — NOT to save-based spells/actions, so this
// deliberately excludes save-damage/area roles even though they're "offensive".
function makesAttackRoll(action) {
  return action?.source === "strike"
    || action?.attackTrait === true
    || action?.activityProfile?.includesStrike === true
    || action?.activityProfile?.spellAttack === true
    || actionTraitSlugs(action).includes("attack");
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
    reasons.push(t("ScoreReason.TargetImmune", "{target} is immune to {types}.", { target: target.name, types: types.join("/") }));
  }
  if (resistance > 0) {
    scoreDelta -= Math.min(35, resistance * 3);
    reasons.push(t("ScoreReason.TargetResists", "{target} resists {types} {amount}.", { target: target.name, types: types.join("/"), amount: resistance }));
  }
  if (weakness > 0) {
    scoreDelta += Math.min(45, weakness * 4);
    reasons.push(t("ScoreReason.TargetWeakness", "{target} has {types} weakness {amount}.", { target: target.name, types: types.join("/"), amount: weakness }));
  }
  if (Number.isFinite(average) && average > 0 && resistance > average * 0.75) {
    scoreDelta -= 18;
    reasons.push(t("ScoreReason.ResistanceAbsorbsMostExpected", "Resistance absorbs most expected damage."));
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

// PF2e degree-of-success distribution for a d20 + rollBonus against dc: beat by 10 = crit success,
// meet = success, miss by 10 = crit failure; a nat 20/1 shifts one degree up/down. Each face is 5%.
function degreeDistribution(rollBonus, dc) {
  if (!Number.isFinite(rollBonus) || !Number.isFinite(dc)) return null;
  const outcomes = { criticalFailure: 0, failure: 0, success: 0, criticalSuccess: 0 };

  for (let roll = 1; roll <= 20; roll += 1) {
    const total = roll + rollBonus;
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

// A save distribution is the target rolling its save (modifier ≈ saveDc − 10) against the spell dc.
function saveOutcomeChance(dc, saveDc) {
  if (!Number.isFinite(dc) || !Number.isFinite(saveDc)) return null;
  return degreeDistribution(saveDc - 10, dc);
}

// Incapacitation: a spell/effect with this trait lets a target of more than twice the spell's rank
// treat its save as one degree better — which usually turns a hard-control spell into a near-whiff.
function incapacitationApplies(action, target) {
  if (!actionTraitSlugs(action).includes("incapacitation")) return false;
  const doc = targetActorDocument(target);
  const level = Number(target?.level ?? doc?.system?.details?.level?.value);
  const rank = Number(action?.castRank ?? action?.rank ?? action?.spellRank);
  if (!Number.isFinite(level) || !Number.isFinite(rank) || rank <= 0) return false;
  return level > rank * 2;
}

// Shift every outcome one degree toward the saver's success (crit-fail→fail, …, success→crit success).
function upgradeSaveDegree(odds) {
  return {
    criticalFailure: 0,
    failure: odds.criticalFailure,
    success: odds.failure,
    criticalSuccess: odds.success + odds.criticalSuccess,
  };
}

function saveExpectedMultiplier(action, target, profile) {
  const stat = action?.saveProfile?.stat;
  const dc = spellDc(action, profile);
  const saveDc = targetDc(target, stat);
  const baseOdds = saveOutcomeChance(dc, saveDc);
  if (!baseOdds) return null;

  const incapacitated = incapacitationApplies(action, target);
  const odds = incapacitated ? upgradeSaveDegree(baseOdds) : baseOdds;

  if (action?.saveProfile?.basic) {
    return {
      multiplier: odds.criticalFailure * 2 + odds.failure + odds.success * 0.5,
      odds,
      dc,
      saveDc,
      incapacitated,
    };
  }

  return {
    multiplier: odds.criticalFailure * 1.5 + odds.failure,
    odds,
    dc,
    saveDc,
    incapacitated,
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
    const label = expected.incapacitated
      ? `${titleCase(action.saveProfile.stat)} DC ${saveDc} vs spell DC ${expected.dc} (incapacitation: target resists a degree better).`
      : `${titleCase(action.saveProfile.stat)} DC ${saveDc} vs spell DC ${expected.dc}.`;
    return {
      scoreDelta: multiplierDelta + damageDelta,
      label,
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
  // Ray moved to foundry.canvas.geometry.Ray in v13; prefer it so we don't hit the deprecated global.
  const Ray = globalThis.foundry?.canvas?.geometry?.Ray ?? globalThis.foundry?.utils?.Ray ?? globalThis.Ray;
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
    return inRange(action, target) && canAttackTarget(target) && canAffectTarget(context, action, target) ? target : null;
  }

  if (needsTargetableEnemy) {
    const reachable = enemyValues.filter((enemy) => {
      const max = maxRange(action);
      return !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max;
    });
    return reachable[0] ?? null;
  }

  if (["step", "stride"].includes(action.slug)) {
    return target ?? enemyValues[0] ?? null;
  }

  return target;
}

function distinctTargetsFor(context, action, role) {
  const count = Number.isFinite(action.activityProfile?.distinctStrikeCount) ? action.activityProfile.distinctStrikeCount : 2;
  const max = maxRange(action);
  const reachable = attackableEnemies(context)
    .filter((enemy) => !Number.isFinite(max) || max === Infinity || (enemy?.distance ?? Infinity) <= max)
    .toSorted((left, right) => offensiveTargetValue(context, action, role, right) - offensiveTargetValue(context, action, role, left));

  if (!reachable.length) return [];

  const picked = [];
  for (let i = 0; i < count; i += 1) picked.push(reachable[i % reachable.length]);
  return picked;
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

function hasRequiredCondition(entity, slug) {
  return hasCondition(entity, slug)
    || (slug === "grabbed" && hasCondition(entity, "restrained"));
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

function activityStrikeReach(profile, action) {
  const reach = Number(action?.activityProfile?.strikeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : profileReach(profile);
}

function activityMoveReach(profile, action, strideCount = 1) {
  const fixedDistance = Number(action?.activityProfile?.fixedDistance ?? action?.activityProfile?.maxDistance);
  if (Number.isFinite(fixedDistance) && fixedDistance > 0) return fixedDistance + activityStrikeReach(profile, action);
  return profileSpeed(profile) * Math.max(1, Number(strideCount) || 1) + activityStrikeReach(profile, action);
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
  // Capped main term keeps a single Strike from dominating cross-role comparisons. The small
  // uncapped tiebreaker then keeps strike-vs-strike ordering monotonic once both cap out, so a
  // harder-hitting weapon still wins — e.g. a 2d12+12 Pincer (avg 25) beats a 2d10+10 beam (avg 21)
  // at the same range instead of tying at the 40 ceiling.
  return Math.min(averageDamage * 2, 40) + averageDamage * 0.25;
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
    reason: t("ScoreReason.RequiresTrained", "Requires trained {skill}.", { skill: titleCase(skillSlug) }),
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

function skillCheckScore(profile, target, action) {
  if (!action.skill) return null;

  const skill = skillEntry(profile, action.skill);
  const dcSlug = actionSkillDcSlug(action);
  const dc = targetDc(target, dcSlug);
  if (!skill || !Number.isFinite(dc)) return null;

  const odds = degreeDistribution(skill.mod, dc);
  if (!odds) return null;
  const chance = odds.success + odds.criticalSuccess;
  // Weight by degree rather than a flat success chance: many skill actions land a bigger effect on a
  // critical success (frightened 2 from Demoralize, longer flat-footed from Feint), and a critical
  // failure carries its own cost — mirrors how saves are scored above.
  const effectiveness = odds.criticalSuccess * 1.5 + odds.success - odds.criticalFailure * 0.5;
  let scoreDelta = Math.round((effectiveness - 0.5) * 40);
  const reasons = [`${titleCase(action.skill)} ${signed(skill.mod)} vs ${titleCase(dcSlug)} DC ${dc}.`];

  if (skill.rank === 0) {
    scoreDelta -= 6;
    reasons.push(t("ScoreReason.UntrainedSkill", "Untrained in {skill}; reliability reduced.", { skill: titleCase(action.skill) }));
  }

  if (chance < 0.35) {
    scoreDelta -= 4;
    reasons.push(t("ScoreReason.SkillOddsPoor", "{skill} success odds are poor.", { skill: titleCase(action.skill) }));
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
    reasons.push(t("ScoreReason.NoAthleticsDataMelee", "No Athletics data; melee maneuvers are unreliable."));
  } else if (skill.rank === 0) {
    scoreDelta -= spellcasterFallback ? 110 : (profile?.actorType === "character" ? 80 : 42);
    reasons.push(t("ScoreReason.UntrainedAthleticsMakesMelee", "Untrained Athletics makes melee maneuvers poor combat filler."));
  } else if (Number.isFinite(skill.mod) && skill.mod < 5) {
    scoreDelta -= spellcasterFallback ? 36 : 12;
    reasons.push(t("ScoreReason.LowAthleticsMakesMelee", "Low Athletics makes melee maneuvers unreliable."));
  }

  if (spellcasterFallback) {
    scoreDelta -= 12;
    reasons.push(t("ScoreReason.WizardLikeSpellcasterShould", "Wizard-like spellcaster should prefer spells over Athletics maneuvers."));
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
    if (targeting.enemy || needsTargetableEnemy) {
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

  const seeksEnemy = needsTargetableEnemy
    || isOffensiveRole(role)
    || isAttackLikeAction(action, role)
    || action?.targetingProfile?.enemy === true;
  if (!seeksEnemy) return actorTarget(context);
  if (target && inRange(action, target)) return targetRef(target, "enemy");
  return null;
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
    reasons.push(t("ScoreReason.CantripConservesSpellSlots", "Cantrip conserves spell slots."));
  } else if (action.isFocusSpell || profile.focus) {
    scoreDelta += 10;
    reasons.push(t("ScoreReason.FocusSpellIsRecoverable", "Focus spell is recoverable after combat."));
  } else if (Number(action.rank ?? profile.rank) > 0) {
    const lowImpact = ["utility", "exploration-utility", "combat-utility"].includes(role)
      || (role === "area-damage" && (context?.battlefield?.enemies?.length ?? 0) <= 1);
    scoreDelta -= lowImpact ? 14 : 5;
    reasons.push(t("ScoreReason.UsesARankedSpell", "Uses a ranked spell slot."));
  }

  if (profile.sustained) {
    if (["control", "sustain-control", "buff", "summon"].includes(role)) {
      scoreDelta += 12;
      reasons.push(t("ScoreReason.SustainedSpellCanKeep", "Sustained spell can keep affecting the fight."));
    } else {
      scoreDelta -= 4;
      reasons.push(t("ScoreReason.SustainingMayCostLater", "Sustaining may cost later actions."));
    }
  } else if (profile.lastingDuration && ["control", "sustain-control", "buff", "stealth-defense", "defense", "summon"].includes(role)) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.DurationCanPersistBeyond", "Duration can persist beyond this turn."));
  }

  if (profile.terrainControl || profile.wall || profile.areaDenial) {
    const enemyCount = enemies(context).length;
    scoreDelta += 14 + Math.min(12, enemyCount * 3);
    reasons.push(t("ScoreReason.BattlefieldControlCanRestrict", "Battlefield control can restrict enemy movement."));
  }
  if (profile.obscuring) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.ObscuringEffectCanBreak", "Obscuring effect can break enemy lines of sight."));
  }
  if (profile.forcedMovement) {
    scoreDelta += 8;
    reasons.push(t("ScoreReason.ForcedMovementCanImprove", "Forced movement can improve positioning."));
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
  const distinctTargets = action.activityProfile?.requiresDistinctTargets
    ? distinctTargetsFor(context, action, role)
    : null;
  const suggestedTarget = suggestedTargetFor(context, action, role, target);
  const reasons = [...(action.reasons ?? [])];
  const skillCheck = canUseTargetDefenses(context) ? skillCheckScore(profile, target, action) : null;
  const ownSkillReliability = ownSkillReliabilityScore(profile, action, context);
  const targetDamageAdjustment = damageAdjustment(context, action, target);
  const targetSaveScore = saveScoreDelta(context, action, target, profile);
  const pressure = battlefieldPressure(context);
  const spellAdjustment = spellTacticalAdjustment(action, role, context);
  let areaHitCount = null;
  let areaPlacementCenter = null;
  let areaPlacementAimPoint = null;
  let score = baseScore(action);

  if (action.slug === "demoralize" && !target && attackableEnemies(context).some(hasDemoralizeImmunity)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.TargetIsTemporarilyImmune", "Target is temporarily immune to Demoralize."),
      reasons: [t("ScoreReason.TargetIsTemporarilyImmune", "Target is temporarily immune to Demoralize.")],
    };
  }

  if (isExtractElementAction(action) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoValidElementalTarget", "No valid elemental target."),
      reasons: [t("ScoreReason.NoValidElementalTarget", "No valid elemental target.")],
    };
  }

  if (isExploitVulnerabilityAction(action) && !target && attackableEnemies(context).some(hasExploitVulnerabilityMark)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.TargetIsAlreadyExploited", "Target is already exploited."),
      reasons: [t("ScoreReason.TargetIsAlreadyExploited", "Target is already exploited.")],
    };
  }

  const targetMark = action.activityProfile?.targetMark;
  if (targetMark && !target && attackableEnemies(context).some((enemy) => targetHasMarkState(enemy, targetMark))) {
    const label = targetMarkLabel(targetMark);
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.TargetAlreadyHas", "Target already has {label}.", { label }),
      reasons: [t("ScoreReason.TargetAlreadyHas", "Target already has {label}.", { label })],
    };
  }

  if (Number(action.interactDrawCost) > 0) {
    reasons.push(t("ScoreReason.IncludesInteractToDraw", "Includes Interact to draw or retrieve the consumable."));
  }

  if (isChannelElementsAction(action) && kineticAuraActive(context, profile)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.KineticAuraAlreadyActive", "Kinetic aura already active; Channel Elements is redundant."),
      reasons: [t("ScoreReason.KineticAuraAlreadyActive", "Kinetic aura already active; Channel Elements is redundant.")],
    };
  }

  if (action.source === "strike" && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoValidEnemyTarget", "No valid enemy target."),
      reasons: [t("ScoreReason.NoValidEnemyTarget", "No valid enemy target.")],
    };
  }

  if (isAttackLikeAction(action, role) && !isAreaAction(action, role) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target."),
      reasons: [t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target.")],
    };
  }

  if (requiresTargetableEnemy(action, role) && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoTargetableEnemyTarget", "No targetable enemy target."),
      reasons: [t("ScoreReason.NoTargetableEnemyTarget", "No targetable enemy target.")],
    };
  }

  if (role === "area-damage" && !attackableEnemies(context).length) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target."),
      reasons: [t("ScoreReason.NoAttackableEnemyTarget", "No attackable enemy target.")],
      activityProfile: { ...action.activityProfile, areaPlacementCenter: null, areaPlacementAimPoint: null },
    };
  }

  if (["step", "stride"].includes(action.slug) && action.source === "generic" && !target) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.NoValidEnemyTarget", "No valid enemy target."),
      reasons: [t("ScoreReason.NoValidEnemyTarget", "No valid enemy target.")],
    };
  }

  if (action.source === "strike" && target && !inRange(action, target)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: t("ScoreReason.TargetIsOutOf", "Target is out of range."),
      reasons: [t("ScoreReason.TargetIsOutOf", "Target is out of range.")],
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
      // unused-action penalty — otherwise the planner pads a spare action with a pointless
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
      score = -999;
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
      score = -999;
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

  if (action.slug === "demoralize" && target && !hasCondition(target, "frightened")) {
    score += 22;
    reasons.push(t("ScoreReason.TargetIsNotFrightened", "Target is not frightened."));
  }

  if (action.slug === "trip" && target && !hasCondition(target, "prone")) {
    score += 18;
    reasons.push(t("ScoreReason.TargetIsStandingAnd", "Target is standing and can be knocked prone."));
  }

  if (action.slug === "grapple" && target && !hasCondition(target, "grabbed")) {
    score += 16;
    reasons.push(t("ScoreReason.TargetIsNotGrabbed", "Target is not grabbed."));
  }

  if (action.slug === "disarm" && target) {
    score += 10;
    reasons.push(t("ScoreReason.CanPressureEnemyWeapon", "Can pressure enemy weapon or held item."));
  }

  if (action.slug === "reposition" && target) {
    score += 12;
    reasons.push(t("ScoreReason.CanMoveTargetInto", "Can move target into a better square."));
  }

  if (action.slug === "shove" && target) {
    score += 12;
    reasons.push(t("ScoreReason.CanPushTargetOut", "Can push target out of position."));
  }

  if (action.slug === "feint" && enemyInMelee(context) && !hasCondition(target, "off-guard")) {
    score += 18;
    reasons.push(t("ScoreReason.TargetIsInMelee", "Target is in melee and not off-guard."));
  }

  if (action.slug === "create-a-diversion" && target && !hasCondition(profile, "hidden")) {
    score += 12;
    reasons.push(t("ScoreReason.CanCreateAHidden", "Can create a hidden opening."));
  }

  if (action.slug === "tumble-through" && target && !hasCondition(target, "off-guard")) {
    score += 14;
    reasons.push(t("ScoreReason.CanMoveThroughEnemy", "Can move through enemy and set up off-guard pressure."));
  }

  if (["balance", "climb", "swim"].includes(action.slug)) {
    score += 6;
    reasons.push(t("ScoreReason.TerrainMakesThisMovement", "Terrain makes this movement action relevant."));
  }

  if (action.slug === "force-open") {
    score += 8;
    reasons.push(t("ScoreReason.ObstacleOrObjectCan", "Obstacle or object can be forced open."));
  }

  if (action.slug === "seek") {
    score += 8;
    reasons.push(t("ScoreReason.UsefulWhenHiddenEnemies", "Useful when hidden enemies or hazards may matter."));
  }

  if (action.slug === "sense-motive" && target) {
    score += 6;
    reasons.push(t("ScoreReason.UsefulWhenEnemyIntent", "Useful when enemy intent is unclear."));
  }

  if (action.slug === "recall-knowledge" && target) {
    score += 16;
    reasons.push(t("ScoreReason.IdentifyDefenses", "Identify {target} defenses and weaknesses.", { target: target.name }));
  }

  if (action.slug === "raise-a-shield" && profile.hasShield) {
    score += hpPercent(profile) < 0.5 ? 24 : 12;
    reasons.push(t("ScoreReason.ShieldEquipped", "Shield equipped."));
    if (pressure.inMeleeThreat || pressure.hasOpenEnemyLine) {
      score += 12;
      reasons.push(t("ScoreReason.EnemiesHaveAClear", "Enemies have a clear attack line."));
    }
  }

  if (action.slug === "take-cover") {
    score += hpPercent(profile) < 0.5 ? 18 : 10;
    reasons.push(t("ScoreReason.CoverIsAvailable", "Cover is available."));
    if (pressure.hasOpenEnemyLine) {
      score += 18;
      reasons.push(t("ScoreReason.OpenEnemyLineMakes", "Open enemy line makes cover valuable."));
    }
  }

  if (action.slug === "escape") {
    score += 30;
    reasons.push(t("ScoreReason.ActorIsGrabbedOr", "Actor is grabbed or restrained."));
  }

  if (action.slug === "hide") {
    score += 12;
    reasons.push(t("ScoreReason.CoverOrConcealmentSupports", "Cover or concealment supports hiding."));
  }

  if (action.slug === "sneak") {
    score += 10;
    reasons.push(t("ScoreReason.CanRepositionWhileHidden", "Can reposition while hidden or covered."));
  }

  if (action.slug === "steal" && target) {
    score -= 4;
    reasons.push(t("ScoreReason.CombatTheftIsSituational", "Combat theft is situational."));
  }

  if (action.slug === "palm-an-object") {
    score -= 2;
    reasons.push(t("ScoreReason.NearbyObjectCanBe", "Nearby object can be palmed, but combat value is situational."));
  }

  if (action.slug === "command-an-animal") {
    score += 18;
    reasons.push(t("ScoreReason.CompanionOrMinionCan", "Companion or minion can contribute this turn."));
  }

  if (action.slug === "administer-first-aid") {
    const ally = dyingAlly(context) ?? bleedingAlly(context);
    if (ally) {
      score += 36;
      reasons.push(t("ScoreReason.AllyNeedsAid", "{ally} needs immediate aid.", { ally: ally.name }));
    }
  }

  if (action.slug === "stabilize") {
    const ally = dyingAlly(context);
    if (ally) {
      score += 40;
      reasons.push(t("ScoreReason.AllyDying", "{ally} is dying.", { ally: ally.name }));
    }
  }

  if (isCurated(action) && role === "healing") {
    const injuredAlly = allies(context).find((ally) => hpPercent(ally) < 0.5);
    if (hpPercent(profile) < 0.5) {
      score += 34;
      reasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: actorTarget(context).name }));
    } else if (injuredAlly) {
      score += 34;
      reasons.push(t("ScoreReason.BadlyInjured", "{name} is badly injured.", { name: injuredAlly.name }));
    } else {
      score -= 10;
      reasons.push(t("ScoreReason.NoAllyIsBadly", "No ally is badly injured."));
    }
  }

  if (isCurated(action) && (role === "damage" || role === "weapon-strike") && target && inRange(action, target) && !action.activityProfile?.drawsWeapon) {
    const average = damageAverage(action);
    score += Number.isFinite(average) ? 18 + Math.min(28, Math.round(average * 1.2)) : 18;
    reasons.push(t("ScoreReason.CanDamage", "{action} can damage {target}.", { action: action.name, target: target.name }));
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
      reasons.unshift(t("ScoreReason.DrawAndStrike", "Draw {p0} and Strike {p1}.", { p0: weaponName, p1: target.name }));
    } else {
      score -= 40;
      reasons.unshift(t("ScoreReason.IsStillOutOfRange", "{p0} is still out of range after drawing.", { p0: weaponName }));
    }
  }

  const aggro = target ? aggroProfile(context, target) : null;
  if (aggro?.gmOnly && aggro.roles.length && aggro.score > 0) {
    reasons.push(t("ScoreReason.AggroPriority", "Aggro priority: {roles}.", { roles: aggro.roles.join(", ") }));
  }

  if (isCurated(action) && role === "debuff" && target) {
    score += 20;
    reasons.push(t("ScoreReason.DebuffPressure", "Debuff spell can pressure {target}.", { target: target.name }));
  }

  if (isCurated(action) && role === "setup" && target) {
    score += action.activityProfile?.precisionDamageSetup ? 28 : 20;
    reasons.unshift(t("ScoreReason.SetsUpStrongerFollowUp", "{p0} sets up stronger follow-up attacks.", { p0: action.name }));
  }

  if (isCurated(action) && role === "mobility") {
    const strideCount = Number(action.activityProfile?.strideCount ?? 1);
    const distance = Number(target?.distance ?? Infinity);
    const moveReach = activityMoveReach(profile, action, strideCount);
    if (action.activityProfile?.retreat && enemyInMelee(context)) {
      score += 24;
      reasons.unshift(t("ScoreReason.CanDisengageFromMelee", "{p0} can disengage from melee.", { p0: action.name }));
    } else if (target && distance > profileReach(profile) && distance <= moveReach) {
      score += 18;
      reasons.unshift(t("ScoreReason.CanImprovePositionToward", "{p0} can improve position toward {p1}.", { p0: action.name, p1: target.name }));
    } else {
      score += 8;
      reasons.unshift(t("ScoreReason.ImprovesPosition", "{p0} improves position.", { p0: action.name }));
    }
    if (action.activityProfile?.safeMovement) {
      score += 6;
      reasons.push(t("ScoreReason.MovementReducesReactionRisk", "Movement reduces reaction risk."));
    }
  }

  if (isCurated(action) && role === "drain" && target) {
    const required = action.activityProfile?.requiresAnyTargetCondition ?? [];
    if (required.length && !hasAnyCondition(target, required)) {
      score -= 28;
      reasons.unshift(t("ScoreReason.NeedsAGrabbedRestrainedParalyzed", "{p0} needs a grabbed, restrained, paralyzed, or unconscious target.", { p0: action.name }));
    } else {
      score += hpPercent(profile) < 0.5 ? 58 : 42;
      reasons.unshift(t("ScoreReason.CanDrainAndRecoverHit", "{p0} can drain {p1} and recover Hit Points.", { p0: action.name, p1: target.name }));
    }
  }

  if (isCurated(action) && role === "self-healing") {
    const corpse = nearbyCorpse(context, profile);
    if (action.activityProfile?.requiresCorpse && !corpse) {
      score -= 24;
      reasons.unshift(t("ScoreReason.NeedsAnAdjacentCorpse", "{p0} needs an adjacent corpse.", { p0: action.name }));
    } else {
      score += hpPercent(profile) < 0.5 ? 46 : 20;
      reasons.unshift(corpse ? t("ScoreReason.CanUse", "{p0} can use {p1}.", { p0: action.name, p1: corpse.name }) : t("ScoreReason.CanRecoverHitPoints", "{p0} can recover Hit Points.", { p0: action.name }));
    }
  }

  if (isCurated(action) && role === "resource-recovery") {
    score += 8;
    reasons.unshift(t("ScoreReason.CanRecoverAnExpendedCombat", "{p0} can recover an expended combat resource.", { p0: action.name }));
  }

  if (isCurated(action) && role === "transformation") {
    score += 6;
    reasons.unshift(t("ScoreReason.MayAlterMovementOrAttack", "{p0} may alter movement or attack options.", { p0: action.name }));
  }

  if (isCurated(action) && role === "area-damage") {
    const placement = areaPlacement(action, context);
    const enemiesInArea = placement.enemies;
    const alliesInArea = placement.allies;
    areaHitCount = enemiesInArea.length;
    const centerTargetPoint = placement.centerTarget ? targetCenter(placement.centerTarget) : null;
    const areaType = String(action?.targetingProfile?.type ?? "").toLowerCase();
    if (centerTargetPoint) {
      if (["cone", "line"].includes(areaType)) {
        areaPlacementAimPoint = centerTargetPoint;
      } else {
        areaPlacementCenter = centerTargetPoint;
      }
    }
    if (enemiesInArea.length > 0) {
      score += enemiesInArea.length === 1
        ? 14
        : 34 + enemiesInArea.length * 18;
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      reasons.unshift(t("ScoreReason.CanHit", "{p0} can hit {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
    } else {
      score -= 28;
      reasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
    }
    if (alliesInArea.length > 0) {
      score -= alliesInArea.length * 18;
      reasons.push(t(alliesInArea.length === 1 ? "ScoreReason.AlliesInAreaOne" : "ScoreReason.AlliesInAreaMany", alliesInArea.length === 1 ? "{count} ally may be in the area." : "{count} allies may be in the area.", { count: alliesInArea.length }));
    } else if (enemiesInArea.length > 1 && placement.centerTarget) {
      score += 8;
      reasons.push(t("ScoreReason.BestAreaPlacementAvoids", "Best area placement avoids allies."));
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
      if (bestSave) reasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
      for (const entry of damageDeltas.slice(0, 2)) reasons.push(...entry.reasons);
    }
  }

  if (isCurated(action) && role === "save-damage" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const needsSetup = requiredCondition && !hasRequiredCondition(target, requiredCondition);
    const average = damageAverage(action);
    score += requiredCondition ? 52 : 34;
    if (Number.isFinite(average)) score += Math.min(30, Math.round(average));
    reasons.unshift(needsSetup
      ? t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition })
      : t("ScoreReason.CanForceASave", "{p0} can force a {p1} save.", { p0: action.name, p1: action.saveProfile?.stat ?? "save" }));
    if (targetSaveScore) {
      score += targetSaveScore.scoreDelta;
      reasons.push(targetSaveScore.label);
    }
    if (targetDamageAdjustment) {
      score += targetDamageAdjustment.scoreDelta;
      reasons.push(...targetDamageAdjustment.reasons);
    }
  }

  if (isCurated(action) && role === "grab" && target) {
    if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
      score -= 14;
      reasons.unshift(t("ScoreReason.IsAlreadyGrabbed", "{p0} is already grabbed.", { p0: target.name }));
    } else if (inProfileReach(profile, target)) {
      score += 42;
      reasons.unshift(t("ScoreReason.CanGrab", "{p0} can grab {p1}.", { p0: action.name, p1: target.name }));
    } else {
      score -= 24;
      reasons.unshift(t("ScoreReason.TargetIsOutOfReach", "{p0} target is out of reach.", { p0: action.name }));
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
    const centerTargetPoint = placement.centerTarget ? targetCenter(placement.centerTarget) : null;
    const areaType = String(action?.targetingProfile?.type ?? "").toLowerCase();
    if (centerTargetPoint) {
      if (["cone", "line"].includes(areaType)) {
        areaPlacementAimPoint = centerTargetPoint;
      } else {
        areaPlacementCenter = centerTargetPoint;
      }
    }

    if (!enemiesInArea.length) {
      score -= 24;
      reasons.unshift(t("ScoreReason.NoEnemyIsInArea", "No enemy is in {p0} area.", { p0: action.name }));
    } else if (
      appliedConditions.length
      && enemiesInArea.every((enemy) => appliedConditions.some((condition) => hasCondition(enemy, condition)))
    ) {
      score -= 8;
      reasons.unshift(t("ScoreReason.AreaTargetsAlreadyHave", "{p0} area targets already have {p1}.", { p0: action.name, p1: appliedConditions[0] }));
    } else {
      const centerName = placement.centerTarget?.name ? ` near ${placement.centerTarget.name}` : "";
      score += (appliedConditions.length ? 30 : 22) + enemiesInArea.length * 12;
      reasons.unshift(t("ScoreReason.CanAffect", "{p0} can affect {p1} {p2}{p3}.", { p0: action.name, p1: enemiesInArea.length, p2: plural(enemiesInArea.length, "enemy", "enemies"), p3: centerName }));
      if (canUseTargetDefenses(context)) {
        const saveDeltas = enemiesInArea
          .map((enemy) => saveScoreDelta(context, action, enemy, profile))
          .filter(Boolean);
        const tacticalDelta = Math.round(
          saveDeltas.reduce((total, entry) => total + entry.scoreDelta, 0) * 0.4,
        );
        score += tacticalDelta;
        const bestSave = saveDeltas.toSorted((left, right) => right.scoreDelta - left.scoreDelta)[0];
        if (bestSave) reasons.push(t("ScoreReason.AreaTargetsSave", "Area targets {save} saves ({label})", { save: pf2eSave(action.saveProfile?.stat), label: bestSave.label }));
      }
    }
  } else if (isCurated(action) && role === "control" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const appliedConditions = [
      action.activityProfile?.appliesCondition,
      ...(Array.isArray(action.activityProfile?.appliesConditions) ? action.activityProfile.appliesConditions : []),
    ].filter(Boolean);
    const appliedCondition = appliedConditions[0];
    if (requiredCondition && !hasRequiredCondition(target, requiredCondition)) {
      score -= 24;
      reasons.unshift(t("ScoreReason.WantsATarget", "{p0} wants a {p1} target.", { p0: action.name, p1: requiredCondition }));
    } else if (appliedConditions.some((condition) => hasCondition(target, condition))) {
      score -= 10;
      reasons.unshift(t("ScoreReason.AlreadyHas", "{p0} already has {p1}.", { p0: target.name, p1: appliedCondition }));
    } else {
      score += appliedCondition ? 42 : 32;
      reasons.unshift(t("ScoreReason.CanControl", "{p0} can control {p1}.", { p0: action.name, p1: target.name }));
      if (targetSaveScore) {
        score += targetSaveScore.scoreDelta;
        reasons.push(targetSaveScore.label);
      }
    }
  }

  if (isCurated(action) && role === "reaction-attack") {
    score += 26;
    reasons.unshift(t("ScoreReason.ReactionCanPunishTheCurrent", "Reaction can punish the current trigger."));
  }

  if (isCurated(action) && role === "defense" && action.slug === "drop-prone") {
    score += (profile.equippedRangedWeapon ? -10 : 0) + (hpPercent(profile) < 0.5 ? 34 : 18);
    reasons.unshift(t("ScoreReason.DropsProneForCover", "Dropping prone gives cover but penalizes the actor's own attacks."));
  } else if (isCurated(action) && role === "defense") {
    score += hpPercent(profile) < 0.5 ? 34 : 18;
    reasons.unshift(t("ScoreReason.DefensiveReactionIsAvailableFor", "Defensive reaction is available for the trigger."));
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
      reasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipient.entity.name ?? t("ScoreReason.TargetWord", "Target"), action: action.name }));
    }
    score += buffValue;
    reasons.unshift(grantsQuickened ? t("ScoreReason.GrantsQuickened", "{p0} grants quickened.", { p0: action.name }) : allyTarget ? t("ScoreReason.CanBoost", "{p0} can boost {p1}.", { p0: action.name, p1: recipient.entity?.name ?? "an ally" }) : t("ScoreReason.GrantsTheActorABeneficial", "{p0} grants the actor a beneficial effect.", { p0: action.name }));
  }

  if (isCurated(action) && role === "stealth-defense") {
    const recipient = bestBuffRecipient(context, action);
    const recipientName = recipient?.type === "ally" ? recipient.entity?.name ?? "an ally" : "the actor";
    score += 22 + Math.max(0, Number(recipient?.value) || 0);
    if (targetAlreadyHasBuff(recipient?.entity, action)) {
      score -= 44;
      reasons.push(t("ScoreReason.RecipientAlreadyHas", "{recipient} already has {action}.", { recipient: recipientName, action: action.name }));
    }
    reasons.unshift(t("ScoreReason.CanMakeHarderToTarget", "{p0} can make {p1} harder to target.", { p0: action.name, p1: recipientName }));
  }

  if (isCurated(action) && role === "summon") {
    score += 14;
    reasons.unshift(t("ScoreReason.BringsAnAllyOrConstruct", "{p0} brings an ally or construct onto the battlefield.", { p0: action.name }));
  }

  // Last-resort options: recognized but no tactical pattern. Push well below the
  // basics so they only surface when nothing stronger fills the turn.
  if (role === "utility") {
    score -= 30;
    reasons.unshift(t("ScoreReason.IsAvailableNoStrongerPattern", "{p0} is available; no stronger pattern recognized.", { p0: action.name }));
  }

  if (role === "exploration-utility") {
    score -= enemies(context).length ? 46 : 18;
    reasons.unshift(t("ScoreReason.IsMostlyExplorationUtility", "{p0} is mostly exploration utility.", { p0: action.name }));
  }

  if (role === "combat-utility") {
    score += enemies(context).length ? 4 : -8;
    reasons.unshift(t("ScoreReason.HasSituationalCombatUtility", "{p0} has situational combat utility.", { p0: action.name }));
  }

  if (role === "sustain-control") {
    score += enemies(context).length ? 18 : 4;
    reasons.unshift(t("ScoreReason.CanMaintainOngoingControl", "{p0} can maintain ongoing control.", { p0: action.name }));
  }

  if (action.slug === "rage" && !hasCondition(profile, "rage") && !hasCondition(profile, "raging")) {
    score += 46;
    reasons.push(t("ScoreReason.RageSetsUpThis", "Rage sets up this turn's attack."));
  }

  if (action.slug === "sudden-charge" && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const chargeReach = speed * 2 + reach;

    if (distance > reach && distance <= chargeReach) {
      score += 72;
      reasons.push(t("ScoreReason.ClosesAndAttacks", "Closes {distance} ft and attacks in one activity.", { distance }));
    } else if (distance <= reach) {
      score -= 18;
      reasons.push(t("ScoreReason.AlreadyInReachSudden", "Already in reach; Sudden Charge has less value."));
    } else {
      score -= 24;
      reasons.push(t("ScoreReason.TargetIsBeyondSudden", "Target is beyond Sudden Charge reach."));
    }
  }

  if (action.activityProfile?.includesStrike && action.activityProfile?.strideCount > 0 && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const moveReach = speed * Number(action.activityProfile.strideCount ?? 1) + activityStrikeReach(profile, action);
    const center = attackCenter(action);
    const destinationThreatCount = center ? threatsAtCenter(context, center).length : null;

    if (action.activityProfile?.retreatBeforeStrike) {
      score += 66;
      reasons.unshift(t("ScoreReason.MovesOutOfMeleeBefore", "Moves out of melee before attacking {p0}.", { p0: target.name }));
      if (destinationThreatCount !== null && destinationThreatCount < pressure.meleeThreats.length) {
        score += 20;
        reasons.push(t("ScoreReason.AttackSquareReducesMelee", "Attack square reduces melee exposure."));
      }
    } else if (distance > reach && distance <= moveReach) {
      score += 60;
      reasons.unshift(t("ScoreReason.MovesIntoReachAndAttacks", "Moves into reach and attacks {p0}.", { p0: target.name }));
    } else if (distance <= reach) {
      score += 18;
      reasons.unshift(t("ScoreReason.IsAlreadyInReachFor", "{p0} is already in reach for the attack.", { p0: target.name }));
    } else {
      score -= 30;
      reasons.unshift(t("ScoreReason.TargetIsBeyondThisMove", "Target is beyond this move-and-attack activity."));
    }

    if (destinationThreatCount !== null && !action.activityProfile?.retreatBeforeStrike) {
      if (destinationThreatCount > Math.max(1, pressure.meleeThreats.length)) {
        score -= 18 + destinationThreatCount * 4;
        reasons.push(t("ScoreReason.AttackSquareEndsIn", "Attack square ends in heavy enemy reach."));
      } else if (action.activityProfile?.retreatAfterStrike && action.activityProfile?.defensiveCoverState) {
        score += 18;
        reasons.push(t("ScoreReason.PlanReturnsToCover", "Plan returns to cover after attacking."));
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
      reasons.unshift(t("ScoreReason.FlanksForAnOffGuard", "Flanks {p0} for an off-guard Strike.", { p0: target?.name ?? "the target" }));
    } else if (action.activityProfile.positionalTactic === "skirmish") {
      const fragile = hpPercent(profile) < 0.5;
      score += fragile ? 26 : 18;
      reasons.unshift(fragile ? t("ScoreReason.FragileAttackerKitesOutOf", "Fragile attacker kites out of melee before striking from range.") : t("ScoreReason.FightsBetterAtRangeKites", "Fights better at range; kites out of melee before striking."));
    }
  }

  if (isCurated(action) && action.activityProfile?.strideCount > 0 && action.saveProfile && action.damageProfile) {
    const moveReach = profileMoveReach(profile, action.activityProfile.strideCount);
    const reachableEnemies = attackableEnemies(context).filter((enemy) => (enemy?.distance ?? Infinity) <= moveReach);
    if (reachableEnemies.length > 0) {
      score += 24 + reachableEnemies.length * 12;
      reasons.unshift(t("ScoreReason.CanMoveThrough", "{p0} can move through {p1} {p2}.", { p0: action.name, p1: reachableEnemies.length, p2: plural(reachableEnemies.length, "enemy", "enemies") }));
    } else {
      score -= 18;
      reasons.unshift(t("ScoreReason.NoEnemyIsReachableFor", "No enemy is reachable for {p0}.", { p0: action.name }));
    }
  }

  if (action.activityProfile?.focusedStrike && target && !action.activityProfile?.strideCount) {
    if (inActionReach(profile, action, target)) {
      score += 72;
      reasons.unshift(t("ScoreReason.FocusesAttacksOn", "{p0} focuses attacks on {p1}.", { p0: action.name, p1: target.name }));
    } else {
      score -= 40;
      reasons.unshift(t("ScoreReason.TargetIsOutOfRange", "{p0} target is out of range.", { p0: action.name }));
    }
  }

  if (action.activityProfile?.multiStrike) {
    const reachableEnemies = attackableEnemies(context).filter((enemy) => inProfileReach(profile, enemy));
    if (reachableEnemies.length >= 2) {
      score += 76;
      reasons.unshift(t("ScoreReason.EnemiesAreInReachFor", "{p0} enemies are in reach for separate Strikes.", { p0: reachableEnemies.length }));
    } else if (inProfileReach(profile, target)) {
      score += 36;
      reasons.unshift(t("ScoreReason.OnlyOneEnemyIsIn", "Only one enemy is in reach; focused offense is usually better."));
    } else {
      score -= 40;
      reasons.unshift(t("ScoreReason.NoEnemyIsInReach", "No enemy is in reach for {p0}.", { p0: action.name }));
    }
  }

  if (isCurated(action) && (action.curated?.friendlyFireRisk ?? action.friendlyFireRisk)) {
    if (allies(context).some((ally) => (ally?.distance ?? Infinity) <= 20)) score -= 18;
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
    reasons.push(t("ScoreReason.CommitsActions", "Commits {count} actions to one effect.", { count: action.actionCost }));
  }

  if (skillCheck) {
    score += skillCheck.scoreDelta;
    reasons.push(...skillCheck.reasons);
  }

  if (ownSkillReliability) {
    score += ownSkillReliability.scoreDelta;
    reasons.push(...ownSkillReliability.reasons);
  }

  if (target && isAttackLikeAction(action, role) && detectionState(target) === "hidden") {
    const targetDependentGain = Math.max(0, score - baseScore(action));
    score -= targetDependentGain * HIDDEN_TARGET_FLAT_CHECK_DISCOUNT;
    reasons.push(t("ScoreReason.HiddenTargetFlatCheck", "{target} is hidden; a flat check is needed before this can affect them.", { target: target.name }));
  }

  return sanitizeScoredRecommendation({
    ...action,
    score,
    skillCheck,
    suggestedTarget,
    reason: reasons[0] ?? defaultReason(action),
    reasons,
    activityProfile: {
      ...action.activityProfile,
      areaPlacementCenter,
      areaPlacementAimPoint,
      ...(distinctTargets ? { distinctTargets } : {}),
    },
  }, {
    isGM: canUseTargetDefenses(context),
    fallbackReason: defaultReason(action),
  });
}
