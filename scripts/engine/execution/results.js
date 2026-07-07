export function executionPatch(basePatch, status, extra = {}) {
  return {
    ...basePatch,
    execution: {
      status,
      ...(status === "done" ? { completedAt: Date.now() } : {}),
      ...(extra.result ? { result: extra.result } : {}),
      ...(extra.error ? { error: extra.error } : {}),
      ...(extra.revert ? { revert: extra.revert } : {}),
    },
  };
}

// Plain-data descriptor of how to undo an executed step. Stored on the synced draft, so
// it must stay JSON-serializable: ids, coordinates, slugs, numbers, strings only.
export function revertEnvelope(ops = [], manualWarnings = []) {
  const cleanOps = (Array.isArray(ops) ? ops : []).filter(Boolean);
  if (!cleanOps.length && !manualWarnings.length) return null;
  return { ops: cleanOps, manualWarnings };
}

// Prepend a revert op (e.g. delete a placed area region) onto a branch result that may
// already carry its own revert payload. Only attaches when the step actually completed.
export function attachRevertOp(result, op) {
  if (!op || result?.status !== "done" || !result?.patch?.execution) return result;
  const existing = result.patch.execution.revert ?? { ops: [], manualWarnings: [] };
  const ops = [op, ...(Array.isArray(existing.ops) ? existing.ops : [])];
  return {
    ...result,
    patch: {
      ...result.patch,
      execution: {
        ...result.patch.execution,
        revert: { ops, manualWarnings: existing.manualWarnings ?? [] },
      },
    },
  };
}
