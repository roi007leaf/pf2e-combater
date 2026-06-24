import { CASTER_ROLES } from "./roles.js";

export const ORACLE_CLASS_TACTIC = {
    label: "Oracle",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, debuff: 10, control: 8 },
    signatureActions: {
      "foretell-harm": 20,
      "nudge-the-scales": 20,
      "whispers-of-weakness": 22,
      "debilitating-dichotomy": 20,
      "glean-lore": 16,
    },
  };

export const ORACLE_SUBCLASS_TACTICS = {
  "battle": {
    "classSlug": "oracle",
    "meleeStrike": 8,
    "roles": {
      "damage": 8,
      "defense": 8,
      "healing": 6
    },
    "reason": "Battle mystery favors weapon pressure backed by revelation magic.",
    "label": "Battle"
  },
  "life": {
    "classSlug": "oracle",
    "roles": {
      "healing": 16,
      "buff": 8,
      "defense": 6
    },
    "reason": "Life mystery favors healing and protection.",
    "label": "Life"
  },
  "flames": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "traits": {
      "fire": 6,
      "electricity": 6,
      "cold": 6
    },
    "reason": "Mystery favors elemental spell pressure.",
    "label": "Flames"
  },
  "ashes": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "traits": {
      "fire": 6,
      "electricity": 6,
      "cold": 6
    },
    "reason": "Mystery favors elemental spell pressure.",
    "label": "Ashes"
  },
  "tempest": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "traits": {
      "fire": 6,
      "electricity": 6,
      "cold": 6
    },
    "reason": "Mystery favors elemental spell pressure.",
    "label": "Tempest"
  },
  "cosmos": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Mystery favors revelation control and setup.",
    "label": "Cosmos"
  },
  "time": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Mystery favors revelation control and setup.",
    "label": "Time"
  },
  "lore": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Mystery favors revelation control and setup.",
    "label": "Lore"
  },
  "ancestors": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Mystery favors revelation control and setup.",
    "label": "Ancestors"
  },
  "blight": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "damage": 6
    },
    "reason": "Mystery favors debilitating revelation magic.",
    "label": "Blight"
  },
  "bones": {
    "classSlug": "oracle",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "damage": 6
    },
    "reason": "Mystery favors debilitating revelation magic.",
    "label": "Bones"
  }
};
