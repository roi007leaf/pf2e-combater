export const GUNSLINGER_ACTIONS = [
  {
    slug: 'covered-reload',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['reload', 'defense'],
      reload: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['ranged-strike', 'damage'],
  },
  {
    slug: 'raconteurs-reload',
    role: 'debuff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['reload', 'debuff'],
      reload: true,
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['ranged-strike', 'damage'],
  },
  {
    slug: 'reloading-strike',
    role: 'damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike', 'reload'],
      includesStrike: true,
      reload: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'thoughtful-reload',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['reload', 'setup'],
      reload: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
  {
    slug: 'finish-the-job',
    role: 'damage',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'ghost-shot',
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
    slug: 'vital-shot',
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
    slug: 'running-reload',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride', 'reload'],
      reload: true,
    },
    targetingProfile: {
      self: true,
    },
  },
];
