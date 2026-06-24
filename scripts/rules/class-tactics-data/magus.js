export const MAGUS_CLASS_TACTIC = {
    label: "Magus",
    classAction: 8,
    spell: 4,
    meleeStrike: 14,
    rangedStrike: 10,
    includesStrike: 14,
    roles: { damage: 8, "mobility-attack": 10, setup: 8, "resource-recovery": 14 },
    signatureActions: {
      spellstrike: 34,
      "arcane-cascade": 26,
      "recharge-spellstrike": 22,
      "dimensional-assault": 20,
    },
  };

export const MAGUS_SUBCLASS_TACTICS = {
  "aloof-firmament": {
    "label": "Aloof Firmament",
    "classSlug": "magus",
    "roles": {
      "mobility": 10,
      "mobility-attack": 10,
      "damage": 8
    },
    "reason": "Hybrid study favors mobile Spellstrike lines."
  },
  "inexorable-iron": {
    "label": "Inexorable Iron",
    "classSlug": "magus",
    "meleeStrike": 12,
    "roles": {
      "damage": 10,
      "defense": 8
    },
    "reason": "Inexorable Iron favors heavy melee Spellstrike."
  },
  "laughing-shadow": {
    "label": "Laughing Shadow",
    "classSlug": "magus",
    "actions": {
      "dimensional-assault": 18
    },
    "roles": {
      "mobility": 12,
      "mobility-attack": 10,
      "damage": 8
    },
    "reason": "Laughing Shadow favors mobility before Spellstrike."
  },
  "resurgent-maelstrom": {
    "label": "Resurgent Maelstrom",
    "classSlug": "magus",
    "spell": 8,
    "roles": {
      "control": 10,
      "area-damage": 8,
      "damage": 8
    },
    "reason": "Resurgent Maelstrom favors spell pressure and control."
  },
  "sparkling-targe": {
    "label": "Sparkling Targe",
    "classSlug": "magus",
    "actions": {
      "raise-a-shield": 16,
      "shielding-strike": 18
    },
    "roles": {
      "defense": 14,
      "damage": 8
    },
    "reason": "Sparkling Targe favors shielded Spellstrike turns."
  },
  "starlit-span": {
    "label": "Starlit Span",
    "classSlug": "magus",
    "rangedStrike": 14,
    "roles": {
      "damage": 10,
      "mobility-attack": 6
    },
    "reason": "Starlit Span favors ranged Spellstrike lines."
  },
  "twisting-tree": {
    "label": "Twisting Tree",
    "classSlug": "magus",
    "traits": {
      "staff": 14,
      "parry": 6,
      "trip": 6
    },
    "meleeStrike": 10,
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Twisting Tree favors staff control and melee Spellstrike."
  },
  "unfurling-brocade": {
    "label": "Unfurling Brocade",
    "classSlug": "magus",
    "spell": 8,
    "roles": {
      "control": 10,
      "buff": 8,
      "damage": 6
    },
    "reason": "Unfurling Brocade favors spell control and setup."
  }
};
