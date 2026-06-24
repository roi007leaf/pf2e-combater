import { CASTER_ROLES } from "./roles.js";

export const SORCERER_CLASS_TACTIC = {
    label: "Sorcerer",
    classAction: 6,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 10, "area-damage": 10, "save-damage": 10 },
    signatureActions: {
      "bloodline-conduit": 22,
      "energy-fusion": 20,
      "dangerous-sorcery": 18,
      "counterspell-spontaneous": 16,
    },
  };

export const SORCERER_SUBCLASS_TACTICS = {
  "bloodline-angelic": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6,
      "damage": 6
    },
    "reason": "Bloodline favors support spells and bloodline magic.",
    "label": "Bloodline Angelic"
  },
  "bloodline-phoenix": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6,
      "damage": 6
    },
    "reason": "Bloodline favors support spells and bloodline magic.",
    "label": "Bloodline Phoenix"
  },
  "bloodline-nymph": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6,
      "damage": 6
    },
    "reason": "Bloodline favors support spells and bloodline magic.",
    "label": "Bloodline Nymph"
  },
  "bloodline-wyrmblessed": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6,
      "damage": 6
    },
    "reason": "Bloodline favors support spells and bloodline magic.",
    "label": "Bloodline Wyrmblessed"
  },
  "bloodline-aberrant": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Bloodline favors control and debuff spells.",
    "label": "Bloodline Aberrant"
  },
  "bloodline-hag": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Bloodline favors control and debuff spells.",
    "label": "Bloodline Hag"
  },
  "bloodline-shadow": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Bloodline favors control and debuff spells.",
    "label": "Bloodline Shadow"
  },
  "bloodline-aesir": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Aesir"
  },
  "bloodline-demonic": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Demonic"
  },
  "bloodline-diabolic": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Diabolic"
  },
  "bloodline-draconic": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Draconic"
  },
  "bloodline-elemental": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Elemental"
  },
  "bloodline-genie": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8
    },
    "reason": "Bloodline favors offensive spell pressure.",
    "label": "Bloodline Genie"
  },
  "bloodline-fey": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 8,
      "damage": 8,
      "debuff": 8,
      "buff": 6
    },
    "reason": "Bloodline favors signature spellcasting over fallback attacks.",
    "label": "Bloodline Fey"
  },
  "bloodline-harrow": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 8,
      "damage": 8,
      "debuff": 8,
      "buff": 6
    },
    "reason": "Bloodline favors signature spellcasting over fallback attacks.",
    "label": "Bloodline Harrow"
  },
  "bloodline-imperial": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 8,
      "damage": 8,
      "debuff": 8,
      "buff": 6
    },
    "reason": "Bloodline favors signature spellcasting over fallback attacks.",
    "label": "Bloodline Imperial"
  },
  "bloodline-psychopomp": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 8,
      "damage": 8,
      "debuff": 8,
      "buff": 6
    },
    "reason": "Bloodline favors signature spellcasting over fallback attacks.",
    "label": "Bloodline Psychopomp"
  },
  "bloodline-undead": {
    "classSlug": "sorcerer",
    "spell": 8,
    "roles": {
      "control": 8,
      "damage": 8,
      "debuff": 8,
      "buff": 6
    },
    "reason": "Bloodline favors signature spellcasting over fallback attacks.",
    "label": "Bloodline Undead"
  }
};
