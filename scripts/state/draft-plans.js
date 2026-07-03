import { MODULE_ID, STORAGE_KEYS } from "../constants.js";

export const SHARED_DRAFTS_FLAG = "sharedDraftPlans";

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

// Drafts are keyed per combatant (NOT per round) so an execution plan survives turn and
// round changes. It is cleared explicitly when that combatant's turn ends.
export function draftPlanKey(context) {
  const combatId = context?.combat?.id ?? "no-combat";
  const combatantId = context?.combatant?.id ?? "no-combatant";
  return `${userId()}|${combatId}|${combatantId}`;
}

export function sharedDraftPlanKey(contextOrPayload) {
  const combatId = contextOrPayload?.combat?.id ?? contextOrPayload?.combatId ?? "no-combat";
  const combatantId = contextOrPayload?.combatant?.id ?? contextOrPayload?.combatantId ?? "no-combatant";
  return `${combatId}|${combatantId}`;
}

export function emptyDraftPlan() {
  return { steps: [], uncounted: [], updatedAt: Date.now() };
}

// Off-plan entries, accepting the pre-rename `unconditional` key so drafts saved before
// the uncounted rename keep their entries.
function uncountedEntries(draft) {
  const entries = draft?.uncounted ?? draft?.unconditional;
  return Array.isArray(entries) ? entries : [];
}

export function readDraftPlan(context) {
  const drafts = readStoredDrafts();
  const draft = drafts[draftPlanKey(context)];
  if (!draft || !Array.isArray(draft.steps)) return emptyDraftPlan();
  return {
    ...draft,
    steps: [...draft.steps],
    uncounted: [...uncountedEntries(draft)],
    updatedAt: Number.isFinite(Number(draft.updatedAt)) ? Number(draft.updatedAt) : Date.now(),
  };
}

export function writeDraftPlan(context, draft) {
  const drafts = readStoredDrafts();
  drafts[draftPlanKey(context)] = {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    uncounted: [...uncountedEntries(draft)],
    updatedAt: Date.now(),
  };
  writeStoredDrafts(drafts);
}

function normalizeSharedDraft(draft) {
  return {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    uncounted: [...uncountedEntries(draft)],
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

// Foundry's updateActor hook fires for every client watching this actor, including the one that
// made the change -- writeSharedDraftPlanActorFlag's own setFlag() call is no exception. Recognize
// that specific self-inflicted echo (and ONLY that exact shape) so callers can refresh the panel
// without treating it as a real change to the actor that should reset any pinned Auto-fill plan.
// Foundry itself stamps every update diff with "_stats" (modifiedTime/lastModifiedBy/etc.), even
// for a pure setFlag() call, so that key carries no signal about a real actor change either.
export function isSharedDraftPlanEcho(changes) {
  const topLevelKeys = Object.keys(changes ?? {}).filter((key) => key !== "flags" && key !== "_id" && key !== "_stats");
  if (topLevelKeys.length) return false;
  const flagScopes = Object.keys(changes?.flags ?? {});
  if (flagScopes.length !== 1 || flagScopes[0] !== MODULE_ID) return false;
  const ownFlagKeys = Object.keys(changes.flags[MODULE_ID] ?? {});
  return ownFlagKeys.length === 1 && ownFlagKeys[0] === SHARED_DRAFTS_FLAG;
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

function hasUncounted(draft) {
  return uncountedEntries(draft).length > 0;
}

function hasAnyEntries(draft) {
  return hasSteps(draft) || hasUncounted(draft);
}

export function hasSharedDraftPlan(draft) {
  return hasAnyEntries(draft)
    || Boolean(draft?.userId)
    || Boolean(String(draft?.userName ?? "").trim())
    || draft?.type === "shareDraft";
}

export function shouldDisplaySharedDraft(localDraft, sharedDraft) {
  if (!hasSharedDraftPlan(sharedDraft)) return false;
  if (!hasAnyEntries(localDraft)) return true;
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

export function upsertDraftStep(context, step, listKey = "steps") {
  const draft = readDraftPlan(context);
  const normalizedStep = {
    ...step,
    instanceId: step?.instanceId ?? draftStepId(),
  };
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  const stepIndex = list.findIndex((entry) => entry.instanceId === normalizedStep.instanceId);
  const nextList = [...list];
  if (stepIndex >= 0) {
    nextList[stepIndex] = normalizedStep;
  } else {
    nextList.push(normalizedStep);
  }
  writeDraftPlan(context, { ...draft, [listKey]: nextList });
  return normalizedStep;
}

export function removeDraftStep(context, instanceId, listKey = "steps") {
  const draft = readDraftPlan(context);
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  writeDraftPlan(context, {
    ...draft,
    [listKey]: list.filter((step) => step.instanceId !== instanceId),
  });
}

export function moveDraftStep(context, instanceId, direction, listKey = "steps") {
  const draft = readDraftPlan(context);
  const steps = Array.isArray(draft[listKey]) ? [...draft[listKey]] : [];
  const index = steps.findIndex((step) => step.instanceId === instanceId);
  const offset = Math.sign(Number(direction) || 0);
  const nextIndex = index + offset;
  if (index < 0 || offset === 0 || nextIndex < 0 || nextIndex >= steps.length) return false;

  [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
  writeDraftPlan(context, { ...draft, [listKey]: steps });
  return true;
}

// Which draft list owns this instanceId. Plan steps are the default for unknown ids so a
// brand-new plan step still routes correctly.
export function draftListForInstance(draft, instanceId) {
  const uncounted = uncountedEntries(draft);
  return uncounted.some((step) => step?.instanceId === instanceId) ? "uncounted" : "steps";
}

export function clearDraftPlan(context) {
  const drafts = readStoredDrafts();
  delete drafts[draftPlanKey(context)];
  writeStoredDrafts(drafts);
}

function combatantList(combat) {
  const combatants = combat?.combatants;
  if (!combatants) return [];
  if (Array.isArray(combatants)) return combatants;
  if (Array.isArray(combatants.contents)) return combatants.contents;
  if (typeof combatants.values === "function") return Array.from(combatants.values());
  if (typeof combatants[Symbol.iterator] === "function") return Array.from(combatants);
  return [];
}

function actorSharedDrafts(actor) {
  const value = actor?.getFlag?.(MODULE_ID, SHARED_DRAFTS_FLAG)
    ?? actor?.flags?.[MODULE_ID]?.[SHARED_DRAFTS_FLAG];
  return isPlainObject(value) ? value : {};
}

function deleteKeysBySegment(store, segmentIndex, value) {
  let changed = false;
  for (const key of Object.keys(store)) {
    if (key.split("|")[segmentIndex] === value) {
      delete store[key];
      changed = true;
    }
  }
  return changed;
}

function combatActorsByIdentity(combat) {
  const actors = new Map();
  for (const combatant of combatantList(combat)) {
    const actor = combatant?.actor ?? combatant?.document?.actor ?? null;
    const identity = actor?.uuid ?? actor?.id;
    if (actor && identity && !actors.has(identity)) actors.set(identity, actor);
  }
  return [...actors.values()];
}

// Remove every draft tied to a combat — the local per-user store, the shared socket store, and
// each combatant's actor-flag mirror — so nothing lingers after the combat is deleted. Local keys
// are userId|combatId|combatantId; shared/flag keys are combatId|combatantId, so both are matched
// on the combatId segment. Actors are deduped so a setFlag race can't clobber sibling combatants.
export async function clearCombatDraftPlans(combat) {
  const combatId = combat?.id;
  if (!combatId) return;

  const locals = readStoredDrafts();
  if (deleteKeysBySegment(locals, 1, combatId)) writeStoredDrafts(locals);

  const shared = readStoredSharedDrafts();
  if (deleteKeysBySegment(shared, 0, combatId)) writeStoredSharedDrafts(shared);

  await Promise.all(combatActorsByIdentity(combat).map(async (actor) => {
    if (typeof actor?.setFlag !== "function") return;
    const next = { ...actorSharedDrafts(actor) };
    if (!deleteKeysBySegment(next, 0, combatId)) return;
    try {
      await actor.setFlag(MODULE_ID, SHARED_DRAFTS_FLAG, next);
    } catch (_error) {
      // Flag write may be denied for non-owners; the local and shared stores are already cleared.
    }
  }));
}

// Clear a shared (player→GM) plan from both stores so an ended turn's plan does not linger.
export async function clearSharedDraftPlan(context) {
  const key = sharedDraftPlanKey(context);
  const drafts = readStoredSharedDrafts();
  if (key in drafts) {
    delete drafts[key];
    writeStoredSharedDrafts(drafts);
  }

  const actor = actorDocument(context);
  const actorDrafts = readActorSharedDrafts(context);
  if (typeof actor?.setFlag === "function" && key in actorDrafts) {
    const next = { ...actorDrafts };
    delete next[key];
    try {
      await actor.setFlag(MODULE_ID, SHARED_DRAFTS_FLAG, next);
    } catch (_error) {
      // Flag write may be denied for non-owners; the local store is already cleared.
    }
  }
}
