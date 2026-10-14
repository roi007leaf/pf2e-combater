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
// Casters and supports have the AC and HP of the back line, and ranged options to fight from there.
const BACK_LINE_ROLES = new Set(["spell-damage", "artillery", "healer", "buffer", "debuffer", "support"]);
const BACK_LINE_FACTOR = 1.6;

// Below a quarter HP the next hit may drop you: staying in reach costs far more than an attack gains.
function lowHpFactor(hp) {
  if (hp >= 0.25) return 1;
  return 1 + 5 * ((0.25 - hp) / 0.25);
}

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

export function endPositionDanger(context, initialState, steps, temperament = "auto", endState = null, role = null) {
  if (!initialState || !Array.isArray(steps) || !steps.length) return { delta: 0, scoreDelta: 0 };
  const state = endState ?? planEndState(context, initialState, steps);
  if (!state.positionChanged && !(state.approaches?.size > 0)) return { delta: 0, scoreDelta: 0 };
  if (!beforeCache.has(initialState)) beforeCache.set(initialState, threatsAt(projectContextFromPlanState(context, initialState)));
  const before = beforeCache.get(initialState);
  const after = threatsAt(projectContextFromPlanState(context, state));
  const delta = after - before;
  const provoked = reactiveStrikesProvoked(context, initialState, steps);
  if (!delta && !provoked) return { delta: 0, scoreDelta: 0, before, after };
  const hp = hpPercent(context);
  // Near death, a PC (or a cautious NPC) gets out; most monsters fight on.
  const flees = context?.actor?.document?.type === "character" || context?.profile?.actorType === "character"
    || ["cautious", "coward"].includes(temperament);
  const weight = POINTS_PER_THREAT * (1 + 2 * (1 - hp)) * (flees ? lowHpFactor(hp) : 1)
    * (TEMPERAMENT_FACTOR[temperament] ?? 1) * (BACK_LINE_ROLES.has(role) ? BACK_LINE_FACTOR : 1);
  return { delta, before, after, provoked, scoreDelta: -Math.round((delta + provoked) * weight) };
}

// Near death, what matters is not the change but the absolute exposure: every enemy that can reach
// you where the plan ends may drop you, unless the plan heals you back out of that range first.
// Only for those who would flee (PCs, cautious or cowardly NPCs); most monsters fight on.
const NEAR_DEATH_HP = 0.25;
// At a sliver of HP the next hit ends your turns: that outweighs any attack this turn could make.
const POINTS_PER_EXPOSED_THREAT = 200;
const MAX_NEAR_DEATH_PENALTY = 320;

function selfHealing(context, steps) {
  const selfId = context?.token?.id ?? context?.actor?.token?.id ?? null;
  return steps.reduce((total, step) => {
    if (step?.role !== "healing") return total;
    const targetId = step?.suggestedTarget?.id ?? step?.preferredTarget?.id ?? null;
    const onSelf = !targetId || targetId === selfId || step?.suggestedTarget?.type === "self";
    if (!onSelf) return total;
    return total + (Number(step?.damageProfile?.average ?? step?.averageDamage) || 10);
  }, 0);
}

export function nearDeathExposure(context, initialState, steps, temperament = "auto", endState = null) {
  if (!initialState || !Array.isArray(steps) || !steps.length) return { scoreDelta: 0 };
  const hp = hpPercent(context);
  if (hp >= NEAR_DEATH_HP || hp <= 0) return { scoreDelta: 0 };
  const flees = context?.actor?.document?.type === "character" || context?.profile?.actorType === "character"
    || ["cautious", "coward"].includes(temperament);
  if (!flees) return { scoreDelta: 0 };
  const maxHp = Number(context?.actor?.document?.system?.attributes?.hp?.max ?? context?.profile?.hp?.max) || 0;
  const healed = maxHp > 0 ? selfHealing(context, steps) / maxHp : 0;
  const hpAfter = Math.min(1, hp + healed);
  if (hpAfter >= NEAR_DEATH_HP) return { scoreDelta: 0, hpAfter };
  const state = endState ?? planEndState(context, initialState, steps);
  const threats = threatsAt(projectContextFromPlanState(context, state));
  if (!threats) return { scoreDelta: 0, threats, hpAfter };
  const urgency = (NEAR_DEATH_HP - hpAfter) / NEAR_DEATH_HP;
  return { threats, hpAfter, scoreDelta: -Math.min(MAX_NEAR_DEATH_PENALTY, Math.round(threats * POINTS_PER_EXPOSED_THREAT * urgency)) };
}

// Defenders (champions, guardians, Defender-role creatures) protect by position: their reactions
// (Retributive Strike, Intercept Strike, Taunt) need them near the threatened ally and in reach of
// the attacker. Count the threatened allies a position covers; plans are compared on the change.
const DEFENDER_CLASSES = new Set(["champion", "guardian"]);
const COVER_RANGE_FEET = 15;
const POINTS_PER_COVERED_ALLY = 80;
const BACK_LINE_CLASSES = new Set(["wizard", "sorcerer", "witch", "psychic", "bard", "cleric", "druid", "oracle", "summoner", "animist", "necromancer"]);

// A caster in melee or an ally already hurt is the one a defender is for.
function coverWeight(ally) {
  const classSlug = String(placeable(ally)?.actor?.class?.slug ?? "").toLowerCase();
  const hp = Number(ally?.hpPercent);
  return (BACK_LINE_CLASSES.has(classSlug) ? 1.5 : 1) * (hp < 0.5 ? 1.5 : hp < 0.75 ? 1.25 : 1);
}

function isDefender(context, role) {
  if (role === "defender") return true;
  const actor = context?.actor?.document;
  return DEFENDER_CLASSES.has(String(actor?.class?.slug ?? "").toLowerCase());
}

// Context entries carry token summaries; the canvas token (by id) knows its footprint and distances.
function placeable(entity) {
  return globalThis.canvas?.tokens?.get?.(entity?.id) ?? (typeof entity?.token?.distanceTo === "function" ? entity.token : null);
}

function tokenDistance(left, right) {
  try {
    const value = placeable(left)?.distanceTo?.(placeable(right));
    return Number.isFinite(value) ? value : Infinity;
  } catch (_error) {
    return Infinity;
  }
}

function coveredAllies(projected) {
  const selfId = projected?.token?.id ?? null;
  const reach = Number(projected?.profile?.reach ?? projected?.actor?.profile?.reach) || 5;
  const enemies = contextEnemies(projected).filter((enemy) => enemy?.hpPercent !== 0);
  let covered = 0;
  for (const ally of projected?.battlefield?.allies ?? []) {
    if (!ally || ally.id === selfId || ally.hpPercent === 0 || !(Number(ally.distance) <= COVER_RANGE_FEET)) continue;
    const attackers = enemies.filter((enemy) => tokenDistance(enemy, ally) <= (Number(enemy?.meleeReach ?? enemy?.reach) || 5));
    if (!attackers.some((enemy) => Number(enemy?.distance) <= reach)) continue;
    covered += coverWeight(ally);
  }
  return covered;
}

const coverBeforeCache = new WeakMap();
export function defenderCoverage(context, initialState, steps, role = null, endState = null) {
  if (!initialState || !Array.isArray(steps) || !steps.length || !isDefender(context, role)) return { scoreDelta: 0 };
  const state = endState ?? planEndState(context, initialState, steps);
  if (!state.positionChanged) return { scoreDelta: 0 };
  if (!coverBeforeCache.has(initialState)) coverBeforeCache.set(initialState, coveredAllies(projectContextFromPlanState(context, initialState)));
  const before = coverBeforeCache.get(initialState);
  const after = coveredAllies(projectContextFromPlanState(context, state));
  return { before, after, scoreDelta: Math.round((after - before) * POINTS_PER_COVERED_ALLY) };
}
