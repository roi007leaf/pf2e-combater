import { CASTER_ROLES } from "./roles.js";

export const CLERIC_CLASS_TACTIC = {
    label: "Cleric",
    classAction: 6,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, healing: 14, buff: 10, "save-damage": 10 },
    signatureActions: {
      "channel-smite": 22,
      "raise-symbol": 16,
      "divine-infusion": 18,
      "cast-down": 18,
      "restorative-strike": 18,
    },
  };

export const CLERIC_SUBCLASS_TACTICS = {
  "battle-creed": {
    "label": "Battle Creed",
    "classSlug": "cleric",
    "meleeStrike": 8,
    "roles": {
      "damage": 8,
      "defense": 8,
      "healing": 6
    },
    "reason": "Battle Creed favors weapon-and-shield divine pressure."
  },
  "cloistered-cleric": {
    "label": "Cloistered Cleric",
    "classSlug": "cleric",
    "spell": 10,
    "meleeStrike": -8,
    "roles": {
      "healing": 12,
      "buff": 10,
      "save-damage": 8
    },
    "reason": "Cloistered doctrine favors spellcasting over weapon fallback."
  },
  "warpriest": {
    "label": "Warpriest doctrine",
    "classSlug": "cleric",
    "actions": {
      "channel-smite": 18,
      "raise-a-shield": 10
    },
    "meleeStrike": 10,
    "roles": {
      "damage": 10,
      "defense": 10,
      "healing": 6
    },
    "reason": "Warpriest doctrine favors shielded weapon pressure."
  }
};
