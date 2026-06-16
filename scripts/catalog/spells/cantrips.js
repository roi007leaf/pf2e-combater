export const CANTRIP_TACTICS = [
  {
    slug: "electric-arc",
    role: "damage",
    save: "reflex",
    targetModel: "two-enemies",
    damageTypes: ["electricity"],
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "ray-of-frost",
    role: "damage",
    attack: true,
    targetModel: "single-enemy",
    damageTypes: ["cold"],
    executable: "open-item",
    confidence: "medium",
  },
  {
    slug: "shield",
    role: "defense",
    targetModel: "self",
    executable: "open-item",
    confidence: "high",
  },
];

export const CANTRIPS = CANTRIP_TACTICS;
