export const CLERIC_ACTIONS = [
  {
    slug: 'channel-smite',
    role: 'damage',
    activityProfile: {
      includes: ['spell', 'strike'],
      includesStrike: true,
      focusedStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
];
