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
