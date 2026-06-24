import { MARTIAL_ROLES } from "./roles.js";

export const FIGHTER_CLASS_TACTIC = {
    label: "Fighter",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 8,
    includesStrike: 8,
    roles: { ...MARTIAL_ROLES, setup: 8 },
    signatureActions: {
      "reactive-strike": 16,
      "power-attack": 22,
      "vicious-swing": 22,
      "double-slice": 22,
      "intimidating-strike": 20,
      "knockdown": 20,
      "snagging-strike": 20,
    },
  };
