import { MODULE_ID } from "../constants.js";

// Retch's Fortitude save is rolled by the player, but only the GM knows the DC of the effect that
// sickened them — so the "did it reduce sickened?" call belongs to the GM. This wires a small
// request/response over the module socket: the player asks, the active GM answers, and the player
// then applies the reduction itself (so the step's revert stays on the player's side).

const REQUEST_TIMEOUT_MS = 60_000;
const pendingRequests = new Map();

function randomId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `retch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

function gmIsOnline() {
  const users = globalThis.game?.users;
  const list = Array.isArray(users) ? users : (users?.contents ?? Array.from(users ?? []));
  return list.some?.((user) => user?.isGM === true && user?.active === true) === true;
}

// PLAYER: ask the GM whether the rolled Retch reduced sickened. Resolves to true/false, or null when
// no GM is connected or the request times out (the caller then falls back to a local prompt).
export function requestRetchDecision({ actorName } = {}) {
  const socket = globalThis.game?.socket;
  if (typeof socket?.emit !== "function" || !gmIsOnline()) return Promise.resolve(null);

  const requestId = randomId();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout?.(() => {
      pendingRequests.delete(requestId);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, (value) => {
      if (timer) globalThis.clearTimeout?.(timer);
      pendingRequests.delete(requestId);
      resolve(value);
    });
    socket.emit(`module.${MODULE_ID}`, {
      type: "retchRequest",
      requestId,
      userId: globalThis.game?.user?.id ?? null,
      actorName: actorName ?? "A creature",
    });
  });
}

// GM: prompt for the outcome and reply to the requesting player. Only the active GM answers, so a
// multi-GM table doesn't pop the dialog on every screen.
async function handleRetchRequest(payload) {
  if (globalThis.game?.user?.isGM !== true) return;
  const activeGM = globalThis.game?.users?.activeGM;
  if (activeGM && activeGM !== globalThis.game.user) return;

  const message = `Did ${payload?.actorName ?? "the creature"}'s Retch reduce sickened?`;
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  const succeeded = dialog?.confirm
    ? await dialog.confirm({
      window: { title: "Retch result" },
      content: `<p>${escapeHtml(message)}</p>`,
      yes: { label: "Reduce sickened" },
      no: { label: "No reduction" },
    })
    : (globalThis.window?.confirm?.(message) ?? false);

  globalThis.game?.socket?.emit?.(`module.${MODULE_ID}`, {
    type: "retchResult",
    requestId: payload?.requestId ?? null,
    userId: payload?.userId ?? null,
    succeeded: succeeded === true,
  });
}

// PLAYER: resolve the pending request the GM just answered.
function handleRetchResult(payload) {
  if (payload?.userId && payload.userId !== globalThis.game?.user?.id) return;
  const resolve = payload?.requestId ? pendingRequests.get(payload.requestId) : null;
  if (resolve) resolve(payload?.succeeded === true);
}

// Dispatch retch socket messages. Returns true when the payload was a retch message (handled).
export function handleRetchSocket(payload) {
  if (payload?.type === "retchRequest") {
    handleRetchRequest(payload);
    return true;
  }
  if (payload?.type === "retchResult") {
    handleRetchResult(payload);
    return true;
  }
  return false;
}
