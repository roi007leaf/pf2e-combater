export const BARD_ACTIONS = [
  {
    slug: 'lingering-composition',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      composition: true,
      // Its own rules text is forward-looking ("if your next action is to cast a cantrip
      // composition..."), unlike a plain setupFor pairing bonus which doesn't care about order --
      // this flag lets the planner require a cantrip composition immediately AFTER it, not just
      // somewhere in the plan.
      compositionExtender: true,
    },
    targetingProfile: {
      self: true,
    },
    setupFor: ['buff'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'courageous-anthem',
    role: 'buff',
    activityProfile: {
      includes: ['buff'],
      composition: true,
      ally: true,
      attackBuff: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
    setupFor: ['strike', 'damage'],
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'courageous-advance',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff', 'stride'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
    },
    setupFor: ['strike', 'mobility'],
  },
  {
    slug: 'courageous-assault',
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
    setupFor: ['strike', 'damage'],
  },
  {
    slug: 'courageous-onslaught',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      ally: true,
    },
    targetingProfile: {
      ally: true,
    },
    setupFor: ['multiattack'],
  },
  {
    slug: 'vigorous-anthem',
    role: 'buff',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['buff'],
      composition: true,
      tempHp: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
  {
    slug: 'counter-performance',
    role: 'defense',
    executable: 'open-item',
    confidence: 'high',
    activityProfile: {
      includes: ['defense'],
      reaction: true,
    },
    targetingProfile: {
      ally: true,
      self: true,
    },
  },
];
