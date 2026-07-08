import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";

export const TACTIC_PERSONALITY_FLAG = "tacticPersonality";
export const TACTIC_PERSONALITY_OVERRIDE_FLAG = "tacticPersonalityOverride";

export const TACTIC_ROLES = Object.freeze([
  { id: "auto", label: "Auto" },
  { id: "boss", label: "Boss" },
  { id: "lieutenant", label: "Lieutenant" },
  { id: "minion", label: "Minion" },
  { id: "brute", label: "Brute" },
  { id: "skirmisher", label: "Skirmisher" },
  { id: "artillery", label: "Artillery" },
  { id: "controller", label: "Controller" },
  { id: "defender", label: "Defender" },
  { id: "support", label: "Support" },
]);

export const TACTIC_TEMPERAMENTS = Object.freeze([
  { id: "auto", label: "Auto" },
  { id: "aggressive", label: "Aggressive" },
  { id: "cautious", label: "Cautious" },
  { id: "opportunist", label: "Opportunist" },
  { id: "berserker", label: "Berserker" },
  { id: "coward", label: "Coward" },
]);

export const TACTIC_ACTION_SLIDERS = Object.freeze([
  { id: "damage", label: "Damage pressure", min: -3, max: 3 },
  { id: "survival", label: "Survival/defense", min: -3, max: 3 },
  { id: "control", label: "Control/debuff", min: -3, max: 3 },
  { id: "mobility", label: "Mobility/positioning", min: -3, max: 3 },
  { id: "support", label: "Support/allies", min: -3, max: 3 },
  { id: "reaction", label: "Reaction/trigger value", min: -3, max: 3 },
]);

export const TACTIC_TARGET_SLIDERS = Object.freeze([
  { id: "finishWounded", label: "Finish wounded", min: -3, max: 3 },
  { id: "pressureSpecialists", label: "Pressure casters/healers/controllers", min: -3, max: 3 },
  { id: "punishThreats", label: "Punish immediate threats", min: -3, max: 3 },
  { id: "avoidDefenders", label: "Avoid hard defenders", min: -3, max: 3 },
  { id: "preferNearest", label: "Prefer nearest reachable", min: -3, max: 3 },
  { id: "preferObjective", label: "Prefer objective target", min: -3, max: 3 },
]);

const ROLE_IDS = new Set(TACTIC_ROLES.map((entry) => entry.id));
const TEMPERAMENT_IDS = new Set(TACTIC_TEMPERAMENTS.map((entry) => entry.id));
const ACTION_SLIDER_IDS = new Set(TACTIC_ACTION_SLIDERS.map((entry) => entry.id));
const TARGET_SLIDER_IDS = new Set(TACTIC_TARGET_SLIDERS.map((entry) => entry.id));
const MAX_TACTIC_DELTA = 44;
const CUSTOM_ACTION_STEP = 8;
const CUSTOM_TARGET_STEP = 10;

const ROLE_ACTION_WEIGHTS = {
  boss: { highImpact: 22, reaction: 10, damage: 6, control: 8, support: 4, mobility: -4 },
  lieutenant: { support: 12, control: 10, damage: 4, highImpact: 6 },
  minion: { simple: 10, support: 5, mobility: 4, highImpact: -10, reaction: -4 },
  brute: { damage: 14, grab: 12, control: 6, mobilityAttack: 8, support: -8 },
  skirmisher: { mobility: 14, mobilityAttack: 14, defense: 6, damage: 4, highImpact: -4 },
  artillery: { ranged: 14, spell: 12, damage: 8, control: 5, defense: -4, melee: -10 },
  controller: { control: 16, debuff: 14, grab: 8, damage: -4 },
  defender: { defense: 16, control: 8, support: 8, reaction: 8, damage: -4 },
  support: { support: 18, healing: 14, defense: 6, damage: -8 },
};

const TEMPERAMENT_ACTION_WEIGHTS = {
  aggressive: { damage: 14, highImpact: 8, control: 4, defense: -8, support: -4 },
  cautious: { defense: 16, mobility: 8, control: 4, damage: -8, highImpact: -4 },
  opportunist: { damage: 8, control: 8, reaction: 10, highImpact: 4 },
  berserker: { damage: 20, melee: 8, highImpact: 8, defense: -12, support: -10 },
  coward: { defense: 14, mobility: 12, control: 6, melee: -12, damage: -8 },
};

const ROLE_TARGET_WEIGHTS = {
  boss: { "healer": 10, "caster": 10, "controller": 8, "immediate-threat": 6, "finisher-target": 4, "main-defender": -4 },
  lieutenant: { "healer": 8, "controller": 8, "main-attacker": 5 },
  minion: { "immediate-threat": 8, "main-defender": -6 },
  brute: { "immediate-threat": 10, "finisher-target": 8, "main-defender": -2 },
  skirmisher: { "caster": 8, "controller": 6, "main-defender": -8 },
  artillery: { "caster": 10, "healer": 10, "controller": 8, "main-defender": -10, "immediate-threat": -4 },
  controller: { "caster": 8, "healer": 8, "main-attacker": 8, "main-defender": 4 },
  defender: { "immediate-threat": 12, "main-attacker": 10, "finisher-target": -2 },
  support: { "immediate-threat": 8, "main-attacker": 6, "main-defender": -4 },
};

const TEMPERAMENT_TARGET_WEIGHTS = {
  aggressive: { "finisher-target": 10, "healer": 6, "caster": 5, "immediate-threat": 4 },
  cautious: { "immediate-threat": 8, "main-attacker": 6, "main-defender": -8 },
  opportunist: { "finisher-target": 14, "caster": 6, "controller": 6 },
  berserker: { "finisher-target": 14, "immediate-threat": 8, "main-defender": -2 },
  coward: { "immediate-threat": -10, "main-attacker": -8, "main-defender": -8, "caster": 4, "controller": 4 },
};

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampDelta(value) {
  return Math.max(-MAX_TACTIC_DELTA, Math.min(MAX_TACTIC_DELTA, Math.round(value)));
}

function labelFor(entries, id) {
  return entries.find((entry) => entry.id === id)?.label ?? id;
}

function readFlag(document, key) {
  const doc = document?.document ?? document;
  if (!doc) return undefined;
  if (typeof doc.getFlag === "function") return doc.getFlag(MODULE_ID, key);
  return doc.flags?.[MODULE_ID]?.[key];
}

function hasFlagValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function actorType(context) {
  return String(
    context?.profile?.actorType
      ?? context?.actor?.profile?.actorType
      ?? context?.actor?.document?.type
      ?? context?.actor?.type
      ?? "",
  ).toLowerCase();
}

function isGmContext(context) {
  if (typeof context?.isGM === "boolean") return context.isGM;
  return globalThis.game?.user?.isGM === true;
}

function isNpcGmContext(context) {
  return isGmContext(context) && actorType(context) === "npc";
}

function normalizeSliderBlock(value, ids) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {};
  for (const id of ids) normalized[id] = clamp(source[id], -3, 3);
  return normalized;
}

function hasAnySliderValue(block) {
  return Object.values(block ?? {}).some((value) => Number(value) !== 0);
}

function normalizeCustom(value) {
  const source = value && typeof value === "object" ? value : {};
  const action = normalizeSliderBlock(source.action, ACTION_SLIDER_IDS);
  const target = normalizeSliderBlock(source.target, TARGET_SLIDER_IDS);
  if (!hasAnySliderValue(action) && !hasAnySliderValue(target)) return null;
  return { action, target };
}

function normalizeTactic(value) {
  if (typeof value === "string") {
    const id = normalizeId(value);
    return {
      role: ROLE_IDS.has(id) ? id : "auto",
      temperament: TEMPERAMENT_IDS.has(id) ? id : "auto",
      customEnabled: false,
      custom: null,
    };
  }

  const source = value && typeof value === "object" ? value : {};
  const role = normalizeId(source.role);
  const temperament = normalizeId(source.temperament);
  return {
    role: ROLE_IDS.has(role) ? role : "auto",
    temperament: TEMPERAMENT_IDS.has(temperament) ? temperament : "auto",
    customEnabled: source.customEnabled === true,
    custom: normalizeCustom(source.custom),
  };
}

export function resolveTacticPersonality(context) {
  const tokenRaw = readFlag(context?.token, TACTIC_PERSONALITY_OVERRIDE_FLAG);
  if (hasFlagValue(tokenRaw)) {
    return {
      ...normalizeTactic(tokenRaw),
      source: "token",
    };
  }

  const actorRaw = readFlag(context?.actor, TACTIC_PERSONALITY_FLAG);
  if (hasFlagValue(actorRaw)) {
    return {
      ...normalizeTactic(actorRaw),
      source: "actor",
    };
  }

  return { role: "auto", temperament: "auto", customEnabled: false, custom: null, source: "default" };
}

function actionRole(action, explicitRole) {
  return normalizeId(explicitRole ?? action?.curated?.role ?? action?.role);
}

function traitSet(action) {
  const traits = [
    ...(Array.isArray(action?.traits) ? action.traits : []),
    ...(Array.isArray(action?.item?.system?.traits?.value) ? action.item.system.traits.value : []),
  ];
  return new Set(traits.map((trait) => normalizeId(trait?.slug ?? trait?.name ?? trait)));
}

function actionCategories(action, explicitRole) {
  const role = actionRole(action, explicitRole);
  const traits = traitSet(action);
  const categories = new Set();
  const cost = Number(action?.actionCost ?? action?.cost);
  const source = normalizeId(action?.source);
  const slug = normalizeId(action?.slug ?? action?.id);
  const profile = action?.activityProfile ?? {};

  if (["damage", "save-damage", "area-damage", "multiattack"].includes(role) || source === "strike" || profile.includesStrike === true || action?.damageProfile) categories.add("damage");
  if (["control", "debuff", "grab", "setup"].includes(role) || profile.appliesCondition || Array.isArray(profile.appliesConditions)) categories.add("control");
  if (["debuff"].includes(role)) categories.add("debuff");
  if (role === "grab" || ["grapple", "grab"].includes(slug)) categories.add("grab");
  if (["defense", "stealth-defense"].includes(role) || ["raise-a-shield", "take-cover", "hide"].includes(slug)) categories.add("defense");
  if (["buff", "healing", "summon"].includes(role) || profile.spellBuff === true || profile.companion === true) categories.add("support");
  if (role === "healing") categories.add("healing");
  if (["mobility", "mobility-attack"].includes(role) || ["stride", "step", "crawl", "tumble-through"].includes(slug)) categories.add("mobility");
  if (role === "mobility-attack") categories.add("mobilityAttack");
  if (source === "spell" || source === "spell-inferred" || action?.spell === true || action?.item?.type === "spell") categories.add("spell");
  if (source === "strike" || traits.has("ranged") || Number(action?.range?.max ?? action?.targetingProfile?.maxRange) > 10) categories.add("ranged");
  if (source === "strike" && !categories.has("ranged")) categories.add("melee");
  if (action?.actionCost === "reaction" || role === "reaction" || profile.reaction === true) categories.add("reaction");
  if ((Number.isFinite(cost) && cost >= 2 && (categories.has("damage") || categories.has("control") || categories.has("support"))) || profile.npcFamily || profile.highImpact === true) categories.add("highImpact");
  if (Number.isFinite(cost) && cost <= 1 && !categories.has("spell")) categories.add("simple");

  return categories;
}

function addWeightedParts(parts, weights, categories) {
  for (const [category, delta] of Object.entries(weights ?? {})) {
    if (!categories.has(category)) continue;
    const value = Number(delta);
    if (Number.isFinite(value) && value !== 0) parts.push({ delta: value, category });
  }
}

function addCustomActionParts(parts, custom, categories) {
  const sliders = custom?.action ?? {};
  const mapping = {
    damage: ["damage", "highImpact"],
    survival: ["defense"],
    control: ["control", "debuff", "grab"],
    mobility: ["mobility", "mobilityAttack"],
    support: ["support", "healing"],
    reaction: ["reaction"],
  };

  for (const [slider, categoriesForSlider] of Object.entries(mapping)) {
    const value = Number(sliders[slider]) || 0;
    if (!value) continue;
    if (categoriesForSlider.some((category) => categories.has(category))) {
      parts.push({ delta: value * CUSTOM_ACTION_STEP, category: slider });
    }
  }
}

function formatTacticLabel(tactic) {
  const role = labelFor(TACTIC_ROLES, tactic.role);
  const temperament = labelFor(TACTIC_TEMPERAMENTS, tactic.temperament);
  const custom = tactic.customEnabled ? t("Tactic.Custom", "Custom") : "";
  const base = tactic.role === "auto" && tactic.temperament === "auto"
    ? t("Tactic.Auto", "Auto")
    : tactic.role === "auto"
      ? temperament
      : tactic.temperament === "auto"
        ? role
        : `${role} / ${temperament}`;
  return custom ? `${base} / ${custom}` : base;
}

function reasonFor(tactic, parts) {
  const positive = parts.filter((part) => part.delta > 0).map((part) => part.category);
  const negative = parts.filter((part) => part.delta < 0).map((part) => part.category);
  const items = [...new Set(positive.length ? positive : negative)]
    .slice(0, 2)
    .map((entry) => entry.replace(/([A-Z])/g, " $1").toLowerCase())
    .join(t("Tactic.And", " and "));
  if (!items) return "";
  const label = formatTacticLabel(tactic);
  return positive.length
    ? t("Tactic.Favors", "{label} tactic favors {items}.", { label, items })
    : t("Tactic.Deprioritizes", "{label} tactic de-prioritizes {items}.", { label, items });
}

export function tacticPersonalityAdjustment(context, action, { role = null } = {}) {
  if (!isNpcGmContext(context)) return { scoreDelta: 0, reasons: [] };
  const tactic = resolveTacticPersonality(context);
  if (tactic.role === "auto" && tactic.temperament === "auto" && !tactic.customEnabled) return { scoreDelta: 0, reasons: [] };

  const categories = actionCategories(action, role);
  const parts = [];
  addWeightedParts(parts, ROLE_ACTION_WEIGHTS[tactic.role], categories);
  addWeightedParts(parts, TEMPERAMENT_ACTION_WEIGHTS[tactic.temperament], categories);
  if (tactic.customEnabled) addCustomActionParts(parts, tactic.custom, categories);

  const scoreDelta = clampDelta(parts.reduce((total, part) => total + part.delta, 0));
  const reason = scoreDelta ? reasonFor(tactic, parts) : "";
  return {
    scoreDelta,
    reasons: reason ? [reason] : [],
  };
}

function targetRoles(profile) {
  return new Set(Array.isArray(profile?.roles) ? profile.roles : []);
}

function targetRoleWeightParts(weights, roles) {
  const parts = [];
  for (const [role, delta] of Object.entries(weights ?? {})) {
    if (!roles.has(role)) continue;
    const value = Number(delta);
    if (Number.isFinite(value) && value !== 0) parts.push({ delta: value, category: role });
  }
  return parts;
}

function targetDistance(target) {
  const distance = Number(target?.distance);
  return Number.isFinite(distance) ? distance : null;
}

function addCustomTargetParts(parts, custom, roles, target) {
  const sliders = custom?.target ?? {};
  const add = (slider, rolesForSlider, multiplier = CUSTOM_TARGET_STEP) => {
    const value = Number(sliders[slider]) || 0;
    if (!value || !rolesForSlider.some((role) => roles.has(role))) return;
    parts.push({ delta: value * multiplier, category: slider });
  };

  add("finishWounded", ["finisher-target"]);
  add("pressureSpecialists", ["caster", "healer", "controller"]);
  add("punishThreats", ["immediate-threat", "main-attacker"], 8);

  const avoidDefenders = Number(sliders.avoidDefenders) || 0;
  if (avoidDefenders && roles.has("main-defender")) parts.push({ delta: -avoidDefenders * CUSTOM_TARGET_STEP, category: "avoidDefenders" });

  const preferNearest = Number(sliders.preferNearest) || 0;
  const distance = targetDistance(target);
  if (preferNearest && Number.isFinite(distance)) {
    const distanceDelta = distance <= 10 ? 6 : distance <= 30 ? 3 : -3;
    parts.push({ delta: preferNearest * distanceDelta, category: "preferNearest" });
  }

  const preferObjective = Number(sliders.preferObjective) || 0;
  if (preferObjective && (target?.objective === true || target?.priorityTarget === true)) {
    parts.push({ delta: preferObjective * CUSTOM_TARGET_STEP, category: "preferObjective" });
  }
}

export function tacticPersonalityTargetAdjustment(context, action, { target = null, aggroProfile = null } = {}) {
  if (!isNpcGmContext(context)) return { scoreDelta: 0, reasons: [] };
  const tactic = resolveTacticPersonality(context);
  if (tactic.role === "auto" && tactic.temperament === "auto" && !tactic.customEnabled) return { scoreDelta: 0, reasons: [] };

  const roles = targetRoles(aggroProfile);
  const parts = [
    ...targetRoleWeightParts(ROLE_TARGET_WEIGHTS[tactic.role], roles),
    ...targetRoleWeightParts(TEMPERAMENT_TARGET_WEIGHTS[tactic.temperament], roles),
  ];
  if (tactic.customEnabled) addCustomTargetParts(parts, tactic.custom, roles, target);

  const scoreDelta = clampDelta(parts.reduce((total, part) => total + part.delta, 0));
  const reason = scoreDelta ? reasonFor(tactic, parts) : "";
  return {
    scoreDelta,
    reasons: reason ? [reason] : [],
  };
}

export function tacticPersonalityView(context) {
  const tactic = resolveTacticPersonality(context);
  const visible = isNpcGmContext(context) && Boolean(context?.actor);
  const label = formatTacticLabel(tactic);
  return {
    visible,
    label,
    tooltip: tactic.source === "token"
      ? t("Tactic.TokenOverrideTooltip", "Token tactic override: {label}", { label })
      : t("Tactic.ActorDefaultTooltip", "Actor tactic default: {label}", { label }),
    role: tactic.role,
    temperament: tactic.temperament,
    customEnabled: tactic.customEnabled,
    custom: tactic.custom,
    source: tactic.source,
    isOverride: tactic.source === "token",
    roles: TACTIC_ROLES,
    temperaments: TACTIC_TEMPERAMENTS,
    actionSliders: TACTIC_ACTION_SLIDERS,
    targetSliders: TACTIC_TARGET_SLIDERS,
  };
}
