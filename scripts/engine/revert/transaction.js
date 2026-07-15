import { t } from "../../i18n.js";

function snapshotEntries(snapshot) {
  return snapshot && typeof snapshot === "object" ? Object.entries(snapshot) : [];
}

export function snapshotMatches(current, expected) {
  const entries = snapshotEntries(expected);
  if (!entries.length) return true;
  return entries.every(([key, value]) => Object.is(current?.[key], value));
}

export function addRevertConflictWarning(warnings, label) {
  warnings?.push?.(t(
    "Revert.StateChanged",
    "Skipped undo for {label}: state changed after execution.",
    { label },
  ));
}

// Older synced drafts do not have expectedAfter. Preserve their legacy best-effort undo;
// new transactions restore only when current state still equals what execution produced.
export function canRestoreSnapshot({ current, expectedAfter, warnings, label }) {
  if (!snapshotEntries(expectedAfter).length) return true;
  if (snapshotMatches(current, expectedAfter)) return true;
  addRevertConflictWarning(warnings, label);
  return false;
}
