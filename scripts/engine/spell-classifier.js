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

function readDamageProfile(spell) {
  const damage = spell?.system?.damage;
  const partials = damage && typeof damage === "object" ? Object.values(damage) : [];
  const partial = partials.find((entry) => entry && (entry.formula || entry.value || entry.dice));
  if (!partial) return null;

  const formula = String(partial.formula ?? partial.value ?? "").trim();
  const type = String(partial.type ?? partial.damageType ?? "").trim().toLowerCase() || null;
  if (!formula && !type) return null;
  return { formula: formula || null, type };
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

function targetsSelfOnly(spell, rangeProfile) {
  if (rangeProfile.self) return true;
  const target = String(systemValue(spell?.system?.target) ?? "").toLowerCase();
  return target.includes("self") || target.includes("you");
}

function isHealing(spell, traits, damageProfile) {
  return traits.includes("healing")
    || damageProfile?.type === "healing"
    || /\bregain(?:s)? .*hit points\b|\brestore(?:s)? .*hit points\b/.test(spellText(spell));
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
  const grantsBonus = /\b(?:\+\d+|status|circumstance|item) (?:bonus|status)\b|\bgrants? a .*bonus\b/.test(text);
  const tempHp = /\btemporary hit points\b/.test(text);
  const resistance = /\bresistance\b|\breduce[sd]? .* damage\b/.test(text);
  const removesCondition = /\b(?:remove|reduce|suppress)[sd]? .* (?:condition|penalt)/.test(text);
  const protective = /\bprotect|\bward\b|\bbolster|\bbless|\bheroism|\bhaste\b|\benhance|\bshield\b|\bsanctuary\b/.test(text);
  const extraAction = /\b(?:an? )?(?:extra|additional) action\b|\bact twice\b/.test(text);

  if (!(attackBuff || grantsBonus || tempHp || resistance || removesCondition || protective || extraAction)) {
    return null;
  }

  const ally = /\bally\b|\ballies\b|\bwilling creature\b|\btarget\b/.test(text);
  return { ally, attackBuff, tempHp, removesCondition };
}

export function classifySpell(spell) {
  if (!spell) return null;

  const traits = spellTraits(spell);
  const saveProfile = readSaveProfile(spell);
  const damageProfile = readDamageProfile(spell);
  const areaProfile = readAreaProfile(spell);
  const rangeProfile = readRangeProfile(spell);
  const hasAttack = traits.includes("attack");
  const healing = isHealing(spell, traits, damageProfile);

  if (healing) {
    return inferred("healing", {
      activityProfile: baseProfile(["healing"]),
      targetingProfile: { ally: true, self: true },
      damageProfile,
      confidence: "high",
      reasons: ["Spell can restore Hit Points to an ally."],
    });
  }

  if (areaProfile && damageProfile) {
    return inferred("area-damage", {
      activityProfile: baseProfile(["damage", "area"]),
      targetingProfile: { ...areaProfile, ...rangeProfile, enemy: true },
      saveProfile,
      damageProfile,
      confidence: "high",
      reasons: ["Area spell damages enemies in a template."],
    });
  }

  if (saveProfile && damageProfile) {
    return inferred("save-damage", {
      activityProfile: baseProfile(["damage"]),
      targetingProfile: { enemy: true, ...rangeProfile },
      saveProfile,
      damageProfile,
      confidence: "high",
      reasons: ["Spell forces a saving throw for damage."],
    });
  }

  if (damageProfile && !targetsSelfOnly(spell, rangeProfile)) {
    return inferred("damage", {
      activityProfile: { ...baseProfile(["damage"]), spellAttack: hasAttack },
      targetingProfile: { enemy: true, ...rangeProfile },
      damageProfile,
      confidence: hasAttack ? "high" : "medium",
      reasons: [hasAttack
        ? "Spell attack roll deals damage to one target."
        : "Spell deals damage to a target."],
    });
  }

  if (saveProfile && !targetsSelfOnly(spell, rangeProfile)) {
    return inferred("control", {
      activityProfile: { ...baseProfile(["control"]), ...(areaProfile ?? {}) },
      targetingProfile: { enemy: true, ...rangeProfile, ...(areaProfile ?? {}) },
      saveProfile,
      confidence: "medium",
      reasons: ["Spell forces a saving throw to debuff or control the target."],
    });
  }

  const selfOnly = targetsSelfOnly(spell, rangeProfile);

  if (selfOnly && !damageProfile && !saveProfile) {
    const defensive = traits.includes("abjuration")
      || /\bshield\b|\barmor\b|\bward\b|\bresistance\b|\btemporary hit points\b/.test(spellText(spell));
    return inferred(defensive ? "defense" : "setup", {
      activityProfile: baseProfile([defensive ? "defense" : "setup"]),
      targetingProfile: { self: true },
      setupFor: defensive ? [] : ["strike", "damage", "spell"],
      confidence: "medium",
      reasons: [defensive ? "Self-buff spell improves defenses." : "Self-buff spell sets up later actions."],
    });
  }

  const buff = readBuffProfile(spell);
  if (buff && !damageProfile && !saveProfile) {
    return inferred("buff", {
      activityProfile: { ...baseProfile(["buff"]), ...buff },
      targetingProfile: buff.ally ? { ally: true, self: true } : { self: true },
      setupFor: buff.attackBuff ? ["strike", "damage", "spell"] : [],
      confidence: "medium",
      reasons: ["Spell grants a beneficial effect to the caster or an ally."],
    });
  }

  const text = spellText(spell);
  if (traits.includes("teleportation") || /\bteleport/.test(text)) {
    return inferred("mobility", {
      activityProfile: { ...baseProfile(["teleport"]), teleport: true },
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Teleportation spell repositions the caster."],
    });
  }

  if (traits.includes("polymorph") || traits.includes("morph")) {
    return inferred("transformation", {
      activityProfile: { ...baseProfile(["transformation"]), polymorph: traits.includes("polymorph") },
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Form-changing spell alters the caster's options."],
    });
  }

  if (traits.includes("summon") || /\bsummon (?:a|an|the|forth)\b|\bconjures?\b/.test(text)) {
    return inferred("summon", {
      activityProfile: baseProfile(["summon"]),
      targetingProfile: { self: true },
      confidence: "medium",
      reasons: ["Summoning spell adds an ally to the battlefield."],
    });
  }

  // Catch-all: a combat-castable spell with no recognized tactical pattern still
  // surfaces as a low-priority option rather than being dropped.
  return inferred("utility", {
    activityProfile: baseProfile(["utility"]),
    targetingProfile: { self: true },
    confidence: "low",
    reasons: ["Spell is available but has no recognized combat pattern."],
  });
}
