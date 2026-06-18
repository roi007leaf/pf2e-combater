const MAX_CLASS_TACTIC_DELTA = 44;

const CASTER_ROLES = {
  damage: 6,
  "save-damage": 8,
  "area-damage": 8,
  control: 10,
  debuff: 8,
  buff: 6,
  defense: 4,
  healing: 6,
  summon: 4,
  "resource-recovery": 6,
};

const MARTIAL_ROLES = {
  "mobility-attack": 10,
  multiattack: 10,
  setup: 6,
  control: 4,
  defense: 4,
};

const CLASS_TACTICS = {
  alchemist: {
    label: "Alchemist",
    classAction: 8,
    consumable: 10,
    rangedStrike: 8,
    meleeStrike: -6,
    roles: { damage: 8, debuff: 8, control: 8, healing: 8, setup: 6, buff: 6 },
    signatureActions: {
      "quick-alchemy": 26,
      "quick-bomber": 22,
      "mutagenic-flashback": 18,
      "revivifying-mutagen": 18,
    },
  },
  animist: {
    label: "Animist",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, buff: 8, summon: 8 },
    signatureActions: {
      "apparitions-enhancement": 18,
      "apparitions-quickening": 20,
      "apparitions-reflection": 18,
      "circle-of-spirits": 18,
      "grudge-strike": 18,
    },
  },
  barbarian: {
    label: "Barbarian",
    classAction: 8,
    meleeStrike: 10,
    rangedStrike: -4,
    roles: { ...MARTIAL_ROLES, transformation: 8, damage: 6 },
    signatureActions: {
      rage: 30,
      "mighty-rage": 24,
      "quick-tempered": 18,
      "sudden-charge": 20,
      "furious-grab": 18,
      "renewed-vigor": 16,
    },
  },
  bard: {
    label: "Bard",
    classAction: 8,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, buff: 12, debuff: 10, control: 10, setup: 8 },
    signatureActions: {
      "courageous-advance": 22,
      "courageous-assault": 22,
      "courageous-onslaught": 22,
      harmonize: 18,
      "vigorous-anthem": 20,
      "counter-performance": 18,
      "lingering-composition": 18,
    },
  },
  champion: {
    label: "Champion",
    classAction: 8,
    meleeStrike: 6,
    roles: { defense: 14, healing: 8, control: 6, buff: 6, setup: 4 },
    signatureActions: {
      smite: 22,
      "lay-on-hands": 22,
      "retributive-strike": 18,
      "glimpse-of-redemption": 18,
      "liberating-step": 18,
      "iron-command": 18,
      "raise-a-shield": 8,
      "take-cover": 4,
    },
  },
  cleric: {
    label: "Cleric",
    classAction: 6,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, healing: 14, buff: 10, "save-damage": 10 },
    signatureActions: {
      "channel-smite": 22,
      "raise-symbol": 16,
      "divine-infusion": 18,
      "cast-down": 18,
      "restorative-strike": 18,
    },
  },
  commander: {
    label: "Commander",
    classAction: 10,
    meleeStrike: 2,
    rangedStrike: 2,
    roles: { buff: 14, setup: 12, control: 8, mobility: 6, defense: 6 },
    signatureActions: {
      "strike-hard": 26,
      "pincer-attack": 24,
      "ready-aim-fire": 24,
      reload: 22,
      "shields-up": 22,
      "gather-to-me": 20,
      "coordinating-maneuvers": 20,
      "take-the-high-ground": 20,
      "for-talamandor-for-freedom": 20,
      "seek-and-destroy": 20,
    },
  },
  druid: {
    label: "Druid",
    classAction: 6,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, "area-damage": 10, control: 10, healing: 8, summon: 8, transformation: 6 },
    signatureActions: {
      "wild-shape": 22,
      "storm-lord": 16,
      "floral-restoration": 18,
      "form-control": 18,
      "overwhelming-energy": 16,
    },
  },
  exemplar: {
    label: "Exemplar",
    classAction: 10,
    meleeStrike: 8,
    rangedStrike: 6,
    roles: { ...MARTIAL_ROLES, damage: 8, mobility: 6 },
    signatureActions: {
      "shift-immanence": 24,
      "spark-transcendence": 24,
      "victors-wreath": 18,
    },
  },
  fighter: {
    label: "Fighter",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 8,
    includesStrike: 8,
    roles: { ...MARTIAL_ROLES, setup: 8 },
    signatureActions: {
      "reactive-strike": 16,
      "power-attack": 22,
      "vicious-swing": 22,
      "double-slice": 22,
      "intimidating-strike": 20,
      "knockdown": 20,
      "snagging-strike": 20,
    },
  },
  guardian: {
    label: "Guardian",
    classAction: 10,
    meleeStrike: 4,
    roles: { defense: 16, control: 10, setup: 6, buff: 4 },
    signatureActions: {
      taunt: 30,
      "intercept-attack": 22,
      "raise-a-shield": 10,
      "take-cover": 6,
    },
  },
  gunslinger: {
    label: "Gunslinger",
    classAction: 8,
    rangedStrike: 14,
    meleeStrike: -10,
    reloadBeforeStrike: 8,
    roles: { setup: 8, mobility: 8, damage: 6, "mobility-attack": 8 },
    signatureActions: {
      "covered-reload": 28,
      "raconteurs-reload": 28,
      "reloading-strike": 28,
      "thoughtful-reload": 26,
      "finish-the-job": 22,
      "ghost-shot": 20,
      "vital-shot": 20,
      "running-reload": 22,
    },
  },
  inventor: {
    label: "Inventor",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 6,
    roles: { damage: 8, setup: 8, transformation: 10, control: 6, defense: 4 },
    signatureActions: {
      overdrive: 30,
      explode: 24,
      "unstable-function": 18,
      "searing-restoration": 18,
    },
  },
  investigator: {
    label: "Investigator",
    classAction: 8,
    meleeStrike: 4,
    rangedStrike: 6,
    roles: { setup: 14, damage: 6, control: 6, debuff: 6 },
    signatureActions: {
      "devise-a-stratagem": 30,
      "clue-in": 18,
      "quick-tincture": 20,
      "pointed-question": 18,
      "recall-knowledge": 8,
    },
  },
  kineticist: {
    label: "Kineticist",
    classAction: 12,
    impulseAction: 18,
    meleeStrike: -8,
    roles: { damage: 10, "area-damage": 10, control: 10, defense: 8, buff: 6, mobility: 6 },
    signatureActions: {
      "channel-elements": 30,
      "elemental-blast": 28,
      "extract-element": 24,
      "base-kinesis": 14,
      "weapon-infusion": 20,
      "two-element-infusion": 18,
    },
  },
  magus: {
    label: "Magus",
    classAction: 8,
    spell: 4,
    meleeStrike: 14,
    rangedStrike: 10,
    includesStrike: 14,
    roles: { damage: 8, "mobility-attack": 10, setup: 8, "resource-recovery": 14 },
    signatureActions: {
      spellstrike: 34,
      "arcane-cascade": 26,
      "recharge-spellstrike": 22,
      "dimensional-assault": 20,
    },
  },
  monk: {
    label: "Monk",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 2,
    roles: { ...MARTIAL_ROLES, mobility: 10, setup: 10, defense: 6 },
    signatureActions: {
      "flurry-of-blows": 30,
      "stunning-fist": 20,
      "ki-strike": 20,
      "flying-kick": 20,
      "mixed-maneuver": 18,
    },
  },
  oracle: {
    label: "Oracle",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, debuff: 10, control: 8 },
    signatureActions: {
      "foretell-harm": 20,
      "nudge-the-scales": 20,
      "whispers-of-weakness": 22,
      "debilitating-dichotomy": 20,
      "glean-lore": 16,
    },
  },
  psychic: {
    label: "Psychic",
    classAction: 8,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 12, "save-damage": 10, control: 10 },
    signatureActions: {
      "unleash-psyche": 30,
      "psi-burst": 24,
      "restore-the-mind": 20,
      "calculate-threats": 18,
      "recall-the-teachings": 16,
    },
  },
  ranger: {
    label: "Ranger",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 8,
    includesStrike: 6,
    roles: { ...MARTIAL_ROLES, setup: 10, mobility: 6 },
    signatureActions: {
      "hunt-prey": 30,
      "hunted-shot": 24,
      "twin-takedown": 24,
      "skirmish-strike": 20,
      "hunters-aim": 20,
    },
  },
  rogue: {
    label: "Rogue",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 4,
    roles: { setup: 14, mobility: 8, damage: 6, debuff: 6, control: 6 },
    signatureActions: {
      "debilitating-strike": 24,
      "sneak-attack": 20,
      "twin-feint": 22,
      "poison-weapon": 20,
      "analyze-weakness": 20,
      feint: 8,
      "create-a-diversion": 8,
    },
  },
  runesmith: {
    label: "Runesmith",
    classAction: 10,
    meleeStrike: 4,
    rangedStrike: 4,
    roles: { setup: 10, buff: 10, damage: 8, control: 6, defense: 6 },
    signatureActions: {
      "trace-rune": 30,
      "invoke-rune": 26,
      "etched-rune": 20,
    },
  },
  sorcerer: {
    label: "Sorcerer",
    classAction: 6,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 10, "area-damage": 10, "save-damage": 10 },
    signatureActions: {
      "bloodline-conduit": 22,
      "energy-fusion": 20,
      "dangerous-sorcery": 18,
      "counterspell-spontaneous": 16,
    },
  },
  summoner: {
    label: "Summoner",
    classAction: 8,
    spell: 8,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, summon: 12, buff: 10, control: 8 },
    signatureActions: {
      "act-together": 34,
      "manifest-eidolon": 26,
      "tandem-movement": 24,
      "tandem-strike": 24,
      transpose: 20,
      "defend-summoner": 18,
    },
  },
  swashbuckler: {
    label: "Swashbuckler",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 2,
    roles: { setup: 14, mobility: 10, damage: 8, defense: 4, control: 4 },
    signatureActions: {
      "gain-panache": 30,
      "confident-finisher": 28,
      "opportune-riposte": 16,
      "one-for-all": 20,
      "vexing-tumble": 22,
      feint: 8,
      "tumble-through": 10,
    },
  },
  thaumaturge: {
    label: "Thaumaturge",
    classAction: 10,
    meleeStrike: 6,
    rangedStrike: 6,
    roles: { setup: 14, damage: 6, debuff: 8, control: 6 },
    signatureActions: {
      "exploit-vulnerability": 34,
      "intensify-vulnerability": 28,
      "drink-from-the-chalice": 24,
      "fling-magic": 22,
      "twin-weakness": 24,
      "recall-knowledge": 8,
    },
  },
  witch: {
    label: "Witch",
    classAction: 8,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, debuff: 12, control: 10, buff: 8 },
    signatureActions: {
      "cast-hex": 24,
      "split-hex": 22,
      "sympathetic-strike": 18,
      "familiar-of-flowing-script": 16,
    },
  },
  wizard: {
    label: "Wizard",
    classAction: 6,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 10, "area-damage": 10, control: 12, "resource-recovery": 10 },
    signatureActions: {
      "drain-bonded-item": 28,
      "bond-conservation": 22,
      "spell-protection-array": 18,
      "convincing-illusion": 16,
    },
  },
};

const ROLE_LABELS = {
  "area-damage": "area spells",
  buff: "support",
  control: "control",
  damage: "damage",
  debuff: "debuffs",
  defense: "defense",
  healing: "healing",
  "mobility-attack": "move-and-attack plays",
  mobility: "mobility",
  multiattack: "multiattack plays",
  "resource-recovery": "resource recovery",
  "save-damage": "save spells",
  setup: "setup",
  summon: "summons",
  transformation: "transformation",
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  return value === undefined || value === null ? [] : [value];
}

function classSlugs(profile) {
  return [...new Set([
    ...values(profile?.classSlugs),
    profile?.classSlug,
    profile?.class,
  ].map(normalize).filter(Boolean))];
}

function clampDelta(value) {
  return Math.max(-MAX_CLASS_TACTIC_DELTA, Math.min(MAX_CLASS_TACTIC_DELTA, value));
}

function addDelta(parts, delta, label) {
  const number = Number(delta);
  if (!Number.isFinite(number) || number === 0) return;
  parts.push({ delta: number, label });
}

function entryMatches(value, patterns) {
  const normalizedPatterns = patterns.map(normalize);
  const entryValues = [
    value,
    value?.slug,
    value?.name,
    value?.label,
    value?.sourceId,
    value?.system?.slug?.value,
    value?.system?.slug,
    value?.system?.source?.value,
    value?.system?.source?.id,
  ].map(normalize).filter(Boolean);

  return entryValues.some((entry) =>
    normalizedPatterns.some((pattern) =>
      entry === pattern
        || entry === `effect-${pattern}`
        || entry.includes(pattern),
    ),
  );
}

function entityHasCondition(entity, patterns) {
  const conditions = entity?.conditions;
  if (!conditions) return false;
  if (Array.isArray(conditions)) return conditions.some((condition) => entryMatches(condition, patterns));
  const slugs = Array.isArray(conditions.slugs) ? conditions.slugs : [];
  return slugs.some((slug) => entryMatches(slug, patterns));
}

function entityHasEffect(entity, patterns) {
  return values(entity?.effects).some((effect) => entryMatches(effect, patterns));
}

function targetHasMark(target, patterns) {
  return Boolean(target && (entityHasCondition(target, patterns) || entityHasEffect(target, patterns)));
}

function actionHasNextAction(action, slug) {
  const nextAction = normalize(action?.activityProfile?.nextAction);
  const setupFor = values(action?.setupFor).map(normalize);
  return nextAction === slug || setupFor.includes(slug);
}

function addPlaybookDelta(parts, delta, reason) {
  const number = Number(delta);
  if (!Number.isFinite(number) || number === 0) return;
  parts.push({ delta: number, label: reason, reason });
}

function actionIn(actionSlug, slugs) {
  return slugs.includes(actionSlug);
}

function isStrikeSignal(signals) {
  return signals.includesStrike || signals.isMeleeStrike || signals.isRangedStrike;
}

function isDamageSignal(signals) {
  return isStrikeSignal(signals) || ["damage", "save-damage", "area-damage", "multiattack", "mobility-attack"].includes(signals.role);
}

function isSpellSignal(signals) {
  return signals.isSpell || ["damage", "save-damage", "area-damage", "control", "buff", "healing", "summon"].includes(signals.role);
}

function profileHasState(profile, patterns) {
  return entityHasCondition(profile, patterns) || entityHasEffect(profile, patterns);
}

function hasActiveStance(profile) {
  return values(profile?.combatState?.activeStances).length > 0 || profileHasState(profile, ["stance"]);
}

function contextAllies(signals) {
  return signals.context?.battlefield?.allies ?? signals.context?.allies ?? [];
}

function contextEnemyCount(signals) {
  return (signals.context?.battlefield?.enemies ?? signals.context?.enemies ?? signals.context?.battlefield?.targets ?? []).length;
}

function hasInjuredAlly(signals, threshold = 0.75) {
  return contextAllies(signals).some((ally) => Number(ally?.hpPercent) < threshold);
}

function targetIsOffGuard(target) {
  return targetHasMark(target, ["off-guard", "flat-footed"]);
}

function targetMarked(target, patterns) {
  return targetHasMark(target, patterns);
}

function alchemistPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const mutagenActive = state.mutagenActive === true || profileHasState(profile, ["mutagen"]);

  if (actionSlug === "quick-alchemy") {
    addPlaybookDelta(parts, 34, "Quick Alchemy creates the right tool for the turn.");
  }
  if (actionSlug === "quick-bomber" || action?.activityProfile?.bomb === true) {
    addPlaybookDelta(parts, 24, "Alchemist bomb actions convert reagents into immediate damage.");
  }
  if (actionSlug.includes("mutagen") || action?.activityProfile?.mutagen === true) {
    addPlaybookDelta(parts, mutagenActive ? -36 : 18, mutagenActive
      ? "Mutagen effect already active."
      : "Mutagen can set up better alchemical offense.");
  }
  if (signals.consumable) {
    addPlaybookDelta(parts, signals.role === "healing" && hasInjuredAlly(signals) ? 22 : 12, "Alchemist wants consumables and alchemical tools online.");
  }
  if (signals.isMeleeStrike) {
    addPlaybookDelta(parts, -12, "Alchemist melee Strike is usually fallback damage.");
  }
}

function animistPlaybook(parts, _profile, action, signals, actionSlug) {
  if (actionSlug.includes("apparition") || actionSlug === "circle-of-spirits") {
    addPlaybookDelta(parts, 22, "Animist apparition actions set up spirit magic.");
  }
  if (actionSlug === "grudge-strike") {
    addPlaybookDelta(parts, isStrikeSignal(signals) ? 18 : 8, "Grudge Strike is the Animist martial payoff.");
  }
  if (signals.isSpell) {
    addPlaybookDelta(parts, 10, "Animist should lean on apparition spells over basic Strikes.");
  }
}

function barbarianPlaybook(parts, profile, _action, signals, actionSlug) {
  const raging = profile?.combatState?.rageActive === true || profileHasState(profile, ["rage"]);

  if (actionSlug === "rage") {
    addPlaybookDelta(parts, raging ? -90 : 44, raging ? "Rage is already active." : "Barbarian wants Rage before attacking.");
  }
  if (actionSlug === "renewed-vigor") {
    addPlaybookDelta(parts, raging ? 18 : -28, raging ? "Renewed Vigor pays off active Rage." : "Renewed Vigor wants Rage active first.");
  }
  if (isStrikeSignal(signals) || signals.role === "mobility-attack") {
    addPlaybookDelta(parts, raging ? 24 : -10, raging
      ? "Rage makes Barbarian attacks stronger."
      : "Barbarian attacks want Rage first.");
  }
}

function bardPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const compositionActive = state.compositionActive === true || profileHasState(profile, ["composition", "anthem", "inspire-courage"]);
  const lingeringActive = state.lingeringCompositionActive === true || profileHasState(profile, ["lingering-composition"]);
  const composition = actionSlug.includes("anthem")
    || actionSlug.includes("composition")
    || actionSlug.startsWith("courageous-")
    || action?.activityProfile?.composition === true;

  if (actionSlug === "lingering-composition") {
    addPlaybookDelta(parts, lingeringActive ? -36 : 24, lingeringActive
      ? "Lingering Composition is already active."
      : "Lingering Composition extends Bard support.");
  }
  if (composition && actionSlug !== "lingering-composition") {
    addPlaybookDelta(parts, compositionActive ? -18 : 28, compositionActive
      ? "A composition is already active; avoid redundant anthem spam."
      : "Bard composition should anchor the turn.");
  }
  if (signals.role === "buff" && contextAllies(signals).length) {
    addPlaybookDelta(parts, 14, "Bard support is strongest with allies in the fight.");
  }
}

function championPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const smiteActive = state.smiteActive === true || profileHasState(profile, ["smite"]);

  if (actionSlug === "smite") {
    addPlaybookDelta(parts, smiteActive ? -44 : 26, smiteActive ? "Smite is already active." : "Smite sets up Champion punishment.");
  }
  if (actionSlug === "lay-on-hands" || (signals.role === "healing" && action?.activityProfile?.focus)) {
    addPlaybookDelta(parts, hasInjuredAlly(signals, 0.8) ? 30 : 8, "Champion healing protects wounded allies.");
  }
  if (signals.role === "defense" || actionSlug === "raise-a-shield") {
    addPlaybookDelta(parts, 16, "Champion defense keeps pressure off allies.");
  }
  if (isStrikeSignal(signals) && smiteActive) {
    addPlaybookDelta(parts, 16, "Smite makes this Champion attack better.");
  }
}

function clericPlaybook(parts, _profile, action, signals, actionSlug) {
  if (signals.role === "healing") {
    addPlaybookDelta(parts, hasInjuredAlly(signals, 0.85) ? 34 : 10, "Cleric should stabilize wounded allies.");
  }
  if (actionSlug === "channel-smite") {
    addPlaybookDelta(parts, 24, "Channel Smite converts divine power into a Strike.");
  }
  if (actionSlug === "raise-symbol" || actionSlug === "divine-infusion" || action?.activityProfile?.spellBuff) {
    addPlaybookDelta(parts, 16, "Cleric support action sets up the next divine payoff.");
  }
}

function commanderPlaybook(parts, _profile, _action, signals, actionSlug) {
  const allyCount = contextAllies(signals).length;
  const commandAction = actionIn(actionSlug, [
    "strike-hard",
    "pincer-attack",
    "ready-aim-fire",
    "shields-up",
    "gather-to-me",
    "coordinating-maneuvers",
    "take-the-high-ground",
    "seek-and-destroy",
    "for-talamandor-for-freedom",
  ]);

  if (commandAction || signals.role === "buff") {
    addPlaybookDelta(parts, allyCount ? 28 : -30, allyCount
      ? "Commander tactics are high value with allies to command."
      : "Commander tactics need allies to command.");
  }
  if (signals.role === "mobility" && allyCount) {
    addPlaybookDelta(parts, 14, "Commander movement tactics improve ally positioning.");
  }
}

function druidPlaybook(parts, profile, _action, signals, actionSlug) {
  const inForm = hasActiveStance(profile) || profileHasState(profile, ["wild-shape", "battle-form", "animal-form", "form"]);

  if (actionSlug === "wild-shape") {
    addPlaybookDelta(parts, inForm ? -40 : 26, inForm ? "Battle form is already active." : "Wild Shape opens Druid martial options.");
  }
  if (actionSlug === "form-control") {
    addPlaybookDelta(parts, inForm ? 18 : -24, inForm ? "Form Control extends active Wild Shape." : "Form Control wants a form active first.");
  }
  if (signals.role === "healing" && hasInjuredAlly(signals)) {
    addPlaybookDelta(parts, 18, "Druid healing helps stabilize the front line.");
  }
  if (signals.isSpell && ["area-damage", "control", "summon"].includes(signals.role)) {
    addPlaybookDelta(parts, 12, "Druid spell list rewards terrain control and area pressure.");
  }
}

function exemplarPlaybook(parts, profile, _action, signals, actionSlug) {
  const immanenceActive = profileHasState(profile, ["immanence", "ikon"]);

  if (actionSlug === "shift-immanence") {
    addPlaybookDelta(parts, 24, "Shift Immanence sets up the right ikon.");
  }
  if (actionSlug === "spark-transcendence") {
    addPlaybookDelta(parts, immanenceActive ? 30 : 16, immanenceActive
      ? "Spark Transcendence pays off active immanence."
      : "Spark Transcendence is Exemplar's main class payoff.");
  }
  if (isDamageSignal(signals)) {
    addPlaybookDelta(parts, 10, "Exemplar wants class damage payoffs over filler.");
  }
}

function fighterPlaybook(parts, _profile, action, signals, actionSlug) {
  if (actionIn(actionSlug, ["power-attack", "vicious-swing", "double-slice", "intimidating-strike", "knockdown", "snagging-strike"])) {
    addPlaybookDelta(parts, 22, "Fighter class Strike is stronger than a plain Strike.");
  }
  if (signals.role === "setup" && action?.activityProfile?.appliesCondition) {
    addPlaybookDelta(parts, 14, "Fighter setup can make follow-up Strikes more reliable.");
  }
  if (actionSlug === "reactive-strike") {
    addPlaybookDelta(parts, -30, "Reactive Strike is trigger-based, not normal turn filler.");
  }
}

function guardianPlaybook(parts, _profile, _action, signals, actionSlug) {
  const target = signals.target;
  const taunted = targetMarked(target, ["taunt", "taunted"]);

  if (actionSlug === "taunt") {
    addPlaybookDelta(parts, taunted ? -54 : 40, taunted ? "Target is already taunted." : "Guardian wants Taunt before defensive payoffs.");
  }
  if (signals.role === "defense" || actionSlug === "intercept-attack" || actionSlug === "raise-a-shield") {
    addPlaybookDelta(parts, 22, "Guardian defense protects allies and controls enemy focus.");
  }
  if (signals.role === "control" && taunted) {
    addPlaybookDelta(parts, 12, "Taunted target is easier to punish with Guardian control.");
  }
}

function gunslingerPlaybook(parts, _profile, action, signals, actionSlug) {
  const reloadAction = actionSlug.includes("reload") || action?.activityProfile?.reload || action?.activityProfile?.reloadBeforeStrike;

  if (reloadAction) {
    addPlaybookDelta(parts, 28, "Gunslinger reload action keeps ranged offense online.");
  }
  if (signals.isRangedStrike || signals.reloadBeforeStrike) {
    addPlaybookDelta(parts, 18, "Gunslinger wants ranged Strike lines over melee fallback.");
  }
  if (signals.isMeleeStrike) {
    addPlaybookDelta(parts, -18, "Gunslinger melee Strike is fallback only.");
  }
}

function inventorPlaybook(parts, profile, _action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const overdrive = state.overdriveActive === true || profileHasState(profile, ["overdrive"]);
  const unstableUsed = state.unstableUsed === true || profileHasState(profile, ["unstable"]);

  if (actionSlug === "overdrive") {
    addPlaybookDelta(parts, overdrive ? -70 : 42, overdrive ? "Overdrive is already active." : "Inventor wants Overdrive before attacking.");
  }
  if (actionSlug === "explode" || actionSlug.includes("unstable") || actionSlug === "searing-restoration") {
    addPlaybookDelta(parts, unstableUsed ? -30 : 18, unstableUsed
      ? "Unstable action may already be spent."
      : "Unstable action can be a strong Inventor payoff.");
  }
  if (isDamageSignal(signals)) {
    addPlaybookDelta(parts, overdrive ? 22 : -8, overdrive ? "Overdrive boosts Inventor attacks." : "Inventor attacks want Overdrive first.");
  }
}

function monkPlaybook(parts, profile, action, signals, actionSlug) {
  const stanceActive = hasActiveStance(profile);
  const stanceAction = action?.activityProfile?.stance === true || actionSlug.includes("stance");

  if (stanceAction) {
    addPlaybookDelta(parts, stanceActive ? -42 : 26, stanceActive ? "A stance is already active." : "Monk stance sets up better attacks.");
  }
  if (actionSlug === "flurry-of-blows" || signals.role === "multiattack") {
    addPlaybookDelta(parts, 34, "Flurry-style action is Monk's efficient attack routine.");
  }
  if (actionSlug === "ki-strike") {
    addPlaybookDelta(parts, 20, "Ki Strike sets up Monk burst damage.");
  }
}

function oraclePlaybook(parts, profile, _action, signals, actionSlug) {
  const curseActive = profile?.combatState?.curseActive === true || profileHasState(profile, ["cursebound", "oracular-curse", "curse"]);

  if (actionIn(actionSlug, ["foretell-harm", "whispers-of-weakness", "debilitating-dichotomy", "nudge-the-scales"])) {
    addPlaybookDelta(parts, curseActive ? 22 : 14, curseActive
      ? "Oracle curse state makes revelation payoffs matter."
      : "Oracle revelation action is a class payoff.");
  }
  if (signals.role === "healing" && hasInjuredAlly(signals)) {
    addPlaybookDelta(parts, 18, "Oracle healing can stabilize allies despite curse pressure.");
  }
}

function psychicPlaybook(parts, profile, _action, signals, actionSlug) {
  const unleashed = profile?.combatState?.unleashPsycheActive === true || profileHasState(profile, ["unleash-psyche"]);

  if (actionSlug === "unleash-psyche") {
    addPlaybookDelta(parts, unleashed ? -80 : 44, unleashed ? "Psyche is already unleashed." : "Psychic wants Unleash Psyche before burst spells.");
  }
  if (actionIn(actionSlug, ["psi-burst", "restore-the-mind"]) || (signals.isSpell && ["damage", "save-damage", "area-damage"].includes(signals.role))) {
    addPlaybookDelta(parts, unleashed ? 24 : -8, unleashed
      ? "Unleashed Psyche boosts Psychic burst actions."
      : "Psychic burst wants Unleash Psyche first when available.");
  }
}

function roguePlaybook(parts, _profile, action, signals, actionSlug) {
  const offGuard = targetIsOffGuard(signals.target);
  const createsOpening = actionIn(actionSlug, ["feint", "create-a-diversion", "twin-feint", "analyze-weakness"])
    || action?.activityProfile?.appliesCondition === "off-guard"
    || action?.activityProfile?.acPenalty;

  if (createsOpening) {
    addPlaybookDelta(parts, offGuard ? -18 : 30, offGuard
      ? "Target is already off-guard."
      : "Rogue wants off-guard before damage.");
  }
  if (actionSlug === "poison-weapon") {
    addPlaybookDelta(parts, 18, "Poison Weapon sets up Rogue Strike damage.");
  }
  if (isDamageSignal(signals)) {
    addPlaybookDelta(parts, offGuard ? 24 : -10, offGuard
      ? "Off-guard target enables Rogue payoff damage."
      : "Rogue damage wants off-guard first.");
  }
}

function runesmithPlaybook(parts, _profile, _action, signals, actionSlug) {
  const traced = targetMarked(signals.target, ["traced-rune", "trace-rune", "etched-rune", "rune"]);

  if (actionSlug === "trace-rune" || actionSlug === "etched-rune") {
    addPlaybookDelta(parts, traced ? -42 : 36, traced ? "Target already has a rune traced." : "Runesmith wants a rune traced before invoking.");
  }
  if (actionSlug === "invoke-rune" || signals.role === "damage" || signals.role === "control") {
    addPlaybookDelta(parts, traced ? 26 : -12, traced ? "Invoke Rune pays off a traced rune." : "Invoke Rune wants a traced rune first.");
  }
}

function sorcererPlaybook(parts, _profile, action, signals, actionSlug) {
  if (actionIn(actionSlug, ["bloodline-conduit", "energy-fusion"]) || action?.activityProfile?.spellBuff) {
    addPlaybookDelta(parts, 20, "Sorcerer class action sets up stronger spell output.");
  }
  if (signals.isSpell && ["damage", "save-damage", "area-damage"].includes(signals.role)) {
    addPlaybookDelta(parts, 16, "Sorcerer should lean into spell damage.");
  }
  if (signals.isMeleeStrike) {
    addPlaybookDelta(parts, -18, "Sorcerer melee Strike is fallback only.");
  }
}

function summonerPlaybook(parts, profile, _action, signals, actionSlug) {
  const eidolonActive = profile?.combatState?.eidolonManifested === true || profileHasState(profile, ["eidolon-manifested", "manifest-eidolon", "eidolon"]);

  if (actionSlug === "manifest-eidolon") {
    addPlaybookDelta(parts, eidolonActive ? -80 : 44, eidolonActive ? "Eidolon is already manifested." : "Summoner wants Eidolon manifested first.");
  }
  if (actionIn(actionSlug, ["act-together", "tandem-movement", "tandem-strike", "defend-summoner", "transpose"])) {
    addPlaybookDelta(parts, eidolonActive ? 30 : -28, eidolonActive
      ? "Tandem action pays off manifested Eidolon."
      : "Tandem action wants Eidolon manifested first.");
  }
  if (signals.isSpell && eidolonActive) {
    addPlaybookDelta(parts, 8, "Summoner spells pair well with an active Eidolon.");
  }
}

function witchPlaybook(parts, _profile, _action, signals, actionSlug) {
  const hex = actionSlug.includes("hex") || signals.role === "debuff";

  if (actionSlug === "split-hex") {
    addPlaybookDelta(parts, contextEnemyCount(signals) >= 2 ? 24 : -18, contextEnemyCount(signals) >= 2
      ? "Split Hex has multiple enemies to punish."
      : "Split Hex wants multiple valid enemies.");
  }
  if (hex) {
    addPlaybookDelta(parts, 24, "Witch hexes are strong class pressure.");
  }
  if (actionSlug === "sympathetic-strike" || isStrikeSignal(signals)) {
    addPlaybookDelta(parts, -6, "Witch Strikes are usually setup or fallback.");
  }
}

function wizardPlaybook(parts, _profile, action, signals, actionSlug) {
  if (actionSlug === "drain-bonded-item" || action?.activityProfile?.recoversSpellResource) {
    addPlaybookDelta(parts, 20, "Wizard resource recovery can restore a key spell.");
  }
  if (action?.activityProfile?.spellBuff || actionIn(actionSlug, ["bond-conservation", "spell-protection-array", "convincing-illusion"])) {
    addPlaybookDelta(parts, 16, "Wizard class action sets up better spell value.");
  }
  if (signals.isSpell && ["control", "area-damage", "save-damage"].includes(signals.role)) {
    addPlaybookDelta(parts, 18, "Wizard should prioritize high-impact spells.");
  }
  if (signals.isMeleeStrike) {
    addPlaybookDelta(parts, -18, "Wizard melee Strike is fallback only.");
  }
}

function kineticistPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const auraActive = state.kineticistAuraActive === true || state.channelElementsActive === true;
  const isImpulse = signals.isImpulse || actionSlug === "elemental-blast";

  if (actionSlug === "channel-elements") {
    if (auraActive) {
      addPlaybookDelta(parts, -80, "Kinetic aura already active; Channel Elements is redundant.");
    } else {
      addPlaybookDelta(parts, 38, "Channel Elements opens kinetic aura for impulses.");
    }
  }

  if (isImpulse && actionSlug !== "channel-elements") {
    if (auraActive) {
      addPlaybookDelta(parts, 12, "Kinetic aura active; impulses are online.");
    } else if (state.kineticistAuraActive === false || state.channelElementsActive === false) {
      addPlaybookDelta(parts, -44, "Impulse wants Channel Elements active first.");
    }
  }

  if (
    actionSlug === "weapon-infusion"
    || actionSlug === "two-element-infusion"
    || actionHasNextAction(action, "elemental-blast")
  ) {
    addPlaybookDelta(parts, auraActive ? 20 : 8, "Infusion sets up the next Elemental Blast.");
  }
}

function magusPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const isSpellstrike = actionSlug === "spellstrike" || action?.activityProfile?.spellstrike === true;
  const recharge = actionSlug === "recharge-spellstrike" || action?.activityProfile?.rechargeSpellstrike === true;

  if (isSpellstrike) {
    if (state.spellstrikeNeedsRecharge === true || state.spellstrikeCharged === false) {
      addPlaybookDelta(parts, -120, "Spellstrike needs recharge before use.");
    } else if (state.spellstrikeCharged === true) {
      addPlaybookDelta(parts, 42, "Spellstrike is charged.");
    } else {
      addPlaybookDelta(parts, 18, "Spellstrike is Magus' main payoff.");
    }
  }

  if (recharge) {
    if (state.spellstrikeNeedsRecharge === true || state.spellstrikeCharged === false) {
      addPlaybookDelta(parts, 44, "Recharge Spellstrike restores Magus' main payoff.");
    } else if (state.spellstrikeCharged === true) {
      addPlaybookDelta(parts, -80, "Spellstrike is already charged.");
    }
  }

  if (actionSlug === "arcane-cascade") {
    if (state.arcaneCascadeActive) {
      addPlaybookDelta(parts, -70, "Arcane Cascade is already active.");
    } else {
      addPlaybookDelta(parts, 18, "Arcane Cascade sets up Magus follow-up damage.");
    }
  }

  if (!isSpellstrike && (signals.includesStrike || signals.isMeleeStrike || signals.isRangedStrike) && state.spellstrikeCharged === true) {
    addPlaybookDelta(parts, -10, "Charged Magus usually wants Spellstrike over a plain Strike.");
  }
}

function thaumaturgePlaybook(parts, profile, action, signals, actionSlug) {
  const target = signals.target;
  const state = profile?.combatState ?? {};
  const exploited = state.exploitVulnerabilityActive === true
    || targetHasMark(target, ["exploited-vulnerability", "exploit-vulnerability", "personal-antithesis", "mortal-weakness"]);

  if (actionSlug === "exploit-vulnerability") {
    if (exploited) {
      addPlaybookDelta(parts, -90, "Target is already exploited.");
    } else {
      addPlaybookDelta(parts, 42, "Exploit Vulnerability should come before Thaumaturge attacks.");
    }
  }

  if (actionSlug === "intensify-vulnerability") {
    if (exploited) {
      addPlaybookDelta(parts, 28, "Intensify Vulnerability pays off an exploited target.");
    } else {
      addPlaybookDelta(parts, -60, "Intensify wants an exploited target first.");
    }
  }

  if (signals.includesStrike || signals.isMeleeStrike || signals.isRangedStrike || signals.role === "damage") {
    if (exploited) {
      addPlaybookDelta(parts, 24, "Exploited target makes Thaumaturge damage better.");
    } else {
      addPlaybookDelta(parts, -8, "Thaumaturge damage wants Exploit Vulnerability first.");
    }
  }
}

function rangerPlaybook(parts, profile, action, signals, actionSlug) {
  const target = signals.target;
  const state = profile?.combatState ?? {};
  const hunted = state.huntedPreyActive === true
    || targetHasMark(target, ["hunted-prey", "hunt-prey"]);

  if (actionSlug === "hunt-prey") {
    if (hunted) {
      addPlaybookDelta(parts, -80, "Target is already hunted prey.");
    } else {
      addPlaybookDelta(parts, 38, "Hunt Prey should come before Ranger attacks.");
    }
  }

  if (
    actionSlug === "hunted-shot"
    || actionSlug === "twin-takedown"
    || actionSlug === "hunters-aim"
    || signals.includesStrike
    || signals.isMeleeStrike
    || signals.isRangedStrike
  ) {
    if (hunted) {
      addPlaybookDelta(parts, 24, "Hunted prey makes Ranger attacks better.");
    } else {
      addPlaybookDelta(parts, -10, "Ranger attacks want Hunt Prey first.");
    }
  }
}

function investigatorPlaybook(parts, profile, action, signals, actionSlug) {
  const target = signals.target;
  const state = profile?.combatState ?? {};
  const devised = state.deviseStratagemActive === true
    || targetHasMark(target, ["devise-a-stratagem", "devised-stratagem"]);

  if (actionSlug === "devise-a-stratagem") {
    if (devised) {
      addPlaybookDelta(parts, -80, "Devise a Stratagem is already active.");
    } else {
      addPlaybookDelta(parts, 40, "Devise a Stratagem should come before Investigator attacks.");
    }
  }

  if (signals.includesStrike || signals.isMeleeStrike || signals.isRangedStrike || signals.role === "damage") {
    if (devised) {
      addPlaybookDelta(parts, 26, "Devised Stratagem supports this attack.");
    } else {
      addPlaybookDelta(parts, -12, "Investigator attacks want Devise a Stratagem first.");
    }
  }
}

function swashbucklerPlaybook(parts, profile, action, signals, actionSlug) {
  const state = profile?.combatState ?? {};
  const panache = state.panacheActive === true;
  const gainsPanache = actionSlug === "gain-panache"
    || actionSlug === "tumble-through"
    || actionSlug === "feint"
    || actionSlug === "one-for-all"
    || actionSlug === "bon-mot"
    || actionSlug === "create-a-diversion"
    || action?.activityProfile?.gainPanache === true;
  const finisher = actionSlug.includes("finisher")
    || action?.activityProfile?.finisher === true;

  if (finisher) {
    if (panache) {
      addPlaybookDelta(parts, 44, "Panache active; finisher is ready.");
    } else {
      addPlaybookDelta(parts, -100, "Finisher needs panache first.");
    }
  }

  if (gainsPanache) {
    if (panache) {
      addPlaybookDelta(parts, -24, "Panache already active; gaining panache is lower value.");
    } else {
      addPlaybookDelta(parts, 34, "Swashbuckler wants panache before finishers.");
    }
  }

  if ((signals.includesStrike || signals.isMeleeStrike || signals.isRangedStrike) && panache && !finisher) {
    addPlaybookDelta(parts, -8, "Panache active; consider a finisher payoff.");
  }
}

function classPlaybookAdjustment(slug, parts, profile, action, signals, actionSlug) {
  if (slug === "alchemist") alchemistPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "animist") animistPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "barbarian") barbarianPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "bard") bardPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "champion") championPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "cleric") clericPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "commander") commanderPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "druid") druidPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "exemplar") exemplarPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "fighter") fighterPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "guardian") guardianPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "gunslinger") gunslingerPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "inventor") inventorPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "investigator") investigatorPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "kineticist") kineticistPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "magus") magusPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "monk") monkPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "oracle") oraclePlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "psychic") psychicPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "ranger") rangerPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "rogue") roguePlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "runesmith") runesmithPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "sorcerer") sorcererPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "summoner") summonerPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "swashbuckler") swashbucklerPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "thaumaturge") thaumaturgePlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "witch") witchPlaybook(parts, profile, action, signals, actionSlug);
  if (slug === "wizard") wizardPlaybook(parts, profile, action, signals, actionSlug);
}

function summarize(label, parts) {
  const positive = parts.filter((part) => part.delta > 0).map((part) => part.label);
  const negative = parts.filter((part) => part.delta < 0).map((part) => part.label);
  if (positive.length) return `${label} tactic favors ${[...new Set(positive)].slice(0, 2).join(" and ")}.`;
  if (negative.length) return `${label} tactic de-prioritizes ${[...new Set(negative)].slice(0, 2).join(" and ")}.`;
  return null;
}

export function classTacticAdjustment(profile, action, signals = {}) {
  const actorClasses = classSlugs(profile);
  if (!actorClasses.length) return { scoreDelta: 0, reasons: [] };

  const actionSlug = normalize(action?.tacticSlug ?? action?.activityProfile?.tacticSlug ?? action?.slug);
  const traits = new Set(values(signals.traits).map(normalize));
  const reasons = [];
  let total = 0;

  for (const slug of actorClasses) {
    const tactic = CLASS_TACTICS[slug];
    if (!tactic) continue;

    const parts = [];
    const signatureDelta = tactic.signatureActions?.[actionSlug] ?? tactic.slugs?.[actionSlug];
    addDelta(parts, signatureDelta, `${action?.name ?? actionSlug} signature`);
    if (traits.has(slug)) addDelta(parts, tactic.classAction ?? 4, "class actions");
    if (signals.isImpulse) addDelta(parts, tactic.impulseAction, "impulses");
    if (signals.isSpell) addDelta(parts, tactic.spell, "spells");
    if (signals.isMeleeStrike) addDelta(parts, tactic.meleeStrike, "melee Strikes");
    if (signals.isRangedStrike) addDelta(parts, tactic.rangedStrike, "ranged Strikes");
    if (signals.includesStrike) addDelta(parts, tactic.includesStrike, "Strike activities");
    if (signals.reloadBeforeStrike) addDelta(parts, tactic.reloadBeforeStrike, "reload attacks");
    if (signals.consumable) addDelta(parts, tactic.consumable, "consumables");

    const roleDelta = tactic.roles?.[signals.role];
    addDelta(parts, roleDelta, ROLE_LABELS[signals.role] ?? signals.role);
    classPlaybookAdjustment(slug, parts, profile, action, signals, actionSlug);

    const delta = parts.reduce((sum, part) => sum + part.delta, 0);
    if (!delta) continue;

    total += delta;
    const playbookReason = parts.find((part) => part.reason)?.reason;
    if (playbookReason) reasons.push(playbookReason);
    const reason = summarize(tactic.label, parts);
    if (reason) reasons.push(reason);
  }

  return {
    scoreDelta: clampDelta(total),
    reasons: reasons.slice(0, 2),
  };
}
