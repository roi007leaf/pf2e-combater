export const ROGUE_ACTIONS = [
  {
    slug: 'confident-finisher',
    role: 'damage',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      focusedStrike: true,
      finisher: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'debilitating-strike',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'setup'],
      includesStrike: true,
      appliesCondition: 'debilitated',
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'twin-feint',
    role: 'multiattack',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'strike', 'setup'],
      includesStrike: true,
      multiStrike: true,
      requiresBackingStrike: true,
      requiresDualBackingStrike: true,
      mapAppliesPerStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'poison-weapon',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      poison: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['strike', 'damage'],
  },
  {
    slug: 'analyze-weakness',
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
];
