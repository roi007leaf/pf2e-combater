import { CASTER_ROLES } from "./roles.js";

export const SORCERER_CLASS_TACTIC = {
    label: "Sorcerer",
    classAction: 6,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, damage: 10, "area-damage": 10, "save-damage": 10 },
    signatureActions: {
      "bloodline-conduit": 22,
      "energy-fusion": 20,
      "dangerous-sorcery": 18,
      "counterspell-spontaneous": 16,
    },
  };

// The 18 bloodlines collapse to 4 tactical templates that only differ in which specific bloodlines
// belong to each -- previously each of the 18 repeated its template's full roles/reason verbatim.
function expandBloodlineTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "sorcerer", spell: 8, roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const SUPPORT_BLOODLINE_TACTIC = {
  roles: { buff: 10, healing: 8, defense: 6, damage: 6 },
  reason: "Bloodline favors support spells and bloodline magic.",
  members: [
    ["bloodline-angelic", "Bloodline: Angelic"],
    ["bloodline-phoenix", "Bloodline: Phoenix"],
    ["bloodline-nymph", "Bloodline: Nymph"],
    ["bloodline-wyrmblessed", "Bloodline: Wyrmblessed"],
  ],
};

const CONTROL_DEBUFF_BLOODLINE_TACTIC = {
  roles: { control: 10, debuff: 8, "save-damage": 6 },
  reason: "Bloodline favors control and debuff spells.",
  members: [
    ["bloodline-aberrant", "Bloodline: Aberrant"],
    ["bloodline-hag", "Bloodline: Hag"],
    ["bloodline-shadow", "Bloodline: Shadow"],
  ],
};

const OFFENSIVE_PRESSURE_BLOODLINE_TACTIC = {
  roles: { damage: 8, "save-damage": 8, "area-damage": 8 },
  reason: "Bloodline favors offensive spell pressure.",
  members: [
    ["bloodline-aesir", "Bloodline: Aesir"],
    ["bloodline-demonic", "Bloodline: Demonic"],
    ["bloodline-diabolic", "Bloodline: Diabolic"],
    ["bloodline-draconic", "Bloodline: Draconic"],
    ["bloodline-elemental", "Bloodline: Elemental"],
    ["bloodline-genie", "Bloodline: Genie"],
  ],
};

const SIGNATURE_SPELLCASTING_BLOODLINE_TACTIC = {
  roles: { control: 8, damage: 8, debuff: 8, buff: 6 },
  reason: "Bloodline favors signature spellcasting over fallback attacks.",
  members: [
    ["bloodline-fey", "Bloodline: Fey"],
    ["bloodline-harrow", "Bloodline: Harrow"],
    ["bloodline-imperial", "Bloodline: Imperial"],
    ["bloodline-psychopomp", "Bloodline: Psychopomp"],
    ["bloodline-undead", "Bloodline: Undead"],
  ],
};

export const SORCERER_SUBCLASS_TACTICS = {
  ...expandBloodlineTactics(SUPPORT_BLOODLINE_TACTIC),
  ...expandBloodlineTactics(CONTROL_DEBUFF_BLOODLINE_TACTIC),
  ...expandBloodlineTactics(OFFENSIVE_PRESSURE_BLOODLINE_TACTIC),
  ...expandBloodlineTactics(SIGNATURE_SPELLCASTING_BLOODLINE_TACTIC),
};
