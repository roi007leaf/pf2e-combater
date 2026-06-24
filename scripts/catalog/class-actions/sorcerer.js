export const SORCERER_ACTIONS = [
  {
    slug: 'bloodline-conduit',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      spellBuff: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['spell', 'damage'],
  },
  {
    slug: 'energy-fusion',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      spellBuff: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['spell', 'damage'],
  },
  {
    slug: 'dangerous-sorcery',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      spellBuff: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'counterspell-spontaneous',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      reaction: true,
    },
    targetingProfile: {
      self: true,
    },
  },
];
