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

export function rechargeAvailability(actor, item, combat = globalThis.game?.combat) {
  if (!isNpc(actor) || !rechargeFormula(item)) return { available: true, reason: "" };
  const entry = rechargeEntry(actor, item);
  if (!entry || !combat || entry.combatId !== combat.id) return { available: true, reason: "" };
  const round = Number(combat.round) || 0;
  if (round >= Number(entry.readyRound)) return { available: true, reason: "" };
  return {
    available: false,
    reason: t("Avail.Recharging", "Recharging: usable again on round {round}.", { round: entry.readyRound }),
  };
}

// After an NPC uses a recharge ability in combat: roll the delay (privately, like the GM's own
// [[/gmr 1d4]]) and remember when it's back.
export async function recordRechargeUse(actor, item, combat = globalThis.game?.combat) {
  const formula = rechargeFormula(item);
  if (!isNpc(actor) || !formula || !combat?.started || typeof actor?.setFlag !== "function") return null;
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
