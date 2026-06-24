import { MARTIAL_ROLES } from "./roles.js";

export const RANGER_CLASS_TACTIC = {
    label: "Ranger",
    classAction: 8,
    meleeStrike: 6,
    rangedStrike: 8,
    includesStrike: 6,
    roles: { ...MARTIAL_ROLES, setup: 10, mobility: 6 },
    signatureActions: {
      "hunt-prey": 30,
      "hunted-shot": 24,
      "twin-takedown": 24,
      "skirmish-strike": 20,
      "hunters-aim": 20,
    },
  };

export const RANGER_SUBCLASS_TACTICS = {
  "flurry": {
    "label": "Flurry edge",
    "classSlug": "ranger",
    "actions": {
      "hunted-shot": 18,
      "twin-takedown": 18
    },
    "roles": {
      "multiattack": 18,
      "damage": 8
    },
    "includesStrike": 8,
    "reason": "Flurry edge favors multiple attacks against hunted prey."
  },
  "outwit": {
    "label": "Outwit edge",
    "classSlug": "ranger",
    "actions": {
      "recall-knowledge": 12,
      "demoralize": 10,
      "hide": 8
    },
    "roles": {
      "setup": 14,
      "debuff": 10,
      "defense": 8
    },
    "reason": "Outwit edge favors skill setup and defensive pressure."
  },
  "precision": {
    "label": "Precision edge",
    "classSlug": "ranger",
    "actions": {
      "hunters-aim": 16
    },
    "roles": {
      "damage": 14,
      "mobility-attack": 8
    },
    "includesStrike": 8,
    "reason": "Precision edge favors one accurate hit per round."
  },
  "vindicator": {
    "label": "Vindicator edge",
    "classSlug": "ranger",
    "spell": 6,
    "roles": {
      "damage": 10,
      "debuff": 8,
      "setup": 8
    },
    "reason": "Vindicator edge favors marked-target punishment."
  }
};
