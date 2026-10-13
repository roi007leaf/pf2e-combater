import assert from "node:assert/strict";
import { buildTurnPlans } from "../planner.js";
import { buildActionBuilderModel } from "../action/builder/index.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { actionKeyForPanelStep, atomizePanelAutoFillSteps } from "../../ui/panel/draft-workflow.js";
import { writeDraftPlan, readDraftPlan } from "../../state/draft-plans.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";
import { executeDraftStep } from "../action/executor.js";
import { findProjectedDraftAction } from "../../ui/panel/draft-helpers.js";

const saved = { game: globalThis.game, canvas: globalThis.canvas, localStorage: globalThis.localStorage };
const storage = new Map();
try {
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.game = { user: { id: "gm", isGM: true, targets: new Set() } };
  const hoof = { id: "hoof", uuid: "Actor.horse.Item.hoof", type: "melee", name: "Hoof",
    system: { slug: "hoof", traits: { value: [] }, damageRolls: { main: { damage: "1d6+4", damageType: "bludgeoning" } } } };
  const rolls = [];
  const horse = { id: "horse", uuid: "Actor.horse", type: "npc", name: "Riding Horse", items: [hoof],
    system: { actions: [{ type: "strike", slug: "hoof", label: "Hoof", ready: true, visible: true, canAttack: true,
      item: hoof, totalModifier: 9, variants: [0, 1, 2].map(index => ({ roll: async () => { rolls.push(index); return null; } })) }] } };
  const target = { id: "silva", name: "Silva", distance: 5, ac: 18, hpPercent: 1, conditions: [], saves: { reflex: 6, fortitude: 6 } };
  const context = { combat: { id: "combat", started: true, round: 1, turn: 0 },
    combatant: { id: "horse-turn", actor: horse }, actor: { id: horse.id, document: horse }, token: { id: "horse-token", center: { x: 50, y: 50 } },
    profile: { type: "npc", reach: 5, meleeReach: 5, speed: 40, handsFree: 2, hpPercent: 1, skills: { athletics: 9 },
      conditions: { slugs: ["quickened"], values: {} } }, targets: [target], battlefield: { targets: [target], enemies: [target], allies: [] },
    quickenedAllowed: ["strike", "stride"],
  };
  const strike = { ...actorStrikeOptions(horse, context)[0], score: 100, preferredTarget: target };
  const maneuvers = ["trip", "grapple"].map(slug => ({ id: slug, slug, name: slug === "trip" ? "Trip" : "Grapple",
    source: "skill", actionCost: 1, attackTrait: true, available: true, executable: "skill-action", score: 110, preferredTarget: target }));
  const candidates = [...maneuvers, strike];
  const plans = buildTurnPlans(context, candidates, { includeCoverage: false });
  const plan = plans.find(entry => entry.steps.length === 4 && maneuvers.every(action => entry.steps.some(step => step.slug === action.slug))
    && entry.steps.filter(step => step.source === "strike").length === 2);
  assert.ok(plan, "planner offers Trip, Grapple, Hoof, Hoof with Quickened");
  const panel = {
    _context: context, _builder: buildActionBuilderModel({ context, candidates, draft: { steps: [] } }),
    _findBuilderAction(key) { return Object.values(this._builder.tabs).flatMap(tab => tab.all).find(action => action.key === key); },
    _actionKeyForStep(step) { return actionKeyForPanelStep(this, step); },
  };
  const steps = atomizePanelAutoFillSteps(panel, plan, context);
  writeDraftPlan(context, { source: "auto-fill", steps });
  const refreshed = buildActionBuilderModel({ context, candidates, draft: readDraftPlan(context) });
  const strikes = refreshed.draft.steps.filter(step => step.name === "Hoof");
  assert.equal(strikes.length, 2);
  assert.ok(strikes.every(step => !step.stale), `both available Hoof strikes must resolve after Auto-fill: ${strikes.map(step => `${step.actionKey}: ${step.warning}`).join(", ")}`);
  assert.equal(strikes.filter(step => step.usesQuickened).length, 1);
  assert.deepEqual(strikes.map(step => step.actionKey), [strike.id, strike.id], "new Auto-fill drafts persist the real Strike identity");

  // Already saved drafts retain the planner's repeated-strike IDs. They need
  // to recover immediately on refresh, without asking the player to rebuild.
  const legacyDraft = { steps: steps.map((step, index) => ({ ...step, actionKey: plan.steps[index].id })) };
  assert.ok(legacyDraft.steps.some(step => step.actionKey.endsWith("-map-1")));
  const legacy = buildActionBuilderModel({ context, candidates, draft: legacyDraft });
  assert.ok(legacy.draft.steps.every(step => !step.stale));
  const repeatedStep = legacyDraft.steps.find(step => step.actionKey.endsWith("-map-1"));
  const projected = findProjectedDraftAction(context, legacyDraft, repeatedStep);
  assert.equal(projected?.item?.id, hoof.id, "Browse/projected lookup also restores the same native Hoof");
  globalThis.canvas = { tokens: { placeables: [{ id: target.id, name: target.name, setTarget() {} }] } };
  const decorated = decorateBuilder(legacy, "one", "");
  const readyStrikes = decorated.draft.steps.filter(step => step.name === "Hoof");
  assert.ok(readyStrikes.every(step => step.canExecuteStep), "both Hoof rows enable Execute");
  assert.deepEqual(readyStrikes.map(step => step.mapPenalty), [10, 10], "Trip and Grapple already count toward MAP");
  for (const step of readyStrikes) {
    const result = await executeDraftStep({ context, step });
    assert.equal(result.status, "done");
  }
  assert.deepEqual(rolls, [2, 2], "both Hoof rows roll the native MAP -10 variant");

  const normalContext = { ...context, profile: { ...context.profile, conditions: { slugs: [], values: {} } } };
  const normalPlans = buildTurnPlans(normalContext, [strike], { includeCoverage: false });
  const normalSteps = atomizePanelAutoFillSteps(panel, normalPlans[0], normalContext);
  assert.ok(normalSteps.length > 1);
  assert.ok(buildActionBuilderModel({ context: normalContext, candidates, draft: { steps: normalSteps } }).draft.steps.every(step => !step.stale), "repeated strikes also resolve without Quickened");

  const absent = buildActionBuilderModel({ context, candidates: maneuvers, draft: legacyDraft });
  assert.ok(absent.draft.steps.filter(step => step.name === "Hoof").every(step => step.stale), "a removed Hoof remains unavailable");
  const rejected = buildActionBuilderModel({ context, candidates: maneuvers,
    rejected: [{ action: { ...strike, available: false, unavailableReason: "No target in range." } }], draft: legacyDraft });
  assert.ok(rejected.draft.steps.filter(step => step.name === "Hoof").every(step => !step.stale && step.warning === "No target in range."), "real availability restrictions survive the alias lookup");
  const distinctStrike = { ...strike, id: repeatedStep.actionKey, name: "Another strike" };
  const collision = buildActionBuilderModel({ context, candidates: [...candidates, distinctStrike], draft: legacyDraft });
  assert.equal(collision.draft.steps.find(step => step.instanceId === repeatedStep.instanceId).action.name, "Another strike", "exact action IDs always take precedence over planner aliases");
  const unrelated = buildActionBuilderModel({ context, candidates,
    draft: { steps: [{ instanceId: "missing", actionKey: "trip-map-1", name: "Trip", actionCost: 1 }] } });
  assert.equal(unrelated.draft.steps[0].stale, true, "aliases never substitute generic actions for missing strikes");
  console.log("Repeated strike draft tests passed.");
} finally { Object.assign(globalThis, saved); }
