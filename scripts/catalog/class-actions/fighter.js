export const FIGHTER_ACTIONS = [
  {
    slug: 'power-attack',
    role: 'damage',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      focusedStrike: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'vicious-swing',
    role: 'damage',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      focusedStrike: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'intimidating-strike',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'setup'],
      includesStrike: true,
      appliesCondition: 'frightened',
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'knockdown',
    role: 'control',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'control'],
      includesStrike: true,
      appliesCondition: 'prone',
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'snagging-strike',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'setup'],
      includesStrike: true,
      appliesCondition: 'off-guard',
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
];
