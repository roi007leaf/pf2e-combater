// Animater finishers: players pick a finisher per weapon/spell/feat/action from those the GM gave them.
// Animater owns the rules; Combater only offers the choice.
export function animaterFinishers() {
  const mod = globalThis.game?.modules?.get?.("animater");
  return mod?.active && mod.api?.finishers ? mod.api.finishers : null;
}
// Picks play only on items whose actor a player owns (Animater plays the GM's own finishers on
// NPC items), so other items get no picker. The GM sees the finishers of the players who own the
// actor; everyone else sees their own.
export function finisherOptions(item) {
  try {
    const api = animaterFinishers();
    if (!api || !item?.actor) return [];
    const owners = [...(globalThis.game?.users ?? [])].filter((user) => !user.isGM && item.actor.testUserPermission?.(user, "OWNER"));
    if (!owners.length) return [];
    if (!globalThis.game?.user?.isGM) return api.choices(item) ?? [];
    const seen = new Map();
    for (const user of owners) for (const choice of api.choices(item, user) ?? []) if (!seen.has(choice.id)) seen.set(choice.id, choice);
    return [...seen.values()];
  } catch { return []; }
}
export const currentFinisher = (item) => { try { return animaterFinishers()?.getChoice(item) ?? null; } catch { return null; } };
export async function chooseFinisher(item, id) {
  const api = animaterFinishers();
  if (!api) return false;
  try { await api.setChoice(item, id); return true; }
  catch (error) { globalThis.ui?.notifications?.warn?.(error.message); return false; }
}

// Animater fires this only on the client that changed the pick; other clients refresh through
// the panel's updateItem hook when the item's flag changes.
export function initAnimaterIntegration(rerender) {
  if (globalThis.game?.modules?.get?.("animater")?.active !== true) return;
  Hooks.on("animater.finisherChoiceChanged", () => rerender());
}
