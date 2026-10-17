import { SETTINGS, minimalHiddenParts, settingOrDefault } from "../../settings.js";
import { canUndoPanelDraftClear } from "./draft-workflow.js";
import { collectionValues } from "../../foundry-data.js";
import { buildActionBuilderModel, projectContextForDraftDestination } from "../../engine/action/builder/index.js";
import { refreshDraftAreaPlacements } from "../../engine/action/builder/projection.js";
import { buildCandidates } from "../../engine/candidates.js";
import { buildTurnPlans } from "../../engine/planner.js";
import { buildLoadoutAdvice } from "../../engine/loadout-advisor.js";
import { buildEffectClock } from "../../engine/effect-clock.js";
import {
  activeTurnIntentCount,
  normalizeTurnIntent,
  withTurnIntent,
} from "../../engine/planner/turn-intent.js";
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
import {
  resourceHorizonView,
  withResourceHorizon,
} from "../../rules/resource-horizon.js";
import { projectedDraftStepActions } from "./draft-helpers.js";
import { contextWithCurrentAutoFillTargets, currentAutoFillTargetKey } from "./auto-fill-context.js";
import { autoFillCyclePlans, planComparison, selectDisplayPlan } from "../plan-selection.js";
import {
  debugAction,
  decorateBuilder,
  decoratePlan,
  decoratePlanLayout,
  groupDraftSteps,
  withBuilderActionFields,
} from "./view-model.js";
import { t } from "../../i18n.js";
import { trackedActionContext } from "../../state/action-tracker.js";
import { actionTrackerView } from "./action-tracker.js";
import { turnControlsView } from "./turn-controls.js";
import { upcomingTurnLimit, upcomingTurnsView } from "./upcoming-turns.js";

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
  // A GM-only game has no player owner to go offline. The GM owns that PC's
  // shared plan until a player owner is assigned and connects.
  const editable = viewing && owners.every((candidate) => candidate?.active !== true);
  const planOwner = owner ?? (editable ? globalThis.game?.user : null);
  return {
    viewing,
    editable,
    ownerId: planOwner?.id ?? "",
    ownerName: planOwner?.name ?? "",
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

// "Why this plan" card: the plan it beat, what differs, and how the turn ends.
function planWhyView(plan, cycle, position) {
  if (!plan?.steps?.length) return { visible: false };
  const comparison = planComparison(plan, cycle);
  const outcomes = [];
  const danger = plan.danger ?? {};
  if (danger.delta > 0) {
    outcomes.push({ tone: "risk", icon: "fa-triangle-exclamation", text: danger.delta === 1
      ? t("Panel.WhyEndsNearOne", "Ends next to 1 more enemy")
      : t("Panel.WhyEndsNearMany", "Ends next to {count} more enemies", { count: danger.delta }) });
  } else if (danger.delta < 0) {
    outcomes.push({ tone: "good", icon: "fa-shield-halved", text: t("Panel.WhyEndsAway", "Ends out of reach of {count}", { count: -danger.delta }) });
  }
  if (danger.provoked > 0) {
    outcomes.push({ tone: "risk", icon: "fa-person-running", text: danger.provoked === 1
      ? t("Panel.WhyProvokesOne", "Provokes 1 Reactive Strike")
      : t("Panel.WhyProvokesMany", "Provokes {count} Reactive Strikes", { count: danger.provoked }) });
  }
  const saved = Number(plan.readiness?.saved) || 0;
  if (saved > 0) {
    outcomes.push({ tone: "good", icon: "fa-forward", text: saved === 1
      ? t("Panel.WhyReadyOne", "Saves a Stride next turn")
      : t("Panel.WhyReadyMany", "Saves {count} Strides next turn", { count: saved }) });
  } else if (saved < 0) {
    outcomes.push({ tone: "neutral", icon: "fa-backward", text: t("Panel.WhyReadyWorse", "Needs {count} more Stride next turn", { count: -saved }) });
  }
  if (!comparison && !outcomes.length) return { visible: false };
  return {
    visible: true,
    label: t("Panel.WhyLabel", "Why this plan?"),
    contextHint: t("Panel.WhyContextHint", "Right-click: why this plan."),
    title: t("Panel.WhyTitle", "Why plan {position}", { position }),
    versus: comparison ? t("Panel.WhyVersus", "Beats plan {position}", { position: comparison.position }) : "",
    margin: comparison ? (comparison.margin >= 0 ? `+${comparison.margin}` : String(comparison.margin)) : "",
    gains: comparison?.chosen ?? [],
    drops: comparison?.instead ?? [],
    outcomes,
  };
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
  const planWhy = planWhyView(selectedAutoFill, autoFillCycle, autoFillCyclePosition);
  const draftSteps = panel._builder?.draft?.steps ?? [];
  const planPreference = deterministicPlanPreferenceAdjustment(context, panel._builder?.draft);
  const resourceHorizon = resourceHorizonView(panel.resourceHorizon);
  const turnIntent = normalizeTurnIntent(panel._turnIntent);
  const turnIntentCount = activeTurnIntentCount(turnIntent);
  const loadoutCount = panel._loadoutAdvice?.length ?? 0;
  const effectClock = panel._effectClock ?? { urgentCount: 0, totalCount: 0 };
  const planLayout = decoratePlanLayout(groupDraftSteps(draftSteps), { openTools: panel._openStepTools });
  // Right after Clear, offer to put the steps back (until anything else changes the plan).
  planLayout.undoClear = canUndoPanelDraftClear(panel, panel._readActiveDraftPlan?.()) ? {
    label: t("Panel.UndoClear", "Undo clear"),
    tooltip: t("Panel.UndoClearTooltip", "Put back the steps you just cleared."),
  } : null;
  const tracker = actionTrackerView(context);
  if (tracker.visible) {
    let normalIndex = 0;
    tracker.pips = tracker.pips.map((pip) => {
      if (pip.quickened) return { ...pip, slot: "q", owner: pip.spent ? null : planLayout.quickenedOwner };
      const index = normalIndex;
      normalIndex += 1;
      return { ...pip, slot: String(index), owner: pip.spent ? null : planLayout.pipOwners[index] ?? null };
    });
    const planned = planLayout.pipOwners.length;
    tracker.plannedLabel = planned > 0
      ? t("ActionTracker.Planned", "{planned} of {total} planned", { planned: Math.min(planned, tracker.normal), total: tracker.normal })
      : "";
    tracker.overPlanned = planned > tracker.normal;
  }
  const tactic = tacticPersonalityView(context);
  const profileParts = [tactic?.visible ? tactic.label : "", resourceHorizon?.label ?? ""].filter(Boolean);

  return {
    actor: context?.actor ?? null,
    actionTracker: tracker,
    planLayout,
    profileMenu: {
      label: profileParts.join(" · ") || t("Panel.PlanSetupLabel", "Plan setup"),
      ariaLabel: t("Panel.PlanSetup", "Plan setup"),
    },
    turnControls: turnControlsView(context),
    upcomingTurns: upcomingTurnsView(undefined, undefined, { limit: upcomingTurnLimit(panel) }),
    token: context?.token ?? null,
    plan: autoFill,
    headerSteps: planLayout.steps,
    headerSummary: "",
    planPreference: {
      ...planPreference,
      visible: draftSteps.length > 0 && panel._builder?.readonly !== true,
    },
    recordTurn: {
      visible: game?.user?.isGM === true && (panel._autoFillPlans?.length ?? 0) > 0,
      tooltip: t("RecordTurn.Tooltip", "Save this turn as a planner test (GM)"),
    },
    builder: panel._builder,
    expanded: panel.expanded,
    trackerOnly: panel.trackerOnly === true,
    minimalHidden: minimalHiddenParts(),
    minimalIdleLabel: globalThis.game?.combat?.started
      ? t("Panel.MinimalIdleWaiting", "Waiting for a combatant")
      : t("Panel.MinimalIdle", "No active encounter"),
    activeTab: panel.activeTab,
    browserOpen: Boolean(panel._browser),
    tacticPersonality: tacticPersonalityView(context),
    resourceHorizon: {
      ...resourceHorizon,
      visible: Boolean(context && panel._builder && showAutoFill && panel._builder.readonly !== true),
    },
    turnIntent: {
      visible: Boolean(context && panel._builder && showAutoFill && panel._builder.readonly !== true),
      active: turnIntentCount > 0,
      count: turnIntentCount,
      label: turnIntentCount > 0
        ? t("TurnIntent.ActiveLabel", "Intent {count}", { count: turnIntentCount })
        : t("TurnIntent.Label", "Intent"),
      tooltip: turnIntentCount > 0
        ? t("TurnIntent.ActiveTooltip", "{count} turn intent controls active. Click to edit.", { count: turnIntentCount })
        : t("TurnIntent.Tooltip", "Set temporary Auto-fill constraints for this turn."),
    },
    loadoutAdvisor: {
      visible: Boolean(context && panel._builder && showAutoFill && panel._builder.readonly !== true),
      active: loadoutCount > 0,
      count: loadoutCount,
      label: loadoutCount > 0
        ? t("Loadout.ActiveLabel", "Loadout {count}", { count: loadoutCount })
        : t("Loadout.Label", "Loadout"),
      tooltip: loadoutCount > 0
        ? t("Loadout.ActiveTooltip", "{count} battlefield-aware loadout swaps available.", { count: loadoutCount })
        : t("Loadout.Tooltip", "Review held gear against current battlefield conditions."),
    },
    effectClock: {
      visible: Boolean(context && panel._builder && showAutoFill),
      active: effectClock.totalCount > 0,
      urgent: effectClock.urgentCount > 0,
      count: effectClock.urgentCount,
      label: effectClock.urgentCount > 0
        ? t("EffectClock.ActiveLabel", "Clock {count}", { count: effectClock.urgentCount })
        : t("EffectClock.Label", "Clock"),
      tooltip: effectClock.urgentCount > 0
        ? t("EffectClock.ActiveTooltip", "{count} effect events need attention this turn.", { count: effectClock.urgentCount })
        : t("EffectClock.Tooltip", "{count} timed effect events tracked.", { count: effectClock.totalCount }),
    },
    intelLedger: panelIntelLedgerView(context),
    showDebug,
    showAutoFill,
    autoFillCycle: {
      canCycle: autoFillCycle.length > 1,
      // The minimal bar only offers other plans once Auto-fill has filled this one.
      inBar: autoFillCycle.length > 1 && panel._builder?.draft?.source === "auto-fill"
        && (panel._builder?.draft?.steps?.length ?? 0) > 0,
      label: `${autoFillCyclePosition}/${Math.max(1, autoFillCycle.length)}`,
      position: autoFillCyclePosition,
      total: Math.max(1, autoFillCycle.length),
      planWord: t("Panel.AltPlan", "Plan"),
      ofLabel: t("Panel.AltPlanOf", "of {total}", { total: Math.max(1, autoFillCycle.length) }),
      previousLabel: t("Panel.AltPlanPrevious", "Previous plan"),
      nextLabel: t("Panel.AltPlanNext", "Next plan"),
      tooltip: t("Panel.AutoFillCycleHint", "Click for the next plan, right-click for the previous one."),
      why: planWhy,
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
  panel._autoFillTargetKey = null;
  panel._autoFillPreparationCache = null;
  panel._fillGapPlanCache = null;
  panel._fillGapPlanCacheKey = null;
  panel._loadoutAdvice = [];
  panel._effectClock = { entries: [], groups: [], urgentCount: 0, totalCount: 0, hasEntries: false };
  panel._plan = null;
  panel._builder = null;
  panel._planningContext = null;
  panel._movementOptions = [];
  panel._weaponOptions = [];
  panel._sharedDraftSeed = null;
}

export function preparePanelContext(panel) {
  const context = trackedActionContext(withResourceHorizon(
    readCombatContext(panel.refreshSource, { combatant: panel._selectedCombatant }),
    panel.resourceHorizon,
  ));
  panel._context = context;
  panel._syncTurnIntentContext?.(context);

  if (!context) {
    clearPanelPreparedContext(panel);
    return viewPanelContext(panel, null);
  }
  // Tracker only: no candidates, Auto-fill or draft -- just the tracker and turn controls.
  if (panel.trackerOnly) {
    clearPanelPreparedContext(panel);
    return viewPanelContext(panel, context);
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

  const intentContext = withTurnIntent(context, panel._turnIntent);
  const autoFillTargetKey = currentAutoFillTargetKey(panel._turnIntent?.lockedTargetIds ?? []);
  const preparationCache = panel._autoFillPreparationCache?.targetKey === autoFillTargetKey
    && panel._autoFillPreparationCache?.contextKey === panel._turnIntentContextKey
    ? panel._autoFillPreparationCache
    : null;
  panel._autoFillTargetKey = autoFillTargetKey;
  const baseBuild = preparationCache?.baseBuild ?? buildCandidates(context);
  const autoFillContext = contextWithCurrentAutoFillTargets(intentContext, panel._turnIntent?.lockedTargetIds ?? []);
  const autoFillBuild = preparationCache?.autoFillBuild
    ?? (autoFillContext === context ? baseBuild : buildCandidates(autoFillContext));
  const planningContext = withTurnIntent(projectContextForDraftDestination(context, activeDraft), panel._turnIntent);
  panel._planningContext = planningContext;
  const needsProjectedCandidates = Boolean(panel._browser)
    || Boolean(game?.user?.isGM && settingOrDefault(SETTINGS.showDebugTab, false));
  const candidateBuild = planningContext === context
    ? baseBuild
    : needsProjectedCandidates ? buildCandidates(planningContext) : baseBuild;
  const { candidates, rejected, detected } = candidateBuild;
  const baseBuilderCandidates = baseBuild.candidates.map(withBuilderActionFields);
  const builderCandidates = candidates.map(withBuilderActionFields);
  const builderRejected = rejected.map((entry) => ({
    ...entry,
    action: withBuilderActionFields(entry?.action),
  }));
  // Grouped steps (Flurry, Sudden Charge, etc.) use synthetic child keys that
  // are absent from the raw candidate list. Resolve them even with Browse shut;
  // keep the broader per-step projection work scoped to Browse/debug views.
  const draftStepActions = projectedDraftStepActions(context, activeDraft, { groupedOnly: !needsProjectedCandidates });
  const autoFillPlans = preparationCache?.autoFillPlans
    // The panel cycle is for strong tactical alternatives. Exhaustive action coverage belongs in
    // Browse; forcing every low-ranked legal action into a plan made every real context refresh
    // rebuild dozens of irrelevant alternatives before any button could repaint.
    ?? buildTurnPlans(autoFillContext, autoFillBuild.candidates.map(withBuilderActionFields), {
      includeCoverage: false,
      approachCandidates: (autoFillBuild.approachable ?? []).map(withBuilderActionFields),
    });
  // Auto-fill/fill-gap own every displayed/cycled recommendation. A second planner search against
  // the draft-projected context only populated the builder's unused fallback plan and cost over a
  // second on real actors. Reuse the authoritative full-turn list; projected candidates still
  // resolve draft warnings and Browse availability.
  const plans = autoFillPlans;
  panel._autoFillPreparationCache = {
    targetKey: autoFillTargetKey,
    contextKey: panel._turnIntentContextKey,
    baseBuild,
    autoFillBuild,
    autoFillPlans,
  };
  if (panel._pinnedPlanId && !autoFillPlans.some((candidatePlan) => candidatePlan?.id === panel._pinnedPlanId)) {
    panel._pinnedPlanId = null;
  }
  const plan = selectDisplayPlan(plans, panel._pinnedPlanId) ?? plans[0] ?? null;
  const favorites = readActionFavorites(context);

  panel._candidates = builderCandidates;
  panel._rejected = rejected;
  panel._detected = detected;
  panel._plans = plans;
  panel._autoFillPlans = autoFillPlans;
  panel._autoFillContext = autoFillContext;
  panel._loadoutAdvice = buildLoadoutAdvice(autoFillContext);
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
    showExcluded: panel._showExcludedActions === true,
  });
  const sustainedSpells = readSustainedSpellEntries(context, undefined, builderModel.draft);
  panel._effectClock = buildEffectClock(context, { draft: builderModel.draft, sustainedEntries: sustainedSpells });
  panel._movementOptions = actorMovementOptions(panel._actorForMovement(context));
  panel._weaponOptions = actorStrikeOptions(panel._actorForMovement(context), context);
  builderModel.draft = refreshDraftAreaPlacements(context, builderModel.draft);
  panel._builder = decorateBuilder(builderModel, panel.activeTab, panel.searchQuery, {
    sustainedSpells,
    awaitingGm: panel._awaitingGm,
    movementOptions: panel._movementOptions,
    weaponOptions: panel._weaponOptions,
  });
  panel._builder.readonly = panel._builder.readonly || (gmViewingPlayerPlan && !gmEditingOfflinePlayerPlan);

  return viewPanelContext(panel, context);
}
