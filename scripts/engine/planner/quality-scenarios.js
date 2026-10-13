import { fighterContext, fixtureCandidates } from "../fixtures.js";

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

const target = { id: "quality-ogre", name: "Ogre", conditions: { slugs: [], values: {} } };
const setupContext = {
  actor: {
    id: "quality-fighter",
    name: "Fighter",
    profile: { conditions: { slugs: [], values: {} } },
  },
  profile: { conditions: { slugs: [], values: {} } },
  targets: [target],
  battlefield: { targets: [target], enemies: [target], allies: [] },
};
const trip = candidate("trip", 60, {
  name: "Trip",
  source: "generic",
  role: "setup",
  suggestedTarget: { type: "enemy", id: target.id, name: target.name },
  activityProfile: { appliesConditions: ["prone"], duration: "until target stands" },
});
const pronePayoff = candidate("prone-payoff", 90, {
  name: "Prone Payoff",
  role: "damage",
  suggestedTarget: { type: "enemy", id: target.id, name: target.name },
  activityProfile: { requiresTargetCondition: "prone" },
});
const setupShield = candidate("setup-shield", 40, {
  name: "Raise a Shield",
  slug: "raise-a-shield",
  source: "generic",
  role: "defense",
});

const lowConfidenceCandidates = [
  candidate("unsafe-guess", 999, { role: "damage", confidence: "low" }),
  candidate("safe-strike", 70, { slug: "strike", source: "strike", role: "damage" }),
  candidate("safe-shield", 50, { slug: "raise-a-shield", source: "generic", role: "defense" }),
];

const oneSlotSpells = ["fireball", "haste", "slow"].map((id, index) => candidate(id, 100 - index, {
  source: "spell-curated",
  role: "damage",
  rank: 3,
  castRank: 3,
  spellcastingEntryId: "quality-arcane-entry",
  spellResource: { type: "spontaneous", rank: 3, remaining: 1, max: 3 },
}));
const resourceFillers = [
  candidate("resource-filler-one", 30),
  candidate("resource-filler-two", 29),
  candidate("resource-filler-three", 28),
];

const widePool = Array.from({ length: 16 }, (_value, index) => candidate(
  `wide-${index}`,
  100 - index,
  { role: "damage", confidence: "medium" },
));

const diversityCandidates = [
  candidate("strike-one", 30, { name: "Strike One", slug: "strike", source: "strike", role: "damage", actionCost: 3, confidence: "medium" }),
  candidate("strike-two", 29, { name: "Strike Two", slug: "strike", source: "strike", role: "damage", actionCost: 3, confidence: "medium" }),
  candidate("battle-ward", 28, { name: "Battle Ward", role: "buff", actionCost: 3, confidence: "medium" }),
];

// Ed's turn: rapier held but the enemy 25 ft away, dueling pistol in range, skill fillers on offer.
const edEnemy = { id: "quality-unknown", name: "Unknown", distance: 25, conditions: { slugs: [], values: {} } };
const edContext = {
  ...setupContext,
  actor: { ...setupContext.actor, id: "quality-ed", name: "Ed" },
  targets: [edEnemy],
  battlefield: { targets: [edEnemy], enemies: [edEnemy], allies: [] },
};
const atEd = { suggestedTarget: { type: "enemy", id: edEnemy.id, name: edEnemy.name } };
const plainStride = candidate("stride", 50, { name: "Stride", source: "generic", role: "mobility", ...atEd });
const plainStep = candidate("step", 42, { name: "Step", source: "generic", role: "mobility", ...atEd });
const diversion = candidate("create-a-diversion", 54, { name: "Create a Diversion", source: "generic", role: "setup", ...atEd });
const recall = candidate("recall-knowledge", 58, { name: "Recall Knowledge", source: "generic", role: "setup", ...atEd });
const pistol = candidate("strike-dueling-pistol", 54, {
  name: "Dueling Pistol", slug: "strike", source: "strike", role: "damage", confidence: "medium",
  range: { increment: 60, max: 360 }, traits: ["concussive", "fatal-d10"], ...atEd,
});
// (The out-of-reach Rapier itself is filtered out before planning, as in live Auto-fill.)
const strideRapier = candidate("stride-strike-rapier", 150, {
  name: "Stride -> Rapier", slug: "stride-strike-rapier", source: "system-inferred", role: "mobility-attack",
  actionCost: 2, confidence: "medium", range: { max: 5 }, ...atEd,
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1, strikeReach: 5 },
  targetingProfile: { enemy: true, reachAfterMove: true, preferredTargetId: edEnemy.id },
});
const stepRapier = candidate("step-strike-rapier", 140, {
  name: "Step -> Rapier", slug: "step-strike-rapier", source: "system-inferred", role: "mobility-attack",
  actionCost: 2, confidence: "medium", range: { max: 5 }, ...atEd,
  activityProfile: { includes: ["step", "strike"], includesStrike: true, strideCount: 1, strikeReach: 5, fixedDistance: 5 },
  targetingProfile: { enemy: true, reachAfterMove: true, preferredTargetId: edEnemy.id },
});
const hastedContext = {
  ...edContext,
  profile: { conditions: { slugs: ["quickened"], values: { quickened: 1 } } },
  actor: { ...edContext.actor, profile: { conditions: { slugs: ["quickened"], values: { quickened: 1 } } } },
};
const orphanSequence = ["stride", "create-a-diversion", "recall-knowledge"];
// No move-and-strike composite (e.g. the attack square couldn't be resolved): the Rapier is only
// reachable after a plain Stride, so it arrives as an approach candidate the planner must sequence.
const approachRapier = candidate("strike-rapier", -999, {
  name: "Rapier", slug: "strike", source: "strike", role: "damage", confidence: "medium",
  range: { max: 5 }, averageDamage: 9, needsApproach: true, item: { id: "rapier", name: "Rapier", type: "weapon" }, ...atEd,
});
const speedContext = {
  ...edContext,
  profile: { speed: 25, conditions: { slugs: [], values: {} } },
  actor: { ...edContext.actor, profile: { speed: 25, conditions: { slugs: [], values: {} } } },
};

export const plannerQualityScenarios = Object.freeze([
  {
    id: "balanced-martial",
    name: "Balanced martial full turn",
    context: fighterContext,
    candidates: fixtureCandidates,
    expect: {
      rankedPlans: [{
        rank: 1,
        sequence: ["demoralize", "strike", "raise-a-shield"],
        totalCost: 3,
      }],
      minPlanCount: 10,
      minCandidateCoverage: 1,
      minCompletePlanRate: 0.4,
      maxStatesExpanded: 100,
      searchLimitHit: false,
    },
  },
  {
    id: "condition-setup-payoff",
    name: "Condition setup before payoff",
    context: setupContext,
    candidates: [pronePayoff, trip, setupShield],
    expect: {
      rankedPlans: [{ rank: 1, sequence: ["trip", "prone-payoff"], totalCost: 3 }],
      anyPlans: [{ sequence: ["trip", "prone-payoff"] }],
      minCandidateCoverage: 1,
      maxStatesExpanded: 100,
      searchLimitHit: false,
    },
  },
  {
    id: "low-confidence-quarantine",
    name: "Low-confidence action quarantine",
    context: fighterContext,
    candidates: lowConfidenceCandidates,
    expect: {
      rankedPlans: [{ rank: 1, includes: ["safe-strike", "safe-shield"], totalCost: 3 }],
      excludedFromAllPlans: ["unsafe-guess"],
      maxStatesExpanded: 50,
      searchLimitHit: false,
    },
  },
  {
    id: "shared-resource-budget",
    name: "Shared spell-slot reservation",
    context: fighterContext,
    candidates: [...oneSlotSpells, ...resourceFillers],
    expect: {
      rankedPlans: [{ rank: 1, totalCost: 3 }],
      maxActionsPerPlan: [{ actions: oneSlotSpells.map((spell) => spell.id), max: 1 }],
      minCandidateCoverage: 1,
      maxStatesExpanded: 200,
      searchLimitHit: false,
    },
  },
  {
    id: "wide-pool-coverage",
    name: "Tail candidate coverage",
    context: fighterContext,
    includeCoverage: true,
    candidates: widePool,
    expect: {
      anyPlans: [{ includes: ["wide-15"], totalCost: 3 }],
      minPlanCount: 16,
      minCandidateCoverage: 1,
      maxStatesExpanded: 600,
      searchLimitHit: false,
    },
  },
  {
    id: "alternative-diversity",
    name: "Tactically distinct alternatives",
    context: fighterContext,
    candidates: diversityCandidates,
    expect: {
      rankedPlans: [
        { rank: 1, includes: ["strike-one"] },
        { rank: 2, includes: ["battle-ward"] },
      ],
      minPlanCount: 3,
      minTopAlternativeDiversity: 0.5,
      maxStatesExpanded: 25,
      searchLimitHit: false,
    },
  },
  {
    id: "melee-with-ranged-backup",
    name: "Melee approach beats pistol and skill filler",
    context: edContext,
    candidates: [plainStride, diversion, recall, pistol, strideRapier],
    expect: {
      rankedPlans: [{ rank: 1, includes: ["stride-strike-rapier"], totalCost: 3 }],
      forbiddenInTop: [{ n: 3, sequence: orphanSequence }],
      searchLimitHit: false,
    },
  },
  {
    id: "ranged-backup-no-orphans",
    name: "No orphan setups when only the pistol reaches",
    context: edContext,
    candidates: [plainStride, diversion, recall, pistol],
    expect: {
      rankedPlans: [{ rank: 1, includes: ["strike-dueling-pistol"] }],
      forbiddenInTop: [{ n: 3, sequence: orphanSequence }],
      searchLimitHit: false,
    },
  },
  {
    id: "step-into-reach",
    name: "Step into reach, then a follow-up Strike",
    context: { ...edContext, targets: [{ ...edEnemy, distance: 10 }], battlefield: { targets: [{ ...edEnemy, distance: 10 }], enemies: [{ ...edEnemy, distance: 10 }], allies: [] } },
    candidates: [plainStep, diversion, recall, stepRapier],
    expect: {
      rankedPlans: [{ rank: 1, sequence: ["step-strike-rapier", "strike-rapier"], totalCost: 3 }],
      searchLimitHit: false,
    },
  },
  {
    id: "hasted-approach",
    name: "Haste's extra action pays for the approach Stride",
    context: hastedContext,
    candidates: [plainStride, diversion, recall, strideRapier],
    expect: {
      rankedPlans: [{ rank: 1, includes: ["stride-strike-rapier"], totalCost: 4 }],
      searchLimitHit: false,
    },
  },
  {
    id: "plain-stride-then-strike",
    name: "A plain Stride brings an out-of-reach Strike into play",
    context: speedContext,
    candidates: [plainStride, diversion, recall],
    approachCandidates: [approachRapier],
    expect: {
      rankedPlans: [{ rank: 1, sequence: ["stride", "strike-rapier"], totalCost: 3 }],
      forbiddenInTop: [{ n: 1, sequence: orphanSequence }],
      searchLimitHit: false,
    },
  },
  {
    id: "out-of-reach-melee-only",
    name: "Out of reach with melee only: approach, no orphan Diversion",
    context: { ...edContext, targets: [{ ...edEnemy, distance: 70 }], battlefield: { targets: [{ ...edEnemy, distance: 70 }], enemies: [{ ...edEnemy, distance: 70 }], allies: [] } },
    candidates: [plainStride, diversion, recall],
    expect: {
      rankedPlans: [{ rank: 1, includes: ["stride"], excludes: ["create-a-diversion"] }],
      searchLimitHit: false,
    },
  },
]);
