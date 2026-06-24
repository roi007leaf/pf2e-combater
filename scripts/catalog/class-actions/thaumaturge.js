export const THAUMATURGE_ACTIONS = [
  {
    slug: 'exploit-vulnerability',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'exploited-vulnerability',
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['strike', 'damage', 'intensify-vulnerability'],
  },
  {
    slug: 'intensify-vulnerability',
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
    slug: 'drink-from-the-chalice',
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
    slug: 'fling-magic',
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
    slug: 'twin-weakness',
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
];
