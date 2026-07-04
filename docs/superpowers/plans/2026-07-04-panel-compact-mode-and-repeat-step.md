# Compact Panel Mode + Repeat Plan Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header toggle that collapses the main panel into a condensed per-step list (Play/Remove only, secondary cards hidden), and a per-step duplicate control so a player can re-add the same plan step (e.g. another longsword Strike) without reopening the action browser.

**Architecture:** Both features are pure UI + draft-state changes confined to `CombaterPanel.js`, `templates/combater-panel.hbs`, `styles/combater.css`, and `lang/en.json`. No engine/planner/scoring changes. Compact mode revives an already-registered-but-unused `expanded` flag/setting by finally branching on it in the template (via a CSS class) and in the window's width. Duplicate follows the exact read-mutate-write pattern already used by `_removeDraftStep`/`_moveDraftStep`.

**Tech Stack:** Vanilla JS (Foundry `ApplicationV2`/`HandlebarsApplicationMixin`), Handlebars templates, hand-written CSS. No build step, no jest/prettier gates (see Global Constraints).

**Full context — read before starting either task:**
- `scripts\ui\CombaterPanel.js:1095-1157` — `CombaterPanel` class, `DEFAULT_OPTIONS`, constructor (this is where `this.expanded` is already seeded from saved state / `SETTINGS.compactDefault`, line 1127-1129 — nothing to change here).
- `scripts\ui\CombaterPanel.js:1272-1310` — `_viewContext`; `expanded: this.expanded` (line 1291) is already passed to the template today. Nothing to change here either.
- `scripts\ui\CombaterPanel.js:1323-1452` — `_onRender`; every interactive element is wired here via `element.querySelector`/`querySelectorAll` + `addEventListener`, one block per `data-*` attribute. Both tasks add one more block each, following this exact style.
- `templates\combater-panel.hbs` — single template. Line 1 opens `.combater-shell`. Lines 2-183 define two inline partials (`draftSequence`, `draftStepChip`) used to render every plan step. Lines 185-262 are the always-visible header (actor identity + action-pool badge + Browse/Refresh buttons) — this header is untouched by both tasks; the pool-count badge already visible there is why compact mode doesn't need a separate summary line (self-test.js:504-508 already asserts a step-count summary must NOT render above the plan rows — that was tried and reverted before).
- `styles\combater.css:1-20` — the outer window (`.pf2e-combater.combater-panel`) sets `min-width: 360px; max-width: min(560px, 100vw-24px)`. 360 is reused below as the compact width floor.

## Global Constraints

- Test gate is `npm test` (runs `node scripts/engine/self-test.js`, ~11.7k+ lines of `assert` calls against real source/template/CSS text — prints `PF2e Combater self-test passed` on success). NOT jest — `npm test` happens to alias to the same command already.
- Lint gate is `npm run lint` (`eslint .`). Do not run `npm run format`/prettier — the repo is not prettier-clean and running it creates unrelated reformatting noise.
- Match surrounding code style exactly: 2-space indent, double quotes, semicolons, no new abstractions beyond what's specified below.
- All user-facing strings go through `lang/en.json` under the `PF2E_COMBATER.Panel.*` namespace (template uses Foundry's native `{{localize "KEY"}}` helper, which requires the literal key to exist in `lang/en.json` — there is no JS-side fallback for template-only strings).

---

## Task 1: Compact-mode header toggle

**Files:**
- Modify: `templates\combater-panel.hbs:1` (shell class), `templates\combater-panel.hbs:253-259` (header button)
- Modify: `scripts\ui\CombaterPanel.js:1335-1338` (`_onRender` wiring), `scripts\ui\CombaterPanel.js:1517-1521` (`_setExpanded`)
- Modify: `styles\combater.css` (new block after line 368)
- Modify: `lang\en.json:66` (new keys)
- Test: `scripts\engine\self-test.js` (new assertions after line 503)

**Interfaces:**
- Consumes: `this.expanded` (boolean, already set in the constructor per `scripts\ui\CombaterPanel.js:1127-1129`) and `this._setExpanded(expanded)` (already implemented at `scripts\ui\CombaterPanel.js:1517-1521`, persists via `writePanelState` and re-renders) — both pre-existing, unchanged by this task except the one-line width addition below.
- Produces: nothing consumed by Task 2. Fully independent — do in either order.

- [ ] **Step 1: Write the failing self-test assertions**

Open `scripts\engine\self-test.js` and insert this block immediately after line 503 (right after the existing `combater-step-details` flex-wrap assertion, before the `headerSummary` assertion at line 504):

```javascript
assert.ok(
  panelTemplateSource.includes('data-action="toggle-compact"'),
  "panel header should expose a compact-mode toggle button",
);
assert.ok(
  panelTemplateSource.includes('combater-shell{{#unless expanded}} is-compact{{/unless}}'),
  "panel shell should flag compact mode via a CSS class driven by the expanded flag",
);
assert.ok(
  /_setExpanded\(expanded\) \{[\s\S]*?setPosition\(\{ width: expanded \? 720 : 360 \}\)/.test(panelSource),
  "toggling compact mode should also shrink/restore the window width",
);
assert.ok(
  /\.combater-shell\.is-compact \.combater-step-tools \.combater-chip-tool:not\(\.is-execute\):not\(\.danger\):not\(\.combater-step-waiting\)[\s\S]*?display:\s*none;/.test(panelStyleSource),
  "compact mode should hide secondary per-step tools but keep Execute/Remove/awaiting-GM visible",
);
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero; the first failing assertion is `"panel header should expose a compact-mode toggle button"` (or one of the three assertions above, depending on which the script reaches first).

- [ ] **Step 3: Add the localization keys**

In `lang\en.json`, the `PF2E_COMBATER.Panel` block currently reads (around line 66):

```json
      "Refresh": "Refresh",
      "SustainedSpells": "Sustained spells",
```

Change to:

```json
      "Refresh": "Refresh",
      "CompactExpand": "Expand plan",
      "CompactCollapse": "Compact plan",
      "CompactToggleAria": "Toggle compact mode",
      "SustainedSpells": "Sustained spells",
```

- [ ] **Step 4: Flag compact mode on the shell element**

In `templates\combater-panel.hbs`, line 1 is currently:

```html
<div class="combater-shell">
```

Change to:

```html
<div class="combater-shell{{#unless expanded}} is-compact{{/unless}}">
```

- [ ] **Step 5: Add the toggle button to the header**

In `templates\combater-panel.hbs`, the header actions row currently reads (around line 253-259):

```html
        <button type="button" class="combater-header-browse {{#if browserOpen}}is-active{{/if}}" data-action="toggle-browser" data-tooltip="{{#if browserOpen}}{{localize "PF2E_COMBATER.Panel.BrowseClose"}}{{else}}{{localize "PF2E_COMBATER.Panel.BrowseOpen"}}{{/if}}" aria-label="{{localize "PF2E_COMBATER.Panel.BrowseAria"}}" aria-pressed="{{#if browserOpen}}true{{else}}false{{/if}}">
          <i class="fa-solid fa-layer-group"></i>
          <span>{{localize "PF2E_COMBATER.Panel.Browse"}}</span>
        </button>
        <button type="button" class="icon-button" data-action="refresh" data-tooltip="{{localize "PF2E_COMBATER.Panel.Refresh"}}" aria-label="{{localize "PF2E_COMBATER.Panel.Refresh"}}">
          <i class="fa-solid fa-arrows-rotate"></i>
        </button>
```

Change to (new button inserted between Browse and Refresh):

```html
        <button type="button" class="combater-header-browse {{#if browserOpen}}is-active{{/if}}" data-action="toggle-browser" data-tooltip="{{#if browserOpen}}{{localize "PF2E_COMBATER.Panel.BrowseClose"}}{{else}}{{localize "PF2E_COMBATER.Panel.BrowseOpen"}}{{/if}}" aria-label="{{localize "PF2E_COMBATER.Panel.BrowseAria"}}" aria-pressed="{{#if browserOpen}}true{{else}}false{{/if}}">
          <i class="fa-solid fa-layer-group"></i>
          <span>{{localize "PF2E_COMBATER.Panel.Browse"}}</span>
        </button>
        <button type="button" class="icon-button" data-action="toggle-compact" data-tooltip="{{#if expanded}}{{localize "PF2E_COMBATER.Panel.CompactCollapse"}}{{else}}{{localize "PF2E_COMBATER.Panel.CompactExpand"}}{{/if}}" aria-label="{{localize "PF2E_COMBATER.Panel.CompactToggleAria"}}" aria-pressed="{{#if expanded}}false{{else}}true{{/if}}">
          <i class="fa-solid {{#if expanded}}fa-compress{{else}}fa-expand{{/if}}"></i>
        </button>
        <button type="button" class="icon-button" data-action="refresh" data-tooltip="{{localize "PF2E_COMBATER.Panel.Refresh"}}" aria-label="{{localize "PF2E_COMBATER.Panel.Refresh"}}">
          <i class="fa-solid fa-arrows-rotate"></i>
        </button>
```

- [ ] **Step 6: Wire the toggle button and shrink/restore window width**

In `scripts\ui\CombaterPanel.js`, `_onRender` currently reads (line 1335-1338):

```javascript
    element.querySelector("[data-action='toggle-browser']")
      ?.addEventListener("click", () => this._toggleBrowser());
    element.querySelector("[data-action='refresh']")
      ?.addEventListener("click", () => this.refresh("button"));
```

Change to:

```javascript
    element.querySelector("[data-action='toggle-browser']")
      ?.addEventListener("click", () => this._toggleBrowser());
    element.querySelector("[data-action='toggle-compact']")
      ?.addEventListener("click", () => this._setExpanded(!this.expanded));
    element.querySelector("[data-action='refresh']")
      ?.addEventListener("click", () => this.refresh("button"));
```

Then, still in `scripts\ui\CombaterPanel.js`, `_setExpanded` currently reads (line 1517-1521):

```javascript
  _setExpanded(expanded) {
    this.expanded = expanded;
    writePanelState({ expanded });
    this.render({ force: true });
  }
```

Change to:

```javascript
  _setExpanded(expanded) {
    this.expanded = expanded;
    writePanelState({ expanded });
    this.setPosition({ width: expanded ? 720 : 360 });
    this.render({ force: true });
  }
```

(720 matches `DEFAULT_OPTIONS.position.width`; 360 matches the CSS `min-width` floor at `styles\combater.css:18`. `setPosition` only touches width here — `_restorePosition`/`_savePosition` at `scripts\ui\CombaterPanel.js:2468-2490` only ever read/write `left`/`top`, so this can't fight the position-restore logic.)

- [ ] **Step 7: Add the compact-mode CSS**

In `styles\combater.css`, immediately after the block ending at line 368 (`.combater-chip-tool.combater-step-move:hover, ... :focus-visible { color: var(--combater-text); }`) and before the blank line at 369, insert:

```css

/* Compact mode (header toggle, driven by the `expanded` flag) keeps identity, the action-pool
   count, and each step's Play/Remove controls visible while hiding secondary editing tools and
   detail text, so a finished plan fits in less vertical space on smaller screens. */
.pf2e-combater .combater-shell.is-compact .combater-step-details,
.pf2e-combater .combater-shell.is-compact .combater-sustained-panel,
.pf2e-combater .combater-shell.is-compact .combater-uncounted-panel {
  display: none;
}

.pf2e-combater .combater-shell.is-compact .combater-step-tools .combater-chip-tool:not(.is-execute):not(.danger):not(.combater-step-waiting) {
  display: none;
}
```

- [ ] **Step 8: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: no errors on the touched files.

- [ ] **Step 10: Commit**

```bash
git add templates/combater-panel.hbs scripts/ui/CombaterPanel.js styles/combater.css lang/en.json scripts/engine/self-test.js
git commit -m "feat: add compact-mode toggle to the plan panel"
```

---

## Task 2: Repeat / duplicate a plan step

**Files:**
- Modify: `templates\combater-panel.hbs:78-87` (duplicate button in `draftStepChip`)
- Modify: `scripts\ui\CombaterPanel.js:1346-1348` (`_onRender` wiring), `scripts\ui\CombaterPanel.js:1772-1786` (new `_duplicateDraftStep` method)
- Modify: `lang\en.json:44` (new keys)
- Test: `scripts\engine\self-test.js` (new assertions after line 658)

**Interfaces:**
- Consumes (all pre-existing, unchanged): `draftStepId()` (`scripts\ui\CombaterPanel.js:504-507`, returns a fresh random id string), `markManualDraft(draft)` (`scripts\ui\CombaterPanel.js:1086-1093`), `this._canEditDraft()` (`scripts\ui\CombaterPanel.js:1639-1641`), `this._readActiveDraftPlan()` (`scripts\ui\CombaterPanel.js:1651-1655`), `this._writeActiveDraftPlan(draft)` (`scripts\ui\CombaterPanel.js:1672-1679`), `draftListForInstance(draft, instanceId)` (`scripts\state\draft-plans.js:265-268`, returns `"steps"` or `"uncounted"`), `clearActionPreview()` (already imported/used elsewhere in the file).
- Produces: nothing consumed by Task 1. Fully independent — do in either order.

- [ ] **Step 1: Write the failing self-test assertions**

Open `scripts\engine\self-test.js` and insert this block immediately after line 658 (right after the existing `_removeDraftStep` GM-sync assertion, before the `_autoFillDraft` assertion at line 659):

```javascript
assert.ok(
  panelTemplateSource.includes("data-duplicate-draft-step"),
  "each draft step should expose a duplicate control",
);
assert.ok(
  /\{\{#unless groupId\}\}[\s\S]*?data-duplicate-draft-step="\{\{instanceId\}\}"/.test(panelTemplateSource),
  "the duplicate control should be gated behind groupId so grouped composite atoms can't be duplicated individually",
);
assert.ok(
  /_duplicateDraftStep\(instanceId\)[\s\S]*draftStepId\(\)[\s\S]*_writeActiveDraftPlan\(markManualDraft\(/.test(panelSource),
  "duplicating a step should clone it with a fresh instanceId and persist through the same manual-draft write path as remove/move",
);
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero; the first failing assertion is `"each draft step should expose a duplicate control"` (or one of the two below it).

- [ ] **Step 3: Add the localization keys**

In `lang\en.json`, the `PF2E_COMBATER.Panel` block currently reads (around line 43-45):

```json
      "MoveDown": "Move down",
      "MoveDownAria": "Move {name} down",
      "RevertStep": "Revert this step",
```

Change to:

```json
      "MoveDown": "Move down",
      "MoveDownAria": "Move {name} down",
      "DuplicateStep": "Duplicate this step",
      "DuplicateStepAria": "Duplicate {name}",
      "RevertStep": "Revert this step",
```

- [ ] **Step 4: Add the duplicate button to the step-tools cluster**

In `templates\combater-panel.hbs`, inside the `draftStepChip` inline partial, the move-up/move-down block currently reads (around line 78-87):

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
              {{#unless isExecutionDone}}
```

Change to (new duplicate button inserted after move-down, before the execute block):

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
              {{#unless groupId}}
                {{#unless readonly}}
                <button type="button" class="combater-chip-tool" data-duplicate-draft-step="{{instanceId}}" data-tooltip="{{localize "PF2E_COMBATER.Panel.DuplicateStep"}}" aria-label="{{localize "PF2E_COMBATER.Panel.DuplicateStepAria" name=name}}">
                  <i class="fa-solid fa-clone"></i>
                </button>
                {{/unless}}
              {{/unless}}
              {{#unless isExecutionDone}}
```

(`groupId` is only set on atoms of a grouped composite ability — e.g. both Strikes of a Double Attack — where the atoms must stay paired; gating on it here keeps duplicate available for every ordinary step, which covers Strikes.)

- [ ] **Step 5: Wire the duplicate button**

In `scripts\ui\CombaterPanel.js`, `_onRender` currently reads (line 1346-1348):

```javascript
    for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
      button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
    }
```

Change to:

```javascript
    for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
      button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
    }

    for (const button of element.querySelectorAll("[data-duplicate-draft-step]")) {
      button.addEventListener("click", () => this._duplicateDraftStep(button.dataset.duplicateDraftStep));
    }
```

- [ ] **Step 6: Implement `_duplicateDraftStep`**

In `scripts\ui\CombaterPanel.js`, `_removeDraftStep` and `_moveDraftStep` currently sit back-to-back (line 1772-1786):

```javascript
  async _removeDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
    await this._writeActiveDraftPlan(markManualDraft({
      ...draft,
      [listKey]: list.filter((step) => step.instanceId !== instanceId),
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _moveDraftStep(instanceId, direction) {
```

Insert a new method between them:

```javascript
  async _removeDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
    await this._writeActiveDraftPlan(markManualDraft({
      ...draft,
      [listKey]: list.filter((step) => step.instanceId !== instanceId),
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _duplicateDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
    const index = list.findIndex((step) => step.instanceId === instanceId);
    if (index < 0) return;
    const clone = { ...list[index], instanceId: draftStepId() };
    const nextList = [...list.slice(0, index + 1), clone, ...list.slice(index + 1)];
    await this._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: nextList }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _moveDraftStep(instanceId, direction) {
```

(No new validation: an over-budget plan from duplicating already surfaces via the existing action-pool warning UI, same as manually adding the same action twice. No new re-resolution logic: stale targets on the clone are handled by the existing per-render `findProjectedDraftAction` re-resolution that every step already goes through.)

- [ ] **Step 7: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors on the touched files.

- [ ] **Step 9: Commit**

```bash
git add templates/combater-panel.hbs scripts/ui/CombaterPanel.js lang/en.json scripts/engine/self-test.js
git commit -m "feat: add a per-step duplicate control to the plan panel"
```
