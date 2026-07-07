export const UTILITY_SPELL_TACTICS = [
  {
    slug: "mage-hand",
    role: "exploration-utility",
    targetModel: "object",
    combatUse: "browse-only",
    executable: "open-item",
    confidence: "high",
    reasons: ["Object-only manipulation is useful to Browse, but not an Auto-fill combat plan."],
  },
  {
    slug: "telekinetic-hand",
    role: "exploration-utility",
    targetModel: "object",
    combatUse: "browse-only",
    executable: "open-item",
    confidence: "high",
    reasons: ["Object-only manipulation is useful to Browse, but not an Auto-fill combat plan."],
  },
];

export const UTILITY_SPELLS = UTILITY_SPELL_TACTICS;
