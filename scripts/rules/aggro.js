// Cues used to classify an enemy's kit for GM-NPC aggro targeting. Each is matched against an item's
// slug, name, traits, and description (see itemText), which is normalized to lowercase with hyphens
// and underscores turned into spaces — so multi-word PF2e names like "lay-on-hands" match "lay on
// hands". Word boundaries keep matches whole (e.g. "harm" does not match "harmless").
import { t } from "../i18n.js";

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

// Cue-match against the item's identity — slug, name, label, role, traits — but NOT its description
// prose. A rules paragraph like "you are not frightened" would otherwise trip the fear/control cues;
// identity fields are far more reliable and PF2e names/traits are already descriptive.
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
  ].filter(Boolean).join(" "));
}

function itemsOfTypes(actor, types) {
  return types ? types.flatMap((type) => itemTypes(actor, type)) : allItems(actor);
}

function hasItemMatching(actor, pattern, types = null) {
  return itemsOfTypes(actor, types).some((item) => pattern.test(itemText(item)));
}

function countItemsMatching(actor, pattern, types = null) {
  return itemsOfTypes(actor, types).filter((item) => pattern.test(itemText(item))).length;
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

// A "main defender" is whoever is notably hard to hit *in this fight* — the reason to spend attacks
// elsewhere. That's inherently relative, so we compare a target's AC against the other targets on the
// field rather than any absolute table (an absolute number can't work — AC climbs ~1.5/level, and PC
// AC doesn't follow the monster-building tables anyway). A target reads as a defender when its AC sits
// a clear margin above the average of all targets present.
const DEFENDER_AC_MARGIN = 2;

function targetAc(entry) {
  return numericAc(entry, actorDocument(entry));
}

function otherTargets(context) {
  const list = context?.battlefield?.enemies ?? context?.battlefield?.targets ?? context?.targets;
  return collectionValues(list).filter(Boolean);
}

function hasDefensiveArmor(context, target, actor) {
  const ac = numericAc(target, actor);
  if (!Number.isFinite(ac)) return false;

  const peerAcs = otherTargets(context).map(targetAc).filter(Number.isFinite);
  if (peerAcs.length < 2) return false; // no party to compare against — leave it to the kit cues

  const mean = peerAcs.reduce((total, value) => total + value, 0) / peerAcs.length;
  return ac >= mean + DEFENDER_AC_MARGIN;
}

function addRole(profile, role, value, reason) {
  profile.score += value;
  profile.roles.push(role);
  profile.roleScores[role] = (profile.roleScores[role] ?? 0) + value;
  if (reason) profile.reasons.push(reason);
}

// aggroProfile runs per candidate action × per target and regex-scans every item on the target, so
// it's recomputed many times per auto-fill. Memoize by (context, target): both are stable within a
// scoring pass, and the WeakMap lets stale contexts get collected once the pass is done.
const aggroProfileCache = new WeakMap();

export function aggroProfile(context, target) {
  if (context && typeof context === "object" && target && typeof target === "object") {
    let perTarget = aggroProfileCache.get(context);
    if (!perTarget) {
      perTarget = new WeakMap();
      aggroProfileCache.set(context, perTarget);
    }
    if (perTarget.has(target)) return perTarget.get(target);
    const computed = computeAggroProfile(context, target);
    perTarget.set(target, computed);
    return computed;
  }
  return computeAggroProfile(context, target);
}

function computeAggroProfile(context, target) {
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

  // "Close to being removed" means low HP or actively dying — not merely wounded. The wounded
  // condition is a persistent counter that can sit on a full-HP creature after it's been healed,
  // so it doesn't imply the target is near death.
  const hp = hpPercent(target);
  if (hp <= 0.35 || hasCondition(target, "dying")) {
    addRole(profile, "finisher-target", hp <= 0.2 ? 34 : 24, t("Aggro.FinisherTarget", "Target is close to being removed."));
  }

  const distance = Number(target?.distance);
  if (Number.isFinite(distance) && distance <= 10) {
    addRole(profile, "immediate-threat", distance <= 5 ? 18 : 10, t("Aggro.ImmediateThreat", "Target is an immediate threat."));
  }

  if (!full || !actor) {
    profile.roles = [...new Set(profile.roles)];
    return profile;
  }

  if (hasItemMatching(actor, HEALING_WORDS, ["spell", "action", "feat", "feature", "consumable"])) {
    addRole(profile, "healer", 42, t("Aggro.Healer", "Target can heal or recover allies."));
  }

  if (spellCount(actor) > 0 || itemTypes(actor, "spellcastingEntry").length > 0) {
    addRole(profile, "caster", 18 + Math.min(12, spellCount(actor) * 2), t("Aggro.Caster", "Target has active spellcasting."));
  }

  if (hasItemMatching(actor, CONTROL_WORDS, ["spell", "action", "feat", "feature"])) {
    addRole(profile, "controller", 26, t("Aggro.Controller", "Target can control the fight."));
  }

  // Almost every creature has a weapon, so a flat "has offense" bonus flags everyone and tells the
  // NPC nothing. Scale it by how much offense the target actually stacks — extra weapons plus damage
  // feats/impulses/spells (Rage, Power Attack, Flurry, Sneak Attack, damaging cantrips…) — so a
  // glass-cannon striker reads as a bigger threat than a one-weapon mook.
  const weapons = itemTypes(actor, "weapon");
  const damageAbilities = countItemsMatching(actor, DAMAGE_WORDS, ["spell", "action", "feat", "feature"]);
  if (weapons.length > 0 || damageAbilities > 0) {
    const offense = Math.min(20, weapons.length * 3 + damageAbilities * 4);
    addRole(profile, "main-attacker", 8 + offense, t("Aggro.MainAttacker", "Target has meaningful offense."));
  }

  if (hasDefensiveArmor(context, target, actor) || hasItemMatching(actor, DEFENDER_WORDS, ["action", "feat", "feature", "armor", "weapon"])) {
    addRole(profile, "main-defender", 18, t("Aggro.MainDefender", "Target is built to defend or block."));
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
