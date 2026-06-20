import { STORAGE_KEYS } from "../constants.js";

function storage() {
  return globalThis.localStorage ?? null;
}

function readStoredDrafts() {
  try {
    const value = storage()?.getItem(STORAGE_KEYS.draftPlans);
    return value ? JSON.parse(value) : {};
  } catch (_error) {
    return {};
  }
}

function writeStoredDrafts(drafts) {
  try {
    storage()?.setItem(STORAGE_KEYS.draftPlans, JSON.stringify(drafts));
  } catch (_error) {
    // Storage is optional in tests, headless Foundry setup, and private windows.
  }
}

function userId() {
  return globalThis.game?.user?.id ?? "anonymous";
}

export function draftPlanKey(context) {
  const combatId = context?.combat?.id ?? "no-combat";
  const round = context?.combat?.round ?? "no-round";
  const combatantId = context?.combatant?.id ?? "no-combatant";
  return `${userId()}|${combatId}|${round}|${combatantId}`;
}

export function emptyDraftPlan() {
  return { steps: [], updatedAt: Date.now() };
}

export function readDraftPlan(context) {
  const drafts = readStoredDrafts();
  const draft = drafts[draftPlanKey(context)];
  if (!draft || !Array.isArray(draft.steps)) return emptyDraftPlan();
  return {
    ...draft,
    steps: [...draft.steps],
    updatedAt: Number.isFinite(Number(draft.updatedAt)) ? Number(draft.updatedAt) : Date.now(),
  };
}

export function writeDraftPlan(context, draft) {
  const drafts = readStoredDrafts();
  drafts[draftPlanKey(context)] = {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    updatedAt: Date.now(),
  };
  writeStoredDrafts(drafts);
}

export function upsertDraftStep(context, step) {
  const draft = readDraftPlan(context);
  const stepIndex = draft.steps.findIndex((entry) => entry.instanceId === step.instanceId);
  const nextSteps = [...draft.steps];
  if (stepIndex >= 0) {
    nextSteps[stepIndex] = step;
  } else {
    nextSteps.push(step);
  }
  writeDraftPlan(context, { ...draft, steps: nextSteps });
}

export function removeDraftStep(context, instanceId) {
  const draft = readDraftPlan(context);
  writeDraftPlan(context, {
    ...draft,
    steps: draft.steps.filter((step) => step.instanceId !== instanceId),
  });
}

export function clearDraftPlan(context) {
  const drafts = readStoredDrafts();
  delete drafts[draftPlanKey(context)];
  writeStoredDrafts(drafts);
}
