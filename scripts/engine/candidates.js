import { readActionSources } from "../readers/action/reader.js";
import { readConsumableSpellActions, readSpellActions } from "../readers/spell-reader.js";
import { npcTacticRejection } from "../rules/npc-tactics.js";
import { SETTINGS, settingOrDefault } from "../settings.js";
import { scoreCandidate } from "./scoring.js";
import { t } from "../i18n.js";
import { actionExclusionKey, readActionExclusions } from "../state/action-exclusions.js";

const REJECTED_SCORE = -900;

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
    return `strike:${itemKey(action.item) ?? action.id ?? action.name}:${action.altUsage ?? ""}`;
  }
  // Keyed by the physical wand/scroll, not slug+cost -- otherwise a carried scroll of a spell the
  // actor also knows would collide with (and lose to) the known-spell candidate, hiding the backup
  // option for when the known spell's own slots/focus points run out.
  if (action.consumableItem) {
    return `consumable-spell:${itemKey(action.consumableItem) ?? action.id ?? action.name}:${action.actionCost}`;
  }
  // The same spell can be prepared/known at several ranks or in separate entries.
  // Each choice has its own slot resource and must remain independently addable.
  if (String(action.source ?? "").startsWith("spell")) {
    return `spell:${action.spellcastingEntryUuid ?? action.spellcastingEntryId ?? ""}:${itemKey(action.item) ?? action.variantGroup ?? action.id ?? action.slug}:${action.castRank ?? action.rank ?? ""}:${action.slug}:${action.actionCost}`;
  }
  return `${action.slug ?? action.name}:${action.actionCost}`;
}

// Rejected only because nothing is in range/reach right now: the planner may still use it after a
// move in the same turn (Stride -> Demoralize, Stride -> Strike). Matched against the readers' own
// localized reasons so it works in every language.
function rejectedOnlyForRange(action) {
  const reason = action?.unavailableReason;
  if (!reason) return false;
  const range = Number(action.maxRange ?? action.targetingProfile?.maxRange ?? action.range?.max);
  const reasons = new Set([
    t("Avail.NoTargetInRange", "No target in range."),
    t("Avail.NoEnemyInReach", "No enemy in reach."),
    ...(Number.isFinite(range) ? [t("Avail.NoTargetWithin", "No target within {range} feet.", { range })] : []),
  ]);
  return reasons.has(reason);
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
    duplicates.push({ action: rejected, reason: t("Reject.Duplicate", "Duplicate detected action replaced by preferred source.") });
  }

  return { detected: [...byKey.values()], duplicates };
}

export function buildCandidates(context) {
  const spells = settingOrDefault(SETTINGS.enableSpellRecommendations, true)
    ? [...readSpellActions(context), ...readConsumableSpellActions(context)]
    : [];
  const actions = readActionSources(context, spells);
  const includeUnknown = settingOrDefault(SETTINGS.includeUnknownCustomActions, false);

  const { detected, duplicates } = dedupeDetected([...actions, ...spells], includeUnknown);
  const candidates = [];
  const rejected = [...duplicates];
  const approachable = [];
  const exclusions = readActionExclusions(context);

  for (const detectedAction of detected) {
    const hidden = exclusions.has(actionExclusionKey(detectedAction));
    const action = hidden ? { ...detectedAction, userExcluded: true } : detectedAction;
    if (hidden && globalThis.game?.user?.isGM !== true) {
      rejected.push({ action, exclusionRejected: true, reason: t("Reject.UserExcluded", "Hidden from Browse and Auto-fill for this actor.") });
      continue;
    }
    if (!action.available) {
      rejected.push({ action, reason: action.unavailableReason || t("Reject.NotAvailable", "Action is not available in current context.") });
      if (rejectedOnlyForRange(action) && !String(action.source ?? "").endsWith("-unknown")) {
        const scored = scoreCandidate(context, { ...action, available: true }, spells, detected);
        if (!npcTacticRejection(context, scored, detected)) approachable.push({ ...scored, available: true, needsApproach: true });
      }
      continue;
    }
    if (action.source === "spell-unknown") {
      rejected.push({ action, reason: t("Reject.SpellNotCurated", "Spell is not in curated catalog.") });
      continue;
    }
    if (action.source === "custom-unknown" && !includeUnknown) {
      rejected.push({ action, reason: t("Reject.UnknownHidden", "Unknown custom action hidden by setting.") });
      continue;
    }
    const scored = scoreCandidate(context, action, spells, detected);
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

  return { candidates, rejected, detected, approachable };
}
