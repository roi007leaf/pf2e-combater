const PLAYER_META_REASON_PATTERNS = [
  /\bweakness(?:es)?\b/i,
  /\bresists?\b|\bresistance\b/i,
  /\bimmun(?:e|ity|ities)\b/i,
  /\bspell\s*dc\b/i,
  /\b(?:fortitude|reflex|will|perception)\s+dc\s+\d+/i,
  /\b(?:fortitude|reflex|will|perception):\s*(?:low|mid|high)\b/i,
  /\bknown\s+.+\s+traits?\s+match/i,
  /\bdc\s+\d+\s+vs\b/i,
  /\bac\s+\d+/i,
  /\barmor class\s+\d+/i,
];

const PLAYER_INTEL_REASON_PATTERNS = {
  weaknesses: /\bweakness(?:es)?\b/i,
  resistances: /\bresists?\b|\bresistance\b/i,
  immunities: /\bimmun(?:e|ity|ities)\b/i,
  saves: /\bspell\s*dc\b|\b(?:fortitude|reflex|will)(?:\s+dc\s+\d+|:\s*(?:low|mid|high))|\bdc\s+\d+\s+vs\b/i,
  perception: /\bperception\s+dc\s+\d+|\bperception:\s*(?:low|mid|high)\b/i,
  traits: /\bknown\s+.+\s+traits?\s+match/i,
};

function reasonText(reason) {
  return String(reason ?? "").trim();
}

export function isPlayerMetaReason(reason) {
  const text = reasonText(reason);
  if (!text) return false;
  return PLAYER_META_REASON_PATTERNS.some((pattern) => pattern.test(text));
}

function isKnownPlayerIntelReason(reason, categories) {
  const text = reasonText(reason);
  if (!text) return false;
  return (Array.isArray(categories) ? categories : [])
    .some((category) => PLAYER_INTEL_REASON_PATTERNS[category]?.test(text));
}

export function sanitizeRecommendationReasons(reasons, {
  isGM = false,
  fallbackReason = "Action is available.",
  playerIntelCategories = [],
} = {}) {
  const normalized = (Array.isArray(reasons) ? reasons : [reasons])
    .map(reasonText)
    .filter(Boolean);

  if (isGM) return normalized;

  const safe = normalized.filter((reason) =>
    !isPlayerMetaReason(reason) || isKnownPlayerIntelReason(reason, playerIntelCategories));
  return safe.length ? safe : [fallbackReason];
}

export function sanitizeScoredRecommendation(action, {
  isGM = false,
  fallbackReason = "Action is available.",
  playerIntelCategories = [],
} = {}) {
  const reasons = sanitizeRecommendationReasons(action?.reasons ?? action?.reason, {
    isGM,
    fallbackReason,
    playerIntelCategories,
  });
  const bestTargetReasons = sanitizeRecommendationReasons(action?.bestTargetReasons ?? [], {
    isGM,
    fallbackReason: "",
    playerIntelCategories,
  }).filter(Boolean);
  return {
    ...action,
    reasons,
    reason: reasons[0] ?? fallbackReason,
    bestTargetReasons,
  };
}
