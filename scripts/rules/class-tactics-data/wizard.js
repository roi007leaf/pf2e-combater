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

// 14 of the 19 arcane schools collapse to 3 tactical templates (offensive/control/specialized)
// that only differ in which specific schools belong to each -- previously each of the 14 repeated
// its template's full roles/reason verbatim. The 5 "arcane thesis" entries below are each unique.
function expandArcaneSchoolTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "wizard", spell: 8, roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const OFFENSIVE_ARCANE_SCHOOL_TACTIC = {
  roles: { damage: 8, "save-damage": 8, "area-damage": 8, control: 6 },
  reason: "Arcane school favors offensive spells.",
  members: [
    ["school-of-battle-magic", "School of Battle Magic"],
    ["school-of-gates", "School of Gates"],
    ["red-mantis-magic-school", "Red Mantis Magic School"],
    ["runelord", "Runelord"],
  ],
};

const CONTROL_ARCANE_SCHOOL_TACTIC = {
  roles: { control: 10, debuff: 8, "save-damage": 6, defense: 6 },
  reason: "Arcane school favors battlefield control.",
  members: [
    ["school-of-civic-wizardry", "School of Civic Wizardry"],
    ["school-of-the-boundary", "School of the Boundary"],
    ["school-of-the-reclamation", "School of the Reclamation"],
    ["school-of-rooted-wisdom", "School of Rooted Wisdom"],
  ],
};

const SPECIALIZED_ARCANE_SCHOOL_TACTIC = {
  roles: { control: 8, buff: 8, setup: 8, "save-damage": 6 },
  reason: "Arcane school favors specialized spellcasting.",
  members: [
    ["school-of-ars-grammatica", "School of Ars Grammatica"],
    ["school-of-kalistrade", "School of Kalistrade"],
    ["school-of-mentalism", "School of Mentalism"],
    ["school-of-protean-form", "School of Protean Form"],
    ["school-of-magical-technologies", "School of Magical Technologies"],
    ["school-of-unified-magical-theory", "School of Unified Magical Theory"],
  ],
};

export const WIZARD_SUBCLASS_TACTICS = {
  ...expandArcaneSchoolTactics(OFFENSIVE_ARCANE_SCHOOL_TACTIC),
  ...expandArcaneSchoolTactics(CONTROL_ARCANE_SCHOOL_TACTIC),
  ...expandArcaneSchoolTactics(SPECIALIZED_ARCANE_SCHOOL_TACTIC),
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
