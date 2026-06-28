// socketlib transport for player↔GM round-trips (Retch adjudication) and player→GM broadcasts
// (shared draft plans). The socketlib instance is created and its handlers registered in main.js on
// the "socketlib.ready" hook; this module holds the instance and exposes the typed callers so other
// modules don't reach for the global. Every caller degrades gracefully (returns null / false) when
// socketlib is unavailable, so the panel can fall back to a local prompt.

let socket = null;

export function setSocket(instance) {
  socket = instance;
}

export function isSocketReady() {
  return socket != null;
}

// PLAYER → active GM: ask for the Retch save DC. Resolves to a DC number, or null when no GM is
// connected / socketlib is unavailable (the caller then falls back to a local prompt).
export async function requestRetchDc(args = {}) {
  if (!socket) return null;
  try {
    return await socket.executeAsGM("promptRetchDc", args);
  } catch (_error) {
    return null;
  }
}

// PLAYER → active GM: ask the GM to rule on the rolled save. Resolves to { succeeded, critical }
// or null when no GM is connected / socketlib is unavailable.
export async function requestRetchResult(args = {}) {
  if (!socket) return null;
  try {
    return await socket.executeAsGM("promptRetchResult", args);
  } catch (_error) {
    return null;
  }
}

// PLAYER → all GMs: hand off a shared draft plan (fire-and-forget). Returns false when socketlib
// isn't available so the caller can warn.
export function shareDraftPlan(payload) {
  if (!socket) return false;
  try {
    socket.executeForAllGMs("receiveSharedDraft", payload);
    return true;
  } catch (_error) {
    return false;
  }
}
