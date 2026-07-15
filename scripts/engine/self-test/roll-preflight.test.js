import assert from "node:assert/strict";
import { actionDetailChips } from "../../ui/action/details.js";
import { scoreCandidate } from "../scoring.js";
import { nativeRollContextPreflight } from "../scoring/roll-preflight.js";
import { nativeOutcomeRanking } from "../scoring/probability.js";
import { SETTINGS } from "../../settings.js";

const neutralAttackOdds = { criticalFailure: 0.05, failure: 0.45, success: 0.45, criticalSuccess: 0.05 };
const critHeavyAttackOdds = { criticalFailure: 0.05, failure: 0.45, success: 0.2, criticalSuccess: 0.3 };
const neutralAttackRanking = nativeOutcomeRanking({ source: "strike" }, {
  available: true,
  status: "complete",
  mode: "attack",
  odds: neutralAttackOdds,
  effectChance: 0.5,
  tooltipLines: [],
});
assert.equal(neutralAttackRanking.scoreDelta, 0);

const exactRanking = nativeOutcomeRanking({ source: "strike" }, {
  available: true,
  status: "complete",
  mode: "attack",
  odds: critHeavyAttackOdds,
  effectChance: 0.5,
  approximate: false,
  tooltipLines: ["Known check.", "Informational only; does not change Auto-fill ranking."],
});
assert.equal(exactRanking.scoreDelta, 10);
assert.equal(exactRanking.preflight.scoreApplied, true);
assert.equal(exactRanking.preflight.outcomeModel, "attack");
assert.equal(exactRanking.preflight.expectedValue, 0.8);
assert.match(exactRanking.preflight.rankingReason, /\+10/);
assert.ok(!exactRanking.preflight.tooltipLines.some((line) => /informational only/i.test(line)));

const approximateRanking = nativeOutcomeRanking({ source: "strike" }, {
  available: true,
  status: "complete",
  mode: "attack",
  odds: critHeavyAttackOdds,
  effectChance: 0.5,
  approximate: true,
  tooltipLines: [],
});
assert.equal(approximateRanking.scoreDelta, 5, "revealed approximate Intel should influence ranking at half weight");

const riskySkillOdds = { criticalFailure: 0.3, failure: 0.2, success: 0.45, criticalSuccess: 0.05 };
const safeSkillRanking = nativeOutcomeRanking({}, {
  available: true,
  status: "complete",
  mode: "check",
  odds: riskySkillOdds,
  effectChance: 0.5,
  tooltipLines: [],
});
const riskySkillRanking = nativeOutcomeRanking({ criticalFailureRisk: "major" }, {
  available: true,
  status: "complete",
  mode: "check",
  odds: riskySkillOdds,
  effectChance: 0.5,
  tooltipLines: [],
});
assert.equal(safeSkillRanking.scoreDelta, 0);
assert.equal(riskySkillRanking.scoreDelta, -5, "major critical-failure consequences should lower expected value");
assert.equal(riskySkillRanking.preflight.outcomeModel, "risky-skill");

const criticalFailHeavySave = { criticalFailure: 0.3, failure: 0.2, success: 0.45, criticalSuccess: 0.05 };
const criticalSuccessHeavySave = { criticalFailure: 0.05, failure: 0.45, success: 0.2, criticalSuccess: 0.3 };
const strongBasicSaveRanking = nativeOutcomeRanking({ saveProfile: { basic: true } }, {
  available: true,
  status: "complete",
  mode: "save",
  odds: criticalFailHeavySave,
  effectChance: 0.5,
  tooltipLines: [],
});
const weakBasicSaveRanking = nativeOutcomeRanking({ saveProfile: { basic: true } }, {
  available: true,
  status: "complete",
  mode: "save",
  odds: criticalSuccessHeavySave,
  effectChance: 0.5,
  tooltipLines: [],
});
assert.equal(strongBasicSaveRanking.scoreDelta, 10);
assert.equal(weakBasicSaveRanking.scoreDelta, -5);
assert.equal(strongBasicSaveRanking.preflight.outcomeModel, "basic-save");
assert.ok(
  strongBasicSaveRanking.scoreDelta > weakBasicSaveRanking.scoreDelta,
  "equal target-failure chances should rank differently when critical-failure and success tails differ",
);

assert.equal(nativeOutcomeRanking({ source: "strike" }, {
  available: true,
  status: "complete",
  mode: "attack",
  odds: { criticalFailure: 0, failure: 0, success: 0, criticalSuccess: 1 },
  tooltipLines: [],
}).scoreDelta, 20, "degree outcome adjustment must keep its positive bound");
assert.equal(nativeOutcomeRanking({ criticalFailureRisk: "major" }, {
  available: true,
  status: "complete",
  mode: "check",
  odds: { criticalFailure: 1, failure: 0, success: 0, criticalSuccess: 0 },
  tooltipLines: [],
}).scoreDelta, -20, "degree outcome adjustment must keep its negative bound");

const unknownRanking = nativeOutcomeRanking({}, {
  available: true,
  status: "partial",
  effectChance: null,
  tooltipLines: [],
});
assert.equal(unknownRanking.scoreDelta, 0);
assert.equal(unknownRanking.preflight.scoreApplied, false);

function statistic(label, modifier, capture) {
  return {
    label,
    withRollOptions(options) {
      capture.options = options;
      return {
        label,
        check: {
          mod: modifier,
          breakdown: `${label} ${modifier >= 0 ? "+" : ""}${modifier}`,
          modifiers: [{ label, modifier, enabled: true }],
        },
      };
    },
  };
}

const rawTargetActor = {
  type: "npc",
  system: {
    attributes: { ac: { value: 28 } },
    traits: { value: ["undead", "fiend"] },
  },
};
const target = {
  id: "target",
  name: "Hidden Wraith",
  actor: rawTargetActor,
  saves: { will: 26 },
  traits: ["undead", "fiend"],
  intelLedger: { traits: ["undead"], saves: ["will"] },
};
const capture = {};
const actor = {
  type: "character",
  system: {},
  getStatistic(slug) {
    return slug === "intimidation" ? statistic("Intimidation", 16, capture) : null;
  },
};
const context = {
  isGM: false,
  actor: { document: actor },
  profile: { skills: { intimidation: { mod: 16, rank: 2 } } },
};
const demoralize = {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  source: "generic",
  role: "debuff",
  actionCost: 1,
  skill: "intimidation",
  traits: ["auditory", "emotion", "fear", "mental"],
};

const playerPreflight = nativeRollContextPreflight(context, demoralize, { target });
assert.equal(playerPreflight.available, true);
assert.equal(playerPreflight.scoreApplied, false, "shadow preflight must never change scoring directly");
assert.equal(playerPreflight.modifier, 16);
assert.equal(playerPreflight.dc, 26);
assert.equal(playerPreflight.mode, "check");
assert.match(playerPreflight.label, /^PF2e Success /);
assert.equal(capture.options.target, null, "player preflight must not receive raw target actor data");
assert.ok(capture.options.extraRollOptions.includes("target:trait:undead"));
assert.ok(!capture.options.extraRollOptions.includes("target:trait:fiend"), "unrevealed target traits must stay out of player roll context");
assert.match(playerPreflight.tooltip, /^PF2e check preview:/);
assert.match(playerPreflight.tooltip, /informational only/i);
assert.match(playerPreflight.tooltip, /does not change Auto-fill ranking/i);
assert.deepEqual(playerPreflight.tooltipLines, [
  "Intimidation +16 vs Will DC 26.",
  "Modifier breakdown: Intimidation +16.",
  "Informational only; does not change Auto-fill ranking.",
]);

const unknownCapture = {};
const unknownContext = {
  ...context,
  actor: {
    document: {
      ...actor,
      getStatistic: () => statistic("Intimidation", 16, unknownCapture),
    },
  },
};
const unknownTarget = { ...target, intelLedger: {} };
const unknownPreflight = nativeRollContextPreflight(unknownContext, demoralize, { target: unknownTarget });
assert.equal(unknownPreflight.dc, null, "unrevealed player target DC must remain unknown");
assert.equal(unknownPreflight.odds, null);
assert.equal(unknownPreflight.label, "PF2e Intimidation +16");
assert.equal(unknownCapture.options.target, null);
assert.ok(!unknownCapture.options.extraRollOptions.some((option) => option.startsWith("target:trait:")));

const gmCapture = {};
const gmContext = {
  ...context,
  isGM: true,
  actor: {
    document: {
      ...actor,
      getStatistic: () => statistic("Intimidation", 16, gmCapture),
    },
  },
};
const gmAttack = nativeRollContextPreflight(gmContext, {
  name: "Claw",
  slug: "strike",
  source: "strike",
  attackTrait: true,
  variants: [{ modifier: 18 }],
}, { target });
assert.equal(gmAttack.dc, 28);
assert.equal(gmAttack.mode, "attack");
assert.equal(gmAttack.source, "pf2e-strike");
assert.match(gmAttack.label, /^PF2e Hit /);

const tripCapture = {};
const tripPreflight = nativeRollContextPreflight({
  ...gmContext,
  actor: {
    document: {
      ...actor,
      getStatistic: (slug) => slug === "athletics" ? statistic("Athletics", -5, tripCapture) : null,
    },
  },
}, {
  name: "Trip",
  slug: "trip",
  source: "generic",
  skill: "athletics",
  traits: ["attack"],
}, {
  target: {
    ...target,
    saves: { ...target.saves, reflex: 22 },
  },
});
assert.equal(tripPreflight.mode, "check", "Trip's attack trait must not turn its Athletics check into an AC attack");
assert.equal(tripPreflight.dc, 22);
assert.equal(tripPreflight.dcLabel, "Reflex DC 22");
assert.match(tripPreflight.tooltip, /Athletics -5 vs Reflex DC 22/);

const preflightChips = actionDetailChips({
  ...demoralize,
  nativePreflight: playerPreflight,
});
assert.equal(preflightChips.length, 1, "non-spell actions should display native preflight evidence");
assert.equal(preflightChips[0].class, "is-preflight");
assert.match(preflightChips[0].label, /^PF2e Success /);
assert.match(preflightChips[0].tooltip, /informational only/i);
assert.equal(
  preflightChips[0].tooltipHtml,
  "<strong>PF2e check preview</strong><ul><li>Intimidation +16 vs Will DC 26.</li><li>Modifier breakdown: Intimidation +16.</li><li>Informational only; does not change Auto-fill ranking.</li></ul>",
  "Native preflight tooltip should use real list markup instead of one paragraph",
);

const saveTargetActor = {
  type: "npc",
  getStatistic(slug) {
    return slug === "reflex" ? statistic("Reflex", 12, {}) : null;
  },
};
const savePreflight = nativeRollContextPreflight({ ...gmContext }, {
  name: "Fireball",
  slug: "fireball",
  source: "spell-curated",
  spellDc: 28,
  saveProfile: { stat: "reflex", basic: true },
}, {
  target: {
    ...target,
    actor: saveTargetActor,
    saves: { reflex: 22 },
  },
});
assert.equal(savePreflight.mode, "save");
assert.equal(savePreflight.modifier, 12);
assert.equal(savePreflight.dc, 28);
assert.match(savePreflight.label, /^PF2e Fails /);

const highLevelTargetActor = {
  ...rawTargetActor,
  level: 5,
  system: {
    ...rawTargetActor.system,
    details: { level: { value: 5 } },
  },
  getStatistic(slug) {
    return slug === "reflex" ? statistic("Reflex", 12, {}) : null;
  },
};
const incapacitationSpell = {
  name: "Incapacitating Pulse",
  slug: "incapacitating-pulse",
  source: "spell-curated",
  castRank: 2,
  spellDc: 28,
  traits: ["incapacitation"],
  activityProfile: { spell: true },
  saveProfile: { stat: "reflex", basic: true },
};
const incapacitationTarget = {
  ...target,
  actor: highLevelTargetActor,
  saves: { reflex: 22 },
  intelLedger: { traits: ["undead"], saves: ["reflex"] },
};
const incapacitationSavePreflight = nativeRollContextPreflight(gmContext, incapacitationSpell, {
  target: incapacitationTarget,
});
assert.equal(incapacitationSavePreflight.incapacitationApplied, true);
assert.equal(incapacitationSavePreflight.degreeShift, 1);
assert.ok(Math.abs(incapacitationSavePreflight.unadjustedOdds.criticalFailure - 0.3) < 1e-9);
assert.ok(Math.abs(incapacitationSavePreflight.odds.failure - 0.3) < 1e-9);
assert.ok(Math.abs(incapacitationSavePreflight.odds.criticalSuccess - 0.25) < 1e-9);
assert.match(incapacitationSavePreflight.tooltip, /raises the target's result by one degree/i);
assert.equal(
  nativeOutcomeRanking(incapacitationSpell, incapacitationSavePreflight).scoreDelta,
  -10,
  "incapacitation-adjusted basic-save degrees should feed expected value",
);

const playerIncapacitationPreflight = nativeRollContextPreflight(context, incapacitationSpell, {
  target: incapacitationTarget,
});
assert.equal(
  playerIncapacitationPreflight.incapacitationApplied,
  false,
  "player preflight must not infer incapacitation from an undisclosed raw target level",
);

const incapacitationAttack = nativeRollContextPreflight(gmContext, {
  name: "Incapacitating Ray",
  slug: "incapacitating-ray",
  source: "spell-curated",
  castRank: 2,
  traits: ["attack", "incapacitation"],
  activityProfile: { spell: true, spellAttack: true },
  nativeStatistic: statistic("Spell Attack", 18, {}),
}, { target: incapacitationTarget });
assert.equal(incapacitationAttack.incapacitationApplied, true);
assert.equal(incapacitationAttack.degreeShift, -1);
assert.ok(Math.abs(incapacitationAttack.odds.criticalFailure - 0.45) < 1e-9);
assert.ok(Math.abs(incapacitationAttack.odds.failure - 0.5) < 1e-9);
assert.ok(Math.abs(incapacitationAttack.odds.success - 0.05) < 1e-9);
assert.match(incapacitationAttack.tooltip, /lowers the acting check's result by one degree/i);

const scoredTarget = { ...target, distance: 10, attackTargetable: true };
const scoredContext = {
  ...context,
  profile: {
    actorType: "character",
    skills: { intimidation: { mod: 16, rank: 2 } },
    conditions: { slugs: [], values: {} },
  },
  targets: [scoredTarget],
};
const previousGame = globalThis.game;
try {
  globalThis.game = {
    ...(previousGame ?? {}),
    settings: { get: (_moduleId, key) => key === SETTINGS.nativeRollContextPreflight ? false : undefined },
  };
  const withoutNativeScore = scoreCandidate(scoredContext, demoralize);
  assert.equal(withoutNativeScore.nativePreflight.available, false);
  assert.equal(withoutNativeScore.nativePreflight.status, "disabled");
  assert.ok(!withoutNativeScore.reasons.some((reason) => reason.startsWith("PF2e check preview:")));

  const gmScore = scoreCandidate({ ...scoredContext, isGM: true }, demoralize);
  assert.equal(gmScore.nativePreflight.available, true, "GM preflight must ignore the player setting");
  assert.ok(gmScore.reasons.some((reason) => reason.startsWith("PF2e check preview:")));

  globalThis.game.settings.get = (_moduleId, key) => key === SETTINGS.nativeRollContextPreflight ? true : undefined;
  const withNativeScore = scoreCandidate(scoredContext, demoralize);
  assert.equal(
    withNativeScore.score,
    withoutNativeScore.score + 2,
    "disclosed 55% native odds should provide a bounded +2 Auto-fill adjustment",
  );
  assert.equal(withNativeScore.nativePreflight.available, true);
  assert.equal(withNativeScore.nativePreflight.scoreApplied, true);
  assert.equal(withNativeScore.nativePreflight.scoreDelta, 2);
  assert.match(withNativeScore.nativePreflight.rankingReason, /\+2/);
  assert.ok(withNativeScore.reasons.some((reason) => reason.startsWith("PF2e check preview:")));
} finally {
  if (previousGame === undefined) delete globalThis.game;
  else globalThis.game = previousGame;
}

console.log("PF2e Combater roll-preflight test passed");
