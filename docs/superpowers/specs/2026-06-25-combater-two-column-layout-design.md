# Combater Panel: Two-Column Responsive Layout

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan

## Problem

The expanded Combater panel stacks everything in a single ~420px-wide column:
header → draft sequence → sustained spells → unconditional actions → cost tabs →
action browser. The draft and unconditional sections grow as the player builds a
plan, pushing the action browser into an ever-smaller slice at the bottom while a
full monitor of horizontal space sits unused to the right of the panel.

The vertical squeeze is self-inflicted by the single narrow column. The fix is not
a navigation drawer or icon tabs — it is to use the available horizontal space:
split the expanded view into two independently-scrolling columns so the persistent
plan and the transient browser stop competing for vertical room.

## Goals

- Plan (draft + sustained + unconditional) and browser (tabs + search + action
  sections) sit side by side in two columns when the window is wide enough.
- Neither column can squeeze the other; each scrolls independently.
- Narrow windows (players who dock the panel small) automatically fall back to
  today's single-column stack. No new setting, no JS resize plumbing.
- Compact (collapsed) mode is unchanged.

## Non-Goals

- No change to the action-recommendation engine, scoring, or any `data-*` action
  hooks / event listeners.
- No migration of existing users' saved window size; responsiveness handles them.
- No navigation drawer, no icon-only tabs, no tab→drawer conversion.

## Approach

Container-query-driven responsive two-column layout (chosen over a JS width-class
toggle and over a setting-gated fixed layout). The window's own width drives the
column count via a CSS container query; resizing the window narrow collapses it
back to a single column with no script involvement.

## Design

### 1. DOM structure (`templates/combater-panel.hbs`)

The draft sequence currently lives inside `<header class="combater-compact">`
(the `.combater-plan-strip`) so it renders in both compact and expanded modes.
Two-column mode needs the draft in the left column when expanded, but the header
must still show it when compact.

Resolution: extract the draft sequence markup into a Handlebars `{{#*inline}}`
partial defined once in the template, and invoke it in two locations chosen by
mode:

```
.combater-shell.is-expanded
  header.combater-compact
    .combater-identity
    .combater-actions
    {{#unless expanded}} {{> draftSequence}} {{/unless}}   ← compact only
  {{#if expanded}}
  .combater-workspace                       ← grid; the container-query target
    .combater-col-plan                      ← LEFT column, own scroll
       {{> draftSequence}}                  ← expanded placement
       section.combater-sustained-panel
       section.combater-unconditional-panel
    .combater-col-browse                    ← RIGHT column, own scroll
       nav.combater-tabs
       section.combater-body (search + action sections)
  {{/if}}
```

- Compact mode is untouched: only the header renders, draft stays in the header.
- Single-column expanded mode collapses `.combater-workspace` to one column; the
  natural source order (draft → sustained → unconditional → tabs → browse) matches
  today's vertical layout.
- All existing `data-*` attributes and inner markup move verbatim with their
  blocks, so the JS listeners in `CombaterPanel.js` need no changes.

### 2. Responsive + sizing (`styles/combater.css`)

- Container context: `.combater-shell { container-type: inline-size; }` — this
  tracks the window's inner width, the correct axis (the existing
  `@media (max-width: 430px)` query keys off the viewport, which is wrong for a
  floating, resizable window).
- Default single column:
  `.combater-workspace { display: grid; grid-template-columns: 1fr; gap: 10px; }`
- Two columns when wide enough:
  ```css
  @container (min-width: 640px) {
    .combater-workspace {
      grid-template-columns: minmax(240px, 0.9fr) minmax(280px, 1.1fr);
    }
  }
  ```
  The browser column is slightly wider than the plan column.
- Window width: `DEFAULT_OPTIONS.position.width` 420 → **720** so the panel opens
  in two-column mode. CSS `max-width` raised from `min(520px, …)` to
  `min(980px, calc(100vw - 24px))`. `min-width: 360px` is retained.
- The viewport `@media (max-width: 430px)` block is replaced by the container
  query; any rules in it that are still useful (cost-tab sizing, row padding) are
  folded into a `@container (max-width: 639px)` block or kept as base styles.

### 3. Height / scroll

- Each column caps its height and scrolls independently:
  `max-height: min(72vh, calc(100vh - 160px)); overflow-y: auto;`
  Because the window is auto-height, its height becomes `max(left, right) + header`,
  so it never exceeds the viewport and neither column can squeeze the other.
- In two-column mode the column is the scroll container, so the inner
  `.combater-body` max-height is relaxed to `none` to avoid a double scrollbar.
  In single-column mode `.combater-body` keeps today's
  `max-height: min(520px, calc(100vh - 140px))`.
- Sticky browser controls: `nav.combater-tabs` and the `.combater-search` row use
  `position: sticky; top: 0` within the browse column so they stay visible while
  the action list scrolls. (In scope.)

### 4. Render / mode behavior

- Tab switching and search both stay full re-renders (`render({ force: true })`),
  unchanged. The existing `_searchFocusState` focus-restore continues to work.
- Browse-column scroll resetting to top on tab switch is expected behavior; no new
  scroll-preservation code is added.
- Readonly, player-plan, and GM-execute modes are unaffected — markup is relocated,
  not rewritten; the same conditionals and hooks apply.
- Edge cases handled by graceful column shrink: empty draft ("No selected
  actions"), no sustained spells, no unconditional actions.
- Existing users with a saved 420px window stay single-column until they widen the
  window past the 640px container breakpoint. This is the intended responsive
  behavior, not a regression; no migration is performed.

## Validation

- Gates: ESLint clean, and `node scripts/engine/self-test.js` green. This is a
  template/CSS-only change with no engine impact, so the self-test should be
  unaffected; it is still run as a gate.
- Visual verification via Playwright against a local HTTP server (file:// is
  blocked) capturing screenshots in three states:
  1. Expanded wide (≥640px) → two columns, browser no longer squeezed.
  2. Expanded narrow (<640px) → single-column stack, matching today.
  3. Compact → unchanged.
  Confirm draft placement per mode and that each column scrolls independently.
- Manual check in Foundry: expand the panel, drag wider past 640px to confirm the
  two-column switch, then narrower to confirm the collapse.
