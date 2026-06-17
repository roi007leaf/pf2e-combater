const SEEK_VISIBILITY_STATES = new Set(["hidden", "undetected", "unnoticed"]);

function visionerModule() {
  return globalThis.game?.modules?.get?.("pf2e-visioner") ?? null;
}

export function isVisionerActive() {
  const modules = globalThis.game?.modules;
  if (modules?.get) {
    const entry = visionerModule();
    return Boolean(entry && entry.active !== false && entry.api);
  }

  return Boolean(globalThis.window?.visioneerApi);
}

function visionerApi() {
  const modules = globalThis.game?.modules;
  if (modules?.get) {
    const entry = visionerModule();
    if (!entry || entry.active === false) return null;
    return entry.api ?? null;
  }

  return globalThis.window?.visioneerApi ?? null;
}

function tokenId(value) {
  return value?.token?.id
    ?? value?.id
    ?? value?.document?.id
    ?? null;
}

function perceptionProfile(observer, target) {
  const api = visionerApi();
  const observerId = tokenId(observer);
  const targetId = tokenId(target);
  if (!api || !observerId || !targetId) return null;

  return api.autoVisibility?.getPerceptionProfile?.(observerId, targetId)
    ?? api.getPerceptionProfile?.(observerId, targetId)
    ?? null;
}

export function readVisionerDetectionState(observer, target) {
  const api = visionerApi();
  const observerId = tokenId(observer);
  const targetId = tokenId(target);
  if (!api || !observerId || !targetId) return null;

  const profile = perceptionProfile(observer, target);
  if (profile?.detectionState) return profile.detectionState;
  if (profile?.awarenessState) return profile.awarenessState;

  return api.getVisibility?.(observerId, targetId) ?? null;
}

export function readVisionerCoverState(observer, target) {
  const api = visionerApi();
  const observerId = tokenId(observer);
  const targetId = tokenId(target);
  if (!api || !observerId || !targetId) return null;

  const profile = perceptionProfile(observer, target);
  const profileCover = profile?.coverState ?? profile?.expectedCover;
  if (profileCover) return profileCover;
  if (profile?.hasCover === true) return "standard";

  return api.getCover?.(observerId, targetId)
    ?? api.getAutoCoverState?.(observerId, targetId, { rawPrereq: true })
    ?? null;
}

export function isSeekRelevantVisibility(state) {
  return SEEK_VISIBILITY_STATES.has(String(state ?? "").toLowerCase());
}

