export const KINETICIST_CLASS_TACTIC = {
    label: "Kineticist",
    classAction: 12,
    impulseAction: 18,
    meleeStrike: -8,
    roles: { damage: 10, "area-damage": 10, control: 10, defense: 8, buff: 6, mobility: 6 },
    signatureActions: {
      "channel-elements": 30,
      "elemental-blast": 28,
      "extract-element": 24,
      "base-kinesis": 14,
      "weapon-infusion": 20,
      "two-element-infusion": 18,
    },
  };

export const KINETICIST_SUBCLASS_TACTICS = {
  "air-gate": {
    "label": "Air gate",
    "classSlug": "kineticist",
    "traits": {
      "air": 14
    },
    "roles": {
      "mobility": 12,
      "control": 8,
      "damage": 6
    },
    "reason": "Air gate favors air impulses and movement."
  },
  "earth-gate": {
    "label": "Earth gate",
    "classSlug": "kineticist",
    "traits": {
      "earth": 14
    },
    "roles": {
      "defense": 12,
      "control": 8,
      "damage": 6
    },
    "reason": "Earth gate favors durable earth impulses."
  },
  "fire-gate": {
    "label": "Fire gate",
    "classSlug": "kineticist",
    "traits": {
      "fire": 14
    },
    "roles": {
      "damage": 12,
      "area-damage": 10
    },
    "reason": "Fire gate favors fire impulses and blasts."
  },
  "metal-gate": {
    "label": "Metal gate",
    "classSlug": "kineticist",
    "traits": {
      "metal": 14
    },
    "roles": {
      "damage": 8,
      "defense": 10,
      "control": 6
    },
    "reason": "Metal gate favors metal impulses and protection."
  },
  "water-gate": {
    "label": "Water gate",
    "classSlug": "kineticist",
    "traits": {
      "water": 14
    },
    "roles": {
      "healing": 10,
      "control": 10,
      "defense": 6
    },
    "reason": "Water gate favors water impulses and healing control."
  },
  "wood-gate": {
    "label": "Wood gate",
    "classSlug": "kineticist",
    "traits": {
      "wood": 14
    },
    "roles": {
      "healing": 10,
      "buff": 8,
      "control": 8
    },
    "reason": "Wood gate favors wood impulses and sustain."
  }
};
