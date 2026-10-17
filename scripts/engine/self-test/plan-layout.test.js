import assert from "node:assert/strict";
import { compactTraitChips, decoratePlanLayout } from "../../ui/panel/view-model.js";

const chip = (slug) => ({ slug, label: slug[0].toUpperCase() + slug.slice(1), class: "is-trait" });
const traits = ["attack", "agile", "finesse", "magical", "nonlethal", "unarmed"].map(chip);
const compact = compactTraitChips(traits);
assert.deepEqual(compact.chips.map((entry) => entry.slug), ["agile", "nonlethal"], "decision traits stay inline");
assert.equal(compact.overflow.label, "+4");
assert.equal(compact.overflow.tooltip, "Attack, Finesse, Magical, Unarmed");
assert.equal(compactTraitChips(traits.slice(0, 3)).overflow, null, "short trait lists are not collapsed");

const step = (id, extra = {}) => ({
  instanceId: id, name: id, actionCost: 1, targetLabel: "Riding Horse", requiresTarget: true,
  canShowExecuteStep: true, executeTooltip: "Execute", why: { score: 100, summary: "Hit it" }, ...extra,
});
const flurry = {
  isGroup: true, instanceId: "f1", actionCost: 1,
  children: [step("f1", { why: { score: 144 } }), step("f2", { actionCost: 1, why: { score: 144 } })],
};
const layout = decoratePlanLayout([
  flurry,
  step("s1", { why: { score: 126 } }),
  step("s2", { isExecutionDone: true, canShowExecuteStep: false }),
  step("s3", { why: { score: 90 } }),
  step("q1", { usesQuickened: true }),
], { openTools: new Set(["s3"]) });

assert.deepEqual(layout.steps.map((entry) => entry.stepNumber), [1, 2, 3, 4, 5]);
assert.deepEqual(layout.pipOwners, [1, 2, 4], "a group costs its activity once; done steps own no diamond");
assert.equal(layout.steps[0].pipSlots, "0");
assert.equal(layout.steps[1].pipSlots, "1");
assert.equal(layout.steps[2].pipSlots, "", "executed steps no longer light a diamond");
assert.equal(layout.steps[4].pipSlots, "q");
assert.equal(layout.quickenedOwner, 5);
assert.equal(layout.sharedTarget.label, "Riding Horse");
assert.ok(layout.steps[1].hideTarget, "a shared target is shown once, not per row");
assert.deepEqual(layout.steps[0].children[0].why.stars.map((star) => star.on), [true, true, true]);
assert.deepEqual(layout.steps[1].why.stars.map((star) => star.on), [true, true, false]);
assert.deepEqual(layout.steps[3].why.stars.map((star) => star.on), [true, false, false]);
assert.equal(layout.steps[3].toolsOpen, true, "the open tools tray survives a re-render");
assert.equal(layout.footer.instanceId, "f1", "Run next starts with the first pending step");
assert.equal(layout.footer.canRunAll, true);
assert.deepEqual(layout.quickSteps.map((entry) => entry.instanceId), ["f1", "f2", "s1", "s3", "q1"], "the minimal plan lists every step still to run");
assert.equal(layout.quickSteps[0].isNext, true);
assert.equal(layout.quickSteps[1].stepNumber, 1, "group children carry their group's number");
assert.equal(layout.quickSteps[2].pipSlots, "1", "hovering a chip lights its diamonds");
assert.equal(layout.quickSteps[2].attr, "execute-draft-step");
assert.match(layout.quickSteps[2].tooltip, /^2\. s1 Riding Horse\. Click to run\. Execute Right-click for options\.$/);
const choosing = decoratePlanLayout([
  step("t", { canChooseTarget: true, targetButtonLabel: "Choose target", executionBlocked: true }),
  step("m", { canChooseDestination: true, destinationButtonLabel: "Choose square", executionBlocked: true }),
  step("w", { executionBlocked: true, executeTooltip: "Waiting on a choice" }),
]).quickSteps;
assert.deepEqual(choosing.map((entry) => entry.attr), ["choose-target", "choose-destination", "execute-draft-step"], "a chip makes the step's missing choice before running it");
assert.equal(choosing[0].blocked, false, "a needed choice keeps the chip clickable");
assert.equal(choosing[2].blocked, true);
const tooled = decoratePlanLayout([step("x", {
  canChooseTarget: true, targetToolTip: "Use target", canCycleMap: true, mapToolLabel: "MAP -5", mapToolTip: "Cycle MAP",
  canRemoveDraftStep: true, executionBlocked: true,
})]).quickSteps[0].tools;
assert.deepEqual(tooled.map((tool) => tool.attr), ["choose-target", "cycle-map", "execute-draft-step", "remove-draft-step"], "right-click shows the row's buttons in row order");
assert.equal(tooled[1].text, "MAP -5");
assert.equal(tooled[2].disabled, true, "run stays disabled until the step is ready");

const mixed = decoratePlanLayout([step("a"), step("b", { targetLabel: "Goblin" })]);
assert.equal(mixed.sharedTarget, null, "different targets keep per-row labels");
assert.equal(decoratePlanLayout([]).footer.visible, false);
assert.equal(decoratePlanLayout([step("p", { targetLabel: "→ Orc" }), step("q", { targetLabel: "→ Orc" })]).sharedTarget.label, "Orc", "the shared-target banner shows the bare name, not a second arrow");

// Finished turn: progress, completion, generic icons dropped, setup reasons not repeated.
const finished = decoratePlanLayout([
  step("m", { name: "Stride", img: "systems/pf2e/icons/actions/OneAction.webp", isExecutionDone: true, canShowExecuteStep: false, why: { hasReasons: true, summary: "Stride into reach and Strike Rootfall.", score: 100 } }),
  step("b", { name: "Shortbow", img: "icons/weapons/bow.webp", isExecutionDone: true, canShowExecuteStep: false, why: { hasReasons: true, summary: "Stride into reach and Strike Rootfall.", score: 100 } }),
]);
assert.equal(finished.steps[0].img, "", "PF2e's generic action icon is dropped");
assert.equal(finished.steps[1].img, "icons/weapons/bow.webp", "real art is kept");
assert.equal(finished.steps[0].why.hasReasons, false, "a setup step doesn't repeat its payoff's reason");
assert.equal(finished.steps[1].why.hasReasons, true);
assert.equal(finished.complete.label, "Turn complete");
assert.equal(finished.progress.label, "2/2 done");
assert.equal(finished.footer.visible, false, "nothing left to run");
const halfway = decoratePlanLayout([step("x", { isExecutionDone: true, canShowExecuteStep: false }), step("y")]);
assert.equal(halfway.complete, null);
assert.deepEqual([halfway.progress.label, halfway.progress.percent], ["1/2 done", 50]);
assert.equal(decoratePlanLayout([step("z")]).progress, null, "no progress line before anything runs");
assert.equal(compactTraitChips([chip("reload-0"), chip("deadly-d10")]).chips.map((entry) => entry.slug).join(), "deadly-d10", "Reload 0 is not shown");

console.log("Plan layout tests passed.");
