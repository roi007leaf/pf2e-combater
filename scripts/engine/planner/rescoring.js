import { scoreCandidate } from "../scoring.js";
import { advancePlanState, projectContextFromPlanState, serializePlanState } from "../plan-state.js";
import { HARD_BLOCK_SCORE } from "../scoring/weights.js";
import { actionKey } from "./rules.js";

// Step-by-step simulation: a candidate's score was computed once against the turn-start board.
// Partway through a plan the board has changed (the actor moved closer, the target is prone or
// frightened, the actor stood up), so the candidate is re-scored against the projected board.
// Only the difference is applied -- projected minus turn-start, both scored the same way -- so the
// tuned base score, sibling comparisons and native odds the candidate already carries are kept, and
// only what the earlier steps changed moves it.

const CHECK_SETUP_SUCCESS = 0.6;

function projectionSignature(state) {
  const serialized = serializePlanState(state);
  return JSON.stringify([
    serialized.positionChanged ? serialized.position : null,
    serialized.actorConditions,
    serialized.targetConditions,
    serialized.approaches,
    state?.uncertainSetup === true,
  ]);
}

function rescoringInput(candidate) {
  // Same convention as inheritPlannedTarget: stale reasons from the standalone scoring are cleared
  // so the recompute doesn't append to them. MAP bookkeeping is the planner's, not the scorer's.
  const { mapBase: _mapBase, mapPenalty: _mapPenalty, projectedScoreDelta: _delta, ...rest } = candidate;
  return { ...rest, reason: undefined, reasons: undefined };
}

export function createPlanRescorer(baseContext, baseState) {
  const baseSignature = projectionSignature(baseState);
  const baseScores = new Map();
  const cache = new Map();
  const scoringContext = (context) => ({ ...context, skipNativePreflight: true });

  function baseScore(candidate, key) {
    if (!baseScores.has(key)) baseScores.set(key, scoreCandidate(scoringContext(baseContext), rescoringInput(candidate)).score);
    return baseScores.get(key);
  }

  // { delta, projected } for this candidate on this projected board; { delta: 0 } when the board is
  // unchanged or the scorer can't price the candidate either way; null when the projection itself
  // makes the candidate illegal.
  function evaluate(projectedContext, state, candidate) {
    // Projected follow-up Strikes (after a move-and-strike) are already priced for the moved-in position.
    if (!candidate || (candidate.activityProfile?.requiresProjectedAfterKey && !candidate.needsApproach)) return { delta: 0 };
    const signature = projectionSignature(state);
    if (signature === baseSignature && !candidate.needsApproach) return { delta: 0 };
    const key = `${actionKey(candidate)}|${candidate.suggestedTarget?.id ?? candidate.preferredTarget?.id ?? ""}`;
    const cacheKey = `${key}|${signature}`;
    if (!cache.has(cacheKey)) {
      const projected = scoreCandidate(scoringContext(projectedContext), rescoringInput(candidate));
      const base = baseScore(candidate, key);
      cache.set(cacheKey, { projected, rawDelta: projected.score - base, baseBlocked: base <= HARD_BLOCK_SCORE });
    }
    const { projected, rawDelta, baseBlocked } = cache.get(cacheKey);
    // Blocked both ways means the scorer can't price it here: the comparison says nothing. Approach
    // candidates are the exception -- they're blocked at turn start precisely because they're out
    // of range, so a blocked projection means the move didn't get them there.
    if (projected.score <= HARD_BLOCK_SCORE) return baseBlocked && !candidate.needsApproach ? { delta: 0 } : null;
    if (baseBlocked && !candidate.needsApproach) return { delta: 0 };
    // A payoff that depends on a skill-check setup (Trip, Demoralize, Feint) only lands when the
    // check does; weight the gain by a typical success chance.
    const delta = state?.uncertainSetup && rawDelta > 0 ? rawDelta * CHECK_SETUP_SUCCESS : rawDelta;
    return { delta, projected };
  }

  // Search-time: re-price a candidate against the prefix the search has built so far.
  function rescore(projectedContext, state, candidate) {
    if (!candidate || candidate.mapBase) return candidate;
    const result = evaluate(projectedContext, state, candidate);
    if (!result) return null;
    if (!result.projected || (Math.abs(result.delta) < 1 && !candidate.needsApproach)) return candidate;
    return {
      ...candidate,
      score: Number(candidate.score) + result.delta,
      projectedScoreDelta: result.delta,
      reasons: result.projected.reasons,
      reason: result.projected.reason,
      suggestedTarget: result.projected.suggestedTarget ?? candidate.suggestedTarget,
    };
  }

  // Plan-time: the search visits candidates in score order, not execution order, so a Trip scored
  // below the Strike it sets up was never "before" it during the search. Walk the final, ordered
  // plan and re-price every step against the board the steps before it leave, replacing whatever
  // delta the search computed in its own order.
  function simulate(context, initialState, steps) {
    let state = initialState;
    return steps.map((step) => {
      const projectedContext = projectContextFromPlanState(context, state);
      const result = evaluate(projectedContext, state, step);
      state = advancePlanState(context, state, step);
      if (!result) return step;
      const previous = Number(step.projectedScoreDelta) || 0;
      const delta = Math.abs(result.delta) < 1 ? 0 : result.delta;
      if (delta === previous) return step;
      const shift = delta - previous;
      return {
        ...step,
        score: Number(step.score) + shift,
        projectedScoreDelta: delta,
        ...(step.mapBase ? { mapBase: { ...step.mapBase, score: Number(step.mapBase.score) + shift } } : {}),
      };
    });
  }

  return { rescore, simulate };
}
