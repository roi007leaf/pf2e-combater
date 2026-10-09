import { actionSlug, requiresDestinationForAction, requiresTargetForAction } from "./requirements.js";
import { contextActorDocument } from "../actor-context.js";
import { readMovementAvailability } from "../../readers/generic-action-reader.js";
import { readConditions } from "../../readers/actor-profile.js";
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
import { preparePlannedSummon, validateSummonPlan } from "../../integrations/summons-assistant.js";

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
  // Draft projection assumes Escape succeeds; execution must use the actor's live conditions.
  const movementContext = actor?.itemTypes?.condition
    ? { ...context, profile: { ...(context?.profile ?? context?.actor?.profile ?? {}), conditions: readConditions(actor) } }
    : context;
  const movementAvailability = readMovementAvailability(movementContext, resolvedAction);
  if (!movementAvailability.available) {
    const error = movementAvailability.reason;
    return { status: "failed", patch: executionPatch({}, "failed", { error }), error };
  }
  if (step.summonPlan && !await validateSummonPlan(context, resolvedAction, step.summonPlan)) {
    const error = t("Summon.PlanInvalid", "Summon plan is unavailable or out of range. Choose creature and placement again.");
    return { status: "failed", patch: executionPatch({}, "failed", { error }), error };
  }
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
  let plannedSummon = null;
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
    if (step.summonPlan) {
      try {
        plannedSummon = await preparePlannedSummon(actor, resolvedAction, step.summonPlan);
      } catch (error) {
        return { status: "failed", patch: executionPatch(patch, "failed", { error: error.message }), error: error.message };
      }
    }
    try {
      result = await executeNativeAction({
        actor,
        action: resolvedAction,
        event,
        target,
        patch,
        trackSustainedSpell: !regionOp?.effectUuid,
      });
    } catch (error) {
      plannedSummon?.dispose();
      throw error;
    }
  }

  if (step.summonPlan && result?.status === "done") {
    // Casting already spent its resource. A cancelled/failed summon must never
    // mark the spell retryable and accidentally consume a second slot.
    let warning = t("Summon.ManualUndo", "Remove the summoned creature manually when undoing this spell.");
    try {
      await plannedSummon.finish(result);
    } catch (_error) {
      warning = t("Summon.FinishManually", "Spell already cast. Finish summoning from its chat card; do not cast again.");
      globalThis.ui?.notifications?.warn?.(warning);
      result.patch.execution.result = warning;
    } finally {
      plannedSummon?.dispose();
    }
    const revert = result.patch.execution.revert ?? { ops: [], manualWarnings: [] };
    result.patch.execution.revert = { ...revert, manualWarnings: [...(revert.manualWarnings ?? []), warning] };
  }

  plannedSummon?.dispose();

  return attachRevertOp(result, regionOp);
}
