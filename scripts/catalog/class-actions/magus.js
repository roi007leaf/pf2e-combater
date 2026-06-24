export const MAGUS_ACTIONS = [
  {
    slug: 'spellstrike',
    role: 'damage',
    activityProfile: {
      includes: ['spell', 'strike'],
      includesStrike: true,
      focusedStrike: true,
      spellstrike: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'recharge-spellstrike',
    role: 'resource-recovery',
    activityProfile: {
      includes: ['resource'],
      rechargeSpellstrike: true,
    },
    executable: 'open-item',
    confidence: 'high',
  },
  {
    slug: 'arcane-cascade',
    role: 'setup',
    activityProfile: {
      includes: ['setup'],
      stance: true,
    },
    setupFor: ['strike', 'damage', 'spellstrike'],
    executable: 'open-item',
    confidence: 'high',
  },
];
