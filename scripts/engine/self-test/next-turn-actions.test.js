import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { actionBudget } from "../action/budget.js";
import { buildTurnPlans } from "../planner.js";
import { buildActionBuilderModel } from "../action/builder/model.js";
import { adjustTrackedActions, createTurnSnapshot, setQuickenedAllowance, trackedActionContext } from "../../state/action-tracker.js";
import { actionTrackerView } from "../../ui/panel/action-tracker.js";

const condition = (slug, value = 1) => ({ id: slug, slug, system: { value: { value, isValued: true } } });
const actor = { id: "celdar", isOwner: true, itemTypes: { condition: [condition("slowed", 1)], effect: [] } };
const combatant = { id: "celdar-turn", actor };
const other = { id: "other-turn", actor: { id: "other", itemTypes: { condition: [] } } };
const combat = { id: "forecast-combat", started: true, round: 2, turn: 0, combatant: other, turns: [other, combatant] };
combat.flags = { "pf2e-combater": { actionTurn: createTurnSnapshot(combat) } };
const context = { ...fighterContext, combat, combatant, actor: { document: actor, profile: {} }, actionsSpent: { normal: 3, movement: 3, total: 3 } };
const read = () => trackedActionContext(context, { combat, messages: [] });
const candidates = [
  { id: "demoralize", slug: "demoralize", source: "skill", score: 109 },
  { id: "seek", slug: "seek", source: "action", score: 96 },
  { id: "recall-knowledge", slug: "recall-knowledge", source: "skill", score: 66 },
  { id: "strike", slug: "strike", source: "strike", score: 55 },
].map((action) => ({ ...action, name: action.id, actionCost: 1, confidence: "high" }));
const plan = () => buildTurnPlans(read(), candidates, { includeCoverage: false })[0];
const priorGame = globalThis.game;
try {
  globalThis.game = { user: { isGM: false }, combat };
  let forecast = read();
  let view = actionTrackerView(forecast);
  assert.equal(view.visible, true, "an off-turn player sees the action tracker");
  assert.equal(view.forecast, true);
  assert.equal(view.label, "Next turn");
  assert.equal(view.normal, 2);
  assert.equal(view.conditions, "Slowed 1");
  assert.equal(view.editable, false, "future actions cannot be spent or refunded");
  assert.equal(forecast.actionsSpent.total, 0, "previous movement and receipts do not spend future actions");
  assert.equal(plan().totalCost, 2, "Auto-fill uses the upcoming slowed budget");
  actor.itemTypes.condition = [condition("slowed", 1), condition("stunned", 2)];
  assert.equal(actionBudget(read()).totalActions, 1, "stunned and slowed overlap");
  assert.equal(plan().totalCost, 1);
  assert.match(actionTrackerView(read()).conditions, /Stunned 2/);
  actor.itemTypes.condition = [{ slug: "stunned", system: { value: { isValued: false, value: null } } }];
  assert.equal(actionBudget(read()).totalActions, 0, "duration-based stunned leaves no predicted actions");
  assert.equal(plan().steps.length, 0);
  actor.itemTypes.condition = [condition("quickened")];
  actor.itemTypes.effect = [{ slug: "spell-effect-haste" }];
  forecast = read();
  assert.equal(actionBudget(forecast).totalActions, 4);
  const hasted = plan();
  assert.equal(hasted.totalCost, 4, "off-turn Haste fills the entire future turn");
  assert.equal(hasted.steps.some((step) => step.quickenedNextTurn), false, "all rows belong to the same upcoming turn");
  assert.ok(hasted.steps.some((step) => step.slug === "strike"));
  const draft = { steps: hasted.steps.map((action) => ({ actionKey: action.id, actionCost: 1, action })) };
  const model = buildActionBuilderModel({ context: forecast, candidates, draft });
  assert.equal(model.remainingTotalActions, 0);
  assert.equal(model.remainingQuickenedActions, 0);
  assert.deepEqual(model.draft.steps.filter((step) => step.usesQuickened).map((step) => step.action.slug), ["strike"],
    "the forecast labels the eligible action paying with Quickened");
  const badgeCandidates = [{ id: "stride", slug: "stride", name: "Stride", actionCost: 1 }, ...candidates];
  const badgeDraft = { steps: ["stride", "strike", "seek", "demoralize"].map((id) => ({ instanceId: id, actionKey: id, actionCost: 1 })) };
  const marked = (draft, context = forecast) => buildActionBuilderModel({ context, candidates: badgeCandidates, draft }).draft.steps.filter((step) => step.usesQuickened).map((step) => step.instanceId);
  assert.deepEqual(marked(badgeDraft), ["stride"], "only the first eligible planned action uses the restricted allowance");
  assert.deepEqual(marked({ steps: [badgeDraft.steps[1], badgeDraft.steps[0], ...badgeDraft.steps.slice(2)] }), ["strike"], "reordering recalculates the indicated row");
  assert.deepEqual(marked(badgeDraft, { ...forecast, quickenedAllowed: ["seek"] }), ["seek"], "custom GM restrictions determine the marked row");
  assert.deepEqual(marked(badgeDraft, { ...forecast, quickenedAllowed: [] }), [], "unknown restrictions never mark arbitrary rows");
  assert.deepEqual(marked({ steps: badgeDraft.steps.map((step) => step.instanceId === "stride" ? { ...step, actionCost: 2 } : step) }), ["strike"], "two-action activities cannot use the single Quickened action");
  actor.itemTypes.condition.push(condition("slowed", 1));
  assert.equal(actionBudget(read()).totalActions, 3);
  assert.equal(actionTrackerView(read()).quickenedLeft, 0, "slowed consumes the restricted action first");
  assert.equal(plan().totalCost, 3);
  assert.deepEqual(marked(badgeDraft, read()), [], "no badge when slowed removes the Quickened allowance");
  actor.itemTypes.condition.pop();
  actor.itemTypes.effect = [];
  assert.equal(plan().totalCost, 3, "unknown Quickened restrictions cannot pay for arbitrary actions");
  assert.equal(actionTrackerView(read()).quickenedNeedsConfiguration, true);
  const writes = [];
  actor.update = async (changes) => writes.push(changes);
  actor.updateEmbeddedDocuments = async (_type, changes) => {
    for (const change of changes) {
      actor.itemTypes.condition.find((item) => item.id === change._id).flags = {
        "pf2e-combater": { quickenedAllowed: change["flags.pf2e-combater.quickenedAllowed"] },
      };
    }
  };
  await setQuickenedAllowance(read(), ["seek"]);
  assert.equal(plan().totalCost, 3, "players cannot change Quickened restrictions before their turn");
  globalThis.game.user.isGM = true;
  await setQuickenedAllowance(read(), ["strike", "stride"]);
  assert.equal(plan().totalCost, 4, "GM can configure Quickened before its turn");
  await adjustTrackedActions(read(), "normal", 1);
  assert.equal(writes.length, 0, "forecast setup never changes the active combatant's receipts");
  combat.turn = 1;
  combat.combatant = combatant;
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat);
  const activeContext = trackedActionContext({ ...context, actionsSpent: { movement: 0 } }, { combat, messages: [] });
  assert.equal(actionBudget(activeContext).totalActions, 4);
  assert.equal(actionTrackerView(activeContext).forecast, false);
  assert.equal(buildActionBuilderModel({ context: activeContext, candidates, draft }).remainingTotalActions, 0,
    "the four-action plan made before the turn fits when that turn starts");
  combat.turn = 0;
  combat.combatant = other;
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat);
  actor.itemTypes.condition = [];
  assert.equal(actionBudget(read()).totalActions, 3, "removing a condition immediately updates the forecast");
  combat.turn = 1;
  combat.combatant = combatant;
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat);
  view = actionTrackerView(trackedActionContext({ ...context, actionsSpent: { movement: 0 } }, { combat, messages: [] }));
  assert.equal(view.forecast, false);
  assert.equal(view.label, "Actions left");
  assert.equal(view.editable, true, "turn start changes forecast to live tracking");
} finally {
  globalThis.game = priorGame;
}
console.log("Next-turn action forecast tests passed.");
