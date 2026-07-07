import { t } from "../../i18n.js";
import { findSpellcastingEntry } from "../execution/native-item.js";

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

export async function revertSlot(op, { actor, warnings }) {
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
