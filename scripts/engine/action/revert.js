import { contextActorDocument } from "../actor-context.js";
import { revertCondition } from "../execution/conditions.js";
import { resetDraftExecution } from "../execution/state.js";
import { revertChat, revertEffect, revertRegion } from "../revert/documents.js";
import { revertCarryType, revertConsumable, revertFrequency, revertReload } from "../revert/item-resources.js";
import { revertMovement } from "../revert/movement.js";
import { revertSlot } from "../revert/spell-slot.js";
import { t } from "../../i18n.js";
import { revertNpcReloadState } from "../npc-reload-state.js";

async function applyRevertOp(op, scope) {
  switch (op?.kind) {
    case "movement":
      return revertMovement(op, scope);
    case "condition":
      return revertCondition(op, scope);
    case "region":
      return revertRegion(op);
    case "effect":
      return revertEffect(op);
    case "carry-type":
      return revertCarryType(op, scope);
    case "consumable":
      return revertConsumable(op, scope);
    case "reload":
      return revertReload(op, scope);
    case "npc-reload-state":
      return revertNpcReloadState(op, scope);
    case "frequency":
      return revertFrequency(op, scope);
    case "chat":
      return revertChat(op);
    case "slot":
      return revertSlot(op, scope);
    default:
      return undefined;
  }
}

// Undo a single executed step. Each sub-operation is isolated so one failure cannot block
// the rest, and the step's execution status is always reset to "pending" so it can be
// re-executed. Stored destination/target/area choices are left intact on the step.
export async function revertDraftStep({ context, step } = {}) {
  const revert = step?.execution?.revert;
  const warnings = [...(revert?.manualWarnings ?? [])];
  // warnings collected here are also persisted onto the reset step (not just shown as a toast),
  // so a step whose real-world effect wasn't actually undone stays distinguishable from a clean
  // revert even after the notification disappears -- it can still be re-executed either way.
  const resetPatch = () => ({ execution: { status: "pending", revertWarnings: warnings } });
  if (step?.execution?.status !== "done" || !Array.isArray(revert?.ops)) {
    return { status: "reverted", patch: resetPatch(), warnings };
  }

  const actor = contextActorDocument(context, { allowActorFallback: true });
  for (const op of revert.ops) {
    try {
      await applyRevertOp(op, { context, actor, warnings });
    } catch (error) {
      warnings.push(t("Revert.CouldNotRevert", "Could not revert {kind}: {error}", { kind: op?.kind ?? "action", error: error?.message ?? error }));
    }
  }
  return { status: "reverted", patch: resetPatch(), warnings };
}

// Revert every completed step across the plan and uncounted lists in reverse execution
// order, then return the status-reset draft. Ordering is by execution.completedAt (newest
// first); ties fall back to reverse list position so plan-only drafts behave exactly as before.
// `contextForStep` lets callers resolve a per-step context (multi-combatant drafts).
export async function revertDraftExecution({ context, draft, contextForStep } = {}) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const uncounted = Array.isArray(draft?.uncounted) ? draft.uncounted : [];
  const warnings = [];
  const executed = [...steps, ...uncounted]
    .map((step, index) => ({ step, index, at: Number(step?.execution?.completedAt) || 0 }))
    .filter((entry) => entry.step?.execution?.status === "done")
    .sort((left, right) => (right.at - left.at) || (right.index - left.index));
  for (const { step } of executed) {
    const stepContext = contextForStep?.(step) ?? context;
    const result = await revertDraftStep({ context: stepContext, step });
    warnings.push(...(result.warnings ?? []));
  }
  return { draft: resetDraftExecution(draft), warnings };
}
