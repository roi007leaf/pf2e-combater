import { adjustTrackedActions, setQuickenedAllowance } from "../../state/action-tracker.js";
import { reactionUsed, turnIdentity } from "../../state/turn-controls.js";
import { sendTurnControl } from "./turn-controls.js";
import { pf2eActionName, t } from "../../i18n.js";
import { CARD_DIALOG_CLASS, cardPickerHtml, checkedValues } from "../card-picker.js";

const QUICKENED_COMMON = [
  { slug: "strike", icon: "fa-hand-fist", tone: "red" },
  { slug: "stride", icon: "fa-person-walking", tone: "green" },
  { slug: "step", icon: "fa-shoe-prints", tone: "green" },
  { slug: "raise-a-shield", icon: "fa-shield-halved", tone: "blue" },
  { slug: "interact", icon: "fa-hand", tone: "gold" },
  { slug: "sustain", icon: "fa-hourglass-half", tone: "blue" },
];

// Common single actions first, then the creature's own one-action options.
function quickenedOptions(panel, allowed) {
  const seen = new Set();
  const options = [];
  const push = (slug, label, extra = {}) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    options.push({ value: slug, label, checked: allowed.has(slug), ...extra });
  };
  for (const entry of QUICKENED_COMMON) push(entry.slug, pf2eActionName(entry.slug), { icon: entry.icon, tone: entry.tone });
  for (const candidate of panel?._candidates ?? []) {
    const cost = Number(candidate?.actionCost ?? candidate?.cost);
    const slug = candidate?.source === "strike" ? "strike" : candidate?.slug;
    if (cost !== 1 || !slug) continue;
    push(slug, candidate.name ?? pf2eActionName(slug), { img: candidate.img ?? candidate.item?.img ?? "", icon: "fa-bolt" });
    if (options.length >= 18) break;
  }
  return options;
}

// The creature's reaction, for the minimal bar (the full panel shows a "Reaction used" badge).
function trackerReactionView(context) {
  const id = context?.combatant?.id;
  if (!id) return null;
  const combatant = globalThis.game?.combat?.turns?.find?.((entry) => entry.id === id) ?? context.combatant;
  const used = reactionUsed(combatant);
  return {
    used,
    combatantId: id,
    label: used
      ? t("TurnControls.ReactionUsed", "Reaction used")
      : t("ActionTracker.ReactionAvailable", "Reaction available"),
    hint: t("ActionTracker.ReactionHint", "Click: use the reaction · Right-click: give it back"),
  };
}

export function actionTrackerView(context) {
  const tracker = context?.actionTracker;
  if (!tracker) return { visible: false };
  const { budget, pool } = tracker;
  const forecast = tracker.forecast === true;
  const actor = context.actor?.document ?? context.combatant?.actor;
  const editable = !forecast && (globalThis.game?.user?.isGM === true || actor?.isOwner === true);
  const canConfigureQuickened = globalThis.game?.user?.isGM === true;
  // Click/right-click on the glyphs is a GM shortcut; players keep the adjust menu.
  const glyphControls = editable && globalThis.game?.user?.isGM === true;
  const quickened = pool.quickened > 0 || tracker.quickenedPending === true;
  const quickenedNeedsConfiguration = quickened && !tracker.quickenedAllowed.length;
  const conditions = [
    pool.slowed && t("ActionTracker.Slowed", "Slowed {value}", { value: pool.slowed }),
    pool.stunned && (pool.stunnedDuration
      ? t("ActionTracker.StunnedDuration", "Stunned")
      : t("ActionTracker.Stunned", "Stunned {value}", { value: pool.stunned })),
  ].filter(Boolean).join(" · ");
  // Slowed/Stunned gained mid-turn only cost actions the next time the creature regains them.
  const next = tracker.nextTurnPool;
  const pendingConditions = forecast || !next ? "" : [
    next.slowed > pool.slowed && t("ActionTracker.Slowed", "Slowed {value}", { value: next.slowed }),
    (next.stunned > pool.stunned || (next.stunnedDuration && !pool.stunnedDuration)) && (next.stunnedDuration
      ? t("ActionTracker.StunnedDuration", "Stunned")
      : t("ActionTracker.Stunned", "Stunned {value}", { value: next.stunned })),
  ].filter(Boolean).join(" · ");
  // Minimal bar: PF2e's condition icons with a value badge instead of the text chips.
  const icon = (slug, value, pending) => {
    const name = slug === "stunned" && !value
      ? t("ActionTracker.StunnedDuration", "Stunned")
      : t(slug === "slowed" ? "ActionTracker.Slowed" : "ActionTracker.Stunned",
        slug === "slowed" ? "Slowed {value}" : "Stunned {value}", { value });
    return {
      slug, value: value || "", pending,
      img: `systems/pf2e/icons/conditions/${slug}.webp`,
      tooltip: pending
        ? `${t("ActionTracker.PendingConditions", "{conditions} · next turn", { conditions: name })}. ${t("ActionTracker.PendingConditionsHint", "Gained during this turn: it reduces the actions this creature regains at the start of its next turn.")}`
        : name,
    };
  };
  const conditionIcons = forecast ? [] : [
    pool.slowed && icon("slowed", pool.slowed, false),
    (pool.stunned || pool.stunnedDuration) && icon("stunned", pool.stunnedDuration ? 0 : pool.stunned, false),
    next && next.slowed > pool.slowed && icon("slowed", next.slowed, true),
    next && (next.stunned > pool.stunned || (next.stunnedDuration && !pool.stunnedDuration))
      && icon("stunned", next.stunnedDuration ? 0 : next.stunned, true),
  ].filter(Boolean);
  return {
    visible: true, editable, forecast, glyphControls, conditionIcons,
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
    pendingConditions: pendingConditions
      ? t("ActionTracker.PendingConditions", "{conditions} · next turn", { conditions: pendingConditions })
      : "",
    pendingConditionsHint: t("ActionTracker.PendingConditionsHint", "Gained during this turn: it reduces the actions this creature regains at the start of its next turn."),
    quickenedLabel: t("ActionTracker.Quickened", "Quickened"),
    quickenedHint: tracker.quickenedAllowed.length
      ? canConfigureQuickened
        ? t("ActionTracker.Allowed", "Allowed: {actions}. Click to edit.", { actions: tracker.quickenedAllowed.join(", ") })
        : t("ActionTracker.AllowedReadOnly", "Allowed: {actions}.", { actions: tracker.quickenedAllowed.join(", ") })
      : t("ActionTracker.Unknown", "Auto-fill needs the GM to set allowed quickened actions. Until then, spend this action manually."),
    hint: forecast
      ? t("ActionTracker.ForecastHint", "Expected actions at the start of your next turn, based on current conditions. Auto-fill uses this budget.")
      : t("ActionTracker.Hint", "Tracks this turn's chat cards and completed actions. Use + to refund a reference-only post; use − for an unposted action."),
    reaction: trackerReactionView(context),
    pipsHint: t("ActionTracker.PipsHint", "Click: spend an action · Right-click: refund one"),
    spendLabel: t("ActionTracker.Spend", "Spend one action"),
    refundLabel: t("ActionTracker.Refund", "Refund one action"),
  };
}

export function activateActionTrackerBindings(panel, element) {
  // Glyphs as a shortcut for the adjust menu: click spends, right-click refunds. The quickened
  // glyph adjusts the quickened pool; any other glyph the normal pool.
  const pips = element.querySelector?.("[data-tracker-pips]");
  const adjustFromPip = async (event, amount) => {
    event.preventDefault();
    event.stopPropagation();
    const view = actionTrackerView(panel._context);
    if (!view.glyphControls) return;
    const quickened = Boolean(event.target.closest?.(".combater-pip.is-quickened"));
    const allowed = quickened
      ? (amount > 0 ? view.canSpendQuickened : view.canRefundQuickened)
      : (amount > 0 ? view.canSpend : view.canRefund);
    if (!allowed || pips.dataset.busy) return;
    pips.dataset.busy = "1";
    try {
      await adjustTrackedActions(panel._context, quickened ? "quickened" : "normal", amount);
      await panel.refresh("chat-actions");
    } catch (error) {
      globalThis.ui?.notifications?.error?.(error.message);
    } finally { delete pips.dataset.busy; }
  };
  pips?.addEventListener("click", (event) => adjustFromPip(event, 1));
  pips?.addEventListener("contextmenu", (event) => adjustFromPip(event, -1));

  // Reaction glyph: click spends it, right-click gives it back. Combatant flags need the GM,
  // so this goes through the turn-control request like Ready/Delay.
  const reaction = element.querySelector?.("[data-tracker-reaction]");
  const setReaction = async (event, used) => {
    event.preventDefault();
    event.stopPropagation();
    const view = actionTrackerView(panel._context);
    if (!view.glyphControls || !view.reaction || view.reaction.used === used || reaction.dataset.busy) return;
    reaction.dataset.busy = "1";
    try {
      await sendTurnControl({ ...turnIdentity(globalThis.game?.combat), action: "reaction", reactionId: view.reaction.combatantId, used });
      await panel.refresh("turn-controls");
    } catch (error) {
      globalThis.ui?.notifications?.warn?.(error.message);
    } finally { delete reaction.dataset.busy; }
  };
  reaction?.addEventListener("click", (event) => setReaction(event, true));
  reaction?.addEventListener("contextmenu", (event) => setReaction(event, false));
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
    const allowed = new Set(context.actionTracker.quickenedAllowed);
    const options = quickenedOptions(panel, allowed);
    const listed = new Set(options.map((option) => option.value));
    const extra = [...allowed].filter((slug) => !listed.has(slug)).join(", ");
    const input = await dialog.prompt({
      classes: [CARD_DIALOG_CLASS],
      position: { width: 480, height: "auto" },
      window: { title: t("ActionTracker.AllowanceTitle", "Quickened actions"), icon: "fa-solid fa-bolt" },
      content: `<div class="combater-card-dialog-body">
        <p>${escape(t("ActionTracker.AllowanceCards", "Pick the single actions this Quickened condition allows. Saved while the condition remains; pick none to track it manually."))}</p>
        ${cardPickerHtml({ name: "quickenedSlug", type: "checkbox", options, compact: true })}
        <label class="combater-chip-field"><span>${escape(t("ActionTracker.AllowanceOther", "Other action slugs (comma separated)"))}</span>
          <input name="slugs" type="text" value="${escape(extra)}" placeholder="demoralize, seek"></label>
      </div>`,
      ok: {
        label: t("ActionTracker.Save", "Save"),
        icon: "fa-solid fa-check",
        callback: (_event, button) => [...checkedValues(button.form, "quickenedSlug"), button.form.elements.slugs.value].join(","),
      },
      rejectClose: false,
    });
    if (typeof input !== "string") return;
    await setQuickenedAllowance(context, input.split(","));
    await panel.refresh("chat-actions");
  });
}
