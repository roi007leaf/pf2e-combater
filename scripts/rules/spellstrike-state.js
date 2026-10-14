import { MODULE_ID } from "../constants.js";

// PF2e doesn't track whether a magus's Spellstrike is spent (its card only notes how to recharge),
// so Combater does: spent when a Spellstrike is posted, recharged by Recharge Spellstrike or by
// casting a conflux spell (a magus focus spell that takes an action). Scoped to the combat it
// happened in: a new encounter starts charged.
const FLAG = "spellstrike";

function currentCombatId() {
  return globalThis.game?.combat?.started ? globalThis.game.combat.id : null;
}

export function spellstrikeExpended(actor) {
  const state = actor?.flags?.[MODULE_ID]?.[FLAG];
  if (state?.expended !== true) return false;
  const combatId = currentCombatId();
  return !state.combatId || !combatId || state.combatId === combatId;
}

export async function setSpellstrikeExpended(actor, expended) {
  if (!actor?.isOwner || typeof actor.setFlag !== "function") return;
  if (spellstrikeExpended(actor) === expended) return;
  await actor.setFlag(MODULE_ID, FLAG, { expended, combatId: currentCombatId() });
}

export function isConfluxSpell(item) {
  if (item?.type !== "spell") return false;
  const traits = item.system?.traits?.value ?? [];
  const actions = String(item.system?.time?.value ?? "");
  return traits.includes("magus") && traits.includes("focus") && /^[123]$/.test(actions);
}

// What a chat message means for Spellstrike: "spend", "recharge" or null.
export function spellstrikeEvent(message) {
  const item = message?.item;
  const slug = String(item?.slug ?? item?.system?.slug ?? "").toLowerCase();
  if (/(^|-)spellstrike$/.test(slug) && !slug.startsWith("recharge")) return "spend";
  if (slug === "recharge-spellstrike") return "recharge";
  if (isConfluxSpell(item)) return "recharge";
  return null;
}

export function registerSpellstrikeHooks() {
  Hooks.on("createChatMessage", (message) => {
    // The posting client records it (it owns the actor that acted).
    if (message?.isAuthor !== true) return;
    const event = spellstrikeEvent(message);
    const actor = message.actor ?? message.item?.actor;
    if (!event || !actor) return;
    setSpellstrikeExpended(actor, event === "spend").catch((error) => {
      console.warn(`${MODULE_ID} | Could not track Spellstrike:`, error);
    });
  });
}
