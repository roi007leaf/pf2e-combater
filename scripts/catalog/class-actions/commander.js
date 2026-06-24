export const COMMANDER_ACTIONS = [
  {
    slug: 'strike-hard',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff', 'strike'],
      ally: true,
      includesStrike: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'pincer-attack',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff', 'stride', 'strike'],
      ally: true,
      includesStrike: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'ready-aim-fire',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff', 'strike'],
      ally: true,
      includesStrike: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'shields-up',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
  {
    slug: 'gather-to-me',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'coordinating-maneuvers',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'take-the-high-ground',
    role: 'mobility',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['stride'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'seek-and-destroy',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff', 'strike'],
      ally: true,
      includesStrike: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'for-talamandor-for-freedom',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
];
