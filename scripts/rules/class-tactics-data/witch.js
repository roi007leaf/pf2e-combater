import { CASTER_ROLES } from "./roles.js";

export const WITCH_CLASS_TACTIC = {
    label: "Witch",
    classAction: 8,
    spell: 12,
    meleeStrike: -12,
    roles: { ...CASTER_ROLES, debuff: 12, control: 10, buff: 8 },
    signatureActions: {
      "cast-hex": 24,
      "split-hex": 22,
      "sympathetic-strike": 18,
      "familiar-of-flowing-script": 16,
    },
  };

// The 16 patrons collapse to 3 tactical templates that only differ in which specific patrons
// belong to each -- previously each of the 16 repeated its template's full roles/reason verbatim.
function expandPatronTactics(template) {
  const entries = {};
  for (const [key, label] of template.members) {
    entries[key] = { classSlug: "witch", spell: 8, roles: template.roles, reason: template.reason, label };
  }
  return entries;
}

const SUPPORT_PATRON_TACTIC = {
  roles: { buff: 10, healing: 8, defense: 6 },
  reason: "Patron favors support hexes and familiar benefits.",
  members: [
    ["faiths-flamekeeper", "Faith's Flamekeeper"],
    ["spinner-of-threads", "Spinner of Threads"],
    ["choir-politic", "Choir Politic"],
    ["wilding-steward", "Wilding Steward"],
  ],
};

const DEBILITATING_HEX_PATRON_TACTIC = {
  roles: { control: 10, debuff: 8, "save-damage": 6 },
  reason: "Patron favors debilitating hex pressure.",
  members: [
    ["the-resentment", "The Resentment"],
    ["starless-shadow", "Starless Shadow"],
    ["silence-in-snow", "Silence in Snow"],
    ["devourer-of-decay", "Devourer of Decay"],
    ["mosquito-witch", "Mosquito Witch"],
  ],
};

const THEMATIC_HEX_PATRON_TACTIC = {
  roles: { control: 8, buff: 8, debuff: 8, setup: 6 },
  reason: "Patron favors hexes and thematic spell pressure.",
  members: [
    ["baba-yaga", "Baba Yaga"],
    ["cobyslarni", "Cobyslarni"],
    ["paradox-of-opposites", "Paradox of Opposites"],
    ["ripple-in-the-deep", "Ripple in the Deep"],
    ["the-inscribed-one", "The Inscribed One"],
    ["the-unseen-broker", "The Unseen Broker"],
    ["whisper-of-wings", "Whisper of Wings"],
  ],
};

export const WITCH_SUBCLASS_TACTICS = {
  ...expandPatronTactics(SUPPORT_PATRON_TACTIC),
  ...expandPatronTactics(DEBILITATING_HEX_PATRON_TACTIC),
  ...expandPatronTactics(THEMATIC_HEX_PATRON_TACTIC),
};
