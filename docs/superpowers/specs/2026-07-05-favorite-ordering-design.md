# Drag-to-Reorder Favorite Actions — Design

**Source:** Follow-up to the 2026-07-04 plan-step drag-reorder work (`docs/superpowers/specs/2026-07-04-drag-reorder-and-universal-search-design.md`). Same request applied to the action-browser's Favorites section, which currently has no user-controlled order at all.

**Approved answers:** same drag-handle/native-HTML5-DnD UX as plan steps; order is scoped per actor (same storage key as favorite status itself).

## Today

`scripts/state/action-favorites.js` stores favorites as a flat `{ "<user>|<actor>|<actionKey>": true }` map in `localStorage`. `readActionFavorites` returns a `Set` built from `Object.keys(...)` filtered by prefix — since JS preserves insertion order for non-numeric string keys, this already happens to be ordered by *when each action was favorited*, but nothing reads that order today.

`scripts/engine/action-builder.js`'s `decorateAction` computes `favorite: favoriteApplies(favorites, key, baseKey, baseKeyCounts)` — a boolean, true if the favorites set contains either the variant-specific `key` or (when the base action has only one variant) the shared `baseKey`. `buildActionBuilderModel` then sets `tab.favorites = tab.all.filter((action) => action.favorite)` — order falls out of `tab.all`'s existing score-then-name sort, not any favorite-specific order.

`CombaterPanel.js`'s `decorateBuilderTab` renders `tab.favorites` as the `"favorites"` section (always first, in every tab), through the same `actionRows` inline partial (`combater-browser.hbs`) used for every other section (quickened, categorized). The partial has no per-section branching today.

## Approach

No storage format change — the existing map's insertion order is already exactly what's needed, it just needs to become read/write-explicit instead of incidental, and something needs to let the user rewrite that order.

**Data layer (`scripts/engine/favorite-reorder.js`, new):** a pure, unit-testable module mirroring `draft-reorder.js`'s shape but simpler — favorites are a flat list of strings, no group/block concept.

```js
export function reorderFavorites(favoriteKeys, key, targetKey, placeBefore = true) {
  const list = Array.isArray(favoriteKeys) ? favoriteKeys : [];
  const index = list.indexOf(key);
  const targetIndex = list.indexOf(targetKey);
  if (index < 0 || targetIndex < 0 || key === targetKey) return list;
  const without = [...list.slice(0, index), ...list.slice(index + 1)];
  const shift = index < targetIndex ? 1 : 0;
  const insertAt = (placeBefore ? targetIndex : targetIndex + 1) - shift;
  return [...without.slice(0, insertAt), key, ...without.slice(insertAt)];
}
```

**Data layer (`action-favorites.js`):** add `reorderActionFavorite(context, key, targetKey, placeBefore = true)` — reads the current order via `[...readActionFavorites(context)]`, runs it through `reorderFavorites`, and if it actually changed, writes it back with the existing `writeActionFavorites` (which already just re-persists whatever iterable it's given, in that iterable's order — no change needed there). Returns whether anything changed.

**Builder model (`action-builder.js`):** replace the boolean-only `favoriteApplies` with `favoriteEntryKey(favorites, key, baseKey, baseKeyCounts)`, returning the literal string actually present in the favorites set (`key`, `baseKey`, or `null`) instead of just `true`/`false`. `decorateAction` sets `favorite: favoriteEntryKey !== null` and a new `favoriteEntryKey` field carrying that literal string — this is what drag/drop and the reorder call need, since a favorite may be stored under either its variant key or its shared base key, and the two must not be confused. `buildActionBuilderModel` builds `favoriteOrder = [...favoriteSet]` (already insertion-ordered) and sorts `tab.favorites` by `favoriteOrder.indexOf(action.favoriteEntryKey)` instead of leaving it in `tab.all`'s score order. Nothing else changes — `tab.all`, `tab.quickened`, `tab.recommended` keep their existing sort.

**UI model (`CombaterPanel.js`):**
- `decorateBuilderTab`'s favorites section gains `isFavoritesSection: true`; its actions are decorated with `canDragFavorite: true` (every other section's actions leave it unset).
- The local `decorateAction` (template-facing, distinct from the one in `action-builder.js`) gains `canDragFavorite: options.canDragFavorite === true && options.readonly !== true` — hidden whenever the row itself is read-only, same as the plan-step handle.
- New `_reorderFavorite(key, targetKey, placeBefore)` method, gated by `_canEditDraft()` exactly like the existing `_toggleFavorite` — reads `this._context`, calls `reorderActionFavorite`, and if it changed, `await this.render({ force: true })` (which already cascades to the detached browser window per the existing `this._browser?.render(...)` call at the end of `_onRender`).

**Markup (`combater-browser.hbs`):** the shared `actionRows` inline partial gets one addition — a grip-handle span appended after the existing add/add-uncounted buttons, gated on `{{#if canDragFavorite}}`, reusing the plan-step handle's exact markup shape, CSS class (`combater-step-drag`), icon (`fa-grip-vertical`), and localization keys (`PF2E_COMBATER.Panel.DragToReorder`/`DragToReorderAria` — reused as-is, no new lang entries needed, the string is equally true here). The row's `data-drag-row="{{favoriteEntryKey}}"` attribute is likewise gated on `canDragFavorite`, so non-favorite rows are untouched. The favorites section's `.combater-alt-details` container gets `data-drag-list`, gated on `{{#if isFavoritesSection}}`.

Appending the handle after the two action buttons (rather than prepending, where the plan-step handle sits) keeps it out of the row's fixed CSS grid tracks: each `.combater-action-row` is its own independent grid instance, so a 5th child on favorite rows spills into a new implicit column without shifting the 4 fixed tracks non-favorite rows still use.

**Event wiring (`CombaterBrowser.js`):** this file (not `CombaterPanel.js`) owns the browser window's `_onRender` DOM wiring, including the existing `[data-favorite-action]` click handler — the new drag/drop block goes there, as a direct copy of the plan-step `dragstart`/`dragover`/`drop`/`dragend` wiring, scoped per `[data-drag-list]` container (so multiple Favorites blocks — one per tab — can coexist during a cross-tab search without cross-talk), calling `panel._reorderFavorite(draggingId, row.dataset.dragRow, before)` on drop.

**CSS (`combater.css`):** add `.combater-action-row` to the existing `.is-dragging` / `.drop-target-before` / `.drop-target-after` selector groups (currently only `.combater-header-step`, `.combater-step-group`, `.combater-uncounted-row`). No new selectors — `.combater-step-drag`'s hover/color styling is already generic.

## Explicitly not doing

- No reordering in the Quickened or category sections — only Favorites.
- No cross-tab drag — a favorite can only be dropped next to another favorite visible in the same rendered Favorites block (enforced structurally: each `[data-drag-list]` container has its own closured `draggingId`, same as plan steps' per-list scoping).
- No storage format migration — the existing flat map's insertion order was already the right shape, it's just now explicitly read/written instead of incidental.

## Testing

Same source-text-assertion convention as the 2026-07-04 plan (`CombaterPanel`/`CombaterBrowser` are `ApplicationV2` subclasses that can't instantiate under plain Node):

- `favorite-reorder.js`: real `assert.deepEqual` unit tests (reorder before/after a target, no-op on same key, no-op on an unknown key) — same shape as `draft-reorder.js`'s tests, minus the group cases.
- `action-favorites.js`: extend the existing localStorage-mocked block (`self-test.js:3350-3368`) with a multi-favorite scenario exercising `reorderActionFavorite` end to end (favorite three actions, reorder, confirm `readActionFavorites` reflects the new order).
- `buildActionBuilderModel`: a test with `favorites: new Set([...])` containing multiple same-cost actions in a deliberately non-score order, asserting `tab.one.favorites` follows the Set's order rather than score/name.
- Source-text assertions: `panelSource` defines `_reorderFavorite` and gates it the same way as `_toggleFavorite`; `browserSource` wires `dragstart`/`drop` on `[data-drag-favorite]`/`[data-drag-list]` calling `_reorderFavorite`; `panelTemplateSource` (browser half) includes `data-drag-favorite`, `canDragFavorite`, `isFavoritesSection`; `panelStyleSource` includes `.combater-action-row` in the `.is-dragging`/drop-target selectors.
- No engine/planner test changes — this touches only favorites storage, the builder's favorites ordering, and browser UI.
