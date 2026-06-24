const PLAYER_META_REASON_PATTERNS = [
  /\bweakness(?:es)?\b/i,
  /\bresists?\b|\bresistance\b/i,
  /\bimmun(?:e|ity|ities)\b/i,
  /\bspell\s*dc\b/i,
  /\b(?:fortitude|reflex|will|perception)\s+dc\s+\d+/i,
  /\bdc\s+\d+\s+vs\b/i,
  /\bac\s+\d+/i,
  /\barmor class\s+\d+/i,
];

function reasonText(reason) {
  return String(reason ?? "").trim();
}

export function isPlayerMetaReason(reason) {
  const text = reasonText(reason);
  if (!text) return false;
  return PLAYER_META_REASON_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeRecommendationReasons(reasons, {
  isGM = false,
  fallbackReason = "Action is available.",
} = {}) {
  const normalized = (Array.isArray(reasons) ? reasons : [reasons])
    .map(reasonText)
    .filter(Boolean);

  if (isGM) return normalized;

  const safe = normalized.filter((reason) => !isPlayerMetaReason(reason));
  return safe.length ? safe : [fallbackReason];
}

export function sanitizeScoredRecommendation(action, {
  isGM = false,
  fallbackReason = "Action is available.",
} = {}) {
  const reasons = sanitizeRecommendationReasons(action?.reasons ?? action?.reason, { isGM, fallbackReason });
  return {
    ...action,
    reasons,
    reason: reasons[0] ?? fallbackReason,
  };
}
