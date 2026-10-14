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
    // Moves an unattended object: nothing it does touches a creature, so Auto-fill leaves it to Browse.
    slug: 'base-kinesis',
    role: 'utility',
    combatUse: 'browse-only',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['utility'],
      impulse: true,
    },
    targetingProfile: {
      self: true,
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
