import { MARTIAL_ROLES } from "./roles.js";

export const MONK_CLASS_TACTIC = {
    label: "Monk",
    classAction: 8,
    meleeStrike: 8,
    rangedStrike: 2,
    roles: { ...MARTIAL_ROLES, mobility: 10, setup: 10, defense: 6 },
    signatureActions: {
      "flurry-of-blows": 30,
      "stunning-fist": 20,
      "ki-strike": 20,
      "flying-kick": 20,
      "mixed-maneuver": 18,
    },
  };
