// Cues used to classify an enemy's kit for GM-NPC aggro targeting. Each is matched against an item's
// slug, name, traits, and description (see itemText), which is normalized to lowercase with hyphens
// and underscores turned into spaces — so multi-word PF2e names like "lay-on-hands" match "lay on
// hands". Word boundaries keep matches whole (e.g. "harm" does not match "harmless").
function roleCuePattern(words) {
  return new RegExp(`\\b(${words.join("|")})\\b`, "i");
}

// Offense: Strikes, damaging spells, martial damage feats, and common monster natural attacks.
const DAMAGE_WORDS = roleCuePattern([
  "attack", "strike", "strikes", "damage", "blast", "bolt", "fireball", "breathe", "breath",
  "rage", "sneak attack", "power attack", "flurry of blows", "flurry", "hunt prey", "hunted shot",
  "double slice", "twin takedown", "exacting strike", "vicious swing", "spellstrike", "smite",
  "claw", "claws", "jaws", "fang", "fangs", "bite", "gore", "horn", "tail", "talon", "tusk",
  "pincer", "tentacle", "stinger", "beak", "hoof", "wing", "slam", "maul", "stab", "shot",
  "arrow", "volley", "ray", "missile", "barrage", "projectile", "lightning", "scorching",
  "burning", "searing", "acid", "disintegrate", "harm",
]);

// Recovery: spells, feats, and items that restore hit points or remove afflictions.
const HEALING_WORDS = roleCuePattern([
  "heal", "healing", "soothe", "soothing", "lay on hands", "battle medicine", "treat wounds",
  "administer first aid", "stabilize", "restore", "restoration", "regenerate", "regeneration",
  "fast healing", "wholeness of body", "life boost", "vital beacon", "vitality", "field medic",
  "ward medic", "continual recovery", "robust recovery", "breath of life", "raise dead",
  "rejuvenate", "revitalize", "mercy", "cleanse",
]);

// Protection: shields, defensive reactions, and class kits built to tank or guard allies.
const DEFENDER_WORDS = roleCuePattern([
  "raise a shield", "shield block", "shield warden", "reactive shield", "shielded", "take cover",
  "intercept", "interpose", "bodyguard", "protect", "protector", "champion", "guardian",
  "sentinel", "stalwart", "taunt", "deflect", "bulwark", "endure", "everstand", "stand still",
  "to the front", "shield ally", "share life", "nimble dodge", "liberating step",
  "glimpse of redemption", "retributive strike",
]);

// Control: actions and spells that impose conditions or restrict an enemy's options.
const CONTROL_WORDS = roleCuePattern([
  "slow", "slowed", "fear", "frighten", "frightened", "stun", "stunned", "paralyze", "paralyzed",
  "grapple", "grab", "grabbed", "trip", "knockdown", "restrain", "restrained", "immobilize",
  "immobilized", "entangle", "wall", "web", "command", "bane", "blind", "blinded", "dazzle",
  "dazzled", "sicken", "sickened", "nauseate", "demoralize", "feint", "bon mot", "confuse",
  "confusion", "sleep", "stupefy", "stupefied", "clumsy", "enfeeble", "enfeebled", "drained",
  "doomed", "fascinate", "hideous laughter", "shove", "reposition", "disarm", "hold person",
  "petrify", "deafen", "calm emotions", "synesthesia", "create a diversion", "stuck",
]);

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return Array.from(collection.values());
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection === "object") return Object.values(collection);
  return [];
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

function actorDocument(target) {
  const actor = target?.actor?.document ?? target?.actor?.object ?? target?.actor;
  return actor && typeof actor === "object" ? actor : null;
}

function actorType(actor) {
  return String(actor?.type ?? actor?.document?.type ?? "").toLowerCase();
}

function activeActorType(context) {
  const profileType = String(context?.profile?.actorType ?? context?.actor?.profile?.actorType ?? "").toLowerCase();
  if (profileType) return profileType;
  return actorType(context?.actor?.document ?? context?.combatant?.actor ?? context?.actor);
}

export function canUseFullAggro(context) {
  const isGM = context?.isGM === true || globalThis.game?.user?.isGM === true;
  return isGM && activeActorType(context) === "npc";
}

function itemTypes(actor, type) {
  return collectionValues(actor?.itemTypes?.[type]);
}

function allItems(actor) {
  const typed = Object.values(actor?.itemTypes ?? {}).flatMap(collectionValues);
  const typedIds = new Set(typed.map((item) => item?.id ?? item?._id).filter(Boolean));
  const fallback = collectionValues(actor?.items).filter((item) => !typedIds.has(item?.id ?? item?._id));
  return [...typed, ...fallback];
}

function itemText(item) {
  const traits = collectionValues(item?.system?.traits?.value ?? item?.traits)
    .map((trait) => trait?.slug ?? trait?.name ?? trait)
    .join(" ");
  return normalizeText([
    item?.slug,
    item?.system?.slug,
    item?.name,
    item?.label,
    item?.role,
    traits,
    item?.system?.description?.value,
  ].filter(Boolean).join(" "));
}

function hasItemMatching(actor, pattern, types = null) {
  const items = types
    ? types.flatMap((type) => itemTypes(actor, type))
    : allItems(actor);
  return items.some((item) => pattern.test(itemText(item)));
}

function spellCount(actor) {
  return itemTypes(actor, "spell").length;
}

function hpPercent(target) {
  const direct = Number(target?.hpPercent ?? target?.hp?.percent);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(1, direct));

  const hp = actorDocument(target)?.system?.attributes?.hp;
  const value = Number(hp?.value);
  const max = Number(hp?.max);
  if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
    return Math.max(0, Math.min(1, value / max));
  }

  return 1;
}

function conditionSlugs(target) {
  const conditions = target?.conditions;
  if (Array.isArray(conditions?.slugs)) return conditions.slugs.map(normalizeText);
  if (Array.isArray(conditions)) {
    return conditions.map((condition) => normalizeText(condition?.slug ?? condition?.name ?? condition));
  }
  return [];
}

function hasCondition(target, slug) {
  const key = normalizeText(slug);
  return conditionSlugs(target).includes(key)
    || Number(target?.conditions?.values?.[key]) > 0;
}

function numericAc(target, actor) {
  const ac = Number(target?.ac ?? actor?.system?.attributes?.ac?.value);
  return Number.isFinite(ac) ? ac : null;
}

function addRole(profile, role, value, reason) {
  profile.score += value;
  profile.roles.push(role);
  profile.roleScores[role] = (profile.roleScores[role] ?? 0) + value;
  if (reason) profile.reasons.push(reason);
}

export function aggroProfile(context, target) {
  const full = canUseFullAggro(context);
  const actor = actorDocument(target);
  const profile = {
    target,
    score: 0,
    roles: [],
    roleScores: {},
    reasons: [],
    gmOnly: full,
  };

  const hp = hpPercent(target);
  if (hp <= 0.35 || hasCondition(target, "dying") || hasCondition(target, "wounded")) {
    addRole(profile, "finisher-target", hp <= 0.2 ? 34 : 24, "Target is close to being removed.");
  }

  const distance = Number(target?.distance);
  if (Number.isFinite(distance) && distance <= 10) {
    addRole(profile, "immediate-threat", distance <= 5 ? 18 : 10, "Target is an immediate threat.");
  }

  if (!full || !actor) {
    profile.roles = [...new Set(profile.roles)];
    return profile;
  }

  if (hasItemMatching(actor, HEALING_WORDS, ["spell", "action", "feat", "feature", "consumable"])) {
    addRole(profile, "healer", 42, "Target can heal or recover allies.");
  }

  if (spellCount(actor) > 0 || itemTypes(actor, "spellcastingEntry").length > 0) {
    addRole(profile, "caster", 18 + Math.min(12, spellCount(actor) * 2), "Target has active spellcasting.");
  }

  if (hasItemMatching(actor, CONTROL_WORDS, ["spell", "action", "feat", "feature"])) {
    addRole(profile, "controller", 26, "Target can control the fight.");
  }

  const weapons = itemTypes(actor, "weapon");
  if (weapons.length > 0 || hasItemMatching(actor, DAMAGE_WORDS, ["spell", "action", "feat", "feature"])) {
    addRole(profile, "main-attacker", 18 + Math.min(12, weapons.length * 3), "Target has meaningful offense.");
  }

  const ac = numericAc(target, actor);
  if ((Number.isFinite(ac) && ac >= 24) || hasItemMatching(actor, DEFENDER_WORDS, ["action", "feat", "feature", "armor", "weapon"])) {
    addRole(profile, "main-defender", 18, "Target is built to defend or block.");
  }

  profile.roles = [...new Set(profile.roles)];
  return profile;
}

function roleWeightForAction(action, role, aggroRole) {
  const actionRole = String(role ?? action?.role ?? "").toLowerCase();
  if (aggroRole === "finisher-target") return actionRole === "control" || actionRole === "debuff" ? 4 : 1.15;
  if (aggroRole === "healer") return ["control", "debuff"].includes(actionRole) ? 0.9 : 1.1;
  if (aggroRole === "caster") return ["control", "debuff", "grab"].includes(actionRole) ? 1.8 : 0.8;
  if (aggroRole === "controller") return ["control", "debuff", "grab"].includes(actionRole) ? 1.7 : 0.75;
  if (aggroRole === "main-attacker") return ["control", "debuff", "grab"].includes(actionRole) ? 0.75 : 0.85;
  if (aggroRole === "immediate-threat") return actionRole === "control" ? 0.8 : 0.65;
  if (aggroRole === "main-defender") return actionRole === "control" ? 0.35 : -0.45;
  return 0;
}

export function aggroTargetValue(context, action, role, target) {
  if (!canUseFullAggro(context)) return 0;

  const profile = aggroProfile(context, target);
  let value = 0;
  for (const aggroRole of profile.roles) {
    const roleValue = profile.roleScores?.[aggroRole] ?? 0;
    value += roleValue * roleWeightForAction(action, role, aggroRole);
  }
  return Math.round(value);
}
