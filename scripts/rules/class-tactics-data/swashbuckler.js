export const SWASHBUCKLER_CLASS_TACTIC = {
    label: "Swashbuckler",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 2,
    roles: { setup: 14, mobility: 10, damage: 8, defense: 4, control: 4 },
    signatureActions: {
      "gain-panache": 30,
      "confident-finisher": 28,
      "opportune-riposte": 16,
      "one-for-all": 20,
      "vexing-tumble": 22,
      feint: 8,
      "tumble-through": 10,
    },
  };

export const SWASHBUCKLER_SUBCLASS_TACTICS = {
  "battledancer": {
    "label": "Battledancer style",
    "classSlug": "swashbuckler",
    "actions": {
      "perform": 16,
      "tumble-through": 8
    },
    "roles": {
      "setup": 12,
      "mobility": 8
    },
    "reason": "Battledancer style favors performance to gain panache."
  },
  "braggart": {
    "label": "Braggart style",
    "classSlug": "swashbuckler",
    "actions": {
      "demoralize": 16
    },
    "roles": {
      "debuff": 12,
      "setup": 10
    },
    "reason": "Braggart style favors Demoralize to gain panache."
  },
  "fencer": {
    "label": "Fencer style",
    "classSlug": "swashbuckler",
    "actions": {
      "feint": 16
    },
    "roles": {
      "setup": 12,
      "damage": 8
    },
    "reason": "Fencer style favors Feint before finishers."
  },
  "gymnast": {
    "label": "Gymnast style",
    "classSlug": "swashbuckler",
    "actions": {
      "grapple": 16,
      "trip": 16,
      "shove": 12,
      "reposition": 12
    },
    "roles": {
      "control": 14,
      "setup": 10
    },
    "reason": "Gymnast style favors athletics actions to gain panache."
  },
  "rascal": {
    "label": "Rascal style",
    "classSlug": "swashbuckler",
    "actions": {
      "create-a-diversion": 14,
      "tumble-through": 8
    },
    "roles": {
      "setup": 12,
      "mobility": 8,
      "debuff": 6
    },
    "reason": "Rascal style favors deception and mobility."
  },
  "wit": {
    "label": "Wit style",
    "classSlug": "swashbuckler",
    "actions": {
      "bon-mot": 16,
      "one-for-all": 12
    },
    "roles": {
      "debuff": 12,
      "buff": 8,
      "setup": 8
    },
    "reason": "Wit style favors Bon Mot and ally support."
  }
};
