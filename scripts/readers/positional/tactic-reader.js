import {
  readStrideMultiattackActivities,
  readStrideStrikeActivities,
} from "./stride-reader.js";
import {
  readRangedRetreatStrikeActivities,
  readSkirmishStrikeActivities,
} from "./retreat-reader.js";
import { readFlankStrikeActivities } from "./flank-reader.js";
import { readSkirmishKiteActivities } from "./kite-reader.js";

export function readPositionalMovementActions(context, readyStrikes, generatedActivities, spells = []) {
  const actions = [
    ...readStrideStrikeActivities(context, readyStrikes),
    ...readStrideMultiattackActivities(context, generatedActivities),
    ...readRangedRetreatStrikeActivities(context, readyStrikes),
    ...readSkirmishStrikeActivities(context, readyStrikes),
    ...readSkirmishKiteActivities(context, readyStrikes, spells),
    ...readFlankStrikeActivities(context, readyStrikes),
  ];
  const movementAction = context?.profile?.movementAction ?? context?.actor?.profile?.movementAction;
  if (!movementAction) return actions;
  return actions.map((action) => Number(action?.activityProfile?.strideCount) > 0
    ? { ...action, movementAction }
    : action);
}
