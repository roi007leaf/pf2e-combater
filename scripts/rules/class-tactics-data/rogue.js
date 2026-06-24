export const ROGUE_CLASS_TACTIC = {
    label: "Rogue",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 4,
    roles: { setup: 14, mobility: 8, damage: 6, debuff: 6, control: 6 },
    signatureActions: {
      "debilitating-strike": 24,
      "sneak-attack": 20,
      "twin-feint": 22,
      "poison-weapon": 20,
      "analyze-weakness": 20,
      feint: 8,
      "create-a-diversion": 8,
    },
  };

export const ROGUE_SUBCLASS_TACTICS = {
  "avenger": {
    "label": "Avenger racket",
    "classSlug": "rogue",
    "meleeStrike": 10,
    "roles": {
      "damage": 10,
      "setup": 8
    },
    "reason": "Avenger racket favors direct weapon pressure on openings."
  },
  "eldritch-trickster": {
    "label": "Eldritch Trickster racket",
    "classSlug": "rogue",
    "spell": 8,
    "roles": {
      "setup": 10,
      "debuff": 8,
      "damage": 6
    },
    "reason": "Eldritch Trickster favors spell setup into rogue payoffs."
  },
  "mastermind": {
    "label": "Mastermind racket",
    "classSlug": "rogue",
    "actions": {
      "recall-knowledge": 16,
      "analyze-weakness": 12
    },
    "roles": {
      "setup": 14,
      "damage": 8
    },
    "reason": "Mastermind racket favors knowledge setup before sneak attack."
  },
  "ruffian": {
    "label": "Ruffian racket",
    "classSlug": "rogue",
    "traits": {
      "shove": 8,
      "trip": 8,
      "grapple": 8
    },
    "meleeStrike": 10,
    "roles": {
      "control": 10,
      "damage": 8
    },
    "reason": "Ruffian racket favors athletics control and hard hits."
  },
  "scoundrel": {
    "label": "Scoundrel racket",
    "classSlug": "rogue",
    "actions": {
      "feint": 16,
      "create-a-diversion": 10,
      "bon-mot": 8
    },
    "roles": {
      "setup": 14,
      "debuff": 10
    },
    "reason": "Scoundrel racket favors social misdirection before damage."
  },
  "thief": {
    "label": "Thief racket",
    "classSlug": "rogue",
    "traits": {
      "finesse": 14,
      "agile": 8
    },
    "meleeStrike": 10,
    "roles": {
      "damage": 10,
      "mobility": 6
    },
    "reason": "Thief racket favors finesse melee Strikes."
  }
};
