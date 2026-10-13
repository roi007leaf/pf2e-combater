import assert from "node:assert/strict";
import { computePlayerTacticPersonality, tacticPersonalityAdjustment, tacticPersonalityPlanAdjustment } from "../../rules/tactic-personality.js";
import { scoreCandidate } from "../scoring.js";
import { attacksTowardMap, buildTurnPlans, mapPenalty } from "../planner.js";
import { appliesProne } from "../planner/projections.js";
import { FIGHTER_ACTIONS } from "../../catalog/class-actions/fighter.js";
import { readStrikeStepAwayActivities } from "../../readers/positional/step-away-reader.js";
import { orphanSetupSteps } from "../planner.js";
import { hasPlanConflict } from "../planner/conflicts.js";
import { advancePlanState, createPlanState, projectContextFromPlanState } from "../plan-state.js";
import { GUARDIAN_ACTIONS } from "../../catalog/class-actions/guardian.js";
import { targetAlreadyHasBuff } from "../scoring/buffs.js";
import { classifySystemAction } from "../action/classifier.js";
import { endPositionDanger } from "../planner/danger.js";
import { nextTurnReadiness } from "../planner/lookahead.js";
import { planComparison } from "../../ui/plan-selection.js";
import { isRepeatablePlanningAction } from "../planner/conflicts.js";
import { stepSatisfiesPreviousRequirement } from "../planner/rules.js";
import { damageAverage } from "../scoring/facts.js";
import { rechargeAvailability, rechargeFormula } from "../npc-recharge-state.js";
import { movementFootprintForToken } from "../../rules/token-geometry.js";
import { MODULE_ID } from "../../constants.js";

// Player tactic audit regressions (one block per finding group).

function weapon(name, { die = "d8", ranged = false, category = "martial", striking = 0, traits = [], ready = true } = {}) {
  const item = { id: name, name, type: "weapon", isRanged: ranged, system: { category, damage: { dice: 1, die }, runes: { striking }, range: ranged ? 100 : null, traits: { value: traits } } };
  return { type: "strike", slug: name.toLowerCase(), label: name, visible: true, ready, item, traits: [] };
}

function spell(name, traits = [], { damage = false, description = "" } = {}) {
  return { id: name, name, type: "spell", system: { slug: name.toLowerCase().replace(/\s+/g, "-"), traits: { value: traits }, damage: damage ? { 0: { formula: "2d6" } } : {}, description: { value: description } } };
}

function pc(classSlug, { strikes = [], spells = [], feats = [], hasShield = false } = {}) {
  const items = [{ type: "class", slug: classSlug, name: classSlug }, ...spells, ...feats];
  const itemTypes = {};
  for (const item of items) (itemTypes[item.type] ??= []).push(item);
  const actor = { type: "character", items, itemTypes, system: { actions: strikes }, getFlag: () => undefined };
  const context = { isGM: false, actor: { document: actor }, profile: { actorType: "character", hasShield } };
  return computePlayerTacticPersonality(context, actor).role;
}

const fist = weapon("Fist", { die: "d4", category: "unarmed" });
const passiveFluff = [
  { type: "feat", name: "Armor Expertise", system: { description: { value: "You gain a +1 status bonus to AC while wearing armor and a shield." } } },
  { type: "feat", name: "Inspiring Aura", system: { description: { value: "Allies in your aura gain a bonus." } } },
];

// A. Auto: class, best ready weapon and what spells do -- never feat/gear descriptions.
assert.equal(pc("fighter", { strikes: [fist, weapon("Longsword")], feats: passiveFluff, hasShield: true }), "melee-striker",
  "a shield fighter with defensive feats is still a Melee Striker");
assert.equal(pc("ranger", { strikes: [fist, weapon("Shortsword", { die: "d6" }), weapon("Longbow", { ranged: true })] }), "ranged-striker",
  "the basic Fist doesn't make a longbow ranger melee");
assert.equal(pc("ranger", { strikes: [weapon("Longsword", { striking: 1 }), weapon("Longbow", { ranged: true, ready: false })] }), "melee-striker",
  "a stowed bow doesn't count");
assert.equal(pc("monk", { strikes: [fist] }), "melee-striker", "an unarmed monk is melee");
assert.equal(pc("gunslinger", { strikes: [fist, weapon("Pistol", { ranged: true, die: "d6" })] }), "ranged-striker");
assert.equal(pc("champion", { strikes: [weapon("Longsword")], hasShield: true }), "defender");
assert.equal(pc("cleric", { spells: [spell("Heal", ["healing"]), spell("Bless", [], { description: "Allies gain a status bonus." })] }), "healer");
assert.equal(pc("bard", { spells: [spell("Courageous Anthem", ["cantrip", "composition"], { description: "You and allies gain a status bonus." })] }), "buffer");
assert.equal(pc("witch", {
  spells: [spell("Evil Eye", ["cantrip", "curse", "hex"]), spell("Daze", ["cantrip", "nonlethal"], { damage: true }), spell("Ill Omen", ["curse", "misfortune"]), spell("Void Warp", ["cantrip"], { damage: true })],
}), "debuffer", "a witch's curses and conditions make her a Debuffer");
assert.equal(pc("wizard", {
  spells: [spell("Fireball", [], { damage: true }), spell("Electric Arc", ["cantrip"], { damage: true }), spell("Detect Magic", ["cantrip", "detection"]), spell("Light", ["cantrip", "light"])],
}), "spell-damage", "utility cantrips don't decide a wizard's role");
assert.equal(pc("wizard", { spells: [spell("Fireball", [], { damage: true }), spell("Fireball", [], { damage: true }), spell("Fireball", [], { damage: true })] }), "spell-damage");


// ---- shared player context ------------------------------------------------------------------
function rolePc(role, { enemies = [{ id: "orc", name: "Orc", distance: 5, ac: 18, hpPercent: 1, conditions: { slugs: [], values: {} } }], allies = [], profile = {} } = {}) {
  const flags = { "pf2e-combater": { tacticPersonality: { role, temperament: "auto" } } };
  const document = { type: "character", flags, getFlag: (moduleId, key) => flags?.[moduleId]?.[key], system: { actions: [] }, items: [], itemTypes: {} };
  const fullProfile = { actorType: "character", level: 5, speed: 25, hpPercent: 1, conditions: { slugs: [], values: {} }, skills: {}, ...profile };
  return {
    isGM: false,
    actor: { id: "pc", name: "PC", document, profile: fullProfile },
    token: { id: "pc-token", document: { type: "character", flags: {}, getFlag: () => undefined } },
    profile: fullProfile,
    targets: enemies,
    battlefield: { targets: enemies, enemies, allies },
    allies,
  };
}
const sword = { type: "weapon", isRanged: false, system: { damage: { dice: 1, die: "d8" } } };
const bowItem = { type: "weapon", isRanged: true, system: { range: { increment: 100 }, damage: { dice: 1, die: "d8" } } };
const delta = (context, action) => tacticPersonalityAdjustment(context, action, { role: action.role }).scoreDelta;

// B. Composites and feats take melee/ranged from their weapon; debuffs and area damage by effect.
{
  const melee = rolePc("melee-striker");
  const strideSword = { id: "stride-strike-sword", slug: "stride-strike-sword", name: "Stride -> Longsword", source: "system-inferred", role: "mobility-attack", actionCost: 2, item: sword, activityProfile: { includesStrike: true, strideCount: 1 } };
  const strideAwayBow = { id: "stride-away-strike-bow", slug: "stride-away-strike-bow", name: "Stride Away -> Shortbow", source: "system-inferred", role: "mobility-attack", actionCost: 2, item: bowItem, activityProfile: { includesStrike: true, retreatBeforeStrike: true, strideCount: 1 } };
  assert.ok(delta(melee, strideSword) > 0, "Stride -> Longsword is melee for a Melee Striker");
  assert.ok(delta(melee, strideAwayBow) < 0, "stepping back to shoot is not melee play");
  const ranged = rolePc("ranged-striker");
  const huntedShot = { id: "hunted-shot", slug: "hunted-shot", name: "Hunted Shot", source: "class-curated", role: "multiattack", actionCost: 1, activityProfile: { includesStrike: true, multiStrike: true, requiresBackingStrike: true, backingStrikeFilter: "ranged-reload-zero" } };
  assert.ok(delta(ranged, huntedShot) > delta(ranged, strideSword), "Hunted Shot counts as ranged");
  assert.ok(tacticPersonalityPlanAdjustment(ranged, [strideSword, { id: "bow", source: "strike", role: "damage", item: bowItem, actionCost: 1 }], null, null).scoreDelta
    < tacticPersonalityPlanAdjustment(ranged, [{ id: "bow", source: "strike", role: "damage", item: bowItem, actionCost: 1 }], null, null).scoreDelta,
  "walking into melee and shooting once doesn't buy the full Ranged Striker bonus");

  const debuffer = rolePc("debuffer");
  const slow = { id: "slow", slug: "slow", name: "Slow", source: "spell-curated", role: "control", actionCost: 2, targetingProfile: { enemy: true, maxRange: 30 }, activityProfile: { appliesCondition: "slowed" } };
  const daze = { id: "daze", slug: "daze", name: "Daze", source: "spell-curated", role: "save-damage", actionCost: 2, damageProfile: { average: 3 }, targetingProfile: { enemy: true, maxRange: 60 }, activityProfile: { appliesCondition: "stunned" } };
  assert.ok(tacticPersonalityPlanAdjustment(debuffer, [slow], null, null).scoreDelta > 0, "Slow is a debuff");
  assert.ok(tacticPersonalityPlanAdjustment(debuffer, [daze], null, null).scoreDelta > 0, "Daze's damage doesn't make it off-role");

  const caster = rolePc("spell-damage");
  const colors = { id: "dizzying-colors", slug: "dizzying-colors", name: "Dizzying Colors", source: "spell-curated", role: "control", actionCost: 2, targetingProfile: { enemy: true, maxRange: 30 }, activityProfile: { area: true, appliesCondition: "dazzled" } };
  const arc = { id: "electric-arc", slug: "electric-arc", name: "Electric Arc", source: "spell-curated", role: "save-damage", actionCost: 2, damageProfile: { average: 5 }, targetingProfile: { enemy: true, maxRange: 30 } };
  assert.ok(delta(caster, arc) > delta(caster, colors), "a no-damage area spell isn't area damage");
  assert.ok(delta(caster, arc) > 0, "Spell Damage doesn't penalise its own ranged spells");

  const buffer = rolePc("buffer");
  const heal = { id: "heal", slug: "heal", name: "Heal", source: "spell-curated", role: "healing", actionCost: 2, damageProfile: { average: 4.5, type: "vitality" }, targetingProfile: { ally: true, self: true, maxRange: 30 } };
  assert.ok(tacticPersonalityPlanAdjustment(buffer, [heal], null, null).scoreDelta >= 0, "Heal isn't 'damage' to a Buffer");
}

// C. Roles fire only on real options; Healer, buffs, Defender.
{
  const melee = rolePc("melee-striker");
  const bow = { id: "bow", source: "strike", role: "damage", item: bowItem, actionCost: 1, score: 60 };
  const farSword = { id: "sword", source: "strike", role: "damage", item: sword, actionCost: 1, score: 50, needsApproach: true };
  assert.equal(tacticPersonalityPlanAdjustment(melee, [bow, bow], null, [bow, farSword]).scoreDelta, 0,
    "a melee Strike that can't reach this turn isn't 'on offer'");
  assert.ok(delta({ ...melee }, bow) < 0);
  assert.equal(tacticPersonalityAdjustment(melee, bow, { role: "damage", siblings: [bow, farSword] }).scoreDelta >= 0, true,
    "with no melee in reach, the Melee Striker isn't pushed off its bow");

  const healthy = rolePc("healer", { allies: [{ id: "ally", name: "Fighter", distance: 5, hpPercent: 0.95, conditions: { slugs: [], values: {} } }] });
  const heal1 = { id: "heal-1", slug: "heal", name: "Heal", source: "spell-curated", role: "healing", actionCost: 1, targetingProfile: { ally: true, self: true, maxRange: 5 } };
  const idle = scoreCandidate(healthy, heal1);
  assert.ok(idle.score < 0 && idle.score > -999, `a Healer's heal on a healthy party stays listed but below zero (${idle.score})`);
  const hurt = rolePc("healer", { allies: [{ id: "ally", name: "Fighter", distance: 5, hpPercent: 0.6, conditions: { slugs: [], values: {} } }] });
  assert.ok(scoreCandidate(hurt, heal1).score > 0, "a Healer heals an ally at 60%");

  const heroism = { id: "heroism", slug: "heroism", name: "Heroism", source: "spell-curated", role: "buff", actionCost: 2, targetingProfile: { ally: true, self: true }, activityProfile: { spellBuff: true, attackBuff: true, effectSlug: "spell-effect-heroism" } };
  const buffed = rolePc("buffer", { profile: { effects: [{ slug: "spell-effect-heroism" }] }, allies: [{ id: "ally", name: "Fighter", distance: 10, hpPercent: 1, effects: [{ slug: "spell-effect-heroism" }], conditions: { slugs: [], values: {} } }] });
  const recast = scoreCandidate(buffed, heroism);
  assert.ok(recast.score <= -999 || /already/i.test(recast.reason ?? ""), `a buff everyone has isn't recast (${recast.score}: ${recast.reason})`);

  const defender = rolePc("defender");
  const shield = { id: "raise-a-shield", slug: "raise-a-shield", name: "Raise a Shield", source: "generic", role: "defense", actionCost: 1 };
  assert.ok(tacticPersonalityPlanAdjustment(defender, [bow, bow, shield], null, null).scoreDelta
    < tacticPersonalityPlanAdjustment(defender, [strideSwordFor(), shield], null, null).scoreDelta,
  "Defender prefers closing in to shooting, shield either way");
}
function strideSwordFor() {
  return { id: "stride-strike-sword", slug: "stride-strike-sword", source: "system-inferred", role: "mobility-attack", actionCost: 2, item: sword, activityProfile: { includesStrike: true, strideCount: 1 } };
}

// E. Rules: Power Attack MAP, crossbow reload, own-prone only, debuffs not re-applied, heals spread,
// Lingering needs a composition, Reach Spell brings a spell into range.
{
  const powerAttack = FIGHTER_ACTIONS.find((entry) => entry.slug === "power-attack");
  assert.equal(attacksTowardMap({ ...powerAttack, source: "class-curated", attackTrait: true }), 2, "Power Attack counts as two attacks");
  assert.equal(appliesProne({ slug: "grease", targetingProfile: { enemy: true }, activityProfile: { appliesCondition: "prone" } }), false, "Grease knocks *them* prone");
  assert.equal(appliesProne({ slug: "generic-drop-prone" }), true);

  const proneOrc = rolePc("auto", { enemies: [{ id: "orc", name: "Orc", distance: 5, conditions: { slugs: ["prone"], values: {} } }] });
  assert.equal(scoreCandidate(proneOrc, { id: "trip", slug: "trip", name: "Trip", source: "generic", actionCost: 1 }).score, -999, "no Trip on a prone target");
  const trained = { skills: { intimidation: { rank: 1, mod: 10 }, athletics: { rank: 1, mod: 10 } } };
  const scared = rolePc("auto", { profile: trained, enemies: [{ id: "orc", name: "Orc", distance: 5, conditions: { slugs: ["frightened"], values: { frightened: 2 } } }] });
  const fresh = rolePc("auto", { profile: trained });
  const demoralize = { id: "demoralize", slug: "demoralize", name: "Demoralize", source: "generic", role: "debuff", actionCost: 1, skill: "intimidation" };
  assert.ok(scoreCandidate(scared, demoralize).score < scoreCandidate(fresh, demoralize).score - 40, "no Demoralize on frightened 2");

  const crossbowItem = { id: "xbow", name: "Heavy Crossbow", type: "weapon", isRanged: true, system: { reload: { value: 1 }, range: { increment: 120 } } };
  const awayShot = { id: "stride-away-strike-xbow", slug: "stride-away-strike-xbow", name: "Stride Away -> Heavy Crossbow", source: "system-inferred", role: "mobility-attack", actionCost: 2, score: 150, confidence: "high", item: crossbowItem, activityProfile: { includesStrike: true, retreatBeforeStrike: true, strideCount: 1, includes: ["stride", "strike"] } };
  const shot = { id: "strike-xbow", slug: "strike", name: "Heavy Crossbow", source: "strike", role: "damage", actionCost: 1, score: 80, confidence: "high", item: crossbowItem, reload: 1, range: { increment: 120, max: 720 } };
  const xbowPlans = buildTurnPlans(fresh, [awayShot, shot], { includeCoverage: false });
  for (const plan of xbowPlans) {
    const fired = plan.steps.filter((step) => step.activityProfile?.includesStrike || step.source === "strike");
    if (fired.length >= 2) assert.ok(plan.steps.some((step) => step.reloadCost > 0), `two crossbow shots need a Reload: ${plan.summary}`);
  }

  const lingering = { id: "lingering-composition", slug: "lingering-composition", name: "Lingering Composition", source: "spell-curated", actionCost: 1, score: 60, confidence: "high", activityProfile: { compositionExtender: true, spellshape: true } };
  const strike = { id: "strike-rapier", slug: "strike", name: "Rapier", source: "strike", actionCost: 1, score: 70, confidence: "high", range: { max: 5 } };
  assert.ok(!buildTurnPlans(fresh, [lingering, strike], { includeCoverage: false }).some((plan) => plan.steps.some((step) => step.slug === "lingering-composition")),
    "Lingering Composition is never planned without a composition after it");

  const twoHurt = rolePc("healer", { allies: [
    { id: "fighter", name: "Fighter", distance: 5, hpPercent: 0.4, conditions: { slugs: [], values: {} } },
    { id: "rogue", name: "Rogue", distance: 5, hpPercent: 0.45, conditions: { slugs: [], values: {} } },
  ] });
  const lay = { id: "lay-on-hands", slug: "lay-on-hands", name: "Lay on Hands", source: "spell-curated", role: "healing", actionCost: 1, confidence: "high", targetingProfile: { ally: true, self: true, maxRange: 5 } };
  const heal = { id: "heal-1", slug: "heal", name: "Heal", source: "spell-curated", role: "healing", actionCost: 1, confidence: "high", targetingProfile: { ally: true, self: true, maxRange: 5 } };
  const healPlans = buildTurnPlans(twoHurt, [scoreCandidate(twoHurt, lay), scoreCandidate(twoHurt, heal)], { includeCoverage: false });
  const both = healPlans.find((plan) => plan.steps.length >= 2 && plan.steps.every((step) => step.role === "healing"));
  assert.ok(both, "a two-heal plan exists");
  assert.deepEqual(new Set(both.steps.map((step) => step.suggestedTarget?.id)).size, 2, `heals go to both hurt allies: ${both.steps.map((step) => step.suggestedTarget?.name).join(", ")}`);

  const far = rolePc("spell-damage", { enemies: [{ id: "ogre", name: "Ogre", distance: 50, hpPercent: 1, conditions: { slugs: [], values: {} } }] });
  const reach = { id: "reach-spell", slug: "reach-spell", name: "Reach Spell", source: "system-inferred", role: "setup", actionCost: 1, score: 40, confidence: "high", activityProfile: { rangeBuff: true, spellshape: true, spellBuff: true }, targetingProfile: { self: true } };
  const ray = { id: "ray", slug: "ray", name: "Ray of Frost", source: "spell-curated", role: "damage", actionCost: 2, confidence: "high", needsApproach: true, score: -999, damageProfile: { average: 9 }, targetingProfile: { enemy: true, maxRange: 30 }, suggestedTarget: { id: "ogre", name: "Ogre" }, isCantrip: true };
  const reachPlans = buildTurnPlans(far, [reach], { includeCoverage: false, approachCandidates: [ray] });
  assert.ok(reachPlans.some((plan) => plan.steps.map((step) => step.slug).join(">") === "reach-spell>ray"),
    `Reach Spell brings a 30 ft spell to a target 50 ft away: ${reachPlans.map((plan) => plan.summary).join(" | ")}`);
}

// D. Skirmisher hits and steps away.
{
  const skirm = rolePc("skirmisher");
  const rapier = { id: "strike-rapier", name: "Rapier", slug: "strike", source: "strike", actionCost: 1, available: true, range: { max: 5 }, item: sword, averageDamage: 7 };
  const composites = readStrikeStepAwayActivities(skirm, [rapier]);
  assert.deepEqual(composites.map((action) => action.name), ["Rapier -> Step Away"]);
  assert.equal(composites[0].activityProfile.retreatAfterStrike, true);
  assert.deepEqual(readStrikeStepAwayActivities(rolePc("melee-striker"), [rapier]), [], "only a Skirmisher gets it");
}

// ---- Quality sweep fixes (990-scenario iconic sweep) ---------------------------------------
{
  const fresh = rolePc("auto", { profile: { skills: { athletics: { rank: 1, mod: 10 } }, handsFree: 1 } });

  // 1. A plain Draw no Strike uses is wasted; Draw -> Strike isn't.
  const drawDagger = { id: "draw-dagger", slug: "draw-dagger", name: "Draw Dagger", source: "system-inferred", role: "setup", actionCost: 1, score: 90, item: { id: "dagger", name: "Dagger", type: "weapon" }, activityProfile: { drawsWeapon: true, weaponName: "Dagger" } };
  const rapierStrike = { id: "strike-rapier", slug: "strike", name: "Rapier", source: "strike", role: "damage", actionCost: 1, score: 120, item: { id: "rapier", name: "Rapier", type: "weapon" } };
  assert.deepEqual(orphanSetupSteps([drawDagger, rapierStrike], [drawDagger, rapierStrike]).map((step) => step.name), ["Draw Dagger"],
    "drawing a dagger and then attacking with the rapier wastes the Draw");
  const daggerStrike = { ...rapierStrike, id: "strike-dagger", name: "Dagger", item: { id: "dagger", name: "Dagger", type: "weapon" } };
  assert.deepEqual(orphanSetupSteps([drawDagger, daggerStrike], [drawDagger, daggerStrike]), [], "drawing the weapon you then attack with is fine");

  // 2. With no attack in reach, a Stride toward the enemy beats filler.
  const far = rolePc("auto", { enemies: [{ id: "orc", name: "Orc", distance: 80, hpPercent: 1, conditions: { slugs: [], values: {} } }] });
  const stride = { id: "generic-stride", slug: "stride", name: "Stride", source: "generic", actionCost: 1, suggestedTarget: { id: "orc", name: "Orc" } };
  const outOfReachSword = { id: "strike-sword", slug: "strike", name: "Longsword", source: "strike", actionCost: 1, available: false, range: { max: 5 } };
  const recall = { id: "recall-knowledge", slug: "recall-knowledge", name: "Recall Knowledge", source: "generic", actionCost: 1 };
  assert.ok(scoreCandidate(far, stride, [], [stride, outOfReachSword]).score > scoreCandidate(far, recall, [], [stride, outOfReachSword]).score,
    "closing on an enemy nothing can reach beats Recall Knowledge");

  // 3/4. Out-of-reach move-and-Strike is unusable from here; projected moves are honest.
  const suddenCharge = { id: "sudden-charge", slug: "sudden-charge", name: "Sudden Charge", source: "class-curated", role: "mobility-attack", actionCost: 2, curated: { role: "mobility-attack" },
    activityProfile: { includes: ["stride", "stride", "strike"], includesStrike: true, strideCount: 2, strikeReach: 5 }, targetingProfile: { enemy: true } };
  const farther = rolePc("auto", { enemies: [{ id: "orc", name: "Orc", distance: 90, hpPercent: 1, conditions: { slugs: [], values: {} } }] });
  assert.equal(scoreCandidate(farther, suddenCharge).score, -999, "Sudden Charge can't reach 90 ft");
  const state = advancePlanState(farther, createPlanState(farther), { ...suddenCharge, suggestedTarget: { id: "orc", name: "Orc" } });
  assert.equal(projectContextFromPlanState(farther, state).targets[0].distance, 40, "two Strides close 50 ft; the target isn't magically adjacent");

  // 5/6. One flourish and one composition per turn.
  const flourishA = { id: "flurry", name: "Flurry", slug: "flurry", source: "class-curated", actionCost: 1, traits: ["flourish"] };
  const flourishB = { id: "power-attack", name: "Power Attack", slug: "power-attack", source: "class-curated", actionCost: 2, traits: ["flourish"] };
  assert.equal(hasPlanConflict(fresh, flourishB, [flourishA]), true, "two flourishes conflict");
  const anthem = { id: "courageous-anthem", slug: "courageous-anthem", source: "spell-curated", actionCost: 1, activityProfile: { composition: true } };
  const rallying = { id: "rallying-anthem", slug: "rallying-anthem", source: "spell-curated", actionCost: 1, activityProfile: { composition: true } };
  assert.equal(hasPlanConflict(fresh, rallying, [anthem]), true, "two compositions conflict");

  // 7/8. A heal beats Stabilize on a dying ally; Heal Animal only heals animals.
  const dyingAlly = { id: "ally", name: "Fighter", distance: 5, hpPercent: 0, conditions: { slugs: ["dying"], values: { dying: 1 } }, traits: ["human", "humanoid"] };
  const cleric = rolePc("healer", { allies: [dyingAlly] });
  const heal2 = { id: "heal-2", slug: "heal", name: "Heal", source: "spell-curated", role: "healing", actionCost: 2, targetingProfile: { ally: true, self: true, maxRange: 30 } };
  const stabilize = { id: "stabilize", slug: "stabilize", name: "Stabilize", source: "spell-curated", role: "healing", actionCost: 2, targetingProfile: { ally: true, maxRange: 30 } };
  assert.ok(scoreCandidate(cleric, heal2).score > scoreCandidate(cleric, stabilize).score, "Heal brings a dying ally back up; Stabilize leaves them at 0 HP");
  const healAnimal = { id: "heal-animal", slug: "heal-animal", name: "Heal Animal", source: "spell-inferred", role: "healing", actionCost: 1, targetingProfile: { ally: true, self: true, maxRange: 30 } };
  assert.equal(scoreCandidate(cleric, healAnimal).score, -999, "Heal Animal doesn't work on a humanoid");

  // 10. Taunt reaches 30 ft.
  assert.equal(GUARDIAN_ACTIONS.find((entry) => entry.slug === "taunt").targetingProfile.maxRange, 30);

  // 11. Throwing a bomb again needs another drawn.
  const bomb = { id: "strike-alchemists-fire", slug: "strike", name: "Alchemist's Fire", source: "strike", role: "damage", actionCost: 1, score: 100, confidence: "high", traits: ["bomb"], isRanged: true, range: { increment: 20, max: 120 }, item: { id: "fire", name: "Alchemist's Fire", type: "weapon" } };
  const bombPlans = buildTurnPlans(rolePc("auto", { enemies: [{ id: "orc", name: "Orc", distance: 20, hpPercent: 1, conditions: { slugs: [], values: {} } }] }), [bomb], { includeCoverage: false });
  const twice = bombPlans.find((plan) => plan.steps.length === 2);
  assert.ok(!twice || twice.steps[1].redrawCost === 1, "a second throw costs an action to draw another bomb");

  // 12. A once-per-day item isn't filler.
  const bracelet = { id: "bracelet", slug: "bracelet-of-dashing", name: "Bracelet of Dashing", source: "system-inferred", role: "buff", actionCost: 1, targetingProfile: { self: true },
    item: { system: { description: { value: "<p><strong>Frequency</strong> once per day</p>" } } } };
  const unlimited = { ...bracelet, id: "other", slug: "other-buff", item: { system: { description: { value: "<p>No limit.</p>" } } } };
  assert.ok(scoreCandidate(fresh, bracelet).score <= scoreCandidate(fresh, unlimited).score - 30, "a daily item is worth saving");

  // 13. Guidance immunity counts as already having it.
  assert.equal(targetAlreadyHasBuff({ effects: [{ slug: "guidance-immunity" }] }, { slug: "guidance" }), true);

  // 14. Impulses are spell-like, not off-role ranged weapons, for Spell Damage.
  const blast = { id: "elemental-blast", slug: "elemental-blast", name: "Elemental Blast", source: "strike", role: "damage", actionCost: 1, traits: ["impulse", "kineticist"], range: { increment: 30, max: 30 }, isRanged: true };
  assert.ok(tacticPersonalityAdjustment(rolePc("spell-damage"), blast, { role: "damage" }).scoreDelta >= 0, "Elemental Blast isn't penalised as a ranged weapon");

  // Classifier: "Step" wording is a 5 ft Step.
  const skirmish = classifySystemAction({
    name: "Skirmish Strike", slug: "skirmish-strike",
    system: { actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["flourish", "ranger"] },
      description: { value: "<p>Your feet and weapon move in tandem. Either Step and then Strike, or Strike and then Step.</p>" } },
  }, { actionCost: 1, actionType: "action" });
  assert.equal(skirmish?.activityProfile?.includes?.[0], "step", "Skirmish Strike Steps, it doesn't Stride");
  assert.equal(skirmish?.activityProfile?.fixedDistance, 5);
}

// ---- The enemy's turn, the next turn, and "why this plan" ------------------------------------
{
  const twoOrcs = (hp = 1, temperament = "auto") => ({
    ...rolePc("auto", { profile: { hpPercent: hp }, enemies: [
      { id: "a", name: "Orc A", distance: 30, hpPercent: 1, conditions: { slugs: [], values: {} } },
      { id: "b", name: "Orc B", distance: 30, hpPercent: 1, conditions: { slugs: [], values: {} } },
    ] }),
    _temperament: temperament,
  });
  const strideAt = (id) => ({ id: `stride-${id}`, slug: "stride", name: "Stride", source: "generic", actionCost: 1, suggestedTarget: { id, name: id } });
  const context = twoOrcs();
  const start = createPlanState(context);
  const toA = [strideAt("a")];
  const danger = endPositionDanger(context, start, toA);
  assert.equal(danger.delta, 1, "striding up to Orc A puts one more enemy in reach");
  assert.ok(danger.scoreDelta < 0);
  const hurt = twoOrcs(0.25);
  assert.ok(endPositionDanger(hurt, createPlanState(hurt), toA).scoreDelta < danger.scoreDelta, "it matters more at low HP");
  assert.ok(endPositionDanger(context, start, toA, "berserker").scoreDelta > danger.scoreDelta, "a berserker cares less");
  assert.equal(endPositionDanger(context, start, [{ id: "rk", slug: "recall-knowledge", source: "generic", actionCost: 1 }]).scoreDelta, 0, "not moving changes nothing");

  const sword = { id: "strike-sword", slug: "strike", source: "strike", actionCost: 1, range: { max: 5 }, attackTrait: true };
  const ready = nextTurnReadiness(context, start, toA, [sword]);
  assert.ok(ready.saved >= 1 && ready.scoreDelta > 0, `closing in saves Strides next turn (${JSON.stringify(ready)})`);

  const plan = (summary, score, names) => ({ id: summary, summary, score, steps: names.map((name) => ({ id: name, name })) });
  const chosen = plan("Stride -> Rapier -> Rapier", 300, ["Stride -> Rapier", "Rapier"]);
  const comparison = planComparison(chosen, [chosen, plan("Rapier-ish", 299, ["Stride -> Rapier", "Rapier"]), plan("Shortbow -> Shortbow -> Recall Knowledge", 262, ["Shortbow", "Shortbow MAP", "Recall Knowledge"])]);
  assert.equal(comparison.alternative, "Shortbow -> Shortbow -> Recall Knowledge", "compares against a genuinely different plan");
  assert.equal(comparison.margin, 38);
  assert.equal(comparison.chosen, "Stride -> Rapier, Rapier");
}

console.log("Player tactic audit tests passed.");


// ---- NPC audit + live test fixes -------------------------------------------------------------
{
  // Damage with only a formula ("9d6") still has an average.
  assert.equal(damageAverage({ id: "breath", damageProfile: { formula: "9d6", type: "poison" } }), 31.5);
  assert.equal(damageAverage({ id: "bite", damageProfile: { formula: "2d8+4" } }), 13);

  // Breath Weapon recharge: recognised in the text, gated until the stored round.
  const breath = { id: "breath", name: "Breath Weapon", system: { description: { value: "<p>The dragon can't use Breath Weapon again for [[/gmr 1d4 #Recharge Breath Weapon]]{1d4 rounds}.</p>" } } };
  const crumble = { id: "crumble", name: "Crumble", system: { description: { value: "<p>The living landslide can't Crumble again for 1d6 rounds.</p>" } } };
  const shieldSpell = { id: "shield", name: "Shield", system: { description: { value: "<p>You can't cast it again for 10 minutes.</p>" } } };
  assert.equal(rechargeFormula(breath), "1d4");
  assert.equal(rechargeFormula(crumble), "1d6");
  assert.equal(rechargeFormula(shieldSpell), null, "a 10-minute limit isn't a round recharge");
  const dragon = { type: "npc", flags: { [MODULE_ID]: { npcRecharge: { breath: { combatId: "c1", readyRound: 4 } } } } };
  assert.equal(rechargeAvailability(dragon, breath, { id: "c1", round: 3 }).available, false, "still recharging on round 3");
  assert.equal(rechargeAvailability(dragon, breath, { id: "c1", round: 4 }).available, true, "back on round 4");
  assert.equal(rechargeAvailability(dragon, breath, { id: "other", round: 1 }).available, true, "a new combat starts fresh");

  // Draconic Frenzy: two claws and a wing are three Strikes toward MAP; still one executable step.
  const frenzy = classifySystemAction({ id: "frenzy", name: "Draconic Frenzy", slug: "draconic-frenzy", actionCost: 2,
    description: "The dragon makes two claw Strikes and one wing Strike in any order." }, { actionCost: 2, type: "action" });
  assert.equal(frenzy.activityProfile.countedStrikes, 3);
  assert.equal(attacksTowardMap({ ...frenzy, source: "system-inferred", attackTrait: true, traits: ["attack"] }), 3);

  // Grab / Knockdown riders follow a Strike that lists them, and roll no attack of their own.
  const grab = classifySystemAction({ id: "grab", name: "Grab", slug: "grab", actionCost: 1,
    system: { description: { value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.Grab]</p>" } } }, { actionCost: 1, type: "action" });
  const jaws = { slug: "strike", source: "strike", item: { system: { attackEffects: { value: ["grab"] } } } };
  const claw = { slug: "strike", source: "strike", item: { system: { attackEffects: { value: [] } } } };
  assert.equal(stepSatisfiesPreviousRequirement(jaws, "strike-with-grab"), true);
  assert.equal(stepSatisfiesPreviousRequirement(claw, "strike-with-grab"), false, "Claw doesn't list Grab");
  assert.equal(mapPenalty({ ...grab, source: "system-inferred", attackTrait: true, traits: ["attack"] }, 1), 0, "Grab makes no attack roll");

  // Swallow Whole: "Small, ..." swallows Small or smaller.
  const swallow = classifySystemAction({ id: "swallow", name: "Swallow Whole", slug: "swallow-whole", actionCost: 1,
    system: { description: { value: "<p>Small, @Damage[(1d8+4)[bludgeoning]], Rupture 12</p><hr /><p>@Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>" } } }, { actionCost: 1, type: "action" });
  assert.equal(swallow.activityProfile.maxTargetSize, "small");

  // A swarm repeats its in-space damage ability like a Strike; anything else doesn't repeat.
  const swarmContext = { actor: { document: { type: "npc", system: { traits: { value: ["swarm", "animal"] } } } } };
  const stings = { id: "stings", name: "Swarming Stings", actionCost: 1, role: "save-damage", source: "system-inferred",
    item: { system: { description: { value: "<p>Each enemy in the swarm's space takes 2d8 piercing damage.</p>" } } } };
  assert.equal(isRepeatablePlanningAction(swarmContext, stings), true);
  assert.equal(isRepeatablePlanningAction({ actor: { document: { type: "npc", system: { traits: { value: ["animal"] } } } } }, stings), false);

  // A footprint passed straight through stays 2x2 (Large creatures were measured as 1x1).
  assert.deepEqual(movementFootprintForToken({ widthCells: 2, heightCells: 2 }), { widthCells: 2, heightCells: 2 });

  // Low HP makes walking into reach cost more (the danger model read a field that doesn't exist).
  const hurt = rolePc("auto", { profile: { hp: { value: 5, max: 50, percent: 0.1 } }, enemies: [{ id: "orc", name: "Orc", distance: 30, hpPercent: 1, conditions: { slugs: [], values: {} } }] });
  const healthy = rolePc("auto", { profile: { hp: { value: 50, max: 50, percent: 1 } }, enemies: [{ id: "orc", name: "Orc", distance: 30, hpPercent: 1, conditions: { slugs: [], values: {} } }] });
  const charge = { id: "sc", slug: "sudden-charge", name: "Sudden Charge", source: "class-curated", actionCost: 2, suggestedTarget: { id: "orc", name: "Orc" },
    activityProfile: { includes: ["stride", "stride", "strike"], includesStrike: true, strideCount: 2, strikeReach: 5 } };
  const hurtDanger = endPositionDanger(hurt, createPlanState(hurt), [charge], "cautious");
  const healthyDanger = endPositionDanger(healthy, createPlanState(healthy), [charge], "cautious");
  assert.ok(hurtDanger.scoreDelta < healthyDanger.scoreDelta, `ending next to the orc costs more at 10% HP (${hurtDanger.scoreDelta} vs ${healthyDanger.scoreDelta})`);
}
