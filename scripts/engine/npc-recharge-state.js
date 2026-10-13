import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";

// Breath Weapon and friends: "It can't use Breath Weapon again for 1d4 rounds." PF2e keeps no state
// for this (system.frequency is null), so record the round the ability comes back on the actor,
// keyed by item, and gate it until then.
export const NPC_RECHARGE_FLAG = "npcRecharge";

const RECHARGE_PATTERN = /can['’]t [^.]*?\bagain for\b([^.]*?)\brounds?\b/i;
const FORMULA_PATTERN = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\d+)/i;

export function rechargeFormula(item) {
  const text = String(item?.system?.description?.value ?? "");
  const tail = text.match(RECHARGE_PATTERN)?.[1];
  if (!tail) return null;
  return tail.match(FORMULA_PATTERN)?.[1]?.replace(/\s+/g, "") ?? null;
}

function isNpc(actor) {
  return actor?.type === "npc" || actor?.isOfType?.("npc") === true;
}

function rechargeEntry(actor, item) {
  const id = item?.id ?? item?._id;
  if (!id) return null;
  return actor?.flags?.[MODULE_ID]?.[NPC_RECHARGE_FLAG]?.[id] ?? null;
}

// { readyRound, roundsLeft } while the ability is recharging in this combat, else null.
export function rechargeStatus(actor, item, combat = globalThis.game?.combat) {
  if (!isNpc(actor) || !rechargeFormula(item)) return null;
  const entry = rechargeEntry(actor, item);
  if (!entry || !combat || entry.combatId !== combat.id) return null;
  const roundsLeft = Number(entry.readyRound) - (Number(combat.round) || 0);
  return roundsLeft > 0 ? { readyRound: Number(entry.readyRound), roundsLeft } : null;
}

export function rechargeLabel(status) {
  if (!status) return "";
  return status.roundsLeft === 1
    ? t("Recharge.OneRoundLeft", "Recharging: 1 round left")
    : t("Recharge.RoundsLeft", "Recharging: {count} rounds left", { count: status.roundsLeft });
}

export function rechargeAvailability(actor, item, combat = globalThis.game?.combat) {
  const status = rechargeStatus(actor, item, combat);
  if (!status) return { available: true, reason: "" };
  return { available: false, reason: rechargeLabel(status), recharge: status };
}

// Every ability this actor has recharging in the current combat, for the effect clock.
export function rechargeEntries(actor, combat = globalThis.game?.combat) {
  const stored = actor?.flags?.[MODULE_ID]?.[NPC_RECHARGE_FLAG] ?? {};
  return Object.keys(stored).flatMap((id) => {
    const item = actor?.items?.get?.(id);
    const status = item ? rechargeStatus(actor, item, combat) : null;
    return status ? [{ item, ...status }] : [];
  });
}

// After an NPC uses a recharge ability: roll the delay (privately, like the GM's own
// [[/gmr 1d4]]) and remember when it's back. Counted from the combat's current round, so an
// encounter that hasn't started yet (round 0) still blocks it until round N.
export async function recordRechargeUse(actor, item, combat = globalThis.game?.combat) {
  const formula = rechargeFormula(item);
  if (!isNpc(actor) || !formula || !combat || typeof actor?.setFlag !== "function") return null;
  const RollClass = globalThis.Roll;
  if (typeof RollClass !== "function") return null;
  const roll = await new RollClass(formula).evaluate();
  const rounds = Math.max(1, Number(roll.total) || 1);
  const readyRound = (Number(combat.round) || 0) + rounds;
  const id = item.id ?? item._id;
  await actor.setFlag(MODULE_ID, `${NPC_RECHARGE_FLAG}.${id}`, { combatId: combat.id, readyRound, rounds });
  try {
    await globalThis.ChatMessage?.create?.({
      content: t("Chat.Recharge", "{item} recharges in {rounds} rounds (usable again on round {round}).", { item: item.name, rounds, round: readyRound }),
      whisper: globalThis.ChatMessage?.getWhisperRecipients?.("GM")?.map((user) => user.id) ?? [],
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }),
    });
  } catch (_error) {
    // The flag is what matters; the note is a courtesy.
  }
  return { readyRound, rounds };
}

// Track it however the ability was used (Combater, the sheet, a macro): PF2e posts the ability's
// own card (not a roll) with the item attached. Only the client that posted it records.
export function registerRechargeTracking() {
  globalThis.Hooks?.on?.("createChatMessage", (message, _options, userId) => {
    if (userId !== globalThis.game?.user?.id || message?.isRoll) return;
    const item = message?.item;
    const actor = message?.actor ?? item?.actor;
    if (!item || !isNpc(actor) || !rechargeFormula(item)) return;
    recordRechargeUse(actor, item).catch((error) => console.warn(`${MODULE_ID} | Recharge tracking failed`, error));
  });
}
