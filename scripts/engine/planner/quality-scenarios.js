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
]);
