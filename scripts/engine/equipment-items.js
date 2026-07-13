import { actorItems, systemValue } from "../foundry-data.js";

const SWAPPABLE_ITEM_TYPES = new Set(["weapon", "equipment", "consumable"]);

function carryType(item) {
  return String(item?.carryType ?? item?.system?.equipped?.carryType ?? "").toLowerCase();
}

function handsHeld(item) {
  const value = Number(item?.handsHeld ?? item?.system?.equipped?.handsHeld);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isSwappablePhysicalItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const category = String(systemValue(item?.system?.category) ?? "").toLowerCase();
  if (category === "unarmed") return false;
  return SWAPPABLE_ITEM_TYPES.has(type) || (type === "armor" && category === "shield");
}

function swapItems(actor) {
  return actorItems(actor)
    .filter(isSwappablePhysicalItem)
    .toSorted((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? "")));
}

export function itemCarryState(item) {
  return {
    carryType: carryType(item) || "worn",
    handsHeld: handsHeld(item),
  };
}

export function itemHandsRequired(item) {
  const hands = Number(systemValue(item?.system?.usage?.hands));
  return Number.isFinite(hands) && hands > 0 ? hands : 1;
}

export function heldSwapItems(actor) {
  return swapItems(actor).filter((item) =>
    item?.isHeld === true || carryType(item) === "held" || handsHeld(item) > 0);
}

export function drawableSwapItems(actor) {
  return swapItems(actor).filter((item) =>
    item?.isHeld !== true && carryType(item) === "worn" && handsHeld(item) === 0);
}

export function swapItemById(items, id) {
  const wanted = String(id ?? "");
  if (!wanted) return null;
  return (Array.isArray(items) ? items : []).find((item) =>
    [item?.id, item?._id, item?.uuid].some((value) => String(value ?? "") === wanted)) ?? null;
}
