import { t } from "../../i18n.js";
import { normalizedActionFacts } from "../action/facts.js";

const SCORE_SCALE = 40;
const MAX_SCORE_DELTA = 20;
const APPROXIMATE_INTEL_WEIGHT = 0.5;
const OUTCOME_KEYS = ["criticalFailure", "failure", "success", "criticalSuccess"];
const NEUTRAL_ODDS = Object.freeze({
  criticalFailure: 0.05,
  failure: 0.45,
  success: 0.45,
  criticalSuccess: 0.05,
});

const OUTCOME_MODELS = Object.freeze({
  attack: Object.freeze({
    id: "attack",
    utilities: Object.freeze({ criticalFailure: 0, failure: 0, success: 1, criticalSuccess: 2 }),
  }),
  skill: Object.freeze({
    id: "skill",
    utilities: Object.freeze({ criticalFailure: 0, failure: 0, success: 1, criticalSuccess: 1.5 }),
  }),
  riskySkill: Object.freeze({
    id: "risky-skill",
    utilities: Object.freeze({ criticalFailure: -0.5, failure: 0, success: 1, criticalSuccess: 1.5 }),
  }),
  basicSave: Object.freeze({
    id: "basic-save",
    utilities: Object.freeze({ criticalFailure: 2, failure: 1, success: 0.5, criticalSuccess: 0 }),
  }),
  saveEffect: Object.freeze({
    id: "save-effect",
    utilities: Object.freeze({ criticalFailure: 1.5, failure: 1, success: 0, criticalSuccess: 0 }),
  }),
});

function numericChance(value) {
  const chance = Number(value);
  return Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : null;
}

function normalizedOdds(value) {
  if (!value || typeof value !== "object") return null;
  const odds = Object.fromEntries(OUTCOME_KEYS.map((key) => [key, numericChance(value[key]) ?? 0]));
  const total = OUTCOME_KEYS.reduce((sum, key) => sum + odds[key], 0);
  if (total <= 0) return null;
  return Object.fromEntries(OUTCOME_KEYS.map((key) => [key, odds[key] / total]));
}

function expectedValue(odds, utilities) {
  return OUTCOME_KEYS.reduce((sum, key) => sum + odds[key] * utilities[key], 0);
}

function outcomeModel(action, preflight) {
  const facts = normalizedActionFacts(action);
  if (preflight?.mode === "save") {
    return facts.resolution.basicSave ? OUTCOME_MODELS.basicSave : OUTCOME_MODELS.saveEffect;
  }
  if (preflight?.mode === "attack") return OUTCOME_MODELS.attack;
  return facts.resolution.criticalFailureRisk === "major"
    ? OUTCOME_MODELS.riskySkill
    : OUTCOME_MODELS.skill;
}

function withoutInformationalOnly(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => !/informational only|does not change auto-fill ranking/i.test(String(line ?? "")));
}

function unavailableResult(preflight) {
  return {
    scoreDelta: 0,
    preflight: { ...preflight, scoreApplied: false, scoreDelta: 0 },
  };
}

function legacyChanceDelta(preflight, confidenceWeight) {
  const chance = numericChance(preflight?.effectChance);
  if (chance === null) return null;
  return {
    scoreDelta: Math.round((chance - 0.5) * SCORE_SCALE * confidenceWeight),
    expectedValue: chance,
    neutralExpectedValue: 0.5,
    outcomeModel: "binary",
    outcomeUtilities: null,
  };
}

/**
 * Convert disclosure-safe native PF2e degree odds into one bounded Auto-fill adjustment.
 * Caller supplies action facts; this module owns degree orientation, outcome utility, confidence,
 * bounds, metadata, and explanation copy behind one pure interface.
 */
export function nativeOutcomeRanking(action, preflight) {
  if (preflight?.available !== true || preflight?.status !== "complete") return unavailableResult(preflight);

  const confidenceWeight = preflight?.approximate === true ? APPROXIMATE_INTEL_WEIGHT : 1;
  const odds = normalizedOdds(preflight?.odds);
  let outcome;
  if (odds) {
    const model = outcomeModel(action, preflight);
    const value = expectedValue(odds, model.utilities);
    const neutralValue = expectedValue(NEUTRAL_ODDS, model.utilities);
    outcome = {
      scoreDelta: Math.round((value - neutralValue) * SCORE_SCALE * confidenceWeight),
      expectedValue: value,
      neutralExpectedValue: neutralValue,
      outcomeModel: model.id,
      outcomeUtilities: model.utilities,
      odds,
    };
  } else {
    outcome = legacyChanceDelta(preflight, confidenceWeight);
    if (!outcome) return unavailableResult(preflight);
  }

  const scoreDelta = Math.max(-MAX_SCORE_DELTA, Math.min(MAX_SCORE_DELTA, outcome.scoreDelta));
  const rankingReason = scoreDelta > 0
    ? t("Preflight.RankingImproves", "PF2e degree outcomes improve Auto-fill ranking (+{delta}).", { delta: scoreDelta })
    : scoreDelta < 0
      ? t("Preflight.RankingReduces", "PF2e degree outcomes reduce Auto-fill ranking ({delta}).", { delta: scoreDelta })
      : t("Preflight.RankingNeutral", "PF2e degree outcomes leave Auto-fill ranking unchanged.");
  const tooltipLines = [...withoutInformationalOnly(preflight?.tooltipLines), rankingReason];
  return {
    scoreDelta,
    preflight: {
      ...preflight,
      ...outcome,
      scoreApplied: true,
      scoreDelta,
      rankingReason,
      tooltipLines,
      tooltip: tooltipLines.join(" "),
    },
  };
}
