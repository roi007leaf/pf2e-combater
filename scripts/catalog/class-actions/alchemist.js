export const ALCHEMIST_ACTIONS = [
  {
    slug: 'quick-alchemy',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      createsConsumable: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['damage', 'healing', 'debuff', 'control'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'quick-bomber',
    role: 'damage',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      bomb: true,
      ranged: true,
    },
    targetingProfile: {
      enemy: true,
      maxRange: 20,
    },
    executable: 'open-item',
    confidence: 'high',
  },
];
