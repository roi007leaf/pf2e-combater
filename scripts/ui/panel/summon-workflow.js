import { canPlanSummon, planSummon } from "../../integrations/summons-assistant.js";
import { cancelPanelPickers, contextForDraftStep } from "./picker-workflow.js";
import { t } from "../../i18n.js";

export async function choosePanelSummon(panel, instanceId) {
  if (!panel._canExecuteDraft() || !panel._context) return;
  const step = panel._findDraftStep(instanceId);
  if (!step || step.execution?.status === "done" || !canPlanSummon(step.action)) return;
  cancelPanelPickers(panel);
  panel._destinationPicker = { instanceId, native: true, summon: true };
  try {
    const summonPlan = await planSummon(contextForDraftStep(panel, instanceId), step.action);
    if (!summonPlan) return;
    const current = panel._findActiveStep(instanceId);
    if (!current || current.execution?.status === "done") return;
    await panel._persistActiveDraftStep({ ...current, summonPlan, ...(current.execution?.status === "failed" ? { execution: { status: "pending" } } : {}) });
  } catch (_error) {
    globalThis.ui?.notifications?.warn?.(t("Summon.Unavailable", "Summons Assistant is unavailable."));
  } finally {
    panel._destinationPicker = null;
    await panel.render({ force: true });
  }
}
