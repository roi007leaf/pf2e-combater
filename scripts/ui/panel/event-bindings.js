import { SETTINGS, settingOrDefault } from "../../settings.js";

export function activatePanelRenderBindings(panel, element) {
  if (!element) return;

  panel._activateDrag(element);
  panel._activateActionListScrollPerformance(element);

  element.querySelector("[data-action='toggle-browser']")
    ?.addEventListener("click", () => panel._toggleBrowser());
  element.querySelector("[data-action='toggle-compact']")
    ?.addEventListener("click", () => panel._setExpanded(!panel.expanded));
  element.querySelector("[data-action='refresh']")
    ?.addEventListener("click", () => panel.refresh("button"));

  // Cost tabs, search, and the action add/favorite/open controls live in the detached
  // browser window now (see CombaterBrowser); the panel only wires plan-side controls.
  for (const button of element.querySelectorAll("[data-add-sustain-spell]")) {
    button.addEventListener("click", () => panel._addSustainSpell(button.dataset.addSustainSpell));
  }

  for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
    button.addEventListener("click", () => panel._removeDraftStep(button.dataset.removeDraftStep));
  }

  for (const button of element.querySelectorAll("[data-duplicate-draft-step]")) {
    button.addEventListener("click", () => panel._duplicateDraftStep(button.dataset.duplicateDraftStep));
  }

  for (const button of element.querySelectorAll("[data-cycle-map]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._cycleStepMap(button.dataset.cycleMap);
    });
  }

  for (const button of element.querySelectorAll("[data-cycle-movement]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._cycleStepMovement(button.dataset.cycleMovement);
    });
  }
  for (const button of element.querySelectorAll("[data-cycle-weapon]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._cycleStepWeapon(button.dataset.cycleWeapon);
    });
  }

  activateDraftDragBindings(panel, element);

  for (const button of element.querySelectorAll("[data-auto-fill]")) {
    button.addEventListener("click", () => panel._autoFillDraft());
  }

  for (const button of element.querySelectorAll("[data-cycle-auto-fill]")) {
    button.addEventListener("click", () => panel._cycleAutoFillDraft());
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      panel._cycleAutoFillDraft(-1);
    });
  }

  for (const button of element.querySelectorAll("[data-reset-execution]")) {
    button.addEventListener("click", () => panel._resetExecution());
  }

  for (const button of element.querySelectorAll("[data-revert-step]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._revertDraftStep(button.dataset.revertStep);
    });
  }

  for (const button of element.querySelectorAll("[data-execute-draft-step]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      panel._executeDraftStep(button.dataset.executeDraftStep, event);
    });
  }

  for (const button of element.querySelectorAll("[data-choose-destination]")) {
    button.addEventListener("click", () => panel._chooseDestination(button.dataset.chooseDestination));
  }

  for (const button of element.querySelectorAll("[data-choose-target]")) {
    button.addEventListener("click", () => panel._chooseTarget(button.dataset.chooseTarget));
  }

  for (const button of element.querySelectorAll("[data-choose-area]")) {
    button.addEventListener("click", () => panel._chooseArea(button.dataset.chooseArea));
  }

  for (const button of element.querySelectorAll("[data-remove-area]")) {
    button.addEventListener("click", () => panel._removeAreaTemplate(button.dataset.removeArea));
  }

  for (const button of element.querySelectorAll("[data-open-draft-step]")) {
    button.addEventListener("click", () => panel._openDraftStep(button.dataset.openDraftStep));
  }

  for (const button of element.querySelectorAll("[data-open-draft-group]")) {
    button.addEventListener("click", () => panel._openDraftGroup(button.dataset.openDraftGroup));
  }

  for (const button of element.querySelectorAll("[data-execute-step]")) {
    button.addEventListener("click", () => panel.executeStep(Number(button.dataset.executeStep)));
  }

  for (const previewElement of element.querySelectorAll("[data-preview-step]")) {
    previewElement.addEventListener("pointerenter", () => panel._showActionPreview(previewElement));
    previewElement.addEventListener("pointerleave", (event) => panel._clearActionPreviewUnlessPicking(event));
    previewElement.addEventListener("pointercancel", (event) => panel._clearActionPreviewUnlessPicking(event));
  }

  for (const previewElement of element.querySelectorAll("[data-preview-draft-step]")) {
    previewElement.addEventListener("pointerenter", () => panel._showDraftActionPreview(previewElement));
    previewElement.addEventListener("pointerleave", (event) => panel._clearActionPreviewUnlessPicking(event));
    previewElement.addEventListener("pointercancel", (event) => panel._clearActionPreviewUnlessPicking(event));
  }

  if (settingOrDefault(SETTINGS.rememberPanelPosition, true)) {
    element.addEventListener("pointerup", () => panel._savePosition(), { passive: true });
  }
}

function activateDraftDragBindings(panel, element) {
  for (const container of element.querySelectorAll("[data-drag-list]")) {
    let draggingId = null;
    for (const handle of container.querySelectorAll("[data-drag-draft-step]")) {
      handle.addEventListener("dragstart", (event) => {
        draggingId = handle.dataset.dragDraftStep;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggingId);
        handle.closest("[data-drag-row]")?.classList.add("is-dragging");
      });
      handle.addEventListener("dragend", () => {
        draggingId = null;
        for (const row of container.querySelectorAll(".is-dragging, .drop-target")) {
          row.classList.remove("is-dragging", "drop-target");
        }
      });
    }
    for (const row of container.querySelectorAll("[data-drag-row]")) {
      row.addEventListener("dragover", (event) => {
        if (!draggingId) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.add("drop-target");
      });
      row.addEventListener("dragleave", (event) => {
        event.stopPropagation();
        row.classList.remove("drop-target");
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("drop-target");
        if (draggingId) panel._reorderDraftStep(draggingId, row.dataset.dragRow);
      });
    }
  }
}
