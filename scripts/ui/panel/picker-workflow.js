import { readDraftPlan } from "../../state/draft-plans.js";
import { projectContextForDraftStepOrigin } from "../../engine/action/builder.js";
import { tokensInAreaMarker } from "../../engine/area/region.js";
import {
  currentTargetSelection,
  plannedTargetSelection,
  setTokenTargets,
  targetTokenId,
} from "../../engine/action/executor.js";
import { clearActionPreview } from "../action/preview.js";
import { showMovementPreview, showHoverGhost } from "../movement-preview.js";
import { cancelDestinationPicker, chooseDestination } from "../destination-picker.js";
import { cancelAreaPicker, chooseAreaMarker } from "../area-picker.js";
import { clearRangeOverlay, showRangeOverlay, updateRangePlacement } from "../range-overlay.js";
import { t } from "../../i18n.js";

function escapeHtml(value) {
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

export function cancelPanelPickers(panel) {
  panel._destinationPicker = null;
  panel._areaPicker = null;
  cancelDestinationPicker();
  cancelAreaPicker();
  clearRangeOverlay();
}

export function clearActionPreviewUnlessPicking(panel, event) {
  if (panel._destinationPicker || panel._areaPicker) return;
  const element = event?.currentTarget?.closest?.(".pf2e-combater") ?? panel.element;
  // Keep the canvas overlay alive while the cursor moves onto the canvas/tokens, or when
  // the pointer interaction is cancelled (relatedTarget is null). Only clear it when the
  // cursor moves to another control inside the panel.
  const related = event?.relatedTarget ?? null;
  if (!related || !element?.contains?.(related)) return;
  clearActionPreview();
}

export function draftForOrigin(panel) {
  return panel._builder?.draft ?? readDraftPlan(panel._context);
}

export function contextForDraftStep(panel, instanceId) {
  return projectContextForDraftStepOrigin(panel._context, draftForOrigin(panel), instanceId);
}

// The persistent reachable-area grid -- drawn once when the picker starts, and again after a real
// click commits a waypoint/destination (to show remaining budget), but NEVER for a mere hover.
export function showDestinationPickerPreview(panel, instanceId = panel._destinationPicker?.instanceId) {
  if (panel._destinationPicker?.minion === true) {
    const picker = panel._destinationPicker;
    if (instanceId !== picker.instanceId || !picker.context || !picker.action) return false;
    const preview = picker.preview ?? {};
    showMovementPreview(picker.context, {
      ...picker.action,
      ...(preview.destination ? { destination: preview.destination } : {}),
      ...(preview.movementPlan ? { movementPlan: preview.movementPlan } : {}),
      ...(Number.isFinite(preview.elevation) ? { plannedElevation: preview.elevation } : {}),
      requiresDestination: true,
    });
    return true;
  }
  const step = panel._findDraftStep(instanceId);
  if (!panel._context || !step) return false;
  const preview = panel._destinationPicker?.instanceId === instanceId ? panel._destinationPicker.preview : null;

  showMovementPreview(contextForDraftStep(panel, instanceId), {
    ...(step.action ?? step),
    ...(preview?.destination ? { destination: preview.destination } : {}),
    ...(preview?.movementPlan ? { movementPlan: preview.movementPlan } : {}),
    ...(Number.isFinite(preview?.elevation) ? { plannedElevation: preview.elevation } : {}),
    requiresDestination: true,
  });
  return true;
}

// The cursor-following ghost/cost overlay -- independent of the larger persistent grid.
export function showPanelHoverGhost(panel, instanceId, destination, metadata = {}) {
  const step = panel._findDraftStep(instanceId);
  if (!panel._context || !step || !destination) return false;
  showHoverGhost(contextForDraftStep(panel, instanceId), {
    ...(step.action ?? step),
    requiresDestination: true,
    ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}),
  }, destination);
  return true;
}

export function restoreDestinationPickerPreview(panel) {
  if (!panel._destinationPicker?.instanceId) return;
  if (panel._destinationPicker.native) return;
  showDestinationPickerPreview(panel, panel._destinationPicker.instanceId);
}

export function stepWithRetryReset(step, patch) {
  const execution = step?.execution?.status === "failed" ? { status: "pending" } : step?.execution;
  return {
    ...step,
    ...patch,
    ...(execution ? { execution } : {}),
  };
}

export function choosePanelDestination(panel, instanceId) {
  if (!panel._canExecuteDraft()) return;
  if (panel._destinationPicker?.instanceId === instanceId) {
    cancelPanelPickers(panel);
    clearActionPreview();
    return;
  }
  const step = panel._findDraftStep(instanceId);
  if (!panel._context || !step) return;
  cancelPanelPickers(panel);
  panel._destinationPicker = { instanceId, native: false };

  const picker = chooseDestination({
    context: contextForDraftStep(panel, instanceId),
    action: step.action ?? step,
    enableWaypoints: true,
    onPreview: (destination, metadata = {}) => {
      if (metadata.hoverOnly) {
        showPanelHoverGhost(panel, instanceId, destination, metadata);
        return;
      }
      panel._destinationPicker = {
        ...(panel._destinationPicker ?? {}),
        instanceId,
        native: false,
        preview: {
          destination,
          movementPlan: metadata.movementPlan ?? null,
          elevation: metadata.elevation,
        },
      };
      showDestinationPickerPreview(panel, instanceId);
    },
    onCancel: () => {
      panel._destinationPicker = null;
      clearActionPreview();
    },
    onChoose: async (destination, metadata = {}) => {
      const current = panel._findActiveStep(instanceId) ?? step;
      await panel._persistActiveDraftStep(stepWithRetryReset(current, {
        destination,
        ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}),
      }));
      panel._destinationPicker = null;
      clearActionPreview();
      await panel.render({ force: true });
    },
  });
  if (!picker) {
    panel._destinationPicker = null;
    clearActionPreview();
    globalThis.ui?.notifications?.warn?.(t("Notify.NoDestinationPicker", "Canvas destination picker is not available."));
    return;
  }
  panel._destinationPicker = { instanceId, native: picker.native === true };
  if (!picker.native) showDestinationPickerPreview(panel, instanceId);
}

export async function choosePanelTarget(panel, instanceId, { useBestTarget = false } = {}) {
  if (!panel._canExecuteDraft()) return;
  const step = panel._findDraftStep(instanceId);
  if (!panel._context || !step) return;
  cancelPanelPickers(panel);
  const current = panel._findActiveStep(instanceId) ?? step;
  const selection = useBestTarget
    ? plannedTargetSelection(current)
    : currentTargetSelection();
  if (!selection.targetTokenIds.length) {
    globalThis.ui?.notifications?.warn?.(useBestTarget
      ? t("Notify.NoBestTarget", "No Best target is available for this action.")
      : t("Notify.TargetFirst", "Target a token in Foundry first."));
    return;
  }
  await panel._persistActiveDraftStep(stepWithRetryReset(current, {
    targetTokenIds: selection.targetTokenIds,
    targetLabel: selection.targetLabel,
    targetSelection: useBestTarget ? "recommended" : "manual",
  }));
  await panel.render({ force: true });
}

export async function removePanelAreaTemplate(panel, instanceId) {
  if (!panel._canExecuteDraft() || !panel._context) return;
  const current = panel._findActiveStep(instanceId);
  if (!current?.areaMarker) return;
  cancelPanelPickers(panel);

  const isDone = current.execution?.status === "done";
  if (isDone) {
    const regionOp = (current.execution.revert?.ops ?? []).find((op) => op.kind === "region" && op.regionId);
    if (regionOp) {
      try {
        if (regionOp.effectUuid && typeof globalThis.fromUuid === "function") {
          const effect = await globalThis.fromUuid(regionOp.effectUuid);
          if (effect?.id && effect?.parent?.items?.get?.(effect.id) && typeof effect.delete === "function") {
            await effect.delete();
          }
        }
        const scene = globalThis.game?.scenes?.get?.(regionOp.sceneId) ?? globalThis.canvas?.scene;
        if (scene?.regions?.get?.(regionOp.regionId) && typeof scene.deleteEmbeddedDocuments === "function") {
          await scene.deleteEmbeddedDocuments("Region", [regionOp.regionId]);
        }
      } catch (_error) {
        globalThis.ui?.notifications?.warn?.(t("Notify.RemoveTemplateFailed", "Could not remove the placed template region."));
      }
    }
    const revert = current.execution.revert;
    const ops = (revert?.ops ?? []).filter((op) => op.kind !== "region");
    await panel._persistActiveDraftStep({
      ...current,
      areaMarker: null,
      targetTokenIds: [],
      execution: { ...current.execution, ...(revert ? { revert: { ...revert, ops } } : {}) },
    });
  } else {
    await panel._persistActiveDraftStep(stepWithRetryReset(current, { areaMarker: null, targetTokenIds: [] }));
  }
  clearActionPreview();
  await panel.render({ force: true });
}

export async function pickAreaTemplate(templates) {
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialog?.wait !== "function") return templates[0] ?? null;
  const buttons = templates.map((template, index) => ({
    action: String(index),
    label: template.label ?? `${template.type} ${template.distance ?? ""} ft`.trim(),
  }));
  const choice = await dialog.wait({
    window: { title: t("Dialog.ChooseTemplate.Title", "Choose template") },
    content: `<p>${escapeHtml(t("Dialog.ChooseTemplate.Content", "This action has more than one area template. Choose which to place:"))}</p>`,
    buttons: [...buttons, { action: "cancel", label: t("Dialog.Cancel", "Cancel") }],
    rejectClose: false,
  }).catch(() => null);
  if (choice === null || choice === undefined || choice === "cancel") return null;
  return templates[Number(choice)] ?? null;
}

export async function choosePanelArea(panel, instanceId) {
  if (!panel._canExecuteDraft()) {
    globalThis.ui?.notifications?.warn?.(t("Notify.ReadOnly", "This draft is read-only."));
    return;
  }
  const step = panel._findDraftStep(instanceId);
  if (!panel._context || !step) {
    globalThis.ui?.notifications?.warn?.(t("Notify.NoAreaStep", "No draft step is available for area placement."));
    return;
  }
  const action = step.action ?? step;
  const templates = action?.targetingProfile?.templates ?? [];
  let placementAction = action;
  if (templates.length > 1) {
    const chosen = await pickAreaTemplate(templates);
    if (!chosen) return;
    placementAction = {
      ...action,
      targetingProfile: {
        ...(action.targetingProfile ?? {}),
        type: chosen.type,
        shape: chosen.type,
        distance: chosen.distance,
        ...(chosen.width ? { width: chosen.width } : {}),
        templates: undefined,
      },
    };
  }

  const reachBonus = panel._draftRangeBonus(instanceId);
  if (reachBonus > 0) placementAction = { ...placementAction, rangeBonusFeet: reachBonus };

  cancelPanelPickers(panel);
  panel._areaPicker = { instanceId };
  globalThis.ui?.notifications?.info?.(t("Notify.PlaceAreaCanvas", "Place the area template on the canvas."));
  showRangeOverlay(contextForDraftStep(panel, instanceId), placementAction);

  const picker = chooseAreaMarker({
    context: contextForDraftStep(panel, instanceId),
    action: placementAction,
    onMove: (marker) => updateRangePlacement(marker?.center),
    onCancel: () => {
      panel._areaPicker = null;
      clearRangeOverlay();
    },
    onChoose: async (areaMarker) => {
      const current = panel._findActiveStep(instanceId) ?? step;
      const inside = tokensInAreaMarker({
        context: contextForDraftStep(panel, instanceId),
        action: placementAction,
        marker: areaMarker,
      });
      setTokenTargets(inside);
      const targetTokenIds = inside.map((token) => targetTokenId(token)).filter(Boolean);
      await panel._persistActiveDraftStep(
        stepWithRetryReset(current, { areaMarker, ...(targetTokenIds.length ? { targetTokenIds } : {}) }),
      );
      panel._areaPicker = null;
      clearRangeOverlay();
      await panel.render({ force: true });
    },
  });
  if (!picker) {
    panel._areaPicker = null;
    clearRangeOverlay();
    globalThis.ui?.notifications?.warn?.(t("Notify.NoAreaPicker", "Canvas area picker is not available."));
  }
}
