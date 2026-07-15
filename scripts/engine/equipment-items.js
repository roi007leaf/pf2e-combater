import { actorItems, systemValue, traitSlugs } from "../foundry-data.js";

const SWAPPABLE_ITEM_TYPES = new Set(["weapon", "equipment", "consumable"]);

function carryType(item) {
  return String(item?.carryType ?? item?.system?.equipped?.carryType ?? "").toLowerCase();
}

function handsHeld(item) {
  const value = Number(item?.handsHeld ?? item?.system?.equipped?.handsHeld);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function usageValue(item) {
  return String(systemValue(item?.system?.usage?.value) ?? "").trim().toLowerCase();
}

function usageHands(item) {
  const value = Number(systemValue(item?.system?.usage?.hands));
  if (Number.isFinite(value) && value > 0) return value;

  const usage = usageValue(item);
  if (usage === "held-in-two-hands") return 2;
  if (usage.startsWith("held-in-one")) return 1;
  return 0;
}

function hasHeldUsage(item) {
  const type = String(systemValue(item?.system?.usage?.type) ?? "").trim().toLowerCase();
  if (type) return type === "held";
  return usageValue(item).startsWith("held-") || usageHands(item) > 0;
}

export function isShieldItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const category = String(systemValue(item?.system?.category) ?? "").toLowerCase();
  return type === "shield"
    || (type === "armor" && category === "shield")
    || (type === "weapon" && traitSlugs(item).includes("shield"));
}

export function isWeaponItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const category = String(systemValue(item?.system?.category) ?? "").toLowerCase();
  return type === "weapon" && category !== "unarmed";
}

function isSwappablePhysicalItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  const category = String(systemValue(item?.system?.category) ?? "").toLowerCase();
  if (category === "unarmed") return false;
  return SWAPPABLE_ITEM_TYPES.has(type) || isShieldItem(item);
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
  return usageHands(item) || 1;
}

export function heldSwapItems(actor) {
  return swapItems(actor).filter((item) =>
    item?.isHeld === true || carryType(item) === "held" || handsHeld(item) > 0);
}

export function drawableSwapItems(actor) {
  return swapItems(actor).filter((item) =>
    item?.isHeld !== true
    && carryType(item) === "worn"
    && handsHeld(item) === 0
    && hasHeldUsage(item));
}

export function swapItemById(items, id) {
  const wanted = String(id ?? "");
  if (!wanted) return null;
  return (Array.isArray(items) ? items : []).find((item) =>
    [item?.id, item?._id, item?.uuid].some((value) => String(value ?? "") === wanted)) ?? null;
}
