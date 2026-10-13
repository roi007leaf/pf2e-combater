import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";
import { actionBudget } from "../action/budget.js";
import { buildActionBuilderModel } from "../action/builder/model.js";
import { createPlanState } from "../plan-state.js";
import { executeDraftStep, executionReadinessForStep } from "../action/executor.js";
import { createTurnSnapshot, trackedActionContext } from "../../state/action-tracker.js";
import { atomizePanelAutoFillSteps, autoFillPanelDraft, fillPanelDraftGap } from "../../ui/panel/draft-workflow.js";
import { actionBuilderKey } from "../action/builder/index.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";
import { currentAutoFillTargetKey } from "../../ui/panel/auto-fill-context.js";
import { draftForAutoFillGap } from "../../ui/panel/draft-helpers.js";

const actor = { id: "pending-actor", itemTypes: { condition: [], effect: [] } };
const combatant = { id: "pending-combatant", actor };
const combat = { id: "pending-combat", started: true, round: 1, turn: 0, combatant, turns: [combatant] };
combat.flags = { "pf2e-combater": { actionTurn: createTurnSnapshot(combat) } };
actor.itemTypes.condition = [{ slug: "quickened", system: {} }];
actor.itemTypes.effect = [{ slug: "spell-effect-haste" }];
const readContext = () => trackedActionContext({ ...fighterContext, combat, combatant, actor: { document: actor } }, { combat, messages: [] });
const candidates = [
  { id: "demoralize", slug: "demoralize", source: "skill", score: 109 },
  { id: "seek", slug: "seek", source: "action", score: 96 },
  { id: "recall-knowledge", slug: "recall-knowledge", source: "skill", score: 66 },
  { id: "strike", slug: "strike", source: "strike", score: 55 },
].map((action) => ({ ...action, name: action.id, actionCost: 1, confidence: "high" }));
const context = readContext();
const plan = buildTurnPlans(context, candidates, { includeCoverage: false })[0];
assert.equal(plan.steps.length, 4, "Auto-fill includes a next-turn Quickened recommendation alongside three current actions");
assert.equal(plan.steps.at(-1).quickenedNextTurn, true);
assert.equal(plan.steps.at(-1).slug, "strike", "Haste permits Strike, not an arbitrary support action");
assert.equal(plan.totalCost, 3, "preview does not increase this turn's plan cost");
assert.equal(actionBudget(context).totalActions, 3);
const steps = plan.steps.map((action, index) => ({ ...action, actionKey: action.id, instanceId: String(index), action }));
const model = buildActionBuilderModel({ context, candidates, draft: { steps } });
assert.equal(model.usage.normal, 3, "next-turn recommendation does not use current draft budget");
assert.equal(model.remainingTotalActions, 0);
assert.equal(createPlanState(context, { steps: [steps.at(-1)] }).attackCount, 0, "preview cannot raise current-turn MAP");
assert.equal(executionReadinessForStep(steps.at(-1)).status, "needs-choice");
assert.equal((await executeDraftStep({ context, step: steps.at(-1) })).status, "needs-choice", "direct execution also blocks the preview");
const display = decorateBuilder(model, "one", "");
assert.equal(display.draft.steps.at(-1).canExecuteStep, false);
assert.equal(display.draft.steps.at(-1).canDuplicateStep, false);
assert.equal(display.draft.steps.at(-1).mapPenalty, 0);
assert.equal(display.draft.steps.some((step) => step.usesQuickened), false, "next-turn preview never claims a current Quickened action");
const priorGame = globalThis.game;
try {
  globalThis.game = { user: { isGM: true, targets: new Set() } };
  let savedDraft = { steps: [] };
  const panel = {
    _context: context,
    _autoFillPlans: [plan],
    _autoFillTargetKey: currentAutoFillTargetKey(),
    _canEditDraft: () => true,
    _readActiveDraftPlan: () => savedDraft,
    _writeActiveDraftPlan: async (draft) => { savedDraft = draft; },
    _actionKeyForStep: actionBuilderKey,
    _findBuilderAction: (key) => candidates.find((candidate) => actionBuilderKey(candidate) === key),
    _atomizeAutoFillSteps(plan, context, prefix) { return atomizePanelAutoFillSteps(this, plan, context, prefix); },
    render: async () => {},
  };
  await autoFillPanelDraft(panel);
  assert.equal(savedDraft.steps.length, 4, "Auto-fill button persists all four rows");
  assert.equal(savedDraft.steps.at(-1).quickenedNextTurn, true, "atomization preserves the preview marker");
  await autoFillPanelDraft(panel);
  assert.equal(savedDraft.steps.length, 4, "repeated Auto-fill replaces the preview instead of stacking it");
  const locked = { steps: savedDraft.steps.slice(0, 3) };
  await fillPanelDraftGap(panel, { draft: locked, plans: [{ ...plan, steps: [plan.steps.at(-1)] }] });
  assert.equal(savedDraft.steps.length, 4, "a full manual draft still receives the future recommendation");
  assert.equal(draftForAutoFillGap(savedDraft).steps.length, 3, "gap refills never reserve a future action");
} finally {
  globalThis.game = priorGame;
}
const spent = { ...context, actionsSpent: { normal: 3, quickened: 0 } };
assert.equal(buildTurnPlans(spent, candidates)[0].steps.length, 1, "a fully spent turn can still preview next turn's extra action");
assert.equal(buildTurnPlans({ ...context, quickenedAllowed: [] }, candidates)[0].steps.length, 3, "unknown restrictions require GM setup");
const custom = buildTurnPlans({ ...context, quickenedAllowed: ["seek"] }, candidates)[0];
assert.equal(custom.steps.at(-1).slug, "seek", "GM restrictions also apply to future recommendations");
assert.equal(custom.steps.at(-1).quickenedNextTurn, true);
actor.itemTypes.condition.push({ slug: "slowed", system: { value: { value: 1 } } });
assert.equal(buildTurnPlans(readContext(), candidates)[0].steps.some((step) => step.quickenedNextTurn), false, "slowed can remove next turn's restricted action");
actor.itemTypes.condition.pop();
combat.round += 1;
combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat);
const active = buildTurnPlans(readContext(), candidates)[0];
assert.equal(active.totalCost, 4, "next turn uses the actual Quickened budget");
assert.equal(active.steps.some((step) => step.quickenedNextTurn), false);

console.log("Pending Quickened tests passed.");
