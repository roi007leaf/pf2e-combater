import { CLASS_TACTICS, SUBCLASS_TACTICS } from "./class-tactics-data/index.js";
import { hasExploitVulnerabilityMark } from "./exploit-vulnerability.js";
import { readTargetCombatState, targetHasMarkState } from "./combat-state.js";

const MAX_CLASS_TACTIC_DELTA = 44;

export function coveredClassSlugs() {
  return Object.keys(CLASS_TACTICS).sort();
}

const ROLE_LABELS = {
  "area-damage": "area spells",
  buff: "support",
  "combat-utility": "combat utility",
  control: "control",
  damage: "damage",
  debuff: "debuffs",
  defense: "defense",
  "exploration-utility": "exploration utility",
  healing: "healing",
  "mobility-attack": "move-and-attack plays",
  mobility: "mobility",
  multiattack: "multiattack plays",
  "resource-recovery": "resource recovery",
  "save-damage": "save spells",
  setup: "setup",
  "stealth-defense": "stealth defense",
  summon: "summons",
  "sustain-control": "sustain control",
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

function subclassSlugs(profile) {
  return [...new Set([
    ...values(profile?.subclassSlugs),
    profile?.subclassSlug,
    ...values(profile?.subclasses).map((entry) => entry?.slug ?? entry?.name ?? entry),
    ...values(profile?.specializationSlugs),
    profile?.specializationSlug,
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
  return signals.isSpell || [
    "damage",
    "save-damage",
    "area-damage",
    "control",
    "buff",
    "stealth-defense",
    "combat-utility",
    "sustain-control",
    "healing",
    "summon",
  ].includes(signals.role);
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
  return targetHasMarkState(target, patterns[0]) || targetHasMark(target, patterns);
}

function activityIncludes(action) {
  return new Set(values(action?.activityProfile?.includes).map(normalize));
}

function addSubclassDeltas(currentClassSlug, actorClasses, parts, profile, action, signals, actionSlug) {
  const actorClassSet = new Set(actorClasses);
  const actionTraits = new Set(values(signals.traits).map(normalize));
  const actionIncludes = activityIncludes(action);

  for (const subclassSlug of subclassSlugs(profile)) {
    const tactic = SUBCLASS_TACTICS[subclassSlug];
    if (!tactic) continue;

    const requiredClasses = [
      ...values(tactic.classSlug),
      ...values(tactic.classSlugs),
    ].map(normalize).filter(Boolean);
    if (requiredClasses.length && !requiredClasses.some((slug) => actorClassSet.has(slug))) continue;
    if (requiredClasses.length && !requiredClasses.includes(currentClassSlug)) continue;

    const entries = [];
    const add = (delta, label) => {
      const number = Number(delta);
      if (!Number.isFinite(number) || number === 0) return;
      entries.push({ delta: number, label });
    };

    add(tactic.actions?.[actionSlug], `${tactic.label} action`);
    add(tactic.roles?.[signals.role], ROLE_LABELS[signals.role] ?? signals.role);

    for (const [trait, delta] of Object.entries(tactic.traits ?? {})) {
      if (actionTraits.has(normalize(trait))) add(delta, `${trait} trait`);
    }
    for (const [include, delta] of Object.entries(tactic.activity ?? {})) {
      if (actionIncludes.has(normalize(include))) add(delta, `${include} action`);
    }

    if (signals.isSpell) add(tactic.spell, "spells");
    if (signals.isImpulse) add(tactic.impulseAction, "impulses");
    if (signals.isMeleeStrike) add(tactic.meleeStrike, "melee Strikes");
    if (signals.isRangedStrike) add(tactic.rangedStrike, "ranged Strikes");
    if (signals.includesStrike) add(tactic.includesStrike, "Strike activities");
    if (signals.reloadBeforeStrike) add(tactic.reloadBeforeStrike, "reload attacks");
    if (signals.consumable) add(tactic.consumable, "consumables");

    const delta = entries.reduce((sum, entry) => sum + entry.delta, 0);
    if (!delta) continue;

    const label = tactic.reason
      ?? `${tactic.label} favors ${[...new Set(entries.map((entry) => entry.label))].slice(0, 2).join(" and ")}.`;
    addPlaybookDelta(parts, Math.max(-36, Math.min(36, delta)), label);
  }
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
  const traitSet = new Set(values(signals.traits).map(normalize));
  const overflow = action?.activityProfile?.overflow === true || traitSet.has("overflow");

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
      if (overflow) addPlaybookDelta(parts, 18, "Overflow impulse spends the aura for a strong payoff.");
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
  const targetState = readTargetCombatState(target);
  const exploited = targetState.exploited || hasExploitVulnerabilityMark(target);

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
    } else if (state.exploitVulnerabilityActive === true) {
      addPlaybookDelta(parts, -4, "This target is not the exploited target.");
    } else {
      addPlaybookDelta(parts, -8, "Thaumaturge damage wants Exploit Vulnerability first.");
    }
  }
}

function rangerPlaybook(parts, profile, action, signals, actionSlug) {
  const target = signals.target;
  const state = profile?.combatState ?? {};
  const targetState = readTargetCombatState(target);
  const hunted = targetState.huntedPrey;

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
    } else if (state.huntedPreyActive === true) {
      addPlaybookDelta(parts, -6, "This target is not the hunted prey.");
    } else {
      addPlaybookDelta(parts, -10, "Ranger attacks want Hunt Prey first.");
    }
  }
}

function investigatorPlaybook(parts, profile, action, signals, actionSlug) {
  const target = signals.target;
  const state = profile?.combatState ?? {};
  const targetState = readTargetCombatState(target);
  const devised = targetState.devisedStratagem;

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
    } else if (state.deviseStratagemActive === true) {
      addPlaybookDelta(parts, -8, "This target is not the devised target.");
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
    addSubclassDeltas(slug, actorClasses, parts, profile, action, signals, actionSlug);

    const delta = parts.reduce((sum, part) => sum + part.delta, 0);
    if (!delta) continue;

    total += delta;
    const playbookReasons = [...new Set(parts.filter((part) => part.reason).map((part) => part.reason))];
    reasons.push(...playbookReasons.slice(0, 2));
    const reason = summarize(tactic.label, parts);
    if (reason) reasons.push(reason);
  }

  return {
    scoreDelta: clampDelta(total),
    reasons: reasons.slice(0, 3),
  };
}
