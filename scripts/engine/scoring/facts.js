import { collectionValues } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import {
  canUseIntelCategory,
  canUseIntelFact,
  intelDefenseFactId,
  intelTraitFactId,
  isNpcIntelTarget,
} from "../../rules/intel-ledger.js";
import { slugify as slugText } from "../action/text.js";
import { contextActorDocument as contextActorDocumentFromContext } from "../actor-context.js";

export function valueSlugs(value) {
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

export function contextActorDocument(context) {
  return contextActorDocumentFromContext(context);
}

export function targetActorDocument(target) {
  const actor = target?.actor?.document ?? target?.actor?.object ?? target?.actor;
  return actor && typeof actor === "object" ? actor : null;
}

function targetRequiresIntel(target) {
  const actor = targetActorDocument(target);
  if (!actor) return false;
  return String(actor.type ?? target?.actor?.type ?? target?.type ?? "").toLowerCase() !== "character";
}

function systemTraitSlugs(document) {
  return valueSlugs(document?.system?.traits?.value ?? document?.system?.traits);
}

export function targetTraitSlugs(context, target) {
  const values = [
    target?.traits,
    target?.traitSlugs,
    target?.system?.traits?.value,
    target?.system?.traits,
    systemTraitSlugs(targetActorDocument(target)),
  ].flatMap(valueSlugs);

  if (!targetRequiresIntel(target)) {
    return new Set(values.filter(Boolean));
  }

  return new Set(values
    .filter(Boolean)
    .filter((trait) => canUseIntelFact(context, target, "traits", intelTraitFactId(trait))));
}

export function hasSpellcastingCapability(context) {
  const actor = contextActorDocument(context);
  if (!actor) return false;

  if (collectionValues(actor?.itemTypes?.spell).length > 0) return true;
  if (collectionValues(actor?.itemTypes?.spellcastingEntry).length > 0) return true;
  if (collectionValues(actor?.system?.spellcasting?.entries).length > 0) return true;

  return collectionValues(actor?.items).some((item) =>
    item?.type === "spell" || item?.type === "spellcastingEntry",
  );
}

export function actionTraitSlugs(action) {
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

export function isRangedStrike(action) {
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

export function isMeleeStrikeFallback(action) {
  if (action?.source !== "strike" && action?.activityProfile?.drawsWeapon !== true) return false;
  return !isRangedStrike(action);
}

export function maxRange(action) {
  const max = Number(action?.range?.max);
  if (Number.isFinite(max) && max > 0) return max;

  const profileMax = Number(action?.targetingProfile?.maxRange ?? action?.targetingProfile?.range);
  if (Number.isFinite(profileMax) && profileMax > 0) return profileMax;

  const increment = Number(action?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return increment;

  if (action.source === "strike") return 5;
  return Infinity;
}

export function inRange(action, target) {
  if (!target) return false;
  return (target.distance ?? Infinity) <= maxRange(action);
}

export function volleyRange(action) {
  for (const trait of actionTraitSlugs(action)) {
    const match = trait.match(/^volley-(\d+)$/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}

export function isSpellAction(action) {
  return String(action?.source ?? "").startsWith("spell");
}

export function isOffensiveRole(role) {
  return ["damage", "area-damage", "save-damage", "control", "debuff", "grab"].includes(role);
}

export function isAttackLikeAction(action, role) {
  return action?.source === "strike"
    || action?.activityProfile?.includesStrike === true
    || action?.attackTrait === true
    || ["mobility-attack", "multiattack"].includes(role)
    || isOffensiveRole(role);
}

export function makesAttackRoll(action) {
  return action?.source === "strike"
    || action?.attackTrait === true
    || action?.activityProfile?.includesStrike === true
    || action?.activityProfile?.spellAttack === true
    || actionTraitSlugs(action).includes("attack");
}

export function isAreaAction(action, role) {
  const type = String(action?.targetingProfile?.type ?? "").toLowerCase();
  return role === "area-damage"
    || action?.targetingProfile?.area === true
    || ["burst", "cone", "line", "emanation"].includes(type);
}

export function requiresTargetableEnemy(action, role) {
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

export function damageAverage(action) {
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

export function damageTypes(action) {
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

function visibleDefenseEntries(context, target, category, value, { showValue = true } = {}) {
  const entries = defenseEntries(value);
  if (!target || !targetRequiresIntel(target)) return entries;
  if (!canUseIntelCategory(context, target, category)) return [];
  return entries.filter((entry) =>
    canUseIntelFact(context, target, category, intelDefenseFactId(entry, { showValue })));
}

function matchesDamageType(entry, type) {
  const defenseType = entryType(entry);
  if (!defenseType || !type) return false;
  if (defenseType === "all" || defenseType === type) return true;
  if (defenseType === "physical" && ["bludgeoning", "piercing", "slashing"].includes(type)) return true;
  return false;
}

function maxDefenseEntry(entries, types) {
  if (!types.length) return null;
  return defenseEntries(entries)
    .filter((entry) => types.some((type) => matchesDamageType(entry, type)))
    .reduce((best, entry) => entryValue(entry) > entryValue(best) ? entry : best, null);
}

function defenseAmountReason(entry, amount) {
  if (entry?.exactValueHidden && entry?.intelBandLabel) return String(entry.intelBandLabel).toLowerCase();
  return amount;
}

function hasImmunity(entries, types) {
  if (!types.length) return false;
  return defenseEntries(entries).some((entry) => types.some((type) => matchesDamageType(entry, type)));
}

export function damageAdjustment(context, action, target) {
  if (!target) return null;
  const types = damageTypes(action);
  if (!types.length) return null;

  const average = damageAverage(action);
  const resistances = visibleDefenseEntries(context, target, "resistances", target.resistances);
  const weaknesses = visibleDefenseEntries(context, target, "weaknesses", target.weaknesses);
  const immunities = visibleDefenseEntries(context, target, "immunities", target.immunities, { showValue: false });
  const resistanceEntry = maxDefenseEntry(resistances, types);
  const weaknessEntry = maxDefenseEntry(weaknesses, types);
  const resistance = entryValue(resistanceEntry);
  const weakness = entryValue(weaknessEntry);
  const immune = hasImmunity(immunities, types);
  const reasons = [];
  let scoreDelta = 0;

  if (immune) {
    scoreDelta -= 70;
    reasons.push(t("ScoreReason.TargetImmune", "{target} is immune to {types}.", { target: target.name, types: types.join("/") }));
  }
  if (resistance > 0) {
    scoreDelta -= Math.min(35, resistance * 3);
    reasons.push(t("ScoreReason.TargetResists", "{target} resists {types} {amount}.", {
      target: target.name,
      types: types.join("/"),
      amount: defenseAmountReason(resistanceEntry, resistance),
    }));
  }
  if (weakness > 0) {
    scoreDelta += Math.min(45, weakness * 4);
    reasons.push(t("ScoreReason.TargetWeakness", "{target} has {types} weakness {amount}.", {
      target: target.name,
      types: types.join("/"),
      amount: defenseAmountReason(weaknessEntry, weakness),
    }));
  }
  if (Number.isFinite(average) && average > 0 && resistance > average * 0.75) {
    scoreDelta -= 18;
    reasons.push(t("ScoreReason.ResistanceAbsorbsMostExpected", "Resistance absorbs most expected damage."));
  }

  return scoreDelta || reasons.length ? { scoreDelta, reasons, immune, resistance, weakness } : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

export function degreeDistribution(rollBonus, dc) {
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

function saveOutcomeChance(dc, saveDc) {
  if (!Number.isFinite(dc) || !Number.isFinite(saveDc)) return null;
  return degreeDistribution(saveDc - 10, dc);
}

function incapacitationApplies(action, target) {
  if (!actionTraitSlugs(action).includes("incapacitation")) return false;
  const doc = targetActorDocument(target);
  const level = Number(target?.level ?? doc?.system?.details?.level?.value);
  const rank = Number(action?.castRank ?? action?.rank ?? action?.spellRank);
  if (!Number.isFinite(level) || !Number.isFinite(rank) || rank <= 0) return false;
  return level > rank * 2;
}

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

export function saveScoreDelta(context, action, target, profile) {
  if (!action?.saveProfile?.stat || !target) return null;
  if (!canUseTargetSave(context, target, action.saveProfile.stat)) return null;
  const saveDc = targetDc(target, action.saveProfile.stat);
  if (!Number.isFinite(saveDc)) return null;

  const expected = saveExpectedMultiplier(action, target, profile);
  if (expected) {
    const average = damageAverage(action);
    const multiplierDelta = Math.round((expected.multiplier - 0.7) * 34);
    const damageDelta = Number.isFinite(average) ? Math.round(Math.min(36, average * expected.multiplier * 0.7)) : 0;
    const dcLabel = targetDcLabel(target, action.saveProfile.stat, saveDc);
    const label = expected.incapacitated
      ? `${dcLabel} vs spell DC ${expected.dc} (incapacitation: target resists a degree better).`
      : `${dcLabel} vs spell DC ${expected.dc}.`;
    return {
      scoreDelta: multiplierDelta + damageDelta,
      label,
      multiplier: expected.multiplier,
    };
  }

  return {
    scoreDelta: Math.max(-18, Math.min(18, 22 - saveDc)),
    label: `${targetDcLabel(target, action.saveProfile.stat, saveDc)}.`,
  };
}

export function hpPercent(entity) {
  const nested = Number(entity?.hp?.percent);
  if (Number.isFinite(nested)) return nested;

  const flat = Number(entity?.hpPercent);
  if (Number.isFinite(flat)) return flat;

  return 1;
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

export function hasAnyCondition(entity, slugs) {
  return slugs.some((slug) => hasCondition(entity, slug));
}

export function hasRequiredCondition(entity, slug) {
  return hasCondition(entity, slug)
    || (slug === "grabbed" && hasCondition(entity, "restrained"));
}

export function hasEffect(entity, slug) {
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

export function hasEffectSlug(entity, slug) {
  const normalized = slugText(slug);
  return collectionValues(entity?.effects).some((effect) => [
    effect?.slug,
    effect?.name,
    effect?.label,
    effect?.sourceId,
  ].map(slugText).some((value) => value === normalized || value.includes(normalized)));
}

export function targetHasMatchingDefense(context, target, types) {
  if (!types.length) return false;
  return ["resistances", "weaknesses", "immunities"].some((key) => {
    const direct = defenseEntries(target?.[key]);
    const document = targetActorDocument(target);
    const actorValues = defenseEntries(
      document?.system?.attributes?.[key]
        ?? document?.system?.[key],
    );
    return visibleDefenseEntries(context, target, key, [...direct, ...actorValues], { showValue: key !== "immunities" })
      .some((entry) => types.some((type) => matchesDamageType(entry, type)));
  });
}

export function canUseTargetSave(context, target = null, saveSlug = null) {
  if (!target || !saveSlug) return false;
  if (!targetRequiresIntel(target)) return context?.isGM === true;
  const category = saveSlug === "perception" ? "perception" : "saves";
  return canUseIntelFact(context, target, category, saveSlug);
}

export function canUseTargetDefenses(context, target = null, category = null) {
  const isGM = typeof context?.isGM === "boolean" ? context.isGM : globalThis.game?.user?.isGM === true;
  if (target && category) return isGM || canUseIntelCategory(context, target, category);
  if (target) {
    return isGM || ["traits", "saves", "perception", "weaknesses", "resistances", "immunities"]
      .some((entry) => canUseIntelCategory(context, target, entry));
  }
  return isGM;
}

export function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numericDc(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

export function targetDcLabel(target, dcSlug, dc = targetDc(target, dcSlug)) {
  const band = dcSlug === "perception"
    ? target?.intelPerceptionBand
    : target?.intelSaveBands?.[dcSlug];
  if (band?.label) return `${titleCase(dcSlug)}: ${band.label}`;
  return `${titleCase(dcSlug)} DC ${dc}`;
}

export function targetDc(target, dcSlug) {
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
