import { MARTIAL_ROLES } from "./roles.js";

export const EXEMPLAR_CLASS_TACTIC = {
    label: "Exemplar",
    classAction: 10,
    meleeStrike: 8,
    rangedStrike: 6,
    roles: { ...MARTIAL_ROLES, damage: 8, mobility: 6 },
    signatureActions: {
      "shift-immanence": 24,
      "spark-transcendence": 24,
      "victors-wreath": 18,
    },
  };

export const EXEMPLAR_SUBCLASS_TACTICS = {
  "the-brave": {
    "classSlug": "exemplar",
    "includesStrike": 8,
    "roles": {
      "damage": 8,
      "mobility-attack": 8,
      "multiattack": 8,
      "buff": 6
    },
    "reason": "Epithet favors bold Exemplar offense.",
    "label": "The Brave"
  },
  "the-proud": {
    "classSlug": "exemplar",
    "includesStrike": 8,
    "roles": {
      "damage": 8,
      "mobility-attack": 8,
      "multiattack": 8,
      "buff": 6
    },
    "reason": "Epithet favors bold Exemplar offense.",
    "label": "The Proud"
  },
  "the-radiant": {
    "classSlug": "exemplar",
    "includesStrike": 8,
    "roles": {
      "damage": 8,
      "mobility-attack": 8,
      "multiattack": 8,
      "buff": 6
    },
    "reason": "Epithet favors bold Exemplar offense.",
    "label": "The Radiant"
  },
  "the-cunning": {
    "classSlug": "exemplar",
    "roles": {
      "mobility": 10,
      "setup": 8,
      "damage": 6
    },
    "reason": "Epithet favors mobility and setup.",
    "label": "The Cunning"
  },
  "the-deft": {
    "classSlug": "exemplar",
    "roles": {
      "mobility": 10,
      "setup": 8,
      "damage": 6
    },
    "reason": "Epithet favors mobility and setup.",
    "label": "The Deft"
  },
  "restless-as-the-tide": {
    "classSlug": "exemplar",
    "roles": {
      "mobility": 10,
      "setup": 8,
      "damage": 6
    },
    "reason": "Epithet favors mobility and setup.",
    "label": "Restless As The Tide"
  },
  "thief-of-moonlight": {
    "classSlug": "exemplar",
    "roles": {
      "mobility": 10,
      "setup": 8,
      "damage": 6
    },
    "reason": "Epithet favors mobility and setup.",
    "label": "Thief Of Moonlight"
  },
  "the-mournful": {
    "classSlug": "exemplar",
    "roles": {
      "healing": 10,
      "buff": 10,
      "defense": 6
    },
    "reason": "Epithet favors support and protection.",
    "label": "The Mournful"
  },
  "healer-of-the-world": {
    "classSlug": "exemplar",
    "roles": {
      "healing": 10,
      "buff": 10,
      "defense": 6
    },
    "reason": "Epithet favors support and protection.",
    "label": "Healer Of The World"
  },
  "teacher-of-heroes": {
    "classSlug": "exemplar",
    "roles": {
      "healing": 10,
      "buff": 10,
      "defense": 6
    },
    "reason": "Epithet favors support and protection.",
    "label": "Teacher Of Heroes"
  },
  "of-verse-unbroken": {
    "classSlug": "exemplar",
    "roles": {
      "healing": 10,
      "buff": 10,
      "defense": 6
    },
    "reason": "Epithet favors support and protection.",
    "label": "Of Verse Unbroken"
  },
  "born-of-the-bones-of-the-earth": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Born Of The Bones Of The Earth"
  },
  "dancer-in-the-seasons": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Dancer In The Seasons"
  },
  "peerless-under-heaven": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Peerless Under Heaven"
  },
  "plunderer-of-the-hives-riches": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Plunderer Of The Hives Riches"
  },
  "trespasser-in-deaths-realm": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Trespasser In Deaths Realm"
  },
  "whose-cry-is-thunder": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "Whose Cry Is Thunder"
  },
  "the-last-ruler": {
    "classSlug": "exemplar",
    "roles": {
      "damage": 8,
      "control": 8,
      "defense": 6
    },
    "reason": "Epithet favors Exemplar class payoffs over filler.",
    "label": "The Last Ruler"
  }
};
