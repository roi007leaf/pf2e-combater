export const PSYCHIC_ACTIONS = [
  {
    slug: 'unleash-psyche',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      spellBuff: true,
      damageBuff: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['spell', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'psi-burst',
    role: 'damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['damage'],
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'restore-the-mind',
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
    slug: 'calculate-threats',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'recall-the-teachings',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup', 'recall-knowledge'],
    },
    targetingProfile: {
      self: true,
    },
  },
];
