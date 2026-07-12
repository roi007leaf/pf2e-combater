import { CASTER_ROLES } from "./roles.js";

export const SUMMONER_CLASS_TACTIC = {
    label: "Summoner",
    classAction: 8,
    spell: 8,
    meleeStrike: -8,
    roles: { ...CASTER_ROLES, summon: 12, buff: 10, control: 8 },
    signatureActions: {
      "act-together": 34,
      "manifest-eidolon": 26,
      "tandem-movement": 24,
      "tandem-strike": 24,
      transpose: 20,
      "defend-summoner": 18,
    },
  };

// The 13 eidolons collapse to 3 tactical templates (support/offense/control) that only differ in
// which specific eidolons belong to each -- previously each of the 13 repeated its template's full
// roles/reason verbatim.
function expandEidolonTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "summoner", roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const SUPPORT_EIDOLON_TACTIC = {
  roles: { healing: 8, buff: 10, defense: 8, summon: 8 },
  reason: "Eidolon choice favors tandem support and protection.",
  members: [
    ["angel-eidolon", "Angel Eidolon"],
    ["devotion-phantom-eidolon", "Devotion Phantom Eidolon"],
    ["psychopomp-eidolon", "Psychopomp Eidolon"],
  ],
};

const OFFENSE_EIDOLON_TACTIC = {
  roles: { damage: 10, "mobility-attack": 8, summon: 8 },
  reason: "Eidolon choice favors tandem offense.",
  members: [
    ["beast-eidolon", "Beast Eidolon"],
    ["dragon-eidolon", "Dragon Eidolon"],
    ["demon-eidolon", "Demon Eidolon"],
  ],
};

const CONTROL_EIDOLON_TACTIC = {
  roles: { control: 10, damage: 8, summon: 8 },
  reason: "Eidolon choice favors tandem control and pressure.",
  members: [
    ["anger-phantom-eidolon", "Anger Phantom Eidolon"],
    ["construct-eidolon", "Construct Eidolon"],
    ["elemental-eidolon", "Elemental Eidolon"],
    ["fey-eidolon", "Fey Eidolon"],
    ["plant-eidolon", "Plant Eidolon"],
    ["swarm-eidolon", "Swarm Eidolon"],
    ["undead-eidolon", "Undead Eidolon"],
  ],
};

export const SUMMONER_SUBCLASS_TACTICS = {
  ...expandEidolonTactics(SUPPORT_EIDOLON_TACTIC),
  ...expandEidolonTactics(OFFENSE_EIDOLON_TACTIC),
  ...expandEidolonTactics(CONTROL_EIDOLON_TACTIC),
};
