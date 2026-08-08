export const COMMON_ACTIONS = [
  {
    slug: 'battle-medicine',
    role: 'healing',
    targetingProfile: {
      ally: true,
      self: true,
      reach: true,
    },
    activityProfile: {
      requiresFreeHand: true,
    },
    executable: 'pf2e-action',
    confidence: 'high',
  },
  {
    slug: 'bon-mot',
    role: 'debuff',
    targetingProfile: {
      enemy: true,
      maxRange: 30,
    },
    executable: 'pf2e-action',
    confidence: 'high',
  },
];
