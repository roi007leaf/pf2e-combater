import { ACTION_BUILDER_TABS } from "../../engine/action/builder.js";
import {
  isSelfCenteredAreaAction,
  isTargetCenteredAreaAction,
  requiresAreaMarkerForAction,
  requiresDestinationForAction,
  requiresTargetForAction,
} from "../../engine/action/requirements.js";
import { executionReadinessForStep, nextPendingExecutionStep } from "../../engine/execution/state.js";
import { confidenceLabel } from "../../engine/confidence.js";
import { attacksTowardMap, isAttackAction, mapPenalty } from "../../engine/planner.js";
import { rkWarningLabel, rkWarningsForStep } from "../../engine/scoring/rk-warnings.js";
import { t } from "../../i18n.js";
import { actorMovementOptions } from "../../readers/actor-profile.js";
import { intelTargetKey, isNpcIntelTarget } from "../../rules/intel-ledger.js";
import { groupActionsByBuilderCategory } from "../action/categories.js";
import { actionDetailChips, traitChips } from "../action/details.js";
import { displayStepEntries } from "../display-steps.js";

export const DEFAULT_TAB = "one";
export const TABS = new Set(ACTION_BUILDER_TABS.map((tab) => tab.id));

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function camelCase(value) {
  return String(value ?? "").replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function actionCostClass(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  return `cost-${Math.max(1, Math.min(3, Number(cost) || 1))}`;
}

function actionCostLabel(cost) {
  if (cost === "reaction") return t("Cost.Reaction", "reaction");
  if (cost === 0) return t("Cost.Free", "free");
  const numeric = Math.max(1, Math.min(3, Number(cost) || 1));
  return t(numeric === 1 ? "Cost.ActionOne" : "Cost.ActionMany", numeric === 1 ? "{count} action" : "{count} actions", { count: numeric });
}

// PF2e action-cost key: 0/free -> "F", 1/2/3 -> "1"/"2"/"3", reaction -> "R".
function actionGlyph(cost) {
  if (cost === "reaction") return "R";
  if (cost === 0 || cost === "free") return "F";
  return String(Math.max(1, Math.min(3, Number(cost) || 1)));
}

// PF2e's own action-cost icon images, used in place of the action-glyph webfont.
const ACTION_GLYPH_ICONS = {
  1: "systems/pf2e/icons/actions/OneAction.webp",
  2: "systems/pf2e/icons/actions/TwoActions.webp",
  3: "systems/pf2e/icons/actions/ThreeActions.webp",
  R: "systems/pf2e/icons/actions/Reaction.webp",
  F: "systems/pf2e/icons/actions/FreeAction.webp",
};

function actionGlyphIcon(cost) {
  return ACTION_GLYPH_ICONS[actionGlyph(cost)] ?? ACTION_GLYPH_ICONS[1];
}

const GENERIC_ACTION_IMG = "systems/pf2e/icons/actions/Passive.webp";
const MAX_WHY_REASONS = 5;

function actionImage(source) {
  return source?.img
    ?? source?.item?.img
    ?? source?.item?.texture?.src
    ?? source?.strike?.imageUrl
    ?? source?.action?.img
    ?? GENERIC_ACTION_IMG;
}

function finiteScoreLabel(...sources) {
  for (const source of sources) {
    const value = Number(source?.autoFillScore ?? source?.score);
    if (!Number.isFinite(value)) continue;
    return t("Panel.ScoreLabel", "Score {score}", { score: Math.round(value) });
  }
  return "";
}

function whyReasonKey(reason) {
  const normalized = String(reason ?? "")
    .trim()
    .replace(/[.!?]+$/u, "")
    .toLowerCase();
  const check = normalized.replace(/^pf2e check preview:\s*/u, "");
  const moveStrike = check.match(/^(?:moves?|stride(?: twice)?) into reach and (?:attacks?|strike)\s+(.+)$/u);
  return moveStrike ? `move-strike:${moveStrike[1]}` : check;
}

function whyReasonSpecificity(reason) {
  const value = String(reason ?? "").trim();
  if (/^PF2e check preview:/u.test(value)) return 2;
  if (/^Stride(?: twice)? into reach and Strike\b/u.test(value)) return 2;
  return 1;
}

function pushReason(result, reason) {
  const value = String(reason ?? "").trim();
  if (!value) return;
  const key = whyReasonKey(value);
  const duplicateIndex = result.findIndex((existing) => whyReasonKey(existing) === key);
  if (duplicateIndex >= 0) {
    if (whyReasonSpecificity(value) > whyReasonSpecificity(result[duplicateIndex])) {
      result[duplicateIndex] = value;
    }
    return;
  }
  result.push(value);
}

function normalizedWhyReasons(...sources) {
  const result = [];
  for (const source of sources) {
    if (!source) continue;
    const explicit = Array.isArray(source?.autoFillReasons) ? source.autoFillReasons : [];
    for (const reason of explicit) pushReason(result, reason);
    pushReason(result, source?.autoFillReason);
    const reasons = Array.isArray(source?.reasons) ? source.reasons : [];
    for (const reason of reasons) pushReason(result, reason);
    pushReason(result, source?.reason);
  }
  return result.slice(0, MAX_WHY_REASONS);
}

function whyDetails(...sources) {
  const reasons = normalizedWhyReasons(...sources);
  const summary = reasons[0] ?? "";
  const scoreLabel = finiteScoreLabel(...sources);
  return {
    hasReasons: reasons.length > 0,
    label: t("Panel.WhyThisPlan", "Why"),
    title: t("Panel.WhyThisPlanTitle", "Why this plan?"),
    scoreLabel,
    summary,
    reasons,
    tooltip: scoreLabel ? `${scoreLabel}: ${summary}` : summary,
  };
}

function stepTraitSlugs(step) {
  const traits = Array.isArray(step?.traits) ? step.traits : [];
  return traits.map((trait) => String(trait?.slug ?? trait?.name ?? trait).toLowerCase());
}

function isRangedStep(step) {
  if (!step) return false;
  const increment = Number(step?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return true;

  const traits = stepTraitSlugs(step);
  if (traits.includes("ranged")) return true;

  const max = Number(step?.range?.max ?? step?.targetingProfile?.maxRange);
  const isThrown = traits.some((trait) => /^thrown(-\d+)?$/.test(trait));
  return isThrown && Number.isFinite(max) && max > 5;
}

function rangeLabelFor(step) {
  if (!isRangedStep(step)) return "";
  const increment = Number(step?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) {
    return t("Panel.RangeIncrement", "Range increment {value} ft", { value: increment });
  }
  const max = Number(step?.range?.max ?? step?.targetingProfile?.maxRange);
  return Number.isFinite(max) && max > 0
    ? t("Panel.Range", "Range {value} ft", { value: max })
    : t("Panel.Ranged", "Ranged");
}

export function withBuilderActionFields(action) {
  if (!action || action.requiresDestination === true || !requiresDestinationForAction(action)) return action;
  return { ...action, requiresDestination: true };
}

function plannedTargetLabel(step) {
  const label = String(step?.targetLabel ?? "").trim();
  if (label) return label;
  const ids = Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : [];
  return ids.length ? "Target planned" : "";
}

function recommendationTargetIds(action) {
  const target = action?.suggestedTarget ?? action?.preferredTarget ?? action?.target ?? null;
  return new Set([
    action?.targetingProfile?.preferredTargetId,
    target?.id,
    target?.uuid,
    target?.token?.id,
    target?.token?.uuid,
  ].filter(Boolean).map(String));
}

function targetForIntel(step, action = null) {
  return step?.suggestedTarget
    ?? step?.preferredTarget
    ?? step?.target
    ?? action?.suggestedTarget
    ?? action?.preferredTarget
    ?? action?.target
    ?? null;
}

function targetIntelKey(step, action = null) {
  const direct = intelTargetKey(targetForIntel(step, action));
  if (direct) return direct;
  const ids = Array.isArray(step?.targetTokenIds) ? step.targetTokenIds : [];
  return String(ids[0] ?? "");
}

function isAutoStoredRecommendationTarget(step, action) {
  if (step?.targetSelection === "manual") return false;
  const ids = Array.isArray(step?.targetTokenIds) ? step.targetTokenIds.map(String).filter(Boolean) : [];
  if (!ids.length) return false;
  const recommendedIds = recommendationTargetIds(action);
  return recommendedIds.size > 0 && ids.every((id) => recommendedIds.has(id));
}

export function explicitTargetFields(step, action) {
  return isAutoStoredRecommendationTarget(step, action)
    ? { targetTokenIds: [], targetLabel: "" }
    : { targetTokenIds: step?.targetTokenIds, targetLabel: step?.targetLabel };
}

function rawTargetName(step, action) {
  if (isAutoStoredRecommendationTarget(step, action)) return "";
  const direct = step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
  if (direct) return String(direct).trim();
  const label = plannedTargetLabel(step);
  if (/^Target planned$/i.test(label)) return "";
  return label.replace(/^Target:\s*/i, "").trim();
}

function stepTargetLabel(name, { requiresTarget, requiresDestination }) {
  if (!name) return "";
  if (requiresTarget) return `\u2192 ${name}`;
  if (requiresDestination) return "";
  return "";
}

export function normalizedSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isSustainAction(action) {
  return [
    action?.slug,
    action?.id,
    action?.key,
    action?.baseKey,
    action?.actionKey,
  ].some((value) => normalizedSlug(value) === "sustain-a-spell");
}

function areaLabel(areaMarker) {
  const label = String(areaMarker?.label ?? "").trim();
  if (label) return `Area: ${label}`;
  const shape = String(areaMarker?.shape ?? areaMarker?.type ?? "").trim();
  if (!shape) return "";
  const distance = Number(areaMarker?.distance ?? areaMarker?.radius);
  return Number.isFinite(distance) ? `Area: ${titleCase(shape)} ${distance} ft` : `Area: ${titleCase(shape)}`;
}

function minionPlanSource(...values) {
  return values.find((value) => value && Array.isArray(value.steps) && value.steps.length) ?? null;
}

function normalizeMinionStepKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleCaseSlug(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function minionStepName(value) {
  const direct = typeof value === "object" && value !== null
    ? value.name ?? value.label ?? value.title
    : value;
  const name = String(direct ?? "").trim();
  if (name) return name;
  const slug = typeof value === "object" && value !== null
    ? value.slug ?? value.key ?? value.action
    : "";
  return titleCaseSlug(slug) || t("Panel.UnknownAction", "Unknown action");
}

function minionStepKey(value, fallbackName = "") {
  const raw = typeof value === "object" && value !== null
    ? value.slug ?? value.key ?? value.action ?? value.name ?? value.label ?? value.title
    : value;
  return normalizeMinionStepKey(raw) || normalizeMinionStepKey(fallbackName);
}

function uniqueMinionStepNames(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const name = minionStepName(value);
    const key = minionStepKey(value, name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function minionActionOptions(plan) {
  return uniqueMinionStepNames([
    ...(Array.isArray(plan?.actionOptions) ? plan.actionOptions : []),
    ...(Array.isArray(plan?.steps) ? plan.steps : []),
  ]);
}

function minionPlanDisplayLabel(plan, steps) {
  const minion = String(plan?.minionName ?? t("MinionPlan.Minion", "Companion")).trim()
    || t("MinionPlan.Minion", "Companion");
  const stepText = steps.join(" -> ");
  const target = String(plan?.targetName ?? "").trim();
  return target
    ? t("MinionPlan.Label", "{minion}: {steps} vs {target}", { minion, steps: stepText, target })
    : t("MinionPlan.LabelNoTarget", "{minion}: {steps}", { minion, steps: stepText });
}

function normalizeMovementOptions(options) {
  const seen = new Set();
  const result = [];
  for (const option of Array.isArray(options) ? options : []) {
    const action = String(option?.action ?? "").trim().toLowerCase();
    if (!action || seen.has(action)) continue;
    seen.add(action);
    const speed = Number(option?.speed);
    result.push({ action, speed: Number.isFinite(speed) ? speed : 0 });
  }
  return result;
}

function tokenIdMatchesMinion(token, plan) {
  const document = token?.document ?? token;
  const wanted = String(plan?.minionId ?? "");
  if (!wanted) return false;
  const actor = tokenActor(token);
  return [token?.id, token?.uuid, document?.id, document?.uuid, actor?.id, actor?.uuid]
    .some((value) => String(value ?? "") === wanted);
}

function tokenActor(token) {
  return token?.actor?.document
    ?? token?.actor
    ?? token?.document?.actor?.document
    ?? token?.document?.actor
    ?? null;
}

function canvasTokens() {
  const placeables = globalThis.canvas?.tokens?.placeables;
  return Array.isArray(placeables) ? placeables.filter(Boolean) : [];
}

function tokenNameMatchesMinion(token, plan) {
  const wanted = String(plan?.minionName ?? "").trim().toLowerCase();
  if (!wanted) return false;
  const document = token?.document ?? token;
  const actor = tokenActor(token);
  return [token?.name, document?.name, actor?.name]
    .some((value) => String(value ?? "").trim().toLowerCase() === wanted);
}

function contextMinionActor(plan, context) {
  const wanted = String(plan?.minionId ?? "");
  const minions = [
    ...(Array.isArray(context?.minions) ? context.minions : []),
    ...(Array.isArray(context?.companions) ? context.companions : []),
  ];
  const minion = minions.find((candidate) => tokenIdMatchesMinion(candidate?.token ?? candidate, plan)
    || String(candidate?.id ?? "") === wanted
    || String(candidate?.actor?.id ?? "") === wanted
    || String(candidate?.actor?.uuid ?? "") === wanted);
  return minion?.actor?.document ?? minion?.actor ?? tokenActor(minion?.token) ?? null;
}

function liveMinionActor(plan) {
  const byId = canvasTokens().find((token) => tokenIdMatchesMinion(token, plan));
  if (byId) return tokenActor(byId);
  const byName = canvasTokens().find((token) => tokenNameMatchesMinion(token, plan));
  return byName ? tokenActor(byName) : null;
}

function mergeMovementOptions(...optionLists) {
  const merged = [];
  const seen = new Set();
  for (const option of optionLists.flat()) {
    const action = String(option?.action ?? "").trim().toLowerCase();
    if (!action || seen.has(action)) continue;
    seen.add(action);
    merged.push(option);
  }
  return merged;
}

function movementOptionsForMinionPlan(plan, context) {
  const planned = normalizeMovementOptions(plan?.movementOptions);
  const actor = liveMinionActor(plan) ?? contextMinionActor(plan, context);
  const live = normalizeMovementOptions(actorMovementOptions(actor));
  return mergeMovementOptions(planned, live);
}

function decorateMinionPlan(plan, { instanceId = "", canCycle = false, context = null } = {}) {
  if (!plan) return null;
  const actionOptions = minionActionOptions(plan);
  const movementOptions = movementOptionsForMinionPlan(plan, context);
  const displaySteps = plan.steps.map((step) => minionStepName(step));
  const interactive = Boolean(instanceId && canCycle);
  const canCycleAction = interactive && actionOptions.length > 1;
  const stepStates = Array.isArray(plan.stepStates) ? plan.stepStates : [];
  const movementActions = new Set(["stride", "step", "leap"]);
  const nonTargetActions = new Set(["stride", "step", "leap", "stand", "seek", "drop-prone"]);
  const steps = plan.steps.map((step, index) => {
    const name = minionStepName(step);
    const state = stepStates[index] ?? {};
    const status = executionStatus(state);
    const isDone = status === "done";
    const actionSlug = minionStepKey(step, name);
    const requiresDestination = movementActions.has(actionSlug);
    const requiresTarget = !nonTargetActions.has(actionSlug);
    const destinationSet = Boolean(state.destination);
    const executionBlocked = requiresDestination && !destinationSet;
    const movementAction = String(state.movementAction ?? movementOptions[0]?.action ?? "walk").toLowerCase();
    const movementToolLabel = movementActionLabel(movementAction);
    const canShowMovementControl = interactive && !isDone && actionSlug === "stride" && movementOptions.length > 0;
    const canCycleMovement = canShowMovementControl && movementOptions.length > 1;
    const movementToolTip = canCycleMovement
      ? t("Panel.MovementCycle", "Stride on {label} Speed. Click to change.", { label: movementToolLabel })
      : t("Panel.MovementLabel", "Stride on {label} Speed.", { label: movementToolLabel });
    return {
      id: `${plan.minionId ?? "minion"}-${index}`,
      position: index + 1,
      name,
      canCycle: canCycleAction && !isDone,
      canChooseTarget: interactive && !isDone && requiresTarget,
      canChooseDestination: interactive && !isDone && requiresDestination,
      canShowMovementControl,
      canCycleMovement,
      canExecute: interactive && !isDone,
      canRemoveStep: interactive && !isDone,
      canRevertStep: interactive && isDone,
      isExecutionDone: isDone,
      executionBlocked,
      cycleInstanceId: instanceId,
      cycleIndex: index,
      targetName: plan.targetName ?? "",
      targetLabel: requiresTarget && plan.targetName ? t("MinionPlan.TargetLabel", "vs {target}", { target: plan.targetName }) : "",
      destinationLabel: destinationSet ? t("MinionPlan.DestinationSet", "Destination set") : "",
      tooltip: isDone
        ? t("MinionPlan.ExecutedStep", "This minion action has been executed.")
        : t("MinionPlan.CycleStep", "Click to change this minion action. Right-click or Shift-click for previous."),
      chooseTargetTooltip: t("MinionPlan.ChooseTarget", "Use current Foundry target for this minion action."),
      chooseDestinationTooltip: t("MinionPlan.ChooseDestination", "Choose this minion action's destination."),
      movementToolLabel,
      movementToolTip,
      executeTooltip: executionBlocked
        ? t("MinionPlan.ChooseDestinationFirst", "Choose a destination before executing this minion action.")
        : t("MinionPlan.ExecuteStep", "Execute this minion action."),
      removeTooltip: t("Panel.Remove", "Remove"),
      revertTooltip: t("MinionPlan.RevertStep", "Revert this minion action."),
    };
  });
  return {
    label: plan.label ?? minionPlanDisplayLabel(plan, displaySteps),
    minionName: plan.minionName ?? t("MinionPlan.Minion", "Companion"),
    targetName: plan.targetName ?? "",
    actionOptions,
    steps,
    hasSteps: steps.length > 0,
    hasChildRows: interactive && steps.length > 0,
  };
}

export function executionStatus(step) {
  const status = String(step?.execution?.status ?? "pending").toLowerCase();
  return ["done", "failed"].includes(status) ? status : "pending";
}

function executionLabel(step) {
  const status = executionStatus(step);
  if (status === "done") return t("Panel.Done", "Done");
  if (status === "failed") return step?.execution?.error
    ? t("Panel.FailedReason", "Failed: {error}", { error: step.execution.error })
    : t("Panel.Failed", "Failed");
  return "";
}

function decorateStep(step, displayIndex, sourceIndex = displayIndex) {
  const cost = step?.actionCost ?? step?.cost ?? 1;
  const targetName = step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
  const rangeLabel = rangeLabelFor(step);
  const minionPlan = decorateMinionPlan(minionPlanSource(step?.activityProfile?.minionPlan, step?.minionPlan));
  const minionPlanLabel = minionPlan?.label ?? "";
  const intelTarget = targetForIntel(step);
  const targetKey = isNpcIntelTarget(intelTarget) ? targetIntelKey(step) : "";
  const why = whyDetails(step);
  return {
    ...step,
    index: sourceIndex,
    displayIndex,
    costClass: actionCostClass(cost),
    costLabel: actionCostLabel(cost),
    actionGlyphIcon: actionGlyphIcon(cost),
    img: actionImage(step),
    reason: why.summary,
    why,
    targetLabel: targetName ? `Target: ${targetName}` : "",
    targetIntelKey: targetKey,
    canOpenTargetIntel: Boolean(targetName && targetKey),
    targetIntelTooltip: t("Intel.TargetTooltip", "View known intel for this target."),
    mapLabel: step?.mapPenalty > 0 ? `MAP -${step.mapPenalty}` : "",
    isRanged: Boolean(rangeLabel),
    rangeLabel,
    minionPlan,
    minionPlanLabel,
    sourceLabel: titleCase(step?.source),
  };
}

export function decoratePlan(plan, index = 0) {
  const confidence = plan?.confidence ?? "low";
  const steps = displayStepEntries(plan?.steps)
    .map((entry, stepIndex) => decorateStep(entry.step, stepIndex, entry.sourceIndex));
  return {
    ...plan,
    index,
    rank: index + 1,
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
    steps,
    hasSteps: steps.length > 0,
    reason: plan?.reason ?? plan?.steps?.[0]?.reason ?? "No recommendation available.",
  };
}

function decorateAction(action, options = {}) {
  const decorated = decorateStep(action, 0, 0);
  const detailChips = actionDetailChips(action);
  return {
    ...decorated,
    favoriteTitle: action?.favorite ? "Remove favorite" : "Add favorite",
    disabledTitle: action?.disabled ? action.disabledReason : "Add to draft",
    requiresDestination: requiresDestinationForAction(action),
    targetLabel: options.hideTarget ? "" : decorated.targetLabel,
    detailChips,
    hasDetailChips: detailChips.length > 0,
    readonly: options.readonly === true,
    canDragFavorite: options.canDragFavorite === true && options.readonly !== true,
  };
}

export function stepMovementAction(step) {
  const raw = String(step?.movementAction ?? step?.action?.movementAction ?? "").toLowerCase();
  if (raw && raw !== "step") return raw;
  const slug = String(step?.slug ?? step?.action?.slug ?? "").toLowerCase();
  if (slug === "crawl") return "crawl";
  return "walk";
}

function movementActionLabel(action) {
  switch (action) {
    case "fly": return t("Movement.Fly", "Fly");
    case "burrow": return t("Movement.Burrow", "Burrow");
    case "swim": return t("Movement.Swim", "Swim");
    case "climb": return t("Movement.Climb", "Climb");
    default: return t("Movement.Walk", "Walk");
  }
}

function isSpeedBasedMovementStep(action) {
  if (!action || action?.activityProfile?.teleport === true) return false;
  if (!requiresDestinationForAction(action)) return false;
  const slug = String(action?.slug ?? action?.action?.slug ?? "").toLowerCase();
  return slug !== "step" && slug !== "crawl";
}

function decorateDraftStep(step, index, { readonly = false, gmExecute = false, reorderLocked = false, awaitingGm = null, movementOptions = [], weaponOptions = [], context = null } = {}) {
  const isAwaitingGm = awaitingGm?.has?.(step?.instanceId) === true;
  const action = step?.action ? decorateAction(step.action) : null;
  const plannedCost = step?.actionCost ?? step?.cost ?? action?.actionCost ?? action?.cost;
  const displaySource = action
    ? { ...action, actionCost: plannedCost, cost: plannedCost }
    : step;
  const display = decorateStep(displaySource, index, index);
  const requiresDestination = requiresDestinationForAction(action ?? step);
  const requiresTarget = requiresTargetForAction(action ?? step);
  const requiresArea = requiresAreaMarkerForAction(action ?? step);
  const canChooseArea = requiresArea && !isSelfCenteredAreaAction(action ?? step) && !isTargetCenteredAreaAction(action ?? step);
  const stepTraitChips = traitChips(action ?? step);
  const status = executionStatus(step);
  const isExecutionDone = status === "done";
  const canRunStep = readonly !== true || gmExecute === true;
  const sustainLabel = isSustainAction(action ?? step) && step?.sustainedSpell?.name
    ? t("Panel.SustainLabel", "Sustain: {name}", { name: step.sustainedSpell.name })
    : "";
  const targetLabel = sustainLabel || stepTargetLabel(rawTargetName(step, action), { requiresTarget, requiresDestination });
  const draftIntelTarget = targetForIntel(step, action);
  const draftTargetIntelKey = isNpcIntelTarget(draftIntelTarget) ? targetIntelKey(step, action) : "";
  const minionPlan = decorateMinionPlan(minionPlanSource(
    step?.activityProfile?.minionPlan,
    action?.activityProfile?.minionPlan,
    display.minionPlan,
  ), { instanceId: step?.instanceId, canCycle: canRunStep && !isExecutionDone, context });
  const minionPlanAsChildren = Boolean(minionPlan?.hasChildRows);
  const minionPlanLabel = minionPlan?.label ?? display.minionPlanLabel ?? "";
  const stepAreaLabel = areaLabel(step?.areaMarker);
  const readiness = isExecutionDone
    ? { status: "ready", choices: [], warning: "" }
    : executionReadinessForStep(step, action ?? step);
  const rawWarning = step?.warning === "Choose a destination." ? t("Warning.ChooseDestExec", "Choose destination at execution.") : step?.warning;
  const rkWarnings = isExecutionDone ? [] : rkWarningsForStep(context, step, action ?? step);
  const advisoryWarning = rkWarningLabel(rkWarnings);
  const warning = isExecutionDone ? "" : (readiness.warning || rawWarning || advisoryWarning);
  const canShowExecuteStep = !minionPlanAsChildren && canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true;
  const executionBlocked = canShowExecuteStep && readiness.status !== "ready";
  const canEditStepOrder = readonly !== true && reorderLocked !== true;
  const canDuplicateStep = readonly !== true && !step?.groupId && !minionPlanAsChildren;
  const canRemoveDraftStep = readonly !== true && !minionPlanAsChildren;
  const isAttackStep = Number.isFinite(step?.attackIndex);
  const mapPenaltyValue = Number(step?.mapPenalty) || 0;
  const mapToolLabel = mapPenaltyValue > 0
    ? t("Panel.MapValue", "MAP -{penalty}", { penalty: mapPenaltyValue })
    : t("Panel.MapFull", "MAP 0");
  const mapPinned = step?.mapPinned === true;
  const mapToolTip = mapPinned
    ? t("Panel.MapPinned", "MAP pinned to {label}. Click to cycle.", { label: mapToolLabel })
    : t("Panel.MapAuto", "MAP auto ({label}). Click to pin.", { label: mapToolLabel });
  const movementAction = stepMovementAction(step);
  const movementToolLabel = movementActionLabel(movementAction);
  const canCycleMovement = isSpeedBasedMovementStep(action ?? step)
    && canRunStep && !isExecutionDone && movementOptions.length > 1;
  const movementToolTip = t("Panel.MovementCycle", "Stride on {label} Speed. Click to change.", { label: movementToolLabel });
  const weaponToolLabel = action?.item?.name ?? t("Panel.WeaponDefault", "Default");
  const isStrikeAtom = action?.executable === "strike" || action?.source === "strike";
  const canCycleWeapon = Boolean(step?.groupId) && isStrikeAtom && canRunStep && !isExecutionDone && weaponOptions.length > 1;
  const weaponToolTip = t("Panel.WeaponCycle", "Attacking with {label}. Click to change.", { label: weaponToolLabel });
  const persistedWhy = whyDetails(step);
  const why = persistedWhy.hasReasons ? persistedWhy : whyDetails(action, display);
  return {
    ...display,
    ...step,
    action,
    displayIndex: index,
    position: index + 1,
    instanceId: step?.instanceId,
    readonly,
    name: action?.name ?? step?.name ?? step?.actionKey ?? t("Panel.UnknownAction", "Unknown action"),
    reason: why.summary,
    why,
    targetLabel,
    targetIntelKey: draftTargetIntelKey,
    canOpenTargetIntel: Boolean(targetLabel && !sustainLabel && draftTargetIntelKey),
    targetIntelTooltip: t("Intel.TargetTooltip", "View known intel for this target."),
    minionPlan,
    minionPlanAsChildren,
    minionPlanLabel,
    requiresDestination,
    requiresTarget,
    requiresArea,
    canChooseArea,
    areaLabel: stepAreaLabel,
    hasAreaMarker: Boolean(step?.areaMarker),
    executionStatus: status,
    executionLabel: executionLabel(step),
    executionTooltip: step?.execution?.error ?? executionLabel(step),
    isExecutionDone,
    isExecutionFailed: status === "failed",
    canShowExecuteStep,
    canExecuteStep: canShowExecuteStep && !isAwaitingGm && readiness.status === "ready",
    canDuplicateStep,
    canRemoveDraftStep,
    executionBlocked: executionBlocked || isAwaitingGm,
    executeTooltip: isAwaitingGm
      ? t("Panel.AwaitingGm", "Waiting for the GM\u2026")
      : (executionBlocked
          ? (readiness.warning || t("Notify.ResolveChoices", "Resolve required choices before executing."))
          : (advisoryWarning ? `${t("Panel.ExecuteStep", "Execute this step")} ${advisoryWarning}` : t("Panel.ExecuteStep", "Execute this step"))),
    awaitingGm: isAwaitingGm,
    awaitingGmLabel: t("Panel.AwaitingGm", "Waiting for the GM\u2026"),
    canCycleMap: isAttackStep && canRunStep && !isExecutionDone,
    mapToolLabel,
    mapToolTip,
    mapPinned,
    canCycleMovement,
    movementToolLabel,
    movementToolTip,
    canCycleWeapon,
    weaponToolLabel,
    weaponToolTip,
    canDragStep: canEditStepOrder,
    canRevertStep: !minionPlanAsChildren && isExecutionDone && canRunStep,
    warning,
    traitChips: stepTraitChips,
    hasTraitChips: stepTraitChips.length > 0,
    hasStepDetails: Boolean(targetLabel || (!minionPlanAsChildren && (minionPlan || minionPlanLabel)) || stepAreaLabel || warning || isAwaitingGm || stepTraitChips.length > 0 || display.isRanged),
  };
}

function filterBuilderTabActions(actions, query) {
  const terms = searchTerms(query);
  if (!terms.length) return actions;
  return actions.filter((action) => {
    const haystack = actionSearchHaystack(action);
    return terms.every((term) => haystack.includes(term));
  });
}

function decorateBuilderTab(tab, activeTab, { readonly = false, searchQuery = "" } = {}) {
  const quickenedActions = filterBuilderTabActions(tab.quickened ?? [], searchQuery)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const categorizedActions = filterBuilderTabActions(tab.all, searchQuery)
    .filter((action) => !action.favorite)
    .map((action) => decorateAction(action, { hideTarget: true, readonly }));
  const sections = [
    {
      id: "favorites",
      label: t("Section.Favorites", "Favorites"),
      isFavoritesSection: true,
      actions: filterBuilderTabActions(tab.favorites, searchQuery)
        .map((action) => decorateAction(action, { readonly, canDragFavorite: true })),
    },
    ...(quickenedActions.length
      ? [{ id: "quickened", label: t("Section.Quickened", "Quickened actions"), actions: quickenedActions }]
      : []),
    ...groupActionsByBuilderCategory(categorizedActions),
  ];
  return {
    ...tab,
    active: tab.id === activeTab,
    glyphIcon: actionGlyphIcon(tab.cost),
    searchQuery: String(searchQuery ?? ""),
    sections: sections.map((section) => ({
      ...section,
      hasActions: section.actions.length > 0,
    })),
  };
}

function actionSearchHaystack(action) {
  return [
    action?.name,
    action?.slug,
  ].map((part) => String(part ?? "").toLowerCase()).join(" ");
}

function searchTerms(query) {
  return String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function remainingActionPoolSummary(builder) {
  const normal = Number(builder?.remainingNormalActions ?? 0);
  const quickened = Number(builder?.remainingQuickenedActions ?? 0);
  if (quickened <= 0) {
    return t(
      normal === 1 ? "Summary.NormalActionLeft" : "Summary.NormalActionsLeft",
      normal === 1 ? "{count} normal action left" : "{count} normal actions left",
      { count: normal },
    );
  }
  return t("Summary.NormalQuickenedLeft", "{normal} normal, {quickened} quickened left", { normal, quickened });
}

function decoratedSustainedSpells(entries, { readonly = false } = {}) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const effectCount = entry.effectIds?.length ?? entry.effects?.length ?? 0;
    const templateCount = entry.templateRefs?.length ?? 0;
    const statusLabel = entry.sustained
      ? t("Sustain.Sustained", "Sustained")
      : entry.planned ? t("Sustain.Planned", "Planned") : t("Sustain.NeedsSustain", "Needs sustain");
    const detailParts = [];
    if (effectCount) {
      detailParts.push(t(effectCount === 1 ? "Sustain.EffectOne" : "Sustain.EffectMany", effectCount === 1 ? "{count} effect" : "{count} effects", { count: effectCount }));
    }
    if (templateCount) {
      detailParts.push(t(templateCount === 1 ? "Sustain.TemplateOne" : "Sustain.TemplateMany", templateCount === 1 ? "{count} template" : "{count} templates", { count: templateCount }));
    }
    return {
      ...entry,
      effectCount,
      templateCount,
      detailLabel: detailParts.join(" - "),
      statusLabel,
      statusClass: entry.sustained ? "is-sustained" : entry.planned ? "is-planned" : "needs-sustain",
      canAdd: readonly !== true && entry.planned !== true && entry.sustained !== true,
    };
  });
}

export function sustainedSpellDraftFields(entry) {
  return {
    id: entry?.id,
    name: entry?.name ?? t("Sustain.DefaultName", "Sustained spell"),
    spellUuid: entry?.spellUuid ?? null,
    effectIds: Array.isArray(entry?.effectIds) ? [...entry.effectIds] : [],
    templateRefs: Array.isArray(entry?.templateRefs) ? [...entry.templateRefs] : [],
  };
}

function injectMapInfo(steps, startCount = 0) {
  let attackCount = startCount;
  const list = Array.isArray(steps) ? steps : [];
  const tagged = [];
  let i = 0;
  while (i < list.length) {
    const step = list[i];
    const action = step?.action ?? step;
    if (!isAttackAction(action)) {
      tagged.push(step);
      i += 1;
      continue;
    }
    const groupId = step?.groupId;
    const perStrikeMap = action?.activityProfile?.mapAppliesPerStrike === true;
    let end = i + 1;
    if (groupId && !perStrikeMap) {
      while (end < list.length && list[end]?.groupId === groupId) end += 1;
    }
    const groupSteps = list.slice(i, end);
    const autoLevel = Math.min(2, attackCount);
    attackCount += attacksTowardMap(groupSteps[0]?.action ?? groupSteps[0]);
    for (const groupStep of groupSteps) {
      const groupAction = groupStep?.action ?? groupStep;
      const override = Number.isFinite(groupStep?.mapOverride) ? Math.max(0, Math.min(2, groupStep.mapOverride)) : null;
      const level = override ?? autoLevel;
      const penalty = mapPenalty(groupAction, level);
      tagged.push({
        ...groupStep,
        attackIndex: level + 1,
        mapPenalty: penalty,
        mapPinned: override !== null,
        action: groupStep?.action ? { ...groupStep.action, mapPenalty: penalty } : groupStep?.action,
      });
    }
    i = end;
  }
  return { steps: tagged, attackCount };
}

export function groupDraftSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const grouped = [];
  let i = 0;
  while (i < list.length) {
    const step = list[i];
    const groupId = step?.groupId;
    if (!groupId) {
      grouped.push(step);
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < list.length && list[end]?.groupId === groupId) end += 1;
    const members = list.slice(i, end);
    if (members.length < 2) {
      grouped.push(step);
      i += 1;
      continue;
    }
    const prefix = `${members[0].groupLabel} -> `;
    const groupTraitChips = traitChips({ traits: members[0].groupTraits ?? [], item: members[0].groupItem ?? null });
    grouped.push({
      isGroup: true,
      groupLabel: members[0].groupLabel,
      instanceId: members[0].instanceId,
      actionGlyphIcon: members[0].actionGlyphIcon,
      costLabel: members[0].costLabel,
      canDragStep: members[0].canDragStep,
      groupItem: members[0].groupItem ?? null,
      groupUuid: members[0].groupUuid ?? null,
      traitChips: groupTraitChips,
      hasTraitChips: groupTraitChips.length > 0,
      children: members.map((member) => ({
        ...member,
        name: member.name?.startsWith(prefix) ? member.name.slice(prefix.length) : member.name,
        canDragStep: false,
        isGroupChild: true,
      })),
    });
    i = end;
  }
  return grouped;
}

export function decorateBuilder(builder, activeTab, searchQuery = "", { sustainedSpells = [], awaitingGm = null, movementOptions = [], weaponOptions = [] } = {}) {
  if (!builder) return null;
  const draftReadonly = builder.draft?.readonly === true;
  const isPlayerPlan = builder.draft?.shared === true;
  const gmCanRunPlayerPlan = globalThis.game?.user?.isGM === true && isPlayerPlan;
  const sharedDraftUserName = String(builder.draft?.userName ?? "").trim();
  const rawSteps = builder.draft?.steps ?? [];
  const reorderLocked = rawSteps.some((step) => executionStatus(step) !== "pending");
  const planMap = injectMapInfo(rawSteps, 0);
  const rawDraftSteps = planMap.steps
    .map((step, index) => decorateDraftStep(step, index, {
      readonly: draftReadonly,
      gmExecute: gmCanRunPlayerPlan,
      reorderLocked,
      awaitingGm,
      movementOptions,
      weaponOptions,
      context: builder.context,
    }));
  const currentExecutionStep = nextPendingExecutionStep({ steps: rawDraftSteps });
  const draftSteps = rawDraftSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentExecutionStep?.instanceId,
  }));
  const active = TABS.has(activeTab) ? activeTab : DEFAULT_TAB;
  const sustainedEntries = decoratedSustainedSpells(sustainedSpells, { readonly: draftReadonly });
  const rawUncounted = builder.draft?.uncounted ?? [];
  const uncountedReorderLocked = rawUncounted.some((step) => executionStatus(step) !== "pending");
  const uncountedMap = injectMapInfo(rawUncounted, planMap.attackCount);
  const rawUncountedSteps = uncountedMap.steps.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    reorderLocked: uncountedReorderLocked,
    awaitingGm,
    movementOptions,
    weaponOptions,
    context: builder.context,
  }));
  const currentUncountedStep = nextPendingExecutionStep({ steps: rawUncountedSteps });
  const uncountedEntries = rawUncountedSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentUncountedStep?.instanceId,
  }));
  const allExecutable = [...draftSteps, ...uncountedEntries];
  const executedCount = allExecutable.filter((step) => step.executionStatus === "done").length;
  const canResetExecution = allExecutable.some((step) => step.executionStatus === "done" || step.executionStatus === "failed");
  const decoratedTabsList = ACTION_BUILDER_TABS.map((tab) => ({
    ...decorateBuilderTab(builder.tabs[tab.id], active, { readonly: draftReadonly, searchQuery }),
    label: t(`Tab.${tab.id}`, tab.label),
  }));
  const mergedSearchResults = decoratedTabsList.flatMap((tab) => tab.sections
    .filter((section) => section.hasActions)
    .map((section) => ({ ...section, tabLabel: tab.label })));
  return {
    ...builder,
    readonly: draftReadonly,
    tabsList: decoratedTabsList,
    mergedSearchResults,
    activeTab: active,
    activeTabLabel: t(`Tab.${active}`, ACTION_BUILDER_TABS.find((tab) => tab.id === active)?.label ?? "1 Action"),
    searchQuery: String(searchQuery ?? ""),
    draft: {
      ...(builder.draft ?? {}),
      steps: draftSteps,
      hasSteps: draftSteps.length > 0,
      readonly: draftReadonly,
      countLabel: draftSteps.length
        ? t(draftSteps.length === 1 ? "Summary.StepOne" : "Summary.StepMany", draftSteps.length === 1 ? "{count} step" : "{count} steps", { count: draftSteps.length })
        : t("Summary.Empty", "Empty"),
      confidenceClass: draftSteps.length ? "medium" : "low",
      warnings: [...new Set(draftSteps.map((step) => step.warning).filter(Boolean))],
    },
    sustainedSpells: {
      hasEntries: sustainedEntries.length > 0,
      entries: sustainedEntries,
    },
    uncounted: {
      hasEntries: uncountedEntries.length > 0,
      entries: uncountedEntries,
    },
    execution: {
      hasSteps: allExecutable.length > 0,
      canReset: (draftReadonly !== true || gmCanRunPlayerPlan) && canResetExecution,
      progressLabel: executedCount > 0 ? t("Summary.Progress", "{done}/{total} done", { done: executedCount, total: allExecutable.length }) : "",
      hasStatus: ((draftReadonly !== true || gmCanRunPlayerPlan) && canResetExecution) || executedCount > 0,
      current: currentExecutionStep ?? null,
      currentInstanceId: currentExecutionStep?.instanceId ?? "",
    },
    isPlayerPlan,
    playerPlanLabel: t("Summary.PlayerPlan", "Player plan"),
    playerPlanTooltip: sharedDraftUserName
      ? t("Summary.PlayerPlanFrom", "Player plan from {user}", { user: sharedDraftUserName })
      : t("Summary.PlayerPlan", "Player plan"),
    poolSummary: remainingActionPoolSummary(builder),
    totalSummary: t(
      builder.remainingTotalActions === 1 ? "Summary.TotalActionLeft" : "Summary.TotalActionsLeft",
      builder.remainingTotalActions === 1 ? "{count} total action left" : "{count} total actions left",
      { count: builder.remainingTotalActions },
    ),
    reactionSummary: builder.usage?.reaction ? t("Summary.ReactionPlanned", "Reaction planned") : t("Summary.ReactionOpen", "Reaction open"),
  };
}

export function debugAction(action, index) {
  const profileParts = action?.activityProfile
    ? Object.entries(action.activityProfile)
      .filter(([, value]) => value === true || Number.isFinite(value))
      .map(([key, value]) => value === true ? camelCase(key) : `${camelCase(key)}:${value}`)
    : [];
  const skillCheckLabel = action?.skillCheck?.label ?? "";
  if (skillCheckLabel) profileParts.push(skillCheckLabel);
  return {
    index,
    name: action?.name ?? t("Panel.UnknownAction", "Unknown action"),
    slug: action?.slug ?? "",
    source: action?.source ?? "",
    role: action?.role ?? "",
    profile: profileParts.join(", "),
    skillCheckLabel,
    available: action?.available !== false,
    score: Number.isFinite(action?.score) ? action.score : null,
    costLabel: actionCostLabel(action?.actionCost ?? 1),
    targetLabel: action?.suggestedTarget?.name ?? "",
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
  };
}

export function markManualDraft(draft) {
  return {
    ...draft,
    source: "manual",
    autoFillPlanId: null,
    autoFillPlanSummary: "",
  };
}
