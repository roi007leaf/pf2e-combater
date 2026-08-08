function isNpcActor(actor) {
  return actor?.type === "npc" || actor?.isOfType?.("npc") === true;
}

export function selectedNpcTacticTokens(controlled = globalThis.canvas?.tokens?.controlled ?? []) {
  const selected = [];
  const seen = new Set();
  for (const placeable of Array.isArray(controlled) ? controlled : []) {
    const token = placeable?.document ?? placeable;
    const actor = placeable?.actor ?? token?.actor;
    if (!token || !isNpcActor(actor)) continue;
    const key = token.uuid ?? token.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(token);
  }
  return selected;
}
