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
      // "Target one enemy within 30 feet."
      maxRange: 30,
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
