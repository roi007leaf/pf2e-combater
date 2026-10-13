import { adjustTrackedActions, setQuickenedAllowance } from "../../state/action-tracker.js";
import { t } from "../../i18n.js";

export function actionTrackerView(context) {
  const tracker = context?.actionTracker;
  if (!tracker) return { visible: false };
  const { budget, pool } = tracker;
  const forecast = tracker.forecast === true;
  const actor = context.actor?.document ?? context.combatant?.actor;
  const editable = !forecast && (globalThis.game?.user?.isGM === true || actor?.isOwner === true);
  const canConfigureQuickened = globalThis.game?.user?.isGM === true;
  const quickened = pool.quickened > 0 || tracker.quickenedPending === true;
  const quickenedNeedsConfiguration = quickened && !tracker.quickenedAllowed.length;
  const conditions = [
    pool.slowed && t("ActionTracker.Slowed", "Slowed {value}", { value: pool.slowed }),
    pool.stunned && (pool.stunnedDuration
      ? t("ActionTracker.StunnedDuration", "Stunned")
      : t("ActionTracker.Stunned", "Stunned {value}", { value: pool.stunned })),
  ].filter(Boolean).join(" · ");
  return {
    visible: true, editable, forecast,
    label: forecast ? t("ActionTracker.NextTurn", "Next turn") : t("ActionTracker.Label", "Actions left"),
    countLabel: forecast
      ? t(budget.totalActions === 1 ? "ActionTracker.ExpectedAction" : "ActionTracker.ExpectedActions",
        budget.totalActions === 1 ? "{count} action" : "{count} actions", { count: budget.totalActions })
      : `${budget.normalActions}/${pool.normalActions}`,
    normal: budget.normalActions,
    total: pool.normalActions,
    pips: [
      ...Array.from({ length: pool.normalActions }, (_, index) => ({ spent: index >= budget.normalActions })),
      ...(pool.quickenedActions > 0 ? [{ quickened: true, spent: budget.quickenedActions === 0 }] : []),
    ],
    canSpend: editable && budget.normalActions > 0,
    canRefund: editable && budget.normalActions < pool.normalActions,
    quickened, canConfigureQuickened, quickenedNeedsConfiguration,
    quickenedSetupLabel: canConfigureQuickened
      ? t("ActionTracker.SetActions", "Set actions")
      : t("ActionTracker.GmSetup", "GM setup"),
    quickenedPending: tracker.quickenedPending === true,
    quickenedPendingLabel: t("ActionTracker.QuickenedPending", "Quickened · next turn"),
    quickenedPendingHint: t("ActionTracker.QuickenedPendingHint", "Quickened was gained during this turn. It changes the actions you regain at the start of your next turn."),
    quickenedLeft: budget.quickenedActions,
    canSpendQuickened: editable && budget.quickenedActions > 0,
    canRefundQuickened: editable && budget.quickenedActions < pool.quickenedActions,
    conditions,
    quickenedLabel: t("ActionTracker.Quickened", "Quickened"),
    quickenedHint: tracker.quickenedAllowed.length
      ? canConfigureQuickened
        ? t("ActionTracker.Allowed", "Allowed: {actions}. Click to edit.", { actions: tracker.quickenedAllowed.join(", ") })
        : t("ActionTracker.AllowedReadOnly", "Allowed: {actions}.", { actions: tracker.quickenedAllowed.join(", ") })
      : t("ActionTracker.Unknown", "Auto-fill needs the GM to set allowed quickened actions. Until then, spend this action manually."),
    hint: forecast
      ? t("ActionTracker.ForecastHint", "Expected actions at the start of your next turn, based on current conditions. Auto-fill uses this budget.")
      : t("ActionTracker.Hint", "Tracks this turn's chat cards and completed actions. Use + to refund a reference-only post; use − for an unposted action."),
    spendLabel: t("ActionTracker.Spend", "Spend one action"),
    refundLabel: t("ActionTracker.Refund", "Refund one action"),
  };
}

export function activateActionTrackerBindings(panel, element) {
  for (const button of element.querySelectorAll("[data-tracker-adjust]")) {
    button.addEventListener("click", async () => {
      if (!actionTrackerView(panel._context).editable) return;
      button.disabled = true;
      try {
        await adjustTrackedActions(panel._context, button.dataset.trackerPool, Number(button.dataset.trackerAdjust));
        await panel.refresh("chat-actions");
      } catch (error) {
        globalThis.ui?.notifications?.error?.(error.message);
      } finally { button.disabled = false; }
    });
  }
  for (const button of element.querySelectorAll("[data-quickened-allowance]")) button.addEventListener("click", async () => {
    const context = panel._context;
    if (!actionTrackerView(context).canConfigureQuickened) return;
    const dialog = globalThis.foundry?.applications?.api?.DialogV2;
    if (!dialog?.prompt) return;
    const escape = globalThis.foundry.utils.escapeHTML;
    const allowed = context.actionTracker.quickenedAllowed.join(", ");
    const input = await dialog.prompt({
      window: { title: t("ActionTracker.AllowanceTitle", "Quickened actions") },
      content: `<p>${escape(t("ActionTracker.AllowanceHint", "Enter allowed single actions, separated by commas (for example: strike, stride or step). Saved while this Quickened condition remains. Leave empty for manual tracking."))}</p><input name="slugs" type="text" value="${escape(allowed)}">`,
      ok: { label: t("ActionTracker.Save", "Save"), callback: (_event, button) => button.form.elements.slugs.value },
      rejectClose: false,
    });
    if (typeof input !== "string") return;
    await setQuickenedAllowance(context, input.split(","));
    await panel.refresh("chat-actions");
  });
}
