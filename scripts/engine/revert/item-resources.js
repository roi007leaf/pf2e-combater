import { t } from "../../i18n.js";
import { canRestoreSnapshot } from "./transaction.js";

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function systemValue(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
}

export async function revertCarryType(op, { warnings } = {}) {
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  try {
    const item = await globalThis.fromUuid(op.itemUuid);
    const actor = item?.actor ?? item?.parent ?? null;
    const target = { carryType: op.carryType ?? "worn", handsHeld: op.handsHeld ?? 0 };
    const current = {
      carryType: item?.system?.equipped?.carryType ?? "worn",
      handsHeld: numeric(item?.system?.equipped?.handsHeld) ?? 0,
    };
    if (!canRestoreSnapshot({ current, expectedAfter: op.expectedAfter, warnings, label: item?.name ?? "item position" })) return;
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

function systemFieldUpdatePath(item, field) {
  const current = item?.system?.[field];
  return current && typeof current === "object" && "value" in current ? `system.${field}.value` : `system.${field}`;
}

export async function revertConsumable(op, { actor, warnings }) {
  if (op?.deleted === true) {
    if (op?.expectedAfter && typeof globalThis.fromUuid !== "function") {
      canRestoreSnapshot({ current: { deleted: false }, expectedAfter: op.expectedAfter, warnings, label: "consumable" });
      return;
    }
    const currentItem = op?.itemUuid && typeof globalThis.fromUuid === "function"
      ? await globalThis.fromUuid(op.itemUuid)
      : null;
    if (!canRestoreSnapshot({ current: { deleted: !currentItem }, expectedAfter: op.expectedAfter, warnings, label: "consumable" })) return;
    if (!actor || typeof actor.createEmbeddedDocuments !== "function" || !op.sourceData) {
      throw new Error(t("Revert.CouldNotRestoreConsumable", "could not restore the consumed item"));
    }
    await actor.createEmbeddedDocuments("Item", [op.sourceData]);
    return;
  }
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  const item = await globalThis.fromUuid(op.itemUuid);
  if (typeof item?.update !== "function") return;
  const current = {
    quantity: numeric(systemValue(item.system?.quantity)),
    uses: numeric(systemValue(item.system?.uses)),
  };
  if (!canRestoreSnapshot({ current, expectedAfter: op.expectedAfter, warnings, label: item?.name ?? "consumable" })) return;
  const update = {};
  if (op.quantityBefore !== null && op.quantityBefore !== undefined) update[systemFieldUpdatePath(item, "quantity")] = op.quantityBefore;
  if (op.usesValueBefore !== null && op.usesValueBefore !== undefined) update[systemFieldUpdatePath(item, "uses")] = op.usesValueBefore;
  if (Object.keys(update).length) await item.update(update);
}

export async function revertFrequency(op, { warnings } = {}) {
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  const item = await globalThis.fromUuid(op.itemUuid);
  if (typeof item?.update !== "function" || op.valueBefore === null || op.valueBefore === undefined) return;
  const current = { value: numeric(systemValue(item?.system?.frequency?.value)) };
  if (!canRestoreSnapshot({ current, expectedAfter: op.expectedAfter, warnings, label: item?.name ?? "frequency" })) return;
  await item.update({ "system.frequency.value": op.valueBefore });
}

export async function revertReload(op, { warnings } = {}) {
  if (!op?.weaponUuid || typeof globalThis.fromUuid !== "function") return;
  const weapon = await globalThis.fromUuid(op.weaponUuid);
  const subitems = weapon?.subitems;
  const subitem = typeof subitems?.get === "function"
    ? subitems.get(op.subitemId)
    : (typeof subitems?.find === "function" ? subitems.find((item) => item.id === op.subitemId) : null);
  if (!subitem || typeof subitem.detach !== "function") return;
  const current = { quantity: numeric(subitem.quantity ?? subitem.system?.quantity) };
  if (!canRestoreSnapshot({ current, expectedAfter: op.expectedAfter, warnings, label: weapon?.name ?? "reload" })) return;
  await subitem.detach({ skipConfirm: true, quantity: op.addedQuantity });
}
