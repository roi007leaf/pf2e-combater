import { MARTIAL_ROLES } from "./roles.js";

export const EXEMPLAR_CLASS_TACTIC = {
    label: "Exemplar",
    classAction: 10,
    meleeStrike: 8,
    rangedStrike: 6,
    roles: { ...MARTIAL_ROLES, damage: 8, mobility: 6 },
    signatureActions: {
      "shift-immanence": 24,
      "spark-transcendence": 24,
      "victors-wreath": 18,
    },
  };

// The 18 epithets collapse to 4 tactical templates that only differ in which specific epithets
// belong to each -- previously each of the 18 repeated its template's full roles/reason verbatim.
function expandEpithetTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = {
      classSlug: "exemplar",
      ...(template.includesStrike !== undefined ? { includesStrike: template.includesStrike } : {}),
      roles: template.roles,
      reason: template.reason,
      label,
    };
  }
  return entries;
}

const BOLD_OFFENSE_EPITHET_TACTIC = {
  includesStrike: 8,
  roles: { damage: 8, "mobility-attack": 8, multiattack: 8, buff: 6 },
  reason: "Epithet favors bold Exemplar offense.",
  members: [
    ["the-brave", "The Brave"],
    ["the-proud", "The Proud"],
    ["the-radiant", "The Radiant"],
  ],
};

const MOBILITY_SETUP_EPITHET_TACTIC = {
  roles: { mobility: 10, setup: 8, damage: 6 },
  reason: "Epithet favors mobility and setup.",
  members: [
    ["the-cunning", "The Cunning"],
    ["the-deft", "The Deft"],
    ["restless-as-the-tide", "Restless as the Tide"],
    ["thief-of-moonlight", "Thief of Moonlight"],
  ],
};

const SUPPORT_PROTECTION_EPITHET_TACTIC = {
  roles: { healing: 10, buff: 10, defense: 6 },
  reason: "Epithet favors support and protection.",
  members: [
    ["the-mournful", "The Mournful"],
    ["healer-of-the-world", "Healer of the World"],
    ["teacher-of-heroes", "Teacher of Heroes"],
    ["of-verse-unbroken", "Of Verse Unbroken"],
  ],
};

const CLASS_PAYOFF_EPITHET_TACTIC = {
  roles: { damage: 8, control: 8, defense: 6 },
  reason: "Epithet favors Exemplar class payoffs over filler.",
  members: [
    ["born-of-the-bones-of-the-earth", "Born of the Bones of the Earth"],
    ["dancer-in-the-seasons", "Dancer in the Seasons"],
    ["peerless-under-heaven", "Peerless under Heaven"],
    ["plunderer-of-the-hives-riches", "Plunderer of the Hive's Riches"],
    ["trespasser-in-deaths-realm", "Trespasser In Death's Realm"],
    ["whose-cry-is-thunder", "Whose Cry is Thunder"],
    ["the-last-ruler", "The Last Ruler"],
  ],
};

export const EXEMPLAR_SUBCLASS_TACTICS = {
  ...expandEpithetTactics(BOLD_OFFENSE_EPITHET_TACTIC),
  ...expandEpithetTactics(MOBILITY_SETUP_EPITHET_TACTIC),
  ...expandEpithetTactics(SUPPORT_PROTECTION_EPITHET_TACTIC),
  ...expandEpithetTactics(CLASS_PAYOFF_EPITHET_TACTIC),
};
