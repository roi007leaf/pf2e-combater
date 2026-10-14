import { advancePlanState, projectContextFromPlanState } from "../plan-state.js";
import { contextEnemies } from "../target-pool.js";
import { normalizedActionFacts } from "../action/facts.js";

// Next turn: how many Strides will you need before you can attack? A plan that ends in reach (or
// range) of an enemy sets up a full attack routine next round; one that ends farther away costs
// you actions then. Credited as the change against where you start, so plans that don't move are
// unaffected. Balanced against endPositionDanger: temperament decides which wins.

// A Stride saved next turn is a whole action for attacking then: worth about a Strike's share, so
// closing on a far enemy beats an idle defensive action this turn.
const POINTS_PER_STRIDE_SAVED = 30;
const MAX_STRIDES = 3;

function speedOf(context) {
  const speed = Number(context?.profile?.speed ?? context?.actor?.profile?.speed);
  return Number.isFinite(speed) && speed > 0 ? speed : 25;
}

function attackRange(candidate) {
  const facts = normalizedActionFacts(candidate);
  if (!facts.resolution.attack && !facts.resolution.offensive) return null;
  if (Number(candidate?.activityProfile?.strideCount) > 0) return null;
  const range = Number(candidate?.range?.max ?? candidate?.targetingProfile?.maxRange ?? candidate?.range?.increment);
  return Number.isFinite(range) && range > 0 ? range : 5;
}

// The candidate list is the same for every plan in a search: compute its attack ranges once.
const rangeCache = new WeakMap();
const beforeCache = new WeakMap();
function rangesFor(candidates) {
  if (!Array.isArray(candidates)) return [];
  if (!rangeCache.has(candidates)) rangeCache.set(candidates, [...new Set(candidates.map(attackRange).filter((range) => range !== null))]);
  return rangeCache.get(candidates);
}

function stridesToAttack(context, ranges) {
  const speed = speedOf(context);
  let best = MAX_STRIDES;
  for (const enemy of contextEnemies(context)) {
    const distance = Number(enemy?.distance);
    if (!Number.isFinite(distance) || enemy?.hpPercent === 0) continue;
    for (const range of ranges) {
      const strides = distance <= range ? 0 : Math.ceil((distance - range) / speed);
      if (strides < best) best = strides;
    }
  }
  return best;
}

export function nextTurnReadiness(context, initialState, steps, candidates = [], endState = null) {
  if (!initialState || !Array.isArray(steps) || !steps.length) return { saved: 0, scoreDelta: 0 };
  const ranges = rangesFor(candidates);
  if (!ranges.length) return { saved: 0, scoreDelta: 0 };
  let state = endState;
  if (!state) {
    state = initialState;
    for (const step of steps) state = advancePlanState(context, state, step);
  }
  if (!state.positionChanged && !(state.approaches?.size > 0)) return { saved: 0, scoreDelta: 0 };
  let byRanges = beforeCache.get(initialState);
  if (!byRanges) beforeCache.set(initialState, byRanges = new WeakMap());
  if (!byRanges.has(ranges)) byRanges.set(ranges, stridesToAttack(projectContextFromPlanState(context, initialState), ranges));
  const before = byRanges.get(ranges);
  const after = stridesToAttack(projectContextFromPlanState(context, state), ranges);
  const saved = before - after;
  return { saved, before, after, scoreDelta: saved * POINTS_PER_STRIDE_SAVED };
}
