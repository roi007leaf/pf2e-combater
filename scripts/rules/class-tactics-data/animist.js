import { CASTER_ROLES } from "./roles.js";

export const ANIMIST_CLASS_TACTIC = {
    label: "Animist",
    classAction: 6,
    spell: 10,
    meleeStrike: -10,
    roles: { ...CASTER_ROLES, healing: 10, buff: 8, summon: 8 },
    signatureActions: {
      "apparitions-enhancement": 18,
      "apparitions-quickening": 20,
      "apparitions-reflection": 18,
      "circle-of-spirits": 18,
      "grudge-strike": 18,
    },
  };

// 13 of the 17 practices/apparitions ("crafter-in-the-vault" through "witness-to-ancient-battles")
// are byte-identical copies of one template -- previously each repeated its full roles/reason
// verbatim. Liturgist/Medium/Seer/Shaman are each unique and stay as literal entries.
function expandApparitionTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "animist", spell: template.spell, roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const CHOSEN_APPARITION_TACTIC = {
  spell: 6,
  roles: { buff: 6, control: 8, debuff: 6, summon: 6 },
  reason: "Chosen apparition favors spirit magic over filler attacks.",
  members: [
    ["crafter-in-the-vault", "Crafter in the Vault"],
    ["custodian-of-groves-and-gardens", "Custodian of Groves and Gardens"],
    ["echo-of-lost-moments", "Echo of Lost Moments"],
    ["impostor-in-hidden-places", "Impostor in Hidden Places"],
    ["lurker-in-devouring-dark", "Lurker in Devouring Dark"],
    ["monarch-of-the-fey-courts", "Monarch of the Fey Courts"],
    ["reveler-in-lost-glee", "Reveler in Lost Glee"],
    ["shepherd-of-errant-winds", "Shepherd of Errant Winds"],
    ["speaker-in-sibilance", "Speaker in Sibilance"],
    ["stalker-in-darkened-boughs", "Stalker in Darkened Boughs"],
    ["steward-of-stone-and-fire", "Steward of Stone and Fire"],
    ["vanguard-of-roaring-waters", "Vanguard of Roaring Waters"],
    ["witness-to-ancient-battles", "Witness to Ancient Battles"],
  ],
};

export const ANIMIST_SUBCLASS_TACTICS = {
  "liturgist": {
    "classSlug": "animist",
    "spell": 8,
    "roles": {
      "healing": 10,
      "buff": 10,
      "resource-recovery": 6
    },
    "reason": "Liturgist practice favors spirit support and recovery.",
    "label": "Liturgist"
  },
  "medium": {
    "classSlug": "animist",
    "actions": {
      "circle-of-spirits": 10,
      "grudge-strike": 10
    },
    "roles": {
      "setup": 10,
      "summon": 8,
      "damage": 6
    },
    "reason": "Medium practice favors apparition setup and spirit payoffs.",
    "label": "Medium"
  },
  "seer": {
    "classSlug": "animist",
    "actions": {
      "recall-knowledge": 12,
      "seek": 8
    },
    "roles": {
      "setup": 10,
      "control": 8,
      "debuff": 6
    },
    "reason": "Seer practice favors information-gathering setup.",
    "label": "Seer"
  },
  "shaman": {
    "classSlug": "animist",
    "spell": 8,
    "roles": {
      "summon": 10,
      "control": 10,
      "buff": 6
    },
    "reason": "Shaman practice favors spirits, summons, and control.",
    "label": "Shaman"
  },
  ...expandApparitionTactics(CHOSEN_APPARITION_TACTIC),
};
