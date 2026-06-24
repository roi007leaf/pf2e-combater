# Unconditional Actions — Design

**Date:** 2026-06-24
**Module:** pf2e-combater
**Status:** Approved (pending implementation plan)

## Problem

Some PF2e activities span multiple actions in a way the engine can't model as a single
planned step. Sudden Charge, for example, is "Stride, Stride, then Strike" — one activity, but
mechanically three things the VTT must do (two movements + an attack roll). The planner treats
each draft step as a discrete, budgeted action with its own targeting/cost/scoring, so there's
no clean way to represent "this one activity is really three sub-actions."

Players and GMs need a place to queue arbitrary real actions (e.g. two Strides and a Strike)
that **execute for real** alongside the regular plan but are **invisible to the action-economy
budget, the planner's scoring, and the plan's reserved-resource (spell-slot) tracking**.

## Goal

Add an **Unconditional actions** section to the combater panel: a second, manually-managed list
of real, executable actions that runs alongside the plan but is excluded from all plan-level
accounting.

## Non-goals

- Auto-detecting compound activities (e.g. parsing "Sudden Charge" into Stride/Stride/Strike).
  The list is populated manually.
- Auto-filling the unconditional list from recommendations.
- Changing how the planner scores or budgets the regular plan.

## Key decisions (from brainstorming)

1. **Adding mechanism:** Reuse the existing action library (tabs + search). A toggle controls
   whether the row's `+` adds to the plan or to the unconditional list.
2. **Scope & slots:** Allow *any* action. Execution behaves exactly like a plan step **except**
   these chips never count toward the 3-action budget, the planner's scoring, or the plan's
   reserved-resource tracking. A spell cast here still spends its real slot (PF2e does that on
   cast) — the unconditional list simply never reserves or tracks it.
3. **Execute & reset:** Each chip has its own Execute + Revert (like plan steps). The header
   **Reset** reverts **everything** — plan steps and unconditional chips — in reverse execution
   order. (Unified reset; no separate "run all" button.)
4. **Sync, permissions, lifecycle:** Lives on the same shared per-combatant draft as the plan,
   so a GM can add/run an AFK player's unconditional chips. Cleared at turn end alongside the
   plan. Auto-fill does not touch it. Unconditional chips do not appear in the header plan-strip
   sequence — only in their own card.

## Architecture

The defining property is **list separation**: every budget/scoring/slot-reservation code path
in the module reads `draft.steps`. Storing unconditional actions in a *separate* array on the
same draft makes them off-budget without adding a single exclusion check.

### Data model

The per-combatant draft (keyed `user|combat|combatant`, stored/synced via
[draft-plans.js](../../../scripts/state/draft-plans.js)) gains a second array:

```
draft = {
  steps: [ ...plan steps... ],          // budgeted, scored, slot-tracked (unchanged)
  unconditional: [ ...off-plan steps... ] // same step shape, excluded from all accounting
}
```

Each unconditional entry uses the **same step shape** as a plan step — `instanceId`, `action`,
`actionKey`, `actionCost`, `execution` (status/result/error/revert/completedAt),
`targetTokenIds`, `destination`, `areaMarker`, etc. Reusing the shape means the existing
`decorateDraftStep`, `executeDraftStep`, `revertDraftStep`, and the canvas pickers all work
unchanged.

`actionCost` is retained on unconditional entries for display only (the cost glyph); it is never
summed into the budget because nothing sums `draft.unconditional`.

### Components and responsibilities

- **draft-plans.js** — persist/sync `draft.unconditional` alongside `draft.steps` (local +
  shared writeback). A draft missing the field reads as `unconditional: []`.
- **action-builder.js (`decorateBuilder`)** — build a new `unconditional` view-model
  (`{ hasEntries, entries }`) by mapping `draft.unconditional` through the existing
  `decorateDraftStep`, so chips render identically to plan steps. Budget/scoring helpers
  (which read `draft.steps`) are untouched.
- **CombaterPanel.js** — render the new card; own the `addTarget` toggle state
  (`"plan" | "unconditional"`); route `data-add-action` to the chosen array; wire per-chip
  Execute/Revert/Remove/reorder for unconditional entries (mirroring the plan-step handlers);
  include unconditional entries in the unified Reset; gate edit/execute through the existing
  `_canExecuteDraft` / `_gmExecuteMode` shared-draft logic.
- **combater-panel.hbs** — a new card section (modeled on the `sustainedSpells` block) below
  the plan strip, plus the `Add to: [Plan] [Unconditional]` toggle in the action-library header.
- **action-executor.js / action-revert.js** — no behavioral change to a single step's
  execution; extend the **revert-all** entry point (`revertDraftExecution`) to accept executed
  steps from both `draft.steps` and `draft.unconditional` and revert them in reverse
  `execution.completedAt` order.

### Data flow

**Adding:** user sets the toggle to *Unconditional* → clicks a library row's `+` → panel builds
a step (same builder used for plan steps) → pushes to `draft.unconditional` → persists + syncs.

**Executing one chip:** Execute button → `executeDraftStep` (same path as a plan step:
targeting/movement/roll, writes `execution` with `completedAt` + `revert`) → persist + sync.

**Unified reset:** header Reset → collect executed entries from both arrays → sort by
`execution.completedAt` descending → revert each via the existing op-based revert → reset each
entry's status to pending → persist + sync.

**Turn end:** `clearEndedTurnDraft` clears the whole draft (both arrays) as today.

## Error handling

- A draft persisted before this feature has no `unconditional` field → treated as `[]`
  everywhere (defensive `Array.isArray(draft?.unconditional) ? … : []`).
- Per-chip execution failures behave exactly as plan steps do today (status `failed`, error
  surfaced on the chip, no revert op).
- Unified reset reverts best-effort per entry (an entry whose revert op can't complete records a
  manual-warning, same as the current revert path); one failure does not abort the rest.
- The `addTarget` toggle is panel-local UI state; if it is somehow unset it defaults to `plan`
  (current behavior), so adding can never silently misroute to a hidden bucket.

## Testing

Self-test (`scripts/engine/self-test.js`) additions:

- **Off-budget:** adding an action to `draft.unconditional` does not change the plan's computed
  cost / budget / scoring (assert plan budget identical with and without unconditional entries).
- **Toggle routing:** with `addTarget = "unconditional"`, the add handler pushes to
  `draft.unconditional`, not `draft.steps` (and vice versa).
- **Execution:** an unconditional chip executes through `executeDraftStep` and records
  `execution.completedAt` + a revert envelope.
- **Unified reset:** with executed entries in both arrays, the reset-all reverts them in reverse
  `completedAt` order and resets both arrays' statuses to pending.
- **Lifecycle:** turn-end clearing empties both arrays.
- **Permissions:** a GM executing a player's shared draft can run an unconditional chip
  (reuses the existing GM-execute path).
- **Template:** the panel template exposes the `Add to` toggle and renders the unconditional
  card (string-shape assertions, matching existing template tests).

## Open considerations (deferred, not blocking)

- Visual placement of the card (above vs below the sustained-spells card) is a layout nicety to
  settle during implementation; the spec only requires it to sit below the plan strip and above
  the action tabs.
- The label "Unconditional actions" is the agreed working name; trivially changeable later.
