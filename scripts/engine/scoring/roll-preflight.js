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
  return String(action?.slug ?? action?.id ?? "").trim().toLowerCase();
}

function actionTraits(action) {
  return [...new Set([
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ].map((trait) => String(trait?.slug ?? trait?.name ?? trait).trim().toLowerCase()).filter(Boolean))];
}

function nativeItem(action) {
  const item = action?.item ?? action?.strike?.item ?? action?.generatedAction?.item ?? null;
  return item && typeof item.getRollOptions === "function" ? item : null;
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
  return action?.source === "strike"
    || action?.attackTrait === true
    || action?.activityProfile?.spellAttack === true
    || actionTraits(action).includes("attack");
}

function skillCheckLike(action) {
  const statisticSlug = String(action?.skill ?? action?.statistic ?? "").trim();
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
}) {
  const odds = Number.isFinite(dc) ? degreeDistribution(modifier, dc) : null;
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
  const tooltip = [
    reason,
    breakdownText,
    approximate ? t("Preflight.ApproximateIntel", "Target DC uses revealed approximate Intel.") : "",
    t("Preflight.InformationalOnly", "Informational only; does not change Auto-fill ranking."),
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
    successChance,
    effectChance,
    modifiers,
    breakdown,
    label,
    reason,
    tooltip,
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
  const statisticLabel = action?.source === "strike"
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
  });
}

function savePreflight(context, actor, target, action, options) {
  const saveSlug = String(action?.saveProfile?.stat ?? "").trim().toLowerCase();
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
    const result = action?.saveProfile?.stat
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
