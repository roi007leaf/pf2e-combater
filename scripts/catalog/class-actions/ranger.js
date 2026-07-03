export const RANGER_ACTIONS = [
  {
    slug: 'hunt-prey',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'hunted-prey',
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'hunted-shot',
    role: 'multiattack',
    activityProfile: {
      includes: ['strike', 'strike'],
      includesStrike: true,
      multiStrike: true,
      requiresBackingStrike: true,
      backingStrikeFilter: 'ranged-reload-zero',
      mapAppliesPerStrike: true,
    },
    targetingProfile: {
      enemy: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'twin-takedown',
    role: 'multiattack',
    activityProfile: {
      includes: ['strike', 'strike'],
      includesStrike: true,
      multiStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'hunters-aim',
    role: 'damage',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      focusedStrike: true,
    },
    targetingProfile: {
      enemy: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
];
