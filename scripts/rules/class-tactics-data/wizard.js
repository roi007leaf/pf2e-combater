import { CASTER_ROLES } from "./roles.js";

export const WIZARD_CLASS_TACTIC = {
    label: "Wizard",
    classAction: 6,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 10, "area-damage": 10, control: 12, "resource-recovery": 10 },
    signatureActions: {
      "drain-bonded-item": 28,
      "bond-conservation": 22,
      "spell-protection-array": 18,
      "convincing-illusion": 16,
    },
  };

export const WIZARD_SUBCLASS_TACTICS = {
  "school-of-battle-magic": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 6
    },
    "reason": "Arcane school favors offensive spells.",
    "label": "School Of Battle Magic"
  },
  "school-of-gates": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 6
    },
    "reason": "Arcane school favors offensive spells.",
    "label": "School Of Gates"
  },
  "red-mantis-magic-school": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 6
    },
    "reason": "Arcane school favors offensive spells.",
    "label": "Red Mantis Magic School"
  },
  "runelord": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "damage": 8,
      "save-damage": 8,
      "area-damage": 8,
      "control": 6
    },
    "reason": "Arcane school favors offensive spells.",
    "label": "Runelord"
  },
  "school-of-civic-wizardry": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "defense": 6
    },
    "reason": "Arcane school favors battlefield control.",
    "label": "School Of Civic Wizardry"
  },
  "school-of-the-boundary": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "defense": 6
    },
    "reason": "Arcane school favors battlefield control.",
    "label": "School Of The Boundary"
  },
  "school-of-the-reclamation": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "defense": 6
    },
    "reason": "Arcane school favors battlefield control.",
    "label": "School Of The Reclamation"
  },
  "school-of-rooted-wisdom": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 10,
      "debuff": 8,
      "save-damage": 6,
      "defense": 6
    },
    "reason": "Arcane school favors battlefield control.",
    "label": "School Of Rooted Wisdom"
  },
  "school-of-ars-grammatica": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Ars Grammatica"
  },
  "school-of-kalistrade": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Kalistrade"
  },
  "school-of-mentalism": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Mentalism"
  },
  "school-of-protean-form": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Protean Form"
  },
  "school-of-magical-technologies": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Magical Technologies"
  },
  "school-of-unified-magical-theory": {
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 8,
      "buff": 8,
      "setup": 8,
      "save-damage": 6
    },
    "reason": "Arcane school favors specialized spellcasting.",
    "label": "School Of Unified Magical Theory"
  },
  "experimental-spellshaping": {
    "label": "Experimental Spellshaping",
    "classSlug": "wizard",
    "spell": 10,
    "roles": {
      "control": 8,
      "area-damage": 8,
      "buff": 6
    },
    "reason": "Arcane thesis favors shaped spell value."
  },
  "improved-familiar-attunement": {
    "label": "Improved Familiar Attunement",
    "classSlug": "wizard",
    "roles": {
      "buff": 10,
      "setup": 8,
      "resource-recovery": 6
    },
    "reason": "Arcane thesis favors familiar-based support."
  },
  "spell-blending": {
    "label": "Spell Blending",
    "classSlug": "wizard",
    "spell": 10,
    "roles": {
      "damage": 8,
      "control": 8,
      "area-damage": 8
    },
    "reason": "Arcane thesis favors higher-impact spells."
  },
  "spell-substitution": {
    "label": "Spell Substitution",
    "classSlug": "wizard",
    "spell": 8,
    "roles": {
      "control": 10,
      "setup": 8
    },
    "reason": "Arcane thesis favors the right spell for the scene."
  },
  "staff-nexus": {
    "label": "Staff Nexus",
    "classSlug": "wizard",
    "actions": {
      "drain-bonded-item": 8
    },
    "spell": 8,
    "roles": {
      "resource-recovery": 12,
      "control": 6,
      "damage": 6
    },
    "reason": "Staff Nexus favors staff and resource play."
  }
};
