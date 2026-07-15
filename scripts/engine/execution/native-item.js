import { systemValue } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import { buildSustainedSpellEffectData, parseSpellDuration } from "../area/duration.js";
import { chatActionRevert } from "./chat-revert.js";
import { flushPendingChat, rollActionDamageMessages } from "./damage.js";
import { createGuidance } from "./guidance.js";
import { attachRevertOp, executionPatch } from "./results.js";
import { setTarget } from "./targets.js";
import { pf2eRuntime } from "../../runtime/pf2e-runtime.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function slotKeyForRank(rank) {
  const value = numeric(rank, null);
  return value === null || value < 0 ? null : `slot${value}`;
}

function identityValues(...sources) {
  return sources
    .flatMap((source) => [
      source?.id,
      source?._id,
      source?.uuid,
      source?.sourceId,
      source?.slug,
      source?.system?.slug?.value,
      source?.system?.slug,
      source?.itemId,
      source?.spellId,
      source?.spell?.id,
      source?.spell?._id,
      source?.spell?.uuid,
      source?.spell?.sourceId,
      source?.spell?.slug,
      source?.spell?.system?.slug?.value,
      source?.spell?.system?.slug,
    ])
    .filter(Boolean)
    .map((value) => String(value));
}

function slotEntries(entry) {
  const slots = entry?.system?.slots ?? {};
  return Object.entries(slots).filter(([, slot]) => slot && typeof slot === "object");
}

function findPreparedSpellSlot(entry, action) {
  const spellIds = new Set(identityValues(action, action?.item));
  if (!spellIds.size) return null;

  for (const [slotKey, slot] of slotEntries(entry)) {
    const prepared = Array.isArray(slot?.prepared) ? slot.prepared : [];
    const preparedIndex = prepared.findIndex((preparedSpell) =>
      identityValues(preparedSpell).some((id) => spellIds.has(id)),
    );
    if (preparedIndex >= 0) {
      return { slotKey, preparedIndex, preparedSpell: prepared[preparedIndex] };
    }
  }
  return null;
}

function slotSnapshot(slot) {
  if (!slot || typeof slot !== "object") return {};
  const value = numeric(systemValue(slot.value), null);
  const remaining = numeric(systemValue(slot.remaining), null);
  return {
    ...(value !== null ? { valueBefore: value } : {}),
    ...(remaining !== null ? { remainingBefore: remaining } : {}),
  };
}

function preparedExpendedValue(preparedSpell) {
  if (typeof preparedSpell?.expended === "boolean") return preparedSpell.expended;
  if (typeof preparedSpell?.expended?.value === "boolean") return preparedSpell.expended.value;
  if (typeof preparedSpell?.system?.expended === "boolean") return preparedSpell.system.expended;
  if (typeof preparedSpell?.system?.expended?.value === "boolean") return preparedSpell.system.expended.value;
  return false;
}

function expectedSlotSnapshot(entry, op) {
  const expectedAfter = {};
  const slot = op?.slotKey ? entry?.system?.slots?.[op.slotKey] : null;
  const snapshot = slotSnapshot(slot);
  if (snapshot.valueBefore !== undefined) expectedAfter.value = snapshot.valueBefore;
  if (snapshot.remainingBefore !== undefined) expectedAfter.remaining = snapshot.remainingBefore;
  if (Number.isInteger(op?.preparedIndex)) {
    const preparedSpell = slot?.prepared?.[op.preparedIndex];
    if (preparedSpell) {
      expectedAfter.preparedExpended = preparedExpendedValue(preparedSpell);
    }
  }
  return expectedAfter;
}

export function findSpellcastingEntry(actor, action) {
  const id = action?.spellcastingEntryId;
  const uuid = action?.spellcastingEntryUuid;
  if (!id && !uuid) return null;
  return pf2eRuntime.readActor(actor).spellcasting.find((entry) =>
    entry?.id === id
    || entry?._id === id
    || entry?.uuid === uuid,
  ) ?? null;
}

export function spellSlotRevertOp(actor, action) {
  if (!action?.item) return null;
  const entry = findSpellcastingEntry(actor, action);
  if (!entry) return null;

  const rank = numeric(action.castRank ?? action.rank, null);
  const rankSlotKey = slotKeyForRank(rank);
  const preparedMatch = findPreparedSpellSlot(entry, action);
  const slotKey = preparedMatch?.slotKey ?? rankSlotKey;
  const slot = slotKey ? entry?.system?.slots?.[slotKey] : null;
  const slotIdExplicit = action.slotId !== undefined && action.slotId !== null;
  const op = {
    kind: "slot",
    entryId: action.spellcastingEntryId ?? entry?.id ?? entry?._id ?? null,
    entryUuid: action.spellcastingEntryUuid ?? entry?.uuid ?? null,
    entryType: action.spellcastingEntryType ?? systemValue(entry?.system?.prepared) ?? null,
    rank,
    slotId: action.slotId ?? action.location ?? null,
    slotIdExplicit,
    slotKey,
    spellId: action.item?.id ?? action.item?._id ?? action.id ?? null,
    spellUuid: action.item?.uuid ?? action.uuid ?? null,
    spellSlug: action.item?.slug ?? action.slug ?? null,
    ...slotSnapshot(slot),
  };

  if (preparedMatch) {
    op.preparedIndex = preparedMatch.preparedIndex;
    op.preparedId = preparedMatch.preparedSpell?.id ?? preparedMatch.preparedSpell?._id ?? null;
    op.preparedUuid = preparedMatch.preparedSpell?.uuid ?? preparedMatch.preparedSpell?.spell?.uuid ?? null;
    op.preparedExpendedBefore = preparedExpendedValue(preparedMatch.preparedSpell);
  }

  return op;
}

export function finalizeSpellSlotRevertOp(actor, op) {
  if (!op) return null;
  const entry = findSpellcastingEntry(actor, {
    spellcastingEntryId: op.entryId,
    spellcastingEntryUuid: op.entryUuid,
  });
  if (!entry) return op;
  const expectedAfter = expectedSlotSnapshot(entry, op);
  return Object.keys(expectedAfter).length ? { ...op, expectedAfter } : op;
}

function isCantripSpell(item) {
  if (item?.isCantrip === true) return true;
  const traits = item?.system?.traits?.value;
  return Array.isArray(traits) && traits.includes("cantrip");
}

function messageMatchesCast(message, actor, item) {
  const actorId = String(actor?.id ?? actor?._id ?? "");
  const messageActorId = String(message?.speaker?.actor ?? "");
  if (actorId && messageActorId && messageActorId !== actorId) return false;

  const itemIds = new Set([
    item?.id,
    item?._id,
    item?.uuid,
  ].filter(Boolean).map(String));
  const origin = message?.flags?.pf2e?.origin ?? {};
  const originIds = [
    origin.uuid,
    origin.item,
    origin.itemId,
    message?.item?.id,
    message?.item?.uuid,
  ].filter(Boolean).map(String);
  if (!originIds.length || !itemIds.size) return true;
  return originIds.some((id) => itemIds.has(id));
}

// Whether the spell's casting resource is available before casting. Returns true (castable),
// false (resource confirmed empty), or null (unknown/free; let PF2e judge).
function spellCastResourceSufficient(actor, entry, item, action) {
  if (isCantripSpell(item)) return true;
  const prepared = String(systemValue(entry?.system?.prepared) ?? "").toLowerCase();
  if (prepared === "focus") {
    const points = numeric(systemValue(actor?.system?.resources?.focus?.value), null);
    return Number.isFinite(points) ? points > 0 : null;
  }
  if (prepared === "spontaneous") {
    const slotKey = slotKeyForRank(action?.castRank ?? action?.rank);
    const slot = slotKey ? entry?.system?.slots?.[slotKey] : null;
    if (!slot) return null;
    const remaining = numeric(systemValue(slot.value ?? slot.remaining), null);
    return Number.isFinite(remaining) ? remaining > 0 : null;
  }
  return null;
}

async function waitForChatMessage(messagePromise, timeoutMs = 500) {
  const schedule = globalThis.setTimeout;
  if (typeof schedule !== "function") return null;

  let timeoutId = null;
  try {
    return await Promise.race([
      messagePromise,
      new Promise((resolve) => {
        timeoutId = schedule(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId != null && typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

function consumableUseSnapshot(item) {
  if (!item || item.type !== "consumable" || !item.uuid) return null;
  return {
    itemUuid: item.uuid,
    quantityBefore: numeric(systemValue(item.system?.quantity), null),
    usesValueBefore: numeric(systemValue(item.system?.uses), null),
    sourceData: typeof item.toObject === "function" ? item.toObject() : null,
  };
}

async function consumableRevertOpAfterUse(before, actor) {
  if (!before) return null;
  const stillExists = typeof globalThis.fromUuid === "function" ? await globalThis.fromUuid(before.itemUuid) : null;
  if (!stillExists) {
    return before.sourceData && actor?.uuid
      ? {
        kind: "consumable",
        deleted: true,
        actorUuid: actor.uuid,
        itemUuid: before.itemUuid,
        sourceData: before.sourceData,
        expectedAfter: { deleted: true },
      }
      : null;
  }
  const quantityNow = numeric(systemValue(stillExists.system?.quantity), null);
  const usesNow = numeric(systemValue(stillExists.system?.uses), null);
  if (quantityNow === before.quantityBefore && usesNow === before.usesValueBefore) return null;
  return {
    kind: "consumable",
    itemUuid: before.itemUuid,
    quantityBefore: before.quantityBefore,
    usesValueBefore: before.usesValueBefore,
    expectedAfter: {
      ...(quantityNow === null ? {} : { quantity: quantityNow }),
      ...(usesNow === null ? {} : { uses: usesNow }),
    },
  };
}

function frequencySnapshot(item) {
  const valueBefore = numeric(systemValue(item?.system?.frequency?.value), null);
  return valueBefore === null || !item?.uuid ? null : { itemUuid: item.uuid, valueBefore };
}

async function consumeFrequencyIfUnspent(before) {
  if (!before || typeof globalThis.fromUuid !== "function") return null;
  const item = await globalThis.fromUuid(before.itemUuid);
  const valueNow = numeric(systemValue(item?.system?.frequency?.value), null);
  if (valueNow === null || valueNow !== before.valueBefore || valueNow <= 0 || typeof item?.update !== "function") return null;
  await item.update({ "system.frequency.value": valueNow - 1 });
  return { kind: "frequency", itemUuid: before.itemUuid, valueBefore: before.valueBefore, expectedAfter: { value: valueNow - 1 } };
}

function sustainedSpellDuration(action) {
  const sustained = action?.activityProfile?.sustained === true
    || action?.item?.system?.duration?.sustained === true;
  if (!sustained) return null;
  const raw = action?.activityProfile?.duration ?? action?.item?.system?.duration?.value ?? "";
  return parseSpellDuration(raw, { sustained: true });
}

async function createSustainedSpellEffect(actor, action) {
  const duration = sustainedSpellDuration(action);
  if (!duration || typeof actor?.createEmbeddedDocuments !== "function") return null;
  const worldTime = numeric(globalThis.game?.time?.worldTime, null);
  const initiative = numeric(globalThis.game?.combat?.combatant?.initiative, null);
  const data = buildSustainedSpellEffectData({ action, duration, worldTime, initiative });
  if (!data) return null;
  try {
    const created = await actor.createEmbeddedDocuments("Item", [data]);
    const effect = Array.isArray(created) ? created[0] : created;
    return effect?.uuid ?? null;
  } catch (_error) {
    return null;
  }
}

async function executeNativeItem({ actor, action, event }) {
  const item = action?.item;
  const entry = findSpellcastingEntry(actor, action);
  if (typeof entry?.cast === "function") {
    const resourceOk = spellCastResourceSufficient(actor, entry, item, action);
    let castMessage = null;
    let resolveCastMessage = null;
    const castMessagePromise = new Promise((resolve) => { resolveCastMessage = resolve; });
    const onCreate = (message) => {
      if (castMessage) return;
      if (messageMatchesCast(message, actor, item)) castMessage = message;
      if (castMessage) resolveCastMessage?.(castMessage);
    };
    const hookId = globalThis.Hooks?.on?.("createChatMessage", onCreate) ?? null;
    try {
      const returned = await pf2eRuntime.castSpell(entry, item, {
        event,
        rank: action?.castRank ?? action?.rank,
        slotId: action?.slotId ?? action?.location,
      });
      if (!castMessage && returned && typeof returned === "object") castMessage = returned;
      if (!castMessage && hookId != null) castMessage = await waitForChatMessage(castMessagePromise) ?? null;
    } finally {
      if (hookId != null) globalThis.Hooks?.off?.("createChatMessage", hookId);
    }
    return { spellCast: true, message: castMessage, castFailed: resourceOk === false };
  }
  if (typeof action?.generatedAction?.use === "function") return action.generatedAction.use({ event });
  if (typeof item?.use === "function") {
    const before = consumableUseSnapshot(item);
    const used = await item.use({ event });
    const consumableRevertOp = before ? await consumableRevertOpAfterUse(before, actor) : null;
    return consumableRevertOp ? { ...used, consumableRevertOp } : used;
  }
  if (typeof item?.consume === "function" && item.type === "consumable") {
    const before = consumableUseSnapshot(item);
    await item.consume();
    const consumableRevertOp = before ? await consumableRevertOpAfterUse(before, actor) : null;
    return consumableRevertOp ? { consumableRevertOp } : null;
  }
  if (typeof item?.cast === "function") return item.cast({ event, rank: action?.castRank ?? action?.rank });
  if (item?.isOfType?.("action", "feat") && item.uuid) {
    const macroResult = await pf2eRuntime.rollItem(item, event);
    if (macroResult) return macroResult;
  }
  if (typeof item?.toMessage === "function") return item.toMessage({}, { rollMode: globalThis.game?.settings?.get?.("core", "rollMode") });
  if (typeof item?.sheet?.render === "function") {
    await item.sheet.render(true);
    return { openedSheet: true };
  }
  return null;
}

export async function executeOpenItem({ actor, action, event }) {
  const frequencyBefore = frequencySnapshot(action?.item);
  const result = await executeNativeItem({ actor, action, event });
  if (result) {
    const frequencyRevertOp = await consumeFrequencyIfUnspent(frequencyBefore);
    return frequencyRevertOp ? { ...result, frequencyRevertOp } : result;
  }
  const uuid = action?.uuid ?? action?.sourceId;
  if (uuid && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(uuid);
      if (typeof document?.sheet?.render === "function") {
        await document.sheet.render(true);
        return { openedSheet: true };
      }
    } catch (_error) {
      // Fall through to guidance if entry can't resolve.
    }
  }
  if (action?.item || uuid) return { opened: true };
  await createGuidance(action, actor);
  return { guidance: true };
}

export async function executeNativeAction({ actor, action, event, target = null, patch = {}, trackSustainedSpell = true }) {
  if (target?.token) setTarget(target.token);
  const slotBefore = spellSlotRevertOp(actor, action);
  const nativeResult = await executeOpenItem({ actor, action, event });
  const slotOp = finalizeSpellSlotRevertOp(actor, slotBefore);
  if (nativeResult?.spellCast === true && nativeResult?.castFailed === true) {
    const reason = action?.unavailableReason || t("Exec.SpellNoSlot", "Spell could not be cast (no slot available).");
    return {
      status: "failed",
      patch: executionPatch(patch, "failed", { error: reason }),
      error: reason,
      nativeResult,
    };
  }

  const sustainedEffectUuid = nativeResult?.spellCast === true && trackSustainedSpell
    ? await createSustainedSpellEffect(actor, action)
    : null;

  await flushPendingChat();
  const cardTimestamp = Number(nativeResult?.message?.timestamp);
  const damageMessageIds = await rollActionDamageMessages({
    actor,
    action,
    target,
    after: Number.isFinite(cardTimestamp) ? cardTimestamp : null,
  });
  let result = {
    status: "done",
    patch: executionPatch(patch, "done", {
      result: nativeResult?.opened ? t("Exec.OpenedAction", "Opened action.") : t("Exec.ExecutedAction", "Executed action."),
      revert: chatActionRevert(nativeResult, action, { target, slotOp }),
    }),
    nativeResult,
  };
  for (const damageMessageId of [...damageMessageIds].reverse()) {
    result = attachRevertOp(result, { kind: "chat", messageId: damageMessageId });
  }
  return attachRevertOp(result, sustainedEffectUuid ? { kind: "effect", effectUuid: sustainedEffectUuid } : null);
}
