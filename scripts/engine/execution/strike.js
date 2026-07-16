import { t } from "../../i18n.js";
import { chatActionRevert } from "./chat-revert.js";
import { attachRevertOp, executionPatch } from "./results.js";
import { resolveTarget, setTarget } from "./targets.js";
import { setNpcWeaponLoaded } from "../npc-reload-state.js";

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function strikeVariantIndex(step, action, choices = {}) {
  if (Number.isFinite(choices?.variantIndex)) return Math.max(0, Math.min(2, choices.variantIndex));
  if (Number.isFinite(step?.mapOverride)) return Math.max(0, Math.min(2, step.mapOverride));
  const attackIndex = numeric(step?.attackIndex ?? action?.attackIndex, null);
  return Number.isFinite(attackIndex) && attackIndex > 1 ? Math.min(2, attackIndex - 1) : 0;
}

function strikeVariant(action, index) {
  const variants = Array.isArray(action?.variants) ? action.variants : [];
  return variants[index] ?? null;
}

export async function executeStrike({ actor, step, action, event, choices = {} }) {
  const target = resolveTarget(step, action, choices);
  if (!target) return { status: "needs-choice", choices: ["target"], patch: {} };
  setTarget(target.token);

  const variant = strikeVariant(action, strikeVariantIndex(step, action, choices));
  const roller = variant?.roll ?? action?.strike?.roll ?? action?.attack ?? action?.roll;
  if (typeof roller !== "function") {
    return {
      status: "failed",
      patch: executionPatch({ targetTokenIds: [target.id], targetLabel: target.label }, "failed", { error: t("Exec.NoStrikeApi", "Strike roll API is not available.") }),
      error: t("Exec.NoStrikeApi", "Strike roll API is not available."),
    };
  }
  // PF2e reads strike targets from game.user.targets after setTarget, matching sheet strike clicks.
  const result = await roller.call(variant ?? action?.strike ?? action, { event });
  const execution = {
    status: "done",
    patch: executionPatch({ targetTokenIds: [target.id], targetLabel: target.label }, "done", {
      result: t("Exec.StrikeOpened", "Strike roll opened."),
      revert: chatActionRevert(result, action, { target }),
    }),
    nativeResult: result,
  };
  const reloadStateOp = await setNpcWeaponLoaded(actor, action, false);
  return attachRevertOp(execution, reloadStateOp);
}
