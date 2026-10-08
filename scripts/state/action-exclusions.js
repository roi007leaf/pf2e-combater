import { MODULE_ID } from "../constants.js";
import { contextActorDocument } from "../engine/actor-context.js";

const FLAG = "excludedActions";

// Hide the same owned item at every rank/action-cost variant; unrelated items stay separate.
export function actionExclusionKey(action) {
  const item = action?.consumableItem ?? action?.item;
  if (item?.id ?? item?._id) return `item:${action?.slug ?? action?.tacticSlug ?? action?.source}:${item.id ?? item._id}`;
  return `action:${action?.slug ?? action?.tacticSlug ?? action?.id ?? action?.key}`;
}

export function readActionExclusions(context) {
  const actor = contextActorDocument(context);
  const value = actor?.getFlag?.(MODULE_ID, FLAG) ?? actor?.flags?.[MODULE_ID]?.[FLAG];
  return new Set(Array.isArray(value) ? value.filter((key) => typeof key === "string") : []);
}

export async function toggleActionExclusion(context, action) {
  const actor = contextActorDocument(context);
  if (!actor?.setFlag || (globalThis.game?.user?.isGM !== true && actor.isOwner !== true)) return false;
  const excluded = readActionExclusions(context);
  const key = actionExclusionKey(action);
  if (excluded.has(key)) excluded.delete(key);
  else excluded.add(key);
  await actor.setFlag(MODULE_ID, FLAG, [...excluded]);
  return true;
}
