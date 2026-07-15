import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { buildTurnPlans } from "../planner.js";
import {
  activeTurnIntentCount,
  applyTurnIntentToPlan,
  normalizeTurnIntent,
  turnIntentActionBudget,
  turnIntentCandidateAllowed,
  turnIntentPlanAllowed,
} from "../planner/turn-intent.js";

function candidate(id, score, fields = {}) {
  return {
    id,
    name: id,
    slug: id,
    source: "system-inferred",
    role: "buff",
    actionCost: 1,
    score,
    confidence: "high",
    ...fields,
  };
}

const intent = normalizeTurnIntent({
  lockedTargetIds: ["token-a", "token-a"],
  requiredActionKey: "required",
  noSpellSlots: true,
  stayRanged: true,
  endInCover: true,
  preserveFinalAction: true,
});
assert.deepEqual(intent.lockedTargetIds, ["token-a"], "turn intent should normalize locked targets");
assert.equal(activeTurnIntentCount(intent), 6, "turn intent badge should count each active control");
assert.deepEqual(
  turnIntentActionBudget({ preserveFinalAction: true }, { normalActions: 3, quickenedActions: 1, totalActions: 4 }),
  { normalActions: 2, quickenedActions: 1, totalActions: 3, reservedActions: 1 },
  "preserve final action should reserve one normal action without consuming Quickened",
);

const slotSpell = candidate("slot-spell", 100, {
  source: "spell-curated",
  rank: 3,
  spellResource: { type: "spontaneous", rank: 3, remaining: 2, max: 3 },
});
const cantrip = candidate("cantrip", 80, {
  source: "spell-curated",
  isCantrip: true,
  spellResource: { type: "cantrip", rank: 1 },
});
assert.equal(turnIntentCandidateAllowed({ noSpellSlots: true }, slotSpell), false, "no-slot intent should reject slotted spells");
assert.equal(turnIntentCandidateAllowed({ noSpellSlots: true }, cantrip), true, "no-slot intent should retain cantrips");

const melee = candidate("melee", 90, {
  source: "strike",
  role: "damage",
  attackTrait: true,
  targetingProfile: { enemy: true, reach: true },
});
const ranged = candidate("ranged", 85, {
  source: "strike",
  role: "damage",
  attackTrait: true,
  range: { increment: 60 },
  targetingProfile: { enemy: true, maxRange: 60 },
});
assert.equal(turnIntentCandidateAllowed({ stayRanged: true }, melee), false, "stay-ranged intent should reject melee offense");
assert.equal(turnIntentCandidateAllowed({ stayRanged: true }, ranged), true, "stay-ranged intent should retain ranged offense");

const stride = candidate("stride", 30, {
  source: "movement",
  role: "movement",
  requiresDestination: true,
});
assert.equal(turnIntentPlanAllowed({ endInCover: true }, [ranged]), false, "cover intent should require movement");
assert.equal(turnIntentPlanAllowed({ endInCover: true }, [stride, ranged]), true, "cover intent should accept a movement plan");
assert.equal(applyTurnIntentToPlan({ endInCover: true }, [stride])[0].routeMode, "cover", "cover intent should route movement toward cover");

const required = candidate("required", 15);
const fillers = [candidate("filler-1", 50), candidate("filler-2", 45), candidate("filler-3", 40)];
const requiredPlans = buildTurnPlans(
  { ...fighterContext, turnIntent: { requiredActionKey: "required", preserveFinalAction: true } },
  [...fillers, required],
);
assert.ok(requiredPlans[0].steps.length > 0, "required-action intent should still produce a plan");
assert.equal(requiredPlans.every((plan) => plan.steps.some((step) => step.id === "required")), true,
  "every offered plan should contain the required action");
assert.equal(requiredPlans.every((plan) => plan.totalCost <= 2), true,
  "preserve-final-action intent should cap planner spending");

const noSlotPlans = buildTurnPlans(
  { ...fighterContext, turnIntent: { noSpellSlots: true } },
  [slotSpell, cantrip, ...fillers],
);
assert.equal(noSlotPlans.every((plan) => plan.steps.every((step) => step.id !== "slot-spell")), true,
  "planner should never offer a slotted spell under no-slot intent");

const coverPlans = buildTurnPlans(
  { ...fighterContext, turnIntent: { endInCover: true } },
  [stride, ranged, ...fillers],
);
assert.ok(coverPlans[0].steps.length > 0, "end-in-cover intent should produce a movement plan");
assert.equal(coverPlans.every((plan) => plan.steps.some((step) => step.id === "stride" && step.routeMode === "cover")), true,
  "every cover-constrained plan should carry a cover route");
