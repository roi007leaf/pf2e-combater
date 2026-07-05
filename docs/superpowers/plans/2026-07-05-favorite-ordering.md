# Drag-to-Reorder Favorite Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player drag-reorder their favorited actions in the action browser's Favorites section, persisting a per-actor custom order instead of the current fixed score-then-name order.

**Architecture:** Reuses the exact pattern that shipped for plan-step drag-reorder (`scripts/engine/draft-reorder.js`'s `swapDraftSteps`, `CombaterPanel.js`'s `_reorderDraftStep`, the `.is-dragging`/`.drop-target` CSS, and the `[data-drag-list]`/`[data-drag-row]` wiring) — swap-on-drop, no insert-before/after. Favorites need no group/block handling (no `groupId` concept), so the new pure module is simpler than `draft-reorder.js`. The favorites list itself is already stored in insertion order (`scripts/state/action-favorites.js`'s flat `{key: true}` map) — this plan makes that order explicit and mutable instead of incidental.

**Tech Stack:** Vanilla JS (Foundry `ApplicationV2`/`HandlebarsApplicationMixin`), native HTML5 Drag and Drop API, Handlebars templates, hand-written CSS. No build step, no jest/prettier gates (see Global Constraints).

**Design doc:** `docs/superpowers/specs/2026-07-05-favorite-ordering-design.md`

## Global Constraints

- Test gate is `npm test` (runs `node scripts/engine/self-test.js`, prints `PF2e Combater self-test passed` on success). NOT jest.
- Lint gate is `npm run lint` (`eslint .`). Do not run `npm run format`/prettier.
- Match surrounding code style exactly: 2-space indent, double quotes, semicolons, no new abstractions beyond what's specified below.
- `CombaterPanel`/`CombaterBrowser` are `ApplicationV2` subclasses that throw under plain Node (`foundry.applications.api` doesn't exist there) — `self-test.js` never imports them directly, it reads them as source text (`panelSource`, `browserSource`, `panelTemplateSource`, `browserTemplateSource`, `panelStyleSource` — all already defined near the top of `self-test.js`) and asserts patterns against that text. Every task touching those files/templates/CSS follows this convention; only the new pure `favorite-reorder.js` module gets real `assert.deepEqual` tests.
- No new `lang/en.json` entries — the drag handle reuses the existing `PF2E_COMBATER.Panel.DragToReorder`/`DragToReorderAria` strings verbatim (the copy is equally true for a favorite row).
- No storage format migration — `action-favorites.js`'s flat map is unchanged; only a new read/reorder/write function is added.

---

## Task 1: Pure favorite-swap module

**Files:**
- Create: `scripts\engine\favorite-reorder.js`
- Test: `scripts\engine\self-test.js` (import near line 6; assertions near line 447)

**Interfaces:**
- Produces: `swapFavorites(favoriteKeys, key, targetKey)` — pure function, exported from `scripts/engine/favorite-reorder.js`. Takes an array of strings, swaps the positions of `key` and `targetKey`, returns a new array (or the same array reference, unchanged, if the drop is a no-op: unknown key, unknown target, or `key === targetKey`).

- [ ] **Step 1: Write the failing test assertions**

In `scripts\engine\self-test.js`, line 6 currently reads:

```javascript
import { swapDraftSteps } from "./draft-reorder.js";
```

Change to:

```javascript
import { swapDraftSteps } from "./draft-reorder.js";
import { swapFavorites } from "./favorite-reorder.js";
```

Lines 442-447 currently read (the last of the existing `swapDraftSteps` group-no-op test):

```javascript
const swapGroupNoOpList = [{ instanceId: "g1a", groupId: "g1" }, { instanceId: "g1b", groupId: "g1" }];
assert.equal(
  swapDraftSteps(swapGroupNoOpList, "g1a", "g1b"),
  swapGroupNoOpList,
  "dropping a step onto a member of its own group should be a no-op",
);
```

Immediately after that block (before the `assert.ok(panelSource.includes("_reorderDraftStep")...` line that follows), insert:

```javascript
assert.deepEqual(swapFavorites(["a", "b", "c", "d"], "a", "c"), ["c", "b", "a", "d"], "swapping two favorites should trade their positions");
assert.deepEqual(swapFavorites(["a", "b", "c", "d"], "d", "b"), ["a", "d", "c", "b"], "swap should work symmetrically regardless of which side is later in the list");
const favoriteSwapNoOpList = ["a", "b"];
assert.equal(swapFavorites(favoriteSwapNoOpList, "a", "a"), favoriteSwapNoOpList, "dropping a favorite onto itself should be a no-op");
assert.equal(swapFavorites(favoriteSwapNoOpList, "a", "missing"), favoriteSwapNoOpList, "swapping with an unknown target should be a no-op");
assert.equal(swapFavorites(favoriteSwapNoOpList, "missing", "a"), favoriteSwapNoOpList, "swapping an unknown key should be a no-op");
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero. `favorite-reorder.js` does not exist yet, so this fails immediately with a "Cannot find module" / `ERR_MODULE_NOT_FOUND` error on the new import.

- [ ] **Step 3: Create the pure swap module**

Create `scripts\engine\favorite-reorder.js`:

```javascript
// Pure array swap for drag-and-drop: trades the positions of `key` and `targetKey`, leaving
// everything else untouched. Favorites have no group/block concept (unlike draft steps), so this
// is simpler than draft-reorder.js's swapDraftSteps.
export function swapFavorites(favoriteKeys, key, targetKey) {
  const list = Array.isArray(favoriteKeys) ? favoriteKeys : [];
  const index = list.indexOf(key);
  const targetIndex = list.indexOf(targetKey);
  if (index < 0 || targetIndex < 0 || key === targetKey) return list;
  const swapped = [...list];
  [swapped[index], swapped[targetIndex]] = [swapped[targetIndex], swapped[index]];
  return swapped;
}
```

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors on `scripts/engine/favorite-reorder.js`.

- [ ] **Step 6: Commit**

```bash
git add scripts/engine/favorite-reorder.js scripts/engine/self-test.js
git commit -m "feat: add pure swap helper for favorite-action reordering"
```

---

## Task 2: Persist favorite order

**Files:**
- Modify: `scripts\state\action-favorites.js`
- Test: `scripts\engine\self-test.js` (import near line 49-53; assertions near line 3368)

**Interfaces:**
- Consumes: `swapFavorites(favoriteKeys, key, targetKey)` (Task 1), pre-existing `readActionFavorites(context)` / `writeActionFavorites(context, favorites)` (both unchanged).
- Produces: `reorderActionFavorite(context, key, targetKey)` — reads the current favorite order, swaps `key`/`targetKey`, persists if changed. Returns `true` if the stored order changed, `false` otherwise (unknown key/target, or no-op swap).

- [ ] **Step 1: Write the failing test assertions**

In `scripts\engine\self-test.js`, lines 49-53 currently read:

```javascript
import {
  favoriteKey,
  readActionFavorites,
  toggleActionFavorite,
} from "../state/action-favorites.js";
```

Change to:

```javascript
import {
  favoriteKey,
  readActionFavorites,
  reorderActionFavorite,
  toggleActionFavorite,
} from "../state/action-favorites.js";
```

Lines 3365-3368 currently read (inside the mocked-`localStorage` block):

```javascript
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), true);
  assert.deepEqual([...readActionFavorites(builderContext)], ["strike-longsword"]);
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), false);
  assert.deepEqual([...readActionFavorites(builderContext)], []);
```

Immediately after that block (still inside the same `try { ... }` — the mocked `localStorage`/`game` globals stay in scope), insert:

```javascript
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), true);
  assert.equal(toggleActionFavorite(builderContext, "shield"), true);
  assert.equal(toggleActionFavorite(builderContext, "stride"), true);
  assert.deepEqual([...readActionFavorites(builderContext)], ["strike-longsword", "shield", "stride"]);
  assert.equal(reorderActionFavorite(builderContext, "strike-longsword", "stride"), true);
  assert.deepEqual([...readActionFavorites(builderContext)], ["stride", "shield", "strike-longsword"]);
  assert.equal(reorderActionFavorite(builderContext, "strike-longsword", "strike-longsword"), false);
  assert.equal(reorderActionFavorite(builderContext, "missing", "stride"), false);
  assert.deepEqual([...readActionFavorites(builderContext)], ["stride", "shield", "strike-longsword"]);
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), false);
  assert.equal(toggleActionFavorite(builderContext, "shield"), false);
  assert.equal(toggleActionFavorite(builderContext, "stride"), false);
  assert.deepEqual([...readActionFavorites(builderContext)], []);
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero — `reorderActionFavorite` is not exported from `action-favorites.js` yet, so the ESM import fails at parse time (`SyntaxError: The requested module '../state/action-favorites.js' does not provide an export named 'reorderActionFavorite'`).

- [ ] **Step 3: Implement `reorderActionFavorite`**

In `scripts\state\action-favorites.js`, add the import. Line 1 currently reads:

```javascript
import { STORAGE_KEYS } from "../constants.js";
```

Change to:

```javascript
import { STORAGE_KEYS } from "../constants.js";
import { swapFavorites } from "../engine/favorite-reorder.js";
```

At the end of the file (after `toggleActionFavorite`, currently the last export at lines 69-79), add:

```javascript

export function reorderActionFavorite(context, key, targetKey) {
  const ordered = [...readActionFavorites(context)];
  const swapped = swapFavorites(ordered, key, targetKey);
  if (swapped === ordered) return false;
  writeActionFavorites(context, swapped);
  return true;
}
```

- [ ] **Step 4: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors on `scripts/state/action-favorites.js`.

- [ ] **Step 6: Commit**

```bash
git add scripts/state/action-favorites.js scripts/engine/self-test.js
git commit -m "feat: persist a reorderable favorite-action sequence"
```

---

## Task 3: Order the Favorites list by stored order

**Files:**
- Modify: `scripts\engine\action-builder.js` (`favoriteApplies` → `favoriteEntryKey` at lines 1183-1186; `decorateAction` at lines 1188-1208; `buildActionBuilderModel` at lines 1417/1512-1516)
- Test: `scripts\engine\self-test.js` (new assertions after line 3723, the existing `builderModel` test block)

**Interfaces:**
- Consumes: nothing new (independent of Tasks 1-2; the favorite order it reads is whatever `favorites` Set/iterable is passed into `buildActionBuilderModel`, same as today).
- Produces: `action.favoriteEntryKey` — a new field on every action decorated by `decorateAction` (`action-builder.js`), holding the literal string (`key` or `baseKey`) actually present in the favorites set, or `null` if the action isn't favorited. `tab.favorites` is now sorted by that stored order instead of `tab.all`'s score-then-name order. Task 4 (UI) consumes `action.favoriteEntryKey` as the drag identifier, since a favorite may be stored under either its variant key or its shared base key and the two must not be confused.

- [ ] **Step 1: Write the failing test**

In `scripts\engine\self-test.js`, find the existing `builderModel` test block (currently ending around line 3723 with `assert.equal(builderModel.tabs.two.all[0].disabledReason, "Not enough actions remaining.");`). Immediately after it, insert a new self-contained test:

```javascript
const orderedFavoritesModel = buildActionBuilderModel({
  context: { combat: { id: "combat-2", round: 1 }, combatant: { id: "c2" }, actor: { uuid: "Actor.a2" } },
  candidates: [
    { id: "alpha", slug: "alpha", name: "Alpha", actionCost: 1, score: 5, reason: "A." },
    { id: "bravo", slug: "bravo", name: "Bravo", actionCost: 1, score: 50, reason: "B." },
    { id: "charlie", slug: "charlie", name: "Charlie", actionCost: 1, score: 25, reason: "C." },
  ],
  // Deliberately not in score order (bravo has the highest score) -- favorites should follow the
  // Set's insertion order, not tab.all's score-then-name sort.
  favorites: new Set(["charlie", "alpha", "bravo"]),
});
assert.deepEqual(
  orderedFavoritesModel.tabs.one.favorites.map((action) => action.key),
  ["charlie", "alpha", "bravo"],
  "favorites should render in the user's stored order, not score order",
);
assert.deepEqual(
  orderedFavoritesModel.tabs.one.favorites.map((action) => action.favoriteEntryKey),
  ["charlie", "alpha", "bravo"],
  "each favorited action should expose which literal key is stored for it",
);
assert.equal(
  orderedFavoritesModel.tabs.one.all.find((action) => action.key === "alpha").favoriteEntryKey,
  "alpha",
  "a non-favorited-looking lookup should still resolve favoriteEntryKey for a favorited action",
);
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero. `favoriteEntryKey` doesn't exist yet, so `orderedFavoritesModel.tabs.one.favorites.map((action) => action.favoriteEntryKey)` is all `undefined`, and (since `tab.favorites` is still in score order) the first assertion fails too — order would be `["bravo", "charlie", "alpha"]` (score 50/25/5), not `["charlie", "alpha", "bravo"]`.

- [ ] **Step 3: Replace `favoriteApplies` with `favoriteEntryKey`**

In `scripts\engine\action-builder.js`, lines 1183-1186 currently read:

```javascript
function favoriteApplies(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return true;
  return baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey);
}
```

Change to:

```javascript
function favoriteEntryKey(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return key;
  if (baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey)) return baseKey;
  return null;
}
```

Lines 1188-1208 (`decorateAction`) currently read:

```javascript
function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const availabilityWarning = action?.available === false || action?.disabled === true ? actionUnavailableReason(action) : "";
  const disabled = disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    favorite: favoriteApplies(favorites, key, baseKey, baseKeyCounts),
    ...disabled,
    availabilityWarning,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}
```

Change to:

```javascript
function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const availabilityWarning = action?.available === false || action?.disabled === true ? actionUnavailableReason(action) : "";
  const disabled = disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  const favoriteEntry = favoriteEntryKey(favorites, key, baseKey, baseKeyCounts);
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    favorite: favoriteEntry !== null,
    favoriteEntryKey: favoriteEntry,
    ...disabled,
    availabilityWarning,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}
```

- [ ] **Step 4: Track the favorite order and sort `tab.favorites` by it**

Still in `scripts\engine\action-builder.js`, the `favoriteSet` line (currently line 1417) reads:

```javascript
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
```

Change to:

```javascript
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  // Sets iterate in insertion order, which is already the user's favorite-order (see
  // action-favorites.js) -- capture it once here for sorting tab.favorites below.
  const favoriteOrder = [...favoriteSet];
```

Lines 1512-1516 currently read:

```javascript
  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all.filter((action) => action.favorite);
    tab.quickened = [];
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }
```

Change to:

```javascript
  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all
      .filter((action) => action.favorite)
      .toSorted((left, right) => favoriteOrder.indexOf(left.favoriteEntryKey) - favoriteOrder.indexOf(right.favoriteEntryKey));
    tab.quickened = [];
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }
```

- [ ] **Step 5: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0). This also confirms the two pre-existing single-favorite assertions (`builderModel.tabs.one.favorites[0].key === "shield"` and the `collisionBuilderModel` favorites check) still pass unchanged — a single-item favorite set has only one possible order.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors on `scripts/engine/action-builder.js`.

- [ ] **Step 7: Commit**

```bash
git add scripts/engine/action-builder.js scripts/engine/self-test.js
git commit -m "feat: order the Favorites section by the user's stored favorite order"
```

---

## Task 4: Drag-and-drop UI

**Files:**
- Modify: `scripts\ui\CombaterPanel.js` (import at line 35; local `decorateAction` at lines 572-586; `decorateBuilderTab` at lines 738-766; new `_reorderFavorite` method near `_toggleFavorite` at lines 1997-2002)
- Modify: `scripts\ui\CombaterBrowser.js` (`_onRender` wiring, after the `[data-favorite-action]` block at lines 125-130)
- Modify: `templates\combater-browser.hbs` (`actionRows` inline partial, lines 3-40; both `.combater-alt-details` call sites, lines ~69-71 and ~87-89)
- Modify: `styles\combater.css` (lines 393-404)
- Test: `scripts\engine\self-test.js` (assertions after line 560)

**Interfaces:**
- Consumes: `action.favoriteEntryKey` (Task 3) as the drag identifier; `reorderActionFavorite(context, key, targetKey)` (Task 2).
- Produces: end-to-end drag-to-reorder in the Favorites section of the action browser.

- [ ] **Step 1: Write the failing test assertions**

In `scripts\engine\self-test.js`, immediately after line 560 (`assert.ok(browserTemplateSource.includes('{{#*inline "actionRows"}}'), ...)`), before line 561 (`assert.ok(/async close\(...`), insert:

```javascript
assert.ok(panelSource.includes("canDragFavorite"), "favorites should expose whether they can be dragged");
assert.ok(panelSource.includes("isFavoritesSection"), "the favorites section should be identifiable in the template");
assert.ok(panelSource.includes("_reorderFavorite"), "panel should support drag-to-reorder for favorites");
assert.ok(panelSource.includes("import { reorderActionFavorite }") || panelSource.includes("reorderActionFavorite,"),
  "panel should reuse the persistence-layer reorder helper");
assert.ok(browserTemplateSource.includes("data-drag-favorite"), "each draggable favorite should expose a drag handle");
assert.ok(browserTemplateSource.includes("data-drag-list"), "the favorites container should mark itself as a drag/drop list");
assert.ok(
  /isFavoritesSection[\s\S]*?data-drag-list/.test(browserTemplateSource) || /data-drag-list[\s\S]*?isFavoritesSection/.test(browserTemplateSource),
  "only the favorites section's container should be a drag/drop list",
);
assert.ok(browserSource.includes("panel._reorderFavorite"), "browser drag wiring should call into the panel");
assert.ok(browserSource.includes("data-drag-favorite"), "browser should wire dragstart on the favorite drag handle");
assert.ok(panelStyleSource.includes(".combater-action-row.is-dragging") || /\.combater-action-row\.is-dragging|combater-action-row,[\s\S]{0,80}is-dragging/.test(panelStyleSource),
  "dragged favorite rows should get the shared dragging visual state");
```

- [ ] **Step 2: Run the suite and confirm it fails**

Run: `npm test`
Expected: exits non-zero — none of `canDragFavorite`/`isFavoritesSection`/`_reorderFavorite`/`data-drag-favorite` exist yet.

- [ ] **Step 3: Add `_reorderFavorite` and the `canDragFavorite`/`isFavoritesSection` view-model fields**

In `scripts\ui\CombaterPanel.js`, line 35 currently reads:

```javascript
import { readActionFavorites, toggleActionFavorite } from "../state/action-favorites.js";
```

Change to:

```javascript
import { readActionFavorites, reorderActionFavorite, toggleActionFavorite } from "../state/action-favorites.js";
```

The local `decorateAction` (lines 572-586) currently reads:

```javascript
function decorateAction(action, options = {}) {
  const cost = action?.actionCost ?? action?.cost ?? 1;
  const decorated = decorateStep(action, 0, 0);
  const detailChips = actionDetailChips(action);
  return {
    ...decorated,
    favoriteTitle: action?.favorite ? "Remove favorite" : "Add favorite",
    disabledTitle: action?.disabled ? action.disabledReason : "Add to draft",
    requiresDestination: requiresDestinationForAction(action),
    targetLabel: options.hideTarget ? "" : decorated.targetLabel,
    detailChips,
    hasDetailChips: detailChips.length > 0,
    readonly: options.readonly === true,
  };
}
```

Change to:

```javascript
function decorateAction(action, options = {}) {
  const cost = action?.actionCost ?? action?.cost ?? 1;
  const decorated = decorateStep(action, 0, 0);
  const detailChips = actionDetailChips(action);
  return {
    ...decorated,
    favoriteTitle: action?.favorite ? "Remove favorite" : "Add favorite",
    disabledTitle: action?.disabled ? action.disabledReason : "Add to draft",
    requiresDestination: requiresDestinationForAction(action),
    targetLabel: options.hideTarget ? "" : decorated.targetLabel,
    detailChips,
    hasDetailChips: detailChips.length > 0,
    readonly: options.readonly === true,
    canDragFavorite: options.canDragFavorite === true && options.readonly !== true,
  };
}
```

`decorateBuilderTab` (lines 738-766) currently reads:

```javascript
function decorateBuilderTab(tab, activeTab, { readonly = false, searchQuery = "" } = {}) {
  const quickenedActions = filterBuilderTabActions(tab.quickened ?? [], searchQuery)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const categorizedActions = filterBuilderTabActions(tab.all, searchQuery)
    .filter((action) => !action.favorite)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const sections = [
    {
      id: "favorites",
      label: t("Section.Favorites", "Favorites"),
      actions: filterBuilderTabActions(tab.favorites, searchQuery)
        .map((action) => decorateAction(action, { readonly })),
    },
    ...(quickenedActions.length
      ? [{ id: "quickened", label: t("Section.Quickened", "Quickened actions"), actions: quickenedActions }]
      : []),
    ...groupActionsByBuilderCategory(categorizedActions),
  ];
  return {
    ...tab,
    active: tab.id === activeTab,
    glyphIcon: actionGlyphIcon(tab.cost),
    searchQuery: String(searchQuery ?? ""),
    sections: sections.map((section) => ({
      ...section,
      hasActions: section.actions.length > 0,
    })),
  };
}
```

Change the `favorites` section entry to:

```javascript
function decorateBuilderTab(tab, activeTab, { readonly = false, searchQuery = "" } = {}) {
  const quickenedActions = filterBuilderTabActions(tab.quickened ?? [], searchQuery)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const categorizedActions = filterBuilderTabActions(tab.all, searchQuery)
    .filter((action) => !action.favorite)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const sections = [
    {
      id: "favorites",
      label: t("Section.Favorites", "Favorites"),
      isFavoritesSection: true,
      actions: filterBuilderTabActions(tab.favorites, searchQuery)
        .map((action) => decorateAction(action, { readonly, canDragFavorite: true })),
    },
    ...(quickenedActions.length
      ? [{ id: "quickened", label: t("Section.Quickened", "Quickened actions"), actions: quickenedActions }]
      : []),
    ...groupActionsByBuilderCategory(categorizedActions),
  ];
  return {
    ...tab,
    active: tab.id === activeTab,
    glyphIcon: actionGlyphIcon(tab.cost),
    searchQuery: String(searchQuery ?? ""),
    sections: sections.map((section) => ({
      ...section,
      hasActions: section.actions.length > 0,
    })),
  };
}
```

Finally, `_toggleFavorite` (lines 1997-2002) currently reads:

```javascript
  async _toggleFavorite(actionKey) {
    if (!this._canEditDraft()) return;
    if (!this._context || !actionKey) return;
    toggleActionFavorite(this._context, actionKey);
    await this.render({ force: true });
  }
```

Add a new method directly after it:

```javascript
  async _toggleFavorite(actionKey) {
    if (!this._canEditDraft()) return;
    if (!this._context || !actionKey) return;
    toggleActionFavorite(this._context, actionKey);
    await this.render({ force: true });
  }

  async _reorderFavorite(key, targetKey) {
    if (!this._canEditDraft()) return;
    if (!this._context || !key || !targetKey || key === targetKey) return;
    const changed = reorderActionFavorite(this._context, key, targetKey);
    if (!changed) return;
    await this.render({ force: true });
  }
```

- [ ] **Step 4: Wire drag-and-drop in the browser window**

In `scripts\ui\CombaterBrowser.js`, the favorite-toggle wiring (lines 125-130) currently reads:

```javascript
    for (const button of element.querySelectorAll("[data-favorite-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        panel._toggleFavorite(button.dataset.favoriteAction);
      });
    }

    for (const button of element.querySelectorAll("[data-open-action]")) {
```

Change to:

```javascript
    for (const button of element.querySelectorAll("[data-favorite-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        panel._toggleFavorite(button.dataset.favoriteAction);
      });
    }

    for (const container of element.querySelectorAll("[data-drag-list]")) {
      let draggingId = null;
      for (const handle of container.querySelectorAll("[data-drag-favorite]")) {
        handle.addEventListener("dragstart", (event) => {
          draggingId = handle.dataset.dragFavorite;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggingId);
          handle.closest("[data-drag-row]")?.classList.add("is-dragging");
        });
        handle.addEventListener("dragend", () => {
          draggingId = null;
          for (const row of container.querySelectorAll(".is-dragging, .drop-target")) {
            row.classList.remove("is-dragging", "drop-target");
          }
        });
      }
      for (const row of container.querySelectorAll("[data-drag-row]")) {
        row.addEventListener("dragover", (event) => {
          if (!draggingId) return;
          event.preventDefault();
          event.stopPropagation();
          row.classList.add("drop-target");
        });
        row.addEventListener("dragleave", (event) => {
          event.stopPropagation();
          row.classList.remove("drop-target");
        });
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          row.classList.remove("drop-target");
          if (draggingId) panel._reorderFavorite(draggingId, row.dataset.dragRow);
        });
      }
    }

    for (const button of element.querySelectorAll("[data-open-action]")) {
```

(This is a direct copy of the plan-step drag wiring already in `CombaterPanel.js:1450-1484`, renamed to the favorite-specific data attributes and calling `panel._reorderFavorite` instead of `this._reorderDraftStep`.)

- [ ] **Step 5: Update the browser template**

In `templates\combater-browser.hbs`, the `actionRows` inline partial (lines 3-40) currently reads:

```html
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
```

Change to:

```html
    {{#*inline "actionRows"}}
      {{#each actions}}
        <div class="combater-alt-step combater-action-row {{#if favorite}}is-favorite{{/if}} {{#if disabled}}is-disabled{{/if}}" {{#if canDragFavorite}}data-drag-row="{{favoriteEntryKey}}"{{/if}}>
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
          {{#if canDragFavorite}}
            <span class="combater-chip-tool combater-step-drag" data-drag-favorite="{{favoriteEntryKey}}" draggable="true" data-tooltip="{{localize "PF2E_COMBATER.Panel.DragToReorder"}}" aria-label="{{localize "PF2E_COMBATER.Panel.DragToReorderAria" name=name}}">
              <i class="fa-solid fa-grip-vertical"></i>
            </span>
          {{/if}}
          {{/unless}}
        </div>
      {{else}}
        <p class="combater-empty">{{localize "PF2E_COMBATER.Browser.NoActions"}}</p>
      {{/each}}
    {{/inline}}
```

(The drag handle sits after the add/add-uncounted buttons rather than before the favorite-star button: each `.combater-action-row` is its own independent CSS grid instance, so a 5th child on favorite rows spills into a new implicit grid column without shifting the 4 fixed tracks non-favorite rows still use. Putting it first would instead push every existing column over by one for rows that have it, misaligning favorite rows against non-favorite rows in the same section.)

Both `.combater-alt-details` container lines currently read (once in the merged-search-results branch, once in the per-tab branch):

```html
              <div class="combater-alt-details">
                {{> actionRows}}
              </div>
```

Change **both** occurrences to:

```html
              <div class="combater-alt-details" {{#if isFavoritesSection}}data-drag-list{{/if}}>
                {{> actionRows}}
              </div>
```

- [ ] **Step 6: Update the CSS**

In `styles\combater.css`, lines 393-404 currently read:

```css
.pf2e-combater .combater-header-step.is-dragging,
.pf2e-combater .combater-step-group.is-dragging,
.pf2e-combater .combater-uncounted-row.is-dragging {
  opacity: 0.4;
}

.pf2e-combater .combater-header-step.drop-target,
.pf2e-combater .combater-step-group.drop-target,
.pf2e-combater .combater-uncounted-row.drop-target {
  outline: 2px dashed var(--combater-focus);
  outline-offset: -2px;
}
```

Change to:

```css
.pf2e-combater .combater-header-step.is-dragging,
.pf2e-combater .combater-step-group.is-dragging,
.pf2e-combater .combater-uncounted-row.is-dragging,
.pf2e-combater .combater-action-row.is-dragging {
  opacity: 0.4;
}

.pf2e-combater .combater-header-step.drop-target,
.pf2e-combater .combater-step-group.drop-target,
.pf2e-combater .combater-uncounted-row.drop-target,
.pf2e-combater .combater-action-row.drop-target {
  outline: 2px dashed var(--combater-focus);
  outline-offset: -2px;
}
```

- [ ] **Step 7: Run the suite and confirm it passes**

Run: `npm test`
Expected: prints `PF2e Combater self-test passed` (exit 0).

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: no errors on the touched files.

- [ ] **Step 9: Manual smoke test**

Per this repo's UI-change convention, launch Foundry, open the Combater panel and its detached action browser, favorite 3+ actions of the same action-cost tab, and drag one favorite onto another — confirm they swap places, the new order survives closing/reopening the browser window, and dragging in a read-only (GM-viewing-player) context shows no drag handle.

- [ ] **Step 10: Commit**

```bash
git add scripts/ui/CombaterPanel.js scripts/ui/CombaterBrowser.js templates/combater-browser.hbs styles/combater.css scripts/engine/self-test.js
git commit -m "feat: drag-to-reorder favorite actions in the action browser"
```
