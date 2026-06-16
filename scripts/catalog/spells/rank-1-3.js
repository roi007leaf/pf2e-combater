export const RANK_1_TO_3_SPELL_TACTICS = [
  {
    slug: "heal",
    role: "healing",
    targetModel: "single-ally",
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "fear",
    role: "debuff",
    save: "will",
    targetModel: "single-enemy",
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "magic-missile",
    role: "damage",
    variableActionCost: true,
    targetModel: "single-enemy",
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "fireball",
    role: "area-damage",
    save: "reflex",
    targetModel: "area",
    damageTypes: ["fire"],
    friendlyFireRisk: true,
    executable: "open-item",
    confidence: "medium",
  },
];

export const RANK_1_TO_3_SPELLS = RANK_1_TO_3_SPELL_TACTICS;
