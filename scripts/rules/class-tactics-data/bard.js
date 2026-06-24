import { CASTER_ROLES } from "./roles.js";

export const BARD_CLASS_TACTIC = {
    label: "Bard",
    classAction: 8,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, buff: 12, debuff: 10, control: 10, setup: 8 },
    signatureActions: {
      "courageous-advance": 22,
      "courageous-assault": 22,
      "courageous-onslaught": 22,
      harmonize: 18,
      "vigorous-anthem": 20,
      "counter-performance": 18,
      "lingering-composition": 18,
    },
  };

export const BARD_SUBCLASS_TACTICS = {
  "enigma": {
    "label": "Enigma muse",
    "classSlug": "bard",
    "actions": {
      "recall-knowledge": 14
    },
    "roles": {
      "setup": 12,
      "control": 8,
      "debuff": 6
    },
    "reason": "Enigma muse favors knowledge setup and occult control."
  },
  "maestro": {
    "label": "Maestro muse",
    "classSlug": "bard",
    "actions": {
      "lingering-composition": 20,
      "courageous-anthem": 14
    },
    "roles": {
      "buff": 14,
      "setup": 10
    },
    "reason": "Maestro muse favors composition support."
  },
  "polymath": {
    "label": "Polymath muse",
    "classSlug": "bard",
    "actions": {
      "bon-mot": 12,
      "create-a-diversion": 10
    },
    "roles": {
      "debuff": 10,
      "setup": 10,
      "buff": 6
    },
    "reason": "Polymath muse favors flexible skill setup."
  },
  "warrior": {
    "label": "Warrior muse",
    "classSlug": "bard",
    "actions": {
      "courageous-assault": 16,
      "courageous-advance": 16
    },
    "includesStrike": 8,
    "roles": {
      "buff": 10,
      "mobility-attack": 8
    },
    "reason": "Warrior muse favors martial compositions and ally attacks."
  },
  "zoophonia": {
    "label": "Zoophonia muse",
    "classSlug": "bard",
    "roles": {
      "summon": 8,
      "buff": 8,
      "control": 6
    },
    "reason": "Zoophonia muse favors creature support and performance control."
  }
};
