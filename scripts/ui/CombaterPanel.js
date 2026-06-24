import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { SETTINGS, setting } from "../settings.js";
import {
  buildActionBuilderModel,
  actionBuilderKey,
  ACTION_BUILDER_TABS,
  builderAtomicActionsForStep,
  projectContextForDraftDestination,
  projectContextForDraftStepOrigin,
  requiresDestinationForAction,
  SUSTAIN_A_SPELL_ACTION,
} from "../engine/action-builder.js";
import {
  currentTargetSelection,
  executeDraftStep,
  executionReadinessForStep,
  nextPendingExecutionStep,
  requiresAreaMarkerForAction,
  requiresTargetForAction,
  setTokenTargets,
  targetTokenId,
  tokensInAreaMarker,
} from "../engine/action-executor.js";
import { revertDraftExecution, revertDraftStep } from "../engine/action-revert.js";
import { buildCandidates } from "../engine/candidates.js";
import { confidenceLabel } from "../engine/confidence.js";
import { bestTurnPlan, buildTurnPlans } from "../engine/planner.js";
import { readActionFavorites, toggleActionFavorite } from "../state/action-favorites.js";
import { readCombatContext } from "../state/combat-context.js";
import {
  readDraftPlan,
  readSharedDraftPlan,
  hasSharedDraftPlan,
  sharedDraftPlanKey,
  shouldDisplaySharedDraft,
  writeDraftPlan,
  writeSharedDraftPlan,
  upsertDraftStep,
  removeDraftStep,
  moveDraftStep,
  writeSharedDraftPlanActorFlag,
} from "../state/draft-plans.js";
import { clearActionPreview, showActionPreview } from "./action-preview.js";
import { showMovementPreview } from "./movement-preview.js";
import { displayStepEntries } from "./display-steps.js";
import { selectDisplayPlan } from "./plan-selection.js";
import { cancelDestinationPicker, chooseDestination } from "./destination-picker.js";
import { cancelAreaPicker, chooseAreaMarker } from "./area-picker.js";
import { groupActionsByBuilderCategory } from "./action-categories.js";
import { actionDetailChips } from "./action-details.js";
import { readSustainedSpellEntries } from "../rules/sustained-spells.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DEFAULT_TAB = "one";
const TABS = new Set(ACTION_BUILDER_TABS.map((tab) => tab.id));
const RESET_PIN_REFRESH_SOURCES = new Set([
  "actor-update",
  "button",
  "combat-turn",
  "item-create",
  "item-delete",
  "item-update",
  "target-change",
  "token-refresh",
  "token-update",
]);

function readSetting(key, fallback) {
  try {
    return setting(key);
  } catch (_error) {
    return fallback;
  }
}

function readPanelState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.panelState) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function writePanelState(patch) {
  try {
    localStorage.setItem(STORAGE_KEYS.panelState, JSON.stringify({ ...readPanelState(), ...patch }));
  } catch (_error) {
    // Some browser privacy modes deny storage; panel still works without persistence.
  }
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

function ownershipLevelValue(level) {
  if (Number.isFinite(Number(level))) return Number(level);
  const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};
  return Number(levels[String(level ?? "").toUpperCase()] ?? 0) || 0;
}

function actorHasNonGmOwner(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  const ownerLevel = ownershipLevelValue(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  const users = collectionValues(globalThis.game?.users).filter((user) => user && user.isGM !== true);

  if (typeof document.testUserPermission === "function") {
    return users.some((user) => document.testUserPermission(user, ownerLevel));
  }

  const ownership = document.ownership ?? {};
  return users.some((user) => ownershipLevelValue(ownership[user.id]) >= ownerLevel);
}

function isPlayerControlledActor(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  if (String(document.type ?? "").toLowerCase() === "character") return true;
  return actorHasNonGmOwner(document);
}

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
  if (cost === "reaction") return "reaction";
  if (cost === 0) return "free";
  const numeric = Math.max(1, Math.min(3, Number(cost) || 1));
  return `${numeric} action${numeric === 1 ? "" : "s"}`;
}

// PF2e action-cost key: 0/free → "F", 1/2/3 → "1"/"2"/"3", reaction → "R".
function actionGlyph(cost) {
  if (cost === "reaction") return "R";
  if (cost === 0 || cost === "free") return "F";
  return String(Math.max(1, Math.min(3, Number(cost) || 1)));
}

// PF2e's own action-cost icon images, used in place of the action-glyph webfont (which
// Foundry registers for itself but does not reliably expose to module markup).
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

// Generic PF2e action icon shown for actions without an item image (Stride, Step, etc.).
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

  // A thrown weapon's melee Strike is not ranged (max reach 5 ft); it only
  // counts as ranged when the Strike actually reaches beyond melee.
  const max = Number(step?.range?.max ?? step?.targetingProfile?.maxRange);
  const isThrown = traits.some((trait) => /^thrown(-\d+)?$/.test(trait));
  return isThrown && Number.isFinite(max) && max > 5;
}

function rangeLabelFor(step) {
  if (!isRangedStep(step)) return "";
  const max = Number(step?.range?.max ?? step?.range?.increment ?? step?.targetingProfile?.maxRange);
  return Number.isFinite(max) && max > 0 ? `Ranged ${max} ft` : "Ranged";
}

function withBuilderActionFields(action) {
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

function explicitTargetFields(step, action) {
  return isAutoStoredRecommendationTarget(step, action)
    ? { targetTokenIds: [], targetLabel: "" }
    : { targetTokenIds: step?.targetTokenIds, targetLabel: step?.targetLabel };
}

// Bare creature name behind an explicitly stored target, stripped of any "Target:" prefix.
function rawTargetName(step, action) {
  if (isAutoStoredRecommendationTarget(step, action)) return "";
  const direct = step?.suggestedTarget?.name ?? step?.preferredTarget?.name ?? "";
  if (direct) return String(direct).trim();
  const label = plannedTargetLabel(step);
  if (/^Target planned$/i.test(label)) return "";
  return label.replace(/^Target:\s*/i, "").trim();
}

// What the detail line says about who a step targets. Movement destinations are chosen later,
// so they intentionally do not reuse a tactical target as a fake destination label.
function stepTargetLabel(name, { requiresTarget, requiresDestination }) {
  if (!name) return "";
  if (requiresTarget) return `→ ${name}`;
  if (requiresDestination) return "";
  return "";
}

function normalizedSlug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isSustainAction(action) {
  return [
    action?.slug,
    action?.id,
    action?.key,
    action?.baseKey,
    action?.actionKey,
  ].some((value) => normalizedSlug(value) === "sustain-a-spell");
}

function stripDuplicateKeySuffix(value) {
  return String(value ?? "").replace(/#\d+$/u, "");
}

function draftStepLookupKeys(step) {
  return new Set([
    step?.actionKey,
    step?.key,
    actionBuilderKey(step),
    stripDuplicateKeySuffix(step?.actionKey),
    step?.slug,
    step?.id,
    step?.action?.slug,
    step?.action?.id,
    step?.action?.item?.uuid,
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}

function actionLookupValues(action) {
  return [
    action?.key,
    action?.baseKey,
    actionBuilderKey(action),
    stripDuplicateKeySuffix(actionBuilderKey(action)),
    action?.id,
    action?.uuid,
    action?.item?.uuid,
    action?.slug,
    action?.name,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function draftStepActionRows(candidateBuild) {
  const candidates = Array.isArray(candidateBuild?.candidates) ? candidateBuild.candidates : [];
  const rejected = Array.isArray(candidateBuild?.rejected) ? candidateBuild.rejected : [];
  return [
    ...candidates,
    ...rejected.map((entry) => {
      const action = entry?.action ?? entry;
      if (!action) return null;
      const reason = action.disabledReason ?? action.unavailableReason ?? entry?.reason ?? "Action is not available in current context.";
      return {
        ...action,
        available: false,
        disabled: true,
        unavailableReason: reason,
        disabledReason: reason,
      };
    }),
  ].filter(Boolean).map(withBuilderActionFields);
}

function findProjectedDraftAction(context, draft, step) {
  if (isSustainAction(step)) {
    return { ...SUSTAIN_A_SPELL_ACTION, key: "sustain-a-spell", baseKey: "sustain-a-spell" };
  }
  const stepContext = projectContextForDraftStepOrigin(context, draft, step?.instanceId);
  const keys = draftStepLookupKeys(step);
  return draftStepActionRows(buildCandidates(stepContext)).find((action) =>
    actionLookupValues(action).some((value) => keys.has(value) || keys.has(stripDuplicateKeySuffix(value))),
  ) ?? null;
}

function projectedDraftStepActions(context, draft) {
  if (!context) return {};
  const actions = {};
  for (const step of Array.isArray(draft?.steps) ? draft.steps : []) {
    if (!step?.instanceId) continue;
    const action = findProjectedDraftAction(context, draft, step);
    if (action) actions[step.instanceId] = action;
  }
  return actions;
}

function areaLabel(areaMarker) {
  const label = String(areaMarker?.label ?? "").trim();
  if (label) return `Area: ${label}`;
  const shape = String(areaMarker?.shape ?? areaMarker?.type ?? "").trim();
  if (!shape) return "";
  const distance = Number(areaMarker?.distance ?? areaMarker?.radius);
  return Number.isFinite(distance) ? `Area: ${titleCase(shape)} ${distance} ft` : `Area: ${titleCase(shape)}`;
}

function executionStatus(step) {
  const status = String(step?.execution?.status ?? "pending").toLowerCase();
  return ["done", "failed"].includes(status) ? status : "pending";
}

function executionLabel(step) {
  const status = executionStatus(step);
  if (status === "done") return "Done";
  if (status === "failed") return `Failed${step?.execution?.error ? `: ${step.execution.error}` : ""}`;
  return "";
}

function draftStepId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `draft-step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function decoratePlan(plan, index = 0) {
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
  const cost = action?.actionCost ?? action?.cost ?? 1;
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
  };
}

function decorateDraftStep(step, index, { readonly = false, gmExecute = false, total = 0, reorderLocked = false } = {}) {
  const action = step?.action ? decorateAction(step.action) : null;
  const plannedCost = step?.actionCost ?? step?.cost ?? action?.actionCost ?? action?.cost;
  const displaySource = action
    ? { ...action, actionCost: plannedCost, cost: plannedCost }
    : step;
  const display = decorateStep(displaySource, index, index);
  const requiresDestination = requiresDestinationForAction(action ?? step);
  const requiresTarget = requiresTargetForAction(action ?? step);
  const requiresArea = requiresAreaMarkerForAction(action ?? step);
  const status = executionStatus(step);
  const isExecutionDone = status === "done";
  const canRunStep = readonly !== true || gmExecute === true;
  const sustainLabel = isSustainAction(action ?? step) && step?.sustainedSpell?.name
    ? `Sustain: ${step.sustainedSpell.name}`
    : "";
  const targetLabel = sustainLabel || stepTargetLabel(rawTargetName(step, action), { requiresTarget, requiresDestination });
  const stepAreaLabel = areaLabel(step?.areaMarker);
  const readiness = isExecutionDone
    ? { status: "ready", choices: [], warning: "" }
    : executionReadinessForStep(step, action ?? step);
  const rawWarning = step?.warning === "Choose a destination." ? "Choose destination at execution." : step?.warning;
  // A completed step's readiness/validity warnings are stale — don't surface them.
  const warning = isExecutionDone ? "" : (readiness.warning || rawWarning);
  const canShowExecuteStep = canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true;
  const executionBlocked = canShowExecuteStep && readiness.status !== "ready";
  const canEditStepOrder = readonly !== true && reorderLocked !== true;
  return {
    ...display,
    ...step,
    action,
    displayIndex: index,
    position: index + 1,
    instanceId: step?.instanceId,
    readonly,
    name: action?.name ?? step?.name ?? step?.actionKey ?? "Unknown action",
    reason: action?.reason ?? step?.reason ?? "",
    targetLabel,
    requiresDestination,
    requiresTarget,
    requiresArea,
    areaLabel: stepAreaLabel,
    hasAreaMarker: Boolean(step?.areaMarker),
    executionStatus: status,
    executionLabel: executionLabel(step),
    executionTooltip: step?.execution?.error ?? executionLabel(step),
    isExecutionDone,
    isExecutionFailed: status === "failed",
    canShowExecuteStep,
    canExecuteStep: canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true && readiness.status === "ready",
    executionBlocked,
    executeTooltip: executionBlocked ? (readiness.warning || "Resolve required choices before executing.") : "Execute this step",
    canMoveStepUp: canEditStepOrder && index > 0,
    canMoveStepDown: canEditStepOrder && index < total - 1,
    // Per-step revert shows for the owner, or for a GM running an AFK player's shared plan.
    canRevertStep: isExecutionDone && canRunStep,
    warning,
    hasStepDetails: Boolean(targetLabel || stepAreaLabel || warning),
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
      label: "Favorites",
      actions: filterBuilderTabActions(tab.favorites, searchQuery)
        .map((action) => decorateAction(action, { readonly })),
    },
    ...(quickenedActions.length
      ? [{ id: "quickened", label: "Quickened actions", actions: quickenedActions }]
      : []),
    ...groupActionsByBuilderCategory(categorizedActions),
  ];
  return {
    ...tab,
    active: tab.id === activeTab,
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
    action?.source,
    action?.role,
    action?.costLabel,
    action?.targetLabel,
    action?.disabledReason,
    action?.reason,
    action?.spellResource?.label,
    action?.spellResource?.tooltip,
    action?.spellcastingEntryLabel,
    action?.rank !== undefined ? `rank ${action.rank}` : "",
  ].map((part) => String(part ?? "").toLowerCase()).join(" ");
}

function searchTerms(query) {
  return String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function remainingActionPoolSummary(builder) {
  const normal = Number(builder?.remainingNormalActions ?? 0);
  const quickened = Number(builder?.remainingQuickenedActions ?? 0);
  const normalLabel = `${normal} normal`;
  if (quickened <= 0) return `${normalLabel} action${normal === 1 ? "" : "s"} left`;
  return `${normalLabel}, ${quickened} quickened left`;
}

function decoratedSustainedSpells(entries, { readonly = false } = {}) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const effectCount = entry.effectIds?.length ?? entry.effects?.length ?? 0;
    const templateCount = entry.templateRefs?.length ?? 0;
    const statusLabel = entry.sustained ? "Sustained" : entry.planned ? "Planned" : "Needs sustain";
    const detailParts = [];
    if (effectCount) detailParts.push(`${effectCount} effect${effectCount === 1 ? "" : "s"}`);
    if (templateCount) detailParts.push(`${templateCount} template${templateCount === 1 ? "" : "s"}`);
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

function sustainedSpellDraftFields(entry) {
  return {
    id: entry?.id,
    name: entry?.name ?? "Sustained spell",
    spellUuid: entry?.spellUuid ?? null,
    effectIds: Array.isArray(entry?.effectIds) ? [...entry.effectIds] : [],
    templateRefs: Array.isArray(entry?.templateRefs) ? [...entry.templateRefs] : [],
  };
}

function decorateBuilder(builder, activeTab, searchQuery = "", { sustainedSpells = [], addTarget = "plan" } = {}) {
  if (!builder) return null;
  const draftReadonly = builder.draft?.readonly === true;
  const isPlayerPlan = builder.draft?.shared === true;
  // The GM may execute a player's shared plan on their behalf even though it's read-only to edit.
  const gmCanRunPlayerPlan = globalThis.game?.user?.isGM === true && isPlayerPlan;
  const sharedDraftUserName = String(builder.draft?.userName ?? "").trim();
  const rawSteps = builder.draft?.steps ?? [];
  const reorderLocked = rawSteps.some((step) => executionStatus(step) !== "pending");
  const rawDraftSteps = rawSteps
    .map((step, index) => decorateDraftStep(step, index, {
      readonly: draftReadonly,
      gmExecute: gmCanRunPlayerPlan,
      total: rawSteps.length,
      reorderLocked,
    }));
  const currentExecutionStep = nextPendingExecutionStep({ steps: rawDraftSteps });
  const draftSteps = rawDraftSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentExecutionStep?.instanceId,
  }));
  const active = TABS.has(activeTab) ? activeTab : DEFAULT_TAB;
  const sustainedEntries = decoratedSustainedSpells(sustainedSpells, { readonly: draftReadonly });
  const rawUnconditional = builder.draft?.unconditional ?? [];
  const unconditionalReorderLocked = rawUnconditional.some((step) => executionStatus(step) !== "pending");
  const rawUnconditionalSteps = rawUnconditional.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    total: rawUnconditional.length,
    reorderLocked: unconditionalReorderLocked,
  }));
  const currentUnconditionalStep = nextPendingExecutionStep({ steps: rawUnconditionalSteps });
  const unconditionalEntries = rawUnconditionalSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentUnconditionalStep?.instanceId,
  }));
  const canManageUnconditional = draftReadonly !== true || gmCanRunPlayerPlan;
  const allExecutable = [...draftSteps, ...unconditionalEntries];
  const executedCount = allExecutable.filter((step) => step.executionStatus === "done").length;
  const canResetExecution = allExecutable.some((step) => step.executionStatus === "done" || step.executionStatus === "failed");
  return {
    ...builder,
    readonly: draftReadonly,
    tabsList: ACTION_BUILDER_TABS.map((tab) =>
      decorateBuilderTab(builder.tabs[tab.id], active, { readonly: draftReadonly, searchQuery })),
    activeTab: active,
    activeTabLabel: ACTION_BUILDER_TABS.find((tab) => tab.id === active)?.label ?? "1 Action",
    draft: {
      ...(builder.draft ?? {}),
      steps: draftSteps,
      hasSteps: draftSteps.length > 0,
      readonly: draftReadonly,
      countLabel: draftSteps.length ? `${draftSteps.length} step${draftSteps.length === 1 ? "" : "s"}` : "Empty",
      confidenceClass: draftSteps.length ? "medium" : "low",
      warnings: [...new Set(draftSteps.map((step) => step.warning).filter(Boolean))],
    },
    sustainedSpells: {
      hasEntries: sustainedEntries.length > 0,
      entries: sustainedEntries,
    },
    unconditional: {
      hasEntries: unconditionalEntries.length > 0,
      entries: unconditionalEntries,
    },
    addTarget: addTarget === "unconditional" ? "unconditional" : "plan",
    addTargets: [
      { id: "plan", label: "Plan", active: addTarget !== "unconditional" },
      { id: "unconditional", label: "Unconditional", active: addTarget === "unconditional" },
    ],
    canManageUnconditional,
    execution: {
      hasSteps: allExecutable.length > 0,
      canReset: (draftReadonly !== true || gmCanRunPlayerPlan) && canResetExecution,
      progressLabel: executedCount > 0 ? `${executedCount}/${allExecutable.length} done` : "",
      hasStatus: ((draftReadonly !== true || gmCanRunPlayerPlan) && canResetExecution) || executedCount > 0,
      current: currentExecutionStep ?? null,
      currentInstanceId: currentExecutionStep?.instanceId ?? "",
    },
    isPlayerPlan,
    playerPlanLabel: "Player plan",
    playerPlanTooltip: sharedDraftUserName ? `Player plan from ${sharedDraftUserName}` : "Player plan",
    poolSummary: remainingActionPoolSummary(builder),
    totalSummary: `${builder.remainingTotalActions} total action${builder.remainingTotalActions === 1 ? "" : "s"} left`,
    reactionSummary: builder.usage?.reaction ? "Reaction planned" : "Reaction open",
  };
}

function debugAction(action, index) {
  const profileParts = action?.activityProfile
    ? Object.entries(action.activityProfile)
      .filter(([, value]) => value === true || Number.isFinite(value))
      .map(([key, value]) => value === true ? camelCase(key) : `${camelCase(key)}:${value}`)
    : [];
  const skillCheckLabel = action?.skillCheck?.label ?? "";
  if (skillCheckLabel) profileParts.push(skillCheckLabel);
  return {
    index,
    name: action?.name ?? "Unknown action",
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

async function renderSheet(document) {
  const sheet = document?.sheet;
  if (!sheet?.render) return false;
  await sheet.render(true);
  return true;
}

async function renderSheetFromUuid(uuid) {
  if (!uuid || typeof globalThis.fromUuid !== "function") return false;
  try {
    const document = await globalThis.fromUuid(uuid);
    return renderSheet(document);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to open action details`, error);
    return false;
  }
}

function escapeHtml(value) {
  return foundry?.utils?.escapeHTML
    ? foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

async function createGuidance(step, actor) {
  const message = `<strong>${escapeHtml(step?.name ?? "Recommended action")}</strong><br>${escapeHtml(step?.reason ?? "Review this recommendation before acting.")}`;
  const userId = game?.user?.id;

  if (globalThis.ChatMessage?.create && userId) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content: message,
      whisper: [userId],
    });
    return;
  }

  globalThis.ui?.notifications?.info?.(`${step?.name ?? "Recommended action"}: ${step?.reason ?? "Review recommendation."}`);
}

async function confirmReplaceDraft() {
  const message = "Replace current draft with Auto-fill plan?";
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (dialog?.confirm) {
    return dialog.confirm({
      window: { title: "Replace draft" },
      content: `<p>${escapeHtml(message)}</p>`,
      yes: { label: "Replace" },
      no: { label: "Cancel" },
    });
  }
  return globalThis.window?.confirm?.(message) ?? true;
}

class CombaterPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-panel`,
    classes: [MODULE_ID, "combater-panel"],
    tag: "aside",
    window: {
      frame: true,
      icon: "fa-solid fa-crosshairs",
      positioned: true,
      resizable: true,
    },
    position: {
      width: 420,
      height: "auto",
    },
  };

  get title() {
    const actorName = this._context?.actor?.name;
    return actorName ? `PF2e Combater - ${actorName}` : "PF2e Combater";
  }

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/combater-panel.hbs`,
    },
  };

  constructor(options = {}) {
    super(options);
    const state = readPanelState();
    this.refreshSource = options.refreshSource ?? "manual";
    this.expanded = typeof state.expanded === "boolean"
      ? state.expanded
      : !readSetting(SETTINGS.compactDefault, true);
    this.activeTab = TABS.has(state.activeTab) ? state.activeTab : DEFAULT_TAB;
    this.searchQuery = typeof state.searchQuery === "string" ? state.searchQuery : "";
    this._context = null;
    this._planningContext = null;
    this._candidates = [];
    this._rejected = [];
    this._detected = [];
    this._plans = [];
    this._plan = null;
    this._builder = null;
    this._gmExecuteMode = false;
    this._destinationPicker = null;
    this._areaPicker = null;
    this._pinnedPlanId = null;
    this._selectedCombatant = options.combatant ?? null;
    this._onClose = typeof options.onClose === "function" ? options.onClose : null;
    this._restoredPosition = false;
    this._scrollPerformanceTimer = null;
    this._searchRenderTimer = null;
    this._searchFocusState = null;
  }

  async setCombatant(combatant, refreshSource = "combatant-selection") {
    this._selectedCombatant = combatant ?? null;
    await this.refresh(refreshSource);
  }

  async refresh(refreshSource = "manual") {
    this.refreshSource = refreshSource;
    // A canvas picker is in progress (destination/template placement). Token/refresh hooks
    // fire constantly while the cursor moves over tokens; if that refresh cancelled the picker
    // it would kill the destination grid / region tools mid-selection. Re-render only and leave
    // the in-progress picker alone — _onRender re-shows its overlay. Only explicit user actions
    // cancel a picker.
    if (this._areaPicker || this._destinationPicker) {
      await this.render({ force: true });
      return;
    }
    if (RESET_PIN_REFRESH_SOURCES.has(refreshSource)) this._pinnedPlanId = null;
    this._cancelDestinationPicker();
    await this.render({ force: true });
  }

  async _prepareContext(options) {
    await super._prepareContext(options);

    const context = readCombatContext(this.refreshSource, { combatant: this._selectedCombatant });
    this._context = context;

    if (!context) {
      this._candidates = [];
      this._rejected = [];
      this._detected = [];
      this._plans = [];
      this._plan = null;
      this._builder = null;
      this._planningContext = null;
      return this._viewContext(null);
    }

    const draft = readDraftPlan(context);
    const sharedDraft = game?.user?.isGM === true ? readSharedDraftPlan(context) : null;
    const sharedDraftKnown = hasSharedDraftPlan(sharedDraft);
    const gmViewingPlayerPlan = game?.user?.isGM === true && isPlayerControlledActor(context.actor?.document ?? context.actor);
    const useSharedDraft = sharedDraftKnown && (gmViewingPlayerPlan || shouldDisplaySharedDraft(draft, sharedDraft));
    // When the GM is viewing a player's shared plan (e.g. the player went AFK), let the GM execute it
    // on their behalf. The draft stays read-only for editing, but execution/revert is permitted and
    // writes back to the shared draft rather than the GM's local one.
    this._gmExecuteMode = gmViewingPlayerPlan && useSharedDraft;
    const activeDraft = useSharedDraft
      ? { ...sharedDraft, readonly: true, shared: true }
      : gmViewingPlayerPlan
        ? { steps: [], readonly: true, shared: true, userName: "" }
        : draft;
    const baseBuild = buildCandidates(context);
    const planningContext = projectContextForDraftDestination(context, activeDraft);
    this._planningContext = planningContext;
    const candidateBuild = planningContext === context ? baseBuild : buildCandidates(planningContext);
    const { candidates, rejected, detected } = candidateBuild;
    const baseBuilderCandidates = baseBuild.candidates.map(withBuilderActionFields);
    const builderCandidates = candidates.map(withBuilderActionFields);
    const builderRejected = rejected.map((entry) => ({
      ...entry,
      action: withBuilderActionFields(entry?.action),
    }));
    const draftStepActions = projectedDraftStepActions(context, activeDraft);
    const plans = buildTurnPlans(planningContext, builderCandidates);
    const plan = selectDisplayPlan(plans, this._pinnedPlanId) ?? bestTurnPlan(planningContext, builderCandidates);
    const favorites = readActionFavorites(context);

    this._candidates = builderCandidates;
    this._rejected = rejected;
    this._detected = detected;
    this._plans = plans;
    this._plan = plan;
    const builderModel = buildActionBuilderModel({
      context: planningContext,
      candidates: builderCandidates,
      draftFallbackActions: planningContext === context ? [] : baseBuilderCandidates,
      rejected: builderRejected,
      plans: plan ? [plan] : plans,
      draft: activeDraft,
      draftStepActions,
      favorites,
    });
    const sustainedSpells = readSustainedSpellEntries(context, undefined, builderModel.draft);
    this._builder = decorateBuilder(builderModel, this.activeTab, this.searchQuery, {
      sustainedSpells,
      addTarget: this._addTarget,
    });
    this._builder.readonly = this._builder.readonly || gmViewingPlayerPlan;

    return this._viewContext(context);
  }

  _viewContext(context) {
    const showDebug = Boolean(game?.user?.isGM && readSetting(SETTINGS.showDebugTab, false));
    const autoFill = decoratePlan(this._builder?.autoFill ?? this._plan, 0);
    const draftSteps = this._builder?.draft?.steps ?? [];
    const headerMode = "Draft";

    return {
      actor: context?.actor ?? null,
      token: context?.token ?? null,
      plan: autoFill,
      headerSteps: draftSteps,
      headerMode,
      headerConfidenceClass: draftSteps.length ? "medium" : "low",
      headerSummary: "",
      builder: this._builder,
      expanded: this.expanded,
      activeTab: this.activeTab,
      showDebug,
      hasContext: Boolean(context),
      refreshSource: this.refreshSource,
      debug: {
        candidates: this._candidates.map(debugAction),
        rejected: this._rejected.map((entry, index) => ({
          index,
          action: debugAction(entry?.action, index),
          reason: entry?.reason ?? "",
        })),
        detected: this._detected.map(debugAction),
        context,
      },
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Don't wipe the canvas preview on every render — incidental refreshes (e.g. a
    // refreshToken hook when the cursor passes over a token) would otherwise make the
    // hover overlay vanish. The preview is managed by step hover and explicit actions, and
    // the destination-picker overlay is re-shown below.
    this._restorePosition();

    const element = this.element;
    this._activateDrag(element);
    this._activateActionListScrollPerformance(element);

    element.querySelector("[data-action='toggle-expanded']")
      ?.addEventListener("click", () => this._setExpanded(!this.expanded));
    element.querySelector("[data-action='refresh']")
      ?.addEventListener("click", () => this.refresh("button"));

    for (const button of element.querySelectorAll("[data-tab]")) {
      button.addEventListener("click", () => this._setActiveTab(button.dataset.tab));
    }

    for (const input of element.querySelectorAll("[data-search-actions]")) {
      input.addEventListener("input", () => this._setSearchQuery(input.value, input));
    }
    this._restoreSearchFocus(element);

    for (const button of element.querySelectorAll("[data-add-action]")) {
      button.addEventListener("click", () => this._addAction(button.dataset.addAction));
    }

    for (const button of element.querySelectorAll("[data-add-sustain-spell]")) {
      button.addEventListener("click", () => this._addSustainSpell(button.dataset.addSustainSpell));
    }

    for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
      button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
    }

    for (const button of element.querySelectorAll("[data-move-draft-step]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._moveDraftStep(button.dataset.moveDraftStep, button.dataset.moveDirection);
      });
    }

    for (const button of element.querySelectorAll("[data-favorite-action]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._toggleFavorite(button.dataset.favoriteAction);
      });
    }

    for (const button of element.querySelectorAll("[data-auto-fill]")) {
      button.addEventListener("click", () => this._autoFillDraft());
    }

    for (const button of element.querySelectorAll("[data-reset-execution]")) {
      button.addEventListener("click", () => this._resetExecution());
    }

    for (const button of element.querySelectorAll("[data-revert-step]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._revertDraftStep(button.dataset.revertStep);
      });
    }

    for (const button of element.querySelectorAll("[data-execute-draft-step]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._executeDraftStep(button.dataset.executeDraftStep, event);
      });
    }

    for (const button of element.querySelectorAll("[data-choose-destination]")) {
      button.addEventListener("click", () => this._chooseDestination(button.dataset.chooseDestination));
    }

    for (const button of element.querySelectorAll("[data-choose-target]")) {
      button.addEventListener("click", () => this._chooseTarget(button.dataset.chooseTarget));
    }

    for (const button of element.querySelectorAll("[data-choose-area]")) {
      button.addEventListener("click", () => this._chooseArea(button.dataset.chooseArea));
    }

    for (const button of element.querySelectorAll("[data-remove-area]")) {
      button.addEventListener("click", () => this._removeAreaTemplate(button.dataset.removeArea));
    }

    for (const button of element.querySelectorAll("[data-open-action]")) {
      button.addEventListener("click", () => this._openBuilderAction(button.dataset.openAction));
    }

    for (const button of element.querySelectorAll("[data-open-draft-step]")) {
      button.addEventListener("click", () => this._openDraftStep(button.dataset.openDraftStep));
    }

    for (const button of element.querySelectorAll("[data-execute-step]")) {
      button.addEventListener("click", () => this.executeStep(Number(button.dataset.executeStep)));
    }

    for (const previewElement of element.querySelectorAll("[data-preview-step]")) {
      previewElement.addEventListener("pointerenter", () => this._showActionPreview(previewElement));
      previewElement.addEventListener("pointerleave", (event) => this._clearActionPreviewUnlessPicking(event));
      previewElement.addEventListener("pointercancel", (event) => this._clearActionPreviewUnlessPicking(event));
    }

    for (const previewElement of element.querySelectorAll("[data-preview-draft-step]")) {
      previewElement.addEventListener("pointerenter", () => this._showDraftActionPreview(previewElement));
      previewElement.addEventListener("pointerleave", (event) => this._clearActionPreviewUnlessPicking(event));
      previewElement.addEventListener("pointercancel", (event) => this._clearActionPreviewUnlessPicking(event));
    }

    if (readSetting(SETTINGS.rememberPanelPosition, true)) {
      element.addEventListener("pointerup", () => this._savePosition(), { passive: true });
    }

    this._restoreDestinationPickerPreview();
  }

  async close(options) {
    this._cancelDestinationPicker();
    this._clearActionListScrollPerformance();
    this._clearSearchRenderTimer();
    clearActionPreview();
    try {
      return await super.close(options);
    } finally {
      this._onClose?.(this);
    }
  }

  _setExpanded(expanded) {
    this.expanded = expanded;
    writePanelState({ expanded });
    this.render({ force: true });
  }

  _setActiveTab(tab) {
    if (!TABS.has(tab)) return;
    this.activeTab = tab;
    writePanelState({ activeTab: tab });
    this._clearSearchRenderTimer();
    this._searchFocusState = null;
    this.render({ force: true });
  }

  _clearSearchRenderTimer() {
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    if (this._searchRenderTimer && typeof clearTimer === "function") clearTimer(this._searchRenderTimer);
    this._searchRenderTimer = null;
  }

  _scheduleSearchRender() {
    this._clearSearchRenderTimer();
    const setTimer = globalThis.setTimeout ?? globalThis.window?.setTimeout;
    if (typeof setTimer !== "function") {
      this.render({ force: true });
      return;
    }
    this._searchRenderTimer = setTimer(() => {
      this._searchRenderTimer = null;
      const render = this.render({ force: true });
      if (render && typeof render.catch === "function") {
        render.catch((error) => console.warn(`${MODULE_ID} | Search refresh failed`, error));
      }
    }, 120);
  }

  _restoreSearchFocus(element = this.element) {
    const state = this._searchFocusState;
    if (!state || state.activeTab !== this.activeTab) return;
    const input = element?.querySelector?.("[data-search-actions]");
    if (!input) return;
    const valueLength = String(input.value ?? "").length;
    const start = Math.max(0, Math.min(state.selectionStart ?? valueLength, valueLength));
    const end = Math.max(start, Math.min(state.selectionEnd ?? start, valueLength));
    input.focus?.({ preventScroll: true });
    input.setSelectionRange?.(start, end);
    this._searchFocusState = null;
  }

  _setSearchQuery(query, input = null) {
    this.searchQuery = String(query ?? "");
    writePanelState({ searchQuery: this.searchQuery });
    this._searchFocusState = {
      activeTab: this.activeTab,
      selectionStart: typeof input?.selectionStart === "number" ? input.selectionStart : this.searchQuery.length,
      selectionEnd: typeof input?.selectionEnd === "number" ? input.selectionEnd : this.searchQuery.length,
    };
    this._scheduleSearchRender();
  }

  _findBuilderAction(actionKey) {
    if (!actionKey) return null;
    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((entry) => entry.key === actionKey);
      if (action) return action;
    }
    return null;
  }

  _findSustainAction() {
    const direct = this._findBuilderAction("sustain-a-spell");
    if (isSustainAction(direct)) return direct;
    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((entry) => isSustainAction(entry));
      if (action) return action;
    }
    // The action is no longer offered in the tabs; the sustained-spells section uses this
    // self-contained template to build a Sustain step.
    return { ...SUSTAIN_A_SPELL_ACTION, key: "sustain-a-spell", baseKey: "sustain-a-spell" };
  }

  _findSustainedSpell(spellId) {
    const id = normalizedSlug(spellId);
    return this._builder?.sustainedSpells?.entries?.find((entry) => normalizedSlug(entry.id) === id) ?? null;
  }

  _findDraftStep(instanceId) {
    return this._builder?.draft?.steps?.find((step) => step.instanceId === instanceId) ?? null;
  }

  _draftHasManualSteps() {
    return (this._builder?.draft?.steps?.length ?? 0) > 0;
  }

  _canEditDraft() {
    return this._builder?.readonly !== true;
  }

  // Editing (add/remove/reorder) requires an editable draft, but executing a player's shared plan as
  // the GM is allowed even though that draft is read-only for editing.
  _canExecuteDraft() {
    return this._canEditDraft() || this._gmExecuteMode === true;
  }

  // Reads/writes route to the shared draft when the GM is executing a player plan, otherwise to the
  // local per-user draft.
  _readActiveDraftPlan() {
    return this._gmExecuteMode === true
      ? readSharedDraftPlan(this._context)
      : readDraftPlan(this._context);
  }

  async _persistActiveDraftStep(step) {
    if (this._gmExecuteMode === true) {
      const draft = readSharedDraftPlan(this._context);
      const steps = [...(draft.steps ?? [])];
      const index = steps.findIndex((entry) => entry.instanceId === step.instanceId);
      if (index >= 0) steps[index] = step;
      else steps.push(step);
      await this._writeActiveSharedDraft({ ...draft, steps });
      return;
    }
    upsertDraftStep(this._context, step);
    await this._syncDraftToGM();
  }

  async _writeActiveDraftPlan(draft) {
    if (this._gmExecuteMode === true) {
      await this._writeActiveSharedDraft(draft);
      return;
    }
    writeDraftPlan(this._context, draft);
    await this._syncDraftToGM();
  }

  // Preserve the player's ownership fields; only the steps / execution state changes.
  async _writeActiveSharedDraft(draft) {
    writeSharedDraftPlan(this._context, draft);
    await writeSharedDraftPlanActorFlag(this._context, draft);
  }

  async _addAction(actionKey) {
    if (!this._canEditDraft()) return;
    const action = this._findBuilderAction(actionKey);
    if (!this._context || !action) return;

    upsertDraftStep(this._context, {
      actionKey: action.key,
      actionCost: action.actionCost ?? action.cost,
      requiresDestination: requiresDestinationForAction(action),
    });
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _addSustainSpell(spellId) {
    if (!this._canEditDraft()) return;
    const spell = this._findSustainedSpell(spellId);
    const action = this._findSustainAction();
    if (!this._context || !spell || !action || action.disabled) {
      globalThis.ui?.notifications?.warn?.(action?.disabledReason ?? "Sustain a Spell is not available.");
      return;
    }

    const draft = this._readActiveDraftPlan();
    await this._writeActiveDraftPlan({
      ...draft,
      steps: [
        ...(draft.steps ?? []),
        {
          instanceId: draftStepId(),
          actionKey: action.key,
          actionCost: action.actionCost ?? action.cost ?? 1,
          requiresDestination: requiresDestinationForAction(action),
          sustainedSpell: sustainedSpellDraftFields(spell),
        },
      ],
    });
    clearActionPreview();
    await this.render({ force: true });
  }

  async _removeDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    removeDraftStep(this._context, instanceId);
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _moveDraftStep(instanceId, direction) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = readDraftPlan(this._context);
    if ((draft.steps ?? []).some((step) => executionStatus(step) !== "pending")) {
      globalThis.ui?.notifications?.warn?.("Revert executed steps before reordering the plan.");
      return;
    }
    if (!moveDraftStep(this._context, instanceId, direction)) return;
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _toggleFavorite(actionKey) {
    if (!this._canEditDraft()) return;
    if (!this._context || !actionKey) return;
    toggleActionFavorite(this._context, actionKey);
    await this.render({ force: true });
  }

  _actionKeyForStep(step) {
    const key = actionBuilderKey(step);
    const direct = this._findBuilderAction(key);
    if (direct) return direct.key;

    for (const tab of Object.values(this._builder?.tabs ?? {})) {
      const action = tab.all.find((candidate) =>
        candidate.baseKey === key
        || candidate.slug === step?.slug
        || candidate.id === step?.id
        || candidate.item?.uuid === step?.item?.uuid);
      if (action) return action.key;
    }
    return key;
  }

  async _autoFillDraft() {
    if (!this._canEditDraft()) return;
    const autoFill = this._builder?.autoFill;
    if (!this._context || !autoFill?.steps?.length) return;
    if (this._draftHasManualSteps() && !await confirmReplaceDraft()) return;

    const steps = autoFill.steps.flatMap((step) => builderAtomicActionsForStep(step)).map((step) => ({
      instanceId: draftStepId(),
      actionKey: this._actionKeyForStep(step),
      actionCost: step?.actionCost ?? step?.cost,
      requiresDestination: requiresDestinationForAction(step),
      ...(step?.destination ? { destination: step.destination } : {}),
    }));
    writeDraftPlan(this._context, { steps });
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _syncDraftToGM({ notify = false } = {}) {
    if (!this._context || globalThis.game?.user?.isGM === true) return false;
    const draft = readDraftPlan(this._context);
    const socket = globalThis.game?.socket;
    if (typeof socket?.emit !== "function") {
      console.warn(`${MODULE_ID} | Cannot sync plan: Foundry socket is not available.`);
      if (notify) globalThis.ui?.notifications?.warn?.("Cannot sync plan with GM: Foundry socket is not available.");
      return false;
    }

    try {
      const sharedDraft = writeSharedDraftPlan(this._context, {
        ...draft,
        userId: globalThis.game?.user?.id ?? null,
        userName: globalThis.game?.user?.name ?? "",
      });
      try {
        await writeSharedDraftPlanActorFlag(this._context, sharedDraft);
      } catch (error) {
        console.warn(`${MODULE_ID} | Actor-flag plan sync failed`, error);
      }
      const payload = {
        type: "shareDraft",
        key: sharedDraftPlanKey(this._context),
        combatId: this._context.combat?.id ?? null,
        round: this._context.combat?.round ?? null,
        combatantId: this._context.combatant?.id ?? null,
        actorName: this._context.actor?.name ?? this._context.combatant?.name ?? "",
        silent: !notify,
        ...sharedDraft,
      };

      await socket.emit(`module.${MODULE_ID}`, payload);
      if (notify) globalThis.ui?.notifications?.info?.("Plan shared with GM.");
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Plan sync failed`, error);
      if (notify) globalThis.ui?.notifications?.warn?.("Could not sync plan with GM.");
      return false;
    }
  }

  _cancelDestinationPicker() {
    this._destinationPicker = null;
    this._areaPicker = null;
    cancelDestinationPicker();
    cancelAreaPicker();
  }

  _clearActionPreviewUnlessPicking(event) {
    if (this._destinationPicker || this._areaPicker) return;
    const element = event?.currentTarget?.closest?.(".pf2e-combater") ?? this.element;
    // Keep the canvas overlay alive while the cursor moves onto the canvas/tokens, or when
    // the pointer interaction is cancelled (relatedTarget is null). Only clear it when the
    // cursor moves to another control inside the panel.
    const related = event?.relatedTarget ?? null;
    if (!related || !element?.contains?.(related)) return;
    clearActionPreview();
  }

  _draftForOrigin() {
    return this._builder?.draft ?? readDraftPlan(this._context);
  }

  _contextForDraftStep(instanceId) {
    return projectContextForDraftStepOrigin(this._context, this._draftForOrigin(), instanceId);
  }

  _showDestinationPickerPreview(instanceId = this._destinationPicker?.instanceId) {
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) return false;
    const preview = this._destinationPicker?.instanceId === instanceId ? this._destinationPicker.preview : null;

    showMovementPreview(this._contextForDraftStep(instanceId), {
      ...(step.action ?? step),
      ...(preview?.destination ? { destination: preview.destination } : {}),
      ...(preview?.movementPlan ? { movementPlan: preview.movementPlan } : {}),
      requiresDestination: true,
    });
    return true;
  }

  _restoreDestinationPickerPreview() {
    if (!this._destinationPicker?.instanceId) return;
    if (this._destinationPicker.native) return;
    this._showDestinationPickerPreview(this._destinationPicker.instanceId);
  }

  _stepWithRetryReset(step, patch) {
    const execution = step?.execution?.status === "failed" ? { status: "pending" } : step?.execution;
    return {
      ...step,
      ...patch,
      ...(execution ? { execution } : {}),
    };
  }

  _chooseDestination(instanceId) {
    if (!this._canExecuteDraft()) return;
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) return;
    this._cancelDestinationPicker();
    this._destinationPicker = { instanceId, native: false };

    const picker = chooseDestination({
      context: this._contextForDraftStep(instanceId),
      action: step.action ?? step,
      enableWaypoints: true,
      onPreview: (destination, metadata = {}) => {
        this._destinationPicker = {
          ...(this._destinationPicker ?? {}),
          instanceId,
          native: false,
          preview: {
            destination,
            movementPlan: metadata.movementPlan ?? null,
          },
        };
        this._showDestinationPickerPreview(instanceId);
      },
      onCancel: () => {
        this._destinationPicker = null;
        clearActionPreview();
      },
      onChoose: async (destination, metadata = {}) => {
        const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === instanceId) ?? step;
        await this._persistActiveDraftStep(this._stepWithRetryReset(current, {
          destination,
          ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}),
        }));
        this._destinationPicker = null;
        clearActionPreview();
        await this.render({ force: true });
      },
    });
    if (!picker) {
      this._destinationPicker = null;
      clearActionPreview();
      globalThis.ui?.notifications?.warn?.("Canvas destination picker is not available.");
      return;
    }
    this._destinationPicker = { instanceId, native: picker.native === true };
    if (!picker.native) this._showDestinationPickerPreview(instanceId);
  }

  async _chooseTarget(instanceId) {
    if (!this._canExecuteDraft()) return;
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) return;
    this._cancelDestinationPicker();
    const selection = currentTargetSelection();
    if (!selection.targetTokenIds.length) {
      globalThis.ui?.notifications?.warn?.("Target a token in Foundry first.");
      return;
    }
    const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === instanceId) ?? step;
    await this._persistActiveDraftStep(this._stepWithRetryReset(current, {
      targetTokenIds: selection.targetTokenIds,
      targetLabel: selection.targetLabel,
      targetSelection: "manual",
    }));
    await this.render({ force: true });
  }

  async _removeAreaTemplate(instanceId) {
    if (!this._canExecuteDraft() || !this._context) return;
    const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === instanceId);
    if (!current?.areaMarker) return;
    this._cancelDestinationPicker();

    const isDone = current.execution?.status === "done";
    if (isDone) {
      // The step already placed a Region on the canvas — delete it, leaving the rest of the
      // executed step (rolls, chat) intact.
      const regionOp = (current.execution.revert?.ops ?? []).find((op) => op.kind === "region" && op.regionId);
      if (regionOp) {
        try {
          // Remove the linked countdown effect first so it does not linger after the template.
          if (regionOp.effectUuid && typeof globalThis.fromUuid === "function") {
            const effect = await globalThis.fromUuid(regionOp.effectUuid);
            if (effect?.id && effect?.parent?.items?.get?.(effect.id) && typeof effect.delete === "function") {
              await effect.delete();
            }
          }
          const scene = globalThis.game?.scenes?.get?.(regionOp.sceneId) ?? globalThis.canvas?.scene;
          // Idempotent: only delete the region if it still exists (cascades may have removed it).
          if (scene?.regions?.get?.(regionOp.regionId) && typeof scene.deleteEmbeddedDocuments === "function") {
            await scene.deleteEmbeddedDocuments("Region", [regionOp.regionId]);
          }
        } catch (_error) {
          globalThis.ui?.notifications?.warn?.("Could not remove the placed template region.");
        }
      }
      // Keep the step executed; just drop the template, its auto-targets, and the region revert op.
      const revert = current.execution.revert;
      const ops = (revert?.ops ?? []).filter((op) => op.kind !== "region");
      await this._persistActiveDraftStep({
        ...current,
        areaMarker: null,
        targetTokenIds: [],
        execution: { ...current.execution, ...(revert ? { revert: { ...revert, ops } } : {}) },
      });
    } else {
      // Not executed yet — drop the template and the targets it auto-selected, reopen the step.
      await this._persistActiveDraftStep(this._stepWithRetryReset(current, { areaMarker: null, targetTokenIds: [] }));
    }
    clearActionPreview();
    await this.render({ force: true });
  }

  async _pickTemplate(templates) {
    const dialog = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof dialog?.wait !== "function") return templates[0] ?? null;
    const buttons = templates.map((template, index) => ({
      action: String(index),
      label: template.label ?? `${template.type} ${template.distance ?? ""} ft`.trim(),
    }));
    const choice = await dialog.wait({
      window: { title: "Choose template" },
      content: "<p>This action has more than one area template. Choose which to place:</p>",
      buttons: [...buttons, { action: "cancel", label: "Cancel" }],
      rejectClose: false,
    }).catch(() => null);
    if (choice === null || choice === undefined || choice === "cancel") return null;
    return templates[Number(choice)] ?? null;
  }

  async _chooseArea(instanceId) {
    if (!this._canExecuteDraft()) {
      globalThis.ui?.notifications?.warn?.("This draft is read-only.");
      return;
    }
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) {
      globalThis.ui?.notifications?.warn?.("No draft step is available for area placement.");
      return;
    }
    const action = step.action ?? step;
    const templates = action?.targetingProfile?.templates ?? [];
    let placementAction = action;
    if (templates.length > 1) {
      const chosen = await this._pickTemplate(templates);
      if (!chosen) return;
      placementAction = {
        ...action,
        targetingProfile: {
          ...(action.targetingProfile ?? {}),
          type: chosen.type,
          shape: chosen.type,
          distance: chosen.distance,
          ...(chosen.width ? { width: chosen.width } : {}),
          templates: undefined,
        },
      };
    }

    this._cancelDestinationPicker();
    this._areaPicker = { instanceId };
    globalThis.ui?.notifications?.info?.("Place the area template on the canvas.");

    const picker = chooseAreaMarker({
      context: this._contextForDraftStep(instanceId),
      action: placementAction,
      onCancel: () => {
        this._areaPicker = null;
      },
      onChoose: async (areaMarker) => {
        const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === instanceId) ?? step;
        const inside = tokensInAreaMarker({
          context: this._contextForDraftStep(instanceId),
          action: placementAction,
          marker: areaMarker,
        });
        setTokenTargets(inside);
        const targetTokenIds = inside.map((token) => targetTokenId(token)).filter(Boolean);
        await this._persistActiveDraftStep(
          this._stepWithRetryReset(current, { areaMarker, ...(targetTokenIds.length ? { targetTokenIds } : {}) }),
        );
        this._areaPicker = null;
        await this.render({ force: true });
      },
    });
    if (!picker) {
      this._areaPicker = null;
      globalThis.ui?.notifications?.warn?.("Canvas area picker is not available.");
    }
  }

  async _openBuilderAction(actionKey) {
    await this._openActionDetails(this._findBuilderAction(actionKey));
  }

  async _openDraftStep(instanceId) {
    const step = this._findDraftStep(instanceId);
    await this._openActionDetails(step?.action ?? step);
  }

  _planForPreview(element) {
    const planId = element.dataset.previewPlan;
    if (!planId || planId === "main" || planId === "auto") return this._builder?.autoFill ?? this._plan;
    return this._plans.find((plan) => plan?.id === planId) ?? null;
  }

  _showActionPreview(element) {
    if (this._destinationPicker) return;
    const plan = this._planForPreview(element);
    const step = plan?.steps?.[Number(element.dataset.previewStep)];
    showActionPreview(this._planningContext ?? this._context, step);
  }

  _showDraftActionPreview(element) {
    if (this._destinationPicker) return;
    const step = this._findDraftStep(element.dataset.previewDraftStep);
    if (!step?.action) return;
    showActionPreview(this._contextForDraftStep(step.instanceId), {
      ...step.action,
      destination: step.destination,
      movementPlan: step.movementPlan,
      areaMarker: step.areaMarker,
      ...explicitTargetFields(step, step.action),
      requiresDestination: requiresDestinationForAction(step.action),
    });
  }

  _restorePosition() {
    if (this._restoredPosition || !readSetting(SETTINGS.rememberPanelPosition, true)) return;
    this._restoredPosition = true;

    const { left, top } = readPanelState();
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;

    if (typeof this.setPosition === "function") {
      this.setPosition({ left, top });
      return;
    }

    this._moveTo(left, top);
  }

  _savePosition() {
    if (!readSetting(SETTINGS.rememberPanelPosition, true)) return;
    const box = this.element.getBoundingClientRect();
    writePanelState({
      left: Math.round(box.left),
      top: Math.round(box.top),
    });
  }

  _moveTo(left, top) {
    if (typeof this.setPosition === "function") {
      this.setPosition({ left, top });
      return;
    }

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  _activateDrag(element) {
    const handle = element.querySelector(".combater-compact");
    if (!handle) return;

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button, a, input, select, textarea")) return;

      const startBox = element.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture?.(event.pointerId);

      const onMove = (moveEvent) => {
        this._moveTo(
          Math.max(0, startBox.left + moveEvent.clientX - startX),
          Math.max(0, startBox.top + moveEvent.clientY - startY),
        );
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        this._savePosition();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  _clearActionListScrollPerformance() {
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    if (this._scrollPerformanceTimer && typeof clearTimer === "function") clearTimer(this._scrollPerformanceTimer);
    this._scrollPerformanceTimer = null;
  }

  _activateActionListScrollPerformance(element) {
    const body = element.querySelector(".combater-body");
    if (!body) return;
    this._clearActionListScrollPerformance();

    const setTimer = globalThis.setTimeout ?? globalThis.window?.setTimeout;
    const clearTimer = globalThis.clearTimeout ?? globalThis.window?.clearTimeout;
    const markScrolling = () => {
      body.classList.add("is-scrolling");
      if (this._scrollPerformanceTimer && typeof clearTimer === "function") clearTimer(this._scrollPerformanceTimer);
      this._scrollPerformanceTimer = typeof setTimer === "function"
        ? setTimer(() => {
          body.classList.remove("is-scrolling");
          this._scrollPerformanceTimer = null;
        }, 120)
        : null;
    };

    body.addEventListener("scroll", markScrolling, { passive: true });
    body.addEventListener("wheel", markScrolling, { passive: true });
  }

  async _chooseSustainedSpellForStep(step) {
    if (!this._context || !step?.instanceId) return null;
    const entries = readSustainedSpellEntries(this._context, undefined, this._readActiveDraftPlan())
      .filter((entry) => entry.planned !== true && entry.sustained !== true);
    if (!entries.length) {
      globalThis.ui?.notifications?.warn?.("No sustained spells need sustaining.");
      return null;
    }

    let selected = entries[0];
    if (entries.length > 1) {
      const dialog = globalThis.foundry?.applications?.api?.DialogV2;
      if (typeof dialog?.wait !== "function") {
        globalThis.ui?.notifications?.warn?.("Choose a spell from the Sustained spells section first.");
        return null;
      }
      const choice = await dialog.wait({
        window: { title: "Sustain a Spell" },
        content: "<p>Choose which sustained spell to sustain.</p>",
        buttons: [
          ...entries.map((entry) => ({
            action: entry.id,
            label: escapeHtml(entry.name),
          })),
          { action: "cancel", label: "Cancel" },
        ],
        rejectClose: false,
      }).catch(() => "cancel");
      if (!choice || choice === "cancel") return null;
      selected = entries.find((entry) => entry.id === choice) ?? null;
      if (!selected) return null;
    }

    const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === step.instanceId) ?? step;
    const nextStep = this._stepWithRetryReset(current, { sustainedSpell: sustainedSpellDraftFields(selected) });
    await this._persistActiveDraftStep(nextStep);
    return {
      ...step,
      sustainedSpell: sustainedSpellDraftFields(selected),
    };
  }

  async executeStep(index) {
    await this._openActionDetails(this._builder?.autoFill?.steps?.[index] ?? this._plan?.steps?.[index]);
  }

  async _executeDraftStep(instanceId, event) {
    if (!this._canExecuteDraft()) return;
    let step = this._findDraftStep(instanceId);
    if (!this._context || !step || step.executionStatus === "done") return;

    const action = step.action ?? step;
    if (isSustainAction(action) && !step.sustainedSpell) {
      step = await this._chooseSustainedSpellForStep(step);
      if (!step) return;
    }

    const readiness = executionReadinessForStep(step, action);
    if (readiness.choices.length) {
      globalThis.ui?.notifications?.warn?.(readiness.warning || "Resolve required choices before executing.");
      return;
    }

    const result = await executeDraftStep({
      context: this._contextForDraftStep(step.instanceId) ?? this._context,
      step,
      action,
      event,
    });
    await this._applyExecutionResult(step, result, event);
  }

  _handleExecutionChoice(step, choice, event) {
    if (choice === "destination") {
      this._chooseDestination(step.instanceId);
      return true;
    }
    if (choice === "target") {
      this._chooseTarget(step.instanceId);
      return true;
    }
    if (choice === "area") {
      this._chooseArea(step.instanceId);
      return true;
    }
    if (choice === "retch-result") {
      this._confirmRetchResult(step, event);
      return true;
    }
    return false;
  }

  async _confirmRetchResult(step, event) {
    const message = "Did the Retch check reduce sickened?";
    const dialog = globalThis.foundry?.applications?.api?.DialogV2;
    const succeeded = dialog?.confirm
      ? await dialog.confirm({
        window: { title: "Retch result" },
        content: `<p>${escapeHtml(message)}</p>`,
        yes: { label: "Reduce sickened" },
        no: { label: "No reduction" },
      })
      : (globalThis.window?.confirm?.(message) ?? false);
    const result = await executeDraftStep({
      context: this._contextForDraftStep(step.instanceId) ?? this._context,
      step,
      action: step.action ?? step,
      event,
      choices: { retchSucceeded: succeeded === true },
    });
    await this._applyExecutionResult(step, result, event);
  }

  async _applyExecutionResult(step, result, event) {
    if (result?.status === "needs-choice") {
      this._handleExecutionChoice(step, result.choices?.[0], event);
      return;
    }
    if (!result || result.status === "cancelled") return;
    if (!this._context || !step?.instanceId) return;

    const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === step.instanceId) ?? step;
    await this._persistActiveDraftStep({ ...current, ...(result.patch ?? {}) });
    clearActionPreview();
    if (result.status === "failed" && result.error) globalThis.ui?.notifications?.warn?.(result.error);
    await this.render({ force: true });
  }

  async _revertDraftStep(instanceId) {
    if (!this._canExecuteDraft() || !this._context) return;
    const current = this._readActiveDraftPlan().steps.find((entry) => entry.instanceId === instanceId);
    if (!current || current?.execution?.status !== "done") return;
    const result = await revertDraftStep({
      context: this._contextForDraftStep(instanceId) ?? this._context,
      step: current,
    });
    await this._persistActiveDraftStep({ ...current, ...(result.patch ?? {}) });
    clearActionPreview();
    for (const warning of result.warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
    await this.render({ force: true });
  }

  async _resetExecution() {
    if (!this._canExecuteDraft() || !this._context) return;
    const { draft, warnings } = await revertDraftExecution({
      context: this._context,
      draft: this._readActiveDraftPlan(),
      contextForStep: (step) => this._contextForDraftStep(step?.instanceId) ?? this._context,
    });
    await this._writeActiveDraftPlan(draft);
    for (const warning of warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
    await this.render({ force: true });
  }

  async _openActionDetails(step) {
    if (!step) return;

    const actor = this._context?.actor?.document;
    if (step.item && await renderSheet(step.item)) return;
    if (await renderSheetFromUuid(step.uuid ?? step.sourceId)) return;
    await createGuidance(step, actor);
  }
}

export async function openPanelForCurrentCombatant(activePanel, refreshSource = "manual", options = {}) {
  if (activePanel) {
    if (Object.prototype.hasOwnProperty.call(options, "combatant")) {
      activePanel._selectedCombatant = options.combatant ?? null;
    }
    await activePanel.refresh?.(refreshSource);
    return activePanel;
  }

  const panel = new CombaterPanel({ ...options, refreshSource });
  await panel.render({ force: true });
  return panel;
}

export async function togglePanelForCurrentCombatant(activePanel, refreshSource = "manual", options = {}) {
  if (activePanel?.close) {
    await activePanel.close();
    return null;
  }

  return openPanelForCurrentCombatant(null, refreshSource, options);
}
