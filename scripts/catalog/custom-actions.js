export const CUSTOM_ACTION_TACTICS = [
  {
    slug: "sudden-charge",
    role: "mobility-attack",
    activityProfile: {
      includes: ["stride", "stride", "strike"],
      strideCount: 2,
      includesStrike: true,
    },
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "rage",
    role: "combat-buff",
    setupFor: ["strike", "mobility-attack"],
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "battle-medicine",
    role: "healing",
    executable: "pf2e-action",
    confidence: "high",
  },
  {
    slug: "bon-mot",
    role: "debuff",
    executable: "pf2e-action",
    confidence: "high",
  },
  {
    slug: "power-attack",
    role: "damage",
    activityProfile: {
      includes: ["strike"],
      includesStrike: true,
      focusedStrike: true,
    },
    executable: "open-item",
    confidence: "high",
  },
  {
    slug: "vicious-swing",
    role: "damage",
    activityProfile: {
      includes: ["strike"],
      includesStrike: true,
      focusedStrike: true,
    },
    executable: "open-item",
    confidence: "high",
  },
];

export function findCustomActionTactics(slug) {
  return CUSTOM_ACTION_TACTICS.find((entry) => entry.slug === slug) ?? null;
}

export const CUSTOM_ACTIONS = CUSTOM_ACTION_TACTICS;
export const findCustomAction = findCustomActionTactics;
