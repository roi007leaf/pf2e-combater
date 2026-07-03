import { MODULE_ID, STORAGE_KEYS } from "../constants.js";
import { SETTINGS, setting } from "../settings.js";
import {
  buildActionBuilderModel,
  actionBuilderKey,
  ACTION_BUILDER_TABS,
  builderAtomicActionsForStep,
  computeAreaMarker,
  isUnreachableStrikeStep,
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
  plannedTargetSelection,
  requiresAreaMarkerForAction,
  requiresTargetForAction,
  setTokenTargets,
  targetTokenId,
  tokensInAreaMarker,
} from "../engine/action-executor.js";
import { revertDraftExecution, revertDraftStep } from "../engine/action-revert.js";
import { buildCandidates } from "../engine/candidates.js";
import { confidenceLabel } from "../engine/confidence.js";
import { attacksTowardMap, bestTurnPlan, buildTurnPlans, isAttackAction, mapPenalty } from "../engine/planner.js";
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
  draftListForInstance,
  writeSharedDraftPlanActorFlag,
} from "../state/draft-plans.js";
import { clearActionPreview, showActionPreview } from "./action-preview.js";
import { CombaterBrowser } from "./CombaterBrowser.js";
import { showMovementPreview, recommendedMovementForStep } from "./movement-preview.js";
import { displayStepEntries } from "./display-steps.js";
import { autoFillCyclePlans, bestAutoFillPlan, nextAutoFillPlan, previousAutoFillPlan, selectDisplayPlan } from "./plan-selection.js";
import { cancelDestinationPicker, chooseDestination } from "./destination-picker.js";
import { cancelAreaPicker, chooseAreaMarker } from "./area-picker.js";
import { clearRangeOverlay, showRangeOverlay, updateRangePlacement } from "./range-overlay.js";
import { groupActionsByBuilderCategory } from "./action-categories.js";
import { actionDetailChips } from "./action-details.js";
import { actorMovementOptions } from "../readers/actor-profile.js";
import { readSustainedSpellEntries } from "../rules/sustained-spells.js";
import { canUseFullAggro } from "../rules/aggro.js";
import { promptRetchDc, promptRetchResult } from "../rules/retch-decision.js";
import { requestRetchDc, requestRetchResult, shareDraftPlan } from "../socket.js";
import { pf2eActionName, t } from "../i18n.js";

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

// Only a currently-connected owner counts. An absent player's owned character is the GM's to plan
// and execute for that session — there's no live player turn to defer to, so it should behave like
// any other actor the GM runs (e.g. an NPC ally) rather than lock the GM out of Auto-fill/execute.
function actorHasActiveNonGmOwner(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  const ownerLevel = ownershipLevelValue(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  const users = collectionValues(globalThis.game?.users).filter((user) => user && user.isGM !== true && user.active === true);

  if (typeof document.testUserPermission === "function") {
    return users.some((user) => document.testUserPermission(user, ownerLevel));
  }

  const ownership = document.ownership ?? {};
  return users.some((user) => ownershipLevelValue(ownership[user.id]) >= ownerLevel);
}

// A "player's actor" is one a non-GM user actually owns AND is currently online to play. An NPC-type
// actor, an unowned character (e.g. a GM-run NPC ally), or a character whose only owners are all
// offline is the GM's to plan, so we only treat genuinely player-piloted actors as player plans.
function isPlayerControlledActor(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  return actorHasActiveNonGmOwner(document);
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
  if (cost === "reaction") return t("Cost.Reaction", "reaction");
  if (cost === 0) return t("Cost.Free", "free");
  const numeric = Math.max(1, Math.min(3, Number(cost) || 1));
  return t(numeric === 1 ? "Cost.ActionOne" : "Cost.ActionMany", numeric === 1 ? "{count} action" : "{count} actions", { count: numeric });
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

// A generic Stride carries no target of its own, so the movement preview falls back to the first
// listed enemy. When the plan continues into an attack, the stride should instead close on the
// enemy that attack will hit. Borrow the next targeted step's resolved target so the recommended
// destination matches the strike (e.g. stride toward Alon when the plan is Stride -> Strike Alon).
// A generic basic move the planner scored negative (e.g. "repositioning is low priority" when the
// target is already in reach) wastes an action. Never auto-fill it, no matter which plan variant
// feeds the auto-fill (best plan, a pinned variant, or a projected-origin edge case).
const AUTO_FILL_BASIC_MOVE_SLUGS = new Set(["stride", "step", "stand-stride"]);
function isRedundantAutoFillMove(step) {
  return AUTO_FILL_BASIC_MOVE_SLUGS.has(String(step?.slug ?? "").toLowerCase())
    && step?.source === "generic"
    && Number(step?.score) < 0;
}

// The candidate slug is often the action id ("generic-drop-prone"), so match a contained substring.
function autoFillAppliesProne(step) {
  const slug = String(step?.slug ?? "").toLowerCase();
  return slug.includes("drop-prone") || step?.executable === "drop-prone";
}

function autoFillTargetCenter(step) {
  const target = step?.preferredTarget ?? step?.suggestedTarget ?? step?.target;
  return target?.token?.center ?? target?.center ?? null;
}

// Auto-fill aims a generic Stride at the plan's attack target, so its purpose is to improve position
// toward that target. The reachable set excludes the origin, so the "Stride to the same place" the GM
// sees is really a 1-cell shuffle that gets NO closer because the path is blocked (walls/water). Keep
// the Stride only if its destination actually gets meaningfully closer to the target; otherwise it
// accomplished nothing. (Kiting/retreat is a separate retreat action, not this target-aimed Stride.)
function strideImprovesPosition(originCenter, destination, targetCenter) {
  if (!destination || !originCenter) return true; // no recommendation/origin → don't second-guess
  const gridSize = Number(globalThis.canvas?.grid?.size) || 0;
  const minGain = gridSize > 0 ? gridSize * 0.5 : 1;
  if (!targetCenter) {
    return Math.hypot(destination.x - originCenter.x, destination.y - originCenter.y) >= minGain;
  }
  const before = Math.hypot(targetCenter.x - originCenter.x, targetCenter.y - originCenter.y);
  const after = Math.hypot(targetCenter.x - destination.x, targetCenter.y - destination.y);
  return (before - after) >= minGain;
}

// Final guard: never auto-commit a Stride/Step destination the actor can't actually reach in one
// move. Whatever produced the square (recommended placement, a composite's attack square), measure
// it with Foundry's own ruler and reject it if it costs more than the actor's Speed — that's the
// "stride lands way past max speed" bug. When the ruler is unavailable, trust the upstream bound.
function autoFillStrideOverSpeed(originCenter, destination, profile) {
  const measure = globalThis.canvas?.grid?.measurePath;
  const speed = Number(profile?.speed?.value ?? profile?.speed ?? profile?.landSpeed) || 0;
  if (!originCenter || !destination || typeof measure !== "function" || speed <= 0) return false;
  try {
    const cost = Number(measure([originCenter, destination])?.distance);
    return Number.isFinite(cost) && cost > speed + 0.01;
  } catch (_error) {
    return false;
  }
}

function strideStepTowardPlannedTarget(step, atomicSteps, index) {
  if (step?.preferredTarget || step?.suggestedTarget) return step;
  for (let next = index + 1; next < atomicSteps.length; next += 1) {
    const selection = plannedTargetSelection(atomicSteps[next]);
    if (selection.targets.length) return { ...step, preferredTarget: selection.targets[0] };
  }
  return step;
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
      const reason = action.disabledReason ?? action.unavailableReason ?? entry?.reason ?? t("Reject.NotAvailable", "Action is not available in current context.");
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
    return {
      ...SUSTAIN_A_SPELL_ACTION,
      name: pf2eActionName("sustain-a-spell", SUSTAIN_A_SPELL_ACTION.name),
      reason: t("Reason.SustainExtend", "Spend 1 action to extend a sustained spell's duration."),
      key: "sustain-a-spell",
      baseKey: "sustain-a-spell",
    };
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
  if (status === "done") return t("Panel.Done", "Done");
  if (status === "failed") return step?.execution?.error
    ? t("Panel.FailedReason", "Failed: {error}", { error: step.execution.error })
    : t("Panel.Failed", "Failed");
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

// The movement-action a draft step currently Strides with. Defaults to walking; a player can pin a
// different movement type (fly/burrow/swim/climb) per step, stored as `movementAction`.
function stepMovementAction(step) {
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

// A speed-based Stride lets the player pick which speed to travel on. Move-and-strike activities
// auto-plot their movement (no destination prompt), and Step/Crawl are fixed 5-ft moves, so neither
// offers a movement-type choice.
function isSpeedBasedMovementStep(action) {
  if (!action || action?.activityProfile?.teleport === true) return false;
  if (!requiresDestinationForAction(action)) return false;
  const slug = String(action?.slug ?? action?.action?.slug ?? "").toLowerCase();
  return slug !== "step" && slug !== "crawl";
}

function decorateDraftStep(step, index, { readonly = false, gmExecute = false, total = 0, reorderLocked = false, awaitingGm = null, movementOptions = [] } = {}) {
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
  // A completed step's readiness/validity warnings are stale — don't surface them.
  const warning = isExecutionDone ? "" : (readiness.warning || rawWarning);
  const canShowExecuteStep = canRunStep && !isExecutionDone && Boolean(action) && step?.stale !== true;
  const executionBlocked = canShowExecuteStep && readiness.status !== "ready";
  const canEditStepOrder = readonly !== true && reorderLocked !== true;
  // Per-strike multiple-attack-penalty control: shows the current MAP and lets the owner cycle it
  // (auto -> 0 -> -5 -> -10 -> auto) for abilities that keep MAP flat across attacks.
  const isAttackStep = Number.isFinite(step?.attackIndex);
  const mapPenaltyValue = Number(step?.mapPenalty) || 0;
  const mapToolLabel = mapPenaltyValue > 0
    ? t("Panel.MapValue", "MAP -{penalty}", { penalty: mapPenaltyValue })
    : t("Panel.MapFull", "MAP 0");
  const mapPinned = step?.mapPinned === true;
  const mapToolTip = mapPinned
    ? t("Panel.MapPinned", "MAP pinned to {label}. Click to cycle.", { label: mapToolLabel })
    : t("Panel.MapAuto", "MAP auto ({label}). Click to pin.", { label: mapToolLabel });
  // Per-Stride movement-type control: lets the owner travel on a non-walking speed (fly/burrow/swim/
  // climb) when the actor has one, sizing the reachable range to that speed. Only shown when the
  // actor actually has more than one movement type to choose from.
  const movementAction = stepMovementAction(step);
  const movementToolLabel = movementActionLabel(movementAction);
  const canCycleMovement = isSpeedBasedMovementStep(action ?? step)
    && canRunStep && !isExecutionDone && movementOptions.length > 1;
  const movementToolTip = t("Panel.MovementCycle", "Stride on {label} Speed. Click to change.", { label: movementToolLabel });
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
      ? t("Panel.AwaitingGm", "Waiting for the GM…")
      : (executionBlocked ? (readiness.warning || t("Notify.ResolveChoices", "Resolve required choices before executing.")) : t("Panel.ExecuteStep", "Execute this step")),
    awaitingGm: isAwaitingGm,
    awaitingGmLabel: t("Panel.AwaitingGm", "Waiting for the GM…"),
    canCycleMap: isAttackStep && canRunStep && !isExecutionDone,
    mapToolLabel,
    mapToolTip,
    mapPinned,
    canCycleMovement,
    movementToolLabel,
    movementToolTip,
    canMoveStepUp: canEditStepOrder && index > 0,
    canMoveStepDown: canEditStepOrder && index < total - 1,
    // Per-step revert shows for the owner, or for a GM running an AFK player's shared plan.
    canRevertStep: isExecutionDone && canRunStep,
    warning,
    hasStepDetails: Boolean(targetLabel || stepAreaLabel || warning || isAwaitingGm),
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
      actions: filterBuilderTabActions(tab.favorites, searchQuery)
        .map((action) => decorateAction(action, { readonly })),
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

// Search matches the action's title only. Including the prose fields (reason, disabledReason,
// target/cost labels) meant a query like "reach" matched "Force Open" via "...in reach.",
// which reads as nonsense to the user. Slug is the title normalized, so it stays.
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

function sustainedSpellDraftFields(entry) {
  return {
    id: entry?.id,
    name: entry?.name ?? t("Sustain.DefaultName", "Sustained spell"),
    spellUuid: entry?.spellUuid ?? null,
    effectIds: Array.isArray(entry?.effectIds) ? [...entry.effectIds] : [],
    templateRefs: Array.isArray(entry?.templateRefs) ? [...entry.templateRefs] : [],
  };
}

// Tag each attack step with its multiple-attack-penalty level by position in the sequence, so the
// 2nd/3rd strike rolls (and displays) at the right MAP rather than always at full bonus. Continues
// the running attack count from `startCount` and returns the updated count for the next list. The
// penalty is written onto the step and its action for the display label; `attackIndex` (1-based)
// drives the variant the executor rolls.
function injectMapInfo(steps, startCount = 0) {
  let attackCount = startCount;
  const tagged = (Array.isArray(steps) ? steps : []).map((step) => {
    const action = step?.action ?? step;
    if (!isAttackAction(action)) return step;
    const autoLevel = Math.min(2, attackCount); // position-derived MAP level: 0, 1, 2
    attackCount += attacksTowardMap(action);
    // A player can pin a specific MAP level per strike (0 / -5 / -10); some abilities keep MAP flat
    // across consecutive attacks, so the auto position isn't always right. `mapOverride` null = auto.
    const override = Number.isFinite(step?.mapOverride) ? Math.max(0, Math.min(2, step.mapOverride)) : null;
    const level = override ?? autoLevel;
    const penalty = mapPenalty(action, level);
    return {
      ...step,
      attackIndex: level + 1,
      mapPenalty: penalty,
      mapPinned: override !== null,
      action: step?.action ? { ...step.action, mapPenalty: penalty } : step?.action,
    };
  });
  return { steps: tagged, attackCount };
}

// Collapses consecutive same-groupId steps (2+) into one { isGroup: true, children } entry for
// display, so a distinct-target ability's atoms (e.g. a Kraken's two Double Attack Strikes) nest
// under one shared header instead of showing as identical-looking independent rows. A lone,
// unpaired member of a group (e.g. after a manual delete) is passed through unchanged -- a header
// around a single child adds visual noise with no benefit.
function groupDraftSteps(steps) {
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
    grouped.push({
      isGroup: true,
      groupLabel: members[0].groupLabel,
      instanceId: members[0].instanceId,
      actionGlyphIcon: members[0].actionGlyphIcon,
      costLabel: members[0].costLabel,
      canMoveStepUp: members[0].canMoveStepUp,
      canMoveStepDown: members[members.length - 1].canMoveStepDown,
      children: members.map((member) => ({
        ...member,
        name: member.name?.startsWith(prefix) ? member.name.slice(prefix.length) : member.name,
        canMoveStepUp: false,
        canMoveStepDown: false,
      })),
    });
    i = end;
  }
  return grouped;
}

function decorateBuilder(builder, activeTab, searchQuery = "", { sustainedSpells = [], awaitingGm = null, movementOptions = [] } = {}) {
  if (!builder) return null;
  const draftReadonly = builder.draft?.readonly === true;
  const isPlayerPlan = builder.draft?.shared === true;
  // The GM may execute a player's shared plan on their behalf even though it's read-only to edit.
  const gmCanRunPlayerPlan = globalThis.game?.user?.isGM === true && isPlayerPlan;
  const sharedDraftUserName = String(builder.draft?.userName ?? "").trim();
  const rawSteps = builder.draft?.steps ?? [];
  const reorderLocked = rawSteps.some((step) => executionStatus(step) !== "pending");
  const planMap = injectMapInfo(rawSteps, 0);
  const rawDraftSteps = planMap.steps
    .map((step, index) => decorateDraftStep(step, index, {
      readonly: draftReadonly,
      gmExecute: gmCanRunPlayerPlan,
      total: rawSteps.length,
      reorderLocked,
      awaitingGm,
      movementOptions,
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
  // Uncounted attacks come after the plan in the turn, so their MAP continues the plan's count.
  const uncountedMap = injectMapInfo(rawUncounted, planMap.attackCount);
  const rawUncountedSteps = uncountedMap.steps.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    total: rawUncounted.length,
    reorderLocked: uncountedReorderLocked,
    awaitingGm,
    movementOptions,
  }));
  const currentUncountedStep = nextPendingExecutionStep({ steps: rawUncountedSteps });
  const uncountedEntries = rawUncountedSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentUncountedStep?.instanceId,
  }));
  const allExecutable = [...draftSteps, ...uncountedEntries];
  const executedCount = allExecutable.filter((step) => step.executionStatus === "done").length;
  const canResetExecution = allExecutable.some((step) => step.executionStatus === "done" || step.executionStatus === "failed");
  return {
    ...builder,
    readonly: draftReadonly,
    tabsList: ACTION_BUILDER_TABS.map((tab) => ({
      ...decorateBuilderTab(builder.tabs[tab.id], active, { readonly: draftReadonly, searchQuery }),
      label: t(`Tab.${tab.id}`, tab.label),
    })),
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
  const name = step?.name ?? t("Guidance.RecommendedAction", "Recommended action");
  const reason = step?.reason ?? t("Guidance.ReviewRecommendation", "Review this recommendation before acting.");
  const message = `<strong>${escapeHtml(name)}</strong><br>${escapeHtml(reason)}`;
  const userId = game?.user?.id;

  if (globalThis.ChatMessage?.create && userId) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content: message,
      whisper: [userId],
    });
    return;
  }

  globalThis.ui?.notifications?.info?.(`${name}: ${step?.reason ?? t("Guidance.ReviewShort", "Review recommendation.")}`);
}

async function confirmReplaceDraft() {
  const message = t("Dialog.ReplaceDraft.Message", "Replace current draft with Auto-fill plan?");
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (dialog?.confirm) {
    return dialog.confirm({
      window: { title: t("Dialog.ReplaceDraft.Title", "Replace draft") },
      content: `<p>${escapeHtml(message)}</p>`,
      yes: { label: t("Dialog.Replace", "Replace") },
      no: { label: t("Dialog.Cancel", "Cancel") },
    });
  }
  return globalThis.window?.confirm?.(message) ?? true;
}

function markManualDraft(draft) {
  return {
    ...draft,
    source: "manual",
    autoFillPlanId: null,
    autoFillPlanSummary: "",
  };
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
      width: 720,
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
    this._autoFillPlans = [];
    this._plan = null;
    this._builder = null;
    this._gmExecuteMode = false;
    this._destinationPicker = null;
    this._areaPicker = null;
    // Draft-step instanceIds currently blocked on a GM socket response (e.g. Retch DC/result), so
    // the step can show a "waiting for the GM" indicator. Transient, never persisted.
    this._awaitingGm = new Set();
    this._pinnedPlanId = null;
    this._selectedCombatant = options.combatant ?? null;
    this._onClose = typeof options.onClose === "function" ? options.onClose : null;
    this._restoredPosition = false;
    this._browser = null;
    this._closing = false;
    this._scrollPerformanceTimer = null;
    this._searchRenderTimer = null;
    this._searchFocusState = null;
  }

  // Switch the planned combatant WITHOUT rebuilding. Selecting a token fires controlToken on the
  // canvas thread; rebuilding the plan there (buildCandidates + buildTurnPlans) blocks the selection
  // frame — that's the lag. Callers that select via the canvas set the combatant with this and let
  // the debounce rebuild a tick later, keeping the click responsive.
  selectCombatant(combatant) {
    this._selectedCombatant = combatant ?? null;
  }

  async setCombatant(combatant, refreshSource = "combatant-selection") {
    this.selectCombatant(combatant);
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
      this._autoFillPlans = [];
      this._plan = null;
      this._builder = null;
      this._planningContext = null;
      this._movementOptions = [];
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
    // Mirroring/locking to the shared draft only makes sense while the player is actively online —
    // otherwise a stale shared draft from earlier in the session (even an empty one; any draft the
    // player ever shared stamps sharedDraftKnown for the rest of the encounter) would keep an absent
    // player's actor stuck read-only forever. Once they're offline, fall through to the GM's own
    // editable local draft — the same one any other actor the GM runs already uses.
    const activeDraft = (gmViewingPlayerPlan && useSharedDraft)
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
    const autoFillPlans = buildTurnPlans(context, baseBuilderCandidates);
    const plans = buildTurnPlans(planningContext, builderCandidates);
    if (this._pinnedPlanId && !autoFillPlans.some((candidatePlan) => candidatePlan?.id === this._pinnedPlanId)) {
      this._pinnedPlanId = null;
    }
    const plan = selectDisplayPlan(plans, this._pinnedPlanId) ?? bestTurnPlan(planningContext, builderCandidates);
    const favorites = readActionFavorites(context);

    this._candidates = builderCandidates;
    this._rejected = rejected;
    this._detected = detected;
    this._plans = plans;
    this._autoFillPlans = autoFillPlans;
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
    this._movementOptions = actorMovementOptions(this._actorForMovement(context));
    this._builder = decorateBuilder(builderModel, this.activeTab, this.searchQuery, { sustainedSpells, awaitingGm: this._awaitingGm, movementOptions: this._movementOptions });
    this._builder.readonly = this._builder.readonly || gmViewingPlayerPlan;

    return this._viewContext(context);
  }

  _viewContext(context) {
    const showDebug = Boolean(game?.user?.isGM && readSetting(SETTINGS.showDebugTab, false));
    // The GM can hide Auto-fill from players so they plan their own turns rather than taking the
    // generic recommendation. The GM always keeps it.
    const showAutoFill = game?.user?.isGM === true || !readSetting(SETTINGS.hideAutoFillFromPlayers, false);
    const selectedAutoFill = this._selectedAutoFillPlan();
    const autoFill = decoratePlan(selectedAutoFill, 0);
    const autoFillCycle = autoFillCyclePlans(this._autoFillPlans);
    const autoFillCycleIndex = autoFillCycle.findIndex((plan) => plan?.id === selectedAutoFill?.id);
    const autoFillCyclePosition = autoFillCycleIndex >= 0 ? autoFillCycleIndex + 1 : 1;
    const draftSteps = this._builder?.draft?.steps ?? [];

    return {
      actor: context?.actor ?? null,
      token: context?.token ?? null,
      plan: autoFill,
      headerSteps: groupDraftSteps(draftSteps),
      headerSummary: "",
      builder: this._builder,
      expanded: this.expanded,
      activeTab: this.activeTab,
      browserOpen: Boolean(this._browser),
      showDebug,
      showAutoFill,
      autoFillCycle: {
        canCycle: autoFillCycle.length > 1,
        label: `${autoFillCyclePosition}/${Math.max(1, autoFillCycle.length)}`,
        tooltip: t("Panel.AutoFillCycleTooltip", "Left-click next plan; right-click previous. Current: {current}/{total}.", { current: autoFillCyclePosition, total: Math.max(1, autoFillCycle.length) }),
        ariaLabel: t("Panel.AutoFillCycleAria", "Cycle Auto-fill plan"),
      },
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

  _selectedAutoFillPlan() {
    return selectDisplayPlan(this._autoFillPlans, this._pinnedPlanId)
      ?? this._builder?.autoFill
      ?? this._plan;
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

    element.querySelector("[data-action='toggle-browser']")
      ?.addEventListener("click", () => this._toggleBrowser());
    element.querySelector("[data-action='refresh']")
      ?.addEventListener("click", () => this.refresh("button"));

    // Cost tabs, search, and the action add/favorite/open controls live in the detached
    // browser window now (see CombaterBrowser); the panel only wires plan-side controls.
    for (const button of element.querySelectorAll("[data-add-sustain-spell]")) {
      button.addEventListener("click", () => this._addSustainSpell(button.dataset.addSustainSpell));
    }

    for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
      button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
    }

    for (const button of element.querySelectorAll("[data-cycle-map]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._cycleStepMap(button.dataset.cycleMap);
      });
    }

    for (const button of element.querySelectorAll("[data-cycle-movement]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._cycleStepMovement(button.dataset.cycleMovement);
      });
    }

    for (const button of element.querySelectorAll("[data-move-draft-step]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._moveDraftStep(button.dataset.moveDraftStep, button.dataset.moveDirection);
      });
    }

    for (const button of element.querySelectorAll("[data-auto-fill]")) {
      button.addEventListener("click", () => this._autoFillDraft());
    }

    for (const button of element.querySelectorAll("[data-cycle-auto-fill]")) {
      button.addEventListener("click", () => this._cycleAutoFillDraft());
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this._cycleAutoFillDraft(-1);
      });
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

    // Keep the detached browser window in sync: every panel render (mutation, refresh, or
    // combat hook) recomputes _builder, so re-render the browser from it. No-op when closed.
    this._browser?.render({ force: true });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Reopen the browser window if it was open when the panel last closed.
    if (!this._browser && readPanelState().browserOpen) this._toggleBrowser();
  }

  // Context for the browser window: it renders the panel's already-computed builder model.
  browserViewContext() {
    const showDebug = Boolean(game?.user?.isGM && readSetting(SETTINGS.showDebugTab, false));
    return {
      builder: this._builder,
      readonly: this._builder?.readonly === true,
      showDebug,
      actor: this._context?.actor ?? null,
      debug: {
        candidates: this._candidates.map(debugAction),
        rejected: this._rejected.map((entry, index) => ({
          index,
          action: debugAction(entry?.action, index),
          reason: entry?.reason ?? "",
        })),
        detected: this._detected.map(debugAction),
      },
    };
  }

  _toggleBrowser() {
    if (this._browser) {
      this._browser.close();
      return;
    }
    this._browser = new CombaterBrowser(this);
    writePanelState({ browserOpen: true });
    // Panel re-render updates the toggle's active state and cascades to show/render the browser.
    this.render({ force: true });
  }

  _onBrowserClosed(browser) {
    if (browser && this._browser && this._browser !== browser) return;
    this._browser = null;
    if (this._closing) return;
    writePanelState({ browserOpen: false });
    this.render({ force: true });
  }

  async close(options) {
    this._closing = true;
    this._browser?.close();
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
    return {
      ...SUSTAIN_A_SPELL_ACTION,
      name: pf2eActionName("sustain-a-spell", SUSTAIN_A_SPELL_ACTION.name),
      reason: t("Reason.SustainExtend", "Spend 1 action to extend a sustained spell's duration."),
      key: "sustain-a-spell",
      baseKey: "sustain-a-spell",
    };
  }

  _findSustainedSpell(spellId) {
    const id = normalizedSlug(spellId);
    return this._builder?.sustainedSpells?.entries?.find((entry) => normalizedSlug(entry.id) === id) ?? null;
  }

  _findDraftStep(instanceId) {
    return this._builder?.draft?.steps?.find((step) => step.instanceId === instanceId)
      ?? this._builder?.uncounted?.entries?.find((step) => step.instanceId === instanceId)
      ?? null;
  }

  // Reach Spell (and other range-extending spellshapes) modify the spell cast right
  // after them, so the spell's effective range — and its range ring — grows by 30 ft
  // when the immediately-preceding step is a rangeBuff setup. Returns the feet to add.
  _spellRangeBonus(steps, index) {
    if (!Array.isArray(steps) || index <= 0) return 0;
    const previous = steps[index - 1];
    const profile = previous?.action?.activityProfile ?? previous?.activityProfile ?? {};
    return profile?.rangeBuff === true ? 30 : 0;
  }

  _draftRangeBonus(instanceId) {
    const steps = this._builder?.draft?.steps ?? [];
    return this._spellRangeBonus(steps, steps.findIndex((step) => step.instanceId === instanceId));
  }

  // Resolve a step from whichever stored list owns it (plan or uncounted).
  _findActiveStep(instanceId) {
    const draft = this._readActiveDraftPlan();
    return (draft.steps ?? []).find((entry) => entry.instanceId === instanceId)
      ?? (draft.uncounted ?? []).find((entry) => entry.instanceId === instanceId)
      ?? null;
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

  async _persistActiveDraftStep(step, listKey) {
    const targetList = listKey ?? draftListForInstance(this._readActiveDraftPlan(), step.instanceId);
    if (this._gmExecuteMode === true) {
      const draft = readSharedDraftPlan(this._context);
      const list = [...(draft[targetList] ?? [])];
      const index = list.findIndex((entry) => entry.instanceId === step.instanceId);
      if (index >= 0) list[index] = step;
      else list.push(step);
      await this._writeActiveSharedDraft({ ...draft, [targetList]: list });
      return;
    }
    upsertDraftStep(this._context, step, targetList);
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

    // The normal plan respects the turn's action economy; only uncounted actions
    // run off-budget. Refuse a plan add that would exceed the budget.
    if (action.overBudget) {
      globalThis.ui?.notifications?.warn?.(action.disabledReason || t("Notify.NotEnoughActions", "Not enough actions remaining."));
      return;
    }

    const draft = this._readActiveDraftPlan();
    await this._writeActiveDraftPlan(markManualDraft({
      ...draft,
      steps: [
        ...(draft.steps ?? []),
        {
          instanceId: draftStepId(),
          actionKey: action.key,
          // Persist a display name so the step still reads correctly if its action stops being
          // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
          name: action.name,
          actionCost: action.actionCost ?? action.cost,
          requiresDestination: requiresDestinationForAction(action),
        },
      ],
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  // Uncounted adds run alongside the plan but off-budget. Allowed for the plan owner and
  // for a GM running an AFK player's shared plan (hence _canExecuteDraft, not _canEditDraft).
  async _addUncountedAction(actionKey) {
    if (!this._canExecuteDraft()) return;
    const action = this._findBuilderAction(actionKey);
    if (!this._context || !action) return;
    const draft = this._readActiveDraftPlan();
    await this._writeActiveDraftPlan(markManualDraft({
      ...draft,
      uncounted: [
        ...(draft.uncounted ?? []),
        {
          instanceId: draftStepId(),
          actionKey: action.key,
          // Persist a display name so the step still reads correctly if its action stops being
          // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
          name: action.name,
          actionCost: action.actionCost ?? action.cost,
          requiresDestination: requiresDestinationForAction(action),
        },
      ],
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _addSustainSpell(spellId) {
    if (!this._canEditDraft()) return;
    const spell = this._findSustainedSpell(spellId);
    const action = this._findSustainAction();
    if (!this._context || !spell || !action || action.disabled) {
      globalThis.ui?.notifications?.warn?.(action?.disabledReason ?? t("Notify.SustainUnavailable", "Sustain a Spell is not available."));
      return;
    }

    const draft = this._readActiveDraftPlan();
    await this._writeActiveDraftPlan(markManualDraft({
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
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _removeDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
    await this._writeActiveDraftPlan(markManualDraft({
      ...draft,
      [listKey]: list.filter((step) => step.instanceId !== instanceId),
    }));
    clearActionPreview();
    await this.render({ force: true });
  }

  async _moveDraftStep(instanceId, direction) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const draft = this._readActiveDraftPlan();
    const listKey = draftListForInstance(draft, instanceId);
    if ((draft[listKey] ?? []).some((step) => executionStatus(step) !== "pending")) {
      globalThis.ui?.notifications?.warn?.(t("Notify.RevertBeforeReorder", "Revert executed steps before reordering."));
      return;
    }
    const steps = Array.isArray(draft[listKey]) ? [...draft[listKey]] : [];
    const index = steps.findIndex((step) => step.instanceId === instanceId);
    const offset = Math.sign(Number(direction) || 0);
    const nextIndex = index + offset;
    if (index < 0 || offset === 0 || nextIndex < 0 || nextIndex >= steps.length) return;
    [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
    await this._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: steps }));
    clearActionPreview();
    await this.render({ force: true });
  }

  // Cycle a strike's multiple-attack-penalty level: auto -> MAP 0 -> -5 -> -10 -> auto. The chosen
  // level is pinned on the step (mapOverride) and overrides the position-derived default, for
  // abilities that keep MAP flat across consecutive attacks.
  async _cycleStepMap(instanceId) {
    if (!this._canExecuteDraft()) return;
    if (!this._context || !instanceId) return;
    const step = this._findActiveStep(instanceId) ?? this._findDraftStep(instanceId);
    if (!step) return;
    const current = Number.isFinite(step.mapOverride) ? step.mapOverride : null;
    const next = current == null ? 0 : current >= 2 ? null : current + 1;
    await this._persistActiveDraftStep({ ...step, mapOverride: next });
    await this._syncDraftToGM();
    await this.render({ force: true });
  }

  // The live PF2e actor for the planning combatant, used to read its movement speeds. Prefers the
  // canvas token's actor (freshest derived data) and falls back to the context summary's document.
  _actorForMovement(context) {
    const ids = [
      context?.token?.id,
      context?.token?.uuid,
      context?.combatant?.tokenId,
      context?.combatant?.token?.id,
    ].filter(Boolean);
    // Scan placeables (canvas.tokens.get isn't reliable across versions) for the live token's actor,
    // which carries the prepared movement speeds; fall back to the context summary's actor document.
    for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
      const document = token?.document ?? token;
      const matches = ids.some((id) => token?.id === id || token?.uuid === id || document?.id === id || document?.uuid === id);
      if (matches && token?.actor) return token.actor;
    }
    return context?.actor?.document ?? context?.actor ?? null;
  }

  // Cycle a Stride's movement type through the actor's available speeds (walk -> fly -> burrow ->
  // ...-> walk). The chosen movement-action is pinned on the step (and its action) so the executor
  // travels on that speed and the destination picker sizes the reachable range to it.
  async _cycleStepMovement(instanceId) {
    if (!this._canExecuteDraft()) return;
    if (!this._context || !instanceId) return;
    const options = Array.isArray(this._movementOptions) ? this._movementOptions : [];
    if (options.length <= 1) return;
    const step = this._findActiveStep(instanceId) ?? this._findDraftStep(instanceId);
    if (!step) return;
    const current = stepMovementAction(step);
    const index = Math.max(0, options.findIndex((option) => option.action === current));
    const next = options[(index + 1) % options.length].action;
    await this._persistActiveDraftStep({
      ...step,
      movementAction: next,
      action: step.action ? { ...step.action, movementAction: next } : step.action,
    });
    await this._syncDraftToGM();
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

    // A distinct-target atom (e.g. a Kraken's Double Attack) borrows its backing weapon's real
    // item reference so Execute can actually roll it (see double-attack-backing-strike plan) --
    // which makes step.item.uuid collide with that weapon's OWN standalone candidate below. The
    // atom's slug is deliberately the original ability's own, unique slug, so it must be checked
    // on its own first, or the item.uuid fallback below wins the race and mislabels the step as
    // the borrowed weapon instead of the ability that actually produced it.
    if (step?.activityProfile?.requiresDistinctTargets) {
      for (const tab of Object.values(this._builder?.tabs ?? {})) {
        const action = tab.all.find((candidate) => candidate.slug === step?.slug);
        if (action) return action.key;
      }
    }

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

  async _autoFillDraft({ plan = null } = {}) {
    if (!this._canEditDraft()) return;
    // Respect the GM's "hide Auto-fill from players" setting regardless of how this was triggered.
    if (game?.user?.isGM !== true && readSetting(SETTINGS.hideAutoFillFromPlayers, false)) return;
    if (!this._context) return;
    const draft = this._readActiveDraftPlan();
    const replacingDraft = (draft.steps?.length ?? 0) > 0;
    const replacingManualDraft = replacingDraft && draft.source !== "auto-fill";
    if (replacingManualDraft && !await confirmReplaceDraft()) return;
    const fallbackAutoFill = () => {
      const candidateBuild = buildCandidates(this._context);
      return bestTurnPlan(this._context, candidateBuild.candidates);
    };
    if (!plan) this._pinnedPlanId = null;
    const autoFill = plan
      ?? bestAutoFillPlan(this._autoFillPlans)
      ?? this._builder?.autoFill
      ?? this._plan
      ?? fallbackAutoFill();
    if (!autoFill?.steps?.length) return;

    // For the GM running an NPC, the recommendation already chose targets (aggro) and a stride
    // destination; pre-fill both so the GM doesn't re-pick each one. (Players target/move by
    // hand.) The projected origin advances so a chained stride starts where the prior one lands.
    const useAggroTargets = canUseFullAggro(this._context);
    let movementContext = this._context;
    // Hard guard: "Drop Prone -> Stride" is illegal (can't Stride while prone). If the plan applies
    // prone, drop any Stride/Step from the draft regardless of what the planner produced. Crawl is
    // legal while prone, so it is not in AUTO_FILL_BASIC_MOVE_SLUGS and survives.
    const planAppliesProne = autoFill.steps.some(autoFillAppliesProne);
    const atomicSteps = autoFill.steps
      .filter((step) => !isRedundantAutoFillMove(step))
      .flatMap((step) => builderAtomicActionsForStep(step))
      // Filter AFTER expansion: a move-and-strike composite (e.g. "stride-away-strike-dart") expands
      // into a bare Stride, which is illegal while prone. Drop those Stride/Step atoms.
      .filter((step) => !(planAppliesProne && AUTO_FILL_BASIC_MOVE_SLUGS.has(String(step?.slug ?? "").toLowerCase())));
    const steps = atomicSteps.map((step, index) => {
      const slug = String(step?.slug ?? "").toLowerCase();
      const isBasicMove = AUTO_FILL_BASIC_MOVE_SLUGS.has(slug);
      // Origin for THIS step = where the prior committed strides left the actor (real position for
      // the first). Computed before any chaining update below so over-Speed checks use the true origin.
      const moveOrigin = movementContext.token?.plannedCenter ?? movementContext.token?.center;
      // Keep a pre-set destination (e.g. a composite's attack square) only if the actor can actually
      // reach it this move — Foundry's ruler is the authority, so an over-Speed square is dropped
      // rather than auto-committed as an impossible stride.
      const presetDestination = step?.destination
        && !(isBasicMove && autoFillStrideOverSpeed(moveOrigin, step.destination, this._context?.profile))
        ? step.destination
        : null;
      const presetAreaMarker = !step?.areaMarker ? computeAreaMarker(this._context, step) : null;
      let draftStep = {
        instanceId: draftStepId(),
        actionKey: this._actionKeyForStep(step),
        // Persist a display name so the step still reads correctly if its action stops being
        // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
        name: step?.name ?? step?.action?.name,
        actionCost: step?.actionCost ?? step?.cost,
        requiresDestination: requiresDestinationForAction(step),
        // A distinct-target ability's atoms all share the same id (compositeStrikeActionKey is
        // computed from the original, un-atomized action) -- reused here as the group id so the
        // panel can visually nest them under one header instead of showing N identical-looking rows.
        ...(step?.activityProfile?.requiresDistinctTargets
          ? { groupId: step.id, groupLabel: String(step?.name ?? "").split(" -> ")[0] }
          : {}),
        ...(presetDestination ? { destination: presetDestination } : {}),
        ...(presetAreaMarker ? { areaMarker: presetAreaMarker } : {}),
      };
      if (!useAggroTargets) return draftStep;

      const target = plannedTargetSelection(step);
      if (target.targetTokenIds.length) {
        draftStep = {
          ...draftStep,
          targetTokenIds: target.targetTokenIds,
          targetLabel: target.targetLabel,
          targetSelection: "manual",
        };
      }

      if (draftStep.requiresDestination && !draftStep.destination) {
        const movementStep = strideStepTowardPlannedTarget(step, atomicSteps, index);
        const movement = recommendedMovementForStep(movementContext, movementStep);
        // Drop a target-aimed basic Stride/Step that can't improve position toward the planned
        // target (blocked path = the "Stride to the same place" the GM sees). A real closing move is
        // kept. Deliberate kiting (melee, then Stride away, then ranged) is a manual play.
        if (isBasicMove && movement?.destination
          && !strideImprovesPosition(moveOrigin, movement.destination, autoFillTargetCenter(movementStep))) {
          return null;
        }
        // Commit (and chain the planned origin) only for a destination within Speed; otherwise leave
        // it unset so the GM places a legal one instead of an over-range auto-stride.
        if (movement?.destination
          && !(isBasicMove && autoFillStrideOverSpeed(moveOrigin, movement.destination, this._context?.profile))) {
          draftStep = {
            ...draftStep,
            destination: movement.destination,
            ...(movement.waypoints?.length ? { movementPlan: { native: false, waypoints: movement.waypoints } } : {}),
          };
          movementContext = {
            ...movementContext,
            token: { ...(movementContext.token ?? {}), plannedCenter: movement.destination },
          };
        }
      }

      return draftStep;
    }).filter(Boolean);
    // Drop a Strike that can never connect: out of range from where it executes with no earlier
    // move to close the gap (e.g. a move-and-strike whose Stride was pruned, or an aggro target
    // left out of melee reach). Resolve each step from its projected origin, as the warnings do.
    const reachDraft = { steps };
    const reachableSteps = steps.filter((step, index) => {
      const hasEarlierMove = steps.slice(0, index).some((earlier) => earlier.requiresDestination === true);
      const projected = findProjectedDraftAction(this._context, reachDraft, step);
      return !isUnreachableStrikeStep(projected, hasEarlierMove);
    });
    await this._writeActiveDraftPlan({
      ...draft,
      source: "auto-fill",
      autoFillPlanId: autoFill.id ?? null,
      autoFillPlanSummary: autoFill.summary ?? "",
      steps: reachableSteps,
    });
    clearActionPreview();
    await this.render({ force: true });
  }

  async _cycleAutoFillDraft(direction = 1) {
    const current = selectDisplayPlan(this._autoFillPlans, this._pinnedPlanId);
    const currentId = current?.id ?? this._pinnedPlanId;
    const next = direction < 0
      ? previousAutoFillPlan(this._autoFillPlans, currentId)
      : nextAutoFillPlan(this._autoFillPlans, currentId);
    if (!next) return;
    this._pinnedPlanId = next.id ?? null;
    await this._autoFillDraft({ plan: next });
  }

  async _syncDraftToGM({ notify = false } = {}) {
    if (!this._context || globalThis.game?.user?.isGM === true) return false;
    const draft = readDraftPlan(this._context);

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

      if (!shareDraftPlan(payload)) {
        console.warn(`${MODULE_ID} | Cannot sync plan: socketlib is not available.`);
        if (notify) globalThis.ui?.notifications?.warn?.(t("Notify.SyncNoSocket", "Cannot sync plan with GM: Foundry socket is not available."));
        return false;
      }
      if (notify) globalThis.ui?.notifications?.info?.(t("Notify.PlanShared", "Plan shared with GM."));
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Plan sync failed`, error);
      if (notify) globalThis.ui?.notifications?.warn?.(t("Notify.SyncFailed", "Could not sync plan with GM."));
      return false;
    }
  }

  _cancelDestinationPicker() {
    this._destinationPicker = null;
    this._areaPicker = null;
    cancelDestinationPicker();
    cancelAreaPicker();
    clearRangeOverlay();
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
      // Pending elevation (Shift+scroll before a destination is committed) so the readout and
      // shrinking reachable range still update.
      ...(Number.isFinite(preview?.elevation) ? { plannedElevation: preview.elevation } : {}),
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
            elevation: metadata.elevation,
          },
        };
        this._showDestinationPickerPreview(instanceId);
      },
      onCancel: () => {
        this._destinationPicker = null;
        clearActionPreview();
      },
      onChoose: async (destination, metadata = {}) => {
        const current = this._findActiveStep(instanceId) ?? step;
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
      globalThis.ui?.notifications?.warn?.(t("Notify.NoDestinationPicker", "Canvas destination picker is not available."));
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
      globalThis.ui?.notifications?.warn?.(t("Notify.TargetFirst", "Target a token in Foundry first."));
      return;
    }
    const current = this._findActiveStep(instanceId) ?? step;
    await this._persistActiveDraftStep(this._stepWithRetryReset(current, {
      targetTokenIds: selection.targetTokenIds,
      targetLabel: selection.targetLabel,
      targetSelection: "manual",
    }));
    await this.render({ force: true });
  }

  async _removeAreaTemplate(instanceId) {
    if (!this._canExecuteDraft() || !this._context) return;
    const current = this._findActiveStep(instanceId);
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
          globalThis.ui?.notifications?.warn?.(t("Notify.RemoveTemplateFailed", "Could not remove the placed template region."));
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
      window: { title: t("Dialog.ChooseTemplate.Title", "Choose template") },
      content: `<p>${escapeHtml(t("Dialog.ChooseTemplate.Content", "This action has more than one area template. Choose which to place:"))}</p>`,
      buttons: [...buttons, { action: "cancel", label: t("Dialog.Cancel", "Cancel") }],
      rejectClose: false,
    }).catch(() => null);
    if (choice === null || choice === undefined || choice === "cancel") return null;
    return templates[Number(choice)] ?? null;
  }

  async _chooseArea(instanceId) {
    if (!this._canExecuteDraft()) {
      globalThis.ui?.notifications?.warn?.(t("Notify.ReadOnly", "This draft is read-only."));
      return;
    }
    const step = this._findDraftStep(instanceId);
    if (!this._context || !step) {
      globalThis.ui?.notifications?.warn?.(t("Notify.NoAreaStep", "No draft step is available for area placement."));
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

    // A preceding Reach Spell (rangeBuff) step extends this spell's range; reflect it
    // in the range ring.
    const reachBonus = this._draftRangeBonus(instanceId);
    if (reachBonus > 0) placementAction = { ...placementAction, rangeBonusFeet: reachBonus };

    this._cancelDestinationPicker();
    this._areaPicker = { instanceId };
    globalThis.ui?.notifications?.info?.(t("Notify.PlaceAreaCanvas", "Place the area template on the canvas."));

    // Show the caster's spell-range ring while the template is being placed. Cleared
    // when placement resolves/cancels, and by _cancelDestinationPicker on teardown.
    showRangeOverlay(this._contextForDraftStep(instanceId), placementAction);

    const picker = chooseAreaMarker({
      context: this._contextForDraftStep(instanceId),
      action: placementAction,
      onMove: (marker) => updateRangePlacement(marker?.center),
      onCancel: () => {
        this._areaPicker = null;
        clearRangeOverlay();
      },
      onChoose: async (areaMarker) => {
        const current = this._findActiveStep(instanceId) ?? step;
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
        clearRangeOverlay();
        await this.render({ force: true });
      },
    });
    if (!picker) {
      this._areaPicker = null;
      clearRangeOverlay();
      globalThis.ui?.notifications?.warn?.(t("Notify.NoAreaPicker", "Canvas area picker is not available."));
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
    if (!planId || planId === "main" || planId === "auto") return this._selectedAutoFillPlan();
    return this._plans.find((plan) => plan?.id === planId) ?? null;
  }

  _showActionPreview(element) {
    if (this._destinationPicker || this._areaPicker) return;
    const plan = this._planForPreview(element);
    const index = Number(element.dataset.previewStep);
    const step = plan?.steps?.[index];
    const reachBonus = this._spellRangeBonus(plan?.steps, index);
    showActionPreview(
      this._planningContext ?? this._context,
      reachBonus > 0 && step ? { ...step, rangeBonusFeet: reachBonus } : step,
    );
  }

  _showDraftActionPreview(element) {
    if (this._destinationPicker || this._areaPicker) return;
    const step = this._findDraftStep(element.dataset.previewDraftStep);
    if (!step?.action) return;
    const reachBonus = this._draftRangeBonus(step.instanceId);
    const isDone = step.execution?.status === "done";
    showActionPreview(this._contextForDraftStep(step.instanceId), {
      ...step.action,
      destination: step.destination,
      movementPlan: step.movementPlan,
      areaMarker: step.areaMarker,
      ...explicitTargetFields(step, step.action),
      requiresDestination: requiresDestinationForAction(step.action),
      ...(reachBonus > 0 ? { rangeBonusFeet: reachBonus } : {}),
    }, { skipMovement: isDone });
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
      globalThis.ui?.notifications?.warn?.(t("Notify.NoSustainNeeded", "No sustained spells need sustaining."));
      return null;
    }

    let selected = entries[0];
    if (entries.length > 1) {
      const dialog = globalThis.foundry?.applications?.api?.DialogV2;
      if (typeof dialog?.wait !== "function") {
        globalThis.ui?.notifications?.warn?.(t("Notify.ChooseSustainFirst", "Choose a spell from the Sustained spells section first."));
        return null;
      }
      const choice = await dialog.wait({
        window: { title: t("Dialog.SustainSpell.Title", "Sustain a Spell") },
        content: `<p>${escapeHtml(t("Dialog.SustainSpell.Content", "Choose which sustained spell to sustain."))}</p>`,
        buttons: [
          ...entries.map((entry) => ({
            action: entry.id,
            label: escapeHtml(entry.name),
          })),
          { action: "cancel", label: t("Dialog.Cancel", "Cancel") },
        ],
        rejectClose: false,
      }).catch(() => "cancel");
      if (!choice || choice === "cancel") return null;
      selected = entries.find((entry) => entry.id === choice) ?? null;
      if (!selected) return null;
    }

    const current = this._findActiveStep(step.instanceId) ?? step;
    const nextStep = this._stepWithRetryReset(current, { sustainedSpell: sustainedSpellDraftFields(selected) });
    await this._persistActiveDraftStep(nextStep);
    return {
      ...step,
      sustainedSpell: sustainedSpellDraftFields(selected),
    };
  }

  async executeStep(index) {
    await this._openActionDetails(this._selectedAutoFillPlan()?.steps?.[index]);
  }

  async _executeDraftStep(instanceId, event) {
    // Invoked fire-and-forget from a click handler, so surface failures instead of letting them die
    // as a silent unhandled rejection (which reads as "nothing happens" when a step is clicked).
    try {
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
        globalThis.ui?.notifications?.warn?.(readiness.warning || t("Notify.ResolveChoices", "Resolve required choices before executing."));
        return;
      }

      // Drop the canvas overlay (stride path/range hover) up front so it disappears the instant the
      // step runs, instead of lingering through the awaited move animation and the re-render after it.
      clearActionPreview();
      const result = await executeDraftStep({
        context: this._contextForDraftStep(step.instanceId) ?? this._context,
        step,
        action,
        event,
      });
      await this._applyExecutionResult(step, result, event);
    } catch (error) {
      globalThis.console?.error?.("pf2e-combater | Execute step failed", error);
      globalThis.ui?.notifications?.error?.(t("Notify.ExecuteFailed", "Could not execute the step; see the console."));
    }
  }

  _handleExecutionChoice(step, choice, event, result = null) {
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
    if (choice === "retch-dc") {
      this._provideRetchDc(step, event);
      return true;
    }
    if (choice === "retch-result") {
      this._confirmRetchResult(step, event, result?.rolled ?? null);
      return true;
    }
    return false;
  }

  _retchActorName() {
    return this._context?.actor?.name ?? this._context?.combatant?.name ?? null;
  }

  // Mark/clear a draft step as blocked on a GM response and re-render so the step shows (or hides)
  // its "waiting for the GM" indicator. The flag is transient panel state, never persisted.
  async _setAwaitingGm(instanceId, on) {
    if (!instanceId) return;
    const before = this._awaitingGm.has(instanceId);
    if (on) this._awaitingGm.add(instanceId);
    else this._awaitingGm.delete(instanceId);
    if (this._awaitingGm.has(instanceId) !== before) await this.render({ force: true });
  }

  // Phase 1: the GM supplies the effect's save DC. Re-running with the DC rolls the save (phase 2)
  // and comes back as a "retch-result" choice for the GM to rule on. Wrapped so a dialog/socket
  // failure surfaces instead of dying as a silent unhandled rejection (this runs fire-and-forget).
  async _provideRetchDc(step, event) {
    try {
      const actorName = this._retchActorName();
      let dc;
      if (game?.user?.isGM === true) {
        dc = await promptRetchDc({ actorName });
      } else {
        globalThis.ui?.notifications?.info?.(t("Notify.WaitingRetchDcGM", "Waiting for the GM to set the Retch save DC."));
        await this._setAwaitingGm(step.instanceId, true);
        try {
          dc = await requestRetchDc({ actorName });
        } finally {
          await this._setAwaitingGm(step.instanceId, false);
        }
        if (dc == null) dc = await promptRetchDc({ actorName });
      }
      if (!Number.isFinite(dc)) return; // dismissed
      const result = await executeDraftStep({
        context: this._contextForDraftStep(step.instanceId) ?? this._context,
        step,
        action: step.action ?? step,
        event,
        choices: { dc },
      });
      await this._applyExecutionResult(step, result, event);
    } catch (error) {
      globalThis.console?.error?.("pf2e-combater | Retch DC step failed", error);
      globalThis.ui?.notifications?.error?.(t("Notify.RetchFailed", "Retch could not be resolved; see the console."));
    }
  }

  // Phase 3: the player has rolled the save; the GM sets the result accordingly.
  async _confirmRetchResult(step, event, rolled) {
    try {
      const actorName = this._retchActorName();
      let decision;
      if (game?.user?.isGM === true) {
        decision = await promptRetchResult({ actorName, rolled });
      } else {
        globalThis.ui?.notifications?.info?.(t("Notify.WaitingRetchGM", "Waiting for the GM to judge your Retch save."));
        await this._setAwaitingGm(step.instanceId, true);
        try {
          decision = await requestRetchResult({ actorName, rolled });
        } finally {
          await this._setAwaitingGm(step.instanceId, false);
        }
        if (decision === null) decision = await promptRetchResult({ actorName, rolled });
      }
      if (!decision) return; // dismissed
      const result = await executeDraftStep({
        context: this._contextForDraftStep(step.instanceId) ?? this._context,
        step,
        action: step.action ?? step,
        event,
        choices: { retchSucceeded: decision.succeeded === true, retchCritical: decision.critical === true },
      });
      await this._applyExecutionResult(step, result, event);
    } catch (error) {
      globalThis.console?.error?.("pf2e-combater | Retch result step failed", error);
      globalThis.ui?.notifications?.error?.(t("Notify.RetchFailed", "Retch could not be resolved; see the console."));
    }
  }

  async _applyExecutionResult(step, result, event) {
    if (result?.status === "needs-choice") {
      this._handleExecutionChoice(step, result.choices?.[0], event, result);
      return;
    }
    if (!result || result.status === "cancelled") return;
    if (!this._context || !step?.instanceId) return;

    const current = this._findActiveStep(step.instanceId) ?? step;
    await this._persistActiveDraftStep({ ...current, ...(result.patch ?? {}) });
    clearActionPreview();
    if (result.status === "failed" && result.error) globalThis.ui?.notifications?.warn?.(result.error);
    await this.render({ force: true });
  }

  async _revertDraftStep(instanceId) {
    if (!this._canExecuteDraft() || !this._context) return;
    const current = this._findActiveStep(instanceId);
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
