export const MONK_ACTIONS = [
  {
    slug: 'flurry-of-blows',
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
    slug: 'stunning-fist',
    role: 'control',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'control'],
      includesStrike: true,
      appliesCondition: 'stunned',
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'ki-strike',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      damageBuff: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['strike', 'damage'],
  },
  {
    slug: 'flying-kick',
    role: 'mobility-attack',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride', 'strike'],
      includesStrike: true,
      requiresBackingStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'mixed-maneuver',
    role: 'control',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['control', 'control'],
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
];
