export const DRUID_ACTIONS = [
  {
    slug: 'wild-shape',
    role: 'transformation',
    activityProfile: {
      includes: ['transformation'],
      polymorph: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'floral-restoration',
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
    slug: 'form-control',
    role: 'transformation',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'overwhelming-energy',
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
];
