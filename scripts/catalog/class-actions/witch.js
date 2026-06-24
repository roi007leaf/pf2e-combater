export const WITCH_ACTIONS = [
  {
    slug: 'cast-hex',
    role: 'debuff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['debuff'],
      spell: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'split-hex',
    role: 'debuff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['debuff'],
      spell: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'sympathetic-strike',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'setup'],
      includesStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'familiar-of-flowing-script',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
    },
    targetingProfile: {
      self: true,
    },
  },
];
