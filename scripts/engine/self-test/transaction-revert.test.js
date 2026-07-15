import assert from "node:assert/strict";
import { executeDropProne, revertCondition } from "../execution/conditions.js";

const conditions = [];
let decreases = 0;
const actor = {
  itemTypes: { condition: conditions },
  increaseCondition: async (slug) => {
    conditions.push({ slug });
  },
  decreaseCondition: async (slug) => {
    decreases += 1;
    const index = conditions.findIndex((condition) => condition.slug === slug);
    if (index >= 0) conditions.splice(index, 1);
  },
};

const dropped = await executeDropProne(actor);
const op = dropped.patch.execution.revert.ops[0];
assert.deepEqual(op.expectedAfter, { conditionValue: 1 });

conditions.length = 0;
const warnings = [];
await revertCondition(op, { actor, warnings });
assert.equal(decreases, 0, "condition undo must not clear state after a conflicting manual change");
assert.ok(warnings.some((warning) => warning.includes("state changed")));

console.log("PF2e Combater transaction revert test passed");
