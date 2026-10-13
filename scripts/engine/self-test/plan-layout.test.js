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

console.log("Plan layout tests passed.");
