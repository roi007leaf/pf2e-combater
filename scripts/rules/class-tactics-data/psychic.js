import { CASTER_ROLES } from "./roles.js";

export const PSYCHIC_CLASS_TACTIC = {
    label: "Psychic",
    classAction: 8,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 12, "save-damage": 10, control: 10 },
    signatureActions: {
      "unleash-psyche": 30,
      "psi-burst": 24,
      "restore-the-mind": 20,
      "calculate-threats": 18,
      "recall-the-teachings": 16,
    },
  };

export const PSYCHIC_SUBCLASS_TACTICS = {
  "the-distant-grasp": {
    "classSlug": "psychic",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 8
    },
    "reason": "Conscious mind favors amplified damage and control cantrips.",
    "label": "The Distant Grasp"
  },
  "the-oscillating-wave": {
    "classSlug": "psychic",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 8
    },
    "reason": "Conscious mind favors amplified damage and control cantrips.",
    "label": "The Oscillating Wave"
  },
  "the-infinite-eye": {
    "classSlug": "psychic",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Conscious mind favors mental setup and control.",
    "label": "The Infinite Eye"
  },
  "the-silent-whisper": {
    "classSlug": "psychic",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "setup": 8
    },
    "reason": "Conscious mind favors mental setup and control.",
    "label": "The Silent Whisper"
  },
  "the-tangible-dream": {
    "classSlug": "psychic",
    "spell": 8,
    "roles": {
      "buff": 10,
      "healing": 8,
      "defense": 6,
      "control": 6
    },
    "reason": "Conscious mind favors protective psychic support.",
    "label": "The Tangible Dream"
  },
  "the-unbound-step": {
    "classSlug": "psychic",
    "roles": {
      "mobility": 12,
      "control": 8,
      "buff": 6
    },
    "reason": "Mind choice favors mobility and repositioning.",
    "label": "The Unbound Step"
  },
  "wandering-reverie": {
    "classSlug": "psychic",
    "roles": {
      "mobility": 12,
      "control": 8,
      "buff": 6
    },
    "reason": "Mind choice favors mobility and repositioning.",
    "label": "Wandering Reverie"
  },
  "emotional-acceptance": {
    "classSlug": "psychic",
    "roles": {
      "healing": 10,
      "buff": 8,
      "debuff": 6
    },
    "reason": "Subconscious mind favors emotional support and recovery.",
    "label": "Emotional Acceptance"
  },
  "gathered-lore": {
    "classSlug": "psychic",
    "actions": {
      "recall-knowledge": 10
    },
    "roles": {
      "setup": 10,
      "control": 8,
      "damage": 6
    },
    "reason": "Subconscious mind favors precise setup before burst spells.",
    "label": "Gathered Lore"
  },
  "precise-discipline": {
    "classSlug": "psychic",
    "actions": {
      "recall-knowledge": 10
    },
    "roles": {
      "setup": 10,
      "control": 8,
      "damage": 6
    },
    "reason": "Subconscious mind favors precise setup before burst spells.",
    "label": "Precise Discipline"
  }
};
