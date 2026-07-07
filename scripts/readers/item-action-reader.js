import { systemValue } from "../foundry-data.js";
import { parseActionText, slugify } from "../engine/action/text.js";
import { t } from "../i18n.js";

const ACTION_ITEM_TYPES = new Set(["action", "feat", "feature", "consumable"]);
const ACTIVATABLE_ITEM_TYPES = new Set([
  ...ACTION_ITEM_TYPES,
  "ammo",
  "armor",
  "backpack",
  "book",
  "equipment",
  "weapon",
]);
const ACTIVATION_WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
};
const ACTION_GLYPHS = {
  A: 1,
  D: 2,
  T: 3,
  F: 0,
  R: "reaction",
};

function descriptionHtml(item) {
  return String(systemValue(item?.system?.description) ?? item?.system?.description?.value ?? "");
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function htmlToText(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeActivationText(value) {
  return normalizeWhitespace(
    String(value ?? "")
      .replace(/&mdash;|&ndash;|[\u2013\u2014]/g, " \u2014 "),
  );
}

function hasExplicitActionValue(value) {
  const raw = systemValue(value);
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

function defaultItemActionCostOnly(item, actionType, actions) {
  const type = String(systemValue(actionType) ?? "").toLowerCase();
  if (type !== "action") return false;
  if (hasExplicitActionValue(actions)) return false;
  return !["action", "feat", "feature"].includes(item?.type);
}

export function isActivatableItem(item) {
  return ACTIVATABLE_ITEM_TYPES.has(item?.type);
}

export function readActionCost(item) {
  const getterCost = item?.actionCost;
  const getterType = systemValue(getterCost?.type);
  const getterValue = systemValue(getterCost?.value);
  if (getterType) {
    const parsedGetter = parseActionCost(getterType, getterValue);
    if (parsedGetter.actionCost !== null) return withConsumableInteractCost(item, parsedGetter);
  }

  const actionType = systemValue(item?.system?.actionType);
  const actions = systemValue(item?.system?.actions);
  const parsed = parseActionCost(actionType, actions);
  if (parsed.actionCost !== null && !defaultItemActionCostOnly(item, actionType, actions)) {
    return withConsumableInteractCost(item, parsed);
  }

  const activationCost = readActivationActionCost(item);
  if (activationCost) return withConsumableInteractCost(item, activationCost);

  return withConsumableInteractCost(item, defaultItemActionCostOnly(item, actionType, actions)
    ? { actionCost: null, type: "unknown", passive: false }
    : parsed);
}

export function readItemAvailability(item) {
  if (!item) return { available: false, reason: t("Avail.MissingItem", "Missing item.") };
  if (item.disabled === true || item.system?.disabled === true || item.system?.enabled === false) {
    return { available: false, reason: t("Avail.ItemDisabled", "Item is disabled.") };
  }

  const quantity = Number(systemValue(item.system?.quantity));
  if (item.type === "consumable" && Number.isFinite(quantity) && quantity <= 0) {
    return { available: false, reason: t("Avail.ConsumableZero", "Consumable quantity is 0.") };
  }

  const usesValue = Number(systemValue(item.system?.uses));
  const usesMax = Number(systemValue(item.system?.uses?.max ?? item.system?.uses?.maximum));
  if (Number.isFinite(usesValue) && (!Number.isFinite(usesMax) || usesMax > 0) && usesValue <= 0) {
    return { available: false, reason: t("Avail.NoUses", "No uses remaining.") };
  }

  const frequencyCurrent = Number(systemValue(
    item.system?.frequency?.value
    ?? item.system?.frequency?.current
    ?? item.system?.frequency?.remaining,
  ));
  if (Number.isFinite(frequencyCurrent) && frequencyCurrent <= 0) {
    return { available: false, reason: t("Avail.FrequencySpent", "Frequency is spent.") };
  }

  if (hasUnevaluatedPredicate(item)) {
    return { available: false, reason: t("Avail.UnevaluatedPredicate", "Action has unevaluated PF2e predicate.") };
  }

  return { available: true, reason: "" };
}

// Only the item's own system.predicate gates whether the action can be taken. A
// rule-element predicate merely gates when that rule's effect applies, not the
// action's usability.
function hasUnevaluatedPredicate(item) {
  const predicate = item.system?.predicate;
  if (Array.isArray(predicate)) return predicate.length > 0;
  return Boolean(predicate && typeof predicate === "object" && Object.keys(predicate).length > 0);
}

export function parseActionCost(type, value) {
  const normalizedType = String(type ?? "").toLowerCase();
  if (normalizedType === "passive") {
    return { actionCost: null, type: "passive", passive: true };
  }
  if (normalizedType === "free" || normalizedType === "free-action") {
    return { actionCost: 0, type: "free", passive: false };
  }
  if (normalizedType === "reaction") {
    return { actionCost: "reaction", type: "reaction", passive: false };
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 3) {
    return { actionCost: numeric, type: normalizedType || "action", passive: false };
  }

  const parsedText = parseActionText(value);
  if (parsedText !== null) return { actionCost: parsedText, type: "action", passive: false };
  if (normalizedType === "action") return { actionCost: 1, type: "action", passive: false };
  return { actionCost: null, type: normalizedType || "unknown", passive: false };
}

function readActivationActionCost(item) {
  const text = normalizeActivationText(htmlToText(descriptionHtml(item)));
  const match = text.match(/\bActivate\b([\s\S]{0,180})/i);
  if (!match) return null;

  const activation = match[1].trim();
  const bracket = activation.match(/\[(one-action|two-actions|three-actions|free-action|reaction)\]/i);
  if (bracket) {
    const cost = parseActivationToken(bracket[1]);
    return { actionCost: cost, type: activationType(cost), passive: false, activationInDescription: true };
  }

  const glyph = activation.match(/(?:^|\s)([123ADTRFR])(?=\s*(?:\(|Interact\b|Envision\b|Command\b|Cast\b|concentrate\b|manipulate\b|$))/i);
  if (glyph) {
    const raw = glyph[1].toUpperCase();
    const cost = /^[123]$/.test(raw) ? Number(raw) : ACTION_GLYPHS[raw];
    return { actionCost: cost, type: activationType(cost), passive: false, activationInDescription: true };
  }

  const wordCost = activation.match(/\b(one|two|three|1|2|3)[ -]actions?\b/i);
  if (wordCost) {
    const cost = ACTIVATION_WORD_NUMBERS[String(wordCost[1]).toLowerCase()] ?? Number(wordCost[1]);
    return { actionCost: cost, type: "action", passive: false, activationInDescription: true };
  }

  if (/\bfree\b/i.test(activation)) {
    return { actionCost: 0, type: "free", passive: false, activationInDescription: true };
  }
  if (/\breaction\b/i.test(activation)) {
    return { actionCost: "reaction", type: "reaction", passive: false, activationInDescription: true };
  }

  return null;
}

function parseActivationToken(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "one-action") return 1;
  if (normalized === "two-actions") return 2;
  if (normalized === "three-actions") return 3;
  if (normalized === "free-action") return 0;
  if (normalized === "reaction") return "reaction";
  return null;
}

function activationType(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  return "action";
}

function itemCarryType(item) {
  return String(item?.carryType ?? item?.system?.equipped?.carryType ?? "").toLowerCase();
}

function itemHandsHeld(item) {
  const hands = Number(item?.handsHeld ?? item?.system?.equipped?.handsHeld);
  return Number.isFinite(hands) ? hands : 0;
}

function itemUsage(item) {
  return String(systemValue(item?.system?.usage) ?? "").toLowerCase();
}

function requiresHeldConsumableUse(item) {
  return item?.type === "consumable" && itemUsage(item).includes("held");
}

function isHeldItem(item) {
  return item?.isHeld === true || itemCarryType(item) === "held" || itemHandsHeld(item) > 0;
}

function consumableInteractDrawCost(item, parsedCost) {
  if (!requiresHeldConsumableUse(item) || isHeldItem(item)) return 0;
  const actionCost = parsedCost?.actionCost;
  if (actionCost === null || actionCost === undefined) return 0;
  return Number.isFinite(Number(actionCost)) ? 1 : 0;
}

function withConsumableInteractCost(item, parsedCost) {
  const drawCost = consumableInteractDrawCost(item, parsedCost);
  if (!drawCost) return parsedCost;
  return {
    ...parsedCost,
    activationActionCost: parsedCost.actionCost,
    actionCost: Number(parsedCost.actionCost) + drawCost,
    interactDrawCost: drawCost,
  };
}

export function addConsumableInteractProfile(activityProfile, parsedCost) {
  if (!parsedCost?.interactDrawCost) return activityProfile ?? null;
  const includes = new Set(Array.isArray(activityProfile?.includes) ? activityProfile.includes : []);
  includes.add("interact");
  return {
    ...(activityProfile ?? {}),
    includes: [...includes],
    interactDraw: true,
  };
}

export function addItemTraitProfile(activityProfile, traits) {
  if (!Array.isArray(traits)) return activityProfile ?? null;
  const normalizedTraits = traits.map((trait) => slugify(trait));
  if (!normalizedTraits.includes("impulse") && !normalizedTraits.includes("overflow")) return activityProfile ?? null;
  const next = { ...(activityProfile ?? {}) };
  if (normalizedTraits.includes("impulse")) next.impulse = true;
  if (normalizedTraits.includes("overflow")) next.overflow = true;
  return {
    ...next,
  };
}
