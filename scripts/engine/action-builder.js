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
const QUICKENED_BUILDER_SLUGS = new Set(["strike", "stride", "step"]);

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

function draftUsage(steps) {
  const usableSteps = Array.isArray(steps) ? steps : [];
  return usableSteps.reduce((usage, step) => {
    if (step?.stale) return usage;
    const cost = normalizeCost(step?.actionCost ?? step?.cost);
    if (cost === "reaction") {
      usage.reaction += 1;
    } else if (cost > 0) {
      usage.normal += cost;
    }
    return usage;
  }, { normal: 0, reaction: 0 });
}

function quickenedEligible(action, cost) {
  return cost === 1 && (QUICKENED_BUILDER_SLUGS.has(action?.slug) || action?.source === "strike");
}

function targetLabel(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target;
  const name = target?.name ?? target?.label;
  return name ? `Target: ${name}` : "";
}

function disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned }) {
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

  const remainingActions = quickenedEligible(action, cost)
    ? normalRemaining + quickenedRemaining
    : normalRemaining;
  if (typeof cost === "number" && cost > 0 && cost > remainingActions) {
    return {
      disabled: true,
      disabledReason: "Not enough actions remaining.",
    };
  }

  return { disabled: false, disabledReason: "" };
}

function favoriteApplies(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return true;
  return baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey);
}

function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const disabled = disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    favorite: favoriteApplies(favorites, key, baseKey, baseKeyCounts),
    ...disabled,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}

function assignActionKeys(actions) {
  const baseKeyCounts = new Map();
  const seen = new Map();
  const keyedActions = actions.map((action) => {
    const baseKey = actionBuilderKey(action);
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
    const count = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, count);
    return {
      action,
      baseKey,
      key: count === 1 ? baseKey : `${baseKey}#${count}`,
    };
  });
  return { keyedActions, baseKeyCounts };
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

function decorateDraftStep(step, actionByKey, uniqueBaseKeys) {
  const key = step?.actionKey ?? step?.key ?? actionBuilderKey(step);
  const action = actionByKey.get(key) ?? (uniqueBaseKeys.has(key) ? actionByKey.get(uniqueBaseKeys.get(key)) : null) ?? null;
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

function resolveDraftSteps(draft, actionByKey, uniqueBaseKeys) {
  return Array.isArray(draft?.steps)
    ? draft.steps.map((step) => decorateDraftStep(step, actionByKey, uniqueBaseKeys))
    : [];
}

export function buildActionBuilderModel({ context, candidates, plans = [], draft, favorites = new Set() }) {
  const budget = actionBudget(context);
  const tabs = emptyTabs();
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  const { keyedActions, baseKeyCounts } = assignActionKeys(sortActions(candidates ?? []));
  const uniqueBaseKeys = new Map(keyedActions
    .filter(({ baseKey }) => baseKeyCounts.get(baseKey) === 1)
    .map(({ key, baseKey }) => [baseKey, key]));
  const keyedActionByKey = new Map(keyedActions.map(({ key, action }) => [key, action]));
  const resolvedDraftSteps = resolveDraftSteps(draft, keyedActionByKey, uniqueBaseKeys);
  const usage = draftUsage(resolvedDraftSteps);
  const normalRemaining = Math.max(0, budget.normalActions - usage.normal);
  const quickenedUsed = Math.max(0, usage.normal - budget.normalActions);
  const quickenedRemaining = Math.max(0, (budget.quickenedActions ?? 0) - quickenedUsed);
  const remainingActions = Math.max(0, normalRemaining + quickenedRemaining);
  const reactionPlanned = usage.reaction > 0;
  const decoratedActions = keyedActions
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const actionByKey = new Map(decoratedActions.map((action) => [action.key, action]));
  const draftSteps = resolveDraftSteps(draft, actionByKey, uniqueBaseKeys);

  for (const action of decoratedActions) {
    tabs[action.tabId].all.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all.filter((action) => action.favorite);
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }

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
