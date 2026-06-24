export const SUMMONER_ACTIONS = [
  {
    slug: 'manifest-eidolon',
    role: 'summon',
    activityProfile: {
      includes: ['summon'],
      manifestsCompanion: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['act-together', 'tandem-strike', 'tandem-movement'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'act-together',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      tandem: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['strike', 'spell', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'tandem-strike',
    role: 'multiattack',
    activityProfile: {
      includes: ['strike', 'strike'],
      includesStrike: true,
      multiStrike: true,
      tandem: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'tandem-movement',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride'],
      tandem: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'transpose',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride'],
      tandem: true,
    },
    targetingProfile: {
      self: true,
    },
  },
  {
    slug: 'defend-summoner',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      tandem: true,
    },
    targetingProfile: {
      self: true,
    },
  },
];
