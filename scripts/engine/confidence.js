import { CONFIDENCE } from "../constants.js";

export function combineConfidence(values) {
  if (!values.length) return CONFIDENCE.low;
  if (values.some((value) => value === CONFIDENCE.low)) return CONFIDENCE.low;
  if (values.every((value) => value === CONFIDENCE.high)) return CONFIDENCE.high;
  return CONFIDENCE.medium;
}

export function confidenceLabel(confidence) {
  switch (confidence) {
    case CONFIDENCE.high:
      return "High";
    case CONFIDENCE.medium:
      return "Medium";
    default:
      return "Low";
  }
}
