import { t } from "../i18n.js";

const NOT_ENOUGH_ACTIONS = () => t("Disabled.NotEnoughActions", "Not enough actions remaining.");

function bestTargetName(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target ?? null;
  if (target?.type === "self") return "";
  return String(target?.name ?? target?.actor?.name ?? "").trim();
}

function oddsLabel(chip) {
  return String(chip?.label ?? "").match(/(\d+(?:\.\d+)?)\s*%/)?.[0]?.replace(/\s+/g, "") ?? "";
}

function mostCommon(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return { value: best, count: bestCount };
}

function byName(left, right) {
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
}

// Turns one decorated action into a compact one-line row: the success chance
// becomes a column, the shared best target and the shared budget warning are
// lifted out, and everything else waits in the expanded details.
function browserRow(action, { sharedTarget, expanded }) {
  const chips = Array.isArray(action?.detailChips) ? action.detailChips : [];
  const preflight = chips.find((chip) => chip?.class === "is-preflight");
  const extraChips = chips.filter((chip) => chip?.class !== "is-preflight" && chip?.class !== "is-best-target");
  const target = bestTargetName(action);
  const budgetOnly = action?.overBudget === true && action?.disabledReason === NOT_ENOUGH_ACTIONS();
  return {
    ...action,
    odds: oddsLabel(preflight),
    oddsTooltip: preflight?.tooltip ?? "",
    oddsTooltipHtml: preflight?.tooltipHtml ?? "",
    rowTarget: target && target !== sharedTarget ? t("Browser.RowTarget", "vs {name}", { name: target }) : "",
    rowWarning: budgetOnly ? "" : action?.disabledReason ?? "",
    recharge: Number(action?.rechargeRoundsLeft) > 0 ? {
      rounds: Number(action.rechargeRoundsLeft),
      tooltip: t("Browser.RechargeTooltip", "Usable again on round {round}.", { round: action.rechargeReadyRound }),
    } : null,
    extraChips,
    hasExtraChips: extraChips.length > 0,
    expanded: expanded?.has?.(action?.key) === true,
    addTooltip: action?.overBudget ? action.disabledReason : t("Browser.AddToPlan", "Add to plan"),
  };
}

export function browserViewContext(base, { expanded = null, sort = "best" } = {}) {
  const builder = base?.builder;
  if (!builder) return base;
  const tabs = builder.tabsList ?? [];
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const visibleSections = builder.searchQuery ? builder.mergedSearchResults ?? [] : activeTab?.sections ?? [];
  const visibleActions = visibleSections.flatMap((section) => section.actions ?? []);
  const shared = mostCommon(visibleActions.map(bestTargetName));
  const sharedTarget = shared.count >= 2 ? shared.value : "";
  const decorateSection = (section) => {
    const actions = (section.actions ?? []).map((action) => browserRow(action, { sharedTarget, expanded }));
    if (sort === "name" && !section.isFavoritesSection) actions.sort(byName);
    return { ...section, actions, hasActions: actions.length > 0 };
  };
  const tabsList = tabs.map((tab) => ({
    ...tab,
    count: new Set((tab.sections ?? []).flatMap((section) => (section.actions ?? []).map((action) => action.key))).size,
    sections: (tab.sections ?? []).map(decorateSection),
  }));
  const remaining = Number(builder.remainingTotalActions) || 0;
  const overBudget = visibleActions.some((action) => action?.overBudget && action.disabledReason === NOT_ENOUGH_ACTIONS());
  return {
    ...base,
    builder: { ...builder, tabsList, mergedSearchResults: (builder.mergedSearchResults ?? []).map(decorateSection) },
    browserBar: {
      over: overBudget,
      pips: Array.from({ length: Math.min(6, remaining) }, () => ({})),
      remainingLabel: t(remaining === 1 ? "Browser.ActionLeft" : "Browser.ActionsLeft", remaining === 1 ? "{count} action left" : "{count} actions left", { count: remaining }),
      overLabel: overBudget ? t("Browser.OverBudget", "too few for these actions · add them as uncounted instead") : "",
      sharedTargetLabel: sharedTarget ? t("Browser.SharedTargetPrefix", "Best target") : "",
      sharedTarget,
    },
    sortLabel: sort === "name" ? t("Browser.SortName", "A–Z") : t("Browser.SortBest", "Best"),
    sortTooltip: t("Browser.SortTooltip", "Sort actions by planner score or by name."),
    hiddenLabel: t("Browser.HiddenToggle", "Hidden"),
    labels: {
      favoritesHint: t("Browser.FavoritesHint", "Star an action to pin it here."),
      addUncounted: t("Browser.AddUncountedLabel", "Add as uncounted"),
      hide: t("Browser.HideLabel", "Hide from Auto-fill"),
      restore: t("Browser.RestoreLabel", "Show in Auto-fill"),
      openSheet: t("Browser.OpenSheet", "Open sheet"),
      expand: t("Browser.ExpandRow", "Show details"),
    },
  };
}
