# Revert Execution — Design

**Date:** 2026-06-23
**Status:** Approved (design)

## Problem

When a drafted action is executed, it mutates real game state: tokens move, `prone`
is removed, `sickened` is reduced, area templates (Regions) are placed on the canvas,
chat messages are posted. Today the only "undo" affordance is `resetDraftExecution` /
`_resetExecution`, which merely flips each step's `execution.status` back to `pending`.
It does **not** reverse the underlying game-state change — the token stays moved, prone
stays gone, the region stays on the canvas.

We want a true revert: undoing an executed step restores the prior state (move the
token back, re-apply prone, re-increment sickened, delete the placed template, etc.),
and a re-executable step.

## Approach

**Capture-before → store-in-execution → invert-on-revert.**

At execution time, each executor branch records a plain-data `revert` descriptor on the
step's `execution` record describing how to undo itself. A revert operation reads that
descriptor and applies the inverse.

The draft is synchronized to the GM (`_syncDraftToGM`), so the `revert` descriptor
**must be JSON-serializable**: ids, coordinates, slugs, numbers, strings only — never
live token/document/region objects. Revert re-resolves live objects from those ids at
revert time (`canvasTokenById`, `scene.regions.get`, `game.messages.get`, actor from
context).

## Data shape

Extend `executionPatch(basePatch, status, extra)` to accept `extra.revert` and emit it:

```js
execution: {
  status: "done",
  completedAt: <ms>,
  result: "...",
  revert: {
    kind: "movement" | "condition" | "region" | "chat" | "none",
    // ...kind-specific payload...
    manualWarnings: []   // strings shown to the user; effects we cannot auto-undo
  }
}
```

A step with `status !== "done"` or no `revert` descriptor reverts to a no-op that simply
resets status to `pending`.

## Revert kinds and inverses

| Action | Captured at execute | Revert operation |
|---|---|---|
| Movement (stride / step / crawl, any `requiresDestination`) | `tokenId`, origin top-left `{x,y}` | `document.update({x,y})` back to origin (fallback `document.move`) |
| Stand | flag that `prone` was removed | re-add `prone` via `increaseCondition` (fallback `toggleCondition(slug,{active:true})`) |
| Retch — **only the branch that actually reduced** sickened | flag that `sickened` was reduced | increase `sickened` via `increaseCondition` |
| AoE | created Region `id` + `sceneId` | `scene.deleteEmbeddedDocuments("Region", [id])` |
| Strike / pf2e-action / native cast / guidance | chat message `id` (best-effort from `nativeResult`); spell-slot info if a cast; target label | delete chat message (best-effort); attempt slot restore; emit `manualWarnings` for conditions applied to a target |

### Movement origin capture

Capture the token's current top-left **before** moving:
- prefer finite `document.x` / `document.y`;
- else compute from token center and footprint: `center − (footprint * gridSize) / 2`
  (same formula `tokenWaypointForDestination` uses for a destination center).

Revert uses `document.update({x, y})` for a clean reposition. This bypasses the
per-turn / movement-budget gating that applies to forward movement (revert is an undo,
not a move). Foundry's movement-budget bookkeeping is **not** refunded — out of scope.

### Retch nuance

`executeRetch` returns `status: "done"` for both "Reduced sickened." and "Retch failed."
(no reduction). Only attach a `condition` revert descriptor on the branch that actually
called `decreaseCondition(sickened)` and succeeded. The failed-check branch gets no
revert payload.

### AoE region capture

`createAreaRegion` currently calls `scene.createEmbeddedDocuments("Region", [data])` and
returns the input `data` (no id). Change it to return the created document's `id` (and
`sceneId`) from the API result. The `regions.placeRegion` fallback path may not expose an
id; when no id is captured, revert emits a `manualWarning` instead of deleting.

### Chat / resource (best-effort) cases

For strikes, opened PF2e actions, native casts, and guidance:
- **Chat deletion** is best-effort: extract a message id from `nativeResult`
  (a `ChatMessage` instance, `result.message?.id`, or an array's first message id). When
  no id is extractable, skip deletion and add a `manualWarning`. Revert deletes via
  `game.messages.get(id)?.delete()` / `ChatMessage.deleteDocuments([id])`, wrapped in
  try/catch.
- **Spell-slot restore** is best-effort: capture `{ entryId/entryUuid, rank, slotId }`
  when a cast consumed a slot, and attempt the PF2e API (`entry.setSlotExpendedState` for
  prepared slots). On absence/failure, add a `manualWarning`.
- **Conditions applied to a target** (e.g. Demoralize → frightened on the target) cannot
  be reliably enumerated, so revert never auto-undoes them; it emits a `manualWarning`
  referencing the stored target label.

## Modules and responsibilities

### `scripts/engine/action-executor.js` (capture side — small additions)
- Extend `executionPatch` to pass through `extra.revert`.
- Add `increaseCondition(actor, slug, options)` mirroring `decreaseCondition`.
- `executeMovement` captures origin and attaches a `movement` revert descriptor on success.
- `executeStand` attaches a `condition` (re-add prone) descriptor on success.
- `executeRetch` attaches a `condition` (increase sickened) descriptor only on the
  reduced branch.
- `createAreaRegion` returns the created region id/sceneId; `executeDraftStep`'s area
  branch attaches a `region` descriptor.
- Strike / pf2e-action / open-item branches attach a `chat` descriptor (message id +
  optional resource + manualWarnings).
- Export shared utilities needed by the revert module: `canvasTokenById`,
  `actorDocument`, `tokenId`, `point`, `numeric`, `gridSize`, `tokenFootprint`,
  `increaseCondition`.

### `scripts/engine/action-revert.js` (new — invert side)
- `revertDraftStep({ context, step })` → reads `step.execution.revert`, dispatches by
  `kind`, performs the inverse with each sub-op wrapped in try/catch, collects warnings.
  Returns `{ status: "reverted" | "failed", patch: { execution: { status: "pending" } },
  warnings, error }`. Status always resets to `pending`.
- `revertDraftExecution({ context, draft })` → iterates **done** steps in **reverse**
  order, calls `revertDraftStep` for each, aggregates warnings, then returns
  `resetDraftExecution(draft)` for the data reset.

`resetDraftExecution` stays a pure, status-only reset (used by `revertDraftExecution`
for the final data shape and unchanged for its existing callers).

## UI (`scripts/ui/CombaterPanel.js`)

- Render a `[↶ revert]` control (`data-revert-step="<instanceId>"`) on each step whose
  `executionStatus === "done"`.
- Wire a `[data-revert-step]` click handler → `revertDraftStep` with the step's context →
  apply the returned `patch` via the existing `_applyExecutionResult` path (or a small
  sibling), `_syncDraftToGM`, surface `warnings`/`manualWarnings` through
  `ui.notifications.warn`, re-render.
- `_resetExecution` becomes async revert-all: call `revertDraftExecution`, write the
  reset draft, surface aggregated warnings, sync, re-render.
- Reverting uses the same `_canEditDraft()` gate as execution (revert mutates the same
  game state, so it needs the same permission).

## Testing (`scripts/engine/self-test.js`)

Extend the execution test harness mocks:
- `actorDocument.increaseCondition(slug, options)` recording into `conditionUpdates`.
- token `document.x/y` (or rely on center-based origin) so movement origin is capturable.
- `scene.deleteEmbeddedDocuments(type, ids)` recording into a `regionDeletes` array;
  `createEmbeddedDocuments` returns documents with an `id`.
- `game.messages` with `get(id)` / `delete()`, and `ChatMessage.deleteDocuments`.

Add revert assertions:
- movement revert → `document.update` (or move) back to the captured origin.
- stand revert → `increaseCondition({ slug: "prone" })`.
- retch revert (reduced branch) → `increaseCondition({ slug: "sickened" })`; failed-check
  branch has no revert payload.
- area revert → `scene.deleteEmbeddedDocuments("Region", [<id>])`.
- strike / pf2e-action revert → chat message delete attempted + a manual warning present.
- `revertDraftExecution` → reverts done steps in reverse order and returns a fully
  status-reset draft.
- Update the existing source-string assertion (≈ line 134) for the panel's renamed
  reset/revert path so the panel still references the expected symbols.

## Out of scope

- Refunding Foundry's per-turn movement budget / movement history.
- Auto-undoing conditions/effects applied to *other* tokens by an action.
- Reverting damage/HP changes from resolved strikes.
- Focus-point restore (spell-slot restore is attempted; focus is left to manual warning).
