export const RUNESMITH_ACTIONS = [
  {
    slug: 'trace-rune',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'traced-rune',
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['invoke-rune', 'damage', 'control'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'invoke-rune',
    role: 'damage',
    activityProfile: {
      includes: ['damage'],
      invokesRune: true,
    },
    targetingProfile: {
      enemy: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'etched-rune',
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
