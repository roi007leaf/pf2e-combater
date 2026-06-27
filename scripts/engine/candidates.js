import { readActionSources } from "../readers/action-reader.js";
import { readSpellActions } from "../readers/spell-reader.js";
import { npcTacticRejection } from "../rules/npc-tactics.js";
import { SETTINGS, setting } from "../settings.js";
import { scoreCandidate } from "./scoring.js";

const REJECTED_SCORE = -900;

function readSetting(key, fallback) {
  try {
    return setting(key);
  } catch (_error) {
    return fallback;
  }
}

function sourcePriority(action, includeUnknown) {
  if (action.source === "spell-curated") return 50;
  if (action.source === "custom-curated") return 40;
  if (action.source === "system-inferred") return 35;
  if (action.source === "spell-inferred") return 34;
  if (action.source === "spell-unknown") return includeUnknown ? 30 : 5;
  if (action.source === "custom-unknown") return includeUnknown ? 20 : 5;
  if (action.source === "generic") return 10;
  return 0;
}

function itemKey(item) {
  return item?.uuid ?? item?.id ?? item?._id ?? null;
}

function dedupeKey(action) {
  if (action.source === "strike") {
    return `strike:${itemKey(action.item) ?? action.id ?? action.name}`;
  }
  return `${action.slug ?? action.name}:${action.actionCost}`;
}

function preferAction(left, right, includeUnknown) {
  const priorityDelta = sourcePriority(right, includeUnknown) - sourcePriority(left, includeUnknown);
  if (priorityDelta !== 0) return priorityDelta > 0 ? right : left;
  if (right.available && !left.available) return right;
  if (left.available && !right.available) return left;
  return left;
}

function dedupeDetected(detected, includeUnknown) {
  const byKey = new Map();
  const duplicates = [];

  for (const action of detected) {
    const key = dedupeKey(action);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, action);
      continue;
    }

    const preferred = preferAction(existing, action, includeUnknown);
    const rejected = preferred === existing ? action : existing;
    byKey.set(key, preferred);
    duplicates.push({ action: rejected, reason: "Duplicate detected action replaced by preferred source." });
  }

  return { detected: [...byKey.values()], duplicates };
}

export function buildCandidates(context) {
  const spells = readSetting(SETTINGS.enableSpellRecommendations, true)
    ? readSpellActions(context)
    : [];
  const actions = readActionSources(context, spells);
  const includeUnknown = readSetting(SETTINGS.includeUnknownCustomActions, false);

  const { detected, duplicates } = dedupeDetected([...actions, ...spells], includeUnknown);
  const candidates = [];
  const rejected = [...duplicates];

  for (const action of detected) {
    if (!action.available) {
      rejected.push({ action, reason: action.unavailableReason || "Action is not available in current context." });
      continue;
    }
    if (action.source === "spell-unknown") {
      rejected.push({ action, reason: "Spell is not in curated catalog." });
      continue;
    }
    if (action.source === "custom-unknown" && !includeUnknown) {
      rejected.push({ action, reason: "Unknown custom action hidden by setting." });
      continue;
    }
    const scored = scoreCandidate(context, action);
    const npcRejection = npcTacticRejection(context, scored, detected);
    if (npcRejection) {
      rejected.push({ action: scored, reason: npcRejection });
      continue;
    }
    if (scored.score <= REJECTED_SCORE) {
      rejected.push({ action: scored, reason: scored.reason || "Action is not useful in current context." });
      continue;
    }
    candidates.push(scored);
  }

  return { candidates, rejected, detected };
}
