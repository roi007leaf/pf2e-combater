import { SETTINGS, settingOrDefault } from "../../settings.js";
import { collectionValues } from "../../foundry-data.js";
import { buildActionBuilderModel, projectContextForDraftDestination } from "../../engine/action/builder.js";
import { buildCandidates } from "../../engine/candidates.js";
import { bestTurnPlan, buildTurnPlans } from "../../engine/planner.js";
import { readActionFavorites } from "../../state/action-favorites.js";
import { readCombatContext } from "../../state/combat-context.js";
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

function isPlayerControlledActor(actor) {
  const document = actor?.document ?? actor;
  if (!document) return false;
  if (String(document.type ?? "").toLowerCase() === "character") return true;
  return actorHasActiveNonGmOwner(document);
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

  return {
    actor: context?.actor ?? null,
    token: context?.token ?? null,
    plan: autoFill,
    headerSteps: groupDraftSteps(draftSteps),
    headerSummary: "",
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
  const gmViewingPlayerPlan = game?.user?.isGM === true && isPlayerControlledActor(context.actor?.document ?? context.actor);
  const useSharedDraft = sharedDraftKnown && (gmViewingPlayerPlan || shouldDisplaySharedDraft(draft, sharedDraft));
  panel._gmExecuteMode = gmViewingPlayerPlan && useSharedDraft;
  const activeDraft = (gmViewingPlayerPlan && useSharedDraft)
    ? { ...sharedDraft, readonly: true, shared: true }
    : gmViewingPlayerPlan
      ? { steps: [], readonly: true, shared: true, userName: "" }
      : draft;

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
  panel._builder.readonly = panel._builder.readonly || gmViewingPlayerPlan;

  return viewPanelContext(panel, context);
}
