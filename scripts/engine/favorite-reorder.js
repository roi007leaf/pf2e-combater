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
