import { SETTINGS, settingOrDefault } from "../../settings.js";
import { collectionValues } from "../../foundry-data.js";
import { buildActionBuilderModel, projectContextForDraftDestination } from "../../engine/action/builder/index.js";
import { buildCandidates } from "../../engine/candidates.js";
import { bestTurnPlan, buildTurnPlans } from "../../engine/planner.js";
import { readActionFavorites } from "../../state/action-favorites.js";
import { readCombatContext } from "../../state/combat-context.js";
import { deterministicPlanPreferenceAdjustment } from "../../state/preference-profile.js";
import {
  hasSharedDraftPlan,
  readDraftPlan,
  readSharedDraftPlan,
  shouldDisplaySharedDraft,
} from "../../state/draft-plans.js";
import { actorMovementOptions } from "../../readers/actor-profile.js";
import { actorStrikeOptions } from "../../readers/action/reader.js";
import { readSustainedSpellEntries } from "../../engine/sustained-spells.js";
import { intelLedgerView, isNpcIntelTarget } from "../../rules/intel-ledger.js";
import { tacticPersonalityView } from "../../rules/tactic-personality.js";
import { projectedDraftStepActions } from "./draft-helpers.js";
import { contextWithCurrentAutoFillTargets } from "./auto-fill-context.js";
import { autoFillCyclePlans, selectDisplayPlan } from "../plan-selection.js";
import {
  debugAction,
  decorateBuilder,
  decoratePlan,
  groupDraftSteps,
  withBuilderActionFields,
} from "./view-model.js";
import { t } from "../../i18n.js";

function ownershipLevelValue(level) {
  if (Number.isFinite(Number(level))) return Number(level);
  const levels = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? {};
  return Number(levels[String(level ?? "").toUpperCase()] ?? 0) || 0;
}

function nonGmActorOwners(actor) {
  const document = actor?.document ?? actor;
  if (!document) return [];
  const ownerLevel = ownershipLevelValue(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
  const users = collectionValues(globalThis.game?.users).filter((user) => user && user.isGM !== true);

  if (typeof document.testUserPermission === "function") {
    return users.filter((user) => document.testUserPermission(user, ownerLevel));
  }

  const ownership = document.ownership ?? {};
  return users.filter((user) => ownershipLevelValue(ownership[user.id]) >= ownerLevel);
}

export function gmPlayerPlanAccess(actor) {
  const document = actor?.document ?? actor;
  const owners = nonGmActorOwners(document).sort((left, right) => {
    const activityDifference = Number(right?.active === true) - Number(left?.active === true);
    if (activityDifference !== 0) return activityDifference;
    return String(left?.name ?? left?.id ?? "").localeCompare(String(right?.name ?? right?.id ?? ""));
  });
  const owner = owners[0] ?? null;
  const isCharacter = String(document?.type ?? "").toLowerCase() === "character";
  const viewing = globalThis.game?.user?.isGM === true && Boolean(document) && (isCharacter || Boolean(owner));
  const editable = viewing && Boolean(owner) && owners.every((candidate) => candidate?.active !== true);
  return {
    viewing,
    editable,
    ownerId: owner?.id ?? "",
    ownerName: owner?.name ?? "",
  };
}

function isPlayerControlledActor(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  if (String(document.type ?? "").toLowerCase() === "character") return true;
  return nonGmActorOwners(document).length > 0;
}

function activeNpcIntelTarget(context) {
  if (game?.user?.isGM !== true) return null;
  const target = {
    id: context?.token?.id ?? context?.actor?.id,
    name: context?.token?.name ?? context?.actor?.name,
    actor: context?.actor,
    token: context?.token,
  };
  return isNpcIntelTarget(target) ? target : null;
}

export function panelIntelLedgerView(context) {
  const target = activeNpcIntelTarget(context);
  if (target) {
    return intelLedgerView({
      ...context,
      intelTargets: [target],
    });
  }
  if (game?.user?.isGM === true && isPlayerControlledActor(context?.actor?.document ?? context?.actor)) {
    return intelLedgerView({
      ...context,
      isGM: false,
    });
  }
  return intelLedgerView(context);
}

export function viewPanelContext(panel, context) {
  const showDebug = Boolean(game?.user?.isGM && settingOrDefault(SETTINGS.showDebugTab, false));
  const showAutoFill = game?.user?.isGM === true || !settingOrDefault(SETTINGS.hideAutoFillFromPlayers, false);
  const activePlans = panel._activeAutoFillPlans();
  const selectedAutoFill = selectDisplayPlan(activePlans, panel._activePinnedPlanId())
    ?? panel._builder?.autoFill
    ?? panel._plan;
  const autoFill = decoratePlan(selectedAutoFill, 0);
  const autoFillCycle = autoFillCyclePlans(activePlans);
  const autoFillCycleIndex = autoFillCycle.findIndex((plan) => plan?.id === selectedAutoFill?.id);
  const autoFillCyclePosition = autoFillCycleIndex >= 0 ? autoFillCycleIndex + 1 : 1;
  const draftSteps = panel._builder?.draft?.steps ?? [];
  const planPreference = deterministicPlanPreferenceAdjustment(context, panel._builder?.draft);

  return {
    actor: context?.actor ?? null,
    token: context?.token ?? null,
    plan: autoFill,
    headerSteps: groupDraftSteps(draftSteps),
    headerSummary: "",
    planPreference: {
      ...planPreference,
      visible: draftSteps.length > 0 && panel._builder?.readonly !== true,
    },
    builder: panel._builder,
    expanded: panel.expanded,
    activeTab: panel.activeTab,
    browserOpen: Boolean(panel._browser),
    tacticPersonality: tacticPersonalityView(context),
    intelLedger: panelIntelLedgerView(context),
    showDebug,
    showAutoFill,
    autoFillCycle: {
      canCycle: autoFillCycle.length > 1,
      label: `${autoFillCyclePosition}/${Math.max(1, autoFillCycle.length)}`,
      tooltip: t("Panel.AutoFillCycleTooltip", "Left-click next plan; right-click previous. Current: {current}/{total}.", { current: autoFillCyclePosition, total: Math.max(1, autoFillCycle.length) }),
      ariaLabel: t("Panel.AutoFillCycleAria", "Cycle Auto-fill plan"),
    },
    hasContext: Boolean(context),
    refreshSource: panel.refreshSource,
    debug: {
      candidates: panel._candidates.map(debugAction),
      rejected: panel._rejected.map((entry, index) => ({
        index,
        action: debugAction(entry?.action, index),
        reason: entry?.reason ?? "",
      })),
      detected: panel._detected.map(debugAction),
      context,
    },
  };
}

export function clearPanelPreparedContext(panel) {
  panel._candidates = [];
  panel._rejected = [];
  panel._detected = [];
  panel._plans = [];
  panel._autoFillPlans = [];
  panel._plan = null;
  panel._builder = null;
  panel._planningContext = null;
  panel._movementOptions = [];
  panel._weaponOptions = [];
  panel._sharedDraftSeed = null;
}

export function preparePanelContext(panel) {
  const context = readCombatContext(panel.refreshSource, { combatant: panel._selectedCombatant });
  panel._context = context;

  if (!context) {
    clearPanelPreparedContext(panel);
    return viewPanelContext(panel, null);
  }

  const draft = readDraftPlan(context);
  const sharedDraft = game?.user?.isGM === true ? readSharedDraftPlan(context) : null;
  const sharedDraftKnown = hasSharedDraftPlan(sharedDraft);
  const playerPlanAccess = gmPlayerPlanAccess(context.actor?.document ?? context.actor);
  const gmViewingPlayerPlan = playerPlanAccess.viewing;
  const gmEditingOfflinePlayerPlan = playerPlanAccess.editable;
  const useSharedDraft = gmEditingOfflinePlayerPlan
    || (sharedDraftKnown && (gmViewingPlayerPlan || shouldDisplaySharedDraft(draft, sharedDraft)));
  panel._gmExecuteMode = gmViewingPlayerPlan && useSharedDraft;
  const activeDraft = (gmViewingPlayerPlan && useSharedDraft)
    ? {
        ...sharedDraft,
        steps: sharedDraftKnown ? sharedDraft.steps : [],
        uncounted: sharedDraftKnown ? sharedDraft.uncounted : [],
        userId: gmEditingOfflinePlayerPlan ? playerPlanAccess.ownerId : sharedDraft.userId,
        userName: gmEditingOfflinePlayerPlan ? playerPlanAccess.ownerName : sharedDraft.userName,
        readonly: !gmEditingOfflinePlayerPlan,
        shared: true,
      }
    : gmViewingPlayerPlan
      ? {
          steps: [],
          uncounted: [],
          readonly: true,
          shared: true,
          userId: playerPlanAccess.ownerId,
          userName: playerPlanAccess.ownerName,
        }
      : draft;
  panel._sharedDraftSeed = panel._gmExecuteMode ? activeDraft : null;

  const baseBuild = buildCandidates(context);
  const autoFillContext = contextWithCurrentAutoFillTargets(context);
  const autoFillBuild = autoFillContext === context ? baseBuild : buildCandidates(autoFillContext);
  const planningContext = projectContextForDraftDestination(context, activeDraft);
  panel._planningContext = planningContext;
  const candidateBuild = planningContext === context ? baseBuild : buildCandidates(planningContext);
  const { candidates, rejected, detected } = candidateBuild;
  const baseBuilderCandidates = baseBuild.candidates.map(withBuilderActionFields);
  const builderCandidates = candidates.map(withBuilderActionFields);
  const builderRejected = rejected.map((entry) => ({
    ...entry,
    action: withBuilderActionFields(entry?.action),
  }));
  const draftStepActions = projectedDraftStepActions(context, activeDraft);
  const autoFillPlans = buildTurnPlans(autoFillContext, autoFillBuild.candidates.map(withBuilderActionFields));
  const plans = buildTurnPlans(planningContext, builderCandidates);
  if (panel._pinnedPlanId && !autoFillPlans.some((candidatePlan) => candidatePlan?.id === panel._pinnedPlanId)) {
    panel._pinnedPlanId = null;
  }
  const plan = selectDisplayPlan(plans, panel._pinnedPlanId) ?? bestTurnPlan(planningContext, builderCandidates);
  const favorites = readActionFavorites(context);

  panel._candidates = builderCandidates;
  panel._rejected = rejected;
  panel._detected = detected;
  panel._plans = plans;
  panel._autoFillPlans = autoFillPlans;
  panel._plan = plan;
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
  panel._movementOptions = actorMovementOptions(panel._actorForMovement(context));
  panel._weaponOptions = actorStrikeOptions(panel._actorForMovement(context), context);
  panel._builder = decorateBuilder(builderModel, panel.activeTab, panel.searchQuery, {
    sustainedSpells,
    awaitingGm: panel._awaitingGm,
    movementOptions: panel._movementOptions,
    weaponOptions: panel._weaponOptions,
  });
  panel._builder.readonly = panel._builder.readonly || (gmViewingPlayerPlan && !gmEditingOfflinePlayerPlan);

  return viewPanelContext(panel, context);
}
