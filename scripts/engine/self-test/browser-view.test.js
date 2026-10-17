import assert from "node:assert/strict";
import { browserViewContext } from "../../ui/browser-view.js";

const action = (key, extra = {}) => ({ key, name: key, reason: `${key} helps`, detailChips: [], ...extra });
const base = {
  readonly: false,
  builder: {
    remainingTotalActions: 2,
    tabsList: [{ id: "one", active: true, sections: [{ label: "Attacks", actions: [
      action("Strike", { img: "icons/weapons/sword.webp", detailChips: [{ class: "is-preflight", label: "65 %" }] }),
      action("Step", { img: "systems/pf2e/icons/actions/OneAction.webp" }),
      action("Stride", { slug: "stride", img: "systems/pf2e/icons/actions/Passive.webp" }),
      action("Haste", { overBudget: true, disabledReason: "Not enough actions remaining." }),
    ] }] }],
  },
};

const full = browserViewContext(base);
assert.equal(full.compact, false);
assert.equal(full.builder.tabsList[0].sections[0].actions[0].tileTooltip, undefined, "the list layout builds no tile tooltips");

const compact = browserViewContext(base, { compact: true });
const [strike, step, stride, haste] = compact.builder.tabsList[0].sections[0].actions;
assert.equal(stride.tileImg, "icons/skills/movement/feet-winged-boots-brown.webp", "basic actions get recognizable art");
assert.equal(strike.tileImg, "icons/weapons/sword.webp");
assert.equal(step.tileImg, "", "generic action art shows the name instead");
assert.equal(compact.compact, true);
assert.equal(strike.tileTooltip, "Strike (65%) · Strike helps · Click to add, Shift-click as uncounted. Right-click to star.", "a tile's tooltip carries the row's name, odds and reason");
assert.match(haste.tileTooltip, /Not enough actions remaining\. Shift-click to add as uncounted\.$/, "an over-budget tile says why, and how to add it anyway");
assert.doesNotMatch(browserViewContext({ ...base, readonly: true }, { compact: true }).builder.tabsList[0].sections[0].actions[0].tileTooltip, /Click to add/, "read-only tiles don't offer to add");

console.log("Browser view tests passed.");
