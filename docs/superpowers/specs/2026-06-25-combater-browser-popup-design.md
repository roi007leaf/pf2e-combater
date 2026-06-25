# Combater: Browser in a Separate Popup Window

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan

## Problem

The expanded two-column Combater panel solved the original vertical-squeeze
problem but introduced a new one: the left "plan" column is short (a few draft
steps plus the occasional unconditional/sustained entry) while the right
"browser" column is tall, so the window height is driven by the browser and the
plan column is left with a large band of dead space.

A right-docked drawer would not help — docked beside the plan it is simply the
two-column layout again, with the same gap. The dead space is inherent to placing
a short plan beside a long browser in one window.

## Goals

- Eliminate the dead space by removing the side-by-side layout.
- Keep the plan and the browser both usable, each in a surface sized to its own
  content.
- Follow a familiar Foundry pattern (separate browser/prepare windows).

## Non-Goals

- No change to the recommendation engine, scoring, budget rules, destination
  chaining, or any action `data-*` hooks.
- No change to how actions execute or to the draft data model.

## Approach

Split the UI into two windows:

- The main **`CombaterPanel`** becomes **plan-only** and auto-sizes to the plan,
  so there is no dead space.
- A new **`CombaterBrowser`** `ApplicationV2` holds the entire action browser
  (cost tabs, search, action sections) in its own resizable window, opened from
  the panel.

The panel remains the single source of truth (approach 1 of the three considered;
the alternatives were an independent popup that recomputes its own context, and a
shared controller object — both rejected as more code or more drift risk). The
popup is a thin view over the panel's computed builder model, and all mutations
route back through the panel, which re-renders both windows.

## Design

### Components

**`CombaterPanel`** (existing, reduced to plan-only)
- Renders: header (portrait, badges, Auto-fill, refresh, **Browse actions
  toggle**), the draft sequence (`draftSequence` partial), sustained spells, and
  unconditional actions — a single auto-height column.
- Remains the source of truth: computes the builder model in `_prepareContext`,
  owns all draft mutations (`_addAction`, `_addUnconditionalAction`,
  `_removeDraftStep`, `_moveDraftStep`, favorites, sustain, execution) and the
  refresh-on-hooks logic.
- Holds a `_browser` reference to the popup (or null).

**`CombaterBrowser`** (new `ApplicationV2`, `combater-browser.hbs`)
- Renders the action browser: cost tabs, search box, and action sections
  (markup extracted from the current `combater-panel.hbs` browser column).
- Owns the browser-local view state `activeTab` and `searchQuery` (moved off the
  panel) and a back-reference to the panel.
- Resizable, with its own `window-content` scroll.

### Data flow & sync

- The panel computes the builder model once per render and exposes it (e.g. a
  `builderModelForBrowser()` accessor or a stored `_builderModel`). The popup's
  `_prepareContext` decorates the active-tab/search view from that model, so the
  plan parts (panel) and the tab view (popup) derive from one computation.
- Mutations route through the panel: the popup's add / add-unconditional /
  favorite / open-details controls call the corresponding panel methods. After a
  mutation the panel re-renders itself and calls `this._browser?.render({ force:
  true })`.
- Foundry hooks (combat turn, actor update, item create/update/delete, target
  change, token refresh) already drive `panel.refresh()`. That path now also
  refreshes the popup, so budget, `overBudget`, and eligibility states stay live
  across both windows.
- Tab switching and search re-render the popup only (the panel does not depend on
  them).

### Panel template & CSS changes

- Remove the `combater-workspace` two-column wrapper, the `combater-tabs` nav, and
  the `combater-body` browser section from `combater-panel.hbs`. Keep the header,
  the `draftSequence` partial, the sustained panel, and the unconditional panel as
  a plain single column.
- Replace the expand/collapse chevron in the header with the **Browse actions**
  toggle button.
- Remove the now-dead two-column CSS (`combater-workspace`, the `@container`
  queries, the flex-fill shell rules, sticky tabs). The shared classes used by the
  browser (`combater-tabs`, `combater-search`, `combater-action-row`,
  `combater-step-cost`, cost glyphs, detail chips) are reused by the popup.

### Browser popup lifecycle

- `panel._toggleBrowser()` opens the popup if closed (constructing
  `CombaterBrowser` with a reference to the panel, rendering it, positioning it
  just right of the panel) or closes it if open.
- The popup stays open while the player adds multiple actions.
- Closing the panel closes the popup; the popup's `_onClose` clears
  `panel._browser`.
- Persisted state (localStorage): popup position and size, `activeTab`,
  `searchQuery`, and last-open flag. If the popup was open when the panel last
  closed, it reopens with the panel.

### Interaction details

- Picking an action in the popup routes to the panel mutation, which updates the
  draft and re-renders both windows. The existing `overBudget` rule still disables
  the plan "+" while the off-budget unconditional "+" stays unlimited.
- "Open action details" from the popup opens the PF2e action sheet exactly as it
  does today.

### Edge cases

- No combat / no actor: the popup renders an empty/disabled state, matching the
  panel's "No combat context" handling.
- A destination/area picker is active in the panel: panel refresh already only
  re-renders during a picker; the popup render is canvas-free and safe.
- Turn change: the panel re-points to the new combatant and refreshes both
  windows, so the popup shows the new actor's actions.

## Validation

- Engine modules are untouched, so the existing `node scripts/engine/self-test.js`
  suite continues to pass. Add source-presence assertions for the new wiring: the
  panel exposes the builder model, the popup routes adds through the panel, and the
  panel closes the popup on close.
- Playwright (local HTTP server) screenshots: panel plan-only with no dead space;
  the browser popup rendering tabs + sections; an add reflected in both windows;
  narrow-window sanity. ESLint clean.
