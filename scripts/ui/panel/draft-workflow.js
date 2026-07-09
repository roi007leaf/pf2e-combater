import { MODULE_ID } from "../../constants.js";
import { SETTINGS, settingOrDefault } from "../../settings.js";
import {
  actionBuilderKey,
  builderAtomicActionsForStep,
  computeAreaMarker,
  isUnreachableStrikeStep,
  projectContextForDraftDestination,
} from "../../engine/action/builder.js";
import { requiresDestinationForAction } from "../../engine/action/requirements.js";
import { currentTargetSelection, executeDraftStep, plannedTargetSelection, setTokenTargets } from "../../engine/action/executor.js";
import { revertDraftStep } from "../../engine/action/revert.js";
import { executionPatch } from "../../engine/execution/results.js";
import { buildCandidates } from "../../engine/candidates.js";
import { bestTurnPlan, buildTurnPlans } from "../../engine/planner.js";
import { swapDraftSteps } from "../../engine/draft-reorder.js";
import { reorderActionFavorite, toggleActionFavorite } from "../../state/action-favorites.js";
import { readCombatContext } from "../../state/combat-context.js";
import {
  readDraftPlan,
  readSharedDraftPlan,
  sharedDraftPlanKey,
  writeDraftPlan,
  writeSharedDraftPlan,
  upsertDraftStep,
  draftListForInstance,
  writeSharedDraftPlanActorFlag,
} from "../../state/draft-plans.js";
import { actorStrikeOptions, bestReadyStrike } from "../../readers/action/reader.js";
import { actorMovementOptions, readActorSpeed } from "../../readers/actor-profile.js";
import { shareDraftPlan } from "../../socket.js";
import { clearActionPreview, showActionPreview } from "../action/preview.js";
import { showHoverGhost, showMovementPreview, recommendedMovementForStep } from "../movement-preview.js";
import { chooseDestination } from "../destination-picker.js";
import { bestAutoFillPlan, nextAutoFillPlan, previousAutoFillPlan, selectDisplayPlan } from "../plan-selection.js";
import { contextWithCurrentAutoFillTargets } from "./auto-fill-context.js";
import { cancelPanelPickers } from "./picker-workflow.js";
import {
  autoFillAppliesProne,
  autoFillStrideOverSpeed,
  autoFillTargetCenter,
  draftForAutoFillGap,
  draftStepId,
  findProjectedDraftAction,
  hasLockedDraftSteps,
  isBasicAutoFillMove,
  isRedundantAutoFillMove,
  strideImprovesPosition,
  strideStepTowardPlannedTarget,
} from "./draft-helpers.js";
import {
  executionStatus,
  markManualDraft,
  stepMovementAction,
  sustainedSpellDraftFields,
} from "./view-model.js";
import { t } from "../../i18n.js";

// Reads/writes route to the shared draft when the GM is executing a player plan, otherwise to the
// local per-user draft.
export function readPanelActiveDraftPlan(panel) {
  return panel._gmExecuteMode === true
    ? readSharedDraftPlan(panel._context)
    : readDraftPlan(panel._context);
}

export async function persistPanelActiveDraftStep(panel, step, listKey) {
  const targetList = listKey ?? draftListForInstance(panel._readActiveDraftPlan(), step.instanceId);
  if (panel._gmExecuteMode === true) {
    const draft = readSharedDraftPlan(panel._context);
    const list = [...(draft[targetList] ?? [])];
    const index = list.findIndex((entry) => entry.instanceId === step.instanceId);
    if (index >= 0) list[index] = step;
    else list.push(step);
    await panel._writeActiveSharedDraft({ ...draft, [targetList]: list });
    return;
  }
  upsertDraftStep(panel._context, step, targetList);
  await panel._syncDraftToGM();
}

export async function writePanelActiveDraftPlan(panel, draft) {
  if (panel._gmExecuteMode === true) {
    await panel._writeActiveSharedDraft(draft);
    return;
  }
  writeDraftPlan(panel._context, draft);
  await panel._syncDraftToGM();
}

// Preserve the player's ownership fields; only the steps / execution state changes.
export async function writePanelActiveSharedDraft(panel, draft) {
  writeSharedDraftPlan(panel._context, draft);
  await writeSharedDraftPlanActorFlag(panel._context, draft);
}

function minionPlanDraftFields(action) {
  return action?.activityProfile?.minionPlan
    ? { activityProfile: { minionPlan: action.activityProfile.minionPlan } }
    : {};
}

function isMinionBrowseAction(action) {
  return action?.source === "minion-action" || action?.activityProfile?.minionBrowseAction === true;
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

function fallbackMinionActionOptions() {
  return [
    t("MinionPlan.Stride", "Stride"),
    t("MinionPlan.Seek", "Seek"),
    t("MinionPlan.Stand", "Stand"),
    t("MinionPlan.Leap", "Leap"),
    t("MinionPlan.DropProne", "Drop Prone"),
  ];
}

export function minionPlanActionOptions(plan) {
  return uniqueMinionStepNames([
    ...(Array.isArray(plan?.actionOptions) ? plan.actionOptions : []),
    ...(Array.isArray(plan?.steps) ? plan.steps : []),
    ...fallbackMinionActionOptions(),
  ]);
}

function minionPlanLabel(plan, steps) {
  const minion = String(plan?.minionName ?? t("MinionPlan.Minion", "Companion")).trim()
    || t("MinionPlan.Minion", "Companion");
  const stepText = steps.join(" -> ");
  const target = String(plan?.targetName ?? "").trim();
  return target
    ? t("MinionPlan.Label", "{minion}: {steps} vs {target}", { minion, steps: stepText, target })
    : t("MinionPlan.LabelNoTarget", "{minion}: {steps}", { minion, steps: stepText });
}

function minionBrowseActionName(action) {
  return String(action?.minionActionName ?? action?.activityProfile?.minionActionName ?? "").trim();
}

function minionBrowseActionBudget(action, plan = action?.activityProfile?.minionPlan) {
  const value = Number(plan?.actionBudget ?? action?.minionActionBudget ?? action?.activityProfile?.minionActionBudget ?? 2);
  return Math.max(1, Math.min(3, Number.isFinite(value) ? Math.round(value) : 2));
}

function sameMinionPlan(left, right) {
  const leftId = String(left?.minionId ?? "");
  const rightId = String(right?.minionId ?? "");
  if (leftId && rightId) return leftId === rightId;
  const leftName = String(left?.minionName ?? "").trim().toLowerCase();
  const rightName = String(right?.minionName ?? "").trim().toLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
}

function findMinionCommandDraftStep(draft, action) {
  const plan = action?.activityProfile?.minionPlan;
  if (!plan) return null;
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepPlan = minionPlanFromStep(step);
    if (sameMinionPlan(stepPlan, plan)) return { index, step, plan: stepPlan };
  }
  return null;
}

function minionPlanWithAddedAction(plan, actionName, actionBudget) {
  const steps = [
    ...(Array.isArray(plan?.steps) ? plan.steps.map((step) => minionStepName(step)).filter(Boolean) : []),
    actionName,
  ];
  const existingStates = Array.isArray(plan?.stepStates) ? plan.stepStates : [];
  const stepStates = steps.map((_step, index) => existingStates[index] ?? {});
  const next = {
    ...(plan ?? {}),
    actionBudget,
    steps,
    stepStates,
    actionOptions: minionPlanActionOptions({ ...(plan ?? {}), steps }),
  };
  return {
    ...next,
    label: minionPlanLabel(next, steps),
  };
}

function commandActionForMinionBrowse(action) {
  const command = action?.minionCommandAction ?? action;
  return {
    ...command,
    key: action?.minionCommandKey ?? command?.key ?? actionBuilderKey(command),
    baseKey: action?.minionCommandKey ?? command?.baseKey ?? actionBuilderKey(command),
    name: command?.name ?? t("MinionPlan.CommandAction", "Command Companion"),
    slug: "command-an-animal",
    source: command?.source === "minion-action" ? "generic" : command?.source,
    actionCost: command?.actionCost ?? 1,
    cost: command?.cost ?? 1,
  };
}

async function addPanelMinionBrowseAction(panel, action) {
  const actionName = minionBrowseActionName(action);
  const plan = action?.activityProfile?.minionPlan;
  if (!actionName || !plan) return;
  const draft = panel._readActiveDraftPlan();
  const existing = findMinionCommandDraftStep(draft, action);
  if (existing) {
    const actionBudget = minionBrowseActionBudget(action, existing.plan);
    if ((existing.plan?.steps?.length ?? 0) >= actionBudget) {
      globalThis.ui?.notifications?.warn?.(t("MinionPlan.NoActionsLeft", "Companion has no actions left."));
      return;
    }
    const nextSteps = [...(draft.steps ?? [])];
    nextSteps[existing.index] = stepWithMinionPlan(
      existing.step,
      minionPlanWithAddedAction(existing.plan, actionName, actionBudget),
    );
    await panel._writeActiveDraftPlan(markManualDraft({ ...draft, steps: nextSteps }));
    clearActionPreview();
    await panel.render({ force: true });
    return;
  }

  if (action.overBudget) {
    globalThis.ui?.notifications?.warn?.(action.disabledReason || t("Notify.NotEnoughActions", "Not enough actions remaining."));
    return;
  }

  const commandAction = commandActionForMinionBrowse(action);
  const actionBudget = minionBrowseActionBudget(action, plan);
  const minionPlan = minionPlanWithAddedAction({ ...plan, steps: [] }, actionName, actionBudget);
  await panel._writeActiveDraftPlan(markManualDraft({
    ...draft,
    steps: [
      ...(draft.steps ?? []),
      {
        instanceId: draftStepId(),
        actionKey: commandAction.key,
        name: commandAction.name,
        actionCost: commandAction.actionCost ?? commandAction.cost ?? 1,
        requiresDestination: false,
        activityProfile: { minionPlan },
      },
    ],
  }));
  clearActionPreview();
  await panel.render({ force: true });
}

export function cycleMinionPlanStep(plan, stepIndex, direction = 1) {
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) return plan;
  const index = Number(stepIndex);
  if (!Number.isInteger(index) || index < 0 || index >= plan.steps.length) return plan;
  const options = minionPlanActionOptions(plan);
  if (options.length <= 1) return plan;
  const steps = plan.steps.map((step) => minionStepName(step));
  const current = minionStepKey(plan.steps[index], steps[index]);
  const currentIndex = Math.max(0, options.findIndex((option) => minionStepKey(option, option) === current));
  const offset = direction < 0 ? -1 : 1;
  const nextIndex = (currentIndex + offset + options.length) % options.length;
  const nextSteps = [...steps];
  nextSteps[index] = options[nextIndex];
  const stepStates = [...minionPlanStepStates(plan)];
  stepStates[index] = {};
  return {
    ...plan,
    steps: nextSteps,
    stepStates,
    label: minionPlanLabel(plan, nextSteps),
  };
}

function stepWithMinionPlan(step, minionPlan) {
  const activityProfile = { ...(step?.activityProfile ?? {}), minionPlan };
  return {
    ...step,
    activityProfile,
    action: step?.action
      ? {
        ...step.action,
        activityProfile: { ...(step.action.activityProfile ?? {}), minionPlan },
      }
      : step?.action,
  };
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function minionPlanFromStep(step) {
  return step?.activityProfile?.minionPlan ?? step?.action?.activityProfile?.minionPlan ?? null;
}

function targetNameFromLabel(label) {
  return String(label ?? "").replace(/^Target:\s*/i, "").trim();
}

function minionPlanWithTarget(plan, selection) {
  const targetTokenIds = Array.from(new Set(selection.targetTokenIds ?? [])).filter(Boolean);
  const targetName = targetNameFromLabel(selection.targetLabel);
  const next = {
    ...plan,
    targetId: targetTokenIds[0] ?? null,
    targetTokenIds,
    targetName,
  };
  return {
    ...next,
    label: minionPlanLabel(next, next.steps ?? []),
  };
}

function minionPlanStepStates(plan) {
  return Array.isArray(plan?.stepStates) ? plan.stepStates : [];
}

function minionPlanStepState(plan, index) {
  return minionPlanStepStates(plan)[index] ?? {};
}

function minionPlanWithStepState(plan, index, patch) {
  if (!plan || !Number.isInteger(index) || index < 0) return plan;
  const stepStates = [...minionPlanStepStates(plan)];
  stepStates[index] = { ...(stepStates[index] ?? {}), ...(patch ?? {}) };
  return { ...plan, stepStates };
}

function minionStepInstanceId(plan, index) {
  return `${plan?.minionId ?? "minion"}-${index}`;
}

async function persistMinionPlanStepState(panel, step, plan, index, patch) {
  const nextPlan = minionPlanWithStepState(plan, index, patch);
  await panel._persistActiveDraftStep(stepWithMinionPlan(step, nextPlan));
  return nextPlan;
}

export async function choosePanelMinionTarget(panel, instanceId) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  if (!step || !minionPlan) return;
  const selection = currentTargetSelection();
  if (!selection.targetTokenIds.length) {
    globalThis.ui?.notifications?.warn?.(t("Notify.TargetFirst", "Target a token in Foundry first."));
    return;
  }
  await panel._persistActiveDraftStep(stepWithMinionPlan(step, minionPlanWithTarget(minionPlan, selection)));
  await panel._syncDraftToGM();
  await panel.render({ force: true });
}

function canvasTokens() {
  return Array.from(globalThis.canvas?.tokens?.placeables ?? []).filter(Boolean);
}

function tokenDocument(token) {
  return token?.document ?? token;
}

function tokenIdMatches(token, id) {
  const document = tokenDocument(token);
  const wanted = String(id ?? "");
  return Boolean(wanted) && [token?.id, token?.uuid, document?.id, document?.uuid].some((value) => String(value ?? "") === wanted);
}

function tokenForId(id) {
  return canvasTokens().find((token) => tokenIdMatches(token, id)) ?? null;
}

function minionTokenForPlan(plan) {
  return tokenForId(plan?.minionId);
}

function targetTokenForPlan(plan) {
  const ids = [
    ...(Array.isArray(plan?.targetTokenIds) ? plan.targetTokenIds : []),
    plan?.targetId,
  ].filter(Boolean);
  for (const id of ids) {
    const token = tokenForId(id);
    if (token) return token;
  }
  return null;
}

function actorSpeed(actor) {
  return readActorSpeed(actor);
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

function minionMovementOptions(plan, actor) {
  const planned = normalizeMovementOptions(plan?.movementOptions);
  const live = normalizeMovementOptions(actorMovementOptions(actor));
  return mergeMovementOptions(planned, live);
}

function movementSpeed(options, action) {
  const speed = Number(options.find((option) => option.action === action)?.speed);
  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

function minionStepMovementAction(plan, index, actor) {
  const options = minionMovementOptions(plan, actor);
  const state = minionPlanStepState(plan, index);
  const requested = String(state?.movementAction ?? "").trim().toLowerCase();
  if (requested && options.some((option) => option.action === requested)) return requested;
  return options.find((option) => option.action === "walk")?.action ?? options[0]?.action ?? "walk";
}

function minionMovementFeet(actionName, actor, movementAction = "walk", movementOptions = []) {
  const action = String(actionName ?? "").trim().toLowerCase();
  if (action === "step") return 5;
  if (action === "leap") return 10;
  if (action === "stride") return movementSpeed(movementOptions, movementAction) ?? actorSpeed(actor);
  return 0;
}

function minionMovementAction(stepName, actor, movementAction = null, movementOptions = null) {
  const action = String(stepName ?? "").trim();
  const slug = action.toLowerCase();
  const options = minionMovementOptions({ movementOptions }, actor);
  const selectedMovement = slug === "stride"
    ? (options.some((option) => option.action === movementAction) ? movementAction : options[0]?.action ?? "walk")
    : null;
  const movementDistance = minionMovementFeet(action, actor, selectedMovement ?? "walk", options);
  if (movementDistance <= 0) return null;
  return {
    id: `minion-${slug}`,
    name: action,
    slug,
    source: "movement",
    role: "movement",
    actionCost: 1,
    requiresDestination: true,
    movementDistance,
    ...(selectedMovement ? { movementAction: selectedMovement } : {}),
    activityProfile: { includes: [slug], minionSubAction: true },
  };
}

function minionExecutionContext(panel, plan, token, actor) {
  return {
    ...(panel._context ?? {}),
    actor,
    token: { ...(tokenDocument(token) ?? {}), id: tokenDocument(token)?.id ?? token?.id },
    combat: false,
    combatant: null,
  };
}

export function minionPlanStepPreview(panel, instanceId, stepIndex) {
  const index = Number(stepIndex);
  const ownerStep = panel?._findActiveStep?.(instanceId) ?? panel?._findDraftStep?.(instanceId);
  const minionPlan = minionPlanFromStep(ownerStep);
  const stepName = Array.isArray(minionPlan?.steps) && Number.isInteger(index) ? minionPlan.steps[index] : null;
  const minion = minionTokenForPlan(minionPlan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  const movementOptions = minionMovementOptions(minionPlan, actor);
  const movementAction = minionStepMovementAction(minionPlan, index, actor);
  const action = minionMovementAction(stepName, actor, movementAction, movementOptions);
  if (!ownerStep || !minionPlan || !stepName || !minion || !actor || !action) return null;

  const state = minionPlanStepState(minionPlan, index);
  const previewStep = {
    ...action,
    destination: state.destination,
    movementPlan: state.movementPlan,
    ...(Number.isFinite(Number(state.elevation)) ? { plannedElevation: Number(state.elevation) } : {}),
    requiresDestination: true,
  };
  return {
    context: minionExecutionContext(panel, minionPlan, minion, actor),
    step: previewStep,
    skipMovement: state.execution?.status === "done",
  };
}

export function showPanelMinionActionPreview(panel, instanceId, stepIndex) {
  if (panel?._destinationPicker || panel?._areaPicker) return null;
  const preview = minionPlanStepPreview(panel, instanceId, stepIndex);
  if (!preview) return null;
  return showActionPreview(preview.context, preview.step, { skipMovement: preview.skipMovement });
}

function normalizedMinionActionName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isFamiliarAttackRollAction(stepName) {
  const name = normalizedMinionActionName(stepName);
  return name === normalizedMinionActionName(t("MinionPlan.AttackRoll", "Attack Roll"))
    || name === "familiar attack roll";
}

function isRelevantRollEvent(event) {
  return !!event && typeof event === "object"
    && "ctrlKey" in event && "metaKey" in event && "shiftKey" in event;
}

function familiarAttackRollParams(event) {
  const skipDefault = !globalThis.game?.user?.settings?.showCheckDialogs;
  if (!isRelevantRollEvent(event)) return { skipDialog: skipDefault };
  const params = { skipDialog: event.shiftKey ? !skipDefault : skipDefault };
  if (event.ctrlKey || event.metaKey) params.messageMode = globalThis.game?.user?.isGM ? "gm" : "blind";
  return params;
}

async function callRoller(owner, fn, params) {
  if (typeof fn !== "function") return false;
  await fn.call(owner, params);
  return true;
}

async function rollFamiliarAttack(actor, event = null) {
  if (String(actor?.type ?? "").toLowerCase() !== "familiar") return false;
  const params = familiarAttackRollParams(event);
  const statistic = actor?.attackStatistic ?? actor?.system?.attackStatistic ?? actor?.system?.attack ?? null;
  return await callRoller(statistic, statistic?.roll, params)
    || await callRoller(statistic?.check, statistic?.check?.roll, params)
    || await callRoller(actor, actor?.rollAttack, params);
}

async function executeMinionMovement(panel, plan, stepName, stepIndex, event = null) {
  const minion = minionTokenForPlan(plan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  if (!minion || !actor) return false;
  const state = minionPlanStepState(plan, Number(stepIndex));
  const movementOptions = minionMovementOptions(plan, actor);
  const movementAction = minionStepMovementAction(plan, Number(stepIndex), actor);
  const action = minionMovementAction(stepName, actor, movementAction, movementOptions);
  if (!action) return false;
  const result = await executeDraftStep({
    context: minionExecutionContext(panel, plan, minion, actor),
    step: {
      ...state,
      instanceId: minionStepInstanceId(plan, Number(stepIndex)),
      action,
      actionCost: 1,
      requiresDestination: true,
    },
    action,
    event,
  });
  return { handled: true, result };
}

async function executeMinionStrike(panel, plan, stepName, event = null) {
  const minion = minionTokenForPlan(plan);
  const target = targetTokenForPlan(plan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  if (!minion || !target || !actor) return false;
  const context = minionExecutionContext(panel, plan, minion, actor);
  const strike = actorStrikeOptions(actor, {
    ...context,
    actor,
    token: minion,
  }).find((option) => String(option?.name ?? "").trim().toLowerCase() === String(stepName ?? "").trim().toLowerCase());
  const targetId = tokenDocument(target)?.id ?? target?.id;
  if (!strike) {
    if (!isFamiliarAttackRollAction(stepName)) return false;
    setTokenTargets([target]);
    const rolled = await rollFamiliarAttack(actor, event);
    return rolled
      ? { handled: true, result: { status: "done", patch: executionPatch({}, "done") } }
      : false;
  }
  const result = await executeDraftStep({
    context,
    step: {
      targetTokenIds: [targetId].filter(Boolean),
      targetLabel: target?.name ? t("Label.Target", "Target: {name}", { name: target.name }) : "",
      targetSelection: "manual",
    },
    action: strike,
    event,
  });
  return { handled: true, result };
}

async function applyMinionPlanStepResult(panel, step, plan, stepIndex, execution, event = null) {
  if (!execution?.handled) return false;
  const result = execution.result;
  if (result?.status === "needs-choice") {
    if (result.choices?.includes("destination")) {
      choosePanelMinionDestination(panel, step.instanceId, stepIndex);
      return true;
    }
    if (result.choices?.includes("target")) {
      await choosePanelMinionTarget(panel, step.instanceId);
      return true;
    }
  }
  if (!result || result.status === "cancelled") return true;
  await persistMinionPlanStepState(panel, step, plan, stepIndex, result.patch ?? {});
  clearActionPreview();
  if (result.status === "failed" && result.error) globalThis.ui?.notifications?.warn?.(result.error);
  await panel.render({ force: true });
  return true;
}

export async function executePanelMinionPlanStep(panel, instanceId, stepIndex, event = null) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  const index = Number(stepIndex);
  const stepName = Array.isArray(minionPlan?.steps) && Number.isInteger(index) ? minionPlan.steps[index] : null;
  if (!step || !minionPlan || !stepName) return;
  if (minionPlanStepState(minionPlan, index)?.execution?.status === "done") return;
  const moved = await executeMinionMovement(panel, minionPlan, stepName, index, event);
  if (await applyMinionPlanStepResult(panel, step, minionPlan, index, moved, event)) return;
  const struck = await executeMinionStrike(panel, minionPlan, stepName, event);
  if (await applyMinionPlanStepResult(panel, step, minionPlan, index, struck, event)) return;
  globalThis.ui?.notifications?.warn?.(t("MinionPlan.UnsupportedExecute", "This minion action still needs manual handling."));
}

export function choosePanelMinionDestination(panel, instanceId, stepIndex) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const index = Number(stepIndex);
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  const stepName = Array.isArray(minionPlan?.steps) && Number.isInteger(index) ? minionPlan.steps[index] : null;
  const minion = minionTokenForPlan(minionPlan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  const movementOptions = minionMovementOptions(minionPlan, actor);
  const movementAction = minionStepMovementAction(minionPlan, index, actor);
  const action = minionMovementAction(stepName, actor, movementAction, movementOptions);
  if (!step || !minionPlan || !action || !minion || !actor) return;
  const pickerId = `${instanceId}:minion:${index}`;
  if (panel._destinationPicker?.instanceId === pickerId) {
    cancelPanelPickers(panel);
    clearActionPreview();
    return;
  }
  cancelPanelPickers(panel);
  const context = minionExecutionContext(panel, minionPlan, minion, actor);
  const previewStep = (preview = {}) => ({
    ...action,
    ...(preview.destination ? { destination: preview.destination } : {}),
    ...(preview.movementPlan ? { movementPlan: preview.movementPlan } : {}),
    ...(Number.isFinite(preview.elevation) ? { plannedElevation: preview.elevation } : {}),
    requiresDestination: true,
  });
  panel._destinationPicker = { instanceId: pickerId, native: false, minion: true, context, action };
  const picker = chooseDestination({
    context,
    action,
    enableWaypoints: true,
    onPreview: (destination, metadata = {}) => {
      if (metadata.hoverOnly) {
        showHoverGhost(context, {
          ...action,
          ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}),
          requiresDestination: true,
        }, destination);
        return;
      }
      const preview = {
        destination,
        movementPlan: metadata.movementPlan ?? null,
        elevation: metadata.elevation,
      };
      panel._destinationPicker = {
        ...(panel._destinationPicker ?? {}),
        instanceId: pickerId,
        native: false,
        minion: true,
        context,
        action,
        preview,
      };
      showMovementPreview(context, previewStep(preview));
    },
    onCancel: () => {
      panel._destinationPicker = null;
      clearActionPreview();
    },
    onChoose: async (destination, metadata = {}) => {
      const current = panel._findActiveStep(instanceId) ?? step;
      const currentPlan = minionPlanFromStep(current) ?? minionPlan;
      const state = minionPlanStepState(currentPlan, index);
      await persistMinionPlanStepState(panel, current, currentPlan, index, {
        ...state,
        destination,
        ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}),
        execution: state.execution?.status === "failed" ? { status: "pending" } : state.execution,
      });
      panel._destinationPicker = null;
      clearActionPreview();
      await panel.render({ force: true });
    },
  });
  if (!picker) {
    panel._destinationPicker = null;
    clearActionPreview();
    globalThis.ui?.notifications?.warn?.(t("Notify.NoDestinationPicker", "Canvas destination picker is not available."));
    return;
  }
  panel._destinationPicker = { instanceId: pickerId, native: picker.native === true, minion: true, context, action };
  if (!picker.native) showMovementPreview(context, previewStep());
}

export async function cyclePanelMinionPlanMovement(panel, instanceId, stepIndex) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const index = Number(stepIndex);
  if (!Number.isInteger(index) || index < 0) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  const minion = minionTokenForPlan(minionPlan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  if (!step || !minionPlan || !actor) return;
  const movementOptions = minionMovementOptions(minionPlan, actor);
  if (movementOptions.length <= 1) return;
  const state = minionPlanStepState(minionPlan, index);
  const current = minionStepMovementAction(minionPlan, index, actor);
  const currentIndex = Math.max(0, movementOptions.findIndex((option) => option.action === current));
  const nextMovement = movementOptions[(currentIndex + 1) % movementOptions.length]?.action ?? "walk";
  await persistMinionPlanStepState(panel, step, minionPlan, index, {
    ...state,
    movementAction: nextMovement,
    destination: null,
    movementPlan: null,
    execution: state.execution?.status === "failed" ? { status: "pending" } : state.execution,
  });
  await panel._syncDraftToGM();
  clearActionPreview();
  await panel.render({ force: true });
}

export async function revertPanelMinionPlanStep(panel, instanceId, stepIndex) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const index = Number(stepIndex);
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  const state = minionPlanStepState(minionPlan, index);
  if (!step || !minionPlan || state?.execution?.status !== "done") return;
  const minion = minionTokenForPlan(minionPlan);
  const actor = minion?.actor ?? tokenDocument(minion)?.actor;
  const result = await revertDraftStep({
    context: minionExecutionContext(panel, minionPlan, minion, actor),
    step: {
      ...state,
      instanceId: minionStepInstanceId(minionPlan, index),
    },
  });
  await persistMinionPlanStepState(panel, step, minionPlan, index, result.patch ?? { execution: { status: "pending" } });
  clearActionPreview();
  for (const warning of result.warnings ?? []) globalThis.ui?.notifications?.warn?.(warning);
  await panel.render({ force: true });
}

export async function removePanelMinionPlanStep(panel, instanceId, stepIndex) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !instanceId) return;
  const index = Number(stepIndex);
  if (!Number.isInteger(index) || index < 0) return;

  const draft = panel._readActiveDraftPlan();
  const listKey = draftListForInstance(draft, instanceId);
  const list = Array.isArray(draft?.[listKey]) ? [...draft[listKey]] : [];
  const ownerIndex = list.findIndex((entry) => entry.instanceId === instanceId);
  const step = list[ownerIndex];
  const minionPlan = minionPlanFromStep(step);
  if (ownerIndex < 0 || !minionPlan || !Array.isArray(minionPlan.steps) || index >= minionPlan.steps.length) return;
  if (minionPlanStepState(minionPlan, index)?.execution?.status === "done") return;

  const nextSteps = minionPlan.steps.filter((_entry, entryIndex) => entryIndex !== index);
  if (!nextSteps.length) {
    list.splice(ownerIndex, 1);
    await panel._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: list }));
    clearActionPreview();
    await panel.render({ force: true });
    return;
  }

  const nextStates = minionPlanStepStates(minionPlan).filter((_entry, entryIndex) => entryIndex !== index);
  const nextPlan = {
    ...minionPlan,
    steps: nextSteps,
    stepStates: nextStates,
    label: minionPlanLabel(minionPlan, nextSteps),
  };
  list[ownerIndex] = stepWithMinionPlan(step, nextPlan);
  await panel._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: list }));
  clearActionPreview();
  await panel.render({ force: true });
}

export async function cyclePanelMinionPlanStep(panel, instanceId, stepIndex, direction = 1) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  const minionPlan = minionPlanFromStep(step);
  const nextPlan = cycleMinionPlanStep(minionPlan, stepIndex, direction);
  if (!step || !minionPlan || nextPlan === minionPlan) return;
  await panel._persistActiveDraftStep(stepWithMinionPlan(step, nextPlan));
  await panel._syncDraftToGM();
  await panel.render({ force: true });
}

export async function addPanelAction(panel, actionKey) {
  if (!panel._canEditDraft()) return;
  const action = panel._findBuilderAction(actionKey);
  if (!panel._context || !action) return;

  if (isMinionBrowseAction(action)) {
    await addPanelMinionBrowseAction(panel, action);
    return;
  }

  // The normal plan respects the turn's action economy; only uncounted actions
  // run off-budget. Refuse a plan add that would exceed the budget.
  if (action.overBudget) {
    globalThis.ui?.notifications?.warn?.(action.disabledReason || t("Notify.NotEnoughActions", "Not enough actions remaining."));
    return;
  }

  const draft = panel._readActiveDraftPlan();
  // A composite (e.g. Rush, Sudden Charge) atomizes into its Stride/Strike parts, mirroring
  // Auto-fill (_autoFillDraft) -- a raw single-step push would leave the whole ability un-split
  // and unexecutable. A plain action passes straight through unchanged (same array, same
  // reference), so action.key is kept for that common case instead of re-deriving it.
  const atoms = builderAtomicActionsForStep(action);
  const newSteps = atoms.length === 1 && atoms[0] === action
    ? [action]
    : atoms;
  await panel._writeActiveDraftPlan(markManualDraft({
    ...draft,
    steps: [
      ...(draft.steps ?? []),
      ...newSteps.map((atom) => {
        // A self-centered area (e.g. an emanation) needs no manual placement -- it's always
        // centered on the caster, so pre-fill it here the same way Auto-fill already does,
        // instead of forcing a "Place template" prompt for something with only one possible
        // location.
        const presetAreaMarker = !atom?.areaMarker ? computeAreaMarker(panel._context, atom) : null;
        return {
          instanceId: draftStepId(),
          actionKey: atom === action ? action.key : panel._actionKeyForStep(atom),
          // Persist a display name so the step still reads correctly if its action stops being
          // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
          name: atom?.name ?? atom?.action?.name,
          actionCost: atom?.actionCost ?? atom?.cost,
          requiresDestination: requiresDestinationForAction(atom),
          ...(atom?.groupId
            ? { groupId: atom.groupId, groupLabel: atom.groupLabel, ...(Number.isFinite(atom?.atomIndex) ? { atomIndex: atom.atomIndex } : {}) }
            : atom?.activityProfile?.requiresDistinctTargets
              ? { groupId: atom.id, groupLabel: String(atom?.name ?? "").split(" -> ")[0] }
              : {}),
          ...minionPlanDraftFields(atom),
          ...(presetAreaMarker ? { areaMarker: presetAreaMarker } : {}),
        };
      }),
    ],
  }));
  clearActionPreview();
  await panel.render({ force: true });
}

// Uncounted adds run alongside the plan but off-budget. Allowed for the plan owner and
// for a GM running an AFK player's shared plan (hence _canExecuteDraft, not _canEditDraft).
export async function addPanelUncountedAction(panel, actionKey) {
  if (!panel._canExecuteDraft()) return;
  const action = panel._findBuilderAction(actionKey);
  if (!panel._context || !action) return;
  const draft = panel._readActiveDraftPlan();
  // A composite (e.g. Stand -> Stride, Rush, Sudden Charge) atomizes into its separate parts,
  // mirroring _addAction -- a raw single-step push left the whole bundled ability as one
  // multi-action uncounted entry, asking for a target/destination the parts don't individually need.
  const atoms = builderAtomicActionsForStep(action);
  const newAtoms = atoms.length === 1 && atoms[0] === action ? [action] : atoms;
  await panel._writeActiveDraftPlan(markManualDraft({
    ...draft,
    uncounted: [
      ...(draft.uncounted ?? []),
      ...newAtoms.map((atom) => {
        // See _addAction: a self-centered area needs no manual placement, pre-fill it the same way.
        const presetAreaMarker = !atom?.areaMarker ? computeAreaMarker(panel._context, atom) : null;
        return {
          instanceId: draftStepId(),
          actionKey: atom === action ? action.key : panel._actionKeyForStep(atom),
          // Persist a display name so the step still reads correctly if its action stops being
          // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
          name: atom?.name ?? atom?.action?.name,
          actionCost: atom?.actionCost ?? atom?.cost,
          requiresDestination: requiresDestinationForAction(atom),
          ...(atom?.groupId
            ? { groupId: atom.groupId, groupLabel: atom.groupLabel, ...(Number.isFinite(atom?.atomIndex) ? { atomIndex: atom.atomIndex } : {}) }
            : atom?.activityProfile?.requiresDistinctTargets
              ? { groupId: atom.id, groupLabel: String(atom?.name ?? "").split(" -> ")[0] }
              : {}),
          ...minionPlanDraftFields(atom),
          ...(presetAreaMarker ? { areaMarker: presetAreaMarker } : {}),
        };
      }),
    ],
  }));
  clearActionPreview();
  await panel.render({ force: true });
}

export async function addPanelSustainSpell(panel, spellId) {
  if (!panel._canEditDraft()) return;
  const spell = panel._findSustainedSpell(spellId);
  const action = panel._findSustainAction();
  if (!panel._context || !spell || !action || action.disabled) {
    globalThis.ui?.notifications?.warn?.(action?.disabledReason ?? t("Notify.SustainUnavailable", "Sustain a Spell is not available."));
    return;
  }

  const draft = panel._readActiveDraftPlan();
  await panel._writeActiveDraftPlan(markManualDraft({
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
  await panel.render({ force: true });
}

export async function removePanelDraftStep(panel, instanceId) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !instanceId) return;
  const draft = panel._readActiveDraftPlan();
  const listKey = draftListForInstance(draft, instanceId);
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  await panel._writeActiveDraftPlan(markManualDraft({
    ...draft,
    [listKey]: list.filter((step) => step.instanceId !== instanceId),
  }));
  clearActionPreview();
  await panel.render({ force: true });
}

export async function duplicatePanelDraftStep(panel, instanceId) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !instanceId) return;
  const draft = panel._readActiveDraftPlan();
  const listKey = draftListForInstance(draft, instanceId);
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  const index = list.findIndex((step) => step.instanceId === instanceId);
  if (index < 0) return;
  const clone = { ...list[index], instanceId: draftStepId() };
  const nextList = [...list.slice(0, index + 1), clone, ...list.slice(index + 1)];
  await panel._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: nextList }));
  clearActionPreview();
  await panel.render({ force: true });
}

export async function reorderPanelDraftStep(panel, instanceId, targetInstanceId) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !instanceId || !targetInstanceId || instanceId === targetInstanceId) return;
  const draft = panel._readActiveDraftPlan();
  const listKey = draftListForInstance(draft, instanceId);
  if (listKey !== draftListForInstance(draft, targetInstanceId)) return;
  if ((draft[listKey] ?? []).some((step) => executionStatus(step) !== "pending")) {
    globalThis.ui?.notifications?.warn?.(t("Notify.RevertBeforeReorder", "Revert executed steps before reordering."));
    return;
  }
  const steps = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  const swapped = swapDraftSteps(steps, instanceId, targetInstanceId);
  if (swapped === steps) return;
  await panel._writeActiveDraftPlan(markManualDraft({ ...draft, [listKey]: swapped }));
  clearActionPreview();
  await panel.render({ force: true });
}

// Cycle a strike's multiple-attack-penalty level: auto -> MAP 0 -> -5 -> -10 -> auto. The chosen
// level is pinned on the step (mapOverride) and overrides the position-derived default, for
// abilities that keep MAP flat across consecutive attacks.
export async function cyclePanelStepMap(panel, instanceId) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  if (!step) return;
  const current = Number.isFinite(step.mapOverride) ? step.mapOverride : null;
  const next = current == null ? 0 : current >= 2 ? null : current + 1;
  await panel._persistActiveDraftStep({ ...step, mapOverride: next });
  await panel._syncDraftToGM();
  await panel.render({ force: true });
}

// The live PF2e actor for the planning combatant, used to read its movement speeds. Prefers the
// canvas token's actor (freshest derived data) and falls back to the context summary's document.
export function actorForPanelMovement(panel, context) {
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
export async function cyclePanelStepMovement(panel, instanceId) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const options = Array.isArray(panel._movementOptions) ? panel._movementOptions : [];
  if (options.length <= 1) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  if (!step) return;
  const current = stepMovementAction(step);
  const index = Math.max(0, options.findIndex((option) => option.action === current));
  const next = options[(index + 1) % options.length].action;
  await panel._persistActiveDraftStep({
    ...step,
    movementAction: next,
    action: step.action ? { ...step.action, movementAction: next } : step.action,
  });
  await panel._syncDraftToGM();
  await panel.render({ force: true });
}

// Cycle which of the actor's ready Strikes backs one atom of a distinct-target multiattack
// (e.g. Arm -> Tentacle -> Arm for a Kraken's Double Attack). Unlike movement, this doesn't
// need a manual step.action merge -- findProjectedDraftAction re-derives the atom (and applies
// this same weaponId) fresh on every render, so persisting the id alone is enough.
export async function cyclePanelStepWeapon(panel, instanceId) {
  if (!panel._canExecuteDraft()) return;
  if (!panel._context || !instanceId) return;
  const options = Array.isArray(panel._weaponOptions) ? panel._weaponOptions : [];
  if (options.length <= 1) return;
  const step = panel._findActiveStep(instanceId) ?? panel._findDraftStep(instanceId);
  if (!step || !step.groupId) return;
  const defaultId = bestReadyStrike(panel._actorForMovement(panel._context), panel._context)?.id ?? null;
  const current = step.weaponId ?? defaultId;
  const index = Math.max(0, options.findIndex((option) => option.id === current));
  const next = options[(index + 1) % options.length];
  await panel._persistActiveDraftStep({
    ...step,
    weaponId: next.id,
  });
  await panel._syncDraftToGM();
  await panel.render({ force: true });
}

export async function togglePanelFavorite(panel, actionKey) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !actionKey) return;
  toggleActionFavorite(panel._context, actionKey);
  await panel.render({ force: true });
}

export async function reorderPanelFavorite(panel, key, targetKey) {
  if (!panel._canEditDraft()) return;
  if (!panel._context || !key || !targetKey || key === targetKey) return;
  const changed = reorderActionFavorite(panel._context, key, targetKey);
  if (!changed) return;
  await panel.render({ force: true });
}

export function actionKeyForPanelStep(panel, step) {
  const key = actionBuilderKey(step);
  const direct = panel._findBuilderAction(key);
  if (direct) return direct.key;

  // A distinct-target atom (e.g. a Kraken's Double Attack) borrows its backing weapon's real
  // item reference so Execute can actually roll it (see double-attack-backing-strike plan) --
  // which makes step.item.uuid collide with that weapon's OWN standalone candidate below. The
  // atom's slug is deliberately the original ability's own, unique slug, so it must be checked
  // on its own first, or the item.uuid fallback below wins the race and mislabels the step as
  // the borrowed weapon instead of the ability that actually produced it.
  if (step?.activityProfile?.requiresDistinctTargets) {
    for (const tab of Object.values(panel._builder?.tabs ?? {})) {
      const action = tab.all.find((candidate) => candidate.slug === step?.slug);
      if (action) return action.key;
    }
  }

  for (const tab of Object.values(panel._builder?.tabs ?? {})) {
    const action = tab.all.find((candidate) =>
      candidate.baseKey === key
      || candidate.slug === step?.slug
      || candidate.id === step?.id
      // Both sides omit item.uuid for any generic, item-less action (Stride, Demoralize, Drop
      // Prone, Raise a Shield, ...), so an unguarded === here matched undefined against undefined
      // -- silently mis-keying a step to whichever OTHER item-less candidate happened to sort
      // first that pass, e.g. a Stride step re-resolving to Drop Prone's own (false) "Actor is
      // Prone" availability warning. Only compare when the step actually carries a real uuid.
      || (step?.item?.uuid && candidate.item?.uuid === step.item.uuid));
    if (action) return action.key;
  }
  return key;
}

function refreshPanelAutoFillContext(panel, draft = null) {
  const context = readCombatContext(panel.refreshSource, { combatant: panel._selectedCombatant });
  if (!context) return null;
  const focusedContext = contextWithCurrentAutoFillTargets(context);

  panel._context = focusedContext;
  panel._planningContext = draft ? projectContextForDraftDestination(focusedContext, draft) : focusedContext;
  const candidateBuild = buildCandidates(focusedContext);
  const plans = buildTurnPlans(focusedContext, candidateBuild.candidates);
  panel._autoFillPlans = plans;
  return { context: focusedContext, candidateBuild, plans };
}

function planStepSignature(plan) {
  return (plan?.steps ?? [])
    .map((step) => step?.id ?? step?.slug ?? step?.name)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("+");
}

function refreshedPlanForStaleSelection(plan, plans) {
  if (!plan || !Array.isArray(plans) || !plans.length) return null;
  const id = String(plan.id ?? "").trim();
  if (id) {
    const match = plans.find((candidate) => String(candidate?.id ?? "").trim() === id);
    if (match) return match;
  }

  const signature = planStepSignature(plan);
  if (!signature) return null;
  return plans.find((candidate) => planStepSignature(candidate) === signature) ?? null;
}

export async function autoFillPanelDraft(panel, { plan = null, forceFull = false } = {}) {
  // A fast double-click fired two overlapping runs of this function, and their interleaved
  // async steps (each racing on panel._context/panel._autoFillPlans as they awaited in turn)
  // produced a corrupted draft -- e.g. a Stride warning "Actor is Prone" for an actor who was
  // never prone, or an atom losing its groupId. A single in-flight guard makes a second
  // invocation while one is still running a no-op instead of a second overlapping run.
  if (panel._autoFillInFlight) return;
  panel._autoFillInFlight = true;
  try {
    if (!panel._canEditDraft()) return;
    // Respect the GM's "hide Auto-fill from players" setting regardless of how this was triggered.
    if (game?.user?.isGM !== true && settingOrDefault(SETTINGS.hideAutoFillFromPlayers, false)) return;
    if (!panel._context) return;
    const draft = panel._readActiveDraftPlan();
    const replacingDraft = (draft.steps?.length ?? 0) > 0;
    const replacingManualDraft = !forceFull && replacingDraft && draft.source !== "auto-fill" && hasLockedDraftSteps(draft);
    const refreshed = refreshPanelAutoFillContext(panel, replacingManualDraft ? draftForAutoFillGap(draft) : (forceFull ? null : draft));
    // Manual steps are already in the draft -- fill the remaining budget around them instead of
    // discarding what the player chose (see _fillDraftGap).
    if (replacingManualDraft) {
      await panel._fillDraftGap({ plan, draft });
      return;
    }
    const fallbackAutoFill = () => {
      const candidateBuild = refreshed?.candidateBuild ?? buildCandidates(panel._context);
      return bestTurnPlan(panel._context, candidateBuild.candidates);
    };
    if (forceFull) panel._pinnedFillPlanId = null;
    if (!plan) panel._pinnedPlanId = null;
    const refreshedPlans = refreshed?.plans ?? [];
    const contextualPlan = refreshedPlanForStaleSelection(plan, refreshedPlans);
    const autoFill = plan
      ? (contextualPlan ?? bestAutoFillPlan(refreshedPlans) ?? (refreshed ? null : plan))
      : bestAutoFillPlan(refreshedPlans.length ? refreshedPlans : panel._autoFillPlans)
      ?? panel._builder?.autoFill
      ?? panel._plan
      ?? fallbackAutoFill();
    if (!autoFill?.steps?.length) return;
    if (plan) panel._pinnedPlanId = autoFill.id ?? null;

    const reachableSteps = panel._atomizeAutoFillSteps(autoFill, panel._context);
    await panel._writeActiveDraftPlan({
      ...draft,
      source: "auto-fill",
      autoFillPlanId: autoFill.id ?? null,
      autoFillPlanSummary: autoFill.summary ?? "",
      steps: reachableSteps,
    });
    clearActionPreview();
    await panel.render({ force: true });
  } finally {
    panel._autoFillInFlight = false;
  }
}

// Appends a fill plan's steps after the draft's existing (manual) steps rather than replacing
// the draft -- the manual steps are never touched, so there is nothing to confirm/undo here.
export async function fillPanelDraftGap(panel, { plan, draft }) {
  const fillPlans = panel._fillGapPlans();
  if (!fillPlans.length) return;
  if (!plan) panel._pinnedFillPlanId = null;
  const lockedDraft = draftForAutoFillGap(draft);
  // A cycled plan id is scoped to the remaining-budget search that produced it -- if the draft
  // changed since (a step was added/removed) it may no longer appear, so fall back to best.
  const fillPlan = refreshedPlanForStaleSelection(plan, fillPlans) ?? bestAutoFillPlan(fillPlans);
  if (!fillPlan?.steps?.length) return;
  if (plan) panel._pinnedFillPlanId = fillPlan.id ?? null;
  const movementContext = panel._planningContext ?? panel._context;
  const addedSteps = panel._atomizeAutoFillSteps(fillPlan, movementContext, lockedDraft.steps)
    .map((step) => ({ ...step, autoFillGenerated: true }));
  if (!addedSteps.length) return;
  await panel._writeActiveDraftPlan({
    ...lockedDraft,
    steps: [...lockedDraft.steps, ...addedSteps],
  });
  clearActionPreview();
  await panel.render({ force: true });
}

// Converts a plan's steps into draft steps, chaining movement destinations from movementContext
// (turn-start position for a fresh Auto-fill, or the draft-projected position for a gap fill) and
// checking reach against prefixSteps (the draft steps that will already precede these, if any).
export function atomizePanelAutoFillSteps(panel, autoFill, movementContext, prefixSteps = []) {
  // Auto-fill's whole point is a ready-to-execute plan: the recommendation already chose a
  // target and (for movement) a destination, so pre-fill both regardless of who's using it or
  // what kind of actor it is -- a GM who doesn't want players pre-filled can already turn off
  // Auto-fill for players entirely via the hideAutoFillFromPlayers setting checked above. The
  // projected origin advances so a chained stride starts where the prior one lands.
  let mc = movementContext;
  // Hard guard: "Drop Prone -> Stride" is illegal (can't Stride while prone). If the plan applies
  // prone, drop any Stride/Step from the draft regardless of what the planner produced. Crawl is
  // legal while prone, so it is not a basic auto-fill move and survives.
  const planAppliesProne = autoFill.steps.some(autoFillAppliesProne);
  const atomicSteps = autoFill.steps
    .filter((step) => !isRedundantAutoFillMove(step))
    .flatMap((step) => builderAtomicActionsForStep(step))
    // Filter AFTER expansion: a move-and-strike composite (e.g. "stride-away-strike-dart") expands
    // into a bare Stride, which is illegal while prone. Drop those Stride/Step atoms.
    .filter((step) => !(planAppliesProne && isBasicAutoFillMove(step)));
  const steps = atomicSteps.map((step, index) => {
    const slug = String(step?.slug ?? "").toLowerCase();
    const isBasicMove = isBasicAutoFillMove(slug);
    // Origin for THIS step = where the prior committed strides left the actor (real position for
    // the first). Computed before any chaining update below so over-Speed checks use the true origin.
    const moveOrigin = mc.token?.plannedCenter ?? mc.token?.center;
    // Keep a pre-set destination (e.g. a composite's attack square) only if the actor can actually
    // reach it this move — Foundry's ruler is the authority, so an over-Speed square is dropped
    // rather than auto-committed as an impossible stride.
    const presetDestination = step?.destination
      && !(isBasicMove && autoFillStrideOverSpeed(moveOrigin, step.destination, panel._context?.profile))
      ? step.destination
      : null;
    const presetAreaMarker = !step?.areaMarker ? computeAreaMarker(panel._context, step) : null;
    let draftStep = {
      instanceId: draftStepId(),
      actionKey: panel._actionKeyForStep(step),
      // Persist a display name so the step still reads correctly if its action stops being
      // generated after execution (e.g. a drawn weapon no longer offers its Draw action).
      name: step?.name ?? step?.action?.name,
      actionCost: step?.actionCost ?? step?.cost,
      requiresDestination: requiresDestinationForAction(step),
      // A distinct-target ability's atoms all share the same id (compositeStrikeActionKey is
      // computed from the original, un-atomized action) -- reused here as the group id so the
      // panel can visually nest them under one header instead of showing N identical-looking rows.
      // A backed move-and-strike composite's atoms (e.g. Sudden Charge's two Strides and one
      // Strike) arrive with this identity already stamped by builderAtomicActionsForStep, since
      // its Stride and Strike atoms come from two different builder functions that share nothing
      // else -- prefer that pre-stamped identity when present, over re-deriving it here.
      ...(step?.groupId
        ? { groupId: step.groupId, groupLabel: step.groupLabel, ...(Number.isFinite(step?.atomIndex) ? { atomIndex: step.atomIndex } : {}) }
        : step?.activityProfile?.requiresDistinctTargets
          ? { groupId: step.id, groupLabel: String(step?.name ?? "").split(" -> ")[0] }
          : {}),
      ...(step?.activityProfile?.minionPlan
        ? { activityProfile: { minionPlan: step.activityProfile.minionPlan } }
        : {}),
      ...(presetDestination ? { destination: presetDestination } : {}),
      ...(presetAreaMarker ? { areaMarker: presetAreaMarker } : {}),
    };

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
      const movement = recommendedMovementForStep(mc, movementStep);
      // Drop a target-aimed basic Stride/Step that can't improve position toward the planned
      // target (blocked path = the "Stride to the same place" the GM sees). A real closing move is
      // kept. Deliberate kiting (melee, then Stride away, then ranged) is a manual play.
      // A grouped Stride (e.g. Rush, Sudden Charge) is a mandatory component of a fixed-cost
      // composite, not a discretionary reposition -- its own actionCost carries the whole
      // ability's cost (see builderAtomicActionsForStep), so dropping it here would silently
      // lose that cost and leave its sibling Strike atom looking free with no group to correct it.
      if (isBasicMove && !step?.groupId && movement?.destination
        && !strideImprovesPosition(moveOrigin, movement.destination, autoFillTargetCenter(movementStep))) {
        return null;
      }
      // Commit (and chain the planned origin) only for a destination within Speed; otherwise leave
      // it unset so the GM places a legal one instead of an over-range auto-stride.
      if (movement?.destination
        && !(isBasicMove && autoFillStrideOverSpeed(moveOrigin, movement.destination, panel._context?.profile))) {
        draftStep = {
          ...draftStep,
          destination: movement.destination,
          // A direct path (no corner routing) has no waypoints of its own -- fall back to the
          // destination as a one-point path so the distance label still renders, the same fix
          // as the interactive destination picker's single-click case.
          movementPlan: { native: false, waypoints: movement.waypoints?.length ? movement.waypoints : [movement.destination] },
        };
        mc = {
          ...mc,
          token: { ...(mc.token ?? {}), plannedCenter: movement.destination },
        };
      }
    }

    return draftStep;
  }).filter(Boolean);
  // Drop a Strike that can never connect: out of range from where it executes with no earlier
  // move to close the gap (e.g. a move-and-strike whose Stride was pruned, or an aggro target
  // left out of melee reach). Resolve each step from its projected origin, as the warnings do.
  // prefixSteps (any manual steps the fill is appended after) is included so both the reachability
  // projection and "did an earlier move already happen" check see the full sequence, not just
  // the new steps in isolation.
  const reachDraft = { steps: [...prefixSteps, ...steps] };
  return steps.filter((step, index) => {
    const hasEarlierMove = [...prefixSteps, ...steps.slice(0, index)]
      .some((earlier) => earlier.requiresDestination === true);
    const projected = findProjectedDraftAction(panel._context, reachDraft, step);
    return !isUnreachableStrikeStep(projected, hasEarlierMove);
  });
}

export async function cyclePanelAutoFillDraft(panel, direction = 1) {
  const draft = panel._readActiveDraftPlan?.() ?? null;
  const useFillGap = draft?.source !== "auto-fill" && hasLockedDraftSteps(draft);
  refreshPanelAutoFillContext(panel, useFillGap ? draftForAutoFillGap(draft) : draft);
  const plans = panel._activeAutoFillPlans();
  const pinnedId = panel._activePinnedPlanId();
  const current = selectDisplayPlan(plans, pinnedId);
  const currentId = current?.id ?? pinnedId;
  const next = direction < 0
    ? previousAutoFillPlan(plans, currentId)
    : nextAutoFillPlan(plans, currentId);
  if (!next) return;
  if (panel._hasManualDraftContent()) panel._pinnedFillPlanId = next.id ?? null;
  else panel._pinnedPlanId = next.id ?? null;
  await panel._autoFillDraft({ plan: next });
}

export async function syncPanelDraftToGM(panel, { notify = false } = {}) {
  if (!panel._context || globalThis.game?.user?.isGM === true) return false;
  const draft = readDraftPlan(panel._context);

  try {
    const sharedDraft = writeSharedDraftPlan(panel._context, {
      ...draft,
      userId: globalThis.game?.user?.id ?? null,
      userName: globalThis.game?.user?.name ?? "",
    });
    try {
      await writeSharedDraftPlanActorFlag(panel._context, sharedDraft);
    } catch (error) {
      console.warn(`${MODULE_ID} | Actor-flag plan sync failed`, error);
    }
    const payload = {
      type: "shareDraft",
      key: sharedDraftPlanKey(panel._context),
      combatId: panel._context.combat?.id ?? null,
      round: panel._context.combat?.round ?? null,
      combatantId: panel._context.combatant?.id ?? null,
      actorName: panel._context.actor?.name ?? panel._context.combatant?.name ?? "",
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
