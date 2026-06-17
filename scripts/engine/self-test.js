import assert from "node:assert/strict";
import { confidenceLabel } from "./confidence.js";
import { fighterContext, fixtureCandidates } from "./fixtures.js";
import { actionBudget, bestTurnPlan, buildTurnPlans } from "./planner.js";
import { scoreCandidate } from "./scoring.js";
import { buildCandidates } from "./candidates.js";
import { classifySystemAction } from "./action-classifier.js";
import { classifySpell } from "./spell-classifier.js";
import { readActionSources } from "../readers/action-reader.js";
import { readActorProfile } from "../readers/actor-profile.js";
import { readSpellActions } from "../readers/spell-reader.js";
import { readCombatContext } from "../state/combat-context.js";
import { documentRelevantToContext } from "../state/context-relevance.js";
import {
  consumeTokenRefreshChange,
  markMovementActionSpent,
  movementActionsSpent,
  tokenUpdateAffectsCombatGeometry,
  tokenUpdateAffectsMovement,
} from "../state/token-refresh.js";
import { readVisionerCoverState, readVisionerDetectionState } from "../integrations/visioner.js";
import { findCustomAction } from "../catalog/custom-actions.js";
import { selectableAlternativePlans, selectDisplayPlan } from "../ui/plan-selection.js";
import { movementPreviewForStep } from "../ui/movement-preview.js";

const plans = buildTurnPlans(fighterContext, fixtureCandidates);
assert.ok(plans.length >= 1);

const best = bestTurnPlan(fighterContext, fixtureCandidates);
assert.equal(best.id, "demoralize+strike+raise-a-shield");
assert.equal(best.actor.id, "fighter-1");
assert.equal(best.target.name, "Ogre");
assert.equal(best.totalCost, 3);
assert.equal(best.summary, "Demoralize -> Strike -> Raise a Shield");
assert.equal(confidenceLabel(best.confidence), "Medium");

assert.equal(tokenUpdateAffectsCombatGeometry({ name: "Calder" }), false);
assert.equal(tokenUpdateAffectsCombatGeometry({ x: 10 }), true);
assert.equal(tokenUpdateAffectsCombatGeometry({ document: { y: 20 } }), true);
assert.equal(tokenUpdateAffectsMovement({ name: "Calder" }), false);
assert.equal(tokenUpdateAffectsMovement({ x: 10 }), true);
assert.equal(tokenUpdateAffectsMovement({ document: { elevation: 5 } }), true);
const tokenRefreshSnapshots = new Map();
const movingToken = {
  id: "token-calder",
  x: 0,
  y: 0,
  document: { uuid: "Scene.Token.token-calder", x: 0, y: 0 },
};
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), true);
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), false);
movingToken.x = 5;
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), true);
const movementSpendMap = new Map();
const movementCombat = {
  id: "combat-1",
  round: 1,
  turn: 0,
  started: true,
  combatant: {
    id: "combatant-calder",
    tokenId: "token-calder",
    token: { id: "token-calder" },
    tokenDocument: { uuid: "Scene.Token.token-calder" },
  },
};
assert.equal(markMovementActionSpent({ id: "other-token" }, { combat: movementCombat, changed: { x: 5 }, spends: movementSpendMap }), false);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { name: "Calder" }, spends: movementSpendMap }), false);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { x: 10 }, spends: movementSpendMap }), true);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { y: 10 }, spends: movementSpendMap }), true);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { x: 15 }, spends: movementSpendMap }), true);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { y: 15 }, spends: movementSpendMap }), false);
assert.equal(movementActionsSpent(movementCombat, movementSpendMap), 3);
assert.equal(movementActionsSpent({ ...movementCombat, turn: 1 }, movementSpendMap), 0);

const relevanceContext = {
  actor: { id: "actor-active" },
  combatant: { actor: { id: "actor-active" } },
  token: { id: "token-active", uuid: "Scene.scene.Token.token-active" },
  battlefield: {
    targets: [{
      actor: { id: "actor-target" },
      token: { id: "token-target", uuid: "Scene.scene.Token.token-target" },
    }],
  },
};
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-active.Item.condition" }, relevanceContext), true);
assert.equal(
  documentRelevantToContext({ type: "condition", uuid: "Scene.scene.Token.token-active.Actor.actor-active.Item.condition" }, relevanceContext),
  true,
);
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-target.Item.condition" }, relevanceContext), true);
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-other.Item.condition" }, relevanceContext), false);
assert.equal(documentRelevantToContext({ documentName: "Actor", id: "actor-active" }, relevanceContext), true);

const excellentSingleAction = bestTurnPlan(fighterContext, [
  {
    id: "excellent",
    name: "Excellent Strike",
    actionCost: 1,
    score: 100,
    confidence: "high",
    reason: "Best value.",
  },
  {
    id: "bad-one",
    name: "Bad Filler One",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
  {
    id: "bad-two",
    name: "Bad Filler Two",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
  {
    id: "bad-three",
    name: "Bad Filler Three",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
]);
assert.equal(excellentSingleAction.summary, "Excellent Strike");

const untargetedStrike = scoreCandidate({
  actor: { id: "kobold", name: "Nakpik" },
  token: { id: "token-nakpik", name: "Nakpik" },
  battlefield: { targets: [], enemies: [] },
}, {
  id: "shortsword",
  name: "Shortsword",
  slug: "strike",
  source: "strike",
  actionCost: 1,
  range: { max: 5 },
});
assert.equal(untargetedStrike.score, -999);
assert.equal(untargetedStrike.suggestedTarget, null);
assert.equal(untargetedStrike.reason, "No valid enemy target.");

const untargetedStep = scoreCandidate({
  actor: { id: "kobold", name: "Nakpik" },
  token: { id: "token-nakpik", name: "Nakpik" },
  battlefield: { targets: [], enemies: [] },
}, {
  id: "step",
  name: "Step",
  slug: "step",
  source: "generic",
  actionCost: 1,
});
assert.equal(untargetedStep.score, -999);
assert.equal(untargetedStep.suggestedTarget, null);
assert.equal(untargetedStep.reason, "No valid enemy target.");

const noTargetBuild = buildCandidates({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "shortsword",
          type: "strike",
          label: "Shortsword",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "shortsword", system: { traits: { value: [] } } },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: { speed: 25, conditions: { slugs: [], values: {} } },
  token: { id: "token-nakpik", name: "Nakpik", center: { x: 0, y: 0 } },
  battlefield: { targets: [], enemies: [] },
  targets: undefined,
});
assert.equal(noTargetBuild.candidates.some((action) => ["step", "stride", "strike"].includes(action.slug)), false);

const manyFreeActions = Array.from({ length: 40 }, (_, index) => ({
  id: `free-${index}`,
  name: `Free ${index}`,
  actionCost: 0,
  score: 100 - index,
  confidence: "high",
  reason: "Free option.",
}));
const boundedPlans = buildTurnPlans(fighterContext, manyFreeActions);
assert.ok(boundedPlans.length <= 256);
assert.ok(boundedPlans.every((plan) => plan.steps.filter((step) => step.actionCost === 0).length <= 1));

const slowedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["slowed"],
      values: { slowed: 2 },
    },
  },
};
assert.equal(actionBudget(slowedContext).normalActions, 1);
assert.equal(bestTurnPlan(slowedContext, fixtureCandidates).totalCost, 1);

const stunnedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["stunned"],
      values: { stunned: 2 },
    },
  },
};
assert.equal(actionBudget(stunnedContext).normalActions, 1);
assert.equal(bestTurnPlan(stunnedContext, fixtureCandidates).totalCost, 1);

const movedThisTurnContext = {
  ...fighterContext,
  actionsSpent: {
    movement: 2,
    normal: 2,
    total: 2,
  },
};
assert.equal(actionBudget(movedThisTurnContext).normalActions, 1);
assert.equal(bestTurnPlan(movedThisTurnContext, fixtureCandidates).totalCost, 1);

const quickenedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["quickened"],
      values: { quickened: null },
    },
  },
};
const quickenedPlan = bestTurnPlan(quickenedContext, [
  ...fixtureCandidates,
  {
    id: "stride",
    name: "Stride",
    slug: "stride",
    actionCost: 1,
    source: "generic",
    score: 55,
    confidence: "medium",
    reason: "Use quickened action to reposition.",
  },
]);
assert.equal(actionBudget(quickenedContext).quickenedActions, 1);
assert.equal(quickenedPlan.totalCost, 4);
assert.ok(quickenedPlan.steps.some((step) => step.slug === "stride"));

const redundantBasicMovementPlan = bestTurnPlan(fighterContext, [{
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  score: 70,
  confidence: "medium",
  reason: "Target is not frightened.",
}, {
  id: "step",
  name: "Step",
  slug: "step",
  actionCost: 1,
  source: "generic",
  score: 60,
  confidence: "medium",
  reason: "Adjust position.",
}, {
  id: "stride",
  name: "Stride",
  slug: "stride",
  actionCost: 1,
  source: "generic",
  score: 59,
  confidence: "medium",
  reason: "Move to a better square.",
}]);
assert.equal(
  redundantBasicMovementPlan.steps.filter((step) => ["step", "stride"].includes(step.slug)).length,
  1,
);

const setupBeforeStrikePlans = buildTurnPlans(fighterContext, [{
  id: "mandibles",
  name: "Mandibles",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Melee target is in reach.",
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  role: "debuff",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Target is not frightened.",
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  role: "setup",
  actionCost: 1,
  source: "generic",
  score: 75,
  confidence: "medium",
  reason: "Target is in melee and not off-guard.",
}]);
const feintStrikePlan = setupBeforeStrikePlans.find((plan) => {
  const ids = new Set(plan.steps.map((step) => step.id));
  return ids.has("mandibles") && ids.has("demoralize") && ids.has("feint");
});
assert.deepEqual(
  feintStrikePlan.steps.map((step) => step.slug),
  ["demoralize", "feint", "strike"],
);

const speedProfile = readActorProfile({
  id: "speedy",
  name: "Speedy",
  items: [],
  itemTypes: { condition: [] },
  system: {
    attributes: {
      speed: { value: 35 },
      hp: { value: 10, max: 10 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(speedProfile.speed, 35);

// Prepared PF2e actors expose Speed under system.movement.speeds.land.
const movementSpeedProfile = readActorProfile({
  id: "bulette",
  name: "Bulette",
  items: [],
  itemTypes: { condition: [] },
  system: {
    movement: { speeds: { land: { type: "land", value: 40, base: 40 } } },
    attributes: { hp: { value: 10, max: 10 } },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(movementSpeedProfile.speed, 40);

const hydraProfileFromGeneratedStrike = readActorProfile({
  id: "hydra-reach",
  name: "Hydra Reach",
  type: "npc",
  items: [],
  itemTypes: { condition: [] },
  system: {
    actions: [{
      type: "strike",
      slug: "fangs",
      label: "Fangs",
      item: {
        system: { traits: { value: ["reach-10"] } },
      },
      traits: [{ slug: "attack" }, { slug: "reach-10" }],
    }],
    attributes: {
      speed: { value: 25 },
      hp: { value: 90, max: 90 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(hydraProfileFromGeneratedStrike.reach, 10);
assert.equal(hydraProfileFromGeneratedStrike.meleeReach, 10);

const focusedAssaultFromGeneratedReach = scoreCandidate({
  ...fighterContext,
  profile: hydraProfileFromGeneratedStrike,
  targets: [{
    ...fighterContext.targets[0],
    name: "Valeros",
    distance: 10,
  }],
}, {
  id: "focused-assault",
  name: "Focused Assault",
  slug: "focused-assault",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  activityProfile: {
    includesStrike: true,
    focusedStrike: true,
  },
});
assert.ok(focusedAssaultFromGeneratedReach.score > 100);
assert.equal(focusedAssaultFromGeneratedReach.reason, "Focused Assault focuses attacks on Valeros.");

const displayPlans = [
  { id: "main", summary: "Main" },
  { id: "alt", summary: "Alternative" },
  { id: "third", summary: "Third" },
];
assert.equal(selectDisplayPlan(displayPlans, null).id, "main");
assert.equal(selectDisplayPlan(displayPlans, "alt").id, "alt");
assert.equal(selectDisplayPlan(displayPlans, "missing").id, "main");
assert.deepEqual(
  selectableAlternativePlans(displayPlans, displayPlans[1]).map((plan) => plan.id),
  ["main", "third"],
);

const stridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ogre",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, { slug: "stride" }, { gridSize: 5 });
assert.equal(stridePreview.enabled, true);
assert.equal(stridePreview.distanceFeet, 25);
assert.equal(stridePreview.recommendedCenter.x, 25);
assert.equal(stridePreview.recommendedCenter.y, 0);

const combatOnlyStridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      id: "combat-target",
      name: "Combat Target",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, {
  slug: "stride",
  preferredTarget: {
    id: "off-combat-target",
    name: "Off Combat Target",
    token: { center: { x: -100, y: 0 } },
    distance: 100,
  },
}, { gridSize: 5 });
assert.equal(combatOnlyStridePreview.enabled, true);
assert.equal(combatOnlyStridePreview.recommendedCenter.x, 25);
assert.equal(combatOnlyStridePreview.recommendedCenter.y, 0);

const wallAwareStridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ogre",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, { slug: "stride" }, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 25 && to.y === 0,
});
assert.equal(wallAwareStridePreview.enabled, true);
assert.notDeepEqual(wallAwareStridePreview.recommendedCenter, { x: 25, y: 0 });
assert.ok(!wallAwareStridePreview.reachableCenters.some((center) => center.x === 25 && center.y === 0));

const previousWallPreviewCanvas = globalThis.canvas;
const previousWallPreviewFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move" && ray.B.x === 50 && ray.B.y === 0,
    },
  };
  const foundryWallAwareStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: {
      targets: [{
        name: "Ogre",
        token: { center: { x: 100, y: 0 } },
        distance: 100,
      }],
    },
  }, { slug: "stride" }, { gridSize: 5, collisionScale: 2 });
  assert.notDeepEqual(foundryWallAwareStridePreview.recommendedCenter, { x: 25, y: 0 });
} finally {
  globalThis.canvas = previousWallPreviewCanvas;
  globalThis.foundry = previousWallPreviewFoundry;
}

const previousTokenCollisionPreviewCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    tokens: {
      placeables: [{
        id: "active-token",
        checkCollision: (to, options) => options?.type === "move" && to.x === 25 && to.y === 0,
      }],
    },
  };
  const tokenCollisionStridePreview = movementPreviewForStep({
    token: { id: "active-token", center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: {
      targets: [{
        name: "Ogre",
        token: { center: { x: 100, y: 0 } },
        distance: 100,
      }],
    },
  }, { slug: "stride" }, { gridSize: 5 });
  assert.notDeepEqual(tokenCollisionStridePreview.recommendedCenter, { x: 25, y: 0 });
} finally {
  globalThis.canvas = previousTokenCollisionPreviewCanvas;
}

const stepPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, { slug: "step" }, { gridSize: 5 });
assert.equal(stepPreview.enabled, true);
assert.equal(stepPreview.distanceFeet, 5);
assert.equal(stepPreview.reachableCenters.length, 8);

// A Stride -> Stride -> Strike composite previews one landing cell per Stride,
// each in its own colour, progressing toward the target.
const compositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: 0 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(compositePreview.enabled, true);
assert.equal(compositePreview.stridePath.length, 2);
assert.notEqual(compositePreview.stridePath[0].color, compositePreview.stridePath[1].color);
assert.ok(compositePreview.stridePath[1].center.x > compositePreview.stridePath[0].center.x);
assert.ok(compositePreview.stridePath[0].marker.strokes.length === 2);

const attackBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 30, y: 0 } }, distance: 30 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x >= 27.5 && to.x <= 32.5 && to.y >= -2.5 && to.y <= 2.5,
});
assert.equal(attackBlockedCompositePreview.enabled, false);

const centerBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 30, y: 0 } }, distance: 30 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x === 30 && to.y === 0,
});
assert.equal(centerBlockedCompositePreview.enabled, false);

const perimeterBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 35 } },
  battlefield: {
    targets: [{
      name: "Caged Mitflit",
      token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      distance: 40,
    }],
  },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x !== 40 || to.y !== 0,
});
assert.equal(perimeterBlockedCompositePreview.enabled, false);

const preferredTargetCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{ id: "blocked", name: "Blocked", token: { center: { x: -35, y: 0 } }, distance: 35 }],
    enemies: [{ id: "mitflit", name: "Mitflit", token: { center: { x: 35, y: 0 } }, distance: 35 }],
  },
}, {
  slug: "stride-strike-claw",
  preferredTarget: { id: "mitflit", name: "Mitflit", token: { center: { x: 35, y: 0 } }, distance: 35 },
  targetingProfile: { preferredTargetId: "mitflit", preferredTargetName: "Mitflit" },
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(preferredTargetCompositePreview.enabled, true);
assert.ok(preferredTargetCompositePreview.destinationCenter.x > 0);

const stepwiseCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 20 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  pathBlocked: (from, to) => Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) > 5,
});
assert.equal(stepwiseCompositePreview.enabled, true);
assert.equal(stepwiseCompositePreview.stridePath.length, 1);

const routedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 20 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: 0 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 20 && to.y === 0,
});
assert.equal(routedCompositePreview.enabled, true);
assert.equal(routedCompositePreview.stridePath.length, 2);
assert.ok(!routedCompositePreview.stridePath.some((step) => step.center.x === 20 && step.center.y === 0));

const fastestCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 30 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 35, y: 0 } }, distance: 35 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 25 && to.y === 0,
});
assert.equal(fastestCompositePreview.enabled, true);
assert.equal(fastestCompositePreview.destinationCenter.cost, 25);

const directCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: -10 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(directCompositePreview.enabled, true);
assert.ok(directCompositePreview.stridePath.every((step) =>
  step.trail.every((point) => point.y >= -10),
));

const shortTwoStrideCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(shortTwoStrideCompositePreview.enabled, true);
assert.equal(shortTwoStrideCompositePreview.stridePath.length, 2);
assert.notEqual(
  `${shortTwoStrideCompositePreview.stridePath[0].center.x},${shortTwoStrideCompositePreview.stridePath[0].center.y}`,
  `${shortTwoStrideCompositePreview.stridePath[1].center.x},${shortTwoStrideCompositePreview.stridePath[1].center.y}`,
);

const skirmishCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ id: "mitflit", name: "Mitflit", token: { center: { x: 80, y: 0 } }, distance: 80 }] },
}, {
  slug: "stride-strike-stride-shortbow",
  preferredTarget: { id: "mitflit", name: "Mitflit", token: { center: { x: 80, y: 0 } }, distance: 80 },
  targetingProfile: { preferredTargetId: "mitflit", preferredTargetName: "Mitflit" },
  activityProfile: { includesStrike: true, retreatAfterStrike: true, strideCount: 2, strikeReach: 60 },
}, { gridSize: 5 });
assert.equal(skirmishCompositePreview.enabled, true);
assert.equal(skirmishCompositePreview.stridePath.length, 2);
assert.ok(skirmishCompositePreview.stridePath[0].center.x > 0);
assert.deepEqual(skirmishCompositePreview.stridePath[1].center, { x: 0, y: 0 });

const previousPreviewVisibilityGame = globalThis.game;
const previousPreviewVisibilityCanvas = globalThis.canvas;
try {
  globalThis.game = { user: { isGM: false } };
  const playerVisibleStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, { slug: "stride" }, {
    gridSize: 5,
    pointVisible: (point) => point.x <= 10,
  });
  assert.ok(!playerVisibleStridePreview.reachableCenters.some((point) => point.x > 10));

  const playerHiddenPathCompositePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, {
    slug: "stride-strike-claw",
    activityProfile: { includesStrike: true, strideCount: 1 },
  }, {
    gridSize: 5,
    pointVisible: (point) => point.x <= 10,
  });
  assert.equal(playerHiddenPathCompositePreview.enabled, false);

  globalThis.canvas = {
    visibility: {
      testVisibility: (point) => point.x <= 20,
    },
  };
  const foundryVisibilityStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, { slug: "stride" }, { gridSize: 5, collisionScale: 2 });
  assert.ok(!foundryVisibilityStridePreview.reachableCenters.some((point) => point.x > 10));
} finally {
  globalThis.game = previousPreviewVisibilityGame;
  globalThis.canvas = previousPreviewVisibilityCanvas;
}

const hugeStridePreview = movementPreviewForStep({
  token: { center: { x: 15, y: 15 }, width: 3, height: 3 },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ezren",
      token: { center: { x: 55, y: 15 }, width: 1, height: 1 },
    }],
  },
}, { slug: "stride" }, { gridSize: 5 });
assert.equal(hugeStridePreview.footprint.widthCells, 3);
assert.equal(hugeStridePreview.footprint.heightCells, 3);
assert.equal(hugeStridePreview.reachablePlacements[0].width, 15);
assert.equal(hugeStridePreview.reachablePlacements[0].height, 15);
assert.equal(hugeStridePreview.recommendedPlacement.width, 15);
assert.equal(hugeStridePreview.recommendedCenter.x, 40);
assert.equal(hugeStridePreview.recommendedCenter.y, 15);
assert.deepEqual(hugeStridePreview.recommendedMarker.strokes, [{
  start: { x: 32.5, y: 7.5 },
  end: { x: 47.5, y: 22.5 },
}, {
  start: { x: 47.5, y: 7.5 },
  end: { x: 32.5, y: 22.5 },
}]);
assert.equal(hugeStridePreview.reachableMarkers[0].width, 5);
assert.equal(hugeStridePreview.reachableMarkers[0].height, 5);
assert.ok(hugeStridePreview.reachableMarkers.length <= 48);

const battlefieldTargetPlan = bestTurnPlan({
  ...fighterContext,
  targets: undefined,
  battlefield: {
    targets: fighterContext.targets,
  },
}, fixtureCandidates);
assert.equal(battlefieldTargetPlan.target.name, "Ogre");

const scoredDemoralize = scoreCandidate(fighterContext, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
});
assert.ok(scoredDemoralize.score > 42);
assert.equal(scoredDemoralize.reason, "Target is not frightened.");
assert.equal(scoredDemoralize.suggestedTarget.name, "Ogre");

const highIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 13, rank: 2 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
const lowIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 3, rank: 0 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
assert.ok(highIntimidationDemoralize.score > lowIntimidationDemoralize.score + 20);
assert.equal(highIntimidationDemoralize.skillCheck.label, "Intimidation +13 vs Will DC 16");
assert.equal(lowIntimidationDemoralize.skillCheck.label, "Intimidation +3 vs Will DC 16");

const playerHighIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: false,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 13, rank: 2 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
const playerLowIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: false,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 3, rank: 0 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
assert.equal(playerHighIntimidationDemoralize.skillCheck, null);
assert.equal(playerLowIntimidationDemoralize.skillCheck, null);
assert.equal(playerHighIntimidationDemoralize.score, playerLowIntimidationDemoralize.score);

const scoredTripSkillOdds = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      athletics: { mod: 7, rank: 1 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    saves: { reflex: 16 },
  }],
}, {
  id: "trip",
  name: "Trip",
  slug: "trip",
  actionCost: 1,
  source: "generic",
  skill: "athletics",
});
assert.equal(scoredTripSkillOdds.skillCheck.label, "Athletics +7 vs Reflex DC 16");
assert.ok(scoredTripSkillOdds.reasons.includes("Athletics +7 vs Reflex DC 16."));

const scoredFeintSkillOdds = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      deception: { mod: 10, rank: 1 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    perceptionDC: 17,
  }],
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  skill: "deception",
});
assert.equal(scoredFeintSkillOdds.skillCheck.label, "Deception +10 vs Perception DC 17");

const scoredTripAgainstProne = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    conditions: {
      slugs: ["prone"],
      values: { prone: null },
    },
  }],
}, {
  id: "trip",
  name: "Trip",
  slug: "trip",
  actionCost: 1,
  source: "generic",
});
assert.equal(scoredTripAgainstProne.score, 42);
assert.ok(!scoredTripAgainstProne.reasons.includes("Target is standing and can be knocked prone."));

const scoredShield = scoreCandidate(fighterContext, {
  id: "raise-a-shield",
  name: "Raise a Shield",
  slug: "raise-a-shield",
  actionCost: 1,
  source: "generic",
});
assert.equal(scoredShield.suggestedTarget.name, "Valeros");

const scoredHeal = scoreCandidate({
  ...fighterContext,
  allies: [{
    id: "ally-1",
    name: "Kyra",
    hpPercent: 0.25,
  }],
}, {
  id: "heal",
  name: "Heal",
  slug: "heal",
  actionCost: 2,
  source: "spell-curated",
  curated: { role: "healing" },
});
assert.equal(scoredHeal.suggestedTarget.name, "Kyra");

const systemActionContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "system-sudden-charge",
          name: "System Sudden Charge",
          type: "action",
          system: {
            slug: "sudden-charge",
            actionType: { value: "action" },
            actions: { value: 1 },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const hybridAction = readActionSources(systemActionContext).find((action) => action.slug === "sudden-charge");
assert.equal(hybridAction.name, "System Sudden Charge");
assert.equal(hybridAction.actionCost, 1);
assert.equal(hybridAction.role, "mobility-attack");
assert.equal(hybridAction.source, "custom-curated");

const triggeredActionContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "quick-tempered",
          name: "Quick-Tempered",
          type: "action",
          system: {
            slug: "quick-tempered",
            actionType: { value: "free" },
            actions: { value: null },
            description: {
              value: "<p><strong>Trigger</strong> You roll initiative.</p><hr /><p>You Rage.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const blockedTriggeredAction = readActionSources(triggeredActionContext)
  .find((action) => action.slug === "quick-tempered");
assert.equal(blockedTriggeredAction.trigger, "You roll initiative.");
assert.equal(blockedTriggeredAction.available, false);
assert.equal(blockedTriggeredAction.unavailableReason, "Trigger is not active: You roll initiative.");

const activeTriggeredAction = readActionSources({
  ...triggeredActionContext,
  triggerEvents: ["initiative"],
}).find((action) => action.slug === "quick-tempered");
assert.equal(activeTriggeredAction.available, true);

const amiriContext = {
  actor: {
    id: "amiri-1",
    name: "Amiri",
    profile: {
      actorType: "character",
      classSlug: "barbarian",
      speed: 25,
      reach: 5,
      conditions: { slugs: [], values: {} },
      skills: {},
    },
    document: {
      system: {
        actions: [{
          slug: "bastard-sword",
          type: "strike",
          label: "Bastard Sword",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "bastard-sword",
            system: { traits: { value: [] } },
          },
          roll: () => null,
        }],
      },
      itemTypes: {
        action: [{
          id: "rage",
          name: "Rage",
          type: "action",
          system: {
            slug: "rage",
            actionType: { value: "action" },
            actions: { value: 1 },
          },
        }, {
          id: "sudden-charge",
          name: "Sudden Charge",
          type: "action",
          system: {
            slug: "sudden-charge",
            actionType: { value: "action" },
            actions: { value: 2 },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {
    actorType: "character",
    classSlug: "barbarian",
    speed: 25,
    reach: 5,
    conditions: { slugs: [], values: {} },
    skills: {},
  },
  targets: [{
    id: "target-1",
    name: "Giant Centipede",
    distance: 30,
    hpPercent: 1,
    conditions: [],
    saves: {},
    ac: 17,
  }],
};
const amiriCandidates = buildCandidates(amiriContext).candidates;
const amiriBest = bestTurnPlan(amiriContext, amiriCandidates);
assert.equal(amiriBest.summary, "Rage -> Sudden Charge");
assert.ok(amiriBest.reason.includes("Rage"));
assert.equal(amiriBest.steps.find((step) => step.slug === "sudden-charge").actionCost, 2);
assert.equal(amiriCandidates.some((candidate) => candidate.slug === "tumble-through"), false);
assert.equal(
  buildTurnPlans(amiriContext, amiriCandidates)
    .some((plan) => plan.summary === "Sudden Charge -> Tumble Through"),
  false,
);

const blockedTumbleThrough = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}).find((action) => action.slug === "tumble-through");
assert.equal(blockedTumbleThrough.available, false);
assert.equal(blockedTumbleThrough.unavailableReason, "No useful path through enemy detected.");

const allowedTumbleThrough = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    blocksPath: true,
  }],
}).find((action) => action.slug === "tumble-through");
assert.equal(allowedTumbleThrough.available, true);

const amiriBlockedPostChargeTumbleCandidates = buildCandidates({
  ...amiriContext,
  targets: [{
    ...amiriContext.targets[0],
    distance: 20,
    blocksPath: true,
  }],
}).candidates;
assert.equal(
  amiriBlockedPostChargeTumbleCandidates.some((candidate) => candidate.slug === "tumble-through"),
  true,
);
assert.equal(
  buildTurnPlans(amiriContext, amiriBlockedPostChargeTumbleCandidates)
    .some((plan) => plan.summary === "Sudden Charge -> Tumble Through"),
  false,
);

const hydraContext = {
  actor: {
    id: "hydra-1",
    name: "Hydra",
    profile: {
      actorType: "npc",
      speed: 25,
      reach: 10,
      hpPercent: 1,
      conditions: { slugs: [], values: {} },
      skills: {},
    },
    document: {
      system: {
        actions: [{
          slug: "fangs",
          type: "strike",
          label: "Fangs",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "fangs",
            system: { traits: { value: ["reach-10"] } },
          },
          roll: () => null,
        }, {
          slug: "focused-assault",
          label: "Focused Assault",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The hydra makes a single Strike with each of its heads against one target.</p>",
          },
        }, {
          slug: "storm-of-jaws",
          type: "action",
          label: "Storm of Jaws",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The hydra makes Strikes up to its number of heads, each against a different target. These attacks count toward MAP, but MAP doesn't increase until after all attacks.</p>",
          },
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {
    actorType: "npc",
    speed: 25,
    reach: 10,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    skills: {},
  },
  targets: [{
    id: "ezren-1",
    name: "Ezren",
    distance: 10,
    hpPercent: 1,
    conditions: [],
    saves: {},
    ac: 16,
  }],
};
const hydraCandidates = buildCandidates(hydraContext).candidates;
assert.equal(findCustomAction("focused-assault"), null);
assert.equal(findCustomAction("storm-of-jaws"), null);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "focused-assault"), true);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "storm-of-jaws"), true);
assert.equal(hydraCandidates.find((candidate) => candidate.slug === "focused-assault").source, "system-inferred");
assert.equal(hydraCandidates.find((candidate) => candidate.slug === "storm-of-jaws").role, "multiattack");
assert.equal(hydraCandidates.some((candidate) => candidate.source === "strike" && candidate.name === "Focused Assault"), false);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "recall-knowledge"), false);
const hydraBest = bestTurnPlan(hydraContext, hydraCandidates);
assert.ok(
  hydraBest.steps.some((step) => ["focused-assault", "storm-of-jaws"].includes(step.slug)),
  `Hydra best plan should use a two-action activity, got ${hydraBest.summary}`,
);

const hydraRecallKnowledge = readActionSources(hydraContext)
  .find((action) => action.slug === "recall-knowledge");
assert.equal(hydraRecallKnowledge.available, false);
assert.equal(hydraRecallKnowledge.unavailableReason, "NPCs do not need Recall Knowledge recommendations.");

const pounceContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      ...hydraContext.actor.document,
      system: {
        actions: [{
          slug: "rending-pounce",
          label: "Rending Pounce",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The monster Strides up to its Speed and makes a jaws Strike.</p>",
          },
        }],
      },
    },
  },
  targets: [{
    ...hydraContext.targets[0],
    distance: 30,
  }],
};
const pounceCandidate = buildCandidates(pounceContext).candidates
  .find((candidate) => candidate.slug === "rending-pounce");
assert.equal(pounceCandidate.source, "system-inferred");
assert.equal(pounceCandidate.role, "mobility-attack");
assert.equal(pounceCandidate.activityProfile.includesStrike, true);

const itemAbilityContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "sweeping-claws",
          name: "Sweeping Claws",
          type: "action",
          system: {
            slug: "sweeping-claws",
            actionType: { value: "action" },
            actions: { value: 2 },
            description: {
              value: "<p>The monster makes two claw Strikes, each against a different target.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  battlefield: {
    enemies: [{
      id: "enemy-1",
      name: "Enemy One",
      distance: 5,
    }, {
      id: "enemy-2",
      name: "Enemy Two",
      distance: 10,
    }],
    targets: [{
      id: "enemy-1",
      name: "Enemy One",
      distance: 5,
    }],
  },
  targets: undefined,
};
const itemAbilityCandidate = buildCandidates(itemAbilityContext).candidates
  .find((candidate) => candidate.slug === "sweeping-claws");
assert.equal(itemAbilityCandidate.source, "system-inferred");
assert.equal(itemAbilityCandidate.role, "multiattack");
assert.ok(itemAbilityCandidate.score > 100);

const throwRockClassification = classifySystemAction({
  name: "Throw Rock",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.ThrowRock]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(throwRockClassification.role, "damage");
assert.equal(throwRockClassification.activityProfile.includesStrike, true);
assert.equal(throwRockClassification.targetingProfile.maxRange, 120);

const scoredThrowRock = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 60,
  }],
}, {
  id: "throw-rock",
  name: "Throw Rock",
  slug: "throw-rock",
  actionCost: 1,
  source: "system-inferred",
  role: throwRockClassification.role,
  activityProfile: throwRockClassification.activityProfile,
  targetingProfile: throwRockClassification.targetingProfile,
});
assert.ok(scoredThrowRock.score > 70);
assert.equal(scoredThrowRock.suggestedTarget.name, "Ogre");

const huntPreyClassification = classifySystemAction({
  name: "Hunt Prey",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>The hunter designates a single creature as prey. The first time it hits its hunted prey in a round, it deals 1d8 additional precision damage.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(huntPreyClassification.role, "setup");
assert.deepEqual(huntPreyClassification.setupFor, ["strike", "damage"]);

const swiftLeapClassification = classifySystemAction({
  name: "Swift Leap",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["move"] },
    description: {
      value: "<p>The cultist jumps up to half its Speed. This movement doesn't trigger reactions.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(swiftLeapClassification.role, "mobility");
assert.equal(swiftLeapClassification.activityProfile.strideCount, 0.5);
assert.equal(swiftLeapClassification.activityProfile.safeMovement, true);

const gallopClassification = classifySystemAction({
  name: "Gallop",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: {
      value: "<p>The war pony Strides twice. It has a +10-foot circumstance bonus to its Speed during these Strides.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(gallopClassification.role, "mobility");
assert.equal(gallopClassification.activityProfile.strideCount, 2);

const tumbleBehindClassification = classifySystemAction({
  name: "Tumble Behind",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["move"] },
    description: {
      value: "<p>The rogue Tumbles Through an enemy's space. If successful, the enemy is off-guard against the rogue's next Strike this turn.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(tumbleBehindClassification.role, "setup");
assert.equal(tumbleBehindClassification.activityProfile.appliesCondition, "off-guard");
assert.deepEqual(tumbleBehindClassification.setupFor, ["strike", "damage"]);

const drinkBloodClassification = classifySystemAction({
  name: "Drink Blood",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>Requirement A @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}, @UUID[Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM]{Restrained}, or willing creature is within reach. Effect The vampire drinks its blood. This requires an @Check[athletics|defense:fortitude] check. The victim is @UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 2} and the vampire regains Hit Points.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(drinkBloodClassification.role, "drain");
assert.deepEqual(drinkBloodClassification.activityProfile.requiresAnyTargetCondition, ["grabbed", "restrained", "paralyzed", "unconscious"]);
assert.equal(drinkBloodClassification.activityProfile.appliesCondition, "drained");

const scoredDrinkBlood = scoreCandidate({
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    hpPercent: 0.3,
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    conditions: { slugs: ["grabbed"], values: { grabbed: 1 } },
  }],
}, {
  id: "drink-blood",
  name: "Drink Blood",
  slug: "drink-blood",
  actionCost: 1,
  source: "system-inferred",
  role: drinkBloodClassification.role,
  activityProfile: drinkBloodClassification.activityProfile,
});
assert.ok(scoredDrinkBlood.score > 90);

const focusGazeClassification = classifySystemAction({
  name: "Focus Gaze",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["concentrate", "mental", "visual"] },
    description: {
      value: "<p>The creature fixes its glare at a creature it can see within 30 feet. The target must immediately attempt a Will save. On a failed save, it is Paralyzed for 1 round.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(focusGazeClassification.role, "control");
assert.equal(focusGazeClassification.saveProfile.stat, "will");
assert.equal(focusGazeClassification.targetingProfile.maxRange, 30);

const fastSwallowClassification = classifySystemAction({
  name: "Fast Swallow",
  system: {
    actionType: { value: "reaction" },
    actions: { value: null },
    category: "offensive",
    description: {
      value: "<p><strong>Trigger</strong> The monster Grabs a creature. <strong>Effect</strong> The monster uses Swallow Whole.</p>",
    },
  },
}, { actionCost: "reaction", type: "reaction" });
assert.equal(fastSwallowClassification.role, "control");
assert.equal(fastSwallowClassification.activityProfile.reaction, true);

const consumeFleshClassification = classifySystemAction({
  name: "Consume Flesh",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["manipulate"] },
    description: {
      value: "<p>Requirements The ghoul is adjacent to the corpse of a creature that died within the last hour. Effect The ghoul devours flesh and regains @Damage[3d6[healing]] Hit Points.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(consumeFleshClassification.role, "self-healing");
assert.equal(consumeFleshClassification.activityProfile.requiresCorpse, true);
assert.equal(consumeFleshClassification.damageProfile.type, "healing");

const poisonWeaponClassification = classifySystemAction({
  name: "Poison Weapon",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>The rogue applies poison to a piercing or slashing weapon. If the next attack hits, it applies the poison.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(poisonWeaponClassification.role, "setup");
assert.deepEqual(poisonWeaponClassification.setupFor, ["strike", "damage"]);
assert.equal(poisonWeaponClassification.activityProfile.weaponBuff, true);

const changeShapeClassification = classifySystemAction({
  name: "Change Shape",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["concentrate", "polymorph"] },
    description: {
      value: "<p>The creature changes into human form. While in human form it can't use its fangs attack. @Localize[PF2E.NPC.Abilities.Glossary.ChangeShape]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(changeShapeClassification.role, "transformation");
assert.equal(changeShapeClassification.activityProfile.includesStrike, false);

const rageClassification = classifySystemAction({
  name: "Rage",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The creature flies into a rage and gains bonus damage with melee Strikes.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(rageClassification.role, "setup");
assert.deepEqual(rageClassification.setupFor, ["strike", "damage"]);

const reachSpellClassification = classifySystemAction({
  name: "Reach Spell",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The next spell the creature casts this turn has its range increased.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(reachSpellClassification.role, "setup");
assert.deepEqual(reachSpellClassification.setupFor, ["spell", "damage", "control"]);

const drainBondedItemClassification = classifySystemAction({
  name: "Drain Bonded Item",
  system: {
    actionType: { value: "free" },
    actions: { value: null },
    category: "offensive",
    description: { value: "<p>The wizard expends the power stored in their bonded item to cast one spell they prepared and already cast today.</p>" },
  },
}, { actionCost: 0, type: "free" });
assert.equal(drainBondedItemClassification.role, "resource-recovery");

const runningReloadClassification = classifySystemAction({
  name: "Running Reload",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The creature Strides, Steps, or Sneaks, then Interacts to reload.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(runningReloadClassification.role, "mobility");
assert.equal(runningReloadClassification.activityProfile.reload, true);

const bloodDrainClassification = classifySystemAction({
  name: "Blood Drain",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>Requirements A grabbed or restrained creature is within reach. The monster drains blood, dealing damage and regaining Hit Points.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(bloodDrainClassification.role, "drain");

const battleMedicineClassification = classifySystemAction({
  name: "Battle Medicine",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    description: { value: "<p>The healer uses Medicine to patch wounds during combat and restore Hit Points.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(battleMedicineClassification.role, "healing");

const raiseShieldClassification = classifySystemAction({
  name: "Raise a Shield",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    description: { value: "<p>The creature positions its shield to protect itself until its next turn.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(raiseShieldClassification.role, "defense");

const grabClassification = classifySystemAction({
  name: "Grab",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.Grab]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(grabClassification.role, "grab");
assert.equal(grabClassification.activityProfile.includesGrab, true);

const constrictClassification = classifySystemAction({
  name: "Constrict",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Damage[1d8+4[bludgeoning]] @Check[fortitude|dc:20|basic] @Localize[PF2E.NPC.Abilities.Glossary.Constrict]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(constrictClassification.role, "save-damage");
assert.equal(constrictClassification.saveProfile.stat, "fortitude");
assert.equal(constrictClassification.damageProfile.formula, "1d8+4");
assert.equal(constrictClassification.activityProfile.requiresTargetCondition, "grabbed");

const breathWeaponContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "breath-weapon",
          name: "Breath Weapon",
          type: "action",
          system: {
            slug: null,
            actionType: { value: "action" },
            actions: { value: 2 },
            category: "offensive",
            description: {
              value: "<p>The dragon breathes fire. @Template[type:cone|distance:30] @Damage[5d6[fire]] @Check[reflex|dc:22|basic]</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  battlefield: {
    enemies: [{
      id: "enemy-1",
      name: "Ezren",
      distance: 20,
    }, {
      id: "enemy-2",
      name: "Valeros",
      distance: 25,
    }],
    allies: [],
    targets: [{
      id: "enemy-1",
      name: "Ezren",
      distance: 20,
    }],
  },
  targets: undefined,
};
const breathWeaponCandidate = buildCandidates(breathWeaponContext).candidates
  .find((candidate) => candidate.name === "Breath Weapon");
assert.equal(breathWeaponCandidate.source, "system-inferred");
assert.equal(breathWeaponCandidate.role, "area-damage");
assert.equal(breathWeaponCandidate.targetingProfile.area, true);
assert.equal(breathWeaponCandidate.saveProfile.stat, "reflex");
assert.ok(breathWeaponCandidate.score > 100);

const trampleClassification = classifySystemAction({
  name: "Trample",
  system: {
    actionType: { value: "action" },
    actions: { value: 3 },
    category: "offensive",
    description: {
      value: "<p>The monster Strides up to double its Speed and can move through enemies. @Damage[2d8+8[bludgeoning]] @Check[reflex|dc:23|basic] @Localize[PF2E.NPC.Abilities.Glossary.Trample]</p>",
    },
  },
}, { actionCost: 3, type: "action" });
assert.equal(trampleClassification.role, "mobility-attack");
assert.equal(trampleClassification.activityProfile.strideCount, 2);
assert.equal(trampleClassification.saveProfile.stat, "reflex");

const reactionContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "reactive-strike",
          name: "Reactive Strike",
          type: "action",
          system: {
            actionType: { value: "reaction" },
            actions: { value: null },
            category: "offensive",
            description: {
              value: "<p><strong>Trigger</strong> A creature within reach uses a manipulate action or leaves a square during a move action.</p><p>The monster makes a melee Strike against the triggering creature.</p>",
            },
          },
        }, {
          id: "shield-block",
          name: "Shield Block",
          type: "action",
          system: {
            actionType: { value: "reaction" },
            actions: { value: null },
            category: "defensive",
            description: {
              value: "<p><strong>Trigger</strong> The monster would take damage from a physical attack while its shield is raised.</p><p>The monster blocks with its shield.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  triggerEvents: ["provokes-reaction"],
};
const reactionSources = readActionSources(reactionContext);
const reactiveStrike = reactionSources.find((action) => action.name === "Reactive Strike");
assert.equal(reactiveStrike.source, "system-inferred");
assert.equal(reactiveStrike.role, "reaction-attack");
assert.equal(reactiveStrike.actionCost, "reaction");
assert.equal(reactiveStrike.available, true);
const shieldBlock = reactionSources.find((action) => action.name === "Shield Block");
assert.equal(shieldBlock.source, "system-inferred");
assert.equal(shieldBlock.role, "defense");
assert.equal(shieldBlock.available, false);

const expandedGenericSlugs = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}).map((action) => action.slug);
for (const slug of [
  "seek",
  "sense-motive",
  "balance",
  "climb",
  "swim",
  "tumble-through",
  "disarm",
  "force-open",
  "high-jump",
  "long-jump",
  "reposition",
  "shove",
  "create-a-diversion",
  "feint",
  "administer-first-aid",
  "stabilize",
  "command-an-animal",
  "hide",
  "sneak",
  "palm-an-object",
  "steal",
  "take-cover",
  "escape",
]) {
  assert.ok(expandedGenericSlugs.includes(slug), `${slug} should be cataloged`);
}

const farTrip = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 20,
  }],
}).find((action) => action.slug === "trip");
assert.equal(farTrip.available, false);
assert.equal(farTrip.unavailableReason, "No enemy in reach.");

// Demoralize has a 30 ft range — unavailable against a target beyond it.
const farDemoralize = readActionSources({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 35 }],
}).find((action) => action.slug === "demoralize");
assert.equal(farDemoralize.available, false);
assert.equal(farDemoralize.unavailableReason, "No target within 30 feet.");

const nearDemoralize = readActionSources({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}).find((action) => action.slug === "demoralize");
assert.equal(nearDemoralize.available, true);

// Create a Diversion carries a default PF2e variant so execution doesn't error.
const diversionAction = readActionSources(fighterContext).find((action) => action.slug === "create-a-diversion");
assert.equal(diversionAction.variant, "gesture");

const handedContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
};
const armedSteal = readActionSources(handedContext).find((action) => action.slug === "steal");
assert.equal(armedSteal.available, true);

const handlessContext = {
  ...handedContext,
  profile: { ...fighterContext.profile, handsFree: 0 },
};
const handlessSources = readActionSources(handlessContext);
const handlessSteal = handlessSources.find((action) => action.slug === "steal");
assert.equal(handlessSteal.available, false);
assert.equal(handlessSteal.unavailableReason, "No free hand to manipulate an object.");
const handlessPalm = handlessSources.find((action) => action.slug === "palm-an-object");
assert.equal(handlessPalm.available, false);
const handlessDisarm = handlessSources.find((action) => action.slug === "disarm");
assert.equal(handlessDisarm.available, true);

const closeFeint = scoreCandidate({
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    skills: {
      ...fighterContext.profile.skills,
      deception: 10,
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  skill: "deception",
});
assert.ok(closeFeint.score > 42);
assert.equal(closeFeint.reason, "Target is in melee and not off-guard.");
assert.equal(closeFeint.suggestedTarget.name, "Ogre");

const medicineSources = readActionSources({
  ...fighterContext,
  allies: [{
    id: "ally-dying",
    name: "Kyra",
    hpPercent: 0,
    conditions: { slugs: ["dying"], values: { dying: 1 } },
  }],
});
assert.equal(medicineSources.find((action) => action.slug === "administer-first-aid").available, true);
assert.equal(medicineSources.find((action) => action.slug === "stabilize").available, true);

const scoredStabilize = scoreCandidate({
  ...fighterContext,
  allies: [{
    id: "ally-dying",
    name: "Kyra",
    hpPercent: 0,
    conditions: { slugs: ["dying"], values: { dying: 1 } },
  }],
}, {
  id: "stabilize",
  name: "Stabilize",
  slug: "stabilize",
  actionCost: 2,
  source: "generic",
  role: "healing",
});
assert.ok(scoredStabilize.score > 42);
assert.equal(scoredStabilize.reason, "Kyra is dying.");
assert.equal(scoredStabilize.suggestedTarget.name, "Kyra");

const hiddenAction = readActionSources(fighterContext).find((action) => action.slug === "hide");
assert.equal(hiddenAction.available, false);
assert.equal(hiddenAction.unavailableReason, "No cover or concealment detected.");

const noAdjacentWallTakeCover = readActionSources({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  profile: {
    ...fighterContext.profile,
    hasCover: true,
  },
}).find((action) => action.slug === "take-cover");
assert.equal(noAdjacentWallTakeCover.available, false);
assert.equal(noAdjacentWallTakeCover.unavailableReason, "No adjacent wall or cover.");

const systemTakeCoverNoWallCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: { placeables: [] },
  };
  const systemTakeCoverNoWallContext = {
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
    actor: {
      ...fighterContext.actor,
      document: {
        itemTypes: {
          action: [{
            id: "system-take-cover",
            name: "Take Cover",
            slug: "take-cover",
            type: "action",
            system: {
              slug: "take-cover",
              actionType: { value: "action" },
              actions: { value: 1 },
              description: { value: "<p>You press yourself against cover.</p>" },
            },
          }],
          feat: [],
          feature: [],
          consumable: [],
        },
        items: [],
      },
    },
  };
  assert.equal(
    buildCandidates(systemTakeCoverNoWallContext).candidates.some((action) => action.slug === "take-cover"),
    false,
  );
} finally {
  globalThis.canvas = systemTakeCoverNoWallCanvas;
}

const previousTakeCoverWallCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      placeables: [{
        document: { c: [2.5, -2.5, 2.5, 2.5] },
      }],
    },
  };
  const adjacentWallTakeCover = readActionSources({
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
  }).find((action) => action.slug === "take-cover");
  assert.equal(adjacentWallTakeCover.available, true);
} finally {
  globalThis.canvas = previousTakeCoverWallCanvas;
}

const previousSeekVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner" ? { active: true, api: {} } : null,
    },
  };

  const visibleSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(visibleSeek.available, false);
  assert.equal(visibleSeek.unavailableReason, "No hidden or undetected target detected.");

  const observedConditionSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
        conditions: [{ slug: "hidden" }],
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(observedConditionSeek.available, false);
  assert.equal(observedConditionSeek.unavailableReason, "No hidden or undetected target detected.");

  const hiddenSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "hidden",
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(hiddenSeek.available, true);
} finally {
  globalThis.game = previousSeekVisionerGame;
}

const previousInactiveVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner" ? { active: false, api: {} } : null,
    },
  };

  const inactiveVisionerSystemSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
        conditions: [{ slug: "hidden" }],
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(inactiveVisionerSystemSeek.available, true);
} finally {
  globalThis.game = previousInactiveVisionerGame;
}

const blockedSenseMotive = readActionSources(fighterContext).find((action) => action.slug === "sense-motive");
assert.equal(blockedSenseMotive.available, false);
assert.equal(blockedSenseMotive.unavailableReason, "No combat-relevant deception or mental effect detected.");

const allowedSenseMotive = readActionSources({
  ...fighterContext,
  battlefield: {
    targets: [{
      ...fighterContext.targets[0],
      behaviorSignals: ["deception"],
    }],
  },
  targets: undefined,
}).find((action) => action.slug === "sense-motive");
assert.equal(allowedSenseMotive.available, true);

const previousVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner"
        ? {
          api: {
            autoVisibility: {
              getPerceptionProfile: () => ({
                detectionState: "undetected",
                hasConcealment: false,
                coverState: "none",
                awarenessState: null,
              }),
            },
          },
        }
        : null,
    },
  };
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "undetected",
  );
  assert.equal(
    readVisionerCoverState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "none",
  );
  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({
            detectionState: "observed",
            awarenessState: "hidden",
          }),
        },
      },
    }
    : null;
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "observed",
  );
  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      active: false,
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({ detectionState: "hidden" }),
        },
      },
    }
    : null;
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    null,
  );
} finally {
  globalThis.game = previousVisionerGame;
}

const forceOpenAction = readActionSources(fighterContext).find((action) => action.slug === "force-open");
assert.equal(forceOpenAction.available, false);
assert.equal(forceOpenAction.unavailableReason, "No obstacle or object in reach.");

const previousForceOpenDoorCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    walls: {
      placeables: [{
        document: {
          door: 1,
          ds: 2,
          c: [5, -5, 5, 5],
        },
      }],
    },
  };
  const forceOpenDoorAction = readActionSources({
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...fighterContext.profile,
      reach: 5,
    },
  }).find((action) => action.slug === "force-open");
  assert.equal(forceOpenDoorAction.available, true);
} finally {
  globalThis.canvas = previousForceOpenDoorCanvas;
}

const climbAction = readActionSources({
  ...fighterContext,
  battlefield: {
    terrain: { climb: true },
  },
}).find((action) => action.slug === "climb");
assert.equal(climbAction.available, true);

const strikeSources = readActionSources({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {},
  targets: [],
});
assert.equal(strikeSources.find((action) => action.name === "Longsword").executable, "strike");

const drawStrikeContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "dagger",
          type: "strike",
          label: "Dagger",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "dagger",
            name: "Dagger",
            type: "weapon",
            system: {
              traits: { value: ["agile"] },
            },
          },
        }],
      },
      itemTypes: {
        weapon: [{
          id: "shortbow",
          name: "Shortbow",
          type: "weapon",
          isHeld: false,
          isEquipped: false,
          system: {
            equipped: { carryType: "worn", handsHeld: 0 },
            range: { increment: 60 },
            traits: { value: ["deadly-d10"] },
          },
        }],
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [{
    id: "ogre",
    name: "Ogre",
    distance: 30,
  }],
  battlefield: {
    enemies: [{
      id: "ogre",
      name: "Ogre",
      distance: 30,
    }],
    targets: [{
      id: "ogre",
      name: "Ogre",
      distance: 30,
    }],
  },
};
const drawStrikeSources = readActionSources(drawStrikeContext);
const drawShortbow = drawStrikeSources.find((action) => action.slug === "draw-strike-shortbow");
assert.equal(drawShortbow.name, "Draw Shortbow -> Strike");
assert.equal(drawShortbow.actionCost, 2);
assert.equal(drawShortbow.source, "system-inferred");
assert.equal(drawShortbow.activityProfile.drawsWeapon, true);
assert.equal(drawShortbow.targetingProfile.maxRange, 60);

const scoredDrawShortbow = buildCandidates(drawStrikeContext).candidates
  .find((candidate) => candidate.slug === "draw-strike-shortbow");
assert.ok(scoredDrawShortbow.score > 100);
assert.equal(scoredDrawShortbow.reason, "Draw Shortbow and Strike Ogre.");

const drawStrikeInMeleeContext = {
  ...drawStrikeContext,
  targets: [{
    id: "ogre",
    name: "Ogre",
    distance: 5,
  }],
  battlefield: {
    enemies: [{
      id: "ogre",
      name: "Ogre",
      distance: 5,
    }],
    targets: [{
      id: "ogre",
      name: "Ogre",
      distance: 5,
    }],
  },
};
assert.equal(
  readActionSources(drawStrikeInMeleeContext).some((action) => action.slug === "draw-strike-shortbow"),
  false,
);

const drawStrikeFarEnemyContext = {
  ...drawStrikeContext,
  targets: [{
    id: "near-ogre",
    name: "Near Ogre",
    distance: 5,
  }],
  battlefield: {
    enemies: [{
      id: "near-ogre",
      name: "Near Ogre",
      distance: 5,
    }, {
      id: "far-ogre",
      name: "Far Ogre",
      distance: 30,
    }],
    targets: [{
      id: "near-ogre",
      name: "Near Ogre",
      distance: 5,
    }],
  },
};
const farEnemyDrawShortbow = buildCandidates(drawStrikeFarEnemyContext).candidates
  .find((candidate) => candidate.slug === "draw-strike-shortbow");
assert.equal(farEnemyDrawShortbow.suggestedTarget.name, "Far Ogre");
assert.equal(farEnemyDrawShortbow.reason, "Draw Shortbow and Strike Far Ogre.");

const repeatedStrikePlan = bestTurnPlan(fighterContext, [{
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}]);
assert.equal(repeatedStrikePlan.steps.length, 2);
assert.deepEqual(repeatedStrikePlan.steps.map((step) => step.mapPenalty), [0, 5]);

const rangedAlreadyInRangeContext = {
  ...fighterContext,
  targets: [{
    id: "calder",
    name: "Calder",
    distance: 40,
  }],
  battlefield: {
    targets: [{
      id: "calder",
      name: "Calder",
      distance: 40,
    }],
    enemies: [{
      id: "calder",
      name: "Calder",
      distance: 40,
    }],
  },
};
const rangedAlreadyInRangePlans = buildTurnPlans(rangedAlreadyInRangeContext, [{
  id: "stride",
  name: "Stride",
  slug: "stride",
  actionCost: 1,
  source: "generic",
  score: 100,
  confidence: "medium",
  reason: "Move.",
}, {
  id: "crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120 },
  score: 90,
  confidence: "medium",
  reason: "Shoot.",
}]);
assert.equal(
  rangedAlreadyInRangePlans.some((plan) =>
    plan.steps.some((step) => step.slug === "stride")
    && plan.steps.some((step) => step.name === "Crossbow"),
  ),
  false,
);
assert.deepEqual(
  rangedAlreadyInRangePlans[0].steps.map((step) => step.name),
  ["Crossbow", "Crossbow"],
);

const twoActionOrderingContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["slowed"],
      values: { slowed: 1 },
    },
  },
};

const demoralizeBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "longsword-ordering",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "demoralize-ordering",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Lower target defenses.",
}]);
assert.deepEqual(demoralizeBeforeStrikePlan.steps.map((step) => step.slug), ["demoralize", "strike"]);

const feintBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "longsword-feint-ordering",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "feint-ordering",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Make target off-guard.",
}]);
assert.deepEqual(feintBeforeStrikePlan.steps.map((step) => step.slug), ["feint", "strike"]);

const acSetupBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "claw-ordering",
  name: "Claw",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "expose-weak-point",
  name: "Expose Weak Point",
  slug: "expose-weak-point",
  actionCost: 1,
  source: "system-inferred",
  role: "control",
  activityProfile: {
    appliesCondition: "off-guard",
  },
  score: 80,
  confidence: "medium",
  reason: "Makes target off-guard.",
}]);
assert.deepEqual(acSetupBeforeStrikePlan.steps.map((step) => step.slug), ["expose-weak-point", "strike"]);

const attackTraitPlan = bestTurnPlan(fighterContext, [
  {
    id: "trip",
    name: "Trip",
    slug: "trip",
    actionCost: 1,
    source: "generic",
    attackTrait: true,
    score: 90,
    confidence: "medium",
    reason: "Knock prone.",
  },
  {
    id: "longsword",
    name: "Longsword",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    score: 80,
    confidence: "medium",
    reason: "Follow up.",
  },
]);
assert.equal(attackTraitPlan.steps.filter((step) => step.slug === "trip").length, 1);
assert.equal(attackTraitPlan.steps.filter((step) => step.attackIndex).length, 3);
assert.equal(attackTraitPlan.steps.filter((step) => step.slug === "strike").length, 2);
assert.deepEqual(attackTraitPlan.steps.map((step) => step.mapPenalty), [0, 5, 10]);

const farStrikeTarget = {
  ...fighterContext.targets[0],
  distance: 30,
};
const farMeleeStrike = scoreCandidate({
  ...fighterContext,
  targets: [farStrikeTarget],
  enemies: [],
  battlefield: {
    enemies: [],
    targets: [farStrikeTarget],
  },
}, {
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(farMeleeStrike.score < 0);
assert.equal(farMeleeStrike.reason, "Target is out of range.");
assert.equal(farMeleeStrike.suggestedTarget, null);

const strikeWithNearbyEnemy = scoreCandidate({
  ...fighterContext,
  targets: [{
    id: "far-target",
    name: "Fe'Ral",
    distance: 30,
    conditions: [],
  }],
  battlefield: {
    enemies: [{
      id: "far-target",
      name: "Fe'Ral",
      distance: 30,
      conditions: [],
    }, {
      id: "near-target",
      name: "Amiri",
      distance: 5,
      conditions: [],
    }],
  },
}, {
  id: "mandibles",
  name: "Mandibles",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(strikeWithNearbyEnemy.score > 46);
assert.equal(strikeWithNearbyEnemy.suggestedTarget.name, "Amiri");
assert.equal(strikeWithNearbyEnemy.reason, "Melee target is in reach.");

const previousHugeTargetGame = globalThis.game;
const previousHugeTargetCanvas = globalThis.canvas;
try {
  const makeActor = (id, name) => ({
    id,
    uuid: `Actor.${id}`,
    name,
    img: "icons/svg/mystery-man.svg",
    documentName: "Actor",
    isOwner: true,
    items: [],
    itemTypes: { condition: [] },
    getActiveTokens: () => [],
    system: {
      attributes: { hp: { value: 10, max: 10 }, ac: { value: 16 } },
      saves: {},
      skills: {},
      abilities: {},
    },
  });
  const makeToken = (id, name, actor, disposition, x, width = 1, height = 1) => ({
    id,
    name,
    actor,
    x,
    y: 0,
    document: {
      id,
      uuid: `Scene.Token.${id}`,
      name,
      actor,
      disposition,
      x,
      y: 0,
      width,
      height,
      texture: { src: "" },
    },
  });
  const actor = makeActor("feral", "Fe'Ral");
  const hydraActor = makeActor("hydra", "Hydra");
  const activeToken = makeToken("token-feral", "Fe'Ral", actor, 1, 0);
  const hydraToken = makeToken("token-hydra", "Hydra", hydraActor, -1, 5, 3, 3);
  actor.getActiveTokens = () => [activeToken];
  globalThis.canvas = {
    grid: {
      size: 5,
      measurePath: ([from, to]) => Math.abs(to.x - from.x),
    },
    tokens: {
      placeables: [activeToken, hydraToken],
    },
  };
  globalThis.game = {
    user: { isGM: true, targets: new Set([hydraToken]) },
    combat: {
      id: "combat-huge-target",
      round: 1,
      turn: 0,
      started: true,
      combatant: {
        id: "combatant-feral",
        name: "Fe'Ral",
        actor,
        token: { object: activeToken },
      },
      combatants: [{
        id: "combatant-feral",
        name: "Fe'Ral",
        actor,
        tokenId: activeToken.id,
        token: { object: activeToken, id: activeToken.id, uuid: activeToken.document.uuid },
      }, {
        id: "combatant-hydra",
        name: "Hydra",
        actor: hydraActor,
        tokenId: hydraToken.id,
        token: { object: hydraToken, id: hydraToken.id, uuid: hydraToken.document.uuid },
      }],
    },
  };
  const hugeTargetContext = readCombatContext("huge-target-test");
  assert.equal(hugeTargetContext.battlefield.targets[0].distance, 5);
  const adjacentClaw = scoreCandidate({
    ...hugeTargetContext,
    profile: { reach: 5, meleeReach: 5 },
    targets: hugeTargetContext.battlefield.targets,
  }, {
    id: "claw",
    name: "Claw",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    range: { max: 5 },
  });
  assert.equal(adjacentClaw.reason, "Melee target is in reach.");
} finally {
  globalThis.game = previousHugeTargetGame;
  globalThis.canvas = previousHugeTargetCanvas;
}

const closeMeleeStrike = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}, {
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(closeMeleeStrike.score > 46);
assert.equal(closeMeleeStrike.suggestedTarget.name, "Ogre");

const rangedStrike = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 30,
  }],
}, {
  id: "shortbow",
  name: "Shortbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 60 },
});
assert.equal(rangedStrike.reason, "Target is in range.");

const previousGame = globalThis.game;
const previousCanvas = globalThis.canvas;
try {
  const makeActor = (id, name, type = "npc") => ({
    id,
    uuid: `Actor.${id}`,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    documentName: "Actor",
    isOwner: true,
    items: [],
    itemTypes: { condition: [] },
    getActiveTokens: () => [],
    system: {
      attributes: {
        hp: { value: 10, max: 10 },
        ac: { value: 16 },
        resistances: [{ type: "fire", value: 5 }],
      },
      perception: { dc: 20, mod: 10 },
      saves: {
        fortitude: { dc: 17 },
        reflex: { dc: 18 },
        will: { dc: 19 },
      },
      skills: {},
      abilities: {},
    },
  });
  const valerosActor = makeActor("valeros", "Valeros");
  const ezrenActor = makeActor("ezren", "Ezren");
  const centipedeActor = makeActor("centipede", "Giant Centipede");
  const nakpikActor = makeActor("nakpik", "Nakpik");
  const hiddenPitActor = makeActor("hidden-pit", "Hidden Pit", "hazard");
  const treasureActor = makeActor("treasure", "Treasure", "loot");
  const makeToken = (id, name, actor, disposition, x) => ({
    id,
    name,
    actor,
    x,
    y: 0,
    document: {
      id,
      uuid: `Scene.Token.${id}`,
      name,
      actor,
      disposition,
      x,
      y: 0,
      width: 1,
      height: 1,
      texture: { src: "" },
    },
  });
  const activeToken = makeToken("token-valeros", "Valeros", valerosActor, 1, 0);
  const allyToken = makeToken("token-ezren", "Ezren", ezrenActor, 1, 5);
  const enemyToken = makeToken("token-centipede", "Giant Centipede", centipedeActor, -1, 40);
  const neutralToken = makeToken("token-nakpik", "Nakpik", nakpikActor, 0, 10);
  const hiddenPitToken = makeToken("token-hidden-pit", "Hidden Pit", hiddenPitActor, -1, 10);
  const treasureToken = makeToken("token-treasure", "Treasure", treasureActor, -1, 15);
  const makeCombatant = (token) => ({
    id: `combatant-${token.id}`,
    name: token.name,
    actor: token.actor,
    tokenId: token.id,
    token: { object: token, id: token.id, uuid: token.document.uuid },
  });
  const combatantsFor = (tokens) => tokens.map((token) => makeCombatant(token));
  const activeCombatant = makeCombatant(activeToken);
  valerosActor.getActiveTokens = () => [activeToken];
  globalThis.canvas = {
    grid: {
      size: 1,
      measurePath: ([from, to]) => Math.abs(to.x - from.x),
    },
    tokens: {
      placeables: [activeToken, allyToken, enemyToken],
    },
  };
  globalThis.game = {
    user: {
      isGM: true,
      targets: new Set([allyToken]),
    },
    combat: {
      id: "combat-1",
      round: 1,
      turn: 0,
      started: true,
      combatant: activeCombatant,
      combatants: combatantsFor([activeToken, allyToken, enemyToken]),
    },
  };
  const setCombatants = (tokens) => {
    globalThis.game.combat.combatants = combatantsFor(tokens);
  };
  const contextWithFriendlyTarget = readCombatContext("test");
  assert.equal(contextWithFriendlyTarget.battlefield.targets.length, 1);
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].name, "Giant Centipede");
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].disposition, -1);
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].ac, 16);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].saves, {
    fortitude: 17,
    reflex: 18,
    will: 19,
  });
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].perceptionDC, 20);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].resistances, [{ type: "fire", value: 5 }]);

  globalThis.game.user.isGM = false;
  const playerContextWithoutDefenses = readCombatContext("player-test");
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].name, "Giant Centipede");
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].ac, null);
  assert.deepEqual(playerContextWithoutDefenses.battlefield.targets[0].saves, {});
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].perceptionDC, null);
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].resistances, null);

  globalThis.game.user.isGM = true;
  globalThis.game.user.targets = new Set([neutralToken]);
  globalThis.canvas.tokens.placeables = [activeToken, neutralToken, enemyToken];
  const neutralTargetContext = readCombatContext("neutral-target-test");
  assert.deepEqual(
    neutralTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(neutralTargetContext.battlefield.targets.length, 1);
  assert.equal(neutralTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const calderActor = makeActor("calder", "Calder Stoneplow");
  const calderToken = makeToken("token-calder", "Calder Stoneplow", calderActor, 1, 30);
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [neutralToken, calderToken];
  globalThis.game.combat.combatant = makeCombatant(neutralToken);
  setCombatants([neutralToken, calderToken]);
  const neutralActiveContext = readCombatContext("neutral-active-test");
  assert.equal(neutralActiveContext.actor.name, "Nakpik");
  assert.deepEqual(
    neutralActiveContext.battlefield.enemies.map((target) => target.name),
    ["Calder Stoneplow"],
  );
  assert.equal(neutralActiveContext.battlefield.targets[0].name, "Calder Stoneplow");
  assert.ok(
    buildCandidates(neutralActiveContext).candidates.some((action) => ["step", "stride"].includes(action.slug)),
  );

  globalThis.game.user.targets = new Set([hiddenPitToken, treasureToken]);
  globalThis.canvas.tokens.placeables = [activeToken, hiddenPitToken, treasureToken, enemyToken];
  globalThis.game.combat.combatant = activeCombatant;
  setCombatants([activeToken, hiddenPitToken, treasureToken, enemyToken]);
  const objectTargetContext = readCombatContext("object-target-test");
  assert.deepEqual(
    objectTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(objectTargetContext.battlefield.targets.length, 1);
  assert.equal(objectTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const offCombatActor = makeActor("off-combat", "Off Combat Target");
  const offCombatToken = makeToken("token-off-combat", "Off Combat Target", offCombatActor, -1, 1);
  globalThis.game.user.targets = new Set([offCombatToken]);
  globalThis.canvas.tokens.placeables = [activeToken, offCombatToken, enemyToken];
  setCombatants([activeToken, enemyToken]);
  const outOfCombatTargetContext = readCombatContext("out-of-combat-target-test");
  assert.deepEqual(
    outOfCombatTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(outOfCombatTargetContext.battlefield.targets.length, 1);
  assert.equal(outOfCombatTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const farEnemyActor = makeActor("feral", "Fe'Ral");
  const nearEnemyActor = makeActor("amiri", "Amiri");
  const farEnemyToken = makeToken("token-feral", "Fe'Ral", farEnemyActor, -1, 60);
  const nearEnemyToken = makeToken("token-amiri", "Amiri", nearEnemyActor, -1, 5);
  globalThis.game.user.isGM = true;
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [activeToken, farEnemyToken, nearEnemyToken];
  setCombatants([activeToken, farEnemyToken, nearEnemyToken]);
  const nearestFallbackContext = readCombatContext("nearest-test");
  assert.equal(nearestFallbackContext.battlefield.targets[0].name, "Amiri");

  const sootscaleActor = makeActor("sootscale-kobold-scout", "Sootscale Kobold Scout");
  const nakpikToken = makeToken("token-nakpik-active", "Nakpik", sootscaleActor, -1, 0);
  const otherSootscaleToken = makeToken("token-sootscale-other", "Sootscale Kobold Scout", sootscaleActor, -1, 10);
  sootscaleActor.getActiveTokens = () => [otherSootscaleToken, nakpikToken];
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [otherSootscaleToken, nakpikToken, calderToken];
  globalThis.game.combat.combatant = {
    id: "combatant-nakpik",
    name: "Nakpik",
    actor: sootscaleActor,
    tokenId: nakpikToken.id,
    token: { id: nakpikToken.id, uuid: nakpikToken.document.uuid },
  };
  globalThis.game.combat.combatants = [
    globalThis.game.combat.combatant,
    makeCombatant(calderToken),
  ];
  const namedTokenContext = readCombatContext("named-token-test");
  assert.equal(namedTokenContext.actor.name, "Nakpik");
  assert.equal(namedTokenContext.token.name, "Nakpik");
  assert.deepEqual(
    namedTokenContext.battlefield.enemies.map((target) => target.name),
    ["Calder Stoneplow"],
  );
  assert.equal(namedTokenContext.battlefield.targets[0].name, "Calder Stoneplow");
} finally {
  globalThis.game = previousGame;
  globalThis.canvas = previousCanvas;
}

const systemSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "system-electric-arc",
          name: "System Electric Arc",
          slug: "electric-arc",
          system: {
            slug: "electric-arc",
            time: { value: "1" },
            traits: { value: ["cantrip"] },
            level: { value: 0 },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [],
      },
    },
  },
};
const hybridSpell = readSpellActions(systemSpellContext).find((spell) => spell.slug === "electric-arc");
assert.equal(hybridSpell.name, "System Electric Arc");
assert.equal(hybridSpell.actionCost, 1);
assert.equal(hybridSpell.curated.role, "damage");
assert.equal(hybridSpell.source, "spell-curated");

const stanceClassification = classifySystemAction({
  name: "Dragon Stance",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["stance", "monk"] },
    description: { value: "<p>You enter the stance of a dragon and can make tail Strikes.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(stanceClassification.role, "setup");
assert.equal(stanceClassification.activityProfile.stance, true);
assert.deepEqual(stanceClassification.setupFor, ["strike", "damage"]);

assert.equal(findCustomAction("power-attack").role, "damage");
assert.equal(findCustomAction("power-attack").activityProfile.focusedStrike, true);
assert.equal(findCustomAction("vicious-swing").role, "damage");

const widenSpellClassification = classifySystemAction({
  name: "Widen Spell",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["spellshape", "wizard"] },
    description: { value: "<p>You manipulate the energy of your spell, causing it to affect a wider area.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(widenSpellClassification.role, "setup");
assert.equal(widenSpellClassification.activityProfile.spellBuff, true);
assert.deepEqual(widenSpellClassification.setupFor, ["spell", "damage", "control", "healing"]);

const fireballClassification = classifySpell({
  name: "Fireball",
  system: {
    traits: { value: ["fire"] },
    level: { value: 3 },
    range: { value: "500 feet" },
    area: { type: "burst", value: 20 },
    defense: { save: { statistic: "reflex", basic: true } },
    damage: { "0": { formula: "6d6", type: "fire" } },
  },
});
assert.equal(fireballClassification.role, "area-damage");
assert.equal(fireballClassification.saveProfile.stat, "reflex");
assert.equal(fireballClassification.targetingProfile.area, true);
assert.equal(fireballClassification.targetingProfile.distance, 20);
assert.equal(fireballClassification.damageProfile.type, "fire");

const phantasmalClassification = classifySpell({
  name: "Phantasmal Killer",
  system: {
    traits: { value: ["illusion", "mental"] },
    level: { value: 4 },
    range: { value: "30 feet" },
    defense: { save: { statistic: "will", basic: false } },
    damage: { "0": { formula: "8d6", type: "mental" } },
  },
});
assert.equal(phantasmalClassification.role, "save-damage");
assert.equal(phantasmalClassification.saveProfile.stat, "will");
assert.equal(phantasmalClassification.targetingProfile.maxRange, 30);

const telekineticClassification = classifySpell({
  name: "Telekinetic Projectile",
  system: {
    traits: { value: ["attack", "cantrip"] },
    level: { value: 0 },
    range: { value: "30 feet" },
    damage: { "0": { formula: "2d6", type: "bludgeoning" } },
  },
});
assert.equal(telekineticClassification.role, "damage");
assert.equal(telekineticClassification.activityProfile.spellAttack, true);
assert.equal(telekineticClassification.targetingProfile.maxRange, 30);

const forceBarrageClassification = classifySpell({
  name: "Force Barrage",
  system: {
    traits: { value: ["concentrate", "force", "manipulate"] },
    level: { value: 1 },
    range: { value: "120 feet" },
    damage: { "0": { formula: "1d4+1", type: "force" } },
  },
});
assert.equal(forceBarrageClassification.role, "damage");
assert.equal(forceBarrageClassification.activityProfile.spellAttack, false);
assert.equal(forceBarrageClassification.targetingProfile.maxRange, 120);

const multiActionSpellScore = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}, {
  id: "spell-twoaction",
  name: "Two-Action Nuke",
  slug: "two-action-nuke",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { formula: "4d6", type: "fire" },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
const oneActionSpellScore = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}, {
  id: "spell-oneaction",
  name: "One-Action Zap",
  slug: "one-action-zap",
  actionCost: 1,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { formula: "2d6", type: "fire" },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
assert.ok(
  multiActionSpellScore.score >= oneActionSpellScore.score + 40,
  `2-action spell should be credited for its extra action, got ${multiActionSpellScore.score} vs ${oneActionSpellScore.score}`,
);
assert.ok(multiActionSpellScore.reasons.some((reason) => reason.includes("Commits 2 actions")));

const fearClassification = classifySpell({
  name: "Fear",
  system: {
    traits: { value: ["emotion", "fear", "mental"] },
    level: { value: 1 },
    range: { value: "30 feet" },
    defense: { save: { statistic: "will", basic: false } },
  },
});
assert.equal(fearClassification.role, "control");
assert.equal(fearClassification.saveProfile.stat, "will");

const healClassification = classifySpell({
  name: "Heal",
  system: {
    traits: { value: ["healing", "vitality"] },
    level: { value: 1 },
    range: { value: "touch" },
    damage: { "0": { formula: "1d8", type: "healing" } },
  },
});
assert.equal(healClassification.role, "healing");
assert.equal(healClassification.targetingProfile.ally, true);

const heroismClassification = classifySpell({
  name: "Heroism",
  system: {
    traits: { value: ["enchantment", "mental"] },
    level: { value: 3 },
    range: { value: "touch" },
    target: { value: "1 creature" },
    description: { value: "<p>The target gains a +1 status bonus to attack rolls, Perception, and saving throws.</p>" },
  },
});
assert.equal(heroismClassification.role, "buff");
assert.equal(heroismClassification.activityProfile.attackBuff, true);
assert.equal(heroismClassification.targetingProfile.ally, true);

// A non-combat utility spell is not a buff, but with max-coverage it still
// surfaces as a low-priority "utility" option rather than being dropped.
const utilitySpellNotBuff = classifySpell({
  name: "Detect Magic",
  system: {
    traits: { value: ["detection"] },
    level: { value: 1 },
    range: { value: "30 feet" },
    time: { value: "2" },
    description: { value: "<p>You send out a pulse that registers the presence of magic.</p>" },
  },
});
assert.equal(utilitySpellNotBuff.role, "utility");
assert.notEqual(utilitySpellNotBuff.role, "buff");

const buffActionClassification = classifySystemAction({
  name: "Inspiring Banner",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["bravado"] },
    description: { value: "<p>Allies within 30 feet gain a +1 status bonus to attack rolls until the start of your next turn.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(buffActionClassification.role, "buff");
assert.equal(buffActionClassification.targetingProfile.ally, true);
assert.deepEqual(buffActionClassification.setupFor, ["strike", "damage"]);

const teleportSpellClassification = classifySpell({
  name: "Dimension Door",
  system: {
    traits: { value: ["conjuration", "teleportation"] },
    level: { value: 4 },
    range: { value: "120 feet" },
    time: { value: "2" },
    description: { value: "<p>You instantly transport yourself to a location.</p>" },
  },
});
assert.equal(teleportSpellClassification.role, "mobility");

const summonClassification = classifySystemAction({
  name: "Summon Lesser Spirit",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    traits: { value: ["summon", "occult"] },
    description: { value: "<p>You summon forth a spirit to fight at your side.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(summonClassification.role, "summon");

const utilityActionClassification = classifySystemAction({
  name: "Obscure Inkblot",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["concentrate"] },
    description: { value: "<p>You smudge a glyph so it cannot be read until tomorrow.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(utilityActionClassification.role, "utility");

// Trigger-gated reactions with no tactical pattern stay null (not proactive picks).
const triggerReactionClassification = classifySystemAction({
  name: "Lucky Stumble",
  system: {
    actionType: { value: "reaction" },
    actions: { value: null },
    traits: { value: ["fortune"] },
    description: { value: "<p>Trigger You fail a check. Effect You reroll.</p>" },
  },
}, { actionCost: "reaction", type: "reaction" });
assert.equal(triggerReactionClassification, null);

// An enemy-targeted setup (Taunt-style off-guard) suggests the enemy, not self.
const enemySetupTarget = scoreCandidate(fighterContext, {
  id: "taunt",
  name: "Taunt",
  slug: "taunt",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], appliesCondition: "off-guard" },
  targetingProfile: { enemy: true, maxRange: 30 },
  setupFor: ["strike", "damage"],
});
assert.equal(enemySetupTarget.suggestedTarget.name, "Ogre");
assert.equal(enemySetupTarget.suggestedTarget.type, "enemy");

// A self-targeted setup (stance/rage) suggests the actor.
const selfSetupTarget = scoreCandidate(fighterContext, {
  id: "dragon-stance",
  name: "Dragon Stance",
  slug: "dragon-stance",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], stance: true },
  targetingProfile: { self: true },
  setupFor: ["strike", "damage"],
});
assert.equal(selfSetupTarget.suggestedTarget.name, "Valeros");
assert.equal(selfSetupTarget.suggestedTarget.type, "self");

// Focused Assault "counts as a number of attacks equal to the number of heads"
// toward MAP, so a follow-up Strike should be at full MAP -10, not -5.
const focusedAssaultMap = classifySystemAction({
  name: "Focused Assault",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "<p>The hydra Strikes with its fangs. This Strike counts as a number of attacks equal to the number of heads the hydra has toward the hydra's multiple attack penalty.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(focusedAssaultMap.activityProfile.mapAttacks, "variable");

const mapPlans = buildTurnPlans(fighterContext, [{
  id: "focused-assault",
  name: "Focused Assault",
  slug: "focused-assault",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  score: 90,
  confidence: "medium",
  attackTrait: true,
  activityProfile: { includesStrike: true, focusedStrike: true, mapAttacks: "variable" },
}, {
  id: "fangs",
  name: "Fangs",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 80,
  confidence: "medium",
  attackTrait: true,
}]);
const faThenStrike = mapPlans.find((plan) => plan.summary === "Focused Assault -> Fangs");
assert.ok(faThenStrike, "expected a Focused Assault -> Fangs plan");
const fangsStep = faThenStrike.steps.find((step) => step.slug === "strike");
assert.equal(fangsStep.mapPenalty, 10);

// A plain Strike before any MAP-heavy activity stays at MAP 0.
const plainFirstStrike = buildTurnPlans(fighterContext, [{
  id: "fangs-solo",
  name: "Fangs",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 80,
  confidence: "medium",
  attackTrait: true,
}])[0];
assert.equal(plainFirstStrike.steps[0].mapPenalty, 0);

// A leap/charge that moves and Strikes is a move-and-strike, not a stationary
// Strike — so it can be recommended when the target needs closing distance.
const leapingChargeClassification = classifySystemAction({
  name: "Leaping Charge",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "<p>The bulette Leaps up to its Speed and makes a jaws Strike against a creature.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(leapingChargeClassification.role, "mobility-attack");
assert.equal(leapingChargeClassification.activityProfile.includesStrike, true);

// Strike scoring reads expected damage so a bigger weapon outranks a smaller one
// for the opening attack (Jaws 2d10+10 ~21 vs Claw 2d8+10 ~19).
const meleeContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
};
const jawsStrikeScore = scoreCandidate(meleeContext, {
  id: "jaws", name: "Jaws", slug: "strike", actionCost: 1, source: "strike",
  range: { max: 5 }, averageDamage: 21,
});
const clawStrikeScore = scoreCandidate(meleeContext, {
  id: "claw", name: "Claw", slug: "strike", actionCost: 1, source: "strike",
  range: { max: 5 }, averageDamage: 19,
});
assert.ok(
  jawsStrikeScore.score > clawStrikeScore.score,
  `harder-hitting strike should outrank a smaller one, got Jaws ${jawsStrikeScore.score} vs Claw ${clawStrikeScore.score}`,
);

const swordVsUnarmedContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: {
        actions: [{
          slug: "unarmed-attack",
          type: "strike",
          label: "Unarmed Attack",
          visible: true,
          ready: true,
          canAttack: true,
          traits: [{ slug: "agile" }, { slug: "unarmed" }],
          item: {
            id: "unarmed-attack",
            name: "Unarmed Attack",
            system: { damage: { dice: 1, die: "d4", modifier: 4 } },
          },
        }, {
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          traits: [],
          item: {
            id: "longsword",
            name: "Longsword",
            system: { damage: { dice: 1, die: "d8", modifier: 4 } },
          },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {
    ...fighterContext.profile,
    conditions: { slugs: ["slowed"], values: { slowed: 1 } },
  },
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
  battlefield: {
    ...fighterContext.battlefield,
    targets: [{ ...fighterContext.targets[0], distance: 5 }],
  },
};
const swordVsUnarmedSources = readActionSources(swordVsUnarmedContext).filter((action) => action.source === "strike");
assert.equal(swordVsUnarmedSources.find((action) => action.name === "Unarmed Attack").averageDamage, 6.5);
assert.equal(swordVsUnarmedSources.find((action) => action.name === "Longsword").averageDamage, 8.5);
const swordVsUnarmedStrikes = swordVsUnarmedSources.map((action) => scoreCandidate(swordVsUnarmedContext, action));
const swordAfterGrapplePlan = bestTurnPlan(swordVsUnarmedContext, [{
  id: "grapple-primer",
  name: "Grapple",
  slug: "grapple",
  actionCost: 1,
  source: "generic",
  attackTrait: true,
  score: 100,
  confidence: "medium",
  reason: "Control target.",
}, ...swordVsUnarmedStrikes]);
assert.equal(swordAfterGrapplePlan.steps[1].name, "Longsword");

// The strike reader derives average damage from the NPC damageRolls shape.
const damageReaderStrike = readActionSources({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "jaws",
          type: "strike",
          label: "Jaws",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "jaws", system: { damageRolls: { "0": { damage: "2d10+10", damageType: "piercing" } } } },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {},
  targets: [],
}).find((entry) => entry.name === "Jaws");
assert.equal(damageReaderStrike.averageDamage, 21);

const previousDirectStrikeBlockedCanvas = globalThis.canvas;
const previousDirectStrikeBlockedFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) => options?.type === "sight" && ray.A.x < 5,
    },
  };
  const blockedDirectCrossbowContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "crossbow",
            type: "strike",
            label: "Crossbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "crossbow", system: { range: { max: 120 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  const blockedDirectCrossbow = readActionSources(blockedDirectCrossbowContext)
    .find((action) => action.name === "Crossbow");
  assert.equal(blockedDirectCrossbow.available, false);
  assert.equal(blockedDirectCrossbow.unavailableReason, "Attack path to target is blocked.");
  assert.equal(
    buildCandidates(blockedDirectCrossbowContext).candidates.some((action) => action.name === "Crossbow"),
    false,
  );
  const moveToShootCrossbow = readActionSources(blockedDirectCrossbowContext)
    .find((action) => action.slug === "stride-strike-crossbow");
  assert.ok(moveToShootCrossbow, "expected Stride -> Crossbow when current shot is blocked");
  assert.equal(moveToShootCrossbow.actionCost, 2);
} finally {
  globalThis.canvas = previousDirectStrikeBlockedCanvas;
  globalThis.foundry = previousDirectStrikeBlockedFoundry;
}

const previousCenterBlockedShotCanvas = globalThis.canvas;
const previousCenterBlockedShotFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "sight" && ray.B.x === 30 && ray.B.y === 0,
    },
  };
  const centerBlockedShotContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "crossbow",
            type: "strike",
            label: "Crossbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "crossbow", system: { range: { max: 120 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(centerBlockedShotContext).find((action) => action.slug === "stride-strike-crossbow"),
    undefined,
  );
} finally {
  globalThis.canvas = previousCenterBlockedShotCanvas;
  globalThis.foundry = previousCenterBlockedShotFoundry;
}

// A target two Strides away (45 ft, Speed 25, reach 5) gets a "Stride -> Stride ->
// Strike" composite so the planner can recommend closing the gap and attacking.
const twoStrideContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "claw", type: "strike", label: "Claw",
          visible: true, ready: true, canAttack: true,
          item: { id: "claw", system: { traits: { value: [] } } },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
  battlefield: {
    enemies: [{ id: "amiri", name: "Amiri", distance: 45 }],
    targets: [{ id: "amiri", name: "Amiri", distance: 45 }],
  },
  targets: undefined,
};
const twoStrideComposite = readActionSources(twoStrideContext).find((a) => a.slug === "stride-strike-claw");
assert.ok(twoStrideComposite, "expected a two-Stride composite for a far target");
assert.equal(twoStrideComposite.actionCost, 3);
assert.equal(twoStrideComposite.activityProfile.strideCount, 2);
assert.equal(twoStrideComposite.name, "Stride -> Stride -> Claw");
const twoStrideBest = bestTurnPlan(twoStrideContext, buildCandidates(twoStrideContext).candidates);
assert.ok(
  twoStrideBest.steps.some((step) => step.slug === "stride-strike-claw"),
  `far-target plan should move twice and Strike, got ${twoStrideBest.summary}`,
);

const previousBlockedStrikeCanvas = globalThis.canvas;
const previousBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move" && ray.B.x > 0,
    },
  };
  const blockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(blockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousBlockedStrikeCanvas;
  globalThis.foundry = previousBlockedStrikeFoundry;
}

const previousTokenBlockedStrikeCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: {
      placeables: [{
        id: "active-token",
        checkCollision: (to, options) => options?.type === "move" && to.x > 0,
      }],
    },
  };
  const tokenBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { id: "active-token", center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(tokenBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousTokenBlockedStrikeCanvas;
}

const previousAttackBlockedStrikeCanvas = globalThis.canvas;
const previousAttackBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "sight"
        && ray.B.x >= 27.5
        && ray.B.x <= 32.5
        && ray.B.y >= -2.5
        && ray.B.y <= 2.5,
    },
  };
  const attackBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(attackBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousAttackBlockedStrikeCanvas;
  globalThis.foundry = previousAttackBlockedStrikeFoundry;
}

const previousStepwiseStrideStrikeCanvas = globalThis.canvas;
const previousStepwiseStrideStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: {
      size: 5,
      measurePath: ([from, to]) => Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)),
    },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move"
        && Math.max(Math.abs(ray.B.x - ray.A.x), Math.abs(ray.B.y - ray.A.y)) > 5,
    },
  };
  const stepwiseStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 20, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 25, token: { center: { x: 25, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 25, token: { center: { x: 25, y: 0 } } }],
    },
    targets: undefined,
  };
  const stepwiseStrideStrike = readActionSources(stepwiseStrideStrikeContext)
    .find((action) => action.slug === "stride-strike-claw");
  assert.equal(stepwiseStrideStrike.activityProfile.strideCount, 1);
} finally {
  globalThis.canvas = previousStepwiseStrideStrikeCanvas;
  globalThis.foundry = previousStepwiseStrideStrikeFoundry;
}

// A target within one Stride still uses a single-Stride composite.
const oneStrideContext = {
  ...twoStrideContext,
  battlefield: {
    enemies: [{ id: "amiri", name: "Amiri", distance: 20 }],
    targets: [{ id: "amiri", name: "Amiri", distance: 20 }],
  },
};
const oneStrideComposite = readActionSources(oneStrideContext).find((a) => a.slug === "stride-strike-claw");
assert.equal(oneStrideComposite.actionCost, 2);
assert.equal(oneStrideComposite.activityProfile.strideCount, 1);

const previousSkirmishGame = globalThis.game;
const previousSkirmishCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
  };
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner"
        ? {
          api: {
            autoVisibility: {
              getPerceptionProfile: (observerId, targetId) => ({
                coverState: observerId === "target-token" && targetId === "observer-token"
                  ? "standard"
                  : "none",
              }),
            },
          },
        }
        : null,
    },
  };
  const rangedSkirmishContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "shortbow",
            type: "strike",
            label: "Shortbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "shortbow", system: { range: { max: 60 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "observer-token", center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "target-token", name: "Mitflit", distance: 80, token: { center: { x: 80, y: 0 } } }],
      targets: [{ id: "target-token", name: "Mitflit", distance: 80, token: { center: { x: 80, y: 0 } } }],
    },
    targets: undefined,
  };
  const skirmishAction = readActionSources(rangedSkirmishContext)
    .find((action) => action.slug === "stride-strike-stride-shortbow");
  assert.ok(skirmishAction, "expected a covered ranged skirmish composite");
  assert.equal(skirmishAction.actionCost, 3);
  assert.equal(skirmishAction.name, "Stride -> Shortbow -> Stride");
  assert.equal(skirmishAction.activityProfile.retreatAfterStrike, true);
  assert.equal(skirmishAction.activityProfile.defensiveCoverState, "standard");

  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({ coverState: "none" }),
        },
      },
    }
    : null;
  assert.equal(
    readActionSources(rangedSkirmishContext).find((action) => action.slug === "stride-strike-stride-shortbow"),
    undefined,
  );
} finally {
  globalThis.game = previousSkirmishGame;
  globalThis.canvas = previousSkirmishCanvas;
}

const previousPerimeterBlockedStrikeCanvas = globalThis.canvas;
const previousPerimeterBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray) => ray.B.x !== 40 || ray.B.y !== 0,
    },
  };
  const perimeterBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 35, reach: 5 },
    battlefield: {
      enemies: [{
        id: "caged-mitflit",
        name: "Caged Mitflit",
        distance: 40,
        token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      }],
      targets: [{
        id: "caged-mitflit",
        name: "Caged Mitflit",
        distance: 40,
        token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(perimeterBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousPerimeterBlockedStrikeCanvas;
  globalThis.foundry = previousPerimeterBlockedStrikeFoundry;
}

const movementLimitedContext = {
  ...twoStrideContext,
  actor: {
    document: {
      system: {
        actions: [
          ...twoStrideContext.actor.document.system.actions,
          {
            slug: "gallop",
            type: "action",
            label: "Gallop",
            actionType: "action",
            actions: 2,
            traits: [{ slug: "move" }],
            description: { value: "<p>The war pony Strides twice.</p>" },
          },
        ],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {
    ...twoStrideContext.profile,
    hasCover: true,
    conditions: { slugs: ["grabbed"], values: { grabbed: 1 } },
  },
};

const previousCagedMoveCanvas = globalThis.canvas;
const previousCagedMoveFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        ["move", "movement"].includes(options?.type)
        && (ray.A.x !== ray.B.x || ray.A.y !== ray.B.y),
    },
  };
  const cagedMovementContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...twoStrideContext.profile,
      speed: 25,
      conditions: { slugs: [], values: {} },
    },
  };
  const cagedMovementActions = readActionSources(cagedMovementContext);
  assert.equal(cagedMovementActions.find((action) => action.slug === "step").available, false);
  assert.equal(cagedMovementActions.find((action) => action.slug === "step").unavailableReason, "No collision-free movement path.");
  assert.equal(cagedMovementActions.find((action) => action.slug === "stride").available, false);
  assert.equal(cagedMovementActions.find((action) => action.slug === "stride").unavailableReason, "No collision-free movement path.");
  assert.equal(buildCandidates(cagedMovementContext).candidates.some((action) => ["step", "stride"].includes(action.slug)), false);
} finally {
  globalThis.canvas = previousCagedMoveCanvas;
  globalThis.foundry = previousCagedMoveFoundry;
}

const previousSegmentCagedMoveCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      placeables: [
        { document: { c: [-2.5, -2.5, 2.5, -2.5] } },
        { document: { c: [2.5, -2.5, 2.5, 2.5] } },
        { document: { c: [2.5, 2.5, -2.5, 2.5] } },
        { document: { c: [-2.5, 2.5, -2.5, -2.5] } },
      ],
    },
  };
  const segmentCagedMovementContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...twoStrideContext.profile,
      speed: 25,
      conditions: { slugs: [], values: {} },
    },
  };
  const segmentCagedMovementActions = readActionSources(segmentCagedMovementContext);
  assert.equal(segmentCagedMovementActions.find((action) => action.slug === "step").available, false);
  assert.equal(segmentCagedMovementActions.find((action) => action.slug === "stride").available, false);
} finally {
  globalThis.canvas = previousSegmentCagedMoveCanvas;
}

const movementLimitedActions = readActionSources(movementLimitedContext);
assert.equal(movementLimitedActions.find((action) => action.slug === "step").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "stride").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "sneak").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "escape").available, true);
assert.equal(movementLimitedActions.find((action) => action.slug === "gallop").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "stride-strike-claw"), undefined);
const movementLimitedCandidates = buildCandidates(movementLimitedContext).candidates;
assert.equal(movementLimitedCandidates.some((action) =>
  ["step", "stride", "sneak", "gallop", "stride-strike-claw"].includes(action.slug),
), false);

const inferredSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "system-telekinetic",
          name: "Telekinetic Projectile",
          slug: "telekinetic-projectile",
          system: {
            slug: "telekinetic-projectile",
            time: { value: "2" },
            traits: { value: ["attack", "cantrip"] },
            level: { value: 0 },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "bludgeoning" } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [],
      },
    },
  },
};
const inferredSpell = readSpellActions(inferredSpellContext).find((spell) => spell.slug === "telekinetic-projectile");
assert.equal(inferredSpell.source, "spell-inferred");
assert.equal(inferredSpell.role, "damage");
assert.equal(inferredSpell.available, true);
assert.equal(inferredSpell.targetingProfile.maxRange, 30);

const scoredInferredAreaSpell = scoreCandidate({
  ...fighterContext,
  battlefield: {
    enemies: [
      { id: "e1", name: "Ezren", distance: 15 },
      { id: "e2", name: "Merisiel", distance: 18 },
    ],
    allies: [],
    targets: [{ id: "e1", name: "Ezren", distance: 15 }],
  },
  targets: undefined,
}, {
  id: "spell-fireball",
  name: "Fireball",
  slug: "fireball",
  actionCost: 2,
  source: "spell-inferred",
  role: "area-damage",
  saveProfile: { stat: "reflex", dc: null, basic: true },
  damageProfile: { formula: "6d6", type: "fire" },
  activityProfile: { includes: ["damage", "area"], includesStrike: false },
  targetingProfile: { area: true, type: "burst", distance: 20, maxRange: 500, enemy: true },
});
assert.ok(scoredInferredAreaSpell.score > 80, `area spell should score for enemies in area, got ${scoredInferredAreaSpell.score}`);
assert.ok(scoredInferredAreaSpell.reasons.some((reason) => reason.includes("Fireball can hit")));

const spellcasterProfile = {
  actorType: "character",
  speed: 25,
  reach: 5,
  hpPercent: 1,
  conditions: { slugs: [], values: {} },
  skills: {},
};
const spellcasterPipelineContext = {
  actor: {
    id: "ezren-1",
    name: "Ezren",
    profile: spellcasterProfile,
    document: {
      system: { actions: [] },
      itemTypes: {
        spell: [{
          id: "tk",
          name: "Telekinetic Projectile",
          slug: "telekinetic-projectile",
          system: {
            slug: "telekinetic-projectile",
            time: { value: "2" },
            traits: { value: ["attack", "cantrip"] },
            level: { value: 0 },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "bludgeoning" } },
            location: { value: "entry-1" },
          },
        }, {
          id: "bf",
          name: "Breathe Fire",
          slug: "breathe-fire",
          system: {
            slug: "breathe-fire",
            time: { value: "2" },
            traits: { value: ["fire", "manipulate"] },
            level: { value: 1 },
            range: { value: "" },
            area: { type: "cone", value: 15 },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d6", type: "fire" } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
        }],
        feat: [{
          id: "mountain-stance",
          name: "Mountain Stance",
          type: "feat",
          system: {
            slug: "mountain-stance",
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["stance", "monk"] },
            description: { value: "<p>You enter the mountain stance. Your fist Strikes gain bonus damage.</p>" },
          },
        }],
        action: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: spellcasterProfile,
  targets: [{ id: "foe", name: "Goblin", distance: 10, hpPercent: 1, conditions: [], saves: { reflex: 8 }, ac: 16 }],
  battlefield: {
    enemies: [{ id: "foe", name: "Goblin", distance: 10 }],
    allies: [],
    targets: [{ id: "foe", name: "Goblin", distance: 10 }],
  },
};
const spellcasterCandidates = buildCandidates(spellcasterPipelineContext).candidates;
const pipelineCantrip = spellcasterCandidates.find((candidate) => candidate.slug === "telekinetic-projectile");
assert.equal(pipelineCantrip.source, "spell-inferred");
assert.equal(pipelineCantrip.role, "damage");
const pipelineAreaSpell = spellcasterCandidates.find((candidate) => candidate.slug === "breathe-fire");
assert.equal(pipelineAreaSpell.source, "spell-inferred");
assert.equal(pipelineAreaSpell.role, "area-damage");
const pipelineStance = spellcasterCandidates.find((candidate) => candidate.slug === "mountain-stance");
assert.equal(pipelineStance.source, "system-inferred");
assert.equal(pipelineStance.role, "setup");
const spellcasterPlan = bestTurnPlan(spellcasterPipelineContext, spellcasterCandidates);
assert.ok(
  spellcasterPlan.steps.some((step) => ["telekinetic-projectile", "breathe-fire", "mountain-stance"].includes(step.slug)),
  `PC plan should use an inferred spell or feat, got ${spellcasterPlan.summary}`,
);

console.log("PF2e Combater self-test passed");
