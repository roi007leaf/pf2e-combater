export const INVENTOR_ACTIONS = [
  {
    slug: 'overdrive',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      damageBuff: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'explode',
    role: 'area-damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['damage'],
      area: true,
    },
    targetingProfile: {
      enemy: true,
      type: 'emanation',
    },
  },
  {
    slug: 'unstable-function',
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
    slug: 'searing-restoration',
    role: 'healing',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['healing'],
      unstable: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
];
