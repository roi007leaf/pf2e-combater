const SEEK_VISIBILITY_STATES = new Set(["hidden", "undetected", "unnoticed"]);

function visionerApi() {
  return globalThis.game?.modules?.get?.("pf2e-visioner")?.api
    ?? globalThis.window?.visioneerApi
    ?? null;
}

function tokenId(value) {
  return value?.token?.id
    ?? value?.id
    ?? value?.document?.id
    ?? null;
}

export function readVisionerDetectionState(observer, target) {
  const api = visionerApi();
  const observerId = tokenId(observer);
  const targetId = tokenId(target);
  if (!api || !observerId || !targetId) return null;

  const profile = api.autoVisibility?.getPerceptionProfile?.(observerId, targetId)
    ?? api.getPerceptionProfile?.(observerId, targetId)
    ?? null;
  if (profile?.detectionState) return profile.awarenessState ?? profile.detectionState;

  return api.getVisibility?.(observerId, targetId) ?? null;
}

export function isSeekRelevantVisibility(state) {
  return SEEK_VISIBILITY_STATES.has(String(state ?? "").toLowerCase());
}

