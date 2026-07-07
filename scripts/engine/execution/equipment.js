import { collectionValues } from "../../foundry-data.js";
import { t } from "../../i18n.js";
import { createGuidance } from "./guidance.js";
import { executionPatch, revertEnvelope } from "./results.js";

function weaponCarryState(item) {
  const equipped = item?.system?.equipped ?? {};
  return { carryType: equipped.carryType ?? "worn", handsHeld: Number(equipped.handsHeld) || 0 };
}

async function changeWeaponCarry(actor, item, target) {
  if (typeof actor?.changeCarryType === "function") {
    await actor.changeCarryType(item, target);
    return true;
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
  const prior = weaponCarryState(item);
  const hands = Number(item?.system?.usage?.hands) || 1;
  const changed = await changeWeaponCarry(actor, item, { carryType: "held", handsHeld: hands });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Drew", "Drew {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDraw", "Could not draw the weapon.") }), error: t("Exec.CouldNotDraw", "Could not draw the weapon.") };
}

export async function executeDropWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponDrop", "No weapon to drop.") }), error: t("Exec.NoWeaponDrop", "No weapon to drop.") };
  const prior = weaponCarryState(item);
  const changed = await changeWeaponCarry(actor, item, { carryType: "dropped", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.DroppedWeapon", "Dropped {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") }), error: t("Exec.CouldNotDropWeapon", "Could not drop the weapon.") };
}

export async function executeSheatheWeapon({ actor, action }) {
  const item = action?.item;
  if (!item) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") }), error: t("Exec.NoWeaponSheathe", "No weapon to sheathe.") };
  const prior = weaponCarryState(item);
  const changed = await changeWeaponCarry(actor, item, { carryType: "worn", handsHeld: 0 });
  return changed
    ? { status: "done", patch: executionPatch({}, "done", { result: t("Exec.Sheathed", "Sheathed {name}.", { name: item.name ?? t("Exec.Weapon", "weapon") }), revert: revertEnvelope([{ kind: "carry-type", itemUuid: item.uuid ?? null, carryType: prior.carryType, handsHeld: prior.handsHeld }]) }) }
    : { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") }), error: t("Exec.CouldNotSheathe", "Could not sheathe the weapon.") };
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
    if (quantityNow > quantityBefore) grown = { kind: "reload", weaponUuid, subitemId: item.id, addedQuantity: quantityNow - quantityBefore };
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
