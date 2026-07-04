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
- One summary line added above the step list: `"N actions planned, M points left"`, sourced from the same action-pool data already driving the existing header badges — no new calculation.

**Expanded (`expanded === true`)** is today's current full-chip rendering, unchanged.

**Sizing:** add a `.combater-panel.compact` CSS class shrinking `min-width`/`max-width`. Since `position.height` is already `"auto"`, only width needs an explicit `setPosition({ width })` call on toggle; height reflows naturally as content shrinks.

**Persistence:** unchanged — the existing world/client setting and `writePanelState` call already round-trip this flag; only the template/CSS branch is new.

## 2. Repeat / duplicate plan step

**Step shape today:** a draft step is a lightweight pointer object — `{ instanceId, actionKey, name, actionCost, requiresDestination, ...overrides }` where overrides (`targetTokenIds`, `mapOverride`, `movementAction`, `weaponId`, `areaMarker`, `sustainedSpell`) are attached by the various chip-tool handlers after the initial add. This applies uniformly to Strikes and every other action type — there is no Strike-specific step shape.

**Control:** a new duplicate icon in the per-chip tool cluster (`combater-step-tools`, `combater-panel.hbs:31-113`), next to the existing remove button. Expanded-mode only — compact rows (§1) don't get it; the compact row's job is glanceable status + Play, not editing.

**Behavior on click:**
1. Shallow-clone the target step object, replacing `instanceId` with a freshly generated id via the existing `draftStepId()` helper (`CombaterPanel.js:504`).
2. Insert the clone immediately after the original in `draft.steps`.
3. Write back through the existing generic primitives — `upsertDraftStep` (`state/draft-plans.js:223`) / `_writeActiveDraftPlan` — the same path `_moveDraftStep`/`_removeDraftStep` already use. No new persistence code.
4. Re-render, same as any other draft mutation.

**Explicitly not doing:**
- No new validation at duplicate-time. A plan that goes over the action budget from duplicating already surfaces via the existing action-pool warning UI, same as if the user had manually added the same action twice.
- No re-resolution logic. Stale/removed targets on the clone are already handled by the existing `findProjectedDraftAction` re-resolution that runs on every render for every step.
- No Strike-specific code path — genuinely generic, works for spells, movement steps, sustained spells, anything already representable as a draft step.

## Testing

- `self-test.js`: add a case that duplicates a draft step and asserts (a) a new step exists with a distinct `instanceId`, (b) all overrides (`targetTokenIds`, `weaponId`, etc.) matched the original, (c) it's positioned immediately after the original, (d) the original step is untouched.
- `self-test.js`: add a case toggling `expanded` false→true and back, asserting the persisted setting round-trips (mirrors existing `_setExpanded` coverage pattern if any exists — otherwise this is the first).
- No engine/planner test changes — neither feature touches `scoring.js` or `planner.js`.
