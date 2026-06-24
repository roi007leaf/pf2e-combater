export const SWASHBUCKLER_ACTIONS = [
  {
    slug: 'gain-panache',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      gainPanache: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'one-for-all',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      ally: true,
      gainPanache: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'vexing-tumble',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride', 'setup'],
      gainPanache: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
];
