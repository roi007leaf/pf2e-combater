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

// Several conscious/subconscious mind pairs are byte-identical copies of four templates --
// previously each repeated its full roles/reason verbatim. The-Tangible-Dream and
// Emotional-Acceptance are each unique.
function expandMindTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = {
      classSlug: "psychic",
      ...(template.spell !== undefined ? { spell: template.spell } : {}),
      ...(template.actions ? { actions: template.actions } : {}),
      roles: template.roles,
      reason: template.reason,
      label,
    };
  }
  return entries;
}

const AMPLIFIED_DAMAGE_MIND_TACTIC = {
  spell: 8,
  roles: { damage: 8, "save-damage": 8, "area-damage": 8, control: 8 },
  reason: "Conscious mind favors amplified damage and control cantrips.",
  members: [
    ["the-distant-grasp", "The Distant Grasp"],
    ["the-oscillating-wave", "The Oscillating Wave"],
  ],
};

const MENTAL_SETUP_MIND_TACTIC = {
  spell: 8,
  roles: { control: 10, debuff: 8, "save-damage": 6, setup: 8 },
  reason: "Conscious mind favors mental setup and control.",
  members: [
    ["the-infinite-eye", "The Infinite Eye"],
    ["the-silent-whisper", "The Silent Whisper"],
  ],
};

const MOBILITY_MIND_TACTIC = {
  roles: { mobility: 12, control: 8, buff: 6 },
  reason: "Mind choice favors mobility and repositioning.",
  members: [
    ["the-unbound-step", "The Unbound Step"],
    ["wandering-reverie", "Wandering Reverie"],
  ],
};

const PRECISE_SETUP_MIND_TACTIC = {
  actions: { "recall-knowledge": 10 },
  roles: { setup: 10, control: 8, damage: 6 },
  reason: "Subconscious mind favors precise setup before burst spells.",
  members: [
    ["gathered-lore", "Gathered Lore"],
    ["precise-discipline", "Precise Discipline"],
  ],
};

export const PSYCHIC_SUBCLASS_TACTICS = {
  ...expandMindTactics(AMPLIFIED_DAMAGE_MIND_TACTIC),
  ...expandMindTactics(MENTAL_SETUP_MIND_TACTIC),
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
  ...expandMindTactics(MOBILITY_MIND_TACTIC),
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
  ...expandMindTactics(PRECISE_SETUP_MIND_TACTIC),
};
