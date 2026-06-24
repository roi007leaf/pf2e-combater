import { CASTER_ROLES } from "./roles.js";

export const SUMMONER_CLASS_TACTIC = {
    label: "Summoner",
    classAction: 8,
    spell: 8,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, summon: 12, buff: 10, control: 8 },
    signatureActions: {
      "act-together": 34,
      "manifest-eidolon": 26,
      "tandem-movement": 24,
      "tandem-strike": 24,
      transpose: 20,
      "defend-summoner": 18,
    },
  };

export const SUMMONER_SUBCLASS_TACTICS = {
  "angel-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "healing": 8,
      "buff": 10,
      "defense": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem support and protection.",
    "label": "Angel Eidolon"
  },
  "devotion-phantom-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "healing": 8,
      "buff": 10,
      "defense": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem support and protection.",
    "label": "Devotion Phantom Eidolon"
  },
  "psychopomp-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "healing": 8,
      "buff": 10,
      "defense": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem support and protection.",
    "label": "Psychopomp Eidolon"
  },
  "beast-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "damage": 10,
      "mobility-attack": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem offense.",
    "label": "Beast Eidolon"
  },
  "dragon-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "damage": 10,
      "mobility-attack": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem offense.",
    "label": "Dragon Eidolon"
  },
  "demon-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "damage": 10,
      "mobility-attack": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem offense.",
    "label": "Demon Eidolon"
  },
  "anger-phantom-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Anger Phantom Eidolon"
  },
  "construct-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Construct Eidolon"
  },
  "elemental-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Elemental Eidolon"
  },
  "fey-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Fey Eidolon"
  },
  "plant-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Plant Eidolon"
  },
  "swarm-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Swarm Eidolon"
  },
  "undead-eidolon": {
    "classSlug": "summoner",
    "roles": {
      "control": 10,
      "damage": 8,
      "summon": 8
    },
    "reason": "Eidolon choice favors tandem control and pressure.",
    "label": "Undead Eidolon"
  }
};
