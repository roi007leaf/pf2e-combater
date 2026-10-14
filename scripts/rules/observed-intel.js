import { MODULE_ID } from "../constants.js";
import { SETTINGS, settingOrDefault } from "../settings.js";
import { INTEL_LEDGER_FLAG, intelAbilityFactId, intelFactId, normalizeIntelLedger } from "./intel-ledger.js";

// What the party sees an enemy do, it knows: a Strike it makes, a reaction it takes (Reactive Strike),
// an ability it uses in the open. Recorded in that creature's Intel like a Recall Knowledge answer, so
// planning stops treating a Reactive Strike it already watched land as unknown.

// The Intel category and fact a chat message reveals, or null.
export function observedIntelFact(message) {
  const item = message?.item;
  const actor = message?.actor ?? item?.actor;
  if (!item || actor?.type !== "npc") return null;
  const contextType = String(message?.flags?.pf2e?.context?.type ?? "");
  if (item.type === "melee" || contextType === "attack-roll") {
    return { actor, category: "strikes", factId: intelFactId(item.name) };
  }
  if (item.type !== "action") return null;
  const actionType = String(item.system?.actionType?.value ?? "").toLowerCase();
  if (actionType === "passive") return null;
  // A reaction happens in plain view (the ogre swings as you move past); other abilities only count
  // when the message wasn't kept to the GM.
  const visible = actionType === "reaction" || !(Array.isArray(message?.whisper) && message.whisper.length) && message?.blind !== true;
  return visible ? { actor, category: "actions", factId: intelAbilityFactId(item.name) } : null;
}

export async function recordObservedIntel(actor, category, factId) {
  if (!actor || !factId || typeof actor.setFlag !== "function") return false;
  const ledger = normalizeIntelLedger(actor.getFlag?.(MODULE_ID, INTEL_LEDGER_FLAG));
  const current = ledger[category];
  if (current === true || (Array.isArray(current) && current.includes(factId))) return false;
  const raw = actor.getFlag?.(MODULE_ID, INTEL_LEDGER_FLAG) ?? {};
  await actor.setFlag(MODULE_ID, INTEL_LEDGER_FLAG, { ...raw, [category]: [...(Array.isArray(current) ? current : []), factId] });
  return true;
}

export function registerObservedIntelHooks() {
  Hooks.on("createChatMessage", (message) => {
    // One writer: the active GM's client.
    if (game.user?.isActiveGM !== true) return;
    if (!settingOrDefault(SETTINGS.learnObservedIntel, true)) return;
    if (!game.combat?.started) return;
    const observed = observedIntelFact(message);
    if (!observed) return;
    const facts = [observed];
    // A Strike rolled outside the creature's own turn is a reaction: if it has Reactive Strike (or
    // Attack of Opportunity), the party just watched it.
    if (observed.category === "strikes" && game.combat.combatant?.actor?.id !== observed.actor.id) {
      const reaction = observed.actor.itemTypes?.action?.find((item) => /^(reactive strike|attack of opportunity)$/i.test(String(item.name ?? "")));
      if (reaction) facts.push({ actor: observed.actor, category: "actions", factId: intelAbilityFactId(reaction.name) });
    }
    (async () => {
      for (const fact of facts) await recordObservedIntel(fact.actor, fact.category, fact.factId);
    })().catch((error) => {
      console.warn(`${MODULE_ID} | Could not record observed Intel:`, error);
    });
  });
}
