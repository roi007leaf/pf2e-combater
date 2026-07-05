import { STORAGE_KEYS } from "../constants.js";
import { swapFavorites } from "../engine/favorite-reorder.js";

function storage() {
  return globalThis.localStorage ?? null;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredFavorites() {
  try {
    const value = storage()?.getItem(STORAGE_KEYS.actionFavorites);
    const parsed = value ? JSON.parse(value) : {};
    return isPlainObject(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writeStoredFavorites(favorites) {
  try {
    storage()?.setItem(STORAGE_KEYS.actionFavorites, JSON.stringify(favorites));
  } catch (_error) {
    // Storage is optional in tests, headless Foundry setup, and private windows.
  }
}

function userId() {
  return globalThis.game?.user?.id ?? "anonymous";
}

function actorUuidOrId(context) {
  return context?.actor?.uuid
    ?? context?.actor?.id
    ?? context?.combatant?.actor?.uuid
    ?? context?.combatant?.actor?.id
    ?? "unknown-actor";
}

function favoritePrefix(context) {
  return `${userId()}|${actorUuidOrId(context)}|`;
}

export function favoriteKey(context, actionKey) {
  return `${favoritePrefix(context)}${actionKey}`;
}

export function readActionFavorites(context) {
  const prefix = favoritePrefix(context);
  const favorites = readStoredFavorites();
  return new Set(Object.keys(favorites)
    .filter((key) => key.startsWith(prefix) && favorites[key])
    .map((key) => key.slice(prefix.length)));
}

export function writeActionFavorites(context, favorites) {
  const prefix = favoritePrefix(context);
  const stored = readStoredFavorites();
  for (const key of Object.keys(stored)) {
    if (key.startsWith(prefix)) delete stored[key];
  }
  for (const actionKey of favorites) {
    stored[favoriteKey(context, actionKey)] = true;
  }
  writeStoredFavorites(stored);
}

export function toggleActionFavorite(context, actionKey) {
  const favorites = readActionFavorites(context);
  const added = !favorites.has(actionKey);
  if (added) {
    favorites.add(actionKey);
  } else {
    favorites.delete(actionKey);
  }
  writeActionFavorites(context, favorites);
  return added;
}

export function reorderActionFavorite(context, key, targetKey) {
  const ordered = [...readActionFavorites(context)];
  const swapped = swapFavorites(ordered, key, targetKey);
  if (swapped === ordered) return false;
  writeActionFavorites(context, swapped);
  return true;
}
