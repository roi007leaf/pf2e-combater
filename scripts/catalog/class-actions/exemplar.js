export const EXEMPLAR_ACTIONS = [
  {
    slug: 'shift-immanence',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'spark-transcendence',
    role: 'damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['damage'],
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'victors-wreath',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
];
