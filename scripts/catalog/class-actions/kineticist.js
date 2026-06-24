export const KINETICIST_ACTIONS = [
  {
    slug: 'channel-elements',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      impulse: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['elemental-blast', 'impulse'],
  },
  {
    slug: 'extract-element',
    role: 'save-damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['damage'],
      impulse: true,
    },
    targetingProfile: {
      enemy: true,
      maxRange: 30,
    },
  },
  {
    slug: 'base-kinesis',
    role: 'control',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['control'],
      impulse: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'weapon-infusion',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      impulse: true,
      nextAction: 'elemental-blast',
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['elemental-blast'],
  },
  {
    slug: 'two-element-infusion',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      impulse: true,
      nextAction: 'elemental-blast',
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['elemental-blast'],
  },
];
