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
