import assert from "node:assert/strict";
import { actionBudget, quickenedEligible } from "../action/budget.js";
import { adjustTrackedActions, beginTrackedExecution, chatActionEntry, createTurnSnapshot, recordTrackedExecution, refundTrackedExecution, registerActionTrackerHooks, setQuickenedAllowance, trackedActionContext } from "../../state/action-tracker.js";
import { buildActionBuilderModel } from "../action/builder/model.js";
import { fighterContext, fixtureCandidates } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";
import { actionTrackerView, activateActionTrackerBindings } from "../../ui/panel/action-tracker.js";
import { markMovementActionSpent } from "../../state/token-refresh.js";

const actor = { id: "actor", uuid: "Actor.actor", itemTypes: { condition: [], effect: [] }, flags: {} };
const combatant = { id: "combatant", actor, tokenId: "token", sceneId: "scene" };
const combat = { id: "combat", started: true, round: 1, turn: 0, combatant, turns: [combatant], flags: {} };
const snapshot = createTurnSnapshot(combat, { key: "turn-one" });
combat.flags["pf2e-combater"] = { actionTurn: snapshot };
const context = { combat: { id: combat.id, started: true }, combatant, actor: { document: actor, profile: {} }, actionsSpent: { movement: 0 } };
const message = (id, cost, extra = {}) => ({ id, speaker: { actor: "actor", token: "token", scene: "scene" }, flags: { pf2e: { origin: { uuid: "Actor.actor.Item.spell" } } }, content: `<header class="card-header"><h3>Spell <span class="action-glyph">${cost}</span></h3></header>`, ...extra });
const card = message("card", "D");
assert.equal(chatActionEntry(card, combat).cost, 2);
assert.equal(chatActionEntry(message("reaction", "R"), combat), null);
assert.equal(chatActionEntry(message("free", "F"), combat), null);
assert.equal(chatActionEntry(message("description", "", { content: '<p>Description <span class="action-glyph">T</span></p>' }), combat), null);
assert.equal(chatActionEntry(message("wrong-token", "A", { speaker: { actor: "actor", token: "another", scene: "scene" } }), combat), null);
assert.equal(chatActionEntry(message("damage", "D", { flags: { pf2e: { context: { type: "damage-roll" } } } }), combat), null);
assert.equal(chatActionEntry(message("reroll", "A", { flags: { pf2e: { context: { type: "attack-roll", isReroll: true } } } }), combat), null);
card.flags["pf2e-combater"] = { actionSpend: chatActionEntry(card, combat) };
let tracked = trackedActionContext(context, { combat, messages: [card] });
assert.equal(actionBudget(tracked).normalActions, 1);
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [card, card] })).normalActions, 1);
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [] })).normalActions, 3, "deleting a card refunds it");
assert.equal(actionBudget({ profile: { conditions: { slugs: ["slowed", "stunned"], values: { slowed: 2, stunned: 1 } } } }).totalActions, 1);
const spellRoll = message("spell-roll", "D", { flags: { pf2e: { origin: { uuid: "Actor.actor.Item.spell" }, context: { type: "spell-attack-roll" } } } });
spellRoll.flags["pf2e-combater"] = { actionSpend: chatActionEntry(spellRoll, combat) };
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [card, spellRoll] })).normalActions, 1, "card and follow-up roll count once");
const anotherCard = { ...card, id: "second-card" };
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [card, anotherCard] })).normalActions, 0, "separate posts each spend actions");
const attack = message("strike", "", { flags: { pf2e: { context: { type: "attack-roll", options: ["action:strike"] } } } });
assert.equal(chatActionEntry(attack, combat).cost, 1);
assert.equal(chatActionEntry(attack, combat).slug, "strike");
assert.equal(chatActionEntry(message("save", "A", { flags: { pf2e: { context: { type: "saving-throw" } } } }), combat), null);
assert.equal(chatActionEntry(message("explicit-zero", "A", { flags: { pf2e: { context: { options: ["self:action:cost:0"] } } } }), combat), null);
assert.equal(chatActionEntry(message("variable", "A to T"), combat), null);
assert.equal(chatActionEntry(message("other-scene", "A", { speaker: { actor: "actor", token: "token", scene: "different" } }), combat), null);
assert.equal(chatActionEntry(card, { ...combat, started: false }), null);
assert.equal(trackedActionContext({ ...context, combatant: { id: "other" } }, { combat, messages: [card] }).actionTracker.forecast, true, "another combatant gets a forecast instead of this turn's spending");

const condition = (slug, value = 1) => ({ slug, system: { value: { value, isValued: true } } });
actor.itemTypes.condition = [condition("quickened")];
const newlyQuickened = trackedActionContext(context, { combat, messages: [] });
assert.equal(createTurnSnapshot(combat).pool.quickenedActions, 1, "the condition reader detects newly applied quickened");
assert.equal(actionBudget(newlyQuickened).totalActions, 3, "gaining quickened during a turn does not grant an action immediately");
assert.equal(actionTrackerView(newlyQuickened).quickened, true, "newly applied quickened appears immediately in the refreshed tracker");
assert.equal(actionTrackerView(newlyQuickened).quickenedPending, true, "newly applied quickened is marked for next turn");
assert.equal(actionTrackerView(newlyQuickened).canSpendQuickened, false);
assert.equal(actionTrackerView(newlyQuickened).canRefundQuickened, false);
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [card] })).totalActions, 1, "pending quickened does not refund actions already spent");
actor.itemTypes.condition = [];
assert.equal(actionTrackerView(trackedActionContext(context, { combat, messages: [] })).quickened, false, "removing pending quickened removes its indicator");
actor.itemTypes.condition = [{ ...condition("quickened"), active: false }];
assert.equal(actionTrackerView(trackedActionContext(context, { combat, messages: [] })).quickened, false, "inactive quickened is not shown as pending");
actor.itemTypes.condition = [condition("slowed", 2), condition("stunned", 1), condition("quickened")];
let pool = createTurnSnapshot(combat).pool;
assert.equal(pool.normalActions, 2, "stunned and slowed overlap; lose quickened first");
assert.equal(pool.quickenedActions, 0);
actor.itemTypes.condition = [{ slug: "stunned", system: { value: { isValued: false, value: null } } }];
assert.equal(createTurnSnapshot(combat).pool.totalActions, 0, "duration-based stunned loses every action");
actor.itemTypes.condition = [condition("quickened")];
actor.itemTypes.effect = [{ slug: "spell-effect-haste" }];
combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat, { key: "quick-turn" });
const stride = message("stride", "A", { item: { slug: "stride", actionCost: { type: "action", value: 1 } } });
stride.flags["pf2e-combater"] = { actionSpend: chatActionEntry(stride, combat) };
tracked = trackedActionContext(context, { combat, messages: [stride] });
assert.equal(actionBudget(tracked).normalActions, 3);
assert.equal(actionBudget(tracked).quickenedActions, 0);
assert.equal(quickenedEligible({ slug: "step" }, 1, tracked), false);
assert.equal(quickenedEligible({ slug: "strike" }, 2, tracked), false);
actor.flags["pf2e-combater"] = { actionReceipts: { turnKey: "quick-turn", entries: { "done-stride": { cost: 1, slug: "stride" } } } };
const completedQuickened = trackedActionContext(context, { combat, messages: [] });
assert.deepEqual(completedQuickened.actionTracker.quickenedExecutionIds, ["done-stride"]);
const quickenedRows = [{ id: "stride", slug: "stride", name: "Stride", actionCost: 1 }, { id: "strike", slug: "strike", name: "Strike", actionCost: 1 }];
const completedModel = buildActionBuilderModel({ context: completedQuickened, candidates: quickenedRows, draft: { steps: [
  { instanceId: "done-stride", actionKey: "stride", actionCost: 1, execution: { status: "done" } },
  { instanceId: "later-strike", actionKey: "strike", actionCost: 1 },
] } });
assert.deepEqual(completedModel.draft.steps.filter((step) => step.usesQuickened).map((step) => step.instanceId), ["done-stride"],
  "completed Quickened action keeps its marker without marking another planned action");
actor.flags["pf2e-combater"].actionReceipts.entries["done-stride"].reverted = true;
assert.deepEqual(trackedActionContext(context, { combat, messages: [] }).actionTracker.quickenedExecutionIds, [], "undo clears the spent Quickened marker");
actor.flags = {};
actor.itemTypes.condition = [condition("slowed", 3)];
assert.equal(actionBudget(trackedActionContext(context, { combat, messages: [] })).totalActions, 4, "mid-turn condition changes do not alter regained pool");
actor.itemTypes.condition = [];

const globals = { game: globalThis.game, Hooks: globalThis.Hooks, foundry: globalThis.foundry };
const callbacks = new Map();
const updates = [];
const assignPath = (object, path, value) => {
  const parts = path.split(".");
  for (const part of parts.slice(0, -1)) object = object[part] ??= {};
  if (parts.at(-1).startsWith("-=")) delete object[parts.at(-1).slice(2)];
  else object[parts.at(-1)] = value;
};
actor.update = async (changes) => { updates.push(changes); for (const [key, value] of Object.entries(changes)) assignPath(actor, key, value); };
try {
  globalThis.game = { combat, messages: [], user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" } } };
  globalThis.Hooks = { on: (event, fn) => { const handlers = callbacks.get(event) ?? []; handlers.push(fn); callbacks.set(event, handlers); } };
  registerActionTrackerHooks(() => {});
  await adjustTrackedActions(trackedActionContext(context), "quickened", 1);
  let manualQuickened = trackedActionContext(context, { combat, messages: [stride] });
  assert.equal(actionBudget(manualQuickened).normalActions, 2, "a manually spent quickened action cannot pay for a later Stride");
  await adjustTrackedActions(manualQuickened, "quickened", -1);
  await adjustTrackedActions(trackedActionContext(context, { combat, messages: [stride] }), "quickened", -1);
  manualQuickened = trackedActionContext(context, { combat, messages: [stride, { ...stride, id: "stride-again" }] });
  assert.equal(actionBudget(manualQuickened).normalActions, 3);
  assert.equal(actionBudget(manualQuickened).quickenedActions, 0, "a refunded quickened action can be spent once more");
  actor.flags = {};
  updates.length = 0;
  const end = beginTrackedExecution(context, { instanceId: "execute" });
  const posted = message("executed-message", "D");
  posted.updateSource = (changes) => { for (const [key, value] of Object.entries(changes)) assignPath(posted, key, value); };
  callbacks.get("preCreateChatMessage")[0](posted);
  end();
  assert.equal(posted.flags["pf2e-combater"].actionSpend.executionId, "execute");
  globalThis.game.messages = [posted];
  const step = { instanceId: "execute", actionCost: 2, action: { slug: "spell", name: "Spell" } };
  const result = { status: "done", patch: { execution: { status: "done", revert: { ops: [{ kind: "chat", messageId: posted.id }] } } } };
  await recordTrackedExecution(context, step, result);
  await recordTrackedExecution(context, step, result);
  assert.equal(updates.length, 1, "duplicate completion does not write twice");
  tracked = trackedActionContext(context);
  assert.equal(tracked.actionsSpent.normal, 2, "execution and its chat charge once");
  let model = buildActionBuilderModel({ context: tracked, candidates: [{ id: "spell", slug: "spell", actionCost: 2 }], draft: { steps: [{ ...step, actionKey: "spell", execution: result.patch.execution }] } });
  assert.equal(model.usage.normal, 0, "completed draft action is already in the tracker");
  assert.equal(model.remainingNormalActions, 1);
  await refundTrackedExecution(context, step);
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 3, "execution refund also suppresses any retained chat");
  assert.equal(trackedActionContext(context).actionTracker.executionIds.length, 0, "refunded step is pending again");
  await recordTrackedExecution(context, step, result);
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 1, "re-execution charges again");
  await adjustTrackedActions(trackedActionContext(context), "normal", -1);
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 2);
  await setQuickenedAllowance(trackedActionContext(context), ["step"]);
  assert.deepEqual(trackedActionContext(context).quickenedAllowed, ["step"]);
  assert.equal(actionTrackerView(trackedActionContext(context)).editable, true);
  globalThis.game.user = { id: "player", isGM: false };
  actor.isOwner = true;
  assert.equal(actionTrackerView(trackedActionContext(context)).editable, true);
  actor.isOwner = false;
  assert.equal(actionTrackerView(trackedActionContext(context)).editable, false);
  globalThis.game.user = { id: "gm", isGM: true };
  const changed = { round: 2, turn: 0 };
  callbacks.get("preUpdateCombat")[0](combat, changed);
  combat.round = 2;
  combat.flags["pf2e-combater"].actionTurn = changed["flags.pf2e-combater.actionTurn"];
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 3, "new turn ignores all old receipts and messages");
  assert.equal(trackedActionContext(context).actionsSpent.total, 0);
  const fresh = trackedActionContext(context);
  const plannerContext = { ...fighterContext, ...fresh, actor: fighterContext.actor };
  const plans = buildTurnPlans({ ...plannerContext, actionsSpent: { normal: 2 } }, fixtureCandidates);
  assert.ok(plans.every((plan) => plan.totalCost <= 1), "planner honors remaining tracker budget");
  const onlyQuickened = { ...plannerContext, turnActionPool: { normalActions: 3, quickenedActions: 1 }, actionsSpent: { normal: 3 }, quickenedAllowed: ["strike"] };
  assert.ok(buildTurnPlans(onlyQuickened, fixtureCandidates).some((plan) => plan.totalCost === 1), "only quickened remaining still yields legal plans");
  assert.ok(buildTurnPlans({ ...onlyQuickened, quickenedAllowed: [] }, fixtureCandidates).every((plan) => plan.totalCost === 0), "unknown quickened restriction never funds Auto-fill");
  const updatedCard = { content: '<h4 class="action">Spell <span class="action-glyph">T</span></h4>' };
  callbacks.get("preUpdateChatMessage")[0](card, updatedCard);
  assert.equal(updatedCard["flags.pf2e-combater.actionSpend"].cost, 3);
  assert.equal(updatedCard["flags.pf2e-combater.actionSpend"].turnKey, "turn-one", "editing old chat does not move it into this turn");
  const movementStep = { instanceId: "move", actionCost: 1, action: { slug: "stride", requiresDestination: true } };
  await recordTrackedExecution(fresh, movementStep, { status: "done" });
  assert.equal(actionBudget(trackedActionContext({ ...context, actionsSpent: { movement: 1 } })).normalActions, 1, "manual movement after a managed Stride is separate spending");
  assert.equal(markMovementActionSpent({ id: "token" }, { combat, changed: { x: 100 }, options: { combaterActionSpend: true } }), false);
  assert.equal(markMovementActionSpent({ id: "token" }, { combat, changed: { x: 100 }, options: { isUndo: true } }), false);
  await refundTrackedExecution(fresh, movementStep);
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 3, "undoing managed movement refunds its action");
  const stunned = { ...condition("stunned", 2), actor };
  actor.itemTypes.condition = [stunned];
  callbacks.get("createItem")[0](stunned, {}, "gm");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 1, "mid-turn stunned spends remaining actions");
  actor.itemTypes.condition = [];
  callbacks.get("deleteItem")[0](stunned, {}, "gm");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(actionBudget(trackedActionContext(context)).normalActions, 1, "removing stunned does not regain spent actions");
  actor.itemTypes.condition = [condition("quickened")];
  globalThis.game.user = { id: "player", isGM: false };
  const pendingView = actionTrackerView(trackedActionContext(context));
  assert.equal(pendingView.quickenedPending, true, "non-GM viewers see pending quickened without GM flag writes");
  assert.equal(pendingView.canSpendQuickened, false);
  const nextTurn = { round: 3, turn: 0 };
  callbacks.get("preUpdateCombat")[0](combat, nextTurn);
  combat.round = 3;
  combat.flags["pf2e-combater"].actionTurn = nextTurn["flags.pf2e-combater.actionTurn"];
  const nextTurnContext = trackedActionContext(context);
  assert.equal(actionTrackerView(nextTurnContext).quickenedPending, false, "next turn converts pending quickened to the normal counter");
  assert.equal(actionTrackerView(nextTurnContext).quickenedLeft, 1);
  assert.equal(actionBudget(nextTurnContext).totalActions, 4);

  // A HUD-applied condition has no source restrictions: the GM configures it once.
  globalThis.game.user = { id: "gm", isGM: true };
  actor.itemTypes.effect = [];
  const manualCondition = { ...condition("quickened"), id: "manual-quickened", flags: {} };
  actor.itemTypes.condition = [manualCondition];
  actor.updateEmbeddedDocuments = async (type, changes) => {
    assert.equal(type, "Item");
    for (const patch of changes) {
      const item = actor.itemTypes.condition.find((entry) => entry.id === patch._id);
      for (const [path, value] of Object.entries(patch)) if (path !== "_id") assignPath(item, path, value);
    }
  };
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat, { key: "manual-quickened-turn" });
  let manualContext = trackedActionContext(context);
  assert.equal(actionTrackerView(manualContext).quickenedNeedsConfiguration, true, "unknown restrictions are visible instead of silently skipping the extra action");
  assert.equal(actionTrackerView(manualContext).canConfigureQuickened, true);
  const supportCandidates = [
    { id: "demoralize", slug: "demoralize", source: "skill", score: 109 },
    { id: "seek", slug: "seek", source: "action", score: 96 },
    { id: "recall-knowledge", slug: "recall-knowledge", source: "skill", score: 66 },
    { id: "strike", slug: "strike", source: "strike", score: 55 },
  ].map((candidate) => ({ ...candidate, name: candidate.id, actionCost: 1, confidence: "high" }));
  const supportPlans = () => buildTurnPlans({ ...fighterContext, ...trackedActionContext(context) }, supportCandidates);
  assert.equal(supportPlans()[0].totalCost, 3, "unknown quickened does not pay for arbitrary support actions");
  let configureClick;
  let dialogCount = 0;
  let refreshed = false;
  globalThis.foundry = {
    utils: { escapeHTML: (value) => value },
    applications: { api: { DialogV2: { prompt: async () => { dialogCount += 1; return " Strike , Stride "; } } } },
  };
  activateActionTrackerBindings({ _context: manualContext, refresh: async () => { refreshed = true; } }, {
    querySelectorAll: (selector) => (selector === "[data-quickened-allowance]"
      ? [{ addEventListener: (_event, callback) => { configureClick = callback; } }] : []),
  });
  await configureClick();
  assert.equal(dialogCount, 1);
  assert.equal(refreshed, true, "saving GM restrictions refreshes Auto-fill preparation");
  assert.deepEqual(manualCondition.flags["pf2e-combater"]?.quickenedAllowed, ["strike", "stride"], "GM restriction is saved on this condition instance");
  assert.equal(supportPlans()[0].totalCost, 4, "configured quickened fills the support plan with a legal fourth action");
  assert.ok(supportPlans()[0].steps.some((entry) => entry.slug === "strike"));
  combat.round += 1;
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat, { key: "manual-quickened-next-turn" });
  manualContext = trackedActionContext(context);
  assert.deepEqual(manualContext.quickenedAllowed, ["strike", "stride"], "restriction survives subsequent turns while the condition remains");
  assert.equal(supportPlans()[0].totalCost, 4);
  assert.equal(actionTrackerView(manualContext).quickenedNeedsConfiguration, false);
  actor.isOwner = true;
  globalThis.game.user = { id: "player", isGM: false };
  assert.equal(actionTrackerView(manualContext).canConfigureQuickened, false);
  await configureClick();
  assert.equal(dialogCount, 1, "player clicks cannot open GM configuration");
  await setQuickenedAllowance(manualContext, ["seek"]);
  assert.deepEqual(trackedActionContext(context).quickenedAllowed, ["strike", "stride"], "players may track spending but cannot redefine restrictions");
  globalThis.game.user = { id: "gm", isGM: true };
  actor.itemTypes.condition = [{ ...condition("quickened"), id: "new-quickened", flags: {} }];
  combat.round += 1;
  combat.flags["pf2e-combater"].actionTurn = createTurnSnapshot(combat);
  assert.deepEqual(trackedActionContext(context).quickenedAllowed, [], "a different Quickened application does not inherit old restrictions");
  actor.itemTypes.effect = [{ slug: "spell-effect-haste", isExpired: true }];
  assert.deepEqual(createTurnSnapshot(combat).quickenedAllowed, [], "expired Haste does not grant restrictions");
  actor.itemTypes.effect = [{ slug: "spell-effect-haste", isExpired: false }];
  assert.deepEqual(trackedActionContext(context).quickenedAllowed, ["strike", "stride"], "recognizing an active Haste effect fills in missing restrictions immediately");
  assert.equal(supportPlans()[0].totalCost, 4);
  await setQuickenedAllowance(trackedActionContext(context), [" Recall Knowledge ", "recall-knowledge"]);
  const customContext = trackedActionContext(context);
  assert.deepEqual(customContext.quickenedAllowed, ["recall-knowledge"], "GM can enter multi-word action names");
  const customPlans = buildTurnPlans({ ...fighterContext, ...customContext, actionsSpent: { normal: 3 } }, supportCandidates);
  assert.equal(customPlans[0].totalCost, 1);
  assert.equal(customPlans[0].steps[0].slug, "recall-knowledge", "a custom Quickened restriction can fund only the GM's permitted action");
} finally {
  globalThis.game = globals.game;
  globalThis.Hooks = globals.Hooks;
  globalThis.foundry = globals.foundry;
}
console.log("action tracker tests passed");
