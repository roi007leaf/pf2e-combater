export const INVESTIGATOR_CLASS_TACTIC = {
    label: "Investigator",
    classAction: 8,
    meleeStrike: 4,
    rangedStrike: 6,
    roles: { setup: 14, damage: 6, control: 6, debuff: 6 },
    signatureActions: {
      "devise-a-stratagem": 30,
      "clue-in": 18,
      "quick-tincture": 20,
      "pointed-question": 18,
      "recall-knowledge": 8,
    },
  };

export const INVESTIGATOR_SUBCLASS_TACTICS = {
  "alchemical-sciences-methodology": {
    "label": "Alchemical sciences methodology",
    "classSlug": "investigator",
    "actions": {
      "quick-tincture": 18
    },
    "consumable": 8,
    "roles": {
      "healing": 10,
      "buff": 8,
      "setup": 8
    },
    "reason": "Alchemical sciences favors tinctures and prepared utility."
  },
  "empiricism-methodology": {
    "label": "Empiricism methodology",
    "classSlug": "investigator",
    "actions": {
      "devise-a-stratagem": 12,
      "recall-knowledge": 12
    },
    "roles": {
      "setup": 12,
      "control": 6
    },
    "reason": "Empiricism favors Devise and knowledge setup."
  },
  "forensic-medicine-methodology": {
    "label": "Forensic medicine methodology",
    "classSlug": "investigator",
    "actions": {
      "battle-medicine": 18
    },
    "roles": {
      "healing": 14,
      "setup": 8
    },
    "reason": "Forensic medicine favors Battle Medicine and support."
  },
  "interrogation-methodology": {
    "label": "Interrogation methodology",
    "classSlug": "investigator",
    "actions": {
      "pointed-question": 16,
      "demoralize": 10,
      "bon-mot": 10
    },
    "roles": {
      "debuff": 12,
      "setup": 10
    },
    "reason": "Interrogation favors social debuffs before attacks."
  },
  "palatine-detective": {
    "label": "Palatine Detective",
    "classSlug": "investigator",
    "actions": {
      "recall-knowledge": 10,
      "seek": 10
    },
    "roles": {
      "setup": 12,
      "control": 8
    },
    "reason": "Palatine Detective favors investigation and tactical setup."
  }
};
