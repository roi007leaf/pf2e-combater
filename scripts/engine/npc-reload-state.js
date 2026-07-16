import { MODULE_ID } from "../constants.js";
import { canRestoreSnapshot } from "./revert/transaction.js";

export const NPC_RELOAD_STATE_FLAG = "npcReloadState";

function valueOf(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
}

function numericReload(value) {
  const raw = valueOf(value);
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === "-" || text === "\u2014") return null;
  if (text === "none") return 0;
  const number = Number(text);
  if (Number.isFinite(number) && number >= 0) return number;
  const word = text.match(/\b(zero|one|two|three)\b/)?.[1];
  return word ? { zero: 0, one: 1, two: 2, three: 3 }[word] : null;
}

function values(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return value === undefined || value === null ? [] : [value];
}

function traitSlug(value) {
  return String(value?.slug ?? value?.name ?? value ?? "").trim().toLowerCase();
}

function actionItem(action) {
  return action?.item ?? action?.strike?.item ?? action?.action?.item ?? null;
}

export function actionReloadCost(action) {
  const item = actionItem(action);
  for (const value of [
    action?.reload,
    action?.reloadValue,
    action?.strike?.reload,
    item?.reload,
    item?.system?.reload?.value,
    item?.system?.reload,
  ]) {
    const parsed = numericReload(value);
    if (parsed !== null) return parsed;
  }

  // Atomic Strike steps intentionally reset their extra planned reload to zero. That must not
  // erase the backing weapon's actual reload trait, because firing still empties an NPC weapon.
  const profileReload = numericReload(action?.activityProfile?.reloadCost);
  if (profileReload !== null && profileReload > 0) return profileReload;

  const traits = [
    ...values(action?.traits),
    ...values(action?.weaponTraits),
    ...values(item?.system?.traits?.value),
    ...values(item?.system?.traits),
  ].map(traitSlug);
  for (const trait of traits) {
    const match = trait.match(/^reload-(\d+)$/);
    if (match) return Number(match[1]);
  }
  return 0;
}

export function npcReloadWeaponKey(action) {
  const item = actionItem(action);
  const linkedWeaponId = item?.flags?.pf2e?.linkedWeapon
    ?? item?.flags?.pf2e?.linkedWeaponId
    ?? action?.strike?.item?.flags?.pf2e?.linkedWeapon;
  const key = linkedWeaponId
    ?? action?.activityProfile?.reloadWeaponKey
    ?? action?.activityProfile?.weaponId
    ?? action?.weapon?.id
    ?? item?.id
    ?? item?._id;
  return key === undefined || key === null || key === "" ? null : String(key);
}

function isNpc(actor) {
  return actor?.type === "npc" || actor?.isOfType?.("npc") === true;
}

function reloadState(actor) {
  const state = actor?.getFlag?.(MODULE_ID, NPC_RELOAD_STATE_FLAG)
    ?? actor?.flags?.[MODULE_ID]?.[NPC_RELOAD_STATE_FLAG];
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

function loadedFromState(actor, weaponKey) {
  return reloadState(actor)?.[weaponKey] !== false;
}

function isReloadAction(action) {
  const source = action?.action ?? action;
  return source?.executable === "reload-weapon"
    || source?.activityProfile?.reload === true
    || String(source?.slug ?? "").startsWith("reload-");
}

function isReloadableAttack(action) {
  const source = action?.action ?? action;
  if (actionReloadCost(source) <= 0) return false;
  const includes = values(source?.activityProfile?.includes).map((entry) => String(entry).toLowerCase());
  return source?.executable === "strike"
    || source?.source === "strike"
    || source?.slug === "strike"
    || source?.activityProfile?.includesStrike === true
    || includes.includes("strike");
}

export function npcWeaponNeedsReload(actor, action) {
  if (!isNpc(actor) || actionReloadCost(action) <= 0) return false;
  const weaponKey = npcReloadWeaponKey(action);
  return Boolean(weaponKey) && !loadedFromState(actor, weaponKey);
}

// Project pending plan steps over the persisted state. Executed draft steps are skipped because
// their result is already represented by the live actor flag.
export function npcWeaponNeedsReloadAfterSteps(actor, action, steps = []) {
  if (!isNpc(actor) || actionReloadCost(action) <= 0) return false;
  const weaponKey = npcReloadWeaponKey(action);
  if (!weaponKey) return false;
  let loaded = loadedFromState(actor, weaponKey);
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step?.execution?.status === "done") continue;
    const source = step?.action ?? step;
    if (npcReloadWeaponKey(source) !== weaponKey) continue;
    if (isReloadAction(source)) loaded = true;
    if (isReloadableAttack(source)) loaded = false;
  }
  return !loaded;
}

async function writeReloadState(actor, state) {
  if (typeof actor?.setFlag === "function") {
    await actor.setFlag(MODULE_ID, NPC_RELOAD_STATE_FLAG, state);
    return;
  }
  if (typeof actor?.update === "function") {
    await actor.update({ [`flags.${MODULE_ID}.${NPC_RELOAD_STATE_FLAG}`]: state });
    return;
  }
  throw new Error("NPC reload-state API is unavailable");
}

export async function setNpcWeaponLoaded(actor, action, loaded) {
  if (!isNpc(actor) || actionReloadCost(action) <= 0) return null;
  const weaponKey = npcReloadWeaponKey(action);
  if (!weaponKey) return null;

  const before = reloadState(actor);
  const hadValueBefore = Object.prototype.hasOwnProperty.call(before, weaponKey);
  const valueBefore = loadedFromState(actor, weaponKey);
  const valueAfter = Boolean(loaded);
  if (valueBefore === valueAfter) return null;

  await writeReloadState(actor, { ...before, [weaponKey]: valueAfter });
  return {
    kind: "npc-reload-state",
    actorUuid: actor?.uuid ?? null,
    weaponKey,
    hadValueBefore,
    valueBefore,
    expectedAfter: { loaded: valueAfter },
  };
}

async function actorForRevert(op, actor) {
  if (!op?.actorUuid || actor?.uuid === op.actorUuid || typeof globalThis.fromUuid !== "function") return actor;
  return await globalThis.fromUuid(op.actorUuid) ?? actor;
}

export async function revertNpcReloadState(op, { actor, warnings = [] } = {}) {
  if (!op?.weaponKey) return;
  const targetActor = await actorForRevert(op, actor);
  if (!targetActor) throw new Error("NPC actor is unavailable");
  const before = reloadState(targetActor);
  const current = { loaded: loadedFromState(targetActor, op.weaponKey) };
  if (!canRestoreSnapshot({
    current,
    expectedAfter: op.expectedAfter,
    warnings,
    label: "NPC reload state",
  })) return;

  const restored = { ...before };
  if (op.hadValueBefore) restored[op.weaponKey] = Boolean(op.valueBefore);
  else delete restored[op.weaponKey];
  await writeReloadState(targetActor, restored);
}
