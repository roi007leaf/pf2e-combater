export const BARBARIAN_ACTIONS = [
  {
    slug: 'sudden-charge',
    role: 'mobility-attack',
    activityProfile: {
      includes: ['stride', 'stride', 'strike'],
      strideCount: 2,
      includesStrike: true,
      requiresBackingStrike: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'rage',
    role: 'combat-buff',
    setupFor: ['strike', 'mobility-attack'],
    executable: 'open-item',
    confidence: 'high',
  },
];
