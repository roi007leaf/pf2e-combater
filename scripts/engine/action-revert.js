import {
  actorDocument,
  canvasTokenById,
  decreaseCondition,
  findSpellcastingEntry,
  increaseCondition,
  resetDraftExecution,
  tokenId,
} from "./action-executor.js";
import { t } from "../i18n.js";

async function moveTokenTo(document, point) {
  if (typeof document.update === "function") {
    await document.update({ x: point.x, y: point.y });
    return;
  }
  if (typeof document.move === "function") {
    await document.move(
      { x: point.x, y: point.y, action: "walk", explicit: true, checkpoint: true, snapped: true },
      { method: "api" },
    );
    return;
  }
  throw new Error("token movement API is unavailable");
}

// Retrace the executed move backward: step through the captured path in reverse (skipping the
// token's current spot, ending at the origin) so a multi-waypoint Stride unwinds per waypoint
// rather than sliding straight back. Falls back to a single hop to the origin.
async function revertMovement(op, { context }) {
  const token = canvasTokenById(op?.tokenId) ?? canvasTokenById(tokenId(context));
  const document = token?.document ?? token ?? null;
  if (!document) throw new Error("token is unavailable");

  const steps = Array.isArray(op?.path) && op.path.length > 1
    ? op.path.slice(0, -1).reverse()
    : (op?.origin ? [op.origin] : []);
  if (!steps.length) throw new Error("token is unavailable");

  for (const step of steps) {
    await moveTokenTo(document, step);
  }
}

async function revertCondition(op, { actor }) {
  // `remove: true` ops undo a condition the action APPLIED (e.g. Drop Prone) by clearing it;
  // otherwise the action REMOVED the condition (e.g. Stand) and revert restores it.
  if (op?.remove === true) {
    const cleared = await decreaseCondition(actor, op?.slug, { forceRemove: true });
    if (!cleared) throw new Error(t("Revert.CouldNotClear", "could not clear {slug}", { slug: op?.slug ?? "condition" }));
    return;
  }
  const restored = await increaseCondition(actor, op?.slug, op?.options ?? {});
  if (!restored) throw new Error(t("Revert.CouldNotRestoreCond", "could not restore {slug}", { slug: op?.slug ?? "condition" }));
}

// Restore a weapon's carry state (undo a Draw or a Release/Drop).
async function revertCarryType(op) {
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  try {
    const item = await globalThis.fromUuid(op.itemUuid);
    const actor = item?.actor ?? item?.parent ?? null;
    const target = { carryType: op.carryType ?? "worn", handsHeld: op.handsHeld ?? 0 };
    if (typeof actor?.changeCarryType === "function") {
      await actor.changeCarryType(item, target);
      return;
    }
    if (typeof item?.update === "function") {
      await item.update({
        "system.equipped.carryType": target.carryType,
        "system.equipped.handsHeld": target.handsHeld,
      });
    }
  } catch (_error) {
    // Best-effort: the weapon may have moved or been removed since execution.
  }
}

// True only when we can positively confirm an embedded document is already gone from its
// collection. Returns false when we cannot check, so a real deletion is still attempted.
function confirmedRemoved(collection, id) {
  return Boolean(collection?.get) && id != null && !collection.get(id);
}

async function deleteLinkedAreaEffect(effectUuid) {
  if (!effectUuid || typeof globalThis.fromUuid !== "function") return;
  try {
    const effect = await globalThis.fromUuid(effectUuid);
    if (typeof effect?.delete !== "function") return;
    // Skip only if another path (the deleteItem cascade, unsustained cleanup) already removed it.
    if (confirmedRemoved(effect.parent?.items, effect.id)) return;
    await effect.delete();
  } catch (_error) {
    // Best-effort: the timer effect may already be gone.
  }
}

async function revertRegion(op) {
  // Remove the linked countdown effect too, so reverting a placed area also clears its timer.
  await deleteLinkedAreaEffect(op?.effectUuid);

  const scene = (op?.sceneId && globalThis.game?.scenes?.get?.(op.sceneId))
    ?? globalThis.canvas?.scene
    ?? null;
  if (!op?.regionId || !scene) return;
  // Idempotent: skip only if the region is confirmed gone (e.g. removed by the effect cascade).
  if (confirmedRemoved(scene.regions, op.regionId)) return;
  if (typeof scene.deleteEmbeddedDocuments === "function") {
    await scene.deleteEmbeddedDocuments("Region", [op.regionId]);
    return;
  }
  const region = scene.regions?.get?.(op.regionId);
  if (typeof region?.delete === "function") {
    await region.delete();
    return;
  }
  throw new Error("region deletion API is unavailable");
}

async function revertChat(op) {
  const id = op?.messageId;
  if (!id) return;
  const message = globalThis.game?.messages?.get?.(id) ?? null;
  if (typeof message?.delete === "function") {
    await message.delete();
    return;
  }
  if (typeof globalThis.ChatMessage?.deleteDocuments === "function") {
    await globalThis.ChatMessage.deleteDocuments([id]);
    return;
  }
  throw new Error("chat message could not be deleted");
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slotKeyForRank(rank) {
  const value = numeric(rank);
  return value === null || value < 0 ? null : `slot${value}`;
}

function setPath(root, path, value) {
  const parts = String(path ?? "").split(".").filter(Boolean);
  if (!parts.length || !root || typeof root !== "object") return false;
  let target = root;
  for (const part of parts.slice(0, -1)) {
    const key = /^\d+$/.test(part) ? Number(part) : part;
    if (!target || typeof target !== "object" || !(key in target)) return false;
    target = target[key];
  }
  const last = parts.at(-1);
  const key = /^\d+$/.test(last) ? Number(last) : last;
  if (!target || typeof target !== "object") return false;
  target[key] = value;
  return true;
}

async function updateEntryPath(entry, path, value) {
  if (!entry || !path) return false;
  if (typeof entry.update === "function") {
    await entry.update({ [path]: value });
    return true;
  }
  return setPath(entry, path, value);
}

function normalizedIdentity(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rawIdentityValues(source, depth = 0) {
  if (source === null || source === undefined || depth > 2) return [];
  if (["string", "number"].includes(typeof source)) return [source];
  if (typeof source !== "object") return [];
  return [
    source.id,
    source._id,
    source.uuid,
    source.sourceId,
    source.slug,
    source.name,
    source.system?.slug?.value,
    source.system?.slug,
    source.system?.source?.value,
    source.system?.source?.id,
    source.flags?.core?.sourceId,
    source.itemId,
    source.spellId,
    source.spellUuid,
    source.spellSlug,
    source.preparedId,
    source.preparedUuid,
    source.preparedSlug,
    ...rawIdentityValues(source.item, depth + 1),
    ...rawIdentityValues(source.spell, depth + 1),
    ...rawIdentityValues(source.spellItem, depth + 1),
  ];
}

function identityValues(...sources) {
  return [...new Set(sources.flatMap((source) =>
    rawIdentityValues(source).flatMap((value) => {
      const text = String(value ?? "").trim();
      const normalized = normalizedIdentity(text);
      return [text, normalized].filter(Boolean);
    }),
  ))];
}

function preparedExpendedValue(preparedSpell) {
  if (typeof preparedSpell?.expended === "boolean") return preparedSpell.expended;
  if (typeof preparedSpell?.expended?.value === "boolean") return preparedSpell.expended.value;
  if (typeof preparedSpell?.system?.expended === "boolean") return preparedSpell.system.expended;
  if (typeof preparedSpell?.system?.expended?.value === "boolean") return preparedSpell.system.expended.value;
  return false;
}

function preparedExpendedPath(slotKey, preparedIndex, preparedSpell) {
  const base = `system.slots.${slotKey}.prepared.${preparedIndex}`;
  if (preparedSpell?.expended && typeof preparedSpell.expended === "object" && "value" in preparedSpell.expended) {
    return `${base}.expended.value`;
  }
  if (preparedSpell?.system?.expended && typeof preparedSpell.system.expended === "object" && "value" in preparedSpell.system.expended) {
    return `${base}.system.expended.value`;
  }
  if (typeof preparedSpell?.system?.expended === "boolean") return `${base}.system.expended`;
  return `${base}.expended`;
}

function preparedSlotRows(entry, op) {
  const slots = entry?.system?.slots ?? {};
  const rankSlotKey = slotKeyForRank(op?.rank);
  const slotKeys = op?.slotKey
    ? [op.slotKey]
    : (rankSlotKey ? [rankSlotKey] : Object.keys(slots));
  return slotKeys.flatMap((slotKey) => {
    const prepared = Array.isArray(slots?.[slotKey]?.prepared) ? slots[slotKey].prepared : [];
    return prepared.map((preparedSpell, preparedIndex) => ({ slotKey, preparedIndex, preparedSpell }));
  });
}

function findPreparedSlot(entry, op) {
  const rows = preparedSlotRows(entry, op);
  if (!rows.length) return null;

  const spellIds = new Set(identityValues(op));
  if (spellIds.size) {
    const matches = rows.filter(({ preparedSpell }) =>
      identityValues(preparedSpell).some((id) => spellIds.has(id)),
    );
    const expendedMatches = matches.filter(({ preparedSpell }) => preparedExpendedValue(preparedSpell));
    if (expendedMatches.length === 1) return expendedMatches[0];
    if (matches.length === 1) return matches[0];
  }

  const expendedRows = rows.filter(({ preparedSpell }) => preparedExpendedValue(preparedSpell));
  return expendedRows.length === 1 ? expendedRows[0] : null;
}

async function restorePreparedSlot(entry, op, apiErrors = []) {
  let slotKey = op?.slotKey ?? slotKeyForRank(op?.rank);
  let preparedIndex = Number.isInteger(op?.preparedIndex) ? op.preparedIndex : null;
  let prepared = slotKey ? entry?.system?.slots?.[slotKey]?.prepared : null;
  let preparedSpell = preparedIndex !== null && Array.isArray(prepared) ? prepared[preparedIndex] : null;

  if (!preparedSpell) {
    const inferred = findPreparedSlot(entry, op);
    if (!inferred) return false;
    slotKey = inferred.slotKey;
    preparedIndex = inferred.preparedIndex;
    prepared = entry?.system?.slots?.[slotKey]?.prepared;
    preparedSpell = inferred.preparedSpell;
  }

  if (!Array.isArray(prepared) || !preparedSpell || preparedIndex === null) return false;
  const expended = op.preparedExpendedBefore === true;

  if (typeof entry.setSlotExpendedState === "function" && op?.rank != null) {
    try {
      await entry.setSlotExpendedState(op.rank, preparedIndex, expended);
      return true;
    } catch (error) {
      apiErrors.push(error);
    }
  }

  return updateEntryPath(entry, preparedExpendedPath(slotKey, preparedIndex, preparedSpell), expended);
}

async function restoreSlotPool(entry, op) {
  if (!op?.slotKey) return false;
  const updates = [];
  const valueBefore = numeric(op.valueBefore);
  const remainingBefore = numeric(op.remainingBefore);
  if (valueBefore !== null) updates.push([`system.slots.${op.slotKey}.value`, valueBefore]);
  if (remainingBefore !== null) updates.push([`system.slots.${op.slotKey}.remaining`, remainingBefore]);
  if (!updates.length) return false;

  for (const [path, value] of updates) {
    const updated = await updateEntryPath(entry, path, value);
    if (!updated) return false;
  }
  return true;
}

async function revertSlot(op, { actor, warnings }) {
  const entry = findSpellcastingEntry(actor, {
    spellcastingEntryId: op?.entryId,
    spellcastingEntryUuid: op?.entryUuid,
  });
  if (!entry) {
    warnings.push(t("Revert.SlotManual", "Spell slot could not be auto-restored - restore it manually."));
    return;
  }

  const preparedApiErrors = [];
  if (await restorePreparedSlot(entry, op, preparedApiErrors)) return;

  let apiError = null;
  if (op?.slotIdExplicit !== false && typeof entry.setSlotExpendedState === "function" && op?.slotId != null && op?.rank != null) {
    try {
      await entry.setSlotExpendedState(op.rank, op.slotId, false);
      return;
    } catch (error) {
      apiError = error;
    }
  }

  if (await restoreSlotPool(entry, op)) return;

  if (apiError) {
    warnings.push(t("Revert.SlotApiFailed", "Spell slot API restore failed: {error}", { error: apiError?.message ?? apiError }));
    return;
  }
  if (preparedApiErrors.length) {
    const error = preparedApiErrors[0];
    warnings.push(t("Revert.PreparedSlotApiFailed", "Prepared spell slot API restore failed: {error}", { error: error?.message ?? error }));
    return;
  }
  warnings.push(t("Revert.SlotManual", "Spell slot could not be auto-restored - restore it manually."));
}

async function applyRevertOp(op, scope) {
  switch (op?.kind) {
    case "movement":
      return revertMovement(op, scope);
    case "condition":
      return revertCondition(op, scope);
    case "region":
      return revertRegion(op);
    case "carry-type":
      return revertCarryType(op);
    case "chat":
      return revertChat(op);
    case "slot":
      return revertSlot(op, scope);
    default:
      return undefined;
  }
}

// Undo a single executed step. Each sub-operation is isolated so one failure cannot block
// the rest, and the step's execution status is always reset to "pending" so it can be
// re-executed. Stored destination/target/area choices are left intact on the step.
export async function revertDraftStep({ context, step } = {}) {
  const revert = step?.execution?.revert;
  const warnings = [...(revert?.manualWarnings ?? [])];
  const resetPatch = { execution: { status: "pending" } };
  if (step?.execution?.status !== "done" || !Array.isArray(revert?.ops)) {
    return { status: "reverted", patch: resetPatch, warnings };
  }

  const actor = actorDocument(context);
  for (const op of revert.ops) {
    try {
      await applyRevertOp(op, { context, actor, warnings });
    } catch (error) {
      warnings.push(t("Revert.CouldNotRevert", "Could not revert {kind}: {error}", { kind: op?.kind ?? "action", error: error?.message ?? error }));
    }
  }
  return { status: "reverted", patch: resetPatch, warnings };
}

// Revert every completed step across the plan and uncounted lists in reverse execution
// order, then return the status-reset draft. Ordering is by execution.completedAt (newest
// first); ties fall back to reverse list position so plan-only drafts behave exactly as before.
// `contextForStep` lets callers resolve a per-step context (multi-combatant drafts).
export async function revertDraftExecution({ context, draft, contextForStep } = {}) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const uncounted = Array.isArray(draft?.uncounted) ? draft.uncounted : [];
  const warnings = [];
  const executed = [...steps, ...uncounted]
    .map((step, index) => ({ step, index, at: Number(step?.execution?.completedAt) || 0 }))
    .filter((entry) => entry.step?.execution?.status === "done")
    .sort((left, right) => (right.at - left.at) || (right.index - left.index));
  for (const { step } of executed) {
    const stepContext = contextForStep?.(step) ?? context;
    const result = await revertDraftStep({ context: stepContext, step });
    warnings.push(...(result.warnings ?? []));
  }
  return { draft: resetDraftExecution(draft), warnings };
}
