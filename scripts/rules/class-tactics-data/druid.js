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
  "cultivation-order": {
    "classSlug": "druid",
    "roles": {
      "healing": 12,
      "buff": 10,
      "control": 6
    },
    "reason": "Druid order favors nature healing and support.",
    "label": "Cultivation Order"
  },
  "leaf-order": {
    "classSlug": "druid",
    "roles": {
      "healing": 12,
      "buff": 10,
      "control": 6
    },
    "reason": "Druid order favors nature healing and support.",
    "label": "Leaf Order"
  },
  "flame-order": {
    "classSlug": "druid",
    "spell": 8,
    "roles": {
      "area-damage": 12,
      "control": 10,
      "damage": 8
    },
    "reason": "Druid order favors elemental area pressure.",
    "label": "Flame Order"
  },
  "storm-order": {
    "classSlug": "druid",
    "spell": 8,
    "roles": {
      "area-damage": 12,
      "control": 10,
      "damage": 8
    },
    "reason": "Druid order favors elemental area pressure.",
    "label": "Storm Order"
  },
  "wave-order": {
    "classSlug": "druid",
    "spell": 8,
    "roles": {
      "area-damage": 12,
      "control": 10,
      "damage": 8
    },
    "reason": "Druid order favors elemental area pressure.",
    "label": "Wave Order"
  },
  "spore-order": {
    "classSlug": "druid",
    "roles": {
      "control": 10,
      "defense": 10,
      "damage": 6
    },
    "reason": "Druid order favors terrain control and defense.",
    "label": "Spore Order"
  },
  "stone-order": {
    "classSlug": "druid",
    "roles": {
      "control": 10,
      "defense": 10,
      "damage": 6
    },
    "reason": "Druid order favors terrain control and defense.",
    "label": "Stone Order"
  },
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
