import { collectionValues } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import {
  drawableSwapItems,
  heldSwapItems,
  itemCarryState,
  itemHandsRequired,
  swapItemById,
} from "../equipment-items.js";
import { createGuidance } from "./guidance.js";
import { executionPatch, revertEnvelope } from "./results.js";

async function changeItemCarry(actor, item, target) {
  if (typeof actor?.changeCarryType === "function") {
    return await actor.changeCarryType(item, target) !== false;
  }
  if (typeof item?.update === "function") {
    await item.update({
      "system.equipped.carryType": target.carryType,
      "system.equipped.handsHeld": target.handsHeld ?? 0,
    });
    return true;
  }
  return false;
}

export async function executeDrawWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponDraw", "No weapon to draw.") }), error: t("Exec.NoWeaponDraw", "No weapon to draw.") };
  const prior = itemCarryState(item);
  const hands = Number(item?.system?.usage?.hands) || 1;
  const changed = await changeItemCarry(actor, item, { carryType: "held", handsHeld: hands });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Drew", "Drew {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld, expectedAfter: { carryType: "held", handsHeld: hands } }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDraw", "Could not draw the weapon.") }), error: t("Exec.CouldNotDraw", "Could not draw the weapon.") };
}

export async function executeDropWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponDrop", "No weapon to drop.") }), error: t("Exec.NoWeaponDrop", "No weapon to drop.") };
  const prior = itemCarryState(item);
  const changed = await changeItemCarry(actor, item, { carryType: "dropped", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.DroppedWeapon", "Dropped {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld, expectedAfter: { carryType: "dropped", handsHeld: 0 } }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") }), error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") };
}

export async function executeSheatheWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") }), error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") };
  const prior = itemCarryState(item);
  const changed = await changeItemCarry(actor, item, { carryType: "worn", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Sheathed", "Sheathed {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld, expectedAfter: { carryType: "worn", handsHeld: 0 } }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") }), error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") };
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

function selectValue(button, name) {
  const field = button?.form?.elements?.namedItem?.(name) ?? button?.form?.elements?.[name];
  return String(field?.value ?? "");
}

function itemOptions(items, selectedId = null) {
  return items.map((item) => {
    const id = item?.id ?? item?._id ?? item?.uuid ?? "";
    const selected = String(id) === String(selectedId ?? "") ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(item?.name ?? id)}</option>`;
  }).join("");
}

export async function promptSwapSelection(heldItems, drawableItems, selected = {}) {
  if (heldItems.length === 1 && drawableItems.length === 1) {
    return {
      swapHeldItemId: heldItems[0].id ?? heldItems[0]._id ?? heldItems[0].uuid,
      swapDrawItemId: drawableItems[0].id ?? drawableItems[0]._id ?? drawableItems[0].uuid,
    };
  }

  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialog?.wait !== "function") return null;
  return await dialog.wait({
    window: { title: t("Dialog.SwapItems.Title", "Swap Items") },
    content: `<p>${escapeHtml(t("Dialog.SwapItems.Content", "Choose one held item to put away and one worn item to draw."))}</p>`
      + `<div class="form-group"><label>${escapeHtml(t("Dialog.SwapItems.PutAway", "Put away"))}</label><select name="swapHeldItemId">${itemOptions(heldItems, selected.swapHeldItemId)}</select></div>`
      + `<div class="form-group"><label>${escapeHtml(t("Dialog.SwapItems.Draw", "Draw"))}</label><select name="swapDrawItemId">${itemOptions(drawableItems, selected.swapDrawItemId)}</select></div>`,
    buttons: [
      {
        action: "swap",
        label: t("Action.Swap", "Swap"),
        default: true,
        callback: (_event, button) => ({
          swapHeldItemId: selectValue(button, "swapHeldItemId"),
          swapDrawItemId: selectValue(button, "swapDrawItemId"),
        }),
      },
      { action: "cancel", label: t("Dialog.Cancel", "Cancel"), callback: () => null },
    ],
    rejectClose: false,
  }).catch(() => null);
}

function swapFailure(message) {
  return { status: "failed", patch: executionPatch({}, "failed", { error: message }), error: message };
}

export async function executeSwapItems({ actor, choices = {} } = {}) {
  const heldItems = heldSwapItems(actor);
  const drawableItems = drawableSwapItems(actor);
  if (!heldItems.length || !drawableItems.length) {
    return swapFailure(t("Exec.NoSwapItems", "Swap requires one held item and one worn item."));
  }

  const supplied = choices?.swapHeldItemId && choices?.swapDrawItemId
    ? choices
    : await promptSwapSelection(heldItems, drawableItems);
  if (!supplied) return { status: "cancelled", patch: {} };

  const heldItem = swapItemById(heldItems, supplied.swapHeldItemId);
  const drawItem = swapItemById(drawableItems, supplied.swapDrawItemId);
  if (!heldItem || !drawItem) {
    return swapFailure(t("Exec.InvalidSwapItems", "Selected swap items are no longer available."));
  }

  const heldPrior = itemCarryState(heldItem);
  const drawPrior = itemCarryState(drawItem);
  let putAway = false;
  try {
    putAway = await changeItemCarry(actor, heldItem, { carryType: "worn", handsHeld: 0 });
    if (!putAway) return swapFailure(t("Exec.CouldNotSwapItems", "Could not swap the selected items."));
    const drawn = await changeItemCarry(actor, drawItem, { carryType: "held", handsHeld: itemHandsRequired(drawItem) });
    if (!drawn) {
      await changeItemCarry(actor, heldItem, heldPrior);
      return swapFailure(t("Exec.CouldNotSwapItems", "Could not swap the selected items."));
    }
  } catch (_error) {
    if (putAway) {
      try {
        await changeItemCarry(actor, heldItem, heldPrior);
      } catch (_rollbackError) {
        // Revert warning cannot help before execution completes; preserve original failure below.
      }
    }
    return swapFailure(t("Exec.CouldNotSwapItems", "Could not swap the selected items."));
  }

  const heldId = heldItem.id ?? heldItem._id ?? heldItem.uuid;
  const drawId = drawItem.id ?? drawItem._id ?? drawItem.uuid;
  return {
    status: "done",
    patch: executionPatch({
      swapHeldItemId: heldId,
      swapDrawItemId: drawId,
      swapHeldItemName: heldItem.name ?? "",
      swapDrawItemName: drawItem.name ?? "",
    }, "done", {
      result: t("Exec.SwappedItems", "Put away {held} and drew {draw}.", { held: heldItem.name, draw: drawItem.name }),
      revert: revertEnvelope([
        { kind: "carry-type", itemUuid: drawItem.uuid ?? null, carryType: drawPrior.carryType, handsHeld: drawPrior.handsHeld, expectedAfter: { carryType: "held", handsHeld: itemHandsRequired(drawItem) } },
        { kind: "carry-type", itemUuid: heldItem.uuid ?? null, carryType: heldPrior.carryType, handsHeld: heldPrior.handsHeld, expectedAfter: { carryType: "worn", handsHeld: 0 } },
      ]),
    }),
  };
}

// The actor's first non-stowed ammo (or ammo-capable weapon, e.g. a thrown combination weapon)
// compatible with this weapon -- mirrors PF2e's own ammunition-picker filter (isAmmoFor).
function findCompatibleAmmo(actor, weapon) {
  if (!weapon) return null;
  const pool = [
    ...collectionValues(actor?.itemTypes?.ammo),
    ...collectionValues(actor?.itemTypes?.weapon).filter((item) => item?.system?.usage?.canBeAmmo),
  ];
  return pool.find((item) => item?.isStowed !== true && typeof item?.isAmmoFor === "function" && item.isAmmoFor(weapon)) ?? null;
}

// weapon.subitems is a Foundry Collection (extends Map), not a plain array, so iterate with
// .forEach -- supported by both a real Collection and a plain-array test double.
function weaponSubitemQuantities(weapon) {
  const quantities = new Map();
  const subitems = weapon?.subitems;
  if (typeof subitems?.forEach === "function") {
    subitems.forEach((item) => quantities.set(item.id, Number(item.quantity ?? item.system?.quantity ?? 0)));
  }
  return quantities;
}

// Diff the weapon's loaded-ammo subitems before/after weapon.attach() to find which one grew (a
// fresh subitem, or an existing stack topped up) -- the same before/after pattern already used for
// consumables (consumableRevertOpAfterUse), since PF2e's attach() has no return value to inspect.
async function reloadRevertOpAfterAttach(weaponUuid, before) {
  if (!weaponUuid || typeof globalThis.fromUuid !== "function") return null;
  const weapon = await globalThis.fromUuid(weaponUuid);
  const subitems = weapon?.subitems;
  if (typeof subitems?.forEach !== "function") return null;
  let grown = null;
  subitems.forEach((item) => {
    if (grown) return;
    const quantityBefore = before.get(item.id) ?? 0;
    const quantityNow = Number(item.quantity ?? item.system?.quantity ?? 0);
    if (quantityNow > quantityBefore) grown = {
      kind: "reload",
      weaponUuid,
      subitemId: item.id,
      addedQuantity: quantityNow - quantityBefore,
      expectedAfter: { quantity: quantityNow },
    };
  });
  return grown;
}

export async function executeReloadWeapon({ actor, action }) {
  const weapon = action?.item;
  const ammo = findCompatibleAmmo(actor, weapon);
  if (weapon?.uuid && ammo && typeof weapon.attach === "function") {
    const before = weaponSubitemQuantities(weapon);
    await weapon.attach(ammo, { quantity: 1, stack: true });
    const reloadRevertOp = await reloadRevertOpAfterAttach(weapon.uuid, before);
    return {
      status: "done",
      patch: executionPatch({}, "done", {
        result: t("Exec.Reloaded", "Reloaded {name}.", { name: weapon.name }),
        revert: revertEnvelope(reloadRevertOp ? [reloadRevertOp] : []),
      }),
    };
  }
  // No compatible ammo in inventory to attach automatically -- fall back to a reminder, same as
  // PF2e's own sheet would leave the reload unresolved without ammo on hand.
  await createGuidance({ ...action, reason: t("Exec.ReloadReason", "Reload {name} before firing again.", { name: weapon?.name ?? t("Exec.YourWeapon", "your weapon") }) }, actor);
  return { status: "done", patch: executionPatch({}, "done", { result: t("Exec.PostedReloadReminder", "Posted reload reminder.") }) };
}
