# Compact Panel Mode + Repeat Plan Step — Design

**Source:** Playtester feedback relayed 2026-07-04. Two asks: (1) a laptop-screen player wants a mini/compact mode for the main panel once their plan is picked, similar to Simple Calendar's compact mode; (2) a way to quickly repeat/duplicate a plan step (e.g. "just add another longsword Strike") instead of rebuilding it via the browser.

These are independent features sharing no code paths beyond both living in `CombaterPanel.js` / `combater-panel.hbs`. Scoped together here since both came from the same feedback session.

## 1. Compact panel mode

**Existing scaffolding (currently dead):** `CombaterPanel.js` already has an `expanded` instance flag and a `SETTINGS.compactDefault` world/client setting (`scripts/settings.js:24`, `lang/en.json:8-11`):
- Constructor (`CombaterPanel.js:1127-1129`) seeds `this.expanded` from `state.expanded` / `compactDefault`.
- `_viewContext` (`CombaterPanel.js:1291`) already passes `expanded: this.expanded` into the template.
- `_setExpanded(expanded)` (`CombaterPanel.js:1517`) persists via `writePanelState` and re-renders.

Nothing in `combater-panel.hbs` or `combater.css` currently branches on `expanded` — it's unused wiring, likely left from before the action browser was split into its own popup (`CombaterBrowser.js`). This design revives it rather than introducing new state.

**Trigger:** new toggle button in the header actions row (`combater-panel.hbs:185`, next to Browse/Refresh), calling `_setExpanded(!this.expanded)`.

**Compact (`expanded === false`) rendering:**
- Each `draftStepChip` renders a condensed row instead of the full chip: icon + name + Play (execute) button + remove button only.
- Hidden in compact: target/destination/area pickers, MAP cycle, movement cycle, weapon cycle, reorder controls, revert, duplicate (see §2), and the sustained-spells / uncounted-actions cards.
- No new summary line. The header (actor identity + action-pool badge, `combater-panel.hbs:185-262`) is always visible above the plan body regardless of `expanded`, and already shows the "N actions left" count — adding a second summary line above the step list would duplicate it. `self-test.js:504-508` already asserts a step-count summary must *not* render above the plan rows (a prior attempt at exactly this was reverted); this design does not reintroduce it.
- Implementation is CSS-only, not a template branch: a `.is-compact` class on `.combater-shell`, driven by `{{#unless expanded}}`, plus `display: none` rules scoped under it. This is lower-risk than branching `draftStepChip` in Handlebars (no `@root` context lookups, which nothing in this codebase currently uses) and matches the existing convention of expressing per-instance state via a CSS modifier class (`has-warning`, `is-current`, `is-pinned`, etc.).

**Expanded (`expanded === true`)** is today's current full-chip rendering, unchanged.

**Sizing:** `_setExpanded` calls `this.setPosition({ width: expanded ? 720 : 360 })` — 720 matches `DEFAULT_OPTIONS.position.width`, 360 matches the CSS `min-width` floor (`combater.css:18`). Confirmed safe: `_restorePosition`/`_savePosition` only ever read/write `left`/`top`, never `width`, so this can't be fought by the position-restore-on-render logic. Since `position.height` is already `"auto"`, height reflows on its own as content shrinks.

**Persistence:** unchanged — the existing world/client setting and `writePanelState` call already round-trip this flag; only the template/CSS branch is new.

## 2. Repeat / duplicate plan step

**Step shape today:** a draft step is a lightweight pointer object — `{ instanceId, actionKey, name, actionCost, requiresDestination, ...overrides }` where overrides (`targetTokenIds`, `mapOverride`, `movementAction`, `weaponId`, `areaMarker`, `sustainedSpell`) are attached by the various chip-tool handlers after the initial add. This applies uniformly to Strikes and every other action type — there is no Strike-specific step shape.

**Control:** a new duplicate icon in the per-chip tool cluster (`combater-step-tools`, `combater-panel.hbs:31-113`), next to the existing remove button. Gated behind `{{#unless groupId}}` — atoms of a grouped composite ability (e.g. both Strikes of a Double Attack, which share a `groupId` and must stay paired for MAP-tier tagging, see `injectMapInfo`, `CombaterPanel.js:805-853`) don't get it, since duplicating a single atom would corrupt the pairing. Every ordinary step, including any standalone Strike, is ungrouped and gets the control. Expanded-mode only in effect — the CSS in §1 already hides every non-Execute/Remove/waiting tool in compact mode, so no separate gating is needed here.

**Behavior on click:**

1. Read the active draft, locate the step by `instanceId` in whichever list (`steps` or `uncounted`) owns it via `draftListForInstance` (`state/draft-plans.js:265-268`).
2. Shallow-clone it, replacing `instanceId` with a freshly generated id via the existing `draftStepId()` helper (`CombaterPanel.js:504`).
3. Insert the clone immediately after the original in that same list.
4. Write back via `_writeActiveDraftPlan(markManualDraft(...))` — the exact pattern `_removeDraftStep`/`_moveDraftStep` already use. No new persistence primitive.
5. Re-render, same as any other draft mutation.

**Explicitly not doing:**
- No new validation at duplicate-time. A plan that goes over the action budget from duplicating already surfaces via the existing action-pool warning UI, same as if the user had manually added the same action twice.
- No re-resolution logic. Stale/removed targets on the clone are already handled by the existing `findProjectedDraftAction` re-resolution that runs on every render for every step.
- No Strike-specific code path — genuinely generic, works for spells, movement steps, sustained spells, anything already representable as an ungrouped draft step.

## Testing

`CombaterPanel` is an `ApplicationV2` subclass too tightly coupled to Foundry's DOM/canvas to instantiate under plain Node, so `self-test.js` already tests this class's behavior by asserting patterns against its own source text (e.g. `_removeDraftStep`/`_moveDraftStep` are covered at `self-test.js:656` via a regex over `panelSource`, not by calling them) rather than by executing it. This design follows that existing convention rather than introducing live instantiation:

- `self-test.js`: assert the template exposes `data-duplicate-draft-step` and that it's gated behind `{{#unless groupId}}`; assert `panelSource` shows `_duplicateDraftStep` generating a fresh id via `draftStepId()` and writing back via `_writeActiveDraftPlan(markManualDraft(...))`.
- `self-test.js`: assert the template exposes the `toggle-compact` button and the `is-compact` class driven by `expanded`; assert `_setExpanded` calls `setPosition({ width: ... })`; assert the new CSS selector hides secondary tools while excluding `.is-execute`/`.danger`/`.combater-step-waiting`.
- No engine/planner test changes — neither feature touches `scoring.js` or `planner.js`.
