import { confidenceLabel } from "./confidence.js";
import { actionBudget } from "./planner.js";

export const ACTION_BUILDER_TABS = [
  { id: "one", label: "1 Action", cost: 1 },
  { id: "two", label: "2 Actions", cost: 2 },
  { id: "three", label: "3 Actions", cost: 3 },
  { id: "free", label: "Free", cost: 0 },
  { id: "reaction", label: "Reaction", cost: "reaction" },
];

const TAB_BY_COST = new Map(ACTION_BUILDER_TABS.map((tab) => [tab.cost, tab]));
const TAB_IDS = ACTION_BUILDER_TABS.map((tab) => tab.id);

export function actionBuilderKey(action) {
  return action?.id
    ?? action?.uuid
    ?? action?.item?.uuid
    ?? action?.slug
    ?? action?.name
    ?? "unknown-action";
}

function normalizeCost(cost) {
  if (cost === "reaction") return "reaction";
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(1, Math.min(3, numeric));
}

function tabForCost(cost) {
  return TAB_BY_COST.get(normalizeCost(cost)) ?? TAB_BY_COST.get(1);
}

function scoreValue(action) {
  const score = Number(action?.score);
  return Number.isFinite(score) ? score : 0;
}

function actionName(action) {
  return String(action?.name ?? action?.label ?? actionBuilderKey(action));
}

function sortActions(actions) {
  return [...actions].toSorted((left, right) => {
    const scoreDelta = scoreValue(right) - scoreValue(left);
    if (scoreDelta !== 0) return scoreDelta;
    return actionName(left).localeCompare(actionName(right));
  });
}

function draftUsage(draft) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  return steps.reduce((usage, step) => {
    const cost = normalizeCost(step?.actionCost ?? step?.cost);
    if (cost === "reaction") {
      usage.reaction += 1;
    } else if (cost > 0) {
      usage.normal += cost;
    }
    return usage;
  }, { normal: 0, reaction: 0 });
}

function targetLabel(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target;
  const name = target?.name ?? target?.label;
  return name ? `Target: ${name}` : "";
}

function disabledState(action, cost, remainingActions, reactionPlanned) {
  if (action?.available === false) {
    return {
      disabled: true,
      disabledReason: action?.unavailableReason ?? "Action is not available.",
    };
  }

  if (cost === "reaction" && reactionPlanned) {
    return {
      disabled: true,
      disabledReason: "Reaction already planned.",
    };
  }

  if (typeof cost === "number" && cost > 0 && cost > remainingActions) {
    return {
      disabled: true,
      disabledReason: "Not enough actions remaining.",
    };
  }

  return { disabled: false, disabledReason: "" };
}

function decorateAction(action, { favorites, remainingActions, reactionPlanned }) {
  const key = actionBuilderKey(action);
  const cost = normalizeCost(action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const disabled = disabledState(action, cost, remainingActions, reactionPlanned);
  const confidence = action?.confidence ?? "low";
  return {
    ...action,
    key,
    tabId: tab.id,
    cost,
    favorite: favorites.has(key),
    ...disabled,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}

function emptyTabs() {
  return Object.fromEntries(TAB_IDS.map((id) => [
    id,
    {
      ...ACTION_BUILDER_TABS.find((tab) => tab.id === id),
      all: [],
      favorites: [],
      recommended: [],
    },
  ]));
}

function decorateDraftStep(step, actionByKey) {
  const key = step?.actionKey ?? step?.key ?? actionBuilderKey(step);
  const action = actionByKey.get(key) ?? null;
  const stale = !action;
  const missingDestination = Boolean(action?.requiresDestination) && !step?.destination;
  return {
    ...step,
    key,
    action,
    stale,
    warning: stale
      ? "Action is no longer available."
      : missingDestination ? "Choose a destination." : "",
  };
}

export function buildActionBuilderModel({ context, candidates, plans = [], draft, favorites = new Set() }) {
  const budget = actionBudget(context);
  const usage = draftUsage(draft);
  const remainingActions = Math.max(0, budget.totalActions - usage.normal);
  const reactionPlanned = usage.reaction > 0;
  const tabs = emptyTabs();
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  const decoratedActions = sortActions(candidates ?? [])
    .map((action) => decorateAction(action, {
      favorites: favoriteSet,
      remainingActions,
      reactionPlanned,
    }));
  const actionByKey = new Map(decoratedActions.map((action) => [action.key, action]));

  for (const action of decoratedActions) {
    tabs[action.tabId].all.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all.filter((action) => action.favorite);
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }

  const draftSteps = Array.isArray(draft?.steps)
    ? draft.steps.map((step) => decorateDraftStep(step, actionByKey))
    : [];

  return {
    context,
    actionBudget: budget,
    usage,
    remainingActions,
    tabs,
    draft: {
      ...(draft ?? {}),
      steps: draftSteps,
      warnings: draftSteps.filter((step) => step.warning).map((step) => step.warning),
    },
    autoFill: plans[0] ?? null,
  };
}
