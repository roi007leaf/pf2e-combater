import { CASTER_ROLES } from "./roles.js";

export const WITCH_CLASS_TACTIC = {
    label: "Witch",
    classAction: 8,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, debuff: 12, control: 10, buff: 8 },
    signatureActions: {
      "cast-hex": 24,
      "split-hex": 22,
      "sympathetic-strike": 18,
      "familiar-of-flowing-script": 16,
    },
  };

export const WITCH_SUBCLASS_TACTICS = {
  "faiths-flamekeeper": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6
    },
    "reason": "Patron favors support hexes and familiar benefits.",
    "label": "Faiths Flamekeeper"
  },
  "spinner-of-threads": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6
    },
    "reason": "Patron favors support hexes and familiar benefits.",
    "label": "Spinner Of Threads"
  },
  "choir-politic": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6
    },
    "reason": "Patron favors support hexes and familiar benefits.",
    "label": "Choir Politic"
  },
  "wilding-steward": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6
    },
    "reason": "Patron favors support hexes and familiar benefits.",
    "label": "Wilding Steward"
  },
  "the-resentment": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Patron favors debilitating hex pressure.",
    "label": "The Resentment"
  },
  "starless-shadow": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Patron favors debilitating hex pressure.",
    "label": "Starless Shadow"
  },
  "silence-in-snow": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Patron favors debilitating hex pressure.",
    "label": "Silence In Snow"
  },
  "devourer-of-decay": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Patron favors debilitating hex pressure.",
    "label": "Devourer Of Decay"
  },
  "mosquito-witch": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6
    },
    "reason": "Patron favors debilitating hex pressure.",
    "label": "Mosquito Witch"
  },
  "baba-yaga": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "Baba Yaga"
  },
  "cobyslarni": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "Cobyslarni"
  },
  "paradox-of-opposites": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "Paradox Of Opposites"
  },
  "ripple-in-the-deep": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "Ripple In The Deep"
  },
  "the-inscribed-one": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "The Inscribed One"
  },
  "the-unseen-broker": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "The Unseen Broker"
  },
  "whisper-of-wings": {
    "classSlug": "witch",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "debuff": 8,
      "setup": 6
    },
    "reason": "Patron favors hexes and thematic spell pressure.",
    "label": "Whisper Of Wings"
  }
};
