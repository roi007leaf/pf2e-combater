import { MODULE_ID } from "../constants.js";
import { entityKey } from "../foundry-data.js";
import { t } from "../i18n.js";

export const INTEL_LEDGER_FLAG = "intelLedger";
export const INTEL_REVEAL_MODE_FLAG = "intelRevealMode";
export const INTEL_FALSE_INFORMATION_FLAG = "intelFalseInformation";
export const INTEL_REVEAL_MODES = {
  exact: "exact",
  band: "band",
};

export const INTEL_LEDGER_CATEGORIES = [
  { id: "identity", label: "Identity" },
  { id: "traits", label: "Traits" },
  { id: "saves", label: "Saves" },
  { id: "perception", label: "Perception" },
  { id: "weaknesses", label: "Weaknesses" },
  { id: "resistances", label: "Resistances" },
  { id: "immunities", label: "Immunities" },
];

const CATEGORY_IDS = new Set(INTEL_LEDGER_CATEGORIES.map((entry) => entry.id));
export const NONE_FACT_ID = "__none";
const CREATURE_IDENTIFICATION_TRAITS = new Set([
  "aberration",
  "animal",
  "astral",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "dream",
  "elemental",
  "ethereal",
  "fey",
  "fiend",
  "fungus",
  "humanoid",
  "monitor",
  "ooze",
  "plant",
  "shade",
  "spirit",
  "time",
  "undead",
]);

const SAVE_MODERATE_DCS_BY_LEVEL = new Map([
  [-1, 13],
  [0, 16],
  [1, 17],
  [2, 19],
  [3, 21],
  [4, 22],
  [5, 24],
  [6, 25],
  [7, 27],
  [8, 28],
  [9, 30],
  [10, 31],
  [11, 33],
  [12, 35],
  [13, 36],
  [14, 38],
  [15, 39],
  [16, 40],
  [17, 42],
  [18, 43],
  [19, 45],
  [20, 46],
  [21, 48],
  [22, 49],
  [23, 51],
  [24, 52],
  [25, 54],
]);

const INTEL_BAND_LABELS = {
  low: "Low",
  mid: "Mid",
  high: "High",
};

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function intelFactId(value) {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "unknown";
}

function targetActor(target) {
  const actor = target?.actor?.document ?? target?.actor?.object ?? target?.actor;
  return actor && typeof actor === "object" ? actor : null;
}

function actorType(actor) {
  return String(actor?.type ?? actor?.document?.type ?? "").toLowerCase();
}

export function isNpcIntelTarget(target) {
  return actorType(targetActor(target)) === "npc";
}

function targetIdentityValues(target) {
  const actor = targetActor(target);
  const token = target?.token?.document ?? target?.token ?? target?.document ?? target;
  return [
    target?.id,
    target?.uuid,
    token?.id,
    token?.uuid,
    token?.object?.id,
    token?.object?.uuid,
    token?.document?.id,
    token?.document?.uuid,
    actor?.id,
    actor?.uuid,
  ].filter(Boolean).map(String);
}

export function intelTargetKey(target) {
  return targetIdentityValues(target)[0] ?? "";
}

export function intelTargetMatchesKey(target, key) {
  const value = String(key ?? "");
  return Boolean(value) && targetIdentityValues(target).includes(value);
}

function readFlag(actor) {
  if (actor?.intelLedger !== undefined) return actor.intelLedger;
  const direct = actor?.flags?.[MODULE_ID]?.[INTEL_LEDGER_FLAG];
  if (direct !== undefined) return direct;
  if (typeof actor?.getFlag === "function") return actor.getFlag(MODULE_ID, INTEL_LEDGER_FLAG);
  return null;
}

function readRevealModeFlag(actorOrTarget) {
  if (actorOrTarget?.intelRevealMode !== undefined) return actorOrTarget.intelRevealMode;
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  if (actor?.intelRevealMode !== undefined) return actor.intelRevealMode;
  const direct = actor?.flags?.[MODULE_ID]?.[INTEL_REVEAL_MODE_FLAG];
  if (direct !== undefined) return direct;
  if (typeof actor?.getFlag === "function") return actor.getFlag(MODULE_ID, INTEL_REVEAL_MODE_FLAG);
  return null;
}

function readFalseInformationFlag(actorOrTarget) {
  const actor = targetActor(actorOrTarget) ?? actorOrTarget;
  if (actor?.intelFalseInformation !== undefined) return actor.intelFalseInformation;
  const direct = actor?.flags?.[MODULE_ID]?.[INTEL_FALSE_INFORMATION_FLAG];
  if (direct !== undefined) return direct;
  if (typeof actor?.getFlag === "function") return actor.getFlag(MODULE_ID, INTEL_FALSE_INFORMATION_FLAG);
  return null;
}

export function normalizeIntelFalseInformation(value) {
  return (Array.isArray(value) ? value : []).flatMap((entry, index) => {
    const text = String(entry?.text ?? (typeof entry === "string" ? entry : "")).trim();
    const factId = String(entry?.factId ?? "").trim();
    const factLabel = String(entry?.factLabel ?? "").trim();
    const numericValue = Number(entry?.value);
    const hasValue = entry?.value !== "" && entry?.value !== null && entry?.value !== undefined && Number.isFinite(numericValue);
    const valueNumber = hasValue && numericValue >= 0 ? numericValue : null;
    const category = CATEGORY_IDS.has(String(entry?.category ?? "")) ? String(entry.category) : "traits";
    if (!text && !factId) return [];
    let label = String(entry?.label ?? "").trim();
    if (factId) {
      if (category === "saves" || category === "perception") label = `${factLabel || titleCase(factId)}${valueNumber === null ? "" : ` DC ${valueNumber}`}`;
      else if (category === "weaknesses" || category === "resistances") label = `${factLabel || titleCase(factId)}${valueNumber === null ? "" : ` ${valueNumber}`}`;
      else label = factLabel || titleCase(factId) || text;
    } else if (!label) label = text;
    return [{
      id: String(entry?.id ?? `false-${index}`),
      text,
      factId,
      factLabel,
      value: valueNumber,
      label,
      sourceActorUuid: String(entry?.sourceActorUuid ?? ""),
      sourceActorName: String(entry?.sourceActorName ?? ""),
      category,
      question: String(entry?.question ?? ""),
      attempt: Math.max(1, Number(entry?.attempt) || 1),
      createdAt: String(entry?.createdAt ?? ""),
      revealed: entry?.revealed !== false,
    }];
  });
}

export function readIntelFalseInformation(actorOrTarget) {
  return normalizeIntelFalseInformation(readFalseInformationFlag(actorOrTarget));
}

// Shared by saveFactLabel/defenseLabel/falseInformationDisplayLabel below, which each used to
// format this same "{label}: {band}" string inline wherever a band was found.
function bandedFactLabel(label, band) {
  return band?.label ? t("Intel.BandedFact", "{label}: {band}", { label, band: band.label }) : null;
}

function falseInformationDisplayLabel(record, target, revealMode) {
  const label = record.factLabel || titleCase(record.factId) || record.label || record.text;
  if (record.value === null || revealMode !== INTEL_REVEAL_MODES.band) return record.label || record.text;
  if (record.category === "saves" || record.category === "perception") {
    return bandedFactLabel(label, intelSaveBand(record.value, target)) ?? (record.label || record.text);
  }
  if (record.category === "weaknesses" || record.category === "resistances") {
    return bandedFactLabel(label, intelDefenseValueBand(record.value, target)) ?? (record.label || record.text);
  }
  return record.label || record.text;
}

function normalizeFactIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .map((entry) => entry === NONE_FACT_ID ? NONE_FACT_ID : intelFactId(entry)))];
}

function normalizeCategoryValue(value) {
  if (value === true) return true;
  const factIds = Array.isArray(value) ? normalizeFactIds(value) : normalizeFactIds(value?.facts ?? value?.values ?? []);
  return factIds.length ? factIds : false;
}

export function normalizeIntelLedger(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = Object.fromEntries(
    INTEL_LEDGER_CATEGORIES.map((category) => [category.id, normalizeCategoryValue(source[category.id])]),
  );
  if (!source.perception && Array.isArray(normalized.saves) && normalized.saves.includes("perception")) {
    normalized.perception = ["perception"];
    normalized.saves = normalized.saves.filter((entry) => entry !== "perception");
    if (!normalized.saves.length) normalized.saves = false;
  }
  return normalized;
}

export function readIntelLedger(actor) {
  return normalizeIntelLedger(readFlag(actor));
}

export function normalizeIntelRevealMode(value) {
  return value === INTEL_REVEAL_MODES.band ? INTEL_REVEAL_MODES.band : INTEL_REVEAL_MODES.exact;
}

export function readIntelRevealMode(actorOrTarget) {
  return normalizeIntelRevealMode(readRevealModeFlag(actorOrTarget));
}

export function canUseIntelCategory(context, target, category) {
  if (!CATEGORY_IDS.has(category)) return false;
  if (!isNpcIntelTarget(target)) return false;
  if (target?.intelLedger !== undefined) {
    const value = normalizeIntelLedger(target.intelLedger)[category];
    return value === true || (Array.isArray(value) && value.length > 0);
  }
  const actor = targetActor(target);
  if (!actor) return false;
  const value = readIntelLedger(actor)[category];
  return value === true || (Array.isArray(value) && value.length > 0);
}

export function canUseIntelFact(context, target, category, factId) {
  if (!CATEGORY_IDS.has(category)) return false;
  if (!isNpcIntelTarget(target)) return false;
  const ledger = target?.intelLedger !== undefined
    ? normalizeIntelLedger(target.intelLedger)
    : readIntelLedger(targetActor(target));
  const value = ledger[category];
  if (value === true) return true;
  if (!Array.isArray(value) || !value.length) return false;
  return normalizeFactIds(factId).some((id) => value.includes(id));
}

export function intelCategoryLabel(category) {
  return INTEL_LEDGER_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

function defenseEntries(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value === "object") return Object.values(value);
  return [];
}

function actorTraitSlugs(actor) {
  const value = actor?.system?.traits?.value;
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

export function intelIdentityTrait(target) {
  const actor = targetActor(target) ?? target;
  const traits = target?.traits ?? target?.traitSlugs ?? actorTraitSlugs(actor);
  return (Array.isArray(traits) ? traits : [])
    .map((trait) => String(trait ?? "").toLowerCase())
    .find((trait) => CREATURE_IDENTIFICATION_TRAITS.has(trait)) ?? null;
}

function actorSaves(actor) {
  const saves = actor?.system?.saves ?? {};
  return {
    fortitude: saves.fortitude?.dc ?? null,
    reflex: saves.reflex?.dc ?? null,
    will: saves.will?.dc ?? null,
  };
}

function actorPerception(actor) {
  const perception = actor?.system?.perception ?? {};
  return perception.dc?.value ?? perception.dc ?? null;
}

function actorDefense(actor, category) {
  return actor?.system?.attributes?.[category] ?? actor?.system?.[category] ?? null;
}

function targetLevel(target) {
  const actor = targetActor(target) ?? target?.actor ?? target;
  const value = Number(
    target?.level
      ?? actor?.level
      ?? actor?.system?.details?.level?.value
      ?? actor?.system?.details?.level,
  );
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function expectedSaveDc(level) {
  const rounded = Math.round(Number(level));
  if (SAVE_MODERATE_DCS_BY_LEVEL.has(rounded)) return SAVE_MODERATE_DCS_BY_LEVEL.get(rounded);
  if (rounded < -1) return SAVE_MODERATE_DCS_BY_LEVEL.get(-1);
  const highestLevel = 25;
  return SAVE_MODERATE_DCS_BY_LEVEL.get(highestLevel) + ((rounded - highestLevel) * 2);
}

function expectedDefenseValue(level) {
  const rounded = Math.round(Number(level));
  if (rounded <= 1) return 3;
  if (rounded <= 4) return 5;
  if (rounded <= 8) return 7;
  if (rounded <= 12) return 10;
  if (rounded <= 16) return 15;
  if (rounded <= 20) return 20;
  return 25;
}

function valueBand(value, expected) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number <= Math.max(1, Math.floor(expected * 0.67))) return "low";
  if (number >= Math.ceil(expected * 1.34)) return "high";
  return "mid";
}

function bandLabel(band) {
  return INTEL_BAND_LABELS[band] ?? INTEL_BAND_LABELS.mid;
}

export function intelSaveBand(value, target) {
  const dc = Number(value);
  if (!Number.isFinite(dc)) return null;
  const expected = expectedSaveDc(targetLevel(target));
  const band = dc <= expected - 3 ? "low" : dc >= expected + 3 ? "high" : "mid";
  return {
    id: band,
    label: bandLabel(band),
    approximateDc: band === "low" ? expected - 4 : band === "high" ? expected + 4 : expected,
  };
}

export function intelDefenseValueBand(value, target) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const expected = expectedDefenseValue(targetLevel(target));
  const band = valueBand(amount, expected) ?? "mid";
  return {
    id: band,
    label: bandLabel(band),
    approximateValue: band === "low"
      ? Math.max(1, Math.floor(expected * 0.67))
      : band === "high"
        ? Math.ceil(expected * 1.5)
        : expected,
  };
}

export function bandedIntelDefenseEntry(entry, target, { showValue = true } = {}) {
  if (!showValue) return entry;
  const band = intelDefenseValueBand(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier, target);
  if (!band) return entry;
  return {
    ...entry,
    value: band.approximateValue,
    intelBand: band.id,
    intelBandLabel: band.label,
    exactValueHidden: true,
  };
}

function exactDefenseLabel(entry, { showValue = true } = {}) {
  const type = entry?.type?.value ?? entry?.type ?? entry?.slug?.value ?? entry?.slug ?? entry?.label ?? entry?.name;
  const label = titleCase(type || t("Intel.UnknownType", "Unknown"));
  const value = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  return showValue && Number.isFinite(value) && value > 0 ? `${label} ${value}` : label;
}

function defenseLabel(entry, { showValue = true, revealMode = INTEL_REVEAL_MODES.exact, target = null } = {}) {
  const label = exactDefenseLabel(entry, { showValue: false });
  const value = Number(entry?.value ?? entry?.amount ?? entry?.total ?? entry?.modifier);
  if (showValue && revealMode === INTEL_REVEAL_MODES.band && Number.isFinite(value) && value > 0) {
    const knownBand = entry?.intelBandLabel ? { label: entry.intelBandLabel } : intelDefenseValueBand(value, target);
    return bandedFactLabel(label, knownBand) ?? label;
  }
  return exactDefenseLabel(entry, { showValue });
}

export function intelDefenseFactId(entry, { showValue = true } = {}) {
  return intelFactId(exactDefenseLabel(entry, { showValue }));
}

export function intelTraitFactId(trait) {
  return intelFactId(trait);
}

function fact(id, label, extra = {}) {
  return { id: id === NONE_FACT_ID ? NONE_FACT_ID : intelFactId(id), label, ...extra };
}

function saveFactLabel(label, value, enemy, revealMode, knownBand = null) {
  if (revealMode === INTEL_REVEAL_MODES.band) {
    const banded = bandedFactLabel(label, knownBand) ?? bandedFactLabel(label, intelSaveBand(value, enemy));
    if (banded) return banded;
  }
  return t("Intel.SaveDc", "{save} DC {dc}", { save: label, dc: value });
}

function saveFacts(enemy, { revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  const actor = targetActor(enemy);
  const saves = enemy?.saves ?? actorSaves(actor);
  const entries = [];
  for (const [key, label] of [
    ["fortitude", "Fortitude"],
    ["reflex", "Reflex"],
    ["will", "Will"],
  ]) {
    const value = Number(saves?.[key]?.dc ?? saves?.[key]);
    const knownBand = enemy?.intelSaveBands?.[key] ?? null;
    if (Number.isFinite(value)) {
      entries.push(fact(key, saveFactLabel(label, value, enemy, revealMode, knownBand), {
        exactLabel: saveFactLabel(label, value, enemy, INTEL_REVEAL_MODES.exact),
        bandLabel: saveFactLabel(label, value, enemy, INTEL_REVEAL_MODES.band, knownBand),
      }));
    }
  }
  return entries;
}

function perceptionFacts(enemy, { revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  const actor = targetActor(enemy);
  const perception = Number(enemy?.perceptionDC ?? enemy?.perception?.dc ?? actorPerception(actor));
  if (Number.isFinite(perception)) {
    const label = t("Intel.Perception", "Perception");
    const knownBand = enemy?.intelPerceptionBand ?? enemy?.perception?.intelBand ?? null;
    return [fact("perception", saveFactLabel(label, perception, enemy, revealMode, knownBand), {
      exactLabel: saveFactLabel(label, perception, enemy, INTEL_REVEAL_MODES.exact),
      bandLabel: saveFactLabel(label, perception, enemy, INTEL_REVEAL_MODES.band, knownBand),
    })];
  }
  return [];
}

function traitFacts(enemy) {
  const traits = enemy?.traits ?? enemy?.traitSlugs ?? actorTraitSlugs(targetActor(enemy));
  return (Array.isArray(traits) ? traits : [])
    .map((trait) => {
      const label = titleCase(trait);
      return fact(intelTraitFactId(trait), label, { exactLabel: label, bandLabel: label });
    })
    .filter((entry) => entry.label);
}

function identityFacts(enemy) {
  const actor = targetActor(enemy);
  const name = String(enemy?.identityName ?? actor?.name ?? "").trim();
  if (!name) return [];
  const category = intelIdentityTrait(enemy);
  const label = category ? `${name} (${titleCase(category)})` : name;
  return [fact("identity", label, { exactLabel: label, bandLabel: label })];
}

function defenseFacts(enemy, category, { showValue = true, revealMode = INTEL_REVEAL_MODES.exact } = {}) {
  return defenseEntries(enemy?.[category] ?? actorDefense(targetActor(enemy), category))
    .map((entry) => fact(intelDefenseFactId(entry, { showValue }), defenseLabel(entry, { showValue, revealMode, target: enemy }), {
      exactLabel: defenseLabel(entry, { showValue, revealMode: INTEL_REVEAL_MODES.exact, target: enemy }),
      bandLabel: defenseLabel(entry, { showValue, revealMode: INTEL_REVEAL_MODES.band, target: enemy }),
    }));
}

function availableIntelFacts(enemy, { revealMode = readIntelRevealMode(enemy) } = {}) {
  return {
    identity: identityFacts(enemy),
    traits: traitFacts(enemy),
    saves: saveFacts(enemy, { revealMode }),
    perception: perceptionFacts(enemy, { revealMode }),
    weaknesses: defenseFacts(enemy, "weaknesses", { revealMode }),
    resistances: defenseFacts(enemy, "resistances", { revealMode }),
    immunities: defenseFacts(enemy, "immunities", { showValue: false, revealMode }),
  };
}

function availableIntelDetails(enemy, options) {
  const facts = availableIntelFacts(enemy, options);
  return Object.fromEntries(Object.entries(facts).map(([category, entries]) => [
    category,
    entries.map((entry) => entry.label),
  ]));
}

function selectedFacts(available, value) {
  const none = [t("Intel.None", "None")];
  if (value === true) return available.length ? available : [fact(NONE_FACT_ID, none[0])];
  if (!Array.isArray(value) || !value.length) return [];
  if (!available.length && value.includes(NONE_FACT_ID)) return [fact(NONE_FACT_ID, none[0])];
  return available.filter((entry) => value.includes(entry.id));
}

function revealedIntelFacts(availableFacts, values) {
  const known = (category) => selectedFacts(availableFacts[category] ?? [], values[category]);
  return {
    identity: known("identity"),
    traits: known("traits"),
    saves: known("saves"),
    perception: known("perception"),
    weaknesses: known("weaknesses"),
    resistances: known("resistances"),
    immunities: known("immunities"),
  };
}

function revealedIntelDetails(availableFacts, values) {
  const revealed = revealedIntelFacts(availableFacts, values);
  return Object.fromEntries(Object.entries(revealed).map(([category, entries]) => [
    category,
    entries.map((entry) => entry.label),
  ]));
}

function revealedCount(details) {
  return Object.values(details ?? {}).reduce((total, values) => total + (Array.isArray(values) && values.length ? 1 : 0), 0);
}

function ledgerCount(value) {
  if (value === true) return 1;
  return Array.isArray(value) ? value.length : 0;
}

function tokenName(target) {
  const token = target?.token;
  return target?.displayName
    ?? token?.displayName
    ?? token?.name
    ?? token?.object?.name
    ?? token?.document?.name
    ?? null;
}

function targetName(target, actor, isGM, values) {
  const identityKnown = values?.identity === true
    || (Array.isArray(values?.identity) && values.identity.length > 0);
  if (!isGM && identityKnown && actor?.name) return actor.name;
  return tokenName(target)
    ?? target?.name
    ?? (isGM ? actor?.name : null)
    ?? t("Intel.UnknownTarget", "Unknown target");
}

export function intelLedgerView(context) {
  const enemies = (context?.intelTargets ?? context?.battlefield?.enemies ?? context?.enemies ?? [])
    .filter(isNpcIntelTarget);
  const isGM = typeof context?.isGM === "boolean" ? context.isGM : globalThis.game?.user?.isGM === true;
  const viewerIsGM = globalThis.game?.user?.isGM === true;
  const canSeeExactIntelLabels = isGM || viewerIsGM;
  const entries = enemies.map((enemy) => {
    const actor = targetActor(enemy);
    const values = normalizeIntelLedger(enemy?.intelLedger ?? readIntelLedger(actor));
    const revealMode = readIntelRevealMode(enemy);
    const labelRevealMode = canSeeExactIntelLabels ? INTEL_REVEAL_MODES.exact : revealMode;
    const availableFacts = availableIntelFacts(enemy, { revealMode: labelRevealMode });
    const available = availableIntelDetails(enemy, { revealMode: labelRevealMode });
    const revealedFacts = revealedIntelFacts(availableFacts, values);
    const revealed = revealedIntelDetails(availableFacts, values);
    const falseInformation = readIntelFalseInformation(actor);
    const playerRevealed = isGM ? revealed : Object.fromEntries(
      INTEL_LEDGER_CATEGORIES.map(({ id }) => [
        id,
        [
          ...(revealed[id] ?? []),
          ...falseInformation
            .filter((record) => record.revealed === true)
            .filter((record) => record.category === id)
            .map((record) => falseInformationDisplayLabel(record, enemy, labelRevealMode)),
        ],
      ]),
    );
    return {
      id: entityKey(enemy) ?? enemy?.id ?? enemy?.token?.id ?? enemy?.name,
      name: targetName(enemy, actor, isGM, values),
      actor,
      img: enemy?.token?.img ?? enemy?.actor?.img ?? actor?.img ?? "",
      values,
      revealMode,
      available,
      availableFacts,
      revealed: playerRevealed,
      revealedFacts,
      ...(viewerIsGM ? { falseInformation } : {}),
      hasRevealed: revealedCount(revealed) > 0 || falseInformation.some((record) => record.revealed === true),
    };
  }).filter((entry) => entry.actor || entry.hasRevealed);
  const learnedCount = entries.reduce((count, entry) => count
    + Object.values(entry.values).reduce((total, value) => total + ledgerCount(value), 0)
    + (entry.falseInformation?.length ?? 0), 0);
  const hasPlayerVisibleIntel = entries.some((entry) => entry.hasRevealed);

  return {
    visible: entries.length > 0 && (isGM || hasPlayerVisibleIntel),
    editable: isGM,
    entries,
    categories: INTEL_LEDGER_CATEGORIES,
    label: learnedCount > 0
      ? t("Intel.KnownCount", "Intel {count}", { count: learnedCount })
      : t("Intel.Label", "Intel"),
    tooltip: isGM
      ? t("Intel.Tooltip", "Mark Recall Knowledge facts learned before Auto-fill uses hidden defenses.")
      : t("Intel.PlayerTooltip", "View Recall Knowledge facts the GM has revealed."),
  };
}
