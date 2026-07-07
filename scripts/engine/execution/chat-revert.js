import { t } from "../../i18n.js";
import { revertEnvelope } from "./results.js";

export function chatMessageIdFromResult(nativeResult) {
  if (!nativeResult || typeof nativeResult !== "object") return null;
  const candidates = [
    nativeResult,
    nativeResult.message,
    Array.isArray(nativeResult) ? nativeResult[0] : null,
    Array.isArray(nativeResult.messages) ? nativeResult.messages[0] : null,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const isMessage = candidate.documentName === "ChatMessage"
      || candidate.constructor?.name === "ChatMessage"
      || candidate === nativeResult.message;
    const id = candidate.id ?? candidate._id;
    if (isMessage && id) return id;
  }
  return null;
}

// Best-effort revert for chat-producing actions: delete traceable chat, restore tracked resources,
// and warn for target-side effects that cannot be reliably undone.
export function chatActionRevert(nativeResult, action, { target = null, slotOp = null } = {}) {
  const ops = [];
  const manualWarnings = [];
  const messageId = chatMessageIdFromResult(nativeResult);
  if (messageId) ops.push({ kind: "chat", messageId });
  if (nativeResult?.consumableRevertOp) ops.push(nativeResult.consumableRevertOp);
  if (nativeResult?.frequencyRevertOp) ops.push(nativeResult.frequencyRevertOp);

  if (slotOp) {
    ops.push(slotOp);
  } else if (action?.item && (action?.slotId ?? action?.location) != null) {
    ops.push({
      kind: "slot",
      entryId: action.spellcastingEntryId ?? null,
      entryUuid: action.spellcastingEntryUuid ?? null,
      rank: action.castRank ?? action.rank ?? null,
      slotId: action.slotId ?? action.location ?? null,
      slotIdExplicit: action.slotId !== undefined && action.slotId !== null,
    });
  }

  const targetName = String(target?.label ?? "").replace(/^Target:\s*/i, "").trim();
  if (targetName) {
    manualWarnings.push(t("Exec.ManualEffects", "{action} may have applied effects to {target} - undo them manually.", { action: action?.name ?? t("Exec.ThisActionCap", "This action"), target: targetName }));
  }
  if (!messageId) {
    manualWarnings.push(t("Exec.ManualUndo", "Undo {action} manually; its chat output could not be tracked.", { action: action?.name ?? t("Exec.ThisAction", "this action") }));
  }
  return revertEnvelope(ops, manualWarnings);
}
