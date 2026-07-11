import { STORAGE_KEYS } from "../constants.js";
import { planSignature, stablePlanHash } from "../engine/planner/plan-signature.js";

const PROFILE_VERSION = 2;
const MAX_FEATURE_WEIGHT = 2;
export const PREFERENCE_SCORE_CAP = 8;
const MAX_SCORE_DELTA = PREFERENCE_SCORE_CAP;
const EMPTY_PROFILE = Object.freeze({ version: PROFILE_VERSION, examples: Object.freeze({}) });

let cachedProfilesRaw;
let cachedProfiles = {};
const weightCache = new WeakMap();

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function storage() {
  return globalThis.localStorage ?? null;
}

function normalizedToken(value) {
  return String(value ?? "").trim().slice(0, 240);
}

function normalizedLabel(value) {
  const number = Number(value);
  return number > 0 ? 1 : number < 0 ? -1 : 0;
}

function normalizedFeatures(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(normalizedToken)
    .filter(Boolean))];
}

function actorScopeId(context) {
  return context?.actor?.document?.uuid
    ?? context?.actor?.uuid
    ?? context?.actor?.document?.id
    ?? context?.actor?.id
    ?? context?.combatant?.actor?.uuid
    ?? context?.combatant?.actor?.id
    ?? "unknown-actor";
}

function userScopeId() {
  return globalThis.game?.user?.id ?? "anonymous";
}

function scopeKey(context) {
  return `${userScopeId()}|${actorScopeId(context)}`;
}

function readProfiles() {
  try {
    const raw = storage()?.getItem(STORAGE_KEYS.preferenceProfiles) ?? null;
    if (raw === cachedProfilesRaw) return cachedProfiles;
    const parsed = raw ? JSON.parse(raw) : {};
    cachedProfiles = Object.fromEntries(Object.entries(plainObject(parsed))
      .map(([key, profile]) => [key, normalizePreferenceProfile(profile)]));
    cachedProfilesRaw = raw;
    return cachedProfiles;
  } catch (_error) {
    cachedProfilesRaw = null;
    cachedProfiles = {};
    return {};
  }
}

function writeProfiles(profiles) {
  try {
    cachedProfiles = Object.fromEntries(Object.entries(plainObject(profiles))
      .map(([key, profile]) => [key, normalizePreferenceProfile(profile)]));
    cachedProfilesRaw = JSON.stringify(cachedProfiles);
    storage()?.setItem(STORAGE_KEYS.preferenceProfiles, cachedProfilesRaw);
  } catch (_error) {
    // Client storage is optional in tests, privacy modes, and headless Foundry.
  }
}

export function preferenceActionId(action) {
  return normalizedToken(
    action?.preferenceIdentity
      ?? action?.item?.uuid
      ?? action?.uuid
      ?? action?.id
      ?? action?.slug
      ?? action?.name
      ?? "unknown-action",
  );
}

function actionKind(action) {
  const source = String(action?.source ?? "").toLowerCase();
  const role = String(action?.curated?.role ?? action?.role ?? "").toLowerCase();
  if (source === "strike" || action?.attackTrait === true) return "attack";
  if (source.startsWith("spell") || action?.item?.type === "spell") return "spell";
  if (["movement", "mobility", "mobility-attack"].includes(role) || action?.requiresDestination === true) return "movement";
  if (action?.item?.type === "consumable" || action?.type === "consumable") return "consumable";
  if (action?.skill || action?.statistic) return "skill";
  return "other";
}

function resourceKind(action) {
  const text = [
    action?.resourceType,
    action?.resource?.type,
    action?.resource?.label,
    action?.frequency?.max ? "frequency" : "",
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("focus")) return "focus";
  if (text.includes("slot") || action?.slotId != null || action?.spellcastingEntryId) return "spell-slot";
  if (text.includes("frequency")) return "frequency";
  if (action?.item?.type === "consumable" || action?.type === "consumable") return "consumable";
  return "at-will";
}

export function preferenceFeatures(action) {
  const id = preferenceActionId(action);
  const role = normalizedToken(action?.curated?.role ?? action?.role ?? "other").toLowerCase();
  const costValue = action?.actionCost ?? action?.cost ?? 0;
  const cost = costValue === "reaction" ? "reaction" : String(Math.max(0, Number(costValue) || 0));
  return normalizedFeatures([
    `action:${id}`,
    `role:${role || "other"}`,
    `cost:${cost}`,
    `kind:${actionKind(action)}`,
    `resource:${resourceKind(action)}`,
  ]);
}

function planSteps(plan) {
  return (Array.isArray(plan?.steps) ? plan.steps : [])
    .map((step) => step?.action ?? step)
    .filter(Boolean);
}

export function preferencePlanId(plan) {
  const signature = planSignature(plan);
  return signature ? `plan:${stablePlanHash(signature)}` : "";
}

function planTotalCost(plan) {
  const explicit = Number(plan?.totalCost);
  if (Number.isFinite(explicit)) return explicit;
  return planSteps(plan).reduce((total, action) => {
    const cost = action?.actionCost ?? action?.cost;
    return total + (cost === "reaction" ? 0 : Math.max(0, Number(cost) || 0));
  }, 0);
}

function planWideFeatures(plan) {
  const steps = planSteps(plan);
  const id = preferencePlanId(plan);
  const roleSequence = steps
    .map((action) => String(action?.curated?.role ?? action?.role ?? "other").toLowerCase())
    .join(">");
  return normalizedFeatures([
    id,
    `plan-sequence:${stablePlanHash(roleSequence)}`,
    `plan-length:${steps.length}`,
    `plan-cost:${planTotalCost(plan)}`,
  ]);
}

export function preferencePlanFeatures(plan) {
  return normalizedFeatures([
    ...planSteps(plan).flatMap(preferenceFeatures),
    ...planWideFeatures(plan),
  ]);
}

export function normalizePreferenceProfile(value) {
  const source = plainObject(value);
  if (source.version != null && Number(source.version) !== PROFILE_VERSION) {
    return { version: PROFILE_VERSION, examples: {} };
  }
  const examples = {};
  for (const [idValue, entryValue] of Object.entries(plainObject(source.examples))) {
    const id = normalizedToken(idValue);
    const entry = plainObject(entryValue);
    const label = normalizedLabel(entry.label);
    const features = normalizedFeatures(entry.features);
    if (!id || !label || !features.length) continue;
    examples[id] = { label, features };
  }
  return { version: PROFILE_VERSION, examples };
}

export function readPreferenceProfile(context) {
  return readProfiles()[scopeKey(context)] ?? EMPTY_PROFILE;
}

function nextPreferenceExample(profile, id, features, value) {
  const next = normalizePreferenceProfile(profile);
  const label = normalizedLabel(value);
  const current = next.examples[id]?.label ?? 0;
  if (!id || !label || current === label) {
    delete next.examples[id];
    return next;
  }
  next.examples[id] = { label, features: normalizedFeatures(features) };
  return next;
}

export function nextPlanPreferenceProfile(profile, plan, value) {
  return nextPreferenceExample(profile, preferencePlanId(plan), preferencePlanFeatures(plan), value);
}

export function setPlanPreferenceFeedback(context, plan, value) {
  const profiles = readProfiles();
  const key = scopeKey(context);
  const next = nextPlanPreferenceProfile(profiles[key], plan, value);
  profiles[key] = next;
  writeProfiles(profiles);
  return next.examples[preferencePlanId(plan)]?.label ?? 0;
}

function featureCoefficient(feature) {
  if (feature.startsWith("action:")) return 3;
  if (feature.startsWith("role:")) return 1;
  if (feature.startsWith("kind:")) return 1;
  if (feature.startsWith("cost:")) return 0.5;
  if (feature.startsWith("resource:")) return 0.5;
  return 0;
}

function planFeatureCoefficient(feature) {
  if (feature.startsWith("plan-sequence:")) return 1.5;
  if (feature.startsWith("plan-length:")) return 0.75;
  if (feature.startsWith("plan-cost:")) return 0.75;
  if (feature.startsWith("plan:")) return 3;
  return 0;
}

function profileWeights(profile) {
  const cached = weightCache.get(profile);
  if (cached) return cached;
  const weights = new Map();
  for (const example of Object.values(profile.examples)) {
    for (const feature of example.features) {
      weights.set(feature, (weights.get(feature) ?? 0) + example.label);
    }
  }
  for (const [feature, weight] of weights) {
    weights.set(feature, Math.max(-MAX_FEATURE_WEIGHT, Math.min(MAX_FEATURE_WEIGHT, weight)));
  }
  weightCache.set(profile, weights);
  return weights;
}

function adjustmentFromNormalizedProfile(normalized, action) {
  const id = preferenceActionId(action);
  const feedback = normalized.examples[id]?.label ?? 0;
  const weights = profileWeights(normalized);
  const contributions = preferenceFeatures(action).map((feature) => {
    const weight = weights.get(feature) ?? 0;
    const coefficient = featureCoefficient(feature);
    return { feature, weight, points: weight * coefficient };
  }).filter((entry) => entry.points !== 0);
  const raw = contributions.reduce((total, entry) => total + entry.points, 0);
  const scoreDelta = Math.max(-MAX_SCORE_DELTA, Math.min(MAX_SCORE_DELTA, Math.round(raw)));
  const examplesCount = Object.keys(normalized.examples).length;
  const signed = scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta);
  return {
    feedback,
    positive: feedback === 1,
    negative: feedback === -1,
    scoreDelta,
    scoreApplied: scoreDelta !== 0,
    examplesCount,
    contributions,
    reason: scoreDelta
      ? `Preference profile ${signed} (explicit deterministic feedback; capped at +/-${MAX_SCORE_DELTA}).`
      : "",
    tooltip: examplesCount
      ? `Learned from ${examplesCount} explicit rating(s); ranking adjustment ${signed}, capped at +/-${MAX_SCORE_DELTA}.`
      : `No preference feedback yet; ranking adjustment 0, capped at +/-${MAX_SCORE_DELTA}.`,
    positiveTitle: feedback === 1 ? "Remove positive feedback" : "Prefer actions like this",
    negativeTitle: feedback === -1 ? "Remove negative feedback" : "Avoid actions like this",
  };
}

export function preferenceAdjustmentFromProfile(profile, action) {
  return adjustmentFromNormalizedProfile(normalizePreferenceProfile(profile), action);
}

export function deterministicPreferenceAdjustment(context, action) {
  return adjustmentFromNormalizedProfile(readPreferenceProfile(context), action);
}

export function boundedPlanPreferenceDelta(componentScoreDelta, directScoreDelta) {
  const total = (Number(componentScoreDelta) || 0) + (Number(directScoreDelta) || 0);
  return Math.max(-PREFERENCE_SCORE_CAP, Math.min(PREFERENCE_SCORE_CAP, total));
}

function planAdjustmentFromNormalizedProfile(normalized, plan) {
  const id = preferencePlanId(plan);
  const feedback = normalized.examples[id]?.label ?? 0;
  const weights = profileWeights(normalized);
  const contributions = planWideFeatures(plan).map((feature) => {
    const weight = weights.get(feature) ?? 0;
    const coefficient = planFeatureCoefficient(feature);
    return { feature, weight, points: weight * coefficient };
  }).filter((entry) => entry.points !== 0);
  const raw = contributions.reduce((total, entry) => total + entry.points, 0);
  const scoreDelta = Math.max(-MAX_SCORE_DELTA, Math.min(MAX_SCORE_DELTA, Math.round(raw)));
  const examplesCount = Object.keys(normalized.examples).length;
  const signed = scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta);
  const demotionTooltip =
    " Thumbs-down also moves this exact plan to the end of the plan queue.";
  const activeDemotionTooltip = feedback === -1
    ? " This exact plan is moved to the end of the plan queue."
    : demotionTooltip;
  return {
    id,
    feedback,
    positive: feedback === 1,
    negative: feedback === -1,
    scoreDelta,
    scoreApplied: scoreDelta !== 0,
    examplesCount,
    contributions,
    label: "Rate plan",
    tooltip: examplesCount
      ? `Learned from ${examplesCount} rated plan(s); direct plan adjustment ${signed}, total preference impact capped at +/-${MAX_SCORE_DELTA}.${activeDemotionTooltip}`
      : `Rate this plan to teach future recommendations; total preference impact capped at +/-${MAX_SCORE_DELTA}.${demotionTooltip}`,
    positiveTitle: feedback === 1 ? "Remove positive plan feedback" : "Prefer plans like this",
    negativeTitle: feedback === -1
      ? "Remove negative plan feedback"
      : "Move this exact plan to the end of the queue",
  };
}

export function deterministicPlanPreferenceAdjustment(context, plan) {
  return planAdjustmentFromNormalizedProfile(readPreferenceProfile(context), plan);
}

export function planPreferenceAdjustmentFromProfile(profile, plan) {
  return planAdjustmentFromNormalizedProfile(normalizePreferenceProfile(profile), plan);
}
