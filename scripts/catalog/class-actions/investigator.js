export const INVESTIGATOR_ACTIONS = [
  {
    slug: 'devise-a-stratagem',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      targetMark: 'devised-stratagem',
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'clue-in',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      reaction: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
  {
    slug: 'quick-tincture',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      createsConsumable: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['healing', 'buff', 'damage'],
  },
  {
    slug: 'pointed-question',
    role: 'debuff',
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
