function systemValue(value) {
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value;
}

function arrayValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return [];
}

function spellTraits(spell) {
  const traits = spell?.system?.traits;
  const values = [
    ...arrayValue(traits?.value ?? traits),
    ...arrayValue(spell?.traits).map((trait) => trait?.slug ?? trait?.name ?? trait),
  ];
  return [...new Set(values.filter(Boolean).map((trait) => String(trait).toLowerCase()))];
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function spellText(spell) {
  return normalizeText([
    spell?.name,
    systemValue(spell?.system?.description),
    spell?.system?.description?.value,
  ].filter(Boolean).join(" "));
}

function spellRank(spell) {
  const rank = Number(spell?.rank ?? spell?.system?.level?.value ?? spell?.system?.rank?.value);
  return Number.isFinite(rank) ? rank : null;
}

function readSaveProfile(spell) {
  const defense = spell?.system?.defense;
  const statistic = String(
    defense?.save?.statistic ?? systemValue(spell?.system?.save?.value ?? spell?.system?.save),
  ).toLowerCase();
  if (["fortitude", "reflex", "will"].includes(statistic)) {
    return {
      stat: statistic,
      dc: null,
      basic: Boolean(defense?.save?.basic ?? spell?.system?.save?.basic),
    };
  }
  return null;
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

  if (!matched) {
    const numeric = Number(text.match(/^\s*\d+(?:\.\d+)?\s*$/)?.[0]);
    if (Number.isFinite(numeric)) return numeric;
  }

  return matched && total > 0 ? total : null;
}

function readDamageProfile(spell) {
  const damage = spell?.system?.damage;
  const partials = damage && typeof damage === "object" ? Object.values(damage) : [];
  const entries = partials
    .filter((entry) => entry && (entry.formula || entry.value || entry.dice))
    .map((entry) => {
      const formula = String(entry.formula ?? entry.value ?? "").trim();
      const type = String(entry.type ?? entry.damageType ?? "").trim().toLowerCase() || null;
      return {
        formula: formula || null,
        type,
        average: diceAverage(formula),
      };
    })
    .filter((entry) => entry.formula || entry.type);

  if (!entries.length) return null;

  const primary = entries[0];
  const average = entries
    .map((entry) => Number(entry.average))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((total, value) => total + value, 0);

  return {
    formula: primary.formula,
    type: primary.type,
    entries,
    types: [...new Set(entries.map((entry) => entry.type).filter(Boolean))],
    average: average > 0 ? average : primary.average,
  };
}

function readAreaProfile(spell) {
  const area = spell?.system?.area;
  if (!area) return null;
  const distance = Number(systemValue(area.value ?? area.radius ?? area.distance));
  return {
    area: true,
    type: String(area.type ?? "area").toLowerCase(),
    distance: Number.isFinite(distance) && distance > 0 ? distance : null,
  };
}

function readRangeProfile(spell) {
  const raw = String(systemValue(spell?.system?.range) ?? "").trim().toLowerCase();
  if (!raw) return {};
  if (raw.includes("touch")) return { maxRange: 5 };
  if (raw.includes("self")) return { self: true };
  if (raw.includes("planetary") || raw.includes("unlimited") || raw.includes("interplanar")) return {};

  const match = raw.match(/(\d+)\s*(?:feet|ft|foot)/);
  if (match) {
    const distance = Number(match[1]);
    if (Number.isFinite(distance) && distance > 0) return { maxRange: distance };
  }
  return {};
}

function targetText(spell) {
  return normalizeText(systemValue(spell?.system?.target) ?? spell?.system?.target ?? "");
}

function targetsSelfOnly(spell, rangeProfile) {
  if (rangeProfile.self) return true;
  const target = targetText(spell);
  return target.includes("self") || target.includes("you");
}

function isHealing(spell, traits, damageProfile) {
  return traits.includes("healing")
    || damageProfile?.type === "healing"
    || /\bregain(?:s)? .*hit points\b|\brestore(?:s)? .*hit points\b/.test(spellText(spell));
}

const CONDITION_PATTERNS = [
  ["frightened", /\bfrightened\b/],
  ["sickened", /\bsickened\b/],
  ["slowed", /\bslowed\b/],
  ["stunned", /\bstunned\b/],
  ["stupefied", /\bstupefied\b/],
  ["clumsy", /\bclumsy\b/],
  ["enfeebled", /\benfeebled\b/],
  ["off-guard", /\boff[- ]guard\b|\bflat-footed\b/],
  ["prone", /\bprone\b|\bknocked down\b/],
  ["immobilized", /\bimmobilized\b/],
  ["grabbed", /\bgrabbed\b/],
  ["restrained", /\brestrained\b/],
  ["paralyzed", /\bparalyzed\b/],
  ["confused", /\bconfused\b/],
  ["controlled", /\bcontrolled\b/],
  ["fleeing", /\bfleeing\b/],
  ["dazzled", /\bdazzled\b/],
  ["blinded", /\bblinded\b/],
  ["deafened", /\bdeafened\b/],
];

function readConditionProfile(spell) {
  const text = spellText(spell);
  const appliesConditions = CONDITION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([slug]) => slug);

  if (!appliesConditions.length) return null;

  return {
    appliesCondition: appliesConditions[0],
    appliesConditions,
  };
}

function readDurationProfile(spell) {
  const duration = normalizeText(systemValue(spell?.system?.duration) ?? spell?.system?.duration ?? "");
  const text = spellText(spell);
  const instantaneous = !duration || duration === "instantaneous";
  return {
    duration: duration || null,
    lastingDuration: !instantaneous,
    sustained: /\bsustained\b|\bsustain\b/.test(duration) || /\bsustain(?:ed)?\b/.test(text),
  };
}

function readSpellFacts(spell, traits, damageProfile, conditionProfile) {
  const text = spellText(spell);
  return {
    spell: true,
    rank: spellRank(spell),
    traits,
    cantrip: traits.includes("cantrip"),
    focus: traits.includes("focus"),
    damageTypes: damageProfile?.types ?? (damageProfile?.type ? [damageProfile.type] : []),
    averageDamage: damageProfile?.average ?? null,
    damageScalesWithActions: /\bfor each additional action\b|\badditional action you use\b|\beach action you spend\b/.test(text),
    conditionProfile,
    incapacitation: traits.includes("incapacitation"),
    ...readDurationProfile(spell),
  };
}

function readControlFacts(spell) {
  const text = spellText(spell);
  const facts = {
    terrainControl: /\bdifficult terrain\b|\bhazardous terrain\b|\buneven ground\b/.test(text),
    wall: /\bwall\b|\bbarrier\b|\bblocks? (?:movement|line|sight)\b/.test(text),
    obscuring: /\bconcealed\b|\bconcealment\b|\bobscur(?:e|ing)|\bmist\b|\bfog\b|\bdarkness\b|\bsmoke\b/.test(text),
    forcedMovement: /\bpush(?:es)?\b|\bpull(?:s)?\b|\bslide(?:s)?\b|\bmove(?:s)? .* target\b/.test(text),
    areaDenial: /\benter(?:s|ing)? .* (?:takes?|damage)\b|\bstarts? (?:its|their) turn\b.{0,40}\bdamage\b/.test(text),
  };

  if (!Object.values(facts).some(Boolean)) return null;
  return facts;
}

function baseProfile(includes = []) {
  return { includes, includesStrike: false };
}

function inferred(role, {
  activityProfile = null,
  targetingProfile = null,
  saveProfile = null,
  damageProfile = null,
  setupFor = [],
  confidence = "medium",
  reasons = [],
} = {}) {
  return {
    role,
    activityProfile,
    targetingProfile,
    saveProfile,
    damageProfile,
    gatingProfile: null,
    setupFor,
    confidence,
    executable: "open-item",
    reasons,
    inferred: true,
  };
}

// Detect a beneficial (buff/support) effect with no offensive component. Requires
// a positive signal so pure utility (Detect Magic, Light) is not mislabeled a buff.
function readBuffProfile(spell) {
  const text = spellText(spell);
  const attackBuff = /\bbonus to attack\b|\battack rolls?\b.*\bbonus\b|\bstatus bonus\b.*\battack/.test(text);
  const damageBuff = /\bbonus (?:to|on) damage\b|\badditional .*damage\b|\bextra .*damage\b/.test(text);
  const acBuff = /\bbonus to ac\b|\bac\b.*\bbonus\b|\barmor class\b.*\bbonus\b/.test(text);
  const saveBuff = /\bbonus to (?:saving throws|saves)\b|\bsaving throws?\b.*\bbonus\b/.test(text);
  const grantsBonus = /\b(?:\+\d+|status|circumstance|item) (?:bonus|status)\b|\bgrants? a .*bonus\b/.test(text);
  const tempHp = /\btemporary hit points\b/.test(text);
  const resistance = /\bresistance\b|\breduce[sd]? .* damage\b/.test(text);
  const removesCondition = /\b(?:remove|reduce|suppress)[sd]? .* (?:condition|penalt)|\bbreak free\b|\bescape\b|\bholds? .* in place\b|\bimmobilized\b|\bgrabbed\b|\brestrained\b/.test(text);
  const protective = /\bprotect|\bward\b|\bbolster|\bbless|\bheroism|\bhaste\b|\benhance|\bshield\b|\bsanctuary\b/.test(text);
  const extraAction = /\b(?:an? )?(?:extra|additional) action\b|\bact twice\b|\buse several actions\b|\bquickened\b/.test(text);

  if (!(attackBuff || damageBuff || acBuff || saveBuff || grantsBonus || tempHp || resistance || removesCondition || protective || extraAction)) {
    return null;
  }

  const ally = /\bally\b|\ballies\b|\bwilling creature\b|\btarget\b/.test(text);
  return { ally, attackBuff, damageBuff, acBuff, saveBuff, tempHp, resistance, removesCondition, extraAction };
}

export function classifySpell(spell) {
  if (!spell) return null;

  const traits = spellTraits(spell);
  const saveProfile = readSaveProfile(spell);
  const damageProfile = readDamageProfile(spell);
  const areaProfile = readAreaProfile(spell);
  const rangeProfile = readRangeProfile(spell);
  const conditionProfile = readConditionProfile(spell);
  const controlFacts = readControlFacts(spell);
  const spellFacts = readSpellFacts(spell, traits, damageProfile, conditionProfile);
  const hasAttack = traits.includes("attack");
  const healing = isHealing(spell, traits, damageProfile);

  if (healing) {
    return inferred("healing", {
      activityProfile: { ...baseProfile(["healing"]), ...spellFacts },
      targetingProfile: { ally: true, self: true },
      damageProfile,
      confidence: "high",
      reasons: ["Spell can restore Hit Points to an ally."],
    });
  }

  if (areaProfile && damageProfile) {
    return inferred("area-damage", {
      activityProfile: { ...baseProfile(["damage", "area"]), ...spellFacts },
      targetingProfile: { ...areaProfile, ...rangeProfile, enemy: true },
      saveProfile,
      damageProfile,
      confidence: "high",
      reasons: ["Area spell damages enemies in a template."],
    });
  }

  if (saveProfile && damageProfile) {
    return inferred("save-damage", {
      activityProfile: { ...baseProfile(["damage"]), ...spellFacts },
      targetingProfile: { enemy: true, ...rangeProfile },
      saveProfile,
      damageProfile,
      confidence: "high",
      reasons: ["Spell forces a saving throw for damage."],
    });
  }

  if (damageProfile && !targetsSelfOnly(spell, rangeProfile)) {
    return inferred("damage", {
      activityProfile: { ...baseProfile(["damage"]), ...spellFacts, spellAttack: hasAttack },
      targetingProfile: { enemy: true, ...rangeProfile },
      damageProfile,
      confidence: hasAttack ? "high" : "medium",
      reasons: [hasAttack
        ? "Spell attack roll deals damage to one target."
        : "Spell deals damage to a target."],
    });
  }

  if ((saveProfile || conditionProfile || controlFacts) && !targetsSelfOnly(spell, rangeProfile)) {
    return inferred("control", {
      activityProfile: {
        ...baseProfile(["control"]),
        ...spellFacts,
        ...(conditionProfile ?? {}),
        ...(areaProfile ?? {}),
        ...(controlFacts ?? {}),
      },
      targetingProfile: { enemy: true, ...rangeProfile, ...(areaProfile ?? {}) },
      saveProfile,
      confidence: saveProfile || conditionProfile ? "medium" : "high",
      reasons: [saveProfile
        ? "Spell forces a saving throw to debuff or control the target."
        : controlFacts
        ? "Spell changes terrain, visibility, or enemy positioning."
        : "Spell applies a combat condition."],
    });
  }

  const selfOnly = targetsSelfOnly(spell, rangeProfile);

  if (selfOnly && !damageProfile && !saveProfile) {
    const defensive = traits.includes("abjuration")
      || /\bshield\b|\barmor\b|\bward\b|\bresistance\b|\btemporary hit points\b/.test(spellText(spell));
    return inferred(defensive ? "defense" : "setup", {
      activityProfile: { ...baseProfile([defensive ? "defense" : "setup"]), ...spellFacts },
      targetingProfile: { self: true },
      setupFor: defensive ? [] : ["strike", "damage", "spell"],
      confidence: "medium",
      reasons: [defensive ? "Self-buff spell improves defenses." : "Self-buff spell sets up later actions."],
    });
  }

  const buff = readBuffProfile(spell);
  if (buff && !damageProfile && !saveProfile) {
    return inferred("buff", {
      activityProfile: { ...baseProfile(["buff"]), ...spellFacts, ...buff },
      targetingProfile: buff.ally ? { ally: true, self: true } : { self: true },
      setupFor: (buff.attackBuff || buff.damageBuff || buff.extraAction) ? ["strike", "damage", "spell"] : [],
      confidence: "medium",
      reasons: ["Spell grants a beneficial effect to the caster or an ally."],
    });
  }

  const text = spellText(spell);
  if (traits.includes("teleportation") || /\bteleport/.test(text)) {
    return inferred("mobility", {
      activityProfile: { ...baseProfile(["teleport"]), ...spellFacts, teleport: true },
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Teleportation spell repositions the caster."],
    });
  }

  if (traits.includes("polymorph") || traits.includes("morph")) {
    return inferred("transformation", {
      activityProfile: { ...baseProfile(["transformation"]), ...spellFacts, polymorph: traits.includes("polymorph") },
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Form-changing spell alters the caster's options."],
    });
  }

  if (traits.includes("summon") || /\bsummon (?:a|an|the|forth)\b|\bconjures?\b/.test(text)) {
    return inferred("summon", {
      activityProfile: { ...baseProfile(["summon"]), ...spellFacts },
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Summoning spell adds an ally to the battlefield."],
    });
  }

  // Catch-all: a combat-castable spell with no recognized tactical pattern still
  // surfaces as a low-priority option rather than being dropped.
  return inferred("utility", {
    activityProfile: { ...baseProfile(["utility"]), ...spellFacts },
    targetingProfile: { self: true },
    confidence: "low",
    reasons: ["Spell is available but has no recognized combat pattern."],
  });
}
