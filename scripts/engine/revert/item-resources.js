import { t } from "../../i18n.js";

export async function revertCarryType(op) {
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

function systemFieldUpdatePath(item, field) {
  const current = item?.system?.[field];
  return current && typeof current === "object" && "value" in current ? `system.${field}.value` : `system.${field}`;
}

export async function revertConsumable(op, { actor }) {
  if (op?.deleted === true) {
    if (!actor || typeof actor.createEmbeddedDocuments !== "function" || !op.sourceData) {
      throw new Error(t("Revert.CouldNotRestoreConsumable", "could not restore the consumed item"));
    }
    await actor.createEmbeddedDocuments("Item", [op.sourceData]);
    return;
  }
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  const item = await globalThis.fromUuid(op.itemUuid);
  if (typeof item?.update !== "function") return;
  const update = {};
  if (op.quantityBefore !== null && op.quantityBefore !== undefined) update[systemFieldUpdatePath(item, "quantity")] = op.quantityBefore;
  if (op.usesValueBefore !== null && op.usesValueBefore !== undefined) update[systemFieldUpdatePath(item, "uses")] = op.usesValueBefore;
  if (Object.keys(update).length) await item.update(update);
}

export async function revertFrequency(op) {
  if (!op?.itemUuid || typeof globalThis.fromUuid !== "function") return;
  const item = await globalThis.fromUuid(op.itemUuid);
  if (typeof item?.update !== "function" || op.valueBefore === null || op.valueBefore === undefined) return;
  await item.update({ "system.frequency.value": op.valueBefore });
}

export async function revertReload(op) {
  if (!op?.weaponUuid || typeof globalThis.fromUuid !== "function") return;
  const weapon = await globalThis.fromUuid(op.weaponUuid);
  const subitems = weapon?.subitems;
  const subitem = typeof subitems?.get === "function"
    ? subitems.get(op.subitemId)
    : (typeof subitems?.find === "function" ? subitems.find((item) => item.id === op.subitemId) : null);
  if (!subitem || typeof subitem.detach !== "function") return;
  await subitem.detach({ skipConfirm: true, quantity: op.addedQuantity });
}
