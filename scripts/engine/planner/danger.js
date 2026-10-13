import { advancePlanState, projectContextFromPlanState } from "../plan-state.js";
import { contextEnemies } from "../target-pool.js";
import { hpPercent as entityHpPercent } from "../scoring/facts.js";
import { movingActionMayProvoke, reactiveStrikeKnown } from "../scoring/rk-warnings.js";

// The enemy's turn: where does this plan leave you? Each enemy that can reach you at the end of the
// turn (its melee reach, 5 ft by default) will likely attack. Plans are compared on the *change*
// against where you start, so a plan that doesn't move is unaffected, walking into a crowd costs,
// and stepping out of reach is worth something. Low HP and a cautious temperament weigh it more.

const POINTS_PER_THREAT = 6;
const TEMPERAMENT_FACTOR = { cautious: 1.5, coward: 2, opportunist: 1, aggressive: 0.6, berserker: 0.3 };

function threatsAt(context) {
  return contextEnemies(context).filter((enemy) => {
    const distance = Number(enemy?.distance);
    if (!Number.isFinite(distance)) return false;
    if (enemy?.hpPercent === 0) return false;
    const conditions = enemy?.conditions?.slugs ?? [];
    if (["unconscious", "paralyzed", "petrified", "stunned"].some((slug) => conditions.includes(slug))) return false;
    const reach = Number(enemy?.meleeReach ?? enemy?.reach ?? 5) || 5;
    return distance <= reach;
  }).length;
}

function hpPercent(context) {
  const value = Number(entityHpPercent(context?.profile ?? context?.actor?.profile ?? {}));
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

// The turn-start board is the same for every plan in a search.
const beforeCache = new WeakMap();

export function planEndState(context, initialState, steps) {
  let state = initialState;
  for (const step of steps ?? []) state = advancePlanState(context, state, step);
  return state;
}

// Striding away from (or past) an enemy with Reactive Strike gives it a free attack: count each
// Stride that starts inside such an enemy's reach. A Step doesn't provoke.
function reactiveStrikesProvoked(context, initialState, steps) {
  if (!steps.some(movingActionMayProvoke)) return 0;
  let state = initialState;
  let provoked = 0;
  for (const step of steps) {
    if (movingActionMayProvoke(step)) {
      provoked += contextEnemies(projectContextFromPlanState(context, state)).filter((enemy) => {
        const distance = Number(enemy?.distance);
        const reach = Number(enemy?.meleeReach ?? enemy?.reach ?? 5) || 5;
        return Number.isFinite(distance) && distance <= reach && enemy?.hpPercent !== 0 && reactiveStrikeKnown(context, enemy);
      }).length;
    }
    state = advancePlanState(context, state, step);
  }
  return provoked;
}

export function endPositionDanger(context, initialState, steps, temperament = "auto", endState = null) {
  if (!initialState || !Array.isArray(steps) || !steps.length) return { delta: 0, scoreDelta: 0 };
  const state = endState ?? planEndState(context, initialState, steps);
  if (!state.positionChanged && !(state.approaches?.size > 0)) return { delta: 0, scoreDelta: 0 };
  if (!beforeCache.has(initialState)) beforeCache.set(initialState, threatsAt(projectContextFromPlanState(context, initialState)));
  const before = beforeCache.get(initialState);
  const after = threatsAt(projectContextFromPlanState(context, state));
  const delta = after - before;
  const provoked = reactiveStrikesProvoked(context, initialState, steps);
  if (!delta && !provoked) return { delta: 0, scoreDelta: 0, before, after };
  const weight = POINTS_PER_THREAT * (1 + 2 * (1 - hpPercent(context))) * (TEMPERAMENT_FACTOR[temperament] ?? 1);
  return { delta, before, after, provoked, scoreDelta: -Math.round((delta + provoked) * weight) };
}
