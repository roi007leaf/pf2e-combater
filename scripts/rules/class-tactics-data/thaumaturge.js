export const THAUMATURGE_CLASS_TACTIC = {
    label: "Thaumaturge",
    classAction: 10,
    meleeStrike: 6,
    rangedStrike: 6,
    roles: { setup: 14, damage: 6, debuff: 8, control: 6 },
    signatureActions: {
      "exploit-vulnerability": 34,
      "intensify-vulnerability": 28,
      "drink-from-the-chalice": 24,
      "fling-magic": 22,
      "twin-weakness": 24,
      "recall-knowledge": 8,
    },
  };

export const THAUMATURGE_SUBCLASS_TACTICS = {
  "amulet": {
    "label": "Amulet",
    "classSlug": "thaumaturge",
    "roles": {
      "defense": 14,
      "buff": 8
    },
    "reason": "Amulet implement favors protective reactions and defense."
  },
  "bell": {
    "label": "Bell",
    "classSlug": "thaumaturge",
    "roles": {
      "debuff": 12,
      "control": 10
    },
    "reason": "Bell implement favors reaction debuffs and control."
  },
  "chalice": {
    "label": "Chalice",
    "classSlug": "thaumaturge",
    "actions": {
      "drink-from-the-chalice": 18
    },
    "roles": {
      "healing": 14,
      "buff": 8
    },
    "reason": "Chalice implement favors healing and sustain."
  },
  "lantern": {
    "label": "Lantern",
    "classSlug": "thaumaturge",
    "actions": {
      "seek": 14,
      "recall-knowledge": 8
    },
    "roles": {
      "setup": 12,
      "control": 6
    },
    "reason": "Lantern implement favors Seek and awareness setup."
  },
  "mirror": {
    "label": "Mirror",
    "classSlug": "thaumaturge",
    "roles": {
      "mobility": 12,
      "control": 8,
      "setup": 6
    },
    "reason": "Mirror implement favors repositioning and control."
  },
  "regalia": {
    "label": "Regalia",
    "classSlug": "thaumaturge",
    "actions": {
      "demoralize": 10
    },
    "roles": {
      "buff": 10,
      "debuff": 10,
      "defense": 6
    },
    "reason": "Regalia implement favors aura support and intimidation."
  },
  "shield": {
    "label": "Shield",
    "classSlug": "thaumaturge",
    "actions": {
      "raise-a-shield": 16
    },
    "roles": {
      "defense": 14,
      "control": 6
    },
    "reason": "Shield implement favors defensive turns."
  },
  "tome": {
    "label": "Tome",
    "classSlug": "thaumaturge",
    "actions": {
      "recall-knowledge": 16,
      "exploit-vulnerability": 8
    },
    "roles": {
      "setup": 14,
      "buff": 6
    },
    "reason": "Tome implement favors knowledge setup before exploiting."
  },
  "wand": {
    "label": "Wand",
    "classSlug": "thaumaturge",
    "actions": {
      "fling-magic": 18
    },
    "roles": {
      "damage": 10,
      "save-damage": 8
    },
    "reason": "Wand implement favors Fling Magic damage."
  },
  "weapon": {
    "label": "Weapon",
    "classSlug": "thaumaturge",
    "includesStrike": 12,
    "roles": {
      "damage": 12,
      "control": 6
    },
    "reason": "Weapon implement favors Strike payoffs after Exploit Vulnerability."
  }
};
