// Pure array swap for drag-and-drop: trades the positions of the step at `instanceId` and the
// step at `targetInstanceId`, leaving everything else untouched. Grouped composite steps (shared
// `groupId`, e.g. both Strikes of a Double Attack) are always contiguous -- both sides of the swap
// are expanded to their full group block first, so a drag can't split a group apart.
export function swapDraftSteps(steps, instanceId, targetInstanceId) {
  const list = Array.isArray(steps) ? steps : [];
  const index = list.findIndex((step) => step.instanceId === instanceId);
  const targetIndex = list.findIndex((step) => step.instanceId === targetInstanceId);
  if (index < 0 || targetIndex < 0 || instanceId === targetInstanceId) return list;

  const blockRange = (i) => {
    const groupId = list[i]?.groupId;
    if (!groupId) return [i, i + 1];
    const start = list.findIndex((step) => step.groupId === groupId);
    let end = start + 1;
    while (end < list.length && list[end]?.groupId === groupId) end += 1;
    return [start, end];
  };

  const [aStart, aEnd] = blockRange(index);
  const [bStart, bEnd] = blockRange(targetIndex);
  // Dropping onto a member of the block being dragged is a no-op.
  if (targetIndex >= aStart && targetIndex < aEnd) return list;

  const [firstStart, firstEnd, secondStart, secondEnd] = aStart < bStart
    ? [aStart, aEnd, bStart, bEnd]
    : [bStart, bEnd, aStart, aEnd];
  const firstBlock = list.slice(firstStart, firstEnd);
  const secondBlock = list.slice(secondStart, secondEnd);
  return [
    ...list.slice(0, firstStart),
    ...secondBlock,
    ...list.slice(firstEnd, secondStart),
    ...firstBlock,
    ...list.slice(secondEnd),
  ];
}
