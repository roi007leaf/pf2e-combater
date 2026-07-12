import { MODULE_ID } from "../constants.js";
import { actorItems, collectionValues, systemValue, traitSlugs } from "../foundry-data.js";
import { t } from "../i18n.js";

export const TACTIC_PERSONALITY_FLAG = "tacticPersonality";
export const TACTIC_PERSONALITY_OVERRIDE_FLAG = "tacticPersonalityOverride";

export const TACTIC_ROLES = Object.freeze([
  { id: "auto", label: "Auto" },
  { id: "melee-striker", label: "Melee Striker" },
  { id: "ranged-striker", label: "Ranged Striker" },
  { id: "spell-damage", label: "Spell Damage" },
  { id: "healer", label: "Healer" },
  { id: "buffer", label: "Buffer" },
  { id: "debuffer", label: "Debuffer" },
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

const PLAYER_TACTIC_ROLE_IDS = [
  "auto",
  "melee-striker",
  "ranged-striker",
  "spell-damage",
  "healer",
  "buffer",
  "debuffer",
  "defender",
  "support",
  "skirmisher",
];
const PLAYER_ONLY_TACTIC_ROLE_IDS = new Set([
  "melee-striker",
  "ranged-striker",
  "spell-damage",
  "healer",
  "buffer",
  "debuffer",
]);
const PLAYER_TACTIC_ROLE_ID_SET = new Set(PLAYER_TACTIC_ROLE_IDS);
const NPC_TACTIC_ROLE_ID_SET = new Set(
  TACTIC_ROLES
    .map((role) => role.id)
    .filter((id) => !PLAYER_ONLY_TACTIC_ROLE_IDS.has(id)),
);

export const PLAYER_TACTIC_ROLES = Object.freeze(
  PLAYER_TACTIC_ROLE_IDS
    .map((id) => TACTIC_ROLES.find((role) => role.id === id))
    .filter(Boolean),
);

export const NPC_TACTIC_ROLES = Object.freeze(
  TACTIC_ROLES.filter((role) => !PLAYER_ONLY_TACTIC_ROLE_IDS.has(role.id)),
);

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
const AUTO_ROLE_MIN_SCORE = 5;
const AUTO_TEMPERAMENT_MIN_SCORE = 4;

const ROLE_ACTION_WEIGHTS = {
  "melee-striker": { melee: 34, damage: 16, mobilityAttack: 32, highImpact: 6, ranged: -40, rangedSpell: -24, spell: -12, support: -10, healing: -12 },
  "ranged-striker": { ranged: 18, damage: 12, mobility: 4, spell: -8, melee: -12, grab: -8, defense: -2 },
  "spell-damage": { spell: 18, damage: 14, areaDamage: 14, rangedSpell: 10, meleeSpell: 8, highImpact: 8, control: -4, support: -8, healing: -10, ranged: -6 },
  healer: { healing: 22, support: 14, defense: 6, damage: -10, melee: -8 },
  buffer: { buff: 20, support: 16, spell: 8, defense: 6, healing: 4, damage: -8 },
  debuffer: { debuff: 20, control: 16, spell: 10, rangedSpell: 6, damage: -6 },
  boss: { highImpact: 22, reaction: 10, damage: 6, control: 8, support: 4, mobility: -4 },
  lieutenant: { support: 12, control: 10, damage: 4, highImpact: 6 },
  minion: { simple: 10, support: 5, mobility: 4, highImpact: -10, reaction: -4 },
  brute: { damage: 14, grab: 12, control: 6, mobilityAttack: 8, support: -8 },
  skirmisher: { mobility: 14, mobilityAttack: 14, defense: 6, damage: 4, highImpact: -4 },
  artillery: { ranged: 14, spell: 12, damage: 8, control: 5, defense: -4, melee: -10 },
  controller: { control: 16, grab: 14, mobilityAttack: 6, debuff: 4, damage: -4 },
  defender: { defense: 16, control: 8, support: 8, reaction: 8, damage: -4 },
  support: { support: 22, simple: 8, healing: 4, defense: 6, damage: -8 },
};

const TEMPERAMENT_ACTION_WEIGHTS = {
  aggressive: { damage: 14, highImpact: 8, control: 4, defense: -8, support: -4 },
  cautious: { defense: 16, mobility: 8, control: 4, damage: -8, highImpact: -4 },
  opportunist: { damage: 8, control: 8, reaction: 10, highImpact: 4 },
  berserker: { damage: 20, melee: 8, highImpact: 8, defense: -12, support: -10 },
  coward: { defense: 14, mobility: 12, control: 6, melee: -12, damage: -8 },
};

const ROLE_TARGET_WEIGHTS = {
  "melee-striker": { "immediate-threat": 8, "finisher-target": 8, "caster": 4, "main-defender": -4 },
  "ranged-striker": { "caster": 10, "healer": 8, "controller": 6, "main-defender": -8 },
  "spell-damage": { "finisher-target": 10, "caster": 6, "controller": 6, "main-defender": -6 },
  healer: { "immediate-threat": 8, "main-attacker": 6, "main-defender": -4 },
  buffer: { "main-attacker": 8, "immediate-threat": 6, "main-defender": 4 },
  debuffer: { "main-attacker": 10, "caster": 8, "controller": 6, "main-defender": -2 },
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

const ROLE_PLAN_WEIGHTS = {
  "melee-striker": { prefer: ["melee", "mobilityAttack"], avoid: ["ranged", "rangedSpell"], bonus: 70, penalty: -90 },
  "ranged-striker": { prefer: ["ranged"], avoid: ["melee", "meleeSpell"], bonus: 50, penalty: -60 },
  "spell-damage": { prefer: ["areaDamage", "rangedSpell", "meleeSpell"], avoid: ["healing", "buff", "melee", "ranged"], bonus: 60, penalty: -45 },
  healer: { prefer: ["healing"], avoid: ["damage"], bonus: 60, penalty: -45 },
  buffer: { prefer: ["buff"], avoid: ["damage"], bonus: 55, penalty: -35 },
  debuffer: { prefer: ["debuff"], avoid: ["damage"], bonus: 55, penalty: -35 },
  controller: { prefer: ["grab", "control"], avoid: ["ranged"], bonus: 50, penalty: -25 },
  defender: { prefer: ["defense"], avoid: ["ranged"], bonus: 50, penalty: -25 },
  support: { prefer: ["support"], avoid: ["damage"], bonus: 50, penalty: -30 },
  skirmisher: { prefer: ["mobility", "mobilityAttack"], avoid: ["defense"], bonus: 50, penalty: -25 },
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

function numericValue(value) {
  const number = Number(systemValue(value));
  return Number.isFinite(number) ? number : null;
}

function actorDocument(context) {
  return context?.actor?.document
    ?? context?.combatant?.actor
    ?? context?.combatant?.document?.actor
    ?? context?.actor
    ?? null;
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

function canUseTacticPersonality(context) {
  if (!context?.actor) return false;
  const type = actorType(context);
  if (!type) return false;
  if (isGmContext(context)) return true;
  return type !== "npc";
}

function tacticRoleOptions(context) {
  return actorType(context) === "npc" ? NPC_TACTIC_ROLES : PLAYER_TACTIC_ROLES;
}

function tacticForActorType(context, tactic) {
  if (actorType(context) === "npc") return tactic;
  const role = PLAYER_TACTIC_ROLE_ID_SET.has(tactic.role) ? tactic.role : "auto";
  const inferredRole = tactic.inferredRole === undefined
    ? undefined
    : PLAYER_TACTIC_ROLE_ID_SET.has(tactic.inferredRole) ? tactic.inferredRole : "auto";
  const effectiveRole = tactic.effectiveRole === undefined
    ? undefined
    : role === "auto" ? (inferredRole ?? "auto") : role;
  return {
    ...tactic,
    role,
    ...(inferredRole === undefined ? {} : { inferredRole }),
    ...(effectiveRole === undefined ? {} : { effectiveRole }),
    temperament: "auto",
    inferredTemperament: "auto",
    effectiveTemperament: "auto",
    customEnabled: false,
    custom: null,
  };
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

function textFromHtml(value) {
  return String(systemValue(value) ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function documentText(document) {
  const traits = [
    ...traitSlugs(document),
    ...(Array.isArray(document?.traits) ? document.traits.map((trait) => trait?.slug ?? trait?.name ?? trait) : []),
    ...(Array.isArray(document?.weaponTraits) ? document.weaponTraits.map((trait) => trait?.slug ?? trait?.name ?? trait) : []),
  ];
  return [
    document?.name,
    document?.label,
    document?.slug,
    document?.system?.slug,
    traits.join(" "),
    textFromHtml(document?.system?.description),
    textFromHtml(document?.system?.description?.value),
    textFromHtml(document?.description),
    textFromHtml(document?.description?.value),
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreBag() {
  return {
    role: {
      "melee-striker": 0,
      "ranged-striker": 0,
      "spell-damage": 0,
      healer: 0,
      buffer: 0,
      debuffer: 0,
      boss: 0,
      lieutenant: 0,
      minion: 0,
      brute: 0,
      skirmisher: 0,
      artillery: 0,
      controller: 0,
      defender: 0,
      support: 0,
    },
    temperament: {
      aggressive: 0,
      cautious: 0,
      opportunist: 0,
      berserker: 0,
      coward: 0,
    },
  };
}

function addScore(scores, group, key, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0 || !(key in scores[group])) return;
  scores[group][key] += value;
}

function bestScoredKey(scores, minimum) {
  let best = "auto";
  let bestScore = minimum;
  for (const [key, score] of Object.entries(scores)) {
    if (score <= bestScore) continue;
    best = key;
    bestScore = score;
  }
  return best;
}

function bestAllowedScoredKey(scores, minimum, allowed) {
  let best = "auto";
  let bestScore = minimum;
  for (const [key, score] of Object.entries(scores)) {
    if (allowed && !allowed.has(key)) continue;
    if (score <= bestScore) continue;
    best = key;
    bestScore = score;
  }
  return best;
}

function actorItemsOfTypes(actor, types) {
  return types.flatMap((type) => actorItems(actor, type));
}

function actorLevel(actor) {
  return numericValue(actor?.system?.details?.level?.value)
    ?? numericValue(actor?.system?.details?.level)
    ?? numericValue(actor?.level)
    ?? null;
}

function targetLevel(target) {
  return numericValue(target?.level)
    ?? numericValue(target?.actor?.document?.system?.details?.level?.value)
    ?? numericValue(target?.actor?.system?.details?.level?.value)
    ?? null;
}

function opposingLevels(context) {
  const seen = new Set();
  const values = [];
  const targets = [
    ...(Array.isArray(context?.targets) ? context.targets : []),
    ...(Array.isArray(context?.battlefield?.targets) ? context.battlefield.targets : []),
    ...(Array.isArray(context?.battlefield?.enemies) ? context.battlefield.enemies : []),
  ];
  for (const target of targets) {
    const key = target?.id ?? target?.uuid ?? target?.name;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const level = targetLevel(target);
    if (level !== null) values.push(level);
  }
  return values;
}

// Unknown HP defaults to full health (1), matching aggro.js's hpPercent() -- both files agree
// that "can't tell" should read as healthy rather than as a false low-HP signal.
function actorHpPercent(context, actor) {
  const explicit = Number(context?.profile?.hpPercent);
  if (Number.isFinite(explicit)) return explicit;
  const hp = actor?.system?.attributes?.hp;
  const current = numericValue(hp?.value);
  const max = numericValue(hp?.max);
  if (current !== null && max !== null && max > 0) return current / max;
  return 1;
}

function actorMaxHp(actor) {
  return numericValue(actor?.system?.attributes?.hp?.max);
}

function actorSpeed(context, actor) {
  return numericValue(context?.profile?.speed)
    ?? numericValue(actor?.system?.attributes?.speed?.value)
    ?? numericValue(actor?.system?.movement?.speeds?.land?.value)
    ?? numericValue(actor?.system?.movement?.speed?.value)
    ?? null;
}

function strikeTraits(strike) {
  return [
    ...(Array.isArray(strike?.traits) ? strike.traits.map((trait) => trait?.slug ?? trait?.name ?? trait) : []),
    ...(Array.isArray(strike?.weaponTraits) ? strike.weaponTraits.map((trait) => trait?.slug ?? trait?.name ?? trait) : []),
    ...traitSlugs(strike?.item),
  ].map((trait) => normalizeId(trait)).filter(Boolean);
}

function strikeRange(strike, traits) {
  const item = strike?.item ?? {};
  const systemRange = item?.system?.range;
  const increment = numericValue(systemRange?.increment ?? systemRange);
  const max = numericValue(systemRange?.max);
  if (max !== null && max > 0) return max;
  if (increment !== null && increment > 0) return increment;
  const traitReach = traits
    .map((trait) => trait.match(/^reach-(\d+)$/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (traitReach.length) return Math.max(...traitReach);
  if (traits.includes("reach")) return 10;
  return 5;
}

function diceAverage(formula) {
  const text = String(formula ?? "");
  let total = 0;
  let matched = false;
  for (const [, count, faces] of text.matchAll(/(\d+)d(\d+)/g)) {
    total += Number(count) * ((Number(faces) + 1) / 2);
    matched = true;
  }
  for (const flat of text.match(/[+-]\s*\d+(?!d)/g) ?? []) {
    total += Number(flat.replace(/\s/g, ""));
    matched = true;
  }
  return matched && total > 0 ? total : null;
}

function strikeAverageDamage(strike) {
  const rolls = strike?.item?.system?.damageRolls;
  if (rolls && typeof rolls === "object") {
    const values = Object.values(rolls)
      .map((roll) => diceAverage(roll?.damage ?? roll?.formula))
      .filter((value) => value !== null);
    if (values.length) return values.reduce((total, value) => total + value, 0);
  }
  return diceAverage(strike?.damageFormula);
}

function hasPattern(text, pattern) {
  return pattern.test(String(text ?? ""));
}

const HEALING_RE = /\b(heal|healing|soothe|restore|restores|regenerate|regeneration|vitality|rejuvenat)\b/;
const SUPPORT_RE = /\b(ally|allies|aura|bolster|bonus|command|commander|inspire|protect|protective|grant|grants|marshal)\b/;
const CONTROL_RE = /\b(grab|grapple|trip|shove|reposition|disarm|frightened|slowed|stunned|stun|immobilized|restrained|prone|off-guard|clumsy|drained|sickened|enfeebled|stupefied|dazzled|blinded|paralyzed|petrified|control)\b/;
const MOBILITY_RE = /\b(stride|step|fly|flight|leap|jump|teleport|burrow|swim|climb|skirmish|mobile|pounce|charge)\b/;
const DEFENSE_RE = /\b(shield|block|parry|guard|defend|defender|protect|armor|resistance|resist)\b/;
const REACTION_RE = /\b(reaction|trigger|reactive strike|attack of opportunity|shield block)\b/;
const STEALTH_RE = /\b(stealth|sneak|hide|ambush|invisible|invisibility|surprise|backstab)\b/;
const RAGE_RE = /\b(rage|frenzy|frenzied|berserk|berserker|reckless|bloodrager)\b/;
const COWARD_RE = /\b(coward|fearful|craven|flee|retreat|surrender)\b/;
const AREA_DAMAGE_RE = /\b(area|burst|cone|line|emanation|breath|fireball|blast|explosion)\b/;

function scoreTextSignals(scores, text) {
  if (hasPattern(text, HEALING_RE)) {
    addScore(scores, "role", "healer", 10);
    addScore(scores, "role", "support", 8);
    addScore(scores, "temperament", "cautious", 2);
  }
  if (hasPattern(text, SUPPORT_RE)) {
    addScore(scores, "role", "healer", 2);
    addScore(scores, "role", "support", 4);
    addScore(scores, "role", "lieutenant", 3);
  }
  if (hasPattern(text, CONTROL_RE)) {
    addScore(scores, "role", "controller", 5);
    addScore(scores, "temperament", "opportunist", 2);
  }
  if (hasPattern(text, MOBILITY_RE)) {
    addScore(scores, "role", "skirmisher", 4);
    addScore(scores, "temperament", "opportunist", 2);
  }
  if (hasPattern(text, DEFENSE_RE)) {
    addScore(scores, "role", "defender", 5);
    addScore(scores, "temperament", "cautious", 3);
  }
  if (hasPattern(text, REACTION_RE)) {
    addScore(scores, "role", "defender", 3);
    addScore(scores, "temperament", "opportunist", 4);
  }
  if (hasPattern(text, STEALTH_RE)) {
    addScore(scores, "role", "skirmisher", 4);
    addScore(scores, "temperament", "opportunist", 4);
  }
  if (hasPattern(text, RAGE_RE)) {
    addScore(scores, "role", "brute", 4);
    addScore(scores, "temperament", "berserker", 8);
  }
  if (hasPattern(text, COWARD_RE)) {
    addScore(scores, "temperament", "coward", 8);
  }
  if (hasPattern(text, AREA_DAMAGE_RE)) {
    addScore(scores, "role", "artillery", 3);
    addScore(scores, "temperament", "aggressive", 2);
  }
}

// Inference depends only on the acting actor's own kit, never on a target, but resolveTacticPersonality()
// calls it on every candidate/target combination during a scoring pass -- memoize per-context like
// aggro.js's aggroProfile() does, so the kit-wide regex rescan only runs once per turn instead of
// once per (candidate, target) pair.
const inferredTacticPersonalityCache = new WeakMap();

function inferTacticPersonality(context) {
  if (context && typeof context === "object") {
    if (inferredTacticPersonalityCache.has(context)) return inferredTacticPersonalityCache.get(context);
    const computed = computeInferTacticPersonality(context);
    inferredTacticPersonalityCache.set(context, computed);
    return computed;
  }
  return computeInferTacticPersonality(context);
}

function computeInferTacticPersonality(context) {
  const actor = actorDocument(context);
  if (!actor) return { role: "auto", temperament: "auto" };
  const npc = actorType(context) === "npc";
  const scores = scoreBag();
  const level = actorLevel(actor);
  const enemyLevels = opposingLevels(context);
  if (level !== null && enemyLevels.length) {
    const averageEnemyLevel = enemyLevels.reduce((total, value) => total + value, 0) / enemyLevels.length;
    if (level >= averageEnemyLevel + 2) addScore(scores, "role", "boss", 14);
    else if (level >= averageEnemyLevel + 1) addScore(scores, "role", "lieutenant", 4);
    if (level <= averageEnemyLevel - 2) addScore(scores, "role", "minion", 14);
  }

  const hpPercent = actorHpPercent(context, actor);
  if (hpPercent <= 0.2) addScore(scores, "temperament", "coward", 12);
  else if (hpPercent <= 0.4) addScore(scores, "temperament", "cautious", 9);

  const maxHp = actorMaxHp(actor);
  if (maxHp !== null && maxHp >= 70) {
    addScore(scores, "role", "brute", 3);
    addScore(scores, "role", "defender", 2);
    addScore(scores, "temperament", "berserker", 2);
  }

  const speed = actorSpeed(context, actor);
  if (speed !== null && speed >= 35) {
    addScore(scores, "role", "skirmisher", 4);
    addScore(scores, "temperament", "opportunist", 2);
  }

  if (context?.profile?.hasShield === true) {
    addScore(scores, "role", "defender", 5);
    addScore(scores, "temperament", "cautious", 3);
  }

  const systemActions = collectionValues(actor?.system?.actions, { compact: true });
  for (const action of systemActions) {
    const traits = strikeTraits(action);
    const text = documentText(action);
    scoreTextSignals(scores, text);
    if (action?.type === "strike") {
      const range = strikeRange(action, traits);
      const averageDamage = strikeAverageDamage(action);
      if (range > 10 || traits.some((trait) => ["ranged", "thrown", "propulsive", "volley"].includes(trait) || trait.startsWith("volley-"))) {
        addScore(scores, "role", "ranged-striker", 8);
        addScore(scores, "role", "artillery", 6);
        addScore(scores, "temperament", "aggressive", 3);
      } else {
        addScore(scores, "role", "melee-striker", 7);
        addScore(scores, "role", "brute", 5);
        addScore(scores, "temperament", "aggressive", 2);
      }
      if (averageDamage !== null && averageDamage >= 18) {
        addScore(scores, "role", range > 10 ? "ranged-striker" : "melee-striker", 4);
        addScore(scores, "role", "brute", 4);
        addScore(scores, "temperament", "aggressive", 4);
        addScore(scores, "temperament", "berserker", 5);
      }
      if (traits.includes("reach") || traits.some((trait) => trait.startsWith("reach-"))) addScore(scores, "role", "brute", 2);
      if (traits.includes("agile") || traits.includes("finesse")) addScore(scores, "role", "skirmisher", 2);
    }
  }

  const featureItems = actorItemsOfTypes(actor, ["action", "feat", "feature", "classFeature", "classfeature", "equipment", "armor", "weapon"]);
  for (const item of featureItems) scoreTextSignals(scores, documentText(item));

  const spellItems = actorItemsOfTypes(actor, ["spell"]);
  for (const spell of spellItems) {
    const text = documentText(spell);
    scoreTextSignals(scores, text);
    if (!npc) {
      addScore(scores, "role", "spell-damage", 2);
      if (hasPattern(text, HEALING_RE)) {
        addScore(scores, "role", "healer", 5);
        continue;
      }
      if (hasPattern(text, CONTROL_RE)) {
        addScore(scores, "role", "debuffer", 5);
        addScore(scores, "role", "controller", 3);
        continue;
      }
      if (hasPattern(text, SUPPORT_RE)) {
        addScore(scores, "role", "buffer", 5);
        addScore(scores, "role", "support", 3);
        continue;
      }
    } else {
      if (hasPattern(text, HEALING_RE)) continue;
      if (hasPattern(text, CONTROL_RE)) continue;
      if (hasPattern(text, SUPPORT_RE)) continue;
    }
    if (spell?.system?.damage || hasPattern(text, /\b(attack|damage|fire|cold|electricity|acid|mental|void|poison)\b/)) {
      addScore(scores, "role", "ranged-striker", 3);
      addScore(scores, "role", "artillery", 5);
      if (!npc) {
        addScore(scores, "role", "spell-damage", hasPattern(text, AREA_DAMAGE_RE) ? 10 : 6);
      }
      addScore(scores, "temperament", "aggressive", 3);
    }
  }

  if ((context?.battlefield?.allies?.length ?? 0) > 0 && (scores.role.support > 0 || scores.role.controller > 0)) {
    addScore(scores, "role", "lieutenant", 3);
  }

  const role = bestAllowedScoredKey(scores.role, AUTO_ROLE_MIN_SCORE, npc ? NPC_TACTIC_ROLE_ID_SET : PLAYER_TACTIC_ROLE_ID_SET);
  const temperament = npc
    ? bestScoredKey(scores.temperament, AUTO_TEMPERAMENT_MIN_SCORE)
    : "auto";
  return { role, temperament };
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
  const inferred = inferTacticPersonality(context);
  const tokenRaw = readFlag(context?.token, TACTIC_PERSONALITY_OVERRIDE_FLAG);
  if (hasFlagValue(tokenRaw)) {
    const tactic = tacticForActorType(context, normalizeTactic(tokenRaw));
    return {
      ...tactic,
      inferredRole: inferred.role,
      inferredTemperament: inferred.temperament,
      effectiveRole: tactic.effectiveRole ?? (tactic.role === "auto" ? inferred.role : tactic.role),
      effectiveTemperament: tactic.effectiveTemperament ?? (tactic.temperament === "auto" ? inferred.temperament : tactic.temperament),
      source: "token",
    };
  }

  const actorRaw = readFlag(context?.actor, TACTIC_PERSONALITY_FLAG);
  if (hasFlagValue(actorRaw)) {
    const tactic = tacticForActorType(context, normalizeTactic(actorRaw));
    return {
      ...tactic,
      inferredRole: inferred.role,
      inferredTemperament: inferred.temperament,
      effectiveRole: tactic.effectiveRole ?? (tactic.role === "auto" ? inferred.role : tactic.role),
      effectiveTemperament: tactic.effectiveTemperament ?? (tactic.temperament === "auto" ? inferred.temperament : tactic.temperament),
      source: "actor",
    };
  }

  return tacticForActorType(context, {
    role: "auto",
    temperament: "auto",
    customEnabled: false,
    custom: null,
    inferredRole: inferred.role,
    inferredTemperament: inferred.temperament,
    effectiveRole: inferred.role,
    effectiveTemperament: inferred.temperament,
    source: "default",
  });
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
  const spell = source === "spell" || source === "spell-inferred" || action?.spell === true || action?.item?.type === "spell";
  const maxRange = Number(action?.range?.max ?? action?.targetingProfile?.maxRange);
  const ranged = traits.has("ranged") || (Number.isFinite(maxRange) && maxRange > 10);
  const offensiveOrControl = [
    "damage",
    "save-damage",
    "area-damage",
    "multiattack",
    "control",
    "debuff",
    "grab",
  ].includes(role) || profile.appliesCondition || Array.isArray(profile.appliesConditions);

  if (["damage", "save-damage", "area-damage", "multiattack"].includes(role) || source === "strike" || profile.includesStrike === true || action?.damageProfile) categories.add("damage");
  if (["control", "debuff", "grab", "setup"].includes(role) || profile.appliesCondition || Array.isArray(profile.appliesConditions)) categories.add("control");
  if (["debuff"].includes(role)) categories.add("debuff");
  if (role === "grab" || ["grapple", "grab"].includes(slug)) categories.add("grab");
  if (["defense", "stealth-defense"].includes(role) || ["raise-a-shield", "take-cover", "hide"].includes(slug)) categories.add("defense");
  if (["buff", "healing", "summon", "support"].includes(role) || profile.spellBuff === true || profile.companion === true) categories.add("support");
  if (role === "buff" || profile.spellBuff === true) categories.add("buff");
  if (role === "healing") categories.add("healing");
  if (["mobility", "mobility-attack"].includes(role) || ["stride", "step", "crawl", "tumble-through"].includes(slug)) categories.add("mobility");
  if (role === "mobility-attack") categories.add("mobilityAttack");
  if (spell) categories.add("spell");
  if (spell && offensiveOrControl && ranged) categories.add("rangedSpell");
  if (spell && offensiveOrControl && Number.isFinite(maxRange) && maxRange <= 10) categories.add("meleeSpell");
  if (ranged) categories.add("ranged");
  if (source === "strike" && !ranged) categories.add("melee");
  if (role === "area-damage" || profile.area === true || profile.areaShape || profile.areaHitCount) categories.add("areaDamage");
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

function autoLabel(entries, effective) {
  if (!effective || effective === "auto") return t("Tactic.Auto", "Auto");
  return t("Tactic.AutoResolved", "Auto: {label}", { label: labelFor(entries, effective) });
}

function autoPairLabel(effectiveRole, effectiveTemperament) {
  if (effectiveRole === "auto" && effectiveTemperament === "auto") return t("Tactic.Auto", "Auto");
  if (effectiveRole === "auto") return autoLabel(TACTIC_TEMPERAMENTS, effectiveTemperament);
  if (effectiveTemperament === "auto") return autoLabel(TACTIC_ROLES, effectiveRole);
  return t("Tactic.AutoResolvedPair", "Auto: {role} / {temperament}", {
    role: labelFor(TACTIC_ROLES, effectiveRole),
    temperament: labelFor(TACTIC_TEMPERAMENTS, effectiveTemperament),
  });
}

function formatTacticLabel(tactic) {
  const effectiveRole = tactic.effectiveRole ?? tactic.role;
  const effectiveTemperament = tactic.effectiveTemperament ?? tactic.temperament;
  const role = tactic.role === "auto" ? autoLabel(TACTIC_ROLES, effectiveRole) : labelFor(TACTIC_ROLES, tactic.role);
  const temperament = tactic.temperament === "auto" ? autoLabel(TACTIC_TEMPERAMENTS, effectiveTemperament) : labelFor(TACTIC_TEMPERAMENTS, tactic.temperament);
  const custom = tactic.customEnabled ? t("Tactic.Custom", "Custom") : "";
  const base = tactic.role === "auto" && tactic.temperament === "auto"
    ? autoPairLabel(effectiveRole, effectiveTemperament)
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
  if (!canUseTacticPersonality(context)) return { scoreDelta: 0, reasons: [] };
  const tactic = resolveTacticPersonality(context);
  const effectiveRole = tactic.effectiveRole ?? tactic.role;
  const effectiveTemperament = tactic.effectiveTemperament ?? tactic.temperament;
  if (effectiveRole === "auto" && effectiveTemperament === "auto" && !tactic.customEnabled) return { scoreDelta: 0, reasons: [] };

  const categories = actionCategories(action, role);
  const parts = [];
  addWeightedParts(parts, ROLE_ACTION_WEIGHTS[effectiveRole], categories);
  addWeightedParts(parts, TEMPERAMENT_ACTION_WEIGHTS[effectiveTemperament], categories);
  if (tactic.customEnabled) addCustomActionParts(parts, tactic.custom, categories);

  const scoreDelta = clampDelta(parts.reduce((total, part) => total + part.delta, 0));
  const reason = scoreDelta ? reasonFor(tactic, parts) : "";
  return {
    scoreDelta,
    reasons: reason ? [reason] : [],
  };
}

export function tacticPersonalityPlanAdjustment(context, steps = [], resolvedTactic = null) {
  if (!canUseTacticPersonality(context)) return { scoreDelta: 0, reasons: [] };
  const tactic = resolvedTactic ?? resolveTacticPersonality(context);
  const effectiveRole = tactic.effectiveRole ?? tactic.role;
  const weights = ROLE_PLAN_WEIGHTS[effectiveRole];
  if (!weights || !Array.isArray(steps) || !steps.length) return { scoreDelta: 0, reasons: [] };

  const categories = new Set();
  for (const step of steps) {
    for (const category of actionCategories(step, step?.role)) categories.add(category);
  }
  const preferred = weights.prefer.some((category) => categories.has(category));
  const avoided = weights.avoid.some((category) => categories.has(category));
  const scoreDelta = preferred ? weights.bonus : avoided ? weights.penalty : 0;
  if (!scoreDelta) return { scoreDelta: 0, reasons: [] };
  const label = formatTacticLabel(tacticForActorType(context, tactic));
  return {
    scoreDelta,
    reasons: [scoreDelta > 0
      ? t("Tactic.PlanFavors", "{label} tactic promotes matching plans.", { label })
      : t("Tactic.PlanAvoids", "{label} tactic demotes off-role plans.", { label })],
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
  if (!canUseTacticPersonality(context)) return { scoreDelta: 0, reasons: [] };
  const tactic = resolveTacticPersonality(context);
  const effectiveRole = tactic.effectiveRole ?? tactic.role;
  const effectiveTemperament = tactic.effectiveTemperament ?? tactic.temperament;
  if (effectiveRole === "auto" && effectiveTemperament === "auto" && !tactic.customEnabled) return { scoreDelta: 0, reasons: [] };

  const roles = targetRoles(aggroProfile);
  const parts = [
    ...targetRoleWeightParts(ROLE_TARGET_WEIGHTS[effectiveRole], roles),
    ...targetRoleWeightParts(TEMPERAMENT_TARGET_WEIGHTS[effectiveTemperament], roles),
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
  const visible = canUseTacticPersonality(context);
  const npc = actorType(context) === "npc";
  const label = formatTacticLabel(npc ? tactic : {
    ...tactic,
    temperament: "auto",
    effectiveTemperament: "auto",
    inferredTemperament: "auto",
  });
  return {
    visible,
    showAdvanced: npc,
    title: npc ? t("Tactic.NpcTitle", "NPC tactic") : t("Tactic.PlayerTitle", "Player tactic"),
    help: npc
      ? t("Tactic.NpcHelp", "Set this NPC's tactical personality. Auto-fill and shuffle weight actions and targets from this profile.")
      : t("Tactic.PlayerHelp", "Set this character's combat role. Auto-fill and shuffle weight actions and targets from this profile."),
    label,
    tooltip: tactic.source === "token"
      ? t("Tactic.TokenOverrideTooltip", "Token tactic override: {label}", { label })
      : t("Tactic.ActorDefaultTooltip", "Actor tactic default: {label}", { label }),
    role: tactic.role,
    temperament: tactic.temperament,
    effectiveRole: tactic.effectiveRole,
    effectiveTemperament: tactic.effectiveTemperament,
    inferredRole: tactic.inferredRole,
    inferredTemperament: tactic.inferredTemperament,
    customEnabled: tactic.customEnabled,
    custom: tactic.custom,
    source: tactic.source,
    isOverride: tactic.source === "token",
    roles: tacticRoleOptions(context),
    temperaments: TACTIC_TEMPERAMENTS,
    actionSliders: TACTIC_ACTION_SLIDERS,
    targetSliders: TACTIC_TARGET_SLIDERS,
  };
}
