// Shared, cross-cutting scoring/planning constants. These were previously duplicated
// independently across scoring.js, scoring/gates.js, scoring/tactics.js, and planner.js -- each
// file defining or inlining the same value with no shared source, so changing one meant hunting
// for the others by grep rather than by import.

// A candidate scored at or below this is never legal for the planner to pick. Every kind of hard
// rejection (missing required skill training, a hard scoring gate, a blocked-candidate result)
// uses this same sentinel so `candidate.score > HARD_BLOCK_SCORE` reliably excludes all of them.
export const HARD_BLOCK_SCORE = -999;

// PF2e's Multiple Attack Penalty, per attack index within a turn (0 = first attack, no penalty).
export const MAP_PENALTY_BY_ATTACK_INDEX = Object.freeze({
  1: { standard: 5, agile: 4 },
  2: { standard: 10, agile: 8 },
});

const MAP_SCORE_WEIGHT = 3;

// Second attacks (MAP -4/-5) cost a flat 3 points per point of penalty -- tuned against the attack
// scores. A third attack (-8/-10) is a different animal: ~5% less to hit per point leaves it near
// 15-25%, so it loses that share of its value and a heavily-buffed Strike can't shrug it off.
export function mapScoreCost(candidate, penalty) {
  if (!(penalty > 0)) return 0;
  if (penalty < 8) return penalty * MAP_SCORE_WEIGHT;
  const attackValue = Math.max(0, (Number(candidate?.score) || 0) - 46);
  return Math.round(Math.max(penalty * MAP_SCORE_WEIGHT, attackValue * Math.min(0.9, penalty * 0.05 / 0.6)));
}
