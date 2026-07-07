import { collectionValues } from "../foundry-data.js";
import { slugify } from "../engine/action/text.js";
import { t } from "../i18n.js";
import { readActionCost } from "./item-action-reader.js";
import { uniqueTargets } from "./action/reader-helpers.js";
import { actionCanReach, canStrikeTargetFromCurrentPosition } from "./action/reach.js";

function availability(available, reason) {
  return { available, reason };
}

function generatedStrikeAvailability(context, action) {
  if (!context) return availability(true, "");

  const targets = uniqueTargets(context).filter((target) => actionCanReach(action, target));
  if (!targets.length) return availability(false, t("Avail.NoTargetInRange", "No target in range."));

  const target = targets.find((candidate) => canStrikeTargetFromCurrentPosition(context, action, candidate));
  if (target) return { ...availability(true, ""), target };

  return availability(false, t("Avail.AttackPathBlocked", "Attack path to target is blocked."));
}

function actorLevel(actor) {
  const value = Number(actor?.level ?? actor?.system?.details?.level?.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function elementalBlastItem(actor) {
  return collectionValues(actor?.itemTypes?.action)
    .find((item) => slugify(item?.slug ?? item?.system?.slug ?? item?.name) === "elemental-blast")
    ?? null;
}

function kineticistBlastFlag(actor) {
  const flag = actor?.flags?.pf2e?.kineticist?.elementalBlast;
  return flag && typeof flag === "object" ? flag : null;
}

function elementalBlastConfigs(actor) {
  const flag = kineticistBlastFlag(actor);
  if (!flag) return [];
  return Object.values(flag)
    .filter((entry) => entry && typeof entry === "object" && typeof entry.element === "string");
}

export function actorHasElementalBlastConfigs(actor) {
  return elementalBlastConfigs(actor).length > 0;
}

function selectedElementalDamageType(item, config, infusion) {
  const configured = item?.flags?.pf2e?.damageSelections?.[config.element];
  const values = [
    configured,
    ...(Array.isArray(infusion?.damageTypes) ? infusion.damageTypes : []),
    ...(Array.isArray(config.damageTypes) ? config.damageTypes : []),
  ].filter(Boolean);
  return String(values[0] ?? "untyped").toLowerCase();
}

function selectedElementalBlastActionCost(item) {
  const selected = Number(item?.flags?.pf2e?.rulesSelections?.actionCost);
  if (selected === 1 || selected === 2) return selected;

  const parsed = readActionCost(item);
  const value = Number(parsed.actionCost);
  return value === 2 ? 2 : 1;
}

function elementalBlastActionCosts(item) {
  const selected = selectedElementalBlastActionCost(item);
  return [selected, ...[1, 2].filter((cost) => cost !== selected)];
}

function elementalBlastAverage(actor, config, actionCost) {
  const dieFaces = Number(config?.dieFaces);
  if (!Number.isFinite(dieFaces) || dieFaces <= 0) return null;

  // Coarse ordering estimate only. PF2e still executes exact blast damage.
  const dice = Math.max(1, Math.ceil(actorLevel(actor) / 4));
  const actionBonus = actionCost >= 2 ? dice : 0;
  return dice * ((dieFaces + 1) / 2) + actionBonus;
}

function titleCaseWords(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function localizeLabel(value) {
  const label = String(value ?? "").trim();
  if (!label) return null;

  const i18n = globalThis.game?.i18n;
  if (
    typeof i18n?.has === "function"
    && typeof i18n.localize === "function"
    && i18n.has(label)
  ) {
    const localized = String(i18n.localize(label) ?? "").trim();
    if (localized && localized !== label) return localized;
  }

  return label.startsWith("PF2E.") ? null : label;
}

function elementalBlastLabel(config) {
  const label = localizeLabel(config?.label);
  if (label) return label;

  const element = String(config?.element ?? "").trim();
  const elementLabel = titleCaseWords(element || "element");
  const key = `PF2E.SpecificRule.Kineticist.Impulse.ElementalBlast.Label.${elementLabel}`;
  return localizeLabel(key) ?? t("Action.ElementalBlastNamed", "Elemental Blast ({element})", { element: elementLabel });
}

function elementalBlastModeLabel(baseLabel, mode, actionCost) {
  const modeLabel = t(`Mode.${mode}`, mode);
  return actionCost === 2
    ? t("Action.ElementalBlast2", "{base} ({mode}, 2 actions)", { base: baseLabel, mode: modeLabel })
    : t("Action.ElementalBlast1", "{base} ({mode})", { base: baseLabel, mode: modeLabel });
}

export function readElementalBlastActions(actor, context) {
  const item = elementalBlastItem(actor);
  const configs = elementalBlastConfigs(actor);
  if (!item || !configs.length) return [];

  const infusion = kineticistBlastFlag(actor)?.infusion;
  const actionCosts = elementalBlastActionCosts(item);

  return configs.flatMap((config) => {
    const damageType = selectedElementalDamageType(item, config, infusion);
    const element = slugify(config.element);
    const label = elementalBlastLabel(config);
    const rangedIncrement = Number(infusion?.range?.increment);
    const rangedMax = Number(infusion?.range?.max ?? config.range);
    const rangedRange = Number.isFinite(rangedIncrement) && rangedIncrement > 0
      ? { increment: rangedIncrement, max: rangedIncrement * 6 }
      : { max: Number.isFinite(rangedMax) && rangedMax > 0 ? rangedMax : 30 };

    return actionCosts.flatMap((actionCost) => {
      const averageDamage = elementalBlastAverage(actor, config, actionCost);
      const commonTraits = [
        "attack",
        "impulse",
        "kineticist",
        element,
        damageType,
      ].filter(Boolean);
      const common = {
        slug: "strike",
        tacticSlug: "elemental-blast",
        actionCost,
        source: "strike",
        confidence: "medium",
        executable: "open-item",
        detected: true,
        item: null,
        elementalBlastItem: item,
        elementalBlastConfig: config,
        elementalBlastActionCost: actionCost,
        attackTrait: true,
        damageProfile: {
          average: averageDamage,
          type: damageType,
          types: [damageType],
        },
        averageDamage,
        traits: commonTraits,
        variants: [],
        reasons: [t("Reason.ElementalBlast", "Elemental Blast is available.")],
      };

      return [{
        ...common,
        id: `elemental-blast-${element}-${damageType}-melee-${actionCost}a`,
        name: elementalBlastModeLabel(label, "melee", actionCost),
        range: { max: 5 },
        traits: [
          ...commonTraits,
          ...(Array.isArray(infusion?.traits?.melee) ? infusion.traits.melee : []),
        ],
      }, {
        ...common,
        id: `elemental-blast-${element}-${damageType}-ranged-${actionCost}a`,
        name: elementalBlastModeLabel(label, "ranged", actionCost),
        range: rangedRange,
        traits: [
          ...commonTraits,
          ...(Array.isArray(infusion?.traits?.ranged) ? infusion.traits.ranged : []),
        ],
      }].map((action) => {
        const availability = generatedStrikeAvailability(context, action);
        return {
          ...action,
          available: availability.available,
          unavailableReason: availability.reason,
          preferredTarget: availability.target,
        };
      });
    });
  });
}
