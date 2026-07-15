import { collectionValues } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import { contextActorDocument } from "../actor-context.js";
import {
  canUseTargetSave,
  degreeDistribution,
  targetActorDocument,
  targetDc,
  targetDcLabel,
  targetTraitSlugs,
  titleCase,
} from "./facts.js";
import { actionSkillDcSlug } from "./skills.js";
import { normalizedActionFacts } from "../action/facts.js";

function numeric(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function signed(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function contextIsGM(context) {
  return typeof context?.isGM === "boolean"
    ? context.isGM
    : globalThis.game?.user?.isGM === true;
}

function actionSlug(action) {
  return normalizedActionFacts(action).identity.slug;
}

function actionTraits(action) {
  return normalizedActionFacts(action).traits;
}

function actionItem(action) {
  return action?.item ?? action?.strike?.item ?? action?.generatedAction?.item ?? null;
}

function nativeItem(action) {
  const item = actionItem(action);
  return item && typeof item.getRollOptions === "function" ? item : null;
}

function itemIsType(item, type) {
  if (typeof item?.isOfType === "function") return item.isOfType(type) === true;
  if (type === "spell") return item?.type === "spell";
  if (type === "physical") {
    return ["armor", "backpack", "book", "consumable", "equipment", "shield", "treasure", "weapon"]
      .includes(String(item?.type ?? "").toLowerCase());
  }
  return false;
}

function actorLevel(actor) {
  return numeric(actor?.level, actor?.system?.details?.level?.value, actor?.system?.details?.level);
}

function incapacitationEffectLevel(actor, action) {
  const item = actionItem(action);
  const facts = normalizedActionFacts(action);
  const spell = itemIsType(item, "spell") || facts.resolution.spell;
  if (spell) {
    const rank = numeric(facts.resolution.rank, item?.system?.level);
    return Number.isFinite(rank) && rank > 0 ? rank * 2 : null;
  }
  if (itemIsType(item, "physical")) {
    return numeric(item?.level, item?.system?.level?.value, item?.system?.level);
  }
  return actorLevel(actor);
}

function incapacitationDegreeShift(context, actor, target, action, mode) {
  if (!contextIsGM(context) || !actionTraits(action).includes("incapacitation")) return 0;
  const targetLevel = actorLevel(targetActorDocument(target));
  const effectLevel = incapacitationEffectLevel(actor, action);
  if (!Number.isFinite(targetLevel) || !Number.isFinite(effectLevel) || targetLevel <= effectLevel) return 0;
  return mode === "save" ? 1 : -1;
}

function shiftDegreeDistribution(odds, amount) {
  if (!odds || !amount) return odds;
  const keys = ["criticalFailure", "failure", "success", "criticalSuccess"];
  const shifted = Object.fromEntries(keys.map((key) => [key, 0]));
  keys.forEach((key, index) => {
    const shiftedIndex = Math.max(0, Math.min(keys.length - 1, index + amount));
    shifted[keys[shiftedIndex]] += odds[key];
  });
  return shifted;
}

function spellcastingEntry(actor, action) {
  const id = String(action?.spellcastingEntryId ?? "").trim();
  const uuid = String(action?.spellcastingEntryUuid ?? "").trim();
  return collectionValues(actor?.itemTypes?.spellcastingEntry)
    .find((entry) => (id && String(entry?.id ?? entry?._id) === id) || (uuid && entry?.uuid === uuid)) ?? null;
}

function isStatistic(value) {
  return value && typeof value === "object"
    && (value.check || typeof value.withRollOptions === "function" || Number.isFinite(Number(value.mod)));
}

function resolveStatistic(actor, action) {
  const entry = spellcastingEntry(actor, action);
  const direct = [
    action?.nativeStatistic,
    action?.generatedAction?.statistic,
    action?.item?.spellcasting?.statistic,
    entry?.statistic,
  ].find(isStatistic);
  if (direct) return direct;

  const slug = String(
    action?.statistic
      ?? action?.skill
      ?? action?.generatedAction?.statistic?.slug
      ?? "",
  ).trim().toLowerCase();
  return slug && typeof actor?.getStatistic === "function" ? actor.getStatistic(slug) : null;
}

function modifierEntries(check) {
  return (Array.isArray(check?.modifiers) ? check.modifiers : [])
    .filter((modifier) => modifier?.enabled !== false && modifier?.ignored !== true)
    .map((modifier) => ({
      label: String(modifier?.label ?? modifier?.slug ?? "").trim(),
      value: numeric(modifier?.modifier, modifier?.value),
    }))
    .filter((modifier) => modifier.label && modifier.value !== null);
}

function contextualStatistic(statistic, options = {}) {
  if (!statistic) return null;
  const configured = typeof statistic.withRollOptions === "function"
    ? statistic.withRollOptions(options)
    : statistic;
  const check = configured?.check ?? configured;
  const modifier = numeric(check?.mod, configured?.mod, check?.totalModifier, configured?.totalModifier);
  if (modifier === null) return null;
  return {
    statistic: configured,
    check,
    modifier,
    breakdown: String(check?.breakdown ?? configured?.breakdown ?? "").trim(),
    modifiers: modifierEntries(check),
  };
}

function safeRollOptions(context, action, target) {
  const slug = actionSlug(action);
  const traits = actionTraits(action);
  const options = new Set();
  if (slug) {
    options.add(`action:${slug}`);
    options.add(`self:action:slug:${slug}`);
  }
  for (const trait of traits) {
    options.add(trait);
    options.add(`action:trait:${trait}`);
    if (nativeItem(action)) options.add(`item:trait:${trait}`);
  }
  for (const trait of targetTraitSlugs(context, target)) options.add(`target:trait:${trait}`);
  return [...options];
}

function targetAc(target) {
  const actor = targetActorDocument(target);
  return numeric(
    target?.ac?.value,
    target?.ac,
    target?.defenses?.ac,
    actor?.system?.attributes?.ac?.value,
    actor?.system?.attributes?.ac,
  );
}

function attackLike(action) {
  return normalizedActionFacts(action).resolution.makesAttackRoll;
}

function skillCheckLike(action) {
  const statisticSlug = normalizedActionFacts(action).resolution.skill;
  const dcSlug = actionSkillDcSlug(action);
  return Boolean(statisticSlug && dcSlug && dcSlug !== "ac");
}

function actionDc(action, statistic, context) {
  return numeric(
    action?.saveProfile?.dc,
    action?.difficultyClass?.value,
    action?.difficultyClass,
    action?.dc?.value,
    action?.dc,
    action?.spellDc,
    statistic?.dc?.value,
    context?.profile?.spellDc,
    context?.profile?.classDc,
  );
}

function knownTargetDc(context, target, slug) {
  if (!target || !slug) return null;
  if (contextIsGM(context)) return targetDc(target, slug);
  return canUseTargetSave(context, target, slug) ? targetDc(target, slug) : null;
}

function targetDcIsApproximate(target, slug) {
  return slug === "perception"
    ? Boolean(target?.intelPerceptionBand)
    : Boolean(target?.intelSaveBands?.[slug]);
}

function percentage(value) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function resultData({
  action,
  mode,
  statisticLabel,
  modifier,
  dc,
  dcLabel,
  breakdown,
  modifiers,
  source,
  approximate = false,
  degreeShift = 0,
}) {
  const unadjustedOdds = Number.isFinite(dc) ? degreeDistribution(modifier, dc) : null;
  const odds = shiftDegreeDistribution(unadjustedOdds, degreeShift);
  const successChance = odds ? odds.success + odds.criticalSuccess : null;
  const effectChance = odds
    ? mode === "save" ? odds.failure + odds.criticalFailure : successChance
    : null;
  const resolution = Number.isFinite(dc)
    ? `${statisticLabel} ${signed(modifier)} vs ${dcLabel}`
    : `${statisticLabel} ${signed(modifier)}`;
  const label = effectChance === null
    ? t("Preflight.NativeModifier", "PF2e {statistic} {modifier}", {
      statistic: statisticLabel,
      modifier: signed(modifier),
    })
    : mode === "attack"
      ? t("Preflight.HitChance", "PF2e Hit {chance}", { chance: percentage(effectChance) })
      : mode === "save"
        ? t("Preflight.TargetFailChance", "PF2e Fails {chance}", { chance: percentage(effectChance) })
        : t("Preflight.SuccessChance", "PF2e Success {chance}", { chance: percentage(effectChance) });
  const reason = t(
    "Preflight.PreviewReason",
    "PF2e check preview: {resolution}.",
    { resolution },
  );
  const breakdownText = breakdown
    ? t("Preflight.ModifierBreakdown", "Modifier breakdown: {breakdown}.", { breakdown })
    : "";
  const approximateText = approximate
    ? t("Preflight.ApproximateIntel", "Target DC uses revealed approximate Intel.")
    : "";
  const incapacitationText = degreeShift > 0
    ? t("Preflight.IncapacitationRaisesTarget", "Incapacitation raises the target's result by one degree.")
    : degreeShift < 0
      ? t("Preflight.IncapacitationLowersCheck", "Incapacitation lowers the acting check's result by one degree.")
      : "";
  const informationalText = t("Preflight.InformationalOnly", "Informational only; does not change Auto-fill ranking.");
  const tooltipLines = [
    `${resolution}.`,
    breakdownText,
    approximateText,
    incapacitationText,
    informationalText,
  ].filter(Boolean);
  const tooltip = [
    reason,
    breakdownText,
    approximateText,
    incapacitationText,
    informationalText,
  ].filter(Boolean).join(" ");

  return {
    available: true,
    status: Number.isFinite(dc) ? "complete" : "partial",
    scoreApplied: false,
    mode,
    source,
    statisticLabel,
    modifier,
    dc: Number.isFinite(dc) ? dc : null,
    dcLabel: Number.isFinite(dc) ? dcLabel : "",
    approximate,
    odds,
    unadjustedOdds: degreeShift ? unadjustedOdds : null,
    incapacitationApplied: degreeShift !== 0,
    degreeShift,
    successChance,
    effectChance,
    modifiers,
    breakdown,
    label,
    reason,
    tooltip,
    tooltipLines,
    actionSlug: actionSlug(action),
  };
}

function strikeModifier(action) {
  const variants = Array.isArray(action?.variants)
    ? action.variants
    : Array.isArray(action?.strike?.variants) ? action.strike.variants : [];
  const index = Math.max(0, Math.min(2, Number(action?.attackIndex ?? action?.mapIndex ?? 0) || 0));
  return numeric(
    variants[index]?.modifier,
    variants[index]?.mod,
    action?.strike?.modifier,
    action?.attackModifier,
  );
}

function attackPreflight(context, actor, target, action, options) {
  const strike = action?.source === "strike" ? strikeModifier(action) : null;
  const contextual = strike === null
    ? contextualStatistic(resolveStatistic(actor, action), options)
    : { modifier: strike, breakdown: "", modifiers: [] };
  if (!contextual) return null;
  const dc = contextIsGM(context) ? targetAc(target) : null;
  const statisticLabel = normalizedActionFacts(action).resolution.strike
    ? t("Preflight.Strike", "Strike")
    : String(contextual.statistic?.label ?? action?.name ?? t("Preflight.Attack", "Attack"));
  return resultData({
    action,
    mode: "attack",
    statisticLabel,
    modifier: contextual.modifier,
    dc,
    dcLabel: Number.isFinite(dc) ? `AC ${dc}` : "",
    breakdown: contextual.breakdown,
    modifiers: contextual.modifiers,
    source: strike === null ? "pf2e-statistic" : "pf2e-strike",
    degreeShift: incapacitationDegreeShift(context, actor, target, action, "attack"),
  });
}

function savePreflight(context, actor, target, action, options) {
  const saveSlug = normalizedActionFacts(action).resolution.saveStat;
  if (!saveSlug || !target) return null;
  const dc = actionDc(action, resolveStatistic(actor, action), context);
  if (!Number.isFinite(dc)) return null;

  const targetActor = contextIsGM(context) ? targetActorDocument(target) : null;
  const nativeTargetStatistic = targetActor && typeof targetActor.getStatistic === "function"
    ? targetActor.getStatistic(saveSlug)
    : null;
  const contextual = nativeTargetStatistic
    ? contextualStatistic(nativeTargetStatistic, {
      origin: actor,
      item: nativeItem(action),
      extraRollOptions: options.extraRollOptions,
    })
    : null;
  const knownDc = knownTargetDc(context, target, saveSlug);
  const modifier = contextual?.modifier ?? (Number.isFinite(knownDc) ? knownDc - 10 : null);
  if (!Number.isFinite(modifier)) return null;
  return resultData({
    action,
    mode: "save",
    statisticLabel: titleCase(saveSlug),
    modifier,
    dc,
    dcLabel: `action DC ${dc}`,
    breakdown: contextual?.breakdown ?? "",
    modifiers: contextual?.modifiers ?? [],
    source: contextual ? "pf2e-target-statistic" : "revealed-intel",
    approximate: !contextual && targetDcIsApproximate(target, saveSlug),
    degreeShift: incapacitationDegreeShift(context, actor, target, action, "save"),
  });
}

function checkPreflight(context, actor, target, action, options) {
  const contextual = contextualStatistic(resolveStatistic(actor, action), options);
  if (!contextual) return null;
  const dcSlug = actionSkillDcSlug(action);
  const dc = knownTargetDc(context, target, dcSlug);
  return resultData({
    action,
    mode: "check",
    statisticLabel: String(contextual.statistic?.label ?? titleCase(action?.skill ?? action?.statistic ?? action?.name)),
    modifier: contextual.modifier,
    dc,
    dcLabel: Number.isFinite(dc) ? targetDcLabel(target, dcSlug, dc) : "",
    breakdown: contextual.breakdown,
    modifiers: contextual.modifiers,
    source: "pf2e-statistic",
    approximate: Number.isFinite(dc) && targetDcIsApproximate(target, dcSlug),
    degreeShift: incapacitationDegreeShift(context, actor, target, action, "check"),
  });
}

export function nativeRollContextPreflight(context, action, { target = null } = {}) {
  const actor = contextActorDocument(context);
  if (!actor || !action) return { available: false, status: "unavailable", scoreApplied: false };

  try {
    const gm = contextIsGM(context);
    const options = {
      item: nativeItem(action),
      target: gm ? targetActorDocument(target) : null,
      extraRollOptions: safeRollOptions(context, action, target),
    };
    const result = normalizedActionFacts(action).resolution.saveStat
      ? savePreflight(context, actor, target, action, options)
      : skillCheckLike(action)
        ? checkPreflight(context, actor, target, action, options)
        : attackLike(action)
          ? attackPreflight(context, actor, target, action, options)
          : checkPreflight(context, actor, target, action, options);
    return result ?? { available: false, status: "unsupported", scoreApplied: false };
  } catch (error) {
    return {
      available: false,
      status: "error",
      scoreApplied: false,
      error: String(error?.message ?? error),
    };
  }
}
