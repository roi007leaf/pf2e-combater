// Assembles the Browse/builder tab model: action budget, quickened-casting-discount projection,
// per-action decoration (disabled state, favorites, confidence label), and draft-step resolution
// against the current candidate pool. buildActionBuilderModel is the single entry point external
// callers use.
import { confidenceLabel } from "../../confidence.js";
import { actionBudget } from "../budget.js";
import { actionIncludes, isDestinationActionSlug, requiresDestinationForAction } from "../requirements.js";
import { draftStepIsUsable } from "./projection.js";
import { t } from "../../../i18n.js";
import { actionBuilderKey, actionName, scoreValue } from "./shared.js";
import {
  actionIncludedParts,
  builderActivationAction,
  hasConsumableInteractDraw,
  isCompositeAtomicAction,
  syntheticInteractAction,
} from "./atomize.js";
import { expandMinionCommandRows } from "./minion.js";

export const ACTION_BUILDER_TABS = [
  { id: "one", label: "1 Action", cost: 1 },
  { id: "two", label: "2 Actions", cost: 2 },
  { id: "three", label: "3 Actions", cost: 3 },
  { id: "free", label: "Free", cost: 0 },
  { id: "reaction", label: "Reaction", cost: "reaction" },
];

const TAB_BY_COST = new Map(ACTION_BUILDER_TABS.map((tab) => [tab.cost, tab]));
const TAB_IDS = ACTION_BUILDER_TABS.map((tab) => tab.id);
// Quickened's extra action is restricted to Strike and Stride (Haste's wording). Step is NOT allowed.
const QUICKENED_BUILDER_SLUGS = new Set(["strike", "stride"]);

function normalizeCost(cost) {
  if (cost === "reaction") return "reaction";
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(1, Math.min(3, numeric));
}

function readValidCost(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === null || cost === undefined || cost === "") return null;
  const numeric = Number(cost);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric === 0) return 0;
  return Math.max(1, Math.min(3, numeric));
}

function tabForCost(cost) {
  return TAB_BY_COST.get(normalizeCost(cost)) ?? TAB_BY_COST.get(1);
}

function draftUsage(steps) {
  const usableSteps = Array.isArray(steps) ? steps : [];
  return usableSteps.reduce((usage, step) => {
    if (step?.stale) return usage;
    const cost = draftStepCost(step);
    if (cost === "reaction") {
      usage.reaction += 1;
    } else if (cost > 0) {
      usage.normal += cost;
      if (quickenedEligible(step?.action, cost)) usage.quickenedEligibleCost += cost;
    }
    return usage;
  }, { normal: 0, reaction: 0, quickenedEligibleCost: 0 });
}

function draftStepCost(step) {
  return firstValidCost(step?.actionCost, step?.cost, step?.action?.actionCost, step?.action?.cost);
}

function firstValidCost(...costs) {
  for (const cost of costs) {
    const normalized = readValidCost(cost);
    if (normalized !== null) return normalized;
  }
  return 0;
}

function quickenedEligible(action, cost) {
  return cost === 1 && (QUICKENED_BUILDER_SLUGS.has(action?.slug) || action?.source === "strike");
}

// Quickened Casting (and similar "reduce your next spell's action cost" setups) is flagged by the
// classifier but otherwise inert until a step here actually applies the discount.
function isActionDiscountStep(step) {
  return step?.action?.activityProfile?.actionDiscount === true;
}

// Matches the granting ability's own wording: "an arcane spontaneous spell." Rank caps ("8th level
// or lower") aren't enforced -- see the design doc for why this is an accepted simplification.
function isDiscountEligibleSpell(step) {
  const action = step?.action;
  if (!action || !String(action.source ?? "").startsWith("spell")) return false;
  return String(action.spellcastingEntryTradition ?? "").toLowerCase() === "arcane"
    && String(action.spellcastingEntryType ?? "").toLowerCase() === "spontaneous";
}

// The discount is spent on the very next usable step regardless of whether it qualifies (mirrors
// the ability's "if your next action is X" wording -- an unrelated next action wastes it). Runs
// after decoration so it's recomputed fresh every render; nothing is mutated on the stored draft.
function applyQuickenedCastingDiscount(steps) {
  let pending = false;
  return steps.map((step) => {
    if (!draftStepIsUsable(step)) return step;
    let updated = step;
    if (pending && isDiscountEligibleSpell(step) && typeof step.actionCost === "number" && step.actionCost >= 1) {
      const discounted = Math.max(1, step.actionCost - 1);
      updated = { ...step, actionCost: discounted, cost: discounted, quickenedCastingDiscount: true };
    }
    pending = isActionDiscountStep(step);
    return updated;
  });
}

const QUICKENING_SLUGS = new Set(["haste"]);

// A drafted action grants quickened (an extra Stride/Strike) when it's Haste, when the engine
// flagged it as granting an extra action, or when it explicitly applies the "quickened" condition.
function actionGrantsQuickened(action) {
  if (!action) return false;
  if (QUICKENING_SLUGS.has(String(action.slug ?? "").toLowerCase())) return true;
  const profile = action.activityProfile ?? {};
  if (profile.extraAction === true) return true;
  const conditionLists = [profile.appliesConditions, action.appliesConditions];
  return conditionLists.some((list) =>
    Array.isArray(list) && list.map((entry) => String(entry).toLowerCase()).includes("quickened"),
  );
}

// The quickening step benefits the current combatant only when it targets them: the chosen target
// is the current token, or it's a self-only action with no explicit target (i.e. cast on the caster).
function quickeningStepTargetsCurrent(step, currentTokenId) {
  const ids = Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : [];
  if (currentTokenId && ids.includes(currentTokenId)) return true;
  if (!ids.length) {
    const targeting = step?.action?.targetingProfile ?? {};
    return targeting.self === true && targeting.ally !== true && targeting.enemy !== true;
  }
  return false;
}

// During planning the quickened condition isn't applied yet, so anticipate the extra action when a
// drafted quickening spell targets the current combatant (e.g. self-cast Haste).
function draftAnticipatesQuickened(resolvedSteps, context) {
  const currentTokenId = context?.token?.id ?? null;
  return (Array.isArray(resolvedSteps) ? resolvedSteps : []).some(
    (step) =>
      step
      && !step.stale
      && actionGrantsQuickened(step.action)
      && quickeningStepTargetsCurrent(step, currentTokenId),
  );
}

function needsSyntheticInteract(action) {
  if (hasConsumableInteractDraw(action)) return true;
  const includes = actionIncludedParts(action);
  return includes.has("draw") || includes.has("interact") || action.activityProfile?.drawsWeapon === true;
}

function hasInteractAction(actions) {
  return actions.some((action) => String(action?.slug ?? "").toLowerCase() === "interact"
    || actionBuilderKey(action) === "interact");
}

function builderActionRows(actions, { includeSyntheticInteract = true, keepComposites = false } = {}) {
  const rows = [];
  let needsInteract = false;
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action) continue;
    const activation = builderActivationAction(action);
    if (activation) {
      needsInteract = true;
      rows.push(activation);
      continue;
    }
    // A composite (e.g. Rush, Sudden Charge) can't be queued through this row's plain single-step
    // add -- it needs builderAtomicActionsForStep's Stride/Strike split -- so it's normally kept out
    // of the addable candidate list entirely. keepComposites is for the browse-only "why is this
    // rejected" display, where the row is informational (or, per the caller, still added through
    // that same atomizer) rather than a raw single-step push.
    if (!keepComposites && isCompositeAtomicAction(action)) {
      needsInteract ||= needsSyntheticInteract(action);
      continue;
    }
    rows.push(action);
  }

  if (includeSyntheticInteract && needsInteract && !hasInteractAction(rows)) rows.push(syntheticInteractAction());
  return rows;
}

// A Strike auto-filled with no reachable target and nothing to fix it is never useful: it is out
// of range from where it executes AND no earlier step moves the actor closer. (A Strike that
// follows a Stride is left alone; the move may bring it into range.) `projectedAction` is the
// step's action resolved from its projected origin; `hasEarlierMove` is whether any prior draft
// step is a movement step.
export function isUnreachableStrikeStep(projectedAction, hasEarlierMove) {
  if (!projectedAction) return false;
  const isStrike = projectedAction.source === "strike"
    || projectedAction.attackTrait === true
    || projectedAction.activityProfile?.includesStrike === true;
  if (!isStrike || projectedAction.available !== false) return false;
  const reason = String(projectedAction.unavailableReason ?? projectedAction.disabledReason ?? "").toLowerCase();
  const noReachableTarget = reason.includes("range") || reason.includes("no target");
  return noReachableTarget && !hasEarlierMove;
}

function targetLabel(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target;
  const name = target?.name ?? target?.label;
  return name ? t("Label.Target", "Target: {name}", { name }) : "";
}

function actionUnavailableReason(action) {
  return action?.disabledReason
    || action?.unavailableReason
    || action?.rejectionReason
    || action?.reason
    || t("Disabled.NoLongerAvailable", "Action is no longer available.");
}

// `overBudget` marks actions that do not fit the turn's action economy (no actions
// left, or a reaction already planned). The normal-plan "+" refuses these; the
// off-budget uncounted "+" ignores it. `disabled` stays false either way so
// the row remains visible and interactive (e.g. hover preview, uncounted add).
function disabledState(action, cost, { normalRemaining, quickenedRemaining, reactionPlanned }) {
  if (action?.minionPlanFull === true) {
    return {
      disabled: false,
      disabledReason: t("MinionPlan.NoActionsLeft", "Companion has no actions left."),
      overBudget: true,
    };
  }

  // A rejected candidate (e.g. no attackable enemy target right now) keeps `available` true --
  // only the ITEM's own usability is false/true, not whether this moment's context has a valid
  // target -- so normalizeDraftOnlyActions' pre-computed disabledReason is the only signal that
  // this row needs its warning surfaced instead of falling through to the budget checks below,
  // which would silently overwrite it with an empty reason.
  if (action?.available === false || action?.disabled === true || action?.disabledReason) {
    return {
      disabled: false,
      disabledReason: actionUnavailableReason(action),
      overBudget: false,
    };
  }

  if (cost === "reaction" && reactionPlanned) {
    return {
      disabled: false,
      disabledReason: t("Disabled.ReactionPlanned", "Reaction already planned."),
      overBudget: true,
    };
  }

  const remainingActions = quickenedEligible(action, cost)
    ? normalRemaining + quickenedRemaining
    : normalRemaining;
  if (typeof cost === "number" && cost > 0 && cost > remainingActions) {
    return {
      disabled: false,
      disabledReason: t("Disabled.NotEnoughActions", "Not enough actions remaining."),
      overBudget: true,
    };
  }

  return { disabled: false, disabledReason: "", overBudget: false };
}

function favoriteEntryKey(favorites, key, baseKey, baseKeyCounts) {
  if (favorites.has(key)) return key;
  if (baseKeyCounts.get(baseKey) === 1 && favorites.has(baseKey)) return baseKey;
  return null;
}

function decorateAction(action, { key, baseKey, favorites, baseKeyCounts, normalRemaining, quickenedRemaining, reactionPlanned }) {
  const cost = normalizeCost(action?.tabCost ?? action?.actionCost ?? action?.cost);
  const budgetCost = normalizeCost(action?.budgetCost ?? action?.actionCost ?? action?.cost);
  const tab = tabForCost(cost);
  const availabilityWarning = action?.available === false || action?.disabled === true ? actionUnavailableReason(action) : "";
  const disabled = disabledState(action, budgetCost, { normalRemaining, quickenedRemaining, reactionPlanned });
  const confidence = action?.confidence ?? "low";
  const favoriteEntry = favoriteEntryKey(favorites, key, baseKey, baseKeyCounts);
  return {
    ...action,
    key,
    baseKey,
    tabId: tab.id,
    cost,
    budgetCost,
    favorite: favoriteEntry !== null,
    favoriteEntryKey: favoriteEntry,
    ...disabled,
    availabilityWarning,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}

function stableActionIdentity(action, baseKey) {
  return [
    action?.item?.uuid,
    action?.uuid,
    action?.source,
    action?.slug,
    action?.name,
    action?.label,
    action?.actionCost,
    action?.cost,
    baseKey,
  ].map((part) => String(part ?? "")).join("\u0000");
}

function assignActionKeys(actions) {
  const baseKeyCounts = new Map();
  const entries = actions.map((action, index) => {
    const baseKey = actionBuilderKey(action);
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
    return { action, baseKey, index, identity: stableActionIdentity(action, baseKey) };
  });

  const entriesByBaseKey = new Map();
  for (const entry of entries) {
    if (!entriesByBaseKey.has(entry.baseKey)) entriesByBaseKey.set(entry.baseKey, []);
    entriesByBaseKey.get(entry.baseKey).push(entry);
  }

  const keyByIndex = new Map();
  for (const [baseKey, duplicateEntries] of entriesByBaseKey) {
    const stableEntries = duplicateEntries.toSorted((left, right) => {
      const identityDelta = left.identity.localeCompare(right.identity);
      if (identityDelta !== 0) return identityDelta;
      return left.index - right.index;
    });
    stableEntries.forEach((entry, duplicateIndex) => {
      keyByIndex.set(entry.index, duplicateIndex === 0 ? baseKey : `${baseKey}#${duplicateIndex + 1}`);
    });
  }

  const keyedActions = entries.map((entry) => ({
    action: entry.action,
    baseKey: entry.baseKey,
    key: keyByIndex.get(entry.index),
  }));
  return { keyedActions, baseKeyCounts };
}

function normalizeDraftOnlyActions(unavailableActions, rejected) {
  return [...(unavailableActions ?? []), ...(rejected ?? [])]
    .map((entry) => {
      const action = entry?.action ?? entry;
      if (!action) return null;

      const rejectionReason = entry?.reason;
      const disabledReason = action.disabledReason ?? action.unavailableReason ?? rejectionReason;
      return {
        ...action,
        disabled: action.disabled ?? true,
        ...(disabledReason ? { disabledReason } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
      };
    })
    .filter(Boolean);
}

function draftResolutionMap(keyedActions, draftOnlyActions, draftFallbackActions = []) {
  const { keyedActions: keyedDraftFallbackActions } = assignActionKeys(draftFallbackActions);
  const { keyedActions: keyedDraftOnlyActions } = assignActionKeys(draftOnlyActions);
  const draftKeyedActions = [...keyedActions];
  const actionByKey = new Map(keyedActions.map(({ key, action }) => [key, action]));

  for (const entry of keyedDraftFallbackActions) {
    if (actionByKey.has(entry.key)) continue;
    draftKeyedActions.push(entry);
    actionByKey.set(entry.key, entry.action);
  }

  for (const entry of keyedDraftOnlyActions) {
    if (actionByKey.has(entry.key)) continue;
    draftKeyedActions.push(entry);
    actionByKey.set(entry.key, entry.action);
  }

  const baseKeyCounts = new Map();
  for (const { baseKey } of draftKeyedActions) {
    baseKeyCounts.set(baseKey, (baseKeyCounts.get(baseKey) ?? 0) + 1);
  }
  const uniqueBaseKeys = new Map(draftKeyedActions
    .filter(({ baseKey }) => baseKeyCounts.get(baseKey) === 1)
    .map(({ key, baseKey }) => [baseKey, key]));

  return { actionByKey, uniqueBaseKeys };
}

function emptyTabs() {
  return Object.fromEntries(TAB_IDS.map((id) => [
    id,
    {
      ...ACTION_BUILDER_TABS.find((tab) => tab.id === id),
      all: [],
      favorites: [],
      quickened: [],
      recommended: [],
    },
  ]));
}

function quickenedShelfActions(actions) {
  return actions
    .filter((action) => quickenedEligible(action, action.cost))
    .toSorted((left, right) => {
      if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
      const scoreDelta = scoreValue(right) - scoreValue(left);
      if (scoreDelta !== 0) return scoreDelta;
      return actionName(left).localeCompare(actionName(right));
    });
}

function disabledActionReason(action) {
  return String(
    action?.disabledReason
      ?? action?.unavailableReason
      ?? action?.rejectionReason
      ?? action?.reason
      ?? "",
  ).toLowerCase();
}

// Rejected/unavailable actions are only surfaced in Browse when the rejection itself is
// informative to a player deciding what to do next turn (a blocked/inapplicable movement, or
// Elemental Blast which is always shown so its disabled reason explains why). Everything else
// that's merely unavailable right now (an unprepared spell, an out-of-range strike, ...) stays
// out of the visible tabs -- it still resolves via draftOnlyActions for stale draft steps.
function showDisabledInBuilder(action) {
  const slug = String(action?.slug ?? "").toLowerCase();
  const role = String(action?.role ?? "").toLowerCase();
  const isMovementAction = isDestinationActionSlug(slug)
    || role === "mobility"
    || role === "movement"
    || actionIncludes(action, "move")
    || actionIncludes(action, "stride")
    || actionIncludes(action, "step")
    || Number(action?.activityProfile?.strideCount) > 0;
  if (!action?.disabled && action?.available !== false) {
    return isMovementAction && Boolean(action?.rejectionReason);
  }
  if (action?.tacticSlug === "elemental-blast") return true;
  if (isMovementAction) return true;

  const reason = disabledActionReason(action);
  return reason.includes("move actions are unavailable")
    || reason.includes("collision-free movement path")
    || reason.includes("movement path");
}

function draftStepActionOverride(step, draftStepActions) {
  if (!step?.instanceId || !draftStepActions) return null;
  if (draftStepActions instanceof Map) return draftStepActions.get(step.instanceId) ?? null;
  if (typeof draftStepActions === "object") return draftStepActions[step.instanceId] ?? null;
  return null;
}

function decorateDraftStep(step, actionByKey, uniqueBaseKeys, draftStepActions = null) {
  const key = step?.actionKey ?? step?.key ?? actionBuilderKey(step);
  const resolvedAction = actionByKey.get(key) ?? (uniqueBaseKeys.has(key) ? actionByKey.get(uniqueBaseKeys.get(key)) : null) ?? null;
  const baseAction = draftStepActionOverride(step, draftStepActions) ?? resolvedAction;
  // A re-resolved action loses the per-step movement type the player pinned (fly/burrow/...). Carry
  // it back onto the action so the destination picker, executor, and cost engine all Stride on the
  // chosen speed rather than reverting to walking.
  const movementAction = typeof step?.movementAction === "string" ? step.movementAction : null;
  const action = baseAction && movementAction ? { ...baseAction, movementAction } : baseAction;
  const stale = !action;
  const missingDestination = requiresDestinationForAction(action) && !step?.destination;
  const unavailableWarning = action?.availabilityWarning || (action?.available === false ? actionUnavailableReason(action) : "");
  const plannedCost = draftStepCost({ ...step, action });
  return {
    ...step,
    key,
    action,
    cost: plannedCost,
    actionCost: plannedCost,
    stale,
    warning: stale
      ? t("Disabled.NoLongerAvailable", "Action is no longer available.")
      : unavailableWarning || (missingDestination ? t("Warning.ChooseDestExec", "Choose destination at execution.") : ""),
  };
}

function resolveDraftSteps(draft, actionByKey, uniqueBaseKeys, draftStepActions = null) {
  if (!Array.isArray(draft?.steps)) return [];
  const decorated = draft.steps.map((step) => decorateDraftStep(step, actionByKey, uniqueBaseKeys, draftStepActions));
  return applyQuickenedCastingDiscount(decorated);
}

export function buildActionBuilderModel({
  context,
  candidates,
  draftFallbackActions = [],
  unavailableActions = [],
  rejected = [],
  plans = [],
  draft,
  draftStepActions = null,
  favorites = new Set(),
}) {
  const budget = actionBudget(context);
  const tabs = emptyTabs();
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites ?? []);
  // Sets iterate in insertion order, which is already the user's favorite-order (see
  // action-favorites.js) -- capture it once here for sorting tab.favorites below.
  const favoriteOrder = [...favoriteSet];
  // The dedicated sustained-spells section handles sustaining, so no "Sustain a Spell" action
  // is injected into the builder tabs.
  // Composites (Rush, Sudden Charge, ...) used to be hidden from Browse entirely because a manual
  // "+" push had no way to split them into their Stride/Strike atoms -- CombaterPanel._addAction
  // now atomizes on add the same way Auto-fill does (builderAtomicActionsForStep), so nothing is
  // ever hidden from Browse just because the planner also knows how to use it.
  const normalizedCandidates = expandMinionCommandRows(
    builderActionRows(candidates ?? [], { keepComposites: true }),
    draft,
  );
  const draftOnlyActions = builderActionRows(normalizeDraftOnlyActions(unavailableActions, rejected), { includeSyntheticInteract: false, keepComposites: true });
  const { keyedActions, baseKeyCounts } = assignActionKeys(normalizedCandidates);
  const sortedKeyedActions = [...keyedActions].toSorted((left, right) => {
    const scoreDelta = scoreValue(right.action) - scoreValue(left.action);
    if (scoreDelta !== 0) return scoreDelta;
    return actionName(left.action).localeCompare(actionName(right.action));
  });
  const fallbackDraftActions = builderActionRows(
    Array.isArray(draftFallbackActions) ? draftFallbackActions.filter(Boolean) : [],
    { includeSyntheticInteract: false },
  );
  const rawDraftResolution = draftResolutionMap(keyedActions, draftOnlyActions, fallbackDraftActions);
  const resolvedDraftSteps = resolveDraftSteps(draft, rawDraftResolution.actionByKey, rawDraftResolution.uniqueBaseKeys, draftStepActions);
  const usage = draftUsage(resolvedDraftSteps);
  // Anticipate Haste-style quickened during planning: the condition isn't applied until the spell
  // executes, so a drafted quickening spell aimed at the current combatant grants the extra action now.
  const anticipatedQuickened = draftAnticipatesQuickened(resolvedDraftSteps, context) ? 1 : 0;
  const quickenedActions = Math.max(budget.quickenedActions ?? 0, anticipatedQuickened);
  const quickenedUsed = Math.min(quickenedActions, usage.quickenedEligibleCost);
  const normalUsed = usage.normal - quickenedUsed;
  const normalRemaining = Math.max(0, budget.normalActions - normalUsed);
  const quickenedRemaining = Math.max(0, quickenedActions - quickenedUsed);
  const remainingNormalActions = normalRemaining;
  const remainingQuickenedActions = quickenedRemaining;
  const remainingTotalActions = Math.max(0, budget.normalActions + quickenedActions - usage.normal);
  const remainingActions = remainingNormalActions;
  const reactionPlanned = usage.reaction > 0;
  const decoratedActions = sortedKeyedActions
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const { keyedActions: keyedDraftOnlyActions } = assignActionKeys(draftOnlyActions);
  const { keyedActions: keyedDraftFallbackActions } = assignActionKeys(fallbackDraftActions);
  const decoratedDraftFallbackActions = keyedDraftFallbackActions
    .filter(({ key }) => !decoratedActions.some((action) => action.key === key))
    .map(({ action, key, baseKey }) => decorateAction(action, {
      key,
      baseKey,
      favorites: favoriteSet,
      baseKeyCounts,
      normalRemaining,
      quickenedRemaining,
      reactionPlanned,
    }));
  const decoratedDraftOnlyActions = keyedDraftOnlyActions
    .filter(({ key }) => !decoratedActions.some((action) => action.key === key)
      && !decoratedDraftFallbackActions.some((action) => action.key === key))
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
  for (const action of decoratedDraftFallbackActions) {
    if (!actionByKey.has(action.key)) actionByKey.set(action.key, action);
  }
  for (const action of decoratedDraftOnlyActions) {
    if (!actionByKey.has(action.key)) actionByKey.set(action.key, action);
  }
  const decoratedDraftResolution = draftResolutionMap(
    decoratedActions.map((action) => ({
      action,
      key: action.key,
      baseKey: action.baseKey,
    })),
    decoratedDraftOnlyActions,
    decoratedDraftFallbackActions,
  );
  const draftSteps = resolveDraftSteps(draft, actionByKey, decoratedDraftResolution.uniqueBaseKeys, draftStepActions);

  for (const action of decoratedActions.filter((entry) => entry.hideFromBuilder !== true)) {
    tabs[action.tabId].all.push(action);
  }
  for (const action of decoratedDraftOnlyActions.filter(showDisabledInBuilder)) {
    tabs[action.tabId].all.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.favorites = tab.all
      .filter((action) => action.favorite)
      .toSorted((left, right) => favoriteOrder.indexOf(left.favoriteEntryKey) - favoriteOrder.indexOf(right.favoriteEntryKey));
    tab.quickened = [];
    tab.recommended = tab.all.filter((action) => !action.disabled).slice(0, 3);
  }
  if (quickenedRemaining > 0) {
    tabs.one.quickened = quickenedShelfActions([
      ...decoratedActions,
      ...decoratedDraftFallbackActions,
      ...decoratedDraftOnlyActions,
    ]);
  }

  return {
    context,
    actionBudget: budget,
    usage,
    remainingActions,
    remainingNormalActions,
    remainingQuickenedActions,
    remainingTotalActions,
    tabs,
    draft: {
      ...(draft ?? {}),
      steps: draftSteps,
      uncounted: resolveDraftSteps({ steps: draft?.uncounted ?? [] }, actionByKey, decoratedDraftResolution.uniqueBaseKeys, draftStepActions),
      warnings: draftSteps.filter((step) => step.warning).map((step) => step.warning),
    },
    autoFill: plans[0] ?? null,
  };
}
