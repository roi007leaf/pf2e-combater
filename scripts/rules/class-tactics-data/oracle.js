import { CASTER_ROLES } from "./roles.js";

export const ORACLE_CLASS_TACTIC = {
    label: "Oracle",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, debuff: 10, control: 8 },
    signatureActions: {
      "foretell-harm": 20,
      "nudge-the-scales": 20,
      "whispers-of-weakness": 22,
      "debilitating-dichotomy": 20,
      "glean-lore": 16,
    },
  };

// Battle and Life mysteries are each unique; the other 9 collapse to 3 tactical templates that
// only differ in which specific mysteries belong to each -- previously each repeated its
// template's full roles/reason (and, for the elemental trio, traits) verbatim.
function expandMysteryTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = {
      classSlug: "oracle",
      spell: 8,
      roles: template.roles,
      ...(template.traits ? { traits: template.traits } : {}),
      reason: template.reason,
      label,
    };
  }
  return entries;
}

const ELEMENTAL_MYSTERY_TACTIC = {
  roles: { damage: 8, "save-damage": 8, "area-damage": 8 },
  traits: { fire: 6, electricity: 6, cold: 6 },
  reason: "Mystery favors elemental spell pressure.",
  members: [
    ["flames", "Flames"],
    ["ashes", "Ashes"],
    ["tempest", "Tempest"],
  ],
};

const REVELATION_CONTROL_MYSTERY_TACTIC = {
  roles: { control: 10, debuff: 8, "save-damage": 6, setup: 8 },
  reason: "Mystery favors revelation control and setup.",
  members: [
    ["cosmos", "Cosmos"],
    ["time", "Time"],
    ["lore", "Lore"],
    ["ancestors", "Ancestors"],
  ],
};

const DEBILITATING_REVELATION_MYSTERY_TACTIC = {
  roles: { control: 10, debuff: 8, "save-damage": 6, damage: 6 },
  reason: "Mystery favors debilitating revelation magic.",
  members: [
    ["blight", "Blight"],
    ["bones", "Bones"],
  ],
};

export const ORACLE_SUBCLASS_TACTICS = {
  "battle": {
    "classSlug": "oracle",
    "meleeStrike": 8,
    "roles": {
      "damage": 8,
      "defense": 8,
      "healing": 6
    },
    "reason": "Battle mystery favors weapon pressure backed by revelation magic.",
    "label": "Battle"
  },
  "life": {
    "classSlug": "oracle",
    "roles": {
      "healing": 16,
      "buff": 8,
      "defense": 6
    },
    "reason": "Life mystery favors healing and protection.",
    "label": "Life"
  },
  ...expandMysteryTactics(ELEMENTAL_MYSTERY_TACTIC),
  ...expandMysteryTactics(REVELATION_CONTROL_MYSTERY_TACTIC),
  ...expandMysteryTactics(DEBILITATING_REVELATION_MYSTERY_TACTIC),
};
