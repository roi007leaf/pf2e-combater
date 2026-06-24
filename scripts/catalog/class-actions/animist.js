export const ANIMIST_ACTIONS = [
  {
    slug: 'circle-of-spirits',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      aura: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'grudge-strike',
    role: 'damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'apparitions-enhancement',
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
  {
    slug: 'apparitions-quickening',
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
  {
    slug: 'apparitions-reflection',
    role: 'defense',
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
