import { t } from "../../i18n.js";
import { chatActionRevert } from "./chat-revert.js";
import { flushPendingChat, rollActionDamageMessages } from "./damage.js";
import { destinationFromStep, movementOrigin, teleportTokenTo } from "./movement.js";
import { executeOpenItem, spellSlotRevertOp } from "./native-item.js";
import { attachRevertOp, executionPatch } from "./results.js";
import { canvasTokenById, tokenId } from "./targets.js";

export async function executeTeleport({ actor, context, step, action, event, choices, patch = {} }) {
  const destination = destinationFromStep(step, choices);
  if (!destination) return { status: "needs-choice", choices: ["destination"], patch: {} };

  const teleportToken = canvasTokenById(tokenId(context));
  const teleportOrigin = movementOrigin(teleportToken, teleportToken?.document ?? context?.combatant?.token ?? context?.token?.document, context);
  const slotOp = spellSlotRevertOp(actor, action);
  const nativeResult = await executeOpenItem({ actor, action, event });
  if (nativeResult?.spellCast === true && nativeResult?.castFailed === true) {
    const reason = action?.unavailableReason || t("Exec.SpellNoSlot", "Spell could not be cast (no slot available).");
    return {
      status: "failed",
      patch: executionPatch({ ...patch, destination }, "failed", { error: reason }),
      error: reason,
      nativeResult,
    };
  }

  const teleportOp = await teleportTokenTo(context, action, destination, teleportOrigin);
  await flushPendingChat();
  const cardTimestamp = Number(nativeResult?.message?.timestamp);
  const damageMessageIds = await rollActionDamageMessages({
    actor,
    action,
    target: null,
    after: Number.isFinite(cardTimestamp) ? cardTimestamp : null,
  });
  let result = {
    status: "done",
    patch: executionPatch({ ...patch, destination }, "done", {
      result: t("Exec.Teleported", "Teleported to the chosen space."),
      revert: chatActionRevert(nativeResult, action, { slotOp }),
    }),
    nativeResult,
  };
  for (const damageMessageId of [...damageMessageIds].reverse()) {
    result = attachRevertOp(result, { kind: "chat", messageId: damageMessageId });
  }
  if (teleportOp) result = attachRevertOp(result, teleportOp);
  return result;
}
