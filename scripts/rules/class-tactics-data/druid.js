import { CASTER_ROLES } from "./roles.js";

export const DRUID_CLASS_TACTIC = {
    label: "Druid",
    classAction: 6,
    spell: 10,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, "area-damage": 10, control: 10, healing: 8, summon: 8, transformation: 6 },
    signatureActions: {
      "wild-shape": 22,
      "storm-lord": 16,
      "floral-restoration": 18,
      "form-control": 18,
      "overwhelming-energy": 16,
    },
  };

// cultivation/leaf, flame/storm/wave, and spore/stone orders are byte-identical copies of three
// templates -- previously each repeated its full roles/reason verbatim. Animal and Untamed orders
// are each unique.
function expandOrderTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "druid", ...(template.spell !== undefined ? { spell: template.spell } : {}), roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const NATURE_HEALING_ORDER_TACTIC = {
  roles: { healing: 12, buff: 10, control: 6 },
  reason: "Druid order favors nature healing and support.",
  members: [
    ["cultivation-order", "Cultivation Order"],
    ["leaf-order", "Leaf Order"],
  ],
};

const ELEMENTAL_AREA_ORDER_TACTIC = {
  spell: 8,
  roles: { "area-damage": 12, control: 10, damage: 8 },
  reason: "Druid order favors elemental area pressure.",
  members: [
    ["flame-order", "Flame Order"],
    ["storm-order", "Storm Order"],
    ["wave-order", "Wave Order"],
  ],
};

const TERRAIN_CONTROL_ORDER_TACTIC = {
  roles: { control: 10, defense: 10, damage: 6 },
  reason: "Druid order favors terrain control and defense.",
  members: [
    ["spore-order", "Spore Order"],
    ["stone-order", "Stone Order"],
  ],
};

export const DRUID_SUBCLASS_TACTICS = {
  "animal-order": {
    "label": "Animal Order",
    "classSlug": "druid",
    "roles": {
      "summon": 12,
      "buff": 8,
      "mobility-attack": 6
    },
    "reason": "Animal order favors companion and creature support."
  },
  ...expandOrderTactics(NATURE_HEALING_ORDER_TACTIC),
  ...expandOrderTactics(ELEMENTAL_AREA_ORDER_TACTIC),
  ...expandOrderTactics(TERRAIN_CONTROL_ORDER_TACTIC),
  "untamed-order": {
    "label": "Untamed Order",
    "classSlug": "druid",
    "actions": {
      "wild-shape": 18,
      "form-control": 12
    },
    "meleeStrike": 8,
    "roles": {
      "transformation": 14,
      "damage": 8
    },
    "reason": "Untamed order favors battle forms."
  }
};
