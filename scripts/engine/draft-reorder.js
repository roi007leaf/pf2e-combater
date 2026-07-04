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
