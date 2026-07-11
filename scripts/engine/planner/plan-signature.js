import { slugify as normalizeSlug } from "../action/text.js";

function planSteps(plan) {
  return (Array.isArray(plan?.steps) ? plan.steps : [])
    .map((step) => step?.action ?? step)
    .filter(Boolean);
}

function signaturePoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
  const elevation = Number(value?.elevation);
  return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100},${Number.isFinite(elevation) ? Math.round(elevation * 100) / 100 : ""}`;
}

function signatureTarget(value) {
  if (!value) return "";
  return normalizeSlug(value.id ?? value.token?.id ?? value.actor?.id ?? value.uuid ?? value.name);
}

export function planStepSignature(step) {
  const action = step?.action ?? step;
  const itemId = action?.item?.uuid ?? action?.item?.id ?? action?.item?.sourceId ?? "";
  const target = action?.preferredTarget ?? action?.suggestedTarget ?? action?.target ?? null;
  return [
    normalizeSlug(action?.slug) || normalizeSlug(action?.name) || normalizeSlug(action?.id),
    normalizeSlug(action?.name),
    normalizeSlug(itemId),
    action?.actionCost ?? action?.cost ?? "",
    action?.mapPenalty ?? "",
    action?.movementAction ?? "",
    action?.castRank ?? action?.rank ?? "",
    signatureTarget(target),
    signaturePoint(action?.destination ?? action?.activityProfile?.attackCenter),
    signaturePoint(action?.activityProfile?.areaPlacementAimPoint),
    signaturePoint(action?.activityProfile?.areaPlacementCenter),
  ].join("@");
}

export function planSignature(plan) {
  return planSteps(plan).map(planStepSignature).join(">");
}

export function stablePlanHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
