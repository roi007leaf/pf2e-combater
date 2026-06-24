export const INVENTOR_CLASS_TACTIC = {
    label: "Inventor",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 6,
    roles: { damage: 8, setup: 8, transformation: 10, control: 6, defense: 4 },
    signatureActions: {
      overdrive: 30,
      explode: 24,
      "unstable-function": 18,
      "searing-restoration": 18,
    },
  };

export const INVENTOR_SUBCLASS_TACTICS = {
  "armor-innovation": {
    "label": "Armor innovation",
    "classSlug": "inventor",
    "roles": {
      "defense": 12,
      "mobility": 8,
      "damage": 6
    },
    "reason": "Armor innovation favors defensive positioning and Overdrive attacks."
  },
  "construct-innovation": {
    "label": "Construct innovation",
    "classSlug": "inventor",
    "roles": {
      "summon": 12,
      "buff": 8,
      "mobility-attack": 8
    },
    "reason": "Construct innovation favors companion coordination."
  },
  "light-mortar-innovation": {
    "label": "Light mortar innovation",
    "classSlug": "inventor",
    "rangedStrike": 12,
    "roles": {
      "area-damage": 10,
      "damage": 10
    },
    "reason": "Light mortar innovation favors ranged explosive pressure."
  },
  "weapon-innovation": {
    "label": "Weapon innovation",
    "classSlug": "inventor",
    "includesStrike": 10,
    "roles": {
      "damage": 10,
      "control": 6
    },
    "reason": "Weapon innovation favors upgraded Strike payoffs."
  }
};
