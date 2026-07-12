export const ALCHEMIST_CLASS_TACTIC = {
    label: "Alchemist",
    classAction: 8,
    consumable: 10,
    rangedStrike: 8,
    meleeStrike: -6,
    roles: { damage: 8, debuff: 8, control: 8, healing: 8, setup: 6, buff: 6 },
    signatureActions: {
      "quick-alchemy": 26,
      "quick-bomber": 22,
      "mutagenic-flashback": 18,
      "revivifying-mutagen": 18,
    },
  };

export const ALCHEMIST_SUBCLASS_TACTICS = {
  "bomber": {
    "label": "Bomber",
    "classSlug": "alchemist",
    "actions": {
      "quick-bomber": 24,
      "quick-alchemy": 8,
      "versatile-vial": 14
    },
    "traits": {
      "bomb": 18,
      "splash": 8,
      "alchemical": 6
    },
    "rangedStrike": 8,
    "roles": {
      "damage": 14,
      "area-damage": 8,
      "debuff": 6
    },
    "reason": "Bomber field favors bombs and versatile vial Strikes."
  },
  "chirurgeon": {
    "label": "Chirurgeon",
    "classSlug": "alchemist",
    "actions": {
      "quick-alchemy": 10,
      "battle-medicine": 16
    },
    "traits": {
      "elixir": 12,
      "healing": 10,
      "alchemical": 4
    },
    "consumable": 10,
    "roles": {
      "healing": 18,
      "buff": 8
    },
    "reason": "Chirurgeon field favors healing elixirs and support actions."
  },
  "mutagenist": {
    "label": "Mutagenist",
    "classSlug": "alchemist",
    "actions": {
      "quick-alchemy": 8,
      "mutagenic-flashback": 18,
      "revivifying-mutagen": 18
    },
    "traits": {
      "mutagen": 18,
      "elixir": 8,
      "polymorph": 8
    },
    "consumable": 8,
    "roles": {
      "setup": 12,
      "buff": 10,
      "transformation": 12,
      "defense": 8
    },
    "reason": "Mutagenist field favors mutagens before direct offense."
  },
  "toxicologist": {
    "label": "Toxicologist",
    "classSlug": "alchemist",
    "actions": {
      "quick-alchemy": 8,
      "poison-weapon": 16
    },
    "traits": {
      "poison": 18,
      "alchemical": 6
    },
    "roles": {
      "debuff": 14,
      "damage": 8,
      "control": 8
    },
    "reason": "Toxicologist field favors poison setup and debuffs."
  }
};
