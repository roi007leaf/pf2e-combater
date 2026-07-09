import { CANTRIPS } from "./cantrips.js";
import { RANK_1_TO_3_SPELLS } from "./rank-1-3.js";
import { REVIEWED_SPELLS } from "./review-overrides.js";
import { UTILITY_SPELLS } from "./utility.js";

const SPELL_TACTICS = [...CANTRIPS, ...RANK_1_TO_3_SPELLS, ...UTILITY_SPELLS, ...REVIEWED_SPELLS];

export function findSpellTactics(slug) {
  return SPELL_TACTICS.find((spell) => spell.slug === slug) ?? null;
}

export function allSpellTactics() {
  return [...SPELL_TACTICS];
}

export const findCuratedSpell = findSpellTactics;
export const allCuratedSpells = allSpellTactics;
