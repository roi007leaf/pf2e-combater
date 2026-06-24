export const WIZARD_ACTIONS = [
  {
    slug: 'drain-bonded-item',
    role: 'resource-recovery',
    activityProfile: {
      includes: ['resource'],
      recoversSpellResource: true,
    },
    targetingProfile: {
      self: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'bond-conservation',
    role: 'resource-recovery',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['resource'],
      recoversSpellResource: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'spell-protection-array',
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
    slug: 'convincing-illusion',
    role: 'control',
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
