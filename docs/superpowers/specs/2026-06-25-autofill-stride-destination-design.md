# Auto-fill: Recommend Stride Destinations (with Waypoints) for GM NPCs

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan

## Problem

When the GM auto-fills a plan for an NPC, target selection is now pre-filled
from the aggro system, but movement is not: a Stride step still says "Choose
destination at execution", so the GM has to place every move by hand. Auto-fill
should also recommend where each Stride lands — and, when the straight path is
blocked, route around the obstacle with waypoints.

## Goals

- GM-NPC auto-fill pre-fills a recommended destination for movement steps
  (Stride / Step / Crawl).
- When the recommended route bends around an obstacle, store waypoints so the
  token follows the route instead of cutting a straight (blocked) line.
- The recommendation is a snapshot the GM can still override via the destination
  tool. Players are unaffected.

## Non-Goals

- No change to how movement executes, to the recommendation/scoring engine, or
  to move-and-strike activities (Sudden Charge already auto-plots its movement at
  execution and does not store a destination).
- No continuous recomputation; the destination is captured once at auto-fill.

## Background / Constraints

- `movementPreviewForStep` (movement-preview.js) already computes
  `recommendedCenter` (the best landing toward the previewed target) and a
  stepwise `route` that routes around walls. It operates in **scene/feet
  coordinates**; a stored step `destination` is in **canvas pixels**.
  `showMovementPreview` already performs the pixel↔scene conversion.
- `executeMovement` (action-executor.js) moves straight to `destination` via
  `document.move` unless given `movementPlan.waypoints` with `native: false`, in
  which case it moves through each waypoint. So waypoints are needed only when
  the path bends.

## Approach

Extract the scene-conversion + preview call out of `showMovementPreview` into a
shared `computeMovementPreview(context, step)` (chosen over replicating the
conversion or calling the preview in pixel space — the cost model ties feet to
grid distance, so a pixel-space call breaks the speed budget). The hover drawer
keeps using it unchanged; a new recommender reuses it so the coordinate logic
lives in one place.

## Design

### `movement-preview.js`

- `computeMovementPreview(context, step)`: the body of `showMovementPreview` up to
  and including the `movementPreviewForStep(...)` call — builds the scene context,
  converts the step, and returns the preview (in scene coords) plus the `scale`
  used. `showMovementPreview` calls this, then draws as today (no behavior
  change to the hover preview).
- `recommendedMovementForStep(context, step)`: calls `computeMovementPreview`,
  takes `preview.recommendedCenter` (and its `.route`), converts them to pixel
  coords (`× scale`), and returns `{ destination, waypoints }` (pixels) or null
  when there is no recommendation. `waypoints` are the **corner points** of the
  route — points where the step-to-step direction changes — and are omitted when
  the route is straight (a direct `document.move` suffices). The final
  destination is not duplicated into `waypoints` (execution appends it).

### `CombaterPanel._autoFillDraft`

- Compute `useAggroTargets = canUseFullAggro(this._context)` (already added for
  target prefill); reuse the same gate for movement.
- For each atomic step where `requiresDestinationForAction(step)` is true and the
  step has no explicit destination, call `recommendedMovementForStep` and, when it
  returns a destination, add to the draft step:
  - `destination: rec.destination`
  - `movementPlan: { native: false, waypoints: rec.waypoints }` when
    `rec.waypoints?.length`.
- Non-GM / non-NPC and non-movement steps are unchanged.

### Behavior

- The stored destination satisfies execution readiness (no "Choose destination"
  prompt) and drives `executeMovement`. The GM can re-pick with the destination
  tool, which overwrites the snapshot.

## Testing

- Engine self-test for `recommendedMovementForStep` against a mock context
  (origin + target + `gridSize`): asserts it returns a destination toward the
  target; with a `pathBlocked` option that forces a bend, asserts `waypoints`
  appear; with a clear straight path, asserts none.
- Source-presence assertion that `_autoFillDraft` consults
  `recommendedMovementForStep` and stores `movementPlan` under the GM-NPC gate.
- ESLint clean; `node scripts/engine/self-test.js` green.
- **Live-only caveat:** the pixel↔scene round-trip and the actual token movement
  (single move and multi-waypoint around walls) require a live Foundry canvas —
  the headless harness cannot exercise `document.move` or wall collision against
  real placeables.
