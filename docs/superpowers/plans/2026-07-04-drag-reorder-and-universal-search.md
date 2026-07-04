# Drag-to-Reorder Plan Steps + Universal Action Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plan panel's up/down reorder buttons with native drag-and-drop (a drag handle per step), and make the action-browser search box search across every cost tab at once instead of only the active tab.

**Architecture:** Drag-to-reorder adds one new pure, unit-testable module (`scripts/engine/draft-reorder.js`) for the group-aware index math, wired into `CombaterPanel.js`/`combater-panel.hbs`/`combater.css`; it fully replaces the existing `_moveDraftStep` method and `data-move-draft-step` buttons rather than living alongside them. Universal search needs no new filtering logic — `decorateBuilderTab` already filters every tab's actions by the search query on every render (`CombaterPanel.js:981`), so search only needs a new merged-results view model in `decorateBuilder` and a template branch in `combater-browser.hbs` that renders it instead of just the active tab's sections.

**Tech Stack:** Vanilla JS (Foundry `ApplicationV2`/`HandlebarsApplicationMixin`), native HTML5 Drag and Drop API, Handlebars templates, hand-written CSS. No build step, no jest/prettier gates (see Global Constraints).

**Full context — read before starting either task:**
- `scripts\ui\CombaterPanel.js:615-719` — `decorateDraftStep`, the per-step view-model builder. `canEditStepOrder` (line 643) already gates reordering on `readonly`/`reorderLocked`; `canMoveStepUp`/`canMoveStepDown` (710-711) are the fields Task 1 replaces with a single `canDragStep`.
- `scripts\ui\CombaterPanel.js:883-927` — `groupDraftSteps`, collapses consecutive same-`groupId` steps (e.g. both Strikes of a Double Attack) into one `{isGroup: true, children}` entry for display. It already forces `canMoveStepUp`/`canMoveStepDown` to `false` on children so a group's atoms never get their own reorder controls — Task 1 does the same with `canDragStep`.
- `scripts\ui\CombaterPanel.js:929-1027` — `decorateBuilder`. `reorderLocked` (line 937) blocks reordering while any step in a list is non-`"pending"`. `tabsList` (980-983) already decorates every tab, not just the active one — Task 2 reuses this.
- `scripts\ui\CombaterPanel.js:730-758` — `decorateBuilderTab`; `filterBuilderTabActions` (721) already applies the shared `searchQuery` to every tab's actions.
- `scripts\ui\CombaterPanel.js:1831-1864` — `_moveDraftStep`, the method Task 1 deletes and replaces with `_reorderDraftStep`. Read this first: the block-aware splice logic here (finding a dragged step's full `groupId` block so a group moves as one unit) is exactly what the new pure `reorderDraftSteps` function generalizes.
- `templates\combater-panel.hbs` — single template, three places render a step row with reorder controls: the `draftStepChip` inline partial (lines 3-123, used for both single steps and group children), the group header block (lines 128-157), and the uncounted-actions row (lines 314-385). All three currently repeat the same up/down button pair; Task 1 touches all three.
- `templates\combater-browser.hbs` — the detached action-browser window. Tab buttons (5-10), search input (12-14), and the `{{#each builder.tabsList}}{{#if active}}{{#each sections}}` render loop (20-72) that currently discards every non-active tab's (already-filtered) results.
- `scripts\ui\action-categories.js` — precedent for a small, Foundry-free pure module (`groupActionsByBuilderCategory`) that both `CombaterPanel.js` and `self-test.js` import directly and unit-test with `assert.deepEqual`. `scripts/engine/draft-reorder.js` follows the same pattern.
- `scripts\ui\CombaterPanel.js:63` — `const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;` — this throws under plain Node, which is why `self-test.js` never imports `CombaterPanel.js`/`CombaterBrowser.js` directly. It reads them as source text (`readFileSync`) and asserts patterns against that text instead (see `scripts\engine\self-test.js:109-119` for the `panelSource`/`panelTemplateSource`/`browserSource`/`browserTemplateSource`/`panelStyleSource` constants). Both tasks follow this existing convention for anything that touches those two files/templates/CSS, and use real `assert.deepEqual` only for the new pure `draft-reorder.js` module.

## Global Constraints

- Test gate is `npm test` (runs `node scripts/engine/self-test.js`, prints `PF2e Combater self-test passed` on success). NOT jest — `npm test` happens to alias to the same command already.
- Lint gate is `npm run lint` (`eslint .`). Do not run `npm run format`/prettier — the repo is not prettier-clean and running it creates unrelated reformatting noise.
- Match surrounding code style exactly: 2-space indent, double quotes, semicolons, no new abstractions beyond what's specified below.
- All user-facing strings that appear only in a template go through `lang/en.json` under `PF2E_COMBATER.Panel.*`/`PF2E_COMBATER.Browser.*` (the template's `{{localize "KEY"}}` helper requires the literal key to exist in `lang/en.json` — there is no JS-side fallback for template-only strings). Neither task needs a new JS-side `t()` call, so neither needs the lang-sync script — only direct `lang/en.json` edits.
- When deleting a UI control, delete its whole vertical slice (method, template markup, CSS, self-test assertions, and any now-orphaned `lang/en.json` keys) rather than leaving it dead.

---

## Task 1: Drag-to-reorder plan steps

**Files:**
- Create: `scripts\engine\draft-reorder.js`
- Modify: `scripts\ui\CombaterPanel.js` (imports; `decorateDraftStep` lines 615/710-711; `groupDraftSteps` lines 905-923; `decorateBuilder` call sites lines ~941-948/~960-968; `_onRender` wiring lines 1399-1404; `_moveDraftStep` → `_reorderDraftStep` lines 1831-1864)
- Modify: `templates\combater-panel.hbs` (lines 4, 79-88, 125, 128, 145-156, 316-320, 322, 360-365)
- Modify: `styles\combater.css` (lines 361-368)
- Modify: `lang\en.json` (lines 41-44)
- Test: `scripts\engine\self-test.js` (imports; lines 375, 391)

**Interfaces:**
- Consumes (pre-existing, unchanged): `draftListForInstance(draft, instanceId)` (`scripts\state\draft-plans.js`, returns `"steps"` or `"uncounted"`), `markManualDraft(draft)`, `this._canEditDraft()`, `this._readActiveDraftPlan()`, `this._writeActiveDraftPlan(draft)`, `clearActionPreview()`, `executionStatus(step)`, `t(key, fallback, data?)` — all already used by `_moveDraftStep`.
- Produces: `reorderDraftSteps(steps, instanceId, targetInstanceId, placeBefore = true)` — pure function, exported from `scripts/engine/draft-reorder.js`, returns a new array (or the same array reference, unchanged, if the drop is a no-op). Not consumed by Task 2 — fully independent, do either task first.

- [ ] **Step 1: Write the failing test assertions**

In `scripts\engine\self-test.js`, add the import. Line 5 currently reads:

```javascript
import { actionBudget, bestTurnPlan, buildTurnPlans } from "./planner.js";
```

Change to:

```javascript
import { actionBudget, bestTurnPlan, buildTurnPlans } from "./planner.js";
import { reorderDraftSteps } from "./draft-reorder.js";
```

Line 375 currently reads (inside the `eventHook` array):

```javascript
  "data-move-draft-step",
```

Change to:

```javascript
  "data-drag-draft-step",
```

Line 391 currently reads:

```javascript
assert.ok(panelSource.includes("_moveDraftStep"), "panel should support explicit draft-step reordering");
```

Replace it with:

```javascript
assert.deepEqual(
  reorderDraftSteps(
    [{ instanceId: "a" }, { instanceId: "b" }, { instanceId: "c" }, { instanceId: "d" }],
    "a", "c", true,
  ).map((step) => step.instanceId),
  ["b", "a", "c", "d"],
  "dragging a step and dropping it before a later step should reorder the list",
);
assert.deepEqual(
  reorderDraftSteps(
    [{ instanceId: "a" }, { instanceId: "b" }, { instanceId: "c" }, { instanceId: "d" }],
    "a", "c", false,
  ).map((step) => step.instanceId),
  ["b", "c", "a", "d"],
  "dropping after the target should place the dragged step past it",
);
assert.deepEqual(
  reorderDraftSteps(
    [
      { instanceId: "t" },
      { instanceId: "g1a", groupId: "g1" },
      { instanceId: "g1b", groupId: "g1" },
      { instanceId: "u" },
    ],
    "t", "g1b", false,
  ).map((step) => step.instanceId),
  ["g1a", "g1b", "t", "u"],
  "dropping after any atom of a group should place the dragged step past the whole group",
);
assert.deepEqual(
  reorderDraftSteps(
    [
      { instanceId: "t" },
      { instanceId: "g1a", groupId: "g1" },
      { instanceId: "g1b", groupId: "g1" },
      { instanceId: "u" },
    ],
    "g1a", "t", true,
  ).map((step) => step.instanceId),
  ["g1a", "g1b", "t", "u"],
  "dragging one atom of a group should move the whole group as one block",
);
const reorderNoOpList = [{ instanceId: "a" }, { instanceId: "b" }];
assert.equal(
  reorderDraftSteps(reorderNoOpList, "a", "a", true),
  reorderNoOpList,
  "dropping a step onto itself should be a no-op",
);
assert.ok(panelSource.includes("_reorderDraftStep"), "panel should support drag-to-reorder");
assert.ok(panelSource.includes("import { reorderDraftSteps }"), "panel should reuse the pure reorder helper for drag-and-drop");
assert.ok(
  /_reorderDraftStep\(instanceId, targetInstanceId[\s\S]*?draftListForInstance\(draft, instanceId\)[\s\S]*?draftListForInstance\(draft, targetInstanceId\)/.test(panelSource),
  "drag-and-drop reorder should stay confined to the same list (steps vs uncounted), matching the old up/down buttons",
);
assert.equal(panelSource.includes("_moveDraftStep"), false, "the up/down reorder method should be fully replaced by drag-and-drop, not left dead");
assert.equal(panelTemplateSource.includes("data-move-draft-step"), false, "up/down reorder buttons should be replaced by the drag handle");
assert.equal(panelStyleSource.includes("combater-step-move"), false, "the dead up/down button styling should be removed along with the buttons");
assert.ok(panelTemplateSource.includes("data-drag-draft-step"), "each draggable step should expose a drag handle");
assert.ok(panelTemplateSource.includes("data-drag-row"), "each step/group row should be a valid drop target");
assert.ok(panelTemplateSource.includes("data-drag-list"), "each reorderable list should mark its drag/drop container");
assert.ok(panelSource.includes("canDragStep"), "decorated steps should expose whether they can be dragged");
assert.ok(panelStyleSource.includes(".combater-step-drag"), "the drag handle should have its own styling");
assert.ok(panelStyleSource.includes(".is-dragging"), "dragged rows should get a visual dragging state");
assert.ok(panelStyleSource.includes(".drop-target-before") && panelStyleSource.includes(".drop-target-after"), "drop targets should show an insertion indicator");
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero. `draft-reorder.js` does not exist yet, so this fails immediately on the new import with a "Cannot find module" error (Node `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Create the pure reorder module**

Create `scripts\engine\draft-reorder.js`:

```javascript
// Pure array reorder for drag-and-drop: moves the step at `instanceId` to sit before/after
// `targetInstanceId`. Grouped composite steps (shared `groupId`, e.g. both Strikes of a Double
// Attack) are always contiguous -- both the dragged step and the drop target are expanded to their
// full group block first, so a drag can't split a group apart or land inside one.
export function reorderDraftSteps(steps, instanceId, targetInstanceId, placeBefore = true) {
  const list = Array.isArray(steps) ? steps : [];
  const index = list.findIndex((step) => step.instanceId === instanceId);
  const targetIndex = list.findIndex((step) => step.instanceId === targetInstanceId);
  if (index < 0 || targetIndex < 0 || instanceId === targetInstanceId) return list;

  const groupId = list[index]?.groupId;
  const blockStart = groupId ? list.findIndex((step) => step.groupId === groupId) : index;
  let blockEnd = blockStart + 1;
  if (groupId) {
    while (blockEnd < list.length && list[blockEnd]?.groupId === groupId) blockEnd += 1;
  }
  // Dropping onto a member of the block being dragged is a no-op.
  if (targetIndex >= blockStart && targetIndex < blockEnd) return list;

  const targetGroupId = list[targetIndex]?.groupId;
  const targetStart = targetGroupId ? list.findIndex((step) => step.groupId === targetGroupId) : targetIndex;
  let targetEnd = targetStart + 1;
  if (targetGroupId) {
    while (targetEnd < list.length && list[targetEnd]?.groupId === targetGroupId) targetEnd += 1;
  }

  const block = list.slice(blockStart, blockEnd);
  const withoutBlock = [...list.slice(0, blockStart), ...list.slice(blockEnd)];
  // The target boundary shifts left in `withoutBlock` if the dragged block sat before it.
  const shift = blockStart < targetStart ? block.length : 0;
  const insertAt = (placeBefore ? targetStart : targetEnd) - shift;
  return [...withoutBlock.slice(0, insertAt), ...block, ...withoutBlock.slice(insertAt)];
}
```

- [ ] **Step 4: Run the suite and confirm it fails further along**

Run: `npm test`
Expected: exits non-zero, but now past the `reorderDraftSteps` deepEqual checks — the first failure should be `"panel should support drag-to-reorder"` (or another assertion from the block above, since `CombaterPanel.js`/the templates/the CSS haven't changed yet).

- [ ] **Step 5: Update the localization keys**

In `lang\en.json`, lines 41-44 currently read:

```json
      "MoveUp": "Move up",
      "MoveUpAria": "Move {name} up",
      "MoveDown": "Move down",
      "MoveDownAria": "Move {name} down",
```

Change to:

```json
      "DragToReorder": "Drag to reorder",
      "DragToReorderAria": "Drag {name} to reorder",
```

(`MoveUp`/`MoveUpAria`/`MoveDown`/`MoveDownAria` are only referenced by the up/down buttons this task removes in Step 8 — deleting them here avoids leaving orphaned strings.)

- [ ] **Step 6: Update the draft-step view model**

In `scripts\ui\CombaterPanel.js`, the `decorateDraftStep` signature (line 615) currently reads:

```javascript
function decorateDraftStep(step, index, { readonly = false, gmExecute = false, total = 0, reorderLocked = false, awaitingGm = null, movementOptions = [], weaponOptions = [] } = {}) {
```

Change to:

```javascript
function decorateDraftStep(step, index, { readonly = false, gmExecute = false, reorderLocked = false, awaitingGm = null, movementOptions = [], weaponOptions = [] } = {}) {
```

Further down in the same function (lines 710-711), currently:

```javascript
    canMoveStepUp: canEditStepOrder && index > 0,
    canMoveStepDown: canEditStepOrder && index < total - 1,
```

Change to:

```javascript
    canDragStep: canEditStepOrder,
```

In `groupDraftSteps` (lines 905-923), currently:

```javascript
    grouped.push({
      isGroup: true,
      groupLabel: members[0].groupLabel,
      instanceId: members[0].instanceId,
      actionGlyphIcon: members[0].actionGlyphIcon,
      costLabel: members[0].costLabel,
      canMoveStepUp: members[0].canMoveStepUp,
      canMoveStepDown: members[members.length - 1].canMoveStepDown,
      groupItem: members[0].groupItem ?? null,
      groupUuid: members[0].groupUuid ?? null,
      traitChips: groupTraitChips,
      hasTraitChips: groupTraitChips.length > 0,
      children: members.map((member) => ({
        ...member,
        name: member.name?.startsWith(prefix) ? member.name.slice(prefix.length) : member.name,
        canMoveStepUp: false,
        canMoveStepDown: false,
      })),
    });
```

Change to:

```javascript
    grouped.push({
      isGroup: true,
      groupLabel: members[0].groupLabel,
      instanceId: members[0].instanceId,
      actionGlyphIcon: members[0].actionGlyphIcon,
      costLabel: members[0].costLabel,
      canDragStep: members[0].canDragStep,
      groupItem: members[0].groupItem ?? null,
      groupUuid: members[0].groupUuid ?? null,
      traitChips: groupTraitChips,
      hasTraitChips: groupTraitChips.length > 0,
      children: members.map((member) => ({
        ...member,
        name: member.name?.startsWith(prefix) ? member.name.slice(prefix.length) : member.name,
        canDragStep: false,
      })),
    });
```

Finally, in `decorateBuilder`, remove the now-unused `total` argument from both call sites. The draft-steps call currently reads:

```javascript
  const rawDraftSteps = planMap.steps
    .map((step, index) => decorateDraftStep(step, index, {
      readonly: draftReadonly,
      gmExecute: gmCanRunPlayerPlan,
      total: rawSteps.length,
      reorderLocked,
      awaitingGm,
      movementOptions,
      weaponOptions,
    }));
```

Change to:

```javascript
  const rawDraftSteps = planMap.steps
    .map((step, index) => decorateDraftStep(step, index, {
      readonly: draftReadonly,
      gmExecute: gmCanRunPlayerPlan,
      reorderLocked,
      awaitingGm,
      movementOptions,
      weaponOptions,
    }));
```

The uncounted-steps call currently reads:

```javascript
  const rawUncountedSteps = uncountedMap.steps.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    total: rawUncounted.length,
    reorderLocked: uncountedReorderLocked,
    awaitingGm,
    movementOptions,
    weaponOptions,
  }));
```

Change to:

```javascript
  const rawUncountedSteps = uncountedMap.steps.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    reorderLocked: uncountedReorderLocked,
    awaitingGm,
    movementOptions,
    weaponOptions,
  }));
```

- [ ] **Step 7: Replace the move-button wiring and method with drag-and-drop**

In `scripts\ui\CombaterPanel.js`, add the import. The `planner.js` import currently reads:

```javascript
import { attacksTowardMap, bestTurnPlan, buildTurnPlans, isAttackAction, mapPenalty } from "../engine/planner.js";
```

Change to:

```javascript
import { attacksTowardMap, bestTurnPlan, buildTurnPlans, isAttackAction, mapPenalty } from "../engine/planner.js";
import { reorderDraftSteps } from "../engine/draft-reorder.js";
```

In `_onRender`, the move-button wiring (lines 1399-1404) currently reads:

```javascript
    for (const button of element.querySelectorAll("[data-move-draft-step]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._moveDraftStep(button.dataset.moveDraftStep, button.dataset.moveDirection);
      });
    }
```

Change to:

```javascript
    for (const container of element.querySelectorAll("[data-drag-list]")) {
      let draggingId = null;
      for (const handle of container.querySelectorAll("[data-drag-draft-step]")) {
        handle.addEventListener("dragstart", (event) => {
          draggingId = handle.dataset.dragDraftStep;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggingId);
          handle.closest("[data-drag-row]")?.classList.add("is-dragging");
        });
        handle.addEventListener("dragend", () => {
          draggingId = null;
          for (const row of container.querySelectorAll(".is-dragging, .drop-target-before, .drop-target-after")) {
            row.classList.remove("is-dragging", "drop-target-before", "drop-target-after");
          }
        });
      }
      for (const row of container.querySelectorAll("[data-drag-row]")) {
        row.addEventListener("dragover", (event) => {
          if (!draggingId) return;
          event.preventDefault();
          const rect = row.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          row.classList.toggle("drop-target-before", before);
          row.classList.toggle("drop-target-after", !before);
        });
        row.addEventListener("dragleave", () => {
          row.classList.remove("drop-target-before", "drop-target-after");
        });
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          const before = row.classList.contains("drop-target-before");
          row.classList.remove("drop-target-before", "drop-target-after");
          if (draggingId) this._reorderDraftStep(draggingId, row.dataset.dragRow, before);
        });
      }
    }
```

(Each `[data-drag-list]` container gets its own `draggingId` closure variable, so a drag that starts in the counted-steps list can't be dropped into the uncounted list or vice versa — the same "within a list only" behavior the old up/down buttons had, enforced again below at the persistence layer.)

Then replace `_moveDraftStep` itself. It currently reads (lines 1831-1864):

```javascript
  async _moveDraftStep(instanceId, direction) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    if ((draft[listKey] ?? []).some((step) => executionStatus(step) !== "pending")) {
      globalThis.ui?.notifications?.warn?.(t("Notify.RevertBeforeReorder", "Revert executed steps before reordering."));
      return;
    }
    const steps = Array.isArray(draft[listKey]) ? [...draft[listKey]] : [];
    const index = steps.findIndex((step) => step.instanceId === instanceId);
    const offset = Math.sign(Number(direction) || 0);
    if (index < 0 || offset === 0) return;
    // A distinct-target ability's atoms share a groupId and are always contiguous (built together
    // in one atomization pass) -- move the whole run as one block so the group's header move
    // control can't split its own children apart in the plan order.
    const groupId = steps[index]?.groupId;
    const blockStart = groupId ? steps.findIndex((step) => step.groupId === groupId) : index;
    let blockEnd = blockStart + 1;
    if (groupId) {
      while (blockEnd < steps.length && steps[blockEnd]?.groupId === groupId) blockEnd += 1;
    }
    const block = steps.slice(blockStart, blockEnd);
    if (offset < 0) {
      if (blockStart === 0) return;
      steps.splice(blockStart - 1, block.length + 1, ...block, steps[blockStart - 1]);
    } else {
      if (blockEnd >= steps.length) return;
      steps.splice(blockStart, block.length + 1, steps[blockEnd], ...block);
    }
    await this._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: steps }));
    clearActionPreview();
    await this.render({ force: true });
  }
```

Replace it with:

```javascript
  async _reorderDraftStep(instanceId, targetInstanceId, placeBefore = true) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId || !targetInstanceId || instanceId === targetInstanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    if (listKey !== draftListForInstance(draft, targetInstanceId)) return;
    if ((draft[listKey] ?? []).some((step) => executionStatus(step) !== "pending")) {
      globalThis.ui?.notifications?.warn?.(t("Notify.RevertBeforeReorder", "Revert executed steps before reordering."));
      return;
    }
    const steps = Array.isArray(draft[listKey]) ? draft[listKey] : [];
    const reordered = reorderDraftSteps(steps, instanceId, targetInstanceId, placeBefore);
    if (reordered === steps) return;
    await this._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: reordered }));
    clearActionPreview();
    await this.render({ force: true });
  }
```

- [ ] **Step 8: Update the plan-panel template**

In `templates\combater-panel.hbs`, make these eight changes.

1. Line 4, add a drop-target attribute to the shared step row (used by both single steps and group children). Currently:

```html
          <span class="combater-header-step {{#if warning}}has-warning{{/if}} status-{{executionStatus}} {{#if isCurrentExecution}}is-current{{/if}}" data-preview-draft-step="{{instanceId}}">
```

Change to:

```html
          <span class="combater-header-step {{#if warning}}has-warning{{/if}} status-{{executionStatus}} {{#if isCurrentExecution}}is-current{{/if}}" data-preview-draft-step="{{instanceId}}" data-drag-row="{{instanceId}}">
```

2. Lines 79-88, replace the single-step up/down buttons with a drag handle. Currently:

```html
              {{#if canMoveStepUp}}
                <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="-1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveUp"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveUpAria" name=name}}">
                  <i class="fa-solid fa-arrow-up"></i>
                </button>
              {{/if}}
              {{#if canMoveStepDown}}
                <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveDown"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveDownAria" name=name}}">
                  <i class="fa-solid fa-arrow-down"></i>
                </button>
              {{/if}}
```

Change to:

```html
              {{#if canDragStep}}
                <span class="combater-chip-tool combater-step-drag" data-drag-draft-step="{{instanceId}}" draggable="true" data-tooltip="{{localize "PF2E_COMBATER.Panel.DragToReorder"}}" aria-label="{{localize "PF2E_COMBATER.Panel.DragToReorderAria" name=name}}">
                  <i class="fa-solid fa-grip-vertical"></i>
                </span>
              {{/if}}
```

3. Line 125, mark the counted-steps container as a drag/drop list. Currently:

```html
    <div class="combater-sequence" aria-label="{{localize "PF2E_COMBATER.Panel.PlannedSequenceAria"}}">
```

Change to:

```html
    <div class="combater-sequence" data-drag-list aria-label="{{localize "PF2E_COMBATER.Panel.PlannedSequenceAria"}}">
```

4. Line 128, add a drop-target attribute to the group wrapper (so dropping anywhere on a group snaps to the whole block). Currently:

```html
          <div class="combater-step-group">
```

Change to:

```html
          <div class="combater-step-group" data-drag-row="{{instanceId}}">
```

5. Lines 145-156, replace the group-header up/down buttons with a drag handle. Currently:

```html
              <span class="combater-step-tools">
                {{#if canMoveStepUp}}
                  <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="-1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveUp"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveUpAria" name=groupLabel}}">
                    <i class="fa-solid fa-arrow-up"></i>
                  </button>
                {{/if}}
                {{#if canMoveStepDown}}
                  <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveDown"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveDownAria" name=groupLabel}}">
                    <i class="fa-solid fa-arrow-down"></i>
                  </button>
                {{/if}}
              </span>
```

Change to:

```html
              <span class="combater-step-tools">
                {{#if canDragStep}}
                  <span class="combater-chip-tool combater-step-drag" data-drag-draft-step="{{instanceId}}" draggable="true" data-tooltip="{{localize "PF2E_COMBATER.Panel.DragToReorder"}}" aria-label="{{localize "PF2E_COMBATER.Panel.DragToReorderAria" name=groupLabel}}">
                    <i class="fa-solid fa-grip-vertical"></i>
                  </span>
                {{/if}}
              </span>
```

6. Lines 316-320, mark the uncounted-actions container as a drag/drop list. Currently:

```html
          <article class="combater-alt combater-builder-card combater-uncounted">
            <div class="combater-alt-head">
              <span class="combater-alt-title"><strong>{{localize "PF2E_COMBATER.Panel.UncountedActions"}}</strong></span>
            </div>
            <div class="combater-alt-details">
```

Change to:

```html
          <article class="combater-alt combater-builder-card combater-uncounted">
            <div class="combater-alt-head">
              <span class="combater-alt-title"><strong>{{localize "PF2E_COMBATER.Panel.UncountedActions"}}</strong></span>
            </div>
            <div class="combater-alt-details" data-drag-list>
```

7. Line 322, add a drop-target attribute to each uncounted row. Currently:

```html
                <div class="combater-alt-step combater-uncounted-row status-{{executionStatus}} {{#if isCurrentExecution}}is-current{{/if}}" data-preview-draft-step="{{instanceId}}">
```

Change to:

```html
                <div class="combater-alt-step combater-uncounted-row status-{{executionStatus}} {{#if isCurrentExecution}}is-current{{/if}}" data-preview-draft-step="{{instanceId}}" data-drag-row="{{instanceId}}">
```

8. Lines 360-365, replace the uncounted-row up/down buttons with a drag handle. Currently:

```html
                    {{#if canMoveStepUp}}
                      <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="-1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveUp"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveUpAria" name=name}}"><i class="fa-solid fa-arrow-up"></i></button>
                    {{/if}}
                    {{#if canMoveStepDown}}
                      <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="1" data-tooltip="{{localize "PF2E_COMBATER.Panel.MoveDown"}}" aria-label="{{localize "PF2E_COMBATER.Panel.MoveDownAria" name=name}}"><i class="fa-solid fa-arrow-down"></i></button>
                    {{/if}}
```

Change to:

```html
                    {{#if canDragStep}}
                      <span class="combater-chip-tool combater-step-drag" data-drag-draft-step="{{instanceId}}" draggable="true" data-tooltip="{{localize "PF2E_COMBATER.Panel.DragToReorder"}}" aria-label="{{localize "PF2E_COMBATER.Panel.DragToReorderAria" name=name}}"><i class="fa-solid fa-grip-vertical"></i></span>
                    {{/if}}
```

- [ ] **Step 9: Update the CSS**

In `styles\combater.css`, lines 361-368 currently read:

```css
.pf2e-combater .combater-chip-tool.combater-step-move {
  color: var(--combater-muted);
}

.pf2e-combater .combater-chip-tool.combater-step-move:hover,
.pf2e-combater .combater-chip-tool.combater-step-move:focus-visible {
  color: var(--combater-text);
}
```

Change to:

```css
.pf2e-combater .combater-chip-tool.combater-step-drag {
  cursor: grab;
  color: var(--combater-muted);
}

.pf2e-combater .combater-chip-tool.combater-step-drag:hover,
.pf2e-combater .combater-chip-tool.combater-step-drag:focus-visible {
  color: var(--combater-text);
}

.pf2e-combater .combater-header-step.is-dragging,
.pf2e-combater .combater-step-group.is-dragging {
  opacity: 0.4;
}

.pf2e-combater .combater-header-step.drop-target-before,
.pf2e-combater .combater-step-group.drop-target-before,
.pf2e-combater .combater-uncounted-row.drop-target-before {
  box-shadow: inset 0 3px 0 var(--combater-focus);
}

.pf2e-combater .combater-header-step.drop-target-after,
.pf2e-combater .combater-step-group.drop-target-after,
.pf2e-combater .combater-uncounted-row.drop-target-after {
  box-shadow: inset 0 -3px 0 var(--combater-focus);
}
```

(Compact mode already hides every step-tool icon except `.is-execute`/`.danger`/`.combater-step-waiting` via `styles\combater.css:379`'s `:not()` chain — `.combater-step-drag` needs no extra rule to stay hidden in compact mode, it's covered by that existing selector automatically.)

- [ ] **Step 10: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: no errors on the touched files.

- [ ] **Step 12: Commit**

```bash
git add scripts/engine/draft-reorder.js scripts/ui/CombaterPanel.js templates/combater-panel.hbs styles/combater.css lang/en.json scripts/engine/self-test.js
git commit -m "feat: replace plan-step up/down buttons with drag-and-drop reordering"
```

---

## Task 2: Universal action search across tabs

**Files:**
- Modify: `scripts\ui\CombaterPanel.js` (`decorateBuilder`, lines ~977-986)
- Modify: `templates\combater-browser.hbs` (full file restructure of lines 1-72)
- Modify: `styles\combater.css` (new rules near lines 951 and 1053)
- Test: `scripts\engine\self-test.js` (new assertions after line 466)

**Interfaces:**
- Consumes (pre-existing, unchanged): `ACTION_BUILDER_TABS`, `decorateBuilderTab(tab, activeTab, {readonly, searchQuery})` (already filters via `filterBuilderTabActions`), `t(key, fallback, data?)`.
- Produces: `builder.mergedSearchResults` — an array of `{...section, tabLabel}` objects (every non-empty section from every tab, tagged with which tab it came from), added to the object `decorateBuilder` returns. Not consumed by Task 1 — fully independent, do either task first.

- [ ] **Step 1: Write the failing test assertions**

In `scripts\engine\self-test.js`, insert this block immediately after line 466 (the `browser action rows should not repeat the per-row cost glyph` assertion), before the `async close` assertion at line 467:

```javascript
assert.ok(panelSource.includes("mergedSearchResults"), "decorateBuilder should expose merged cross-tab search results");
assert.ok(
  /mergedSearchResults = decoratedTabsList\.flatMap/.test(panelSource),
  "merged search results should be derived from the already-decorated per-tab list, not a separate filter pass",
);
assert.ok(
  /mergedSearchResults[\s\S]*?filter\(\(section\) => section\.hasActions\)/.test(panelSource),
  "merged search results should only include sections that actually matched",
);
assert.ok(browserTemplateSource.includes("builder.mergedSearchResults"), "browser template should render merged cross-tab results while searching");
assert.ok(
  /\{\{#if builder\.searchQuery\}\}[\s\S]*?builder\.mergedSearchResults[\s\S]*?\{\{else\}\}[\s\S]*?builder\.tabsList/.test(browserTemplateSource),
  "browser should fall back to the per-tab view when the search box is empty",
);
assert.ok(browserTemplateSource.includes("combater-section-tag"), "each merged result should show which tab it came from");
assert.ok(
  /data-tab="\{\{id\}\}" class="\{\{#if active\}\}active\{\{\/if\}\}" \{\{#if searchQuery\}\}disabled\{\{\/if\}\}/.test(browserTemplateSource),
  "tabs should be inert while a cross-tab search is active",
);
assert.ok(panelStyleSource.includes(".combater-tabs button:disabled"), "inert tabs should read as visually disabled");
assert.ok(panelStyleSource.includes(".combater-section-tag"), "the per-result tab tag should have its own styling");
assert.ok(browserTemplateSource.includes('{{#*inline "actionRows"}}'), "action row markup should be a shared partial, not duplicated between the merged and per-tab views");
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero; the first failing assertion is `"decorateBuilder should expose merged cross-tab search results"` (or one of the others in the block above).

- [ ] **Step 3: Add the merged-results view model**

In `scripts\ui\CombaterPanel.js`, `decorateBuilder`'s return statement currently reads:

```javascript
  return {
    ...builder,
    readonly: draftReadonly,
    tabsList: ACTION_BUILDER_TABS.map((tab) => ({
      ...decorateBuilderTab(builder.tabs[tab.id], active, { readonly: draftReadonly, searchQuery }),
      label: t(`Tab.${tab.id}`, tab.label),
    })),
    activeTab: active,
    activeTabLabel: t(`Tab.${active}`, ACTION_BUILDER_TABS.find((tab) => tab.id === active)?.label ?? "1 Action"),
    searchQuery: String(searchQuery ?? ""),
```

Change to:

```javascript
  const decoratedTabsList = ACTION_BUILDER_TABS.map((tab) => ({
    ...decorateBuilderTab(builder.tabs[tab.id], active, { readonly: draftReadonly, searchQuery }),
    label: t(`Tab.${tab.id}`, tab.label),
  }));
  // Every tab's actions are already filtered by `searchQuery` above (decorateBuilderTab runs for
  // every tab, not just the active one) -- while searching, surface every tab's matches instead of
  // just the active tab's, tagged with which tab each match came from.
  const mergedSearchResults = decoratedTabsList.flatMap((tab) => tab.sections
    .filter((section) => section.hasActions)
    .map((section) => ({ ...section, tabLabel: tab.label })));
  return {
    ...builder,
    readonly: draftReadonly,
    tabsList: decoratedTabsList,
    mergedSearchResults,
    activeTab: active,
    activeTabLabel: t(`Tab.${active}`, ACTION_BUILDER_TABS.find((tab) => tab.id === active)?.label ?? "1 Action"),
    searchQuery: String(searchQuery ?? ""),
```

- [ ] **Step 4: Update the browser template**

In `templates\combater-browser.hbs`, replace lines 1-72 (everything from the opening `<div class="combater-browser-shell">` through the closing `{{/each}}` of `{{#each builder.tabsList}}`) with:

```html
<div class="combater-browser-shell">
  {{#if builder}}
    {{#*inline "actionRows"}}
      {{#each actions}}
        <div class="combater-alt-step combater-action-row {{#if favorite}}is-favorite{{/if}} {{#if disabled}}is-disabled{{/if}}">
          {{#unless readonly}}
          <button type="button" class="combater-run combater-favorite {{#if favorite}}is-active{{/if}}" data-favorite-action="{{key}}" data-tooltip="{{favoriteTitle}}" aria-label="{{favoriteTitle}}">
            <i class="{{#if favorite}}fa-solid fa-star{{else}}fa-regular fa-star{{/if}}"></i>
          </button>
          {{/unless}}
          <div class="combater-alt-step-body">
            <h4>
              <button type="button" class="combater-alt-promote" data-open-action="{{key}}" data-tooltip="{{localize "PF2E_COMBATER.Browser.OpenDetails"}}">
                {{#if img}}<img class="combater-action-img" src="{{img}}" alt="">{{/if}}
                <span>{{name}}</span>
              </button>
            </h4>
            {{#if targetLabel}}<span class="combater-target" data-tooltip="{{targetLabel}}">{{targetLabel}}</span>{{/if}}
            {{#if disabledReason}}<span class="combater-target is-warning" data-tooltip="{{disabledReason}}">{{disabledReason}}</span>{{/if}}
            {{#if hasDetailChips}}
              <div class="combater-detail-chips" aria-label="{{localize "PF2E_COMBATER.Browser.ActionDetailsAria"}}">
                {{#each detailChips}}
                  <span class="combater-detail-chip {{class}}" data-tooltip="{{tooltip}}">{{label}}</span>
                {{/each}}
              </div>
            {{/if}}
            <p>{{reason}}</p>
          </div>
          {{#unless readonly}}
          <button type="button" class="combater-run combater-add-action" data-add-action="{{key}}" data-tooltip="{{#if overBudget}}{{disabledReason}}{{else}}{{disabledTitle}}{{/if}}" aria-label="{{localize "PF2E_COMBATER.Browser.AddToPlanAria" name=name}}" {{#if overBudget}}disabled{{/if}}>
            <i class="fa-solid fa-plus"></i>
          </button>
          <button type="button" class="combater-run combater-add-uncounted" data-add-uncounted="{{key}}" data-tooltip="{{localize "PF2E_COMBATER.Browser.AddUncounted"}}" aria-label="{{localize "PF2E_COMBATER.Browser.AddUncountedAria" name=name}}">
            <i class="fa-solid fa-bolt"></i>
          </button>
          {{/unless}}
        </div>
      {{else}}
        <p class="combater-empty">{{localize "PF2E_COMBATER.Browser.NoActions"}}</p>
      {{/each}}
    {{/inline}}
    <div class="combater-browser-header">
      <nav class="combater-tabs" aria-label="{{localize "PF2E_COMBATER.Browser.TabsAria"}}">
        {{#each builder.tabsList}}
          <button type="button" data-tab="{{id}}" class="{{#if active}}active{{/if}}" {{#if searchQuery}}disabled{{/if}}>
            <img class="combater-tab-glyph" src="{{glyphIcon}}" alt="">
            <span>{{label}}</span>
          </button>
        {{/each}}
      </nav>
      <div class="combater-search">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" data-search-actions value="{{builder.searchQuery}}" placeholder="{{localize "PF2E_COMBATER.Browser.SearchPlaceholder" label=builder.activeTabLabel}}" aria-label="{{localize "PF2E_COMBATER.Browser.SearchAria" label=builder.activeTabLabel}}" autocomplete="off">
      </div>
    </div>

    <section class="combater-body">
      <div class="combater-plan-list">
        {{#if builder.searchQuery}}
          {{#each builder.mergedSearchResults}}
            <article class="combater-alt combater-builder-card combater-action-section">
              <div class="combater-alt-head">
                <span class="combater-alt-title">
                  <strong>{{label}}</strong>
                  <span class="combater-section-tag">{{tabLabel}}</span>
                  {{#if countLabel}}<span class="combater-section-count">{{countLabel}}</span>{{/if}}
                </span>
              </div>
              <div class="combater-alt-details">
                {{> actionRows}}
              </div>
            </article>
          {{else}}
            <p class="combater-empty">{{localize "PF2E_COMBATER.Browser.NoActions"}}</p>
          {{/each}}
        {{else}}
          {{#each builder.tabsList}}
            {{#if active}}
              {{#each sections}}
                <article class="combater-alt combater-builder-card combater-action-section">
                  <div class="combater-alt-head">
                    <span class="combater-alt-title">
                      <strong>{{label}}</strong>
                      {{#if countLabel}}<span class="combater-section-count">{{countLabel}}</span>{{/if}}
                    </span>
                  </div>
                  <div class="combater-alt-details">
                    {{> actionRows}}
                  </div>
                </article>
              {{/each}}
            {{/if}}
          {{/each}}
        {{/if}}
```

Everything from the original line 73 onward (the blank line, then `{{#if showDebug}}...{{/if}}`, then the closing `</div></section></div>`) stays exactly as-is — this replacement only covers the tab strip, search input, and results-rendering region, and the `sections`/`actions` context each `{{> actionRows}}` call relies on is unchanged from before (each section object still carries its own `actions` array, whether it came from `builder.tabsList` or `builder.mergedSearchResults`).

(The per-tab `searchQuery` field the disabled-tab check reads is not new — `decorateBuilderTab` has always set it on every tab object, per `scripts\ui\CombaterPanel.js:752`, mirroring the same global query onto each tab.)

- [ ] **Step 5: Update the CSS**

In `styles\combater.css`, immediately after the `.combater-tabs button.active { ... }` block (currently ending at line 954), insert:

```css

.pf2e-combater .combater-tabs button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

Immediately after the `.combater-section-count { ... }` block (currently ending at line 1053), insert:

```css

.pf2e-combater .combater-section-tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--combater-line);
  border-radius: 999px;
  background: var(--combater-surface);
  color: var(--combater-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 6: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors on the touched files.

- [ ] **Step 8: Commit**

```bash
git add scripts/ui/CombaterPanel.js templates/combater-browser.hbs styles/combater.css scripts/engine/self-test.js
git commit -m "feat: search actions across every cost tab, not just the active one"
```
