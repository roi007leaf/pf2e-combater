import { ACTION_COST, CONFIDENCE } from "../constants.js";

export const fighterContext = {
  actor: {
    id: "fighter-1",
    name: "Valeros",
    img: "icons/svg/mystery-man.svg",
  },
  profile: {
    hpPercent: 0.82,
    hasShield: true,
    handsFree: 2,
    conditions: {
      slugs: [],
      values: {},
    },
    skills: {
      athletics: 12,
      intimidation: 11,
      medicine: 8,
    },
  },
  targets: [
    {
      id: "target-1",
      name: "Ogre",
      distance: 10,
      hpPercent: 0.74,
      conditions: [],
      saves: {
        fortitude: 11,
        reflex: 6,
        will: 5,
      },
      ac: 19,
    },
  ],
};

export const fixtureCandidates = [
  {
    id: "demoralize",
    name: "Demoralize",
    slug: "demoralize",
    actionCost: ACTION_COST.one,
    source: "skill",
    score: 78,
    confidence: CONFIDENCE.high,
    reason: "Open with fear to lower Ogre defenses.",
    executable: true,
  },
  {
    id: "strike",
    name: "Strike",
    slug: "strike",
    actionCost: ACTION_COST.one,
    source: "strike",
    score: 72,
    confidence: CONFIDENCE.medium,
    reason: "Attack while target is pressured.",
    executable: true,
  },
  {
    id: "raise-a-shield",
    name: "Raise a Shield",
    slug: "raise-a-shield",
    actionCost: ACTION_COST.one,
    source: "action",
    score: 64,
    confidence: CONFIDENCE.high,
    reason: "End protected against retaliation.",
    executable: true,
  },
  {
    id: "heal",
    name: "Heal",
    slug: "heal",
    actionCost: ACTION_COST.two,
    source: "spell",
    score: 62,
    confidence: CONFIDENCE.high,
    reason: "Recover when damage matters more than pressure.",
    executable: true,
  },
];
