export const GUNSLINGER_CLASS_TACTIC = {
    label: "Gunslinger",
    classAction: 8,
    rangedStrike: 14,
    meleeStrike: -10,
    reloadBeforeStrike: 8,
    roles: { setup: 8, mobility: 8, damage: 6, "mobility-attack": 8 },
    signatureActions: {
      "covered-reload": 28,
      "raconteurs-reload": 28,
      "reloading-strike": 28,
      "thoughtful-reload": 26,
      "finish-the-job": 22,
      "ghost-shot": 20,
      "vital-shot": 20,
      "running-reload": 22,
    },
  };

export const GUNSLINGER_SUBCLASS_TACTICS = {
  "way-of-the-drifter": {
    "label": "Way of the Drifter",
    "classSlug": "gunslinger",
    "actions": {
      "reloading-strike": 24
    },
    "meleeStrike": 6,
    "rangedStrike": 10,
    "roles": {
      "mobility-attack": 10,
      "damage": 8
    },
    "reason": "Drifter way favors mixed melee, ranged, and reload routines."
  },
  "way-of-the-pistolero": {
    "label": "Way of the Pistolero",
    "classSlug": "gunslinger",
    "actions": {
      "raconteurs-reload": 24,
      "demoralize": 10,
      "create-a-diversion": 8
    },
    "rangedStrike": 12,
    "roles": {
      "debuff": 10,
      "setup": 10,
      "damage": 8
    },
    "reason": "Pistolero way favors social reload setup into shots."
  },
  "way-of-the-sniper": {
    "label": "Way of the Sniper",
    "classSlug": "gunslinger",
    "actions": {
      "covered-reload": 26,
      "hide": 10
    },
    "rangedStrike": 14,
    "roles": {
      "damage": 12,
      "setup": 8,
      "defense": 6
    },
    "reason": "Sniper way favors cover, reload, and precise ranged shots."
  },
  "way-of-the-spellshot": {
    "label": "Way of the Spellshot",
    "classSlug": "gunslinger",
    "spell": 6,
    "rangedStrike": 12,
    "roles": {
      "damage": 10,
      "save-damage": 6,
      "setup": 6
    },
    "reason": "Spellshot way favors magical ranged pressure."
  },
  "way-of-the-triggerbrand": {
    "label": "Way of the Triggerbrand",
    "classSlug": "gunslinger",
    "meleeStrike": 6,
    "rangedStrike": 10,
    "roles": {
      "mobility-attack": 10,
      "damage": 8
    },
    "reason": "Triggerbrand way favors switching melee and ranged pressure."
  },
  "way-of-the-vanguard": {
    "label": "Way of the Vanguard",
    "classSlug": "gunslinger",
    "actions": {
      "shove": 10,
      "running-reload": 10
    },
    "rangedStrike": 10,
    "roles": {
      "control": 10,
      "defense": 8,
      "damage": 6
    },
    "reason": "Vanguard way favors close-range control and reload movement."
  }
};
