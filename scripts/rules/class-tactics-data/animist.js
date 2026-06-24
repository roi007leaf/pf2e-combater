import { CASTER_ROLES } from "./roles.js";

export const ANIMIST_CLASS_TACTIC = {
    label: "Animist",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, buff: 8, summon: 8 },
    signatureActions: {
      "apparitions-enhancement": 18,
      "apparitions-quickening": 20,
      "apparitions-reflection": 18,
      "circle-of-spirits": 18,
      "grudge-strike": 18,
    },
  };

export const ANIMIST_SUBCLASS_TACTICS = {
  "liturgist": {
    "classSlug": "animist",
    "spell": 8,
    "roles": {
      "healing": 10,
      "buff": 10,
      "resource-recovery": 6
    },
    "reason": "Liturgist practice favors spirit support and recovery.",
    "label": "Liturgist"
  },
  "medium": {
    "classSlug": "animist",
    "actions": {
      "circle-of-spirits": 10,
      "grudge-strike": 10
    },
    "roles": {
      "setup": 10,
      "summon": 8,
      "damage": 6
    },
    "reason": "Medium practice favors apparition setup and spirit payoffs.",
    "label": "Medium"
  },
  "seer": {
    "classSlug": "animist",
    "actions": {
      "recall-knowledge": 12,
      "seek": 8
    },
    "roles": {
      "setup": 10,
      "control": 8,
      "debuff": 6
    },
    "reason": "Seer practice favors information-gathering setup.",
    "label": "Seer"
  },
  "shaman": {
    "classSlug": "animist",
    "spell": 8,
    "roles": {
      "summon": 10,
      "control": 10,
      "buff": 6
    },
    "reason": "Shaman practice favors spirits, summons, and control.",
    "label": "Shaman"
  },
  "crafter-in-the-vault": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Crafter In The Vault"
  },
  "custodian-of-groves-and-gardens": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Custodian Of Groves And Gardens"
  },
  "echo-of-lost-moments": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Echo Of Lost Moments"
  },
  "impostor-in-hidden-places": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Impostor In Hidden Places"
  },
  "lurker-in-devouring-dark": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Lurker In Devouring Dark"
  },
  "monarch-of-the-fey-courts": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Monarch Of The Fey Courts"
  },
  "reveler-in-lost-glee": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Reveler In Lost Glee"
  },
  "shepherd-of-errant-winds": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Shepherd Of Errant Winds"
  },
  "speaker-in-sibilance": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Speaker In Sibilance"
  },
  "stalker-in-darkened-boughs": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Stalker In Darkened Boughs"
  },
  "steward-of-stone-and-fire": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Steward Of Stone And Fire"
  },
  "vanguard-of-roaring-waters": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Vanguard Of Roaring Waters"
  },
  "witness-to-ancient-battles": {
    "classSlug": "animist",
    "spell": 6,
    "roles": {
      "buff": 6,
      "control": 8,
      "debuff": 6,
      "summon": 6
    },
    "reason": "Chosen apparition favors spirit magic over filler attacks.",
    "label": "Witness To Ancient Battles"
  }
};
