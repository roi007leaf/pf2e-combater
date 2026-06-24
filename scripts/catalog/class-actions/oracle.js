export const ORACLE_ACTIONS = [
  {
    slug: 'foretell-harm',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'nudge-the-scales',
    role: 'healing',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['healing'],
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
  {
    slug: 'whispers-of-weakness',
    role: 'debuff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'debilitating-dichotomy',
    role: 'save-damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['damage'],
    },
    targetingProfile: {
      enemy: true,
      maxRange: 60,
    },
  },
  {
    slug: 'glean-lore',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup', 'recall-knowledge'],
    },
    targetingProfile: {
      enemy: true,
    },
  },
];
