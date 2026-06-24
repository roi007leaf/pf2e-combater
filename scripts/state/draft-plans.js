import { MODULE_ID, STORAGE_KEYS } from "../constants.js";

const SHARED_DRAFTS_FLAG = "sharedDraftPlans";

function storage() {
  return globalThis.localStorage ?? null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredDrafts() {
  return readStoredObject(STORAGE_KEYS.draftPlans);
}

function readStoredSharedDrafts() {
  return readStoredObject(STORAGE_KEYS.sharedDraftPlans);
}

function actorDocument(context) {
  return context?.actor?.document
    ?? context?.combatant?.actor
    ?? context?.combatant?.document?.actor
    ?? null;
}

function readActorSharedDrafts(context) {
  const actor = actorDocument(context);
  const value = actor?.getFlag?.(MODULE_ID, SHARED_DRAFTS_FLAG)
    ?? actor?.flags?.[MODULE_ID]?.[SHARED_DRAFTS_FLAG];
  return isPlainObject(value) ? value : {};
}

function readStoredObject(key) {
  try {
    const value = storage()?.getItem(key);
    const parsed = value ? JSON.parse(value) : {};
    return isPlainObject(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeStoredDrafts(drafts) {
  writeStoredObject(STORAGE_KEYS.draftPlans, drafts);
}

function writeStoredSharedDrafts(drafts) {
  writeStoredObject(STORAGE_KEYS.sharedDraftPlans, drafts);
}

function writeStoredObject(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
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

export function sharedDraftPlanKey(contextOrPayload) {
  const combatId = contextOrPayload?.combat?.id ?? contextOrPayload?.combatId ?? "no-combat";
  const round = contextOrPayload?.combat?.round ?? contextOrPayload?.round ?? "no-round";
  const combatantId = contextOrPayload?.combatant?.id ?? contextOrPayload?.combatantId ?? "no-combatant";
  return `${combatId}|${round}|${combatantId}`;
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

function normalizeSharedDraft(draft) {
  return {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    updatedAt: Number.isFinite(Number(draft?.updatedAt)) ? Number(draft.updatedAt) : Date.now(),
    userId: draft?.userId ?? null,
    userName: draft?.userName ?? "",
  };
}

export function readSharedDraftPlan(context) {
  const key = sharedDraftPlanKey(context);
  const drafts = [
    readStoredSharedDrafts()[key],
    readActorSharedDrafts(context)[key],
  ].filter(hasSharedDraftPlan);

  if (!drafts.length) return emptyDraftPlan();
  const draft = drafts.toSorted((left, right) => Number(right?.updatedAt ?? 0) - Number(left?.updatedAt ?? 0))[0];
  return normalizeSharedDraft(draft);
}

export function writeSharedDraftPlan(context, draft) {
  const drafts = readStoredSharedDrafts();
  drafts[sharedDraftPlanKey(context)] = normalizeSharedDraft({
    ...draft,
    userId: draft?.userId ?? globalThis.game?.user?.id ?? null,
    userName: draft?.userName ?? globalThis.game?.user?.name ?? "",
    updatedAt: Date.now(),
  });
  writeStoredSharedDrafts(drafts);
  return drafts[sharedDraftPlanKey(context)];
}

export async function writeSharedDraftPlanActorFlag(context, draft) {
  const actor = actorDocument(context);
  if (typeof actor?.setFlag !== "function") return false;

  const key = sharedDraftPlanKey(context);
  const drafts = readActorSharedDrafts(context);
  await actor.setFlag(MODULE_ID, SHARED_DRAFTS_FLAG, {
    ...drafts,
    [key]: normalizeSharedDraft(draft),
  });
  return true;
}

export function writeSharedDraftPlanPayload(payload) {
  if (!payload) return null;
  const drafts = readStoredSharedDrafts();
  drafts[sharedDraftPlanKey(payload)] = normalizeSharedDraft({
    ...payload,
    updatedAt: Date.now(),
  });
  writeStoredSharedDrafts(drafts);
  return drafts[sharedDraftPlanKey(payload)];
}

function hasSteps(draft) {
  return Array.isArray(draft?.steps) && draft.steps.length > 0;
}

export function hasSharedDraftPlan(draft) {
  return hasSteps(draft)
    || Boolean(draft?.userId)
    || Boolean(String(draft?.userName ?? "").trim())
    || draft?.type === "shareDraft";
}

export function shouldDisplaySharedDraft(localDraft, sharedDraft) {
  if (!hasSharedDraftPlan(sharedDraft)) return false;
  if (!hasSteps(localDraft)) return true;
  if (localDraft?.source === "shared") return true;

  const localUpdatedAt = Number(localDraft?.updatedAt);
  const sharedUpdatedAt = Number(sharedDraft?.updatedAt);
  if (!Number.isFinite(sharedUpdatedAt)) return false;
  if (!Number.isFinite(localUpdatedAt)) return true;
  return sharedUpdatedAt > localUpdatedAt;
}

function draftStepId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `draft-step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function upsertDraftStep(context, step) {
  const draft = readDraftPlan(context);
  const normalizedStep = {
    ...step,
    instanceId: step?.instanceId ?? draftStepId(),
  };
  const stepIndex = draft.steps.findIndex((entry) => entry.instanceId === normalizedStep.instanceId);
  const nextSteps = [...draft.steps];
  if (stepIndex >= 0) {
    nextSteps[stepIndex] = normalizedStep;
  } else {
    nextSteps.push(normalizedStep);
  }
  writeDraftPlan(context, { ...draft, steps: nextSteps });
  return normalizedStep;
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
