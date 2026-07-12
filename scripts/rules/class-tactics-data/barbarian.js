import { MARTIAL_ROLES } from "./roles.js";

export const BARBARIAN_CLASS_TACTIC = {
    label: "Barbarian",
    classAction: 8,
    meleeStrike: 10,
    rangedStrike: -4,
    roles: { ...MARTIAL_ROLES, transformation: 8, damage: 6 },
    signatureActions: {
      rage: 30,
      "mighty-rage": 24,
      "quick-tempered": 18,
      "sudden-charge": 20,
      "furious-grab": 18,
      "renewed-vigor": 16,
    },
  };

// decay/ligneous/spirit and fury/giant instincts are byte-identical copies of two templates --
// previously each repeated its full roles/reason verbatim. The other 5 instincts are each unique.
function expandInstinctTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "barbarian", meleeStrike: template.meleeStrike, roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const MARTIAL_PRESSURE_INSTINCT_TACTIC = {
  meleeStrike: 10,
  roles: { damage: 10, control: 6, defense: 6 },
  reason: "Instinct choice favors Rage-enhanced martial pressure.",
  members: [
    ["decay-instinct", "Decay Instinct"],
    ["ligneous-instinct", "Ligneous Instinct"],
    ["spirit-instinct", "Spirit Instinct"],
  ],
};

const DIRECT_DAMAGE_INSTINCT_TACTIC = {
  meleeStrike: 12,
  roles: { damage: 12, "mobility-attack": 8 },
  reason: "Instinct choice favors direct Rage damage.",
  members: [
    ["fury-instinct", "Fury Instinct"],
    ["giant-instinct", "Giant Instinct"],
  ],
};

export const BARBARIAN_SUBCLASS_TACTICS = {
  "animal-instinct": {
    "label": "Animal Instinct",
    "classSlug": "barbarian",
    "traits": {
      "unarmed": 14,
      "grapple": 8,
      "shove": 6,
      "trip": 8
    },
    "meleeStrike": 10,
    "roles": {
      "control": 8,
      "damage": 10,
      "multiattack": 6
    },
    "reason": "Animal instinct favors unarmed Rage attacks and athletics control."
  },
  "dragon-instinct": {
    "label": "Dragon Instinct",
    "classSlug": "barbarian",
    "traits": {
      "dragon": 10,
      "fire": 6,
      "cold": 6,
      "acid": 6,
      "electricity": 6,
      "poison": 6
    },
    "meleeStrike": 10,
    "roles": {
      "damage": 12,
      "area-damage": 6
    },
    "reason": "Dragon instinct favors high-damage elemental Rage attacks."
  },
  "elemental-instinct": {
    "label": "Elemental Instinct",
    "classSlug": "barbarian",
    "traits": {
      "air": 6,
      "earth": 6,
      "fire": 6,
      "metal": 6,
      "water": 6,
      "wood": 6
    },
    "meleeStrike": 10,
    "roles": {
      "damage": 10,
      "mobility": 6,
      "control": 6
    },
    "reason": "Elemental instinct favors elemental Rage damage and movement."
  },
  "superstition-instinct": {
    "label": "Superstition Instinct",
    "classSlug": "barbarian",
    "spell": -18,
    "meleeStrike": 12,
    "roles": {
      "damage": 10,
      "defense": 8
    },
    "reason": "Superstition instinct favors anti-magic martial pressure."
  },
  "bloodrager": {
    "label": "Bloodrager",
    "classSlug": "barbarian",
    "spell": 6,
    "meleeStrike": 10,
    "roles": {
      "damage": 10,
      "save-damage": 6,
      "setup": 6
    },
    "reason": "Bloodrager instinct blends spell setup with Rage attacks."
  },
  ...expandInstinctTactics(MARTIAL_PRESSURE_INSTINCT_TACTIC),
  ...expandInstinctTactics(DIRECT_DAMAGE_INSTINCT_TACTIC),
};
