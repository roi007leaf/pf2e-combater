export const GUARDIAN_ACTIONS = [
  {
    slug: 'taunt',
    role: 'debuff',
    activityProfile: {
      includes: ['debuff'],
      targetMark: 'taunted',
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['defense', 'control'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'intercept-attack',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      reaction: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
];
