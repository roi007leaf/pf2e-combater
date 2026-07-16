import { actionSlug, requiresDestinationForAction, requiresTargetForAction } from "./requirements.js";
import { contextActorDocument } from "../actor-context.js";
import { prepareAreaExecution } from "../execution/area.js";
import {
  destinationFromStep,
  executeMovement,
  isTeleportAction,
} from "../execution/movement.js";
import {
  executeDrawWeapon,
  executeDropWeapon,
  executeReloadWeapon,
  executeSheatheWeapon,
  executeSwapItems,
} from "../execution/equipment.js";
import { executeDropProne, executeRetch, executeStand } from "../execution/conditions.js";
import { executeNativeAction } from "../execution/native-item.js";
import { executeSystemAction } from "../execution/system-action.js";
import { executeStrike } from "../execution/strike.js";
import { executeSustainSpell } from "../execution/sustain.js";
import { executeTeleport } from "../execution/teleport.js";
import {
  resolveTarget,
} from "../execution/targets.js";
import { attachRevertOp, executionPatch } from "../execution/results.js";
import { executionAction } from "../execution/state.js";
import { t } from "../../i18n.js";

export { canvasTokenById, currentTargetSelection, plannedTargetSelection, setTokenTargets, targetTokenId, tokenId } from "../execution/targets.js";
export { executionReadinessForStep, nextPendingExecutionStep, resetDraftExecution } from "../execution/state.js";

export function actorDocument(context) {
  return contextActorDocument(context, { allowActorFallback: true });
}

export async function executeDraftStep({ context, step, action = step?.action ?? step, event = null, choices = {} } = {}) {
  if (!step || !action) return { status: "failed", patch: executionPatch({}, "failed", { error: t("Exec.NoActionSelected", "No action selected.") }), error: t("Exec.NoActionSelected", "No action selected.") };

  const resolvedAction = executionAction(step, action);
  const actor = actorDocument(context);
  const slug = actionSlug(resolvedAction);
  let patch = {};
  const destination = destinationFromStep(step, choices);
  if (destination) patch.destination = destination;

  const target = requiresTargetForAction(resolvedAction) ? resolveTarget(step, resolvedAction, choices) : null;
  if (requiresTargetForAction(resolvedAction)) {
    if (!target) return { status: "needs-choice", choices: ["target"], patch };
    patch.targetTokenIds = [target.id];
    patch.targetLabel = target.label;
  }

  let regionOp = null;
  const areaExecution = await prepareAreaExecution({ context, action: resolvedAction, step, choices, target, patch });
  if (areaExecution.status === "needs-choice") return areaExecution;
  patch = areaExecution.patch;
  regionOp = areaExecution.regionOp;

  let result;
  if (isTeleportAction(resolvedAction)) {
    result = await executeTeleport({ actor, context, step, action: resolvedAction, event, choices, patch });
  } else if (requiresDestinationForAction(resolvedAction)) {
    result = await executeMovement({ context, step, action: resolvedAction, choices });
  } else if (slug === "stand") {
    result = await executeStand(actor);
  } else if (slug === "drop-prone") {
    result = await executeDropProne(actor);
  } else if (slug === "sustain-a-spell") {
    result = await executeSustainSpell({ actor, step, action: resolvedAction });
  } else if (slug === "retch") {
    result = await executeRetch({ actor, context, action: resolvedAction, event, choices });
  } else if (resolvedAction?.executable === "draw-weapon") {
    result = await executeDrawWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "drop-weapon") {
    result = await executeDropWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "sheathe-weapon") {
    result = await executeSheatheWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "swap-items") {
    result = await executeSwapItems({ actor, choices });
  } else if (resolvedAction?.executable === "reload-weapon") {
    result = await executeReloadWeapon({ actor, action: resolvedAction });
  } else if (resolvedAction?.executable === "strike" || resolvedAction?.source === "strike") {
    result = await executeStrike({ actor, step, action: resolvedAction, event, choices });
  } else if (slug === "seek" || resolvedAction?.executable === "pf2e-action") {
    result = await executeSystemAction({ actor, step, action: resolvedAction, event, choices });
  } else {
    result = await executeNativeAction({
      actor,
      action: resolvedAction,
      event,
      target,
      patch,
      trackSustainedSpell: !regionOp?.effectUuid,
    });
  }

  return attachRevertOp(result, regionOp);
}
