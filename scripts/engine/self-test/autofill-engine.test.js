import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRecordedTurnScenarios } from "../../dev/recorded-turns.mjs";
import { buildTurnPlans } from "../planner.js";
import { runPlannerQualityLab } from "../planner/quality-lab.js";
import { buildRecordedTurn } from "../planner/turn-snapshot.js";
import { advancePlanState, createPlanState, projectContextFromPlanState } from "../plan-state.js";
import { targetAcPenalty } from "../scoring/tactics.js";
import { mapScoreCost, orphanSetupSteps, planScore, rebalancePlanMap } from "../planner.js";
import { allyThreatensTarget } from "../../readers/action/reach.js";
import { flanksTarget } from "../../readers/positional/flank-reader.js";
import { readSkirmishKiteActivities } from "../../readers/positional/kite-reader.js";
import { readWeaponActions } from "../../readers/weapon-action-reader.js";
import { fighterContext } from "../fixtures.js";
import { scoreCandidate } from "../scoring.js";
import { nextRecallKnowledgeAttempts } from "../../rules/recall-knowledge.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { isRangedStrike } from "../../readers/positional/tactic-helpers.js";
import { readStrideStrikeActivities } from "../../readers/positional/stride-reader.js";
import { tacticPersonalityAdjustment, tacticPersonalityPlanAdjustment } from "../../rules/tactic-personality.js";

// Auto-fill engine audit regressions: one block per fix.

function playerContext(role) {
  const flags = { "pf2e-combater": { tacticPersonality: { role, temperament: "auto" } } };
  const doc = { type: "character", flags, getFlag: (moduleId, key) => flags?.[moduleId]?.[key] };
  const enemy = { id: "enemy", name: "Unknown", distance: 25, disposition: -1 };
  return {
    isGM: false,
    actor: { id: "ed", name: "Ed", document: doc },
    token: { id: "ed-token", name: "Ed", document: { type: "character", flags: {}, getFlag: () => undefined } },
    profile: { actorType: "character", hpPercent: 1, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: { targets: [enemy], enemies: [enemy], allies: [] },
    targets: [enemy],
  };
}

const stride = { id: "generic-stride", slug: "generic-stride", name: "Stride", source: "generic", actionCost: 1, score: 50 };
const diversion = { id: "generic-create-a-diversion", slug: "generic-create-a-diversion", name: "Create a Diversion", source: "generic", actionCost: 1, score: 54 };
const recall = { id: "generic-recall-knowledge", slug: "generic-recall-knowledge", name: "Recall Knowledge", source: "generic", actionCost: 1, score: 58 };
const rapier = { id: "strike-rapier", slug: "strike", name: "Rapier", source: "strike", actionCost: 1, score: 90, range: { max: 5 } };
const pistol = { id: "strike-pistol", slug: "strike", name: "Dueling Pistol", source: "strike", actionCost: 1, score: 54, range: { increment: 60, max: 360 }, traits: ["concussive", "fatal-d10"] };

// 1. Orphan setups: a Diversion with no attack after it, and a Stride padded with skill actions
// while an attack was available, are flagged; the same steps before an attack are not.
assert.deepEqual(orphanSetupSteps([stride, diversion, recall], [stride, diversion, recall, rapier]).map((step) => step.name),
  ["Stride", "Create a Diversion"]);
assert.deepEqual(orphanSetupSteps([diversion, rapier], [diversion, rapier]), [], "a Diversion before a Strike is paid off");
assert.deepEqual(orphanSetupSteps([stride, stride, stride], [stride, rapier]), [], "a pure approach is not filler");
assert.deepEqual(orphanSetupSteps([stride, recall], [stride, recall]).map((step) => step.name), [],
  "with no attack on offer, a Stride isn't blamed for the skill action after it");

// 3. Demoralize's 30 ft range isn't a ranged attack, so Melee Striker doesn't penalise it.
const melee = playerContext("melee-striker");
const demoralize = { id: "generic-demoralize", slug: "demoralize", name: "Demoralize", role: "control", source: "generic", actionCost: 1, targetingProfile: { maxRange: 30 } };
assert.ok(tacticPersonalityAdjustment(melee, demoralize, { role: "control" }).scoreDelta >= 0, "Demoralize is not ranged");
assert.ok(tacticPersonalityAdjustment(melee, pistol, { role: "damage" }).scoreDelta < 0, "a pistol Strike is still ranged");
assert.ok(tacticPersonalityAdjustment(melee, { ...rapier, traits: ["reach-15"], range: { max: 15 } }, { role: "damage" }).scoreDelta > 0,
  "a reach-15 melee Strike is still melee");

// 4. The off-role plan penalty only applies when an on-role option was on offer.
const pistolPlan = [{ ...pistol, role: "damage" }, { ...pistol, role: "damage" }];
assert.ok(tacticPersonalityPlanAdjustment(melee, pistolPlan, null, [pistol, { ...rapier, role: "damage" }]).scoreDelta < 0,
  "shooting while a reachable melee Strike exists is off-role");
assert.equal(tacticPersonalityPlanAdjustment(melee, pistolPlan, null, [pistol, { ...rapier, role: "damage", available: false }]).scoreDelta, 0,
  "shooting when melee is out of reach isn't penalised again at plan level");

// 5. Recall Knowledge loses value with each attempt and is blocked after a failure.
const ogre = fighterContext.targets[0];
const rkAction = { id: "recall-knowledge", slug: "recall-knowledge", name: "Recall Knowledge", source: "generic", actionCost: 1, role: "setup" };
function rkContext(attempts) {
  const flags = { "pf2e-combater": { recallKnowledgeAttempts: attempts } };
  return { ...fighterContext, actor: { ...fighterContext.actor, document: { type: "character", system: {}, flags, getFlag: (moduleId, key) => flags?.[moduleId]?.[key] } } };
}
const freshRk = scoreCandidate(rkContext({}), rkAction).score;
const afterSuccess = scoreCandidate(rkContext(nextRecallKnowledgeAttempts({}, ogre, { outcome: "success" })), rkAction).score;
const afterFailure = scoreCandidate(rkContext(nextRecallKnowledgeAttempts({}, ogre, { outcome: "failure" })), rkAction).score;
assert.ok(afterSuccess < freshRk, `a repeat Recall Knowledge is worth less (${afterSuccess} vs ${freshRk})`);
assert.ok(afterFailure < 0, `Recall Knowledge after a failure is blocked (${afterFailure})`);

// 7. Stride -> Strike picks the hardest-hitting weapon and the cheapest target, not list order.
const approachContext = {
  actor: { profile: { speed: 25, reach: 5 } },
  profile: { speed: 25, reach: 5 },
  token: {},
  targets: [],
  enemies: [
    { id: "far", name: "Far", distance: 45, disposition: -1 },
    { id: "near", name: "Near", distance: 25, disposition: -1 },
  ],
};
const fist = { id: "fist", name: "Fist", actionCost: 1, range: { max: 5 }, averageDamage: 3.5 };
const greatsword = { id: "greatsword", name: "Greatsword", actionCost: 1, range: { max: 5 }, averageDamage: 13 };
const approaches = readStrideStrikeActivities(approachContext, [fist, greatsword]);
assert.deepEqual(approaches.map((action) => [action.name, action.preferredTarget.id]), [["Stride -> Greatsword", "near"]],
  "one composite per target: the cheapest target with the best weapon");
assert.equal(approaches[0].averageDamage, 13, "the composite carries its weapon's damage");

// 9. Ranged-ness comes from the weapon, not its reach.
assert.equal(isRangedStrike({ name: "Jaws", range: { max: 15 }, traits: ["reach-15"] }), false, "reach-15 Jaws is melee");
assert.equal(isRangedStrike({ name: "Glaive", range: { max: 15 }, isRanged: false }), false, "an Enlarged glaive is melee");
assert.equal(isRangedStrike({ name: "Pistol", range: { increment: 40, max: 240 } }), true);

// 11/12. Ranged Strikes reach six increments; a dagger's thrown altUsage is its own option.
const dagger = (ranged) => ({
  type: "strike", slug: "dagger", label: "Dagger", visible: true, ready: true, canAttack: true,
  item: { id: "dagger", isRanged: ranged, system: { range: ranged ? { increment: 10 } : null, traits: { value: ranged ? ["thrown", "agile"] : ["agile", "finesse"] } } },
  variants: [], altUsages: [],
});
const daggerActor = { system: { actions: [{ ...dagger(false), altUsages: [dagger(true)] }] } };
const daggerOptions = actorStrikeOptions(daggerActor);
assert.deepEqual(daggerOptions.map((option) => [option.name, option.isRanged, option.range.max]),
  [["Dagger", false, 5], ["Dagger (Thrown)", true, 60]]);
assert.notEqual(daggerOptions[0].id, daggerOptions[1].id, "thrown and melee usages have distinct ids");

// 11/15. Range increments cost accuracy; fatal adds crit value.
const shot = (distance, traits = []) => scoreCandidate(
  { ...fighterContext, targets: [{ ...ogre, distance }] },
  { id: "strike-pistol", slug: "strike", name: "Pistol", source: "strike", actionCost: 1, range: { increment: 40, max: 240 }, traits, averageDamage: 8 },
).score;
assert.ok(shot(90) < shot(30), "a shot two increments out scores lower");
assert.ok(shot(30, ["fatal-d10"]) > shot(30), "fatal adds critical value");

// 14. Without the native preflight, Strike damage is weighed by the chance to hit.
const playerStrike = (modifier) => scoreCandidate(
  { ...fighterContext, profile: { ...fighterContext.profile, level: 5 }, targets: [{ ...ogre, distance: 5 }] },
  { id: `strike-${modifier}`, slug: "strike", name: "Blade", source: "strike", actionCost: 1, range: { max: 5 }, averageDamage: 10, strike: { totalModifier: modifier } },
).score;
assert.ok(playerStrike(15) > playerStrike(10), "a more accurate Strike scores higher");

// 14. A third attack at MAP -10 loses most of its value; second attacks keep the flat 3/point.
assert.equal(mapScoreCost({ score: 140 }, 5), 15);
assert.ok(mapScoreCost({ score: 140 }, 10) > 60, "MAP -10 on a big Strike costs most of its value");

// 7 (planner). MAP is dealt in the cheapest order: the big Strike first, the agile one second.
const mapStep = (name, score, agile, attackIndex) => ({
  id: name, name, slug: "strike", source: "strike", actionCost: 1, traits: agile ? ["agile"] : [],
  attackIndex, mapPenalty: attackIndex > 1 ? (agile ? 4 : 5) : 0, score,
  mapBase: { score, reason: name, reload: "", volley: "" },
});
const rebalanced = rebalancePlanMap([mapStep("Claw", 100, true, 1), mapStep("Scythe", 120, false, 2)]);
assert.deepEqual(rebalanced.map((step) => [step.name, step.mapPenalty]), [["Scythe", 0], ["Claw", 4]]);

// Follow-up 1. Flanking follows the PF2e line rule: opposite corners flank, adjacent sides don't.
const square = (x, y, size = 5) => ({ x, y, width: size, height: size });
const flankTarget = square(5, 5);
assert.equal(flanksTarget(square(0, 0), square(10, 10), flankTarget), true, "opposite corners flank");
assert.equal(flanksTarget(square(0, 5), square(10, 5), flankTarget), true, "opposite sides flank");
assert.equal(flanksTarget(square(0, 5), square(5, 0), flankTarget), false, "adjacent sides don't flank");
assert.equal(flanksTarget(square(0, 0), square(10, 5), flankTarget), false, "corner to a neighbouring side doesn't flank");
assert.equal(flanksTarget(square(0, 0), square(15, 15), square(5, 5, 10)), true, "a diagonal line across a large target flanks");

// Follow-up 2. An ally who can't act doesn't threaten (or flank) anything.
const gridMetrics = { sceneDistance: 5, pixelSize: 5, pixelsPerFoot: 1 };
const flankFoe = { id: "foe", center: { x: 7.5, y: 7.5 } };
const flankAlly = (extra = {}) => ({ id: "ally", center: { x: 12.5, y: 7.5 }, hpPercent: 1, conditions: { slugs: [], values: {} }, ...extra });
assert.equal(allyThreatensTarget(flankAlly(), flankFoe, gridMetrics), true);
for (const slug of ["unconscious", "paralyzed", "petrified"]) {
  assert.equal(allyThreatensTarget(flankAlly({ conditions: { slugs: [slug], values: {} } }), flankFoe, gridMetrics), false, `${slug} ally doesn't threaten`);
}
assert.equal(allyThreatensTarget(flankAlly({ hpPercent: 0 }), flankFoe, gridMetrics), false, "an ally at 0 HP doesn't threaten");

// Follow-up 3. Skirmish leads with the hardest-hitting reaching melee Strike, not the first one.
const previousKiteCanvas = globalThis.canvas;
try {
  globalThis.canvas = { scene: { grid: { distance: 5 } }, grid: { size: 5 }, tokens: { placeables: [] } };
  const bruiser = { id: "bruiser", name: "Bruiser", distance: 5, disposition: -1, token: { center: { x: 5, y: 0 } } };
  const kite = readSkirmishKiteActivities({
    token: { id: "kiter", center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, hp: { percent: 0.3 }, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: { enemies: [bruiser], targets: [bruiser], allies: [] },
  }, [fist, greatsword, { id: "dart", name: "Dart", actionCost: 1, range: { increment: 20, max: 120 }, traits: ["ranged"], averageDamage: 3 }], []);
  assert.equal(kite[0]?.activityProfile.meleeStrike?.name, "Greatsword", "the lead-in Strike is the best melee one");
} finally {
  globalThis.canvas = previousKiteCanvas;
}

// Follow-up 4. Drawing needs free hands: a two-hander can't be drawn with a weapon in one hand.
const drawWeapon = (id, name, usage, equipped) => ({
  id, name, type: "weapon",
  system: { category: "martial", usage: { value: usage }, equipped, traits: { value: [] } },
});
const drawActor = (held) => {
  const items = [
    ...held,
    drawWeapon("greataxe", "Greataxe", "held-in-two-hands", { carryType: "worn", handsHeld: 0 }),
    drawWeapon("dagger", "Dagger", "held-in-one-hand", { carryType: "worn", handsHeld: 0 }),
  ];
  return { items, itemTypes: { weapon: items } };
};
const drawNames = (actor) => readWeaponActions(actor, { targets: [], battlefield: { targets: [], enemies: [] } }, [])
  .map((action) => action.name).filter((name) => name.startsWith("Draw"));
const longsword = drawWeapon("longsword", "Longsword", "held-in-one-hand", { carryType: "held", handsHeld: 1 });
assert.deepEqual(drawNames(drawActor([])), ["Draw Greataxe", "Draw Dagger"], "both hands free: anything can be drawn");
assert.deepEqual(drawNames(drawActor([longsword])), ["Draw Dagger"], "one hand free: no two-hander");
assert.deepEqual(drawNames(drawActor([{ ...longsword, system: { ...longsword.system, equipped: { carryType: "held", handsHeld: 2 } } }])), [],
  "no free hands: nothing to draw");

// Follow-up 5. MAP'd attack copies pay their candidate's rank like any other step.
const rankedCandidates = [recall, rapier];
const mapCopy = { ...rapier, attackIndex: 2 };
assert.equal(planScore({}, [mapCopy], rankedCandidates, { totalActions: 1 }), planScore({}, [rapier], rankedCandidates, { totalActions: 1 }),
  "an attack copy and its candidate score the same");
assert.equal(planScore({}, [rapier], rankedCandidates, { totalActions: 1 }), rapier.score - 1, "a step pays its candidate rank");

// Follow-up 6. The hidden-target flat check discounts the hit, not the actor's personality bonus.
const hiddenStrike = (role, detectionState) => {
  const context = playerContext(role);
  const foe = { ...ogre, id: "foe", distance: 5, detectionState };
  return scoreCandidate({ ...context, targets: [foe], battlefield: { ...context.battlefield, targets: [foe], enemies: [foe] } },
    { ...rapier, role: "damage", averageDamage: 10 }).score;
};
const personalityBonus = (detection) => hiddenStrike("melee-striker", detection) - hiddenStrike("ranged-striker", detection);
assert.ok(personalityBonus("observed") > 0, "the fixture has a personality bonus to protect");
assert.ok(Math.abs(personalityBonus("hidden") - personalityBonus("observed")) < 1e-6,
  `the personality gap isn't halved on a hidden target (${personalityBonus("hidden")} vs ${personalityBonus("observed")})`);

// Recorded turns: a live context (documents, tokens, functions, cycles) snapshots to plain JSON and
// replays in the quality lab with the GM's verdict.
{
  const actorDoc = { documentName: "Actor", id: "ed", name: "Ed", type: "character", flags: { "pf2e-combater": { note: 1 } }, system: { huge: true } };
  actorDoc.parent = actorDoc;
  const enemyToken = { id: "goblin", name: "Goblin", center: { x: 100, y: 0 }, document: { documentName: "Token", id: "goblin", name: "Goblin" } };
  const liveContext = {
    ...fighterContext,
    actor: { ...fighterContext.actor, document: actorDoc, roll: () => 1 },
    targets: [{ ...ogre, distance: 5, token: enemyToken }],
  };
  liveContext.self = liveContext;
  const liveCandidates = [
    { id: "strike-rapier", slug: "strike", name: "Rapier", source: "strike", actionCost: 1, score: 90, confidence: "high", item: { documentName: "Item", id: "rapier", name: "Rapier", type: "weapon", system: { damage: { dice: 1, die: "d6" }, traits: { value: ["finesse"] } } }, attack: () => null },
    { id: "raise-a-shield", slug: "raise-a-shield", name: "Raise a Shield", source: "generic", actionCost: 1, score: 40, confidence: "high" },
  ];
  const livePlans = buildTurnPlans(liveContext, liveCandidates, { includeCoverage: false });
  const right = buildRecordedTurn({ context: liveContext, candidates: liveCandidates, plans: livePlans, verdict: { kind: "correct", planIndex: 0 }, note: "rapier twice" });
  const wrong = buildRecordedTurn({ context: liveContext, candidates: liveCandidates, plans: livePlans, verdict: { kind: "wrong" }, recordedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(right.context.actor.document.parent, undefined, "back-references are dropped");
  assert.equal(right.context.actor.roll, undefined, "functions are dropped");
  assert.deepEqual(right.context.actor.document.flags, { "pf2e-combater": { note: 1 } }, "document flags survive");
  assert.equal(right.context.actor.document.system, undefined, "an actor's full system data is not dumped");
  assert.deepEqual(right.candidates[0].item.system.damage, { dice: 1, die: "d6" }, "weapon damage survives");
  const directory = await mkdtemp(path.join(tmpdir(), "combater-recorded-"));
  try {
    await writeFile(path.join(directory, "right.json"), JSON.stringify(right));
    await writeFile(path.join(directory, "wrong.json"), JSON.stringify(wrong));
    const replay = runPlannerQualityLab(await loadRecordedTurnScenarios(directory));
    assert.deepEqual(replay.scenarios.map((scenario) => scenario.passed), [true, false],
      "a confirmed plan replays green; a plan marked wrong fails until the planner changes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Step-by-step simulation (1): a plain Stride closes on its target in the projected board.
{
  const enemy = { id: "orc", name: "Orc", distance: 40, conditions: { slugs: [], values: {} } };
  const context = { profile: { speed: 25, conditions: { slugs: [], values: {} } }, targets: [enemy], battlefield: { targets: [enemy], enemies: [enemy] } };
  const move = { id: "stride", slug: "stride", name: "Stride", source: "generic", actionCost: 1, suggestedTarget: { id: "orc", name: "Orc" } };
  const once = advancePlanState(context, createPlanState(context), move);
  assert.equal(projectContextFromPlanState(context, once).targets[0].distance, 15, "one Stride closes 25 ft");
  const twice = advancePlanState(context, once, move);
  assert.equal(projectContextFromPlanState(context, twice).targets[0].distance, 5, "never closer than adjacent");
  const tripped = advancePlanState(context, twice, { id: "trip", slug: "trip", name: "Trip", source: "generic", actionCost: 1, suggestedTarget: { id: "orc", name: "Orc" } });
  assert.ok(projectContextFromPlanState(context, tripped).targets[0].conditions.slugs.includes("prone"), "Trip projects prone");
  assert.equal(tripped.uncertainSetup, true, "a check-based setup is marked uncertain");
}

// One value scale (2): conditions lower the AC the attack faces, so setups pay off on the Strike.
assert.equal(targetAcPenalty({ conditions: { slugs: ["prone"], values: {} } }), 2, "prone means off-guard");
assert.equal(targetAcPenalty({ conditions: { slugs: ["off-guard", "frightened"], values: { frightened: 2 } } }), 4);
assert.equal(targetAcPenalty({ conditions: { slugs: ["frightened", "sickened"], values: { frightened: 1, sickened: 2 } } }), 2, "status penalties don't stack");
{
  const orc = { id: "orc", name: "Orc", distance: 5, ac: 18, conditions: { slugs: [], values: {} } };
  const context = { profile: { level: 3, speed: 25, conditions: { slugs: [], values: {} }, skills: { athletics: 9 } }, targets: [orc], battlefield: { targets: [orc], enemies: [orc] } };
  const blade = scoreCandidate(context, { id: "strike-blade", slug: "strike", name: "Blade", source: "strike", actionCost: 1, range: { max: 5 }, averageDamage: 10, strike: { totalModifier: 10 } });
  const trip = scoreCandidate(context, { id: "trip", slug: "trip", name: "Trip", source: "generic", role: "control", skill: "athletics", actionCost: 1, attackTrait: true, criticalFailureRisk: "major", targetSave: "reflex" });
  const plans = buildTurnPlans(context, [blade, trip], { includeCoverage: false });
  const tripThenStrike = plans.find((plan) => plan.steps[0]?.slug === "trip" && plan.steps.some((step) => step.slug === "strike"));
  assert.ok(tripThenStrike, "a Trip -> Strike plan exists");
  const followUp = tripThenStrike.steps.find((step) => step.slug === "strike");
  assert.ok(followUp.projectedScoreDelta > 0, `the Strike after Trip is re-scored against a prone target (delta ${followUp.projectedScoreDelta})`);
}

console.log("Auto-fill engine audit tests passed.");
