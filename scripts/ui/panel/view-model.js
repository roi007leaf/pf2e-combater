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
import { t } from "../../i18n.js";
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

function actionImage(source) {
  return source?.img
    ?? source?.item?.img
    ?? source?.item?.texture?.src
    ?? source?.strike?.imageUrl
    ?? source?.action?.img
    ?? GENERIC_ACTION_IMG;
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
  return {
    ...step,
    index: sourceIndex,
    displayIndex,
    costClass: actionCostClass(cost),
    costLabel: actionCostLabel(cost),
    actionGlyphIcon: actionGlyphIcon(cost),
    img: actionImage(step),
    reason: step?.reason ?? step?.reasons?.[0] ?? "",
    targetLabel: targetName ? `Target: ${targetName}` : "",
    mapLabel: step?.mapPenalty > 0 ? `MAP -${step.mapPenalty}` : "",
    isRanged: Boolean(rangeLabel),
    rangeLabel,
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

function decorateDraftStep(step, index, { readonly = false, gmExecute = false, reorderLocked = false, awaitingGm = null, movementOptions = [], weaponOptions = [] } = {}) {
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
  const stepAreaLabel = areaLabel(step?.areaMarker);
  const readiness = isExecutionDone
    ? { status: "ready", choices: [], warning: "" }
    : executionReadinessForStep(step, action ?? step);
  const rawWarning = step?.warning === "Choose a destination." ? t("Warning.ChooseDestExec", "Choose destination at execution.") : step?.warning;
  const warning = isExecutionDone ? "" : (readiness.warning || rawWarning);
  const canShowExecuteStep = canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true;
  const executionBlocked = canShowExecuteStep && readiness.status !== "ready";
  const canEditStepOrder = readonly !== true && reorderLocked !== true;
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
  return {
    ...display,
    ...step,
    action,
    displayIndex: index,
    position: index + 1,
    instanceId: step?.instanceId,
    readonly,
    name: action?.name ?? step?.name ?? step?.actionKey ?? t("Panel.UnknownAction", "Unknown action"),
    reason: action?.reason ?? step?.reason ?? "",
    targetLabel,
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
    canExecuteStep: !isAwaitingGm && canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true && readiness.status === "ready",
    executionBlocked: executionBlocked || isAwaitingGm,
    executeTooltip: isAwaitingGm
      ? t("Panel.AwaitingGm", "Waiting for the GM\u2026")
      : (executionBlocked ? (readiness.warning || t("Notify.ResolveChoices", "Resolve required choices before executing.")) : t("Panel.ExecuteStep", "Execute this step")),
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
    canRevertStep: isExecutionDone && canRunStep,
    warning,
    traitChips: stepTraitChips,
    hasTraitChips: stepTraitChips.length > 0,
    hasStepDetails: Boolean(targetLabel || stepAreaLabel || warning || isAwaitingGm || stepTraitChips.length > 0 || display.isRanged),
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
