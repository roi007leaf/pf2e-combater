# Drag-to-Reorder Plan Steps + Universal Action Search — Design

**Source:** Playtester feedback relayed 2026-07-04. Two asks: (1) a player wants to drag plan steps into place instead of clicking up/down repeatedly; (2) a player wants the action-browser search box to search across all tabs at once, not just the currently-active one.

Independent features sharing no code paths beyond both touching `CombaterPanel.js` and their respective templates. Scoped together since both came from the same feedback session.

## 1. Drag-to-reorder plan steps

**Today:** each step row has up/down buttons (`data-move-draft-step`, `combater-panel.hbs:80/85/147/152`) wired at `CombaterPanel.js:1399-1404` to `_moveDraftStep(instanceId, direction)` (`CombaterPanel.js:1831-1864`), which:
- blocks the move entirely if any step in the list isn't `"pending"` (warns `Notify.RevertBeforeReorder`);
- resolves the owning list (`steps` or `uncounted`) via `draftListForInstance`;
- does block-aware splicing so a grouped composite step's atoms (`step.groupId`, e.g. Double Attack) stay contiguous and move as one unit.

**Approach: native HTML5 Drag and Drop**, not a custom pointer-based drag. This is a short, vertical, mouse-driven desktop list — native `draggable`/`dragstart`/`dragover`/`drop` gives free ghost-image and reorder semantics without hand-building drop-position math, and matches how Foundry's own sidebar/directory lists already behave. Reuses `_moveDraftStep`'s existing guards rather than adding new ones.

**Markup (`combater-panel.hbs`):**
- New drag-handle icon (`fa-solid fa-grip-vertical`, matching the existing `fa-solid fa-arrow-up/down` icon convention at lines 361/364) added to `combater-step-tools`, one per single step row and one per grouped-step header — never per-atom inside a group.
- Handle carries `draggable="true"` and `data-drag-draft-step="{{instanceId}}"`. Same `canEditStepOrder` gate as the up/down buttons (`CombaterPanel.js:643`) — hidden/inert whenever `reorderLocked` or `readonly`, so the "block reorder if any step is non-pending" rule applies identically to drag as to the buttons it's replacing.
- Up/down buttons removed (drag handle replaces them per approved answer), one per list type (`steps`/`uncounted`) — each list only reorders within itself, matching current behavior; no cross-list drop target.

**Event wiring (`CombaterPanel.js`, alongside the existing `[data-move-draft-step]` block):**
- `dragstart` on a handle: stash the source `instanceId`/list key in `dataTransfer`, add a `.is-dragging` class to the row (or group block) being moved.
- `dragover` on sibling rows: `preventDefault()` to allow drop; toggle a `.drop-target-before`/`.drop-target-after` class on the hovered row based on cursor position within it, for a visible insertion line.
- `drop`: compute the target index from the hovered row's position in the DOM, then call a new `_reorderDraftStep(instanceId, targetInstanceId, placeBefore)` — a generalization of `_moveDraftStep` that takes a destination index instead of a fixed ±1, reusing the same list-resolution and group-contiguous splice logic (moving a grouped step still moves its whole atom block).
- `dragend`: clear `.is-dragging`/drop-target classes regardless of whether a drop occurred (handles drag-cancelled-via-Escape).

**CSS (`combater.css`):** new `.is-dragging` (dim/opacity the row being dragged) and `.drop-target-before`/`.drop-target-after` (thin insertion-line indicator) classes; drag handle styled like the existing `.combater-step-move` chip-tool icon it replaces.

**Explicitly not doing:**
- No cross-list drag (steps ↔ uncounted) — out of scope per approved answer, matches current button behavior.
- No touch/pointer-event fallback — native HTML5 DnD only, consistent with this being a desktop-panel interaction (same assumption the rest of the panel already makes).
- No change to the non-pending-step reorder lock — drag is gated by the same `canEditStepOrder`/`reorderLocked` state as today's buttons.

## 2. Universal action search across tabs

**Today:** search is already computed per-tab at build/render time, not per-DOM. `decorateBuilder` (`CombaterPanel.js:929`) calls `decorateBuilderTab` (730) for every tab in `ACTION_BUILDER_TABS` (line 981), and each call already runs `filterBuilderTabActions` (721) against the shared `searchQuery`/`actionSearchHaystack` (763/770) — every tab's action list is already filtered. The only reason search *looks* scoped to the active tab is `combater-browser.hbs:21`'s `{{#if active}}` gate, which discards every other (already-filtered) tab's sections before they ever reach the DOM.

**Approach:** no new filtering logic — surface the results that already exist.
- `decorateBuilder`: when `searchQuery` is non-empty, in addition to (or instead of, for render purposes) the per-tab `tabsList`, build a flat `mergedSearchResults` array — every non-empty section from every tab, each entry tagged with its source tab's label (`tab.label`/`tab.id`).
- `combater-browser.hbs`: branch near line 20 — if `builder.searchQuery` is non-empty, render `mergedSearchResults` (flat list, each result showing a small tab-name tag) instead of looping `tabsList`/`{{#if active}}`. Empty query falls back to today's per-tab rendering, unchanged.
- Tab strip (`.combater-tabs`, lines 5-10 / css 908-951): add a `disabled`/`is-inert` state driven by `builder.searchQuery` being non-empty — tabs dim and stop responding to clicks while a search is active, per approved answer, so there's no "I clicked a tab but nothing changed" confusion. Clearing the search re-enables them and returns to whatever tab was active before (tab selection state itself is untouched by searching — only its clickability and the content shown).
- Clicking a merged result behaves exactly as clicking that same action does today from its own tab (add-to-plan / open config) — "act in place," no active-tab switch, per approved answer.

**Explicitly not doing:**
- No change to `filterBuilderTabActions`/`actionSearchHaystack` matching logic itself — only how results are surfaced.
- No per-tab result counts/badges beyond the tab-name tag on each merged result.

## Testing

Both `CombaterPanel` and `CombaterBrowser` are `ApplicationV2` subclasses too tightly coupled to Foundry's DOM/canvas to instantiate under plain Node, so `self-test.js` tests them by asserting patterns against their own source text (e.g. existing `_moveDraftStep` coverage at `self-test.js:391`, search-wiring coverage at lines 201-214/436/448) rather than executing them live. This design follows that convention:

- Assert `combater-panel.hbs` exposes `data-drag-draft-step` on a handle, gated by the same `canEditStepOrder` condition as the up/down buttons it replaces (and that the up/down `data-move-draft-step` buttons are gone).
- Assert `panelSource` defines `_reorderDraftStep` and that it reuses `draftListForInstance` and group-contiguous (`groupId`) splice handling — same assertion shape as the existing `_moveDraftStep` check at line 391, generalized to the new function name.
- Assert `combater.css` defines `.is-dragging` and `.drop-target-before`/`.drop-target-after`.
- Assert `combater-browser.hbs` branches on `builder.searchQuery` to choose between `mergedSearchResults` and `tabsList`, and that the tab strip markup includes the inert/disabled state tied to `searchQuery`.
- Assert `panelSource`'s `decorateBuilder` builds `mergedSearchResults` from every tab's filtered sections (not just the active one) when a search query is present.
- No engine/planner test changes — neither feature touches `scoring.js` or `planner.js`.
