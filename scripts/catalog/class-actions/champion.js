export const CHAMPION_ACTIONS = [
  {
    slug: 'lay-on-hands',
    role: 'healing',
    activityProfile: {
      includes: ['healing'],
      focus: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'smite',
    role: 'setup',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['setup'],
      damageBuff: true,
    },
    targetingProfile: {
      enemy: true,
    },
    setupFor: ['strike', 'damage'],
  },
  {
    slug: 'retributive-strike',
    role: 'reaction-attack',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['strike'],
      includesStrike: true,
      reaction: true,
    },
    targetingProfile: {
      enemy: true,
      reach: true,
    },
  },
  {
    slug: 'glimpse-of-redemption',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      reaction: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'liberating-step',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense', 'stride'],
      reaction: true,
    },
    targetingProfile: {
      ally: true,
    },
  },
  {
    slug: 'iron-command',
    role: 'control',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['control'],
      reaction: true,
    },
    targetingProfile: {
      enemy: true,
    },
  },
];
