import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { planSignature, stablePlanHash } from "../engine/planner/plan-signature.js";
import { t } from "../i18n.js";

// Learned Auto-fill preferences, per user and actor. Two kinds of evidence:
// - plan ratings (thumbs up/down): explicit, weight 1, keyed by the exact plan so a thumbs-down can
//   also demote that plan;
// - draft edits after Auto-fill: removing a suggested step is a soft "no" for that action, adding
//   your own is a soft "yes" (keyed by action, accumulating up to EDIT_LIMIT).
// Every example carries the features of its actions (the action itself, its kind, role, cost and
// resource). Weights are the clamped sum of labels per feature, so the model is order-independent
// and explainable; scoring adds a capped bonus per candidate from those weights.

const PROFILE_VERSION = 3;
const ACCEPTED_VERSIONS = new Set([2, 3]);
const MAX_FEATURE_WEIGHT = 2;
export const PREFERENCE_SCORE_CAP = 20;
export const PLAN_PREFERENCE_SCORE_CAP = 24;
const EDIT_STEP = 0.4;
const EDIT_LIMIT = 1.2;
const MAX_EXAMPLES = 80;
const FLAG_KEY = "preferenceProfiles";
const EMPTY_PROFILE = Object.freeze({ version: PROFILE_VERSION, examples: Object.freeze({}), names: Object.freeze({}) });

let cachedSource;
let cachedProfiles = {};
// Set while our own flag write is in flight: the document still holds the old value until the
// server round-trip lands, so reads keep serving what we just wrote.
let pendingWrite = null;
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

function normalizedLabel(value, limit = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 0;
  return Math.round(Math.max(-limit, Math.min(limit, number)) * 100) / 100;
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

function parseProfiles(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Object.fromEntries(Object.entries(plainObject(parsed))
    .map(([key, profile]) => [key, normalizePreferenceProfile(profile)]));
}

// The user's own flag follows them to any device; localStorage is the fallback (tests, no user
// document) and the source the flag is migrated from the first time.
function userFlagRaw() {
  return globalThis.game?.user?.flags?.[MODULE_ID]?.[FLAG_KEY];
}

function readProfiles() {
  try {
    if (pendingWrite !== null) return cachedProfiles;
    const flagRaw = userFlagRaw();
    const source = flagRaw ?? storage()?.getItem(STORAGE_KEYS.preferenceProfiles) ?? null;
    if (source === cachedSource) return cachedProfiles;
    cachedProfiles = source ? parseProfiles(source) : {};
    cachedSource = source;
    if (flagRaw === undefined && source && typeof globalThis.game?.user?.setFlag === "function") {
      globalThis.game.user.setFlag(MODULE_ID, FLAG_KEY, JSON.stringify(cachedProfiles)).catch?.(() => {});
    }
    return cachedProfiles;
  } catch (_error) {
    cachedSource = null;
    cachedProfiles = {};
    return {};
  }
}

function writeProfiles(profiles) {
  try {
    cachedProfiles = Object.fromEntries(Object.entries(plainObject(profiles))
      .map(([key, profile]) => [key, normalizePreferenceProfile(profile)]));
    const raw = JSON.stringify(cachedProfiles);
    storage()?.setItem(STORAGE_KEYS.preferenceProfiles, raw);
    const user = globalThis.game?.user;
    if (typeof user?.setFlag === "function") {
      // Stored as a JSON string so a write replaces the whole profile set (an object flag would
      // merge, and forgotten examples would come back).
      pendingWrite = raw;
      const settle = () => { if (pendingWrite === raw) pendingWrite = null; };
      Promise.resolve(user.setFlag(MODULE_ID, FLAG_KEY, raw)).then(settle, settle);
    }
    cachedSource = raw;
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
  // Cantrips cost nothing: they share a spellcasting entry with slotted spells, but aren't one.
  const spellResource = String(action?.spellResource?.type ?? "").toLowerCase();
  const isCantrip = action?.isCantrip === true || action?.activityProfile?.cantrip === true
    || spellResource === "cantrip"
    || (Array.isArray(action?.traits) && action.traits.some((trait) => String(trait?.slug ?? trait?.name ?? trait).toLowerCase() === "cantrip"));
  if (isCantrip) return "at-will";
  if (spellResource === "focus") return "focus";
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

export function preferencePlanFeatures(plan, actions = null) {
  return normalizedFeatures([
    ...(Array.isArray(actions) ? actions : planSteps(plan)).flatMap(preferenceFeatures),
    ...planWideFeatures(plan),
  ]);
}

export function normalizePreferenceProfile(value) {
  const source = plainObject(value);
  if (source.version != null && !ACCEPTED_VERSIONS.has(Number(source.version))) {
    return { version: PROFILE_VERSION, examples: {}, names: {} };
  }
  const examples = {};
  for (const [idValue, entryValue] of Object.entries(plainObject(source.examples))) {
    const id = normalizedToken(idValue);
    const entry = plainObject(entryValue);
    const label = normalizedLabel(entry.label, id.startsWith("edit:") ? EDIT_LIMIT : 1);
    const features = normalizedFeatures(entry.features);
    if (!id || !label || !features.length) continue;
    examples[id] = { label, features, ...(Number.isFinite(Number(entry.at)) ? { at: Number(entry.at) } : {}) };
  }
  const names = Object.fromEntries(Object.entries(plainObject(source.names))
    .map(([id, name]) => [normalizedToken(id), normalizedToken(name).slice(0, 80)])
    .filter(([id, name]) => id && name));
  return { version: PROFILE_VERSION, examples, names };
}

export function readPreferenceProfile(context) {
  return readProfiles()[scopeKey(context)] ?? EMPTY_PROFILE;
}

function now() {
  return Date.now();
}

// Keep the newest examples; old ratings fade out instead of piling up forever.
function trimmedExamples(examples) {
  const entries = Object.entries(examples);
  if (entries.length <= MAX_EXAMPLES) return examples;
  return Object.fromEntries(entries
    .toSorted(([, left], [, right]) => (Number(right.at) || 0) - (Number(left.at) || 0))
    .slice(0, MAX_EXAMPLES));
}

function withNames(profile, actions) {
  const names = { ...profile.names };
  for (const action of actions ?? []) {
    const id = preferenceActionId(action);
    const name = normalizedToken(action?.name ?? action?.label);
    if (id && name) names[id] = name.slice(0, 80);
  }
  return { ...profile, names };
}

function nextPreferenceExample(profile, id, features, value) {
  const next = normalizePreferenceProfile(profile);
  const label = normalizedLabel(value);
  const current = next.examples[id]?.label ?? 0;
  if (!id || !label || current === label) {
    delete next.examples[id];
    return next;
  }
  next.examples[id] = { label, features: normalizedFeatures(features), at: now() };
  next.examples = trimmedExamples(next.examples);
  return next;
}

export function nextPlanPreferenceProfile(profile, plan, value, actions = null) {
  const next = nextPreferenceExample(profile, preferencePlanId(plan), preferencePlanFeatures(plan, actions), value);
  return withNames(next, Array.isArray(actions) ? actions : planSteps(plan));
}

// `actions` are the plan's real actions (the draft only stores names), so what's learned matches
// the candidates Auto-fill scores later.
export function setPlanPreferenceFeedback(context, plan, value, { actions = null } = {}) {
  const profiles = readProfiles();
  const key = scopeKey(context);
  const next = nextPlanPreferenceProfile(profiles[key], plan, value, actions);
  profiles[key] = next;
  writeProfiles(profiles);
  return next.examples[preferencePlanId(plan)]?.label ?? 0;
}

export function nextEditPreferenceProfile(profile, action, direction) {
  const next = normalizePreferenceProfile(profile);
  const id = `edit:${preferenceActionId(action)}`;
  const label = normalizedLabel((next.examples[id]?.label ?? 0) + Math.sign(Number(direction) || 0) * EDIT_STEP, EDIT_LIMIT);
  if (!label) delete next.examples[id];
  else next.examples[id] = { label, features: preferenceFeatures(action), at: now() };
  next.examples = trimmedExamples(next.examples);
  return withNames(next, [action]);
}

// A soft signal from editing an Auto-filled draft: -1 when a suggested step is removed, +1 when
// the user adds their own action to it.
export function recordPreferenceEdit(context, action, direction) {
  if (!action || !direction) return;
  const profiles = readProfiles();
  const key = scopeKey(context);
  profiles[key] = nextEditPreferenceProfile(profiles[key], action, direction);
  writeProfiles(profiles);
}

export function forgetPreferenceFeature(profile, feature = null) {
  const next = normalizePreferenceProfile(profile);
  if (!feature) return { version: PROFILE_VERSION, examples: {}, names: {} };
  for (const [id, example] of Object.entries(next.examples)) {
    const features = example.features.filter((entry) => entry !== feature);
    if (features.length === example.features.length) continue;
    if (features.length) next.examples[id] = { ...example, features };
    else delete next.examples[id];
  }
  return next;
}

export function forgetLearnedPreference(context, feature = null) {
  const profiles = readProfiles();
  const key = scopeKey(context);
  profiles[key] = forgetPreferenceFeature(profiles[key], feature);
  writeProfiles(profiles);
}

function featureCoefficient(feature) {
  if (feature.startsWith("action:")) return 6;
  if (feature.startsWith("role:")) return 2;
  if (feature.startsWith("kind:")) return 2;
  if (feature.startsWith("cost:")) return 0.5;
  if (feature.startsWith("resource:")) return 0.5;
  return 0;
}

function planFeatureCoefficient(feature) {
  if (feature.startsWith("plan-sequence:")) return 3;
  if (feature.startsWith("plan-length:")) return 1.5;
  if (feature.startsWith("plan-cost:")) return 1.5;
  if (feature.startsWith("plan:")) return 6;
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
    weights.set(feature, Math.max(-MAX_FEATURE_WEIGHT, Math.min(MAX_FEATURE_WEIGHT, Math.round(weight * 100) / 100)));
  }
  weightCache.set(profile, weights);
  return weights;
}

const KIND_LABELS = () => ({
  attack: t("Preference.Kind.Attack", "attacks"),
  spell: t("Preference.Kind.Spell", "spells"),
  movement: t("Preference.Kind.Movement", "movement"),
  skill: t("Preference.Kind.Skill", "skill actions"),
  consumable: t("Preference.Kind.Consumable", "consumables"),
  other: t("Preference.Kind.Other", "other actions"),
});

function featureLabel(profile, feature, action = null) {
  const [type, ...rest] = feature.split(":");
  const value = rest.join(":");
  if (type === "action") return profile.names?.[value] ?? action?.name ?? value;
  if (type === "kind") return KIND_LABELS()[value] ?? value;
  if (type === "role") return value.replace(/-/g, " ");
  return value;
}

function signedPoints(points) {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function preferenceReason(profile, contributions, scoreDelta, action) {
  if (!scoreDelta) return "";
  const top = contributions
    .filter((entry) => Math.sign(entry.points) === Math.sign(scoreDelta))
    .toSorted((left, right) => Math.abs(right.points) - Math.abs(left.points))[0];
  if (!top) return "";
  const name = featureLabel(profile, top.feature, action);
  const amount = signedPoints(scoreDelta);
  if (top.feature.startsWith("action:")) {
    return scoreDelta > 0
      ? t("Preference.ReasonPicks", "You usually pick {name} ({amount}).", { name, amount })
      : t("Preference.ReasonSkips", "You usually skip {name} ({amount}).", { name, amount });
  }
  return scoreDelta > 0
    ? t("Preference.ReasonPrefersKind", "You tend to prefer {name} ({amount}).", { name, amount })
    : t("Preference.ReasonAvoidsKind", "You tend to avoid {name} ({amount}).", { name, amount });
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
  const scoreDelta = Math.max(-PREFERENCE_SCORE_CAP, Math.min(PREFERENCE_SCORE_CAP, Math.round(raw)));
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
    reason: preferenceReason(normalized, contributions, scoreDelta, action),
    tooltip: examplesCount
      ? `Learned from ${examplesCount} rating(s) and edit(s); ranking adjustment ${signed}, capped at +/-${PREFERENCE_SCORE_CAP}.`
      : `No preference feedback yet; ranking adjustment 0, capped at +/-${PREFERENCE_SCORE_CAP}.`,
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
  return Math.max(-PLAN_PREFERENCE_SCORE_CAP, Math.min(PLAN_PREFERENCE_SCORE_CAP, total));
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
  const scoreDelta = Math.max(-PLAN_PREFERENCE_SCORE_CAP, Math.min(PLAN_PREFERENCE_SCORE_CAP, Math.round(raw)));
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
      ? `Learned from ${examplesCount} rating(s) and edit(s); direct plan adjustment ${signed}, total preference impact capped at +/-${PLAN_PREFERENCE_SCORE_CAP}.${activeDemotionTooltip}`
      : `Rate this plan to teach future recommendations; total preference impact capped at +/-${PLAN_PREFERENCE_SCORE_CAP}.${demotionTooltip}`,
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

// What this player has taught Auto-fill for this actor, strongest first: specific actions, then
// broad kinds of action. Feeds the "Learned preferences" list in the Tactic window.
export function learnedPreferenceEntries(profile, limit = 8) {
  const normalized = normalizePreferenceProfile(profile);
  const weights = profileWeights(normalized);
  return [...weights.entries()]
    .filter(([feature, weight]) => (feature.startsWith("action:") || feature.startsWith("kind:")) && weight !== 0)
    .map(([feature, weight]) => {
      const points = Math.round(weight * featureCoefficient(feature));
      const label = featureLabel(normalized, feature);
      return { feature, points, label: label.charAt(0).toUpperCase() + label.slice(1), kind: feature.startsWith("kind:") };
    })
    .filter((entry) => entry.points !== 0)
    .toSorted((left, right) => Math.abs(right.points) - Math.abs(left.points) || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map((entry) => ({ ...entry, amount: signedPoints(entry.points), positive: entry.points > 0 }));
}

export function learnedPreferenceView(context) {
  const profile = readPreferenceProfile(context);
  return {
    entries: learnedPreferenceEntries(profile),
    count: Object.keys(profile.examples).length,
  };
}
