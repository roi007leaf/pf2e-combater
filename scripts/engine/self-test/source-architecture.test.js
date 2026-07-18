import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confidenceLabel } from "../confidence.js";
import { fighterContext, fixtureCandidates } from "../fixtures.js";
import { actionBudget } from "../action/budget.js";
import { bestTurnPlan, buildTurnPlans } from "../planner.js";
import { swapDraftSteps } from "../draft-reorder.js";
import { swapFavorites } from "../favorite-reorder.js";
import { movementBudgetForStep, movementDestinationForStep, movementFootprintForToken, movementHorizontalBudgetForStep, movementOriginForContext, movementPlacementForCenter, movementPlanForDestination, movementPlanForWaypoints, movementRouteForStep, movementRouteSegmentCost, movementWaypointsForStep, reachableMovementCenters, waypointPathCost } from "../movement-route.js";
import {
  ACTION_BUILDER_TABS,
  actionBuilderKey,
  backingStrikeOverrideFields,
  builderAtomicActionsForStep,
  buildActionBuilderModel,
  computeAreaMarker,
  isUnreachableStrikeStep,
  projectContextForDraftDestination,
  projectContextForDraftStepOrigin,
} from "../action/builder/index.js";
import {
  isSelfCenteredAreaAction,
  isTargetCenteredAreaAction,
  requiresAreaMarkerForAction,
  requiresDestinationForAction,
  requiresTargetForAction,
} from "../action/requirements.js";
import { createAreaRegionData, tokensInAreaMarker } from "../area/region.js";
import { contextActorDocument } from "../actor-context.js";
import {
  currentTargetSelection,
  executeDraftStep,
  plannedTargetSelection,
  setTokenTargets,
} from "../action/executor.js";
import { executionReadinessForStep, nextPendingExecutionStep, resetDraftExecution } from "../execution/state.js";
import { revertDraftExecution, revertDraftStep } from "../action/revert.js";
import { pf2eTokenMovementActionForStep } from "../../rules/movement-cost.js";
import { movementFootprintCentersForToken } from "../../rules/token-geometry.js";
import {
  canvasAttackPathBlocked,
  canvasLinePathBlocked,
  canvasMovementPathBlocked,
  canvasTokenById,
  canReachPlacementPerimeter,
  gridReachDistanceFeet,
  isLockedDoorWall,
  rectangleDistanceFeet,
  wallBlocksLine,
  wallBlocksMovement,
  wallSegmentsBlockMovement,
} from "../../rules/canvas-geometry.js";
import {
  areaTimerExpired,
  buildAreaTimerEffectData,
  buildAreaTimerFlag,
  expiredAreaRegionsForScene,
  parseSpellDuration,
} from "../area/duration.js";
import { scoreCandidate } from "../scoring.js";
import { contextAllies, contextEnemies, contextTargets, firstContextTarget, selfTargetReference, targetReference } from "../target-pool.js";
import { buildCandidates } from "../candidates.js";
import { classifySystemAction } from "../action/classifier.js";
import { classifySpell } from "../spell/classifier.js";
import { actorStrikeOptions, backingStrikeFilterByPreset, bestReadyStrike, heldMeleeBackingStrikes, readActionCost, readActionSources } from "../../readers/action/reader.js";
import { readActorProfile, readEffects, actorMovementOptions } from "../../readers/actor-profile.js";
import { readConsumableSpellActions, readSpellActions } from "../../readers/spell-reader.js";
import {
  favoriteKey,
  readActionFavorites,
  reorderActionFavorite,
  toggleActionFavorite,
} from "../../state/action-favorites.js";
import { readCombatContext } from "../../state/combat-context.js";
import { documentRelevantToContext } from "../../state/context-relevance.js";
import {
  draftPlanKey,
  emptyDraftPlan,
  readDraftPlan,
  readSharedDraftPlan,
  sharedDraftPlanKey,
  writeDraftPlan,
  writeSharedDraftPlan,
  writeSharedDraftPlanActorFlag,
  isSharedDraftPlanEcho,
  writeSharedDraftPlanPayload,
  upsertDraftStep,
  removeDraftStep,
  moveDraftStep,
  draftListForInstance,
  hasSharedDraftPlan,
  shouldDisplaySharedDraft,
} from "../../state/draft-plans.js";
import * as draftPlanState from "../../state/draft-plans.js";
import { coveredClassSlugs } from "../../rules/class-tactics.js";
import { KNOWN_SUBCLASS_SLUGS } from "../../rules/class-tactics-data/index.js";
import { displayStepEntries } from "../../ui/display-steps.js";
import {
  captureMovementOrigin,
  consumeTokenRefreshChange,
  markMovementActionSpent,
  movementActionsSpent,
  tokenUpdateAffectsCombatGeometry,
  tokenUpdateAffectsMovement,
} from "../../state/token-refresh.js";
import { readVisionerCoverState, readVisionerDetectionState } from "../../integrations/visioner.js";
import { GENERIC_ACTIONS } from "../../catalog/generic-actions.js";
import { findCustomAction } from "../../catalog/custom-actions.js";
import { autoFillCyclePlans, bestAutoFillPlan, nextAutoFillPlan, previousAutoFillPlan, selectableAlternativePlans, selectDisplayPlan } from "../../ui/plan-selection.js";
import { clearActionPreview, showActionPreview } from "../../ui/action/preview.js";
import { clearHoverGhost, clearMovementPreview, movementPreviewForStep, recommendedMovementForStep, routeCornerWaypoints, showHoverGhost, showMovementPreview } from "../../ui/movement-preview.js";
import { cancelAreaPicker, chooseAreaMarker } from "../../ui/area-picker.js";
import { computeRangeRing, rangeLabelText, spellRangeFeet } from "../../ui/range-overlay.js";
import { cancelDestinationPicker, chooseDestination } from "../../ui/destination-picker.js";
import { builderActionCategory, groupActionsByBuilderCategory } from "../../ui/action/categories.js";
import { actionDetailChips, traitChips } from "../../ui/action/details.js";
import { battlefieldPressure, compareTacticalCenters, threatCountAtCenter } from "../../rules/battlefield-analysis.js";
import { aggroProfile, aggroTargetValue, canUseFullAggro } from "../../rules/aggro.js";
import { promptRetchDc, promptRetchResult } from "../../ui/retch-decision.js";
import { requestRetchDc, requestRetchResult, setSocket, shareDraftPlan } from "../../socket.js";
import {
  readSustainedSpellEntries,
  removeSustainedSpellEntries,
  unsustainedSpellCleanupEntries,
} from "../sustained-spells.js";
import { registerSettings, SETTINGS } from "../../settings.js";
import { STORAGE_KEYS } from "../../constants.js";
import { actorItems, entityKey, traitSlugs } from "../../foundry-data.js";

// The rendered UI spans two templates now: the plan-only panel and the detached browser
// window. Concatenate both so "the UI exposes X" assertions cover either window (the panel
// part comes first, so order-sensitive checks like "sustained renders before tabs" hold).
const panelTemplateSource = [
  readFileSync(new URL("../../../templates/combater-panel.hbs", import.meta.url), "utf8"),
  readFileSync(new URL("../../../templates/combater-browser.hbs", import.meta.url), "utf8"),
].join("\n");
const tacticWindowTemplateSource = readFileSync(new URL("../../../templates/tactic-window.hbs", import.meta.url), "utf8");
const intelWindowTemplateSource = readFileSync(new URL("../../../templates/intel-window.hbs", import.meta.url), "utf8");
const turnIntentTemplateSource = readFileSync(new URL("../../../templates/turn-intent-window.hbs", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../../ui/CombaterPanel.js", import.meta.url), "utf8");
const panelContextWorkflowSource = readFileSync(new URL("../../ui/panel/context-workflow.js", import.meta.url), "utf8");
const panelViewModelSource = readFileSync(new URL("../../ui/panel/view-model.js", import.meta.url), "utf8");
const panelAutoFillContextSource = readFileSync(new URL("../../ui/panel/auto-fill-context.js", import.meta.url), "utf8");
const browserSource = readFileSync(new URL("../../ui/CombaterBrowser.js", import.meta.url), "utf8");
const tacticWindowSource = readFileSync(new URL("../../ui/tactic-window.js", import.meta.url), "utf8");
const intelWindowSource = readFileSync(new URL("../../ui/intel-window.js", import.meta.url), "utf8");
const combatTrackerIntelSource = readFileSync(new URL("../../ui/combat-tracker-intel.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../../settings.js", import.meta.url), "utf8");
const foundryDataSource = readFileSync(new URL("../../foundry-data.js", import.meta.url), "utf8");
const pf2eRuntimeSource = readFileSync(new URL("../../runtime/pf2e-runtime.js", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../planner.js", import.meta.url), "utf8");
const plannerRulesSource = readFileSync(new URL("../planner/rules.js", import.meta.url), "utf8");
const plannerProjectionsSource = readFileSync(new URL("../planner/projections.js", import.meta.url), "utf8");
const plannerConflictsSource = readFileSync(new URL("../planner/conflicts.js", import.meta.url), "utf8");
const planStateSource = readFileSync(new URL("../plan-state.js", import.meta.url), "utf8");
const actionTextSource = readFileSync(new URL("../action/text.js", import.meta.url), "utf8");
const actionBudgetSource = readFileSync(new URL("../action/budget.js", import.meta.url), "utf8");
const actorContextSource = readFileSync(new URL("../actor-context.js", import.meta.url), "utf8");
const backingStrikeSource = readFileSync(new URL("../backing-strike.js", import.meta.url), "utf8");
const candidatesSource = readFileSync(new URL("../candidates.js", import.meta.url), "utf8");
const scoringSource = readFileSync(new URL("../scoring.js", import.meta.url), "utf8");
const recommendationSafetySource = readFileSync(new URL("../recommendation-safety.js", import.meta.url), "utf8");
const scoringTacticsSource = readFileSync(new URL("../scoring/tactics.js", import.meta.url), "utf8");
const scoringActivityTacticsSource = readFileSync(new URL("../scoring/activity-tactics.js", import.meta.url), "utf8");
const scoringRoleTacticsSource = readFileSync(new URL("../scoring/role-tactics.js", import.meta.url), "utf8");
assert.ok(
  scoringRoleTacticsSource.includes('aggro.roles.join(" -> ")'),
  "Aggro priority should render as ordered arrows instead of an unordered comma list",
);
const scoringTacticHelpersSource = readFileSync(new URL("../scoring/tactic-helpers.js", import.meta.url), "utf8");
const scoringAreaSource = readFileSync(new URL("../scoring/area.js", import.meta.url), "utf8");
const scoringFactsSource = readFileSync(new URL("../scoring/facts.js", import.meta.url), "utf8");
const scoringBuffsSource = readFileSync(new URL("../scoring/buffs.js", import.meta.url), "utf8");
const scoringGatesSource = readFileSync(new URL("../scoring/gates.js", import.meta.url), "utf8");
const scoringSkillsSource = readFileSync(new URL("../scoring/skills.js", import.meta.url), "utf8");
const scoringSpellsSource = readFileSync(new URL("../scoring/spells.js", import.meta.url), "utf8");
const scoringTargetsSource = readFileSync(new URL("../scoring/targets.js", import.meta.url), "utf8");
const aggroSource = readFileSync(new URL("../../rules/aggro.js", import.meta.url), "utf8");
const tacticPersonalitySource = readFileSync(new URL("../../rules/tactic-personality.js", import.meta.url), "utf8");
const intelLedgerSource = readFileSync(new URL("../../rules/intel-ledger.js", import.meta.url), "utf8");
const actorEligibilitySource = readFileSync(new URL("../../rules/actor-eligibility.js", import.meta.url), "utf8");
const minionPlannerSource = readFileSync(new URL("../../rules/minion-planner.js", import.meta.url), "utf8");
const actionBuilderSource = readFileSync(new URL("../action/builder/index.js", import.meta.url), "utf8");
const actionBuilderProjectionSource = readFileSync(new URL("../action/builder/projection.js", import.meta.url), "utf8");
const actionBuilderSharedSource = readFileSync(new URL("../action/builder/shared.js", import.meta.url), "utf8");
const actionBuilderAtomizeSource = readFileSync(new URL("../action/builder/atomize.js", import.meta.url), "utf8");
const actionBuilderMinionSource = readFileSync(new URL("../action/builder/minion.js", import.meta.url), "utf8");
const actionBuilderModelSource = readFileSync(new URL("../action/builder/model.js", import.meta.url), "utf8");
const actionExecutorSource = readFileSync(new URL("../action/executor.js", import.meta.url), "utf8");
const actionRevertSource = readFileSync(new URL("../action/revert.js", import.meta.url), "utf8");
const executionAreaSource = readFileSync(new URL("../execution/area.js", import.meta.url), "utf8");
const executionChatRevertSource = readFileSync(new URL("../execution/chat-revert.js", import.meta.url), "utf8");
const executionMovementSource = readFileSync(new URL("../execution/movement.js", import.meta.url), "utf8");
const executionConditionsSource = readFileSync(new URL("../execution/conditions.js", import.meta.url), "utf8");
const executionDamageSource = readFileSync(new URL("../execution/damage.js", import.meta.url), "utf8");
const executionEquipmentSource = readFileSync(new URL("../execution/equipment.js", import.meta.url), "utf8");
const equipmentItemsSource = readFileSync(new URL("../equipment-items.js", import.meta.url), "utf8");
const executionGuidanceSource = readFileSync(new URL("../execution/guidance.js", import.meta.url), "utf8");
const executionNativeItemSource = readFileSync(new URL("../execution/native-item.js", import.meta.url), "utf8");
const executionResultsSource = readFileSync(new URL("../execution/results.js", import.meta.url), "utf8");
const executionStateSource = readFileSync(new URL("../execution/state.js", import.meta.url), "utf8");
const executionSystemActionSource = readFileSync(new URL("../execution/system-action.js", import.meta.url), "utf8");
const executionStrikeSource = readFileSync(new URL("../execution/strike.js", import.meta.url), "utf8");
const executionSustainSource = readFileSync(new URL("../execution/sustain.js", import.meta.url), "utf8");
const executionTeleportSource = readFileSync(new URL("../execution/teleport.js", import.meta.url), "utf8");
const executionTargetsSource = readFileSync(new URL("../execution/targets.js", import.meta.url), "utf8");
const revertDocumentsSource = readFileSync(new URL("../revert/documents.js", import.meta.url), "utf8");
const revertItemResourcesSource = readFileSync(new URL("../revert/item-resources.js", import.meta.url), "utf8");
const revertMovementSource = readFileSync(new URL("../revert/movement.js", import.meta.url), "utf8");
const revertSpellSlotSource = readFileSync(new URL("../revert/spell-slot.js", import.meta.url), "utf8");
const actionRequirementsSource = readFileSync(new URL("../action/requirements.js", import.meta.url), "utf8");
const areaRegionSource = readFileSync(new URL("../area/region.js", import.meta.url), "utf8");
const sustainedSpellsSource = readFileSync(new URL("../sustained-spells.js", import.meta.url), "utf8");
const targetPoolSource = readFileSync(new URL("../target-pool.js", import.meta.url), "utf8");
const actionReaderSource = readFileSync(new URL("../../readers/action/reader.js", import.meta.url), "utf8");
const actionReaderHelpersSource = readFileSync(new URL("../../readers/action/reader-helpers.js", import.meta.url), "utf8");
const elementalBlastReaderSource = readFileSync(new URL("../../readers/elemental-blast-reader.js", import.meta.url), "utf8");
const defenseActionReaderSource = readFileSync(new URL("../../readers/defense-action-reader.js", import.meta.url), "utf8");
const genericActionReaderSource = readFileSync(new URL("../../readers/generic-action-reader.js", import.meta.url), "utf8");
const itemActionReaderSource = readFileSync(new URL("../../readers/item-action-reader.js", import.meta.url), "utf8");
const weaponActionReaderSource = readFileSync(new URL("../../readers/weapon-action-reader.js", import.meta.url), "utf8");
const swapActionReaderSource = readFileSync(new URL("../../readers/swap-action-reader.js", import.meta.url), "utf8");
const positionalTacticReaderSource = readFileSync(new URL("../../readers/positional/tactic-reader.js", import.meta.url), "utf8");
const positionalTacticHelpersSource = readFileSync(new URL("../../readers/positional/tactic-helpers.js", import.meta.url), "utf8");
const positionalStrideReaderSource = readFileSync(new URL("../../readers/positional/stride-reader.js", import.meta.url), "utf8");
const positionalRetreatReaderSource = readFileSync(new URL("../../readers/positional/retreat-reader.js", import.meta.url), "utf8");
const positionalFlankReaderSource = readFileSync(new URL("../../readers/positional/flank-reader.js", import.meta.url), "utf8");
const positionalKiteReaderSource = readFileSync(new URL("../../readers/positional/kite-reader.js", import.meta.url), "utf8");
const positionalTacticFamilySource = [
  positionalTacticHelpersSource,
  positionalStrideReaderSource,
  positionalRetreatReaderSource,
  positionalFlankReaderSource,
  positionalKiteReaderSource,
].join("\n");
const actionReachSource = readFileSync(new URL("../../readers/action/reach.js", import.meta.url), "utf8");
const spellReaderSource = readFileSync(new URL("../../readers/spell-reader.js", import.meta.url), "utf8");
const actorProfileSource = readFileSync(new URL("../../readers/actor-profile.js", import.meta.url), "utf8");
const battlefieldAnalysisSource = readFileSync(new URL("../../rules/battlefield-analysis.js", import.meta.url), "utf8");
const canvasGeometrySource = readFileSync(new URL("../../rules/canvas-geometry.js", import.meta.url), "utf8");
const movementCostSource = readFileSync(new URL("../../rules/movement-cost.js", import.meta.url), "utf8");
const combatStateSource = readFileSync(new URL("../../rules/combat-state.js", import.meta.url), "utf8");
const combatContextSource = readFileSync(new URL("../../state/combat-context.js", import.meta.url), "utf8");
const panelStyleSource = readFileSync(new URL("../../../styles/combater.css", import.meta.url), "utf8");
const areaPickerSource = readFileSync(new URL("../../ui/area-picker.js", import.meta.url), "utf8");
const destinationPickerSource = readFileSync(new URL("../../ui/destination-picker.js", import.meta.url), "utf8");
const movementPreviewSource = readFileSync(new URL("../../ui/movement-preview.js", import.meta.url), "utf8");
const actionPreviewSource = readFileSync(new URL("../../ui/action/preview.js", import.meta.url), "utf8");
const rangeOverlaySource = readFileSync(new URL("../../ui/range-overlay.js", import.meta.url), "utf8");
const panelDraftHelpersSource = readFileSync(new URL("../../ui/panel/draft-helpers.js", import.meta.url), "utf8");
const panelDraftWorkflowSource = readFileSync(new URL("../../ui/panel/draft-workflow.js", import.meta.url), "utf8");
const panelPickerWorkflowSource = readFileSync(new URL("../../ui/panel/picker-workflow.js", import.meta.url), "utf8");
const panelExecutionWorkflowSource = readFileSync(new URL("../../ui/panel/execution-workflow.js", import.meta.url), "utf8");
const panelEventBindingsSource = readFileSync(new URL("../../ui/panel/event-bindings.js", import.meta.url), "utf8");

// Architecture and source-boundary assertions split out of the main runtime self-test.
assert.ok(panelSource.includes("./panel/view-model.js"), "panel should import its display view-model module");
assert.ok(panelViewModelSource.includes("function actionGlyphIcon"), "panel action costs should map to PF2e action-cost icons");
assert.ok(panelTemplateSource.includes("combater-cost-glyph"), "panel template should render PF2e action-cost icon images");
assert.ok(panelViewModelSource.includes("icons/actions/OneAction.webp"), "panel view-model should reference the PF2e action-cost icon set");
assert.ok(panelTemplateSource.includes("combater-chip-img") && panelTemplateSource.includes("combater-action-img"), "panel should show item images beside action names");
assert.ok(panelContextWorkflowSource.includes("tacticPersonalityView"), "panel context should expose resolved tactic personality view data");
assert.ok(panelTemplateSource.includes("data-configure-tactic"), "panel template should render the Auto-fill tactic chip");
assert.ok(panelContextWorkflowSource.includes("panelIntelLedgerView") && panelContextWorkflowSource.includes("activeNpcIntelTarget")
  && panelContextWorkflowSource.includes("return intelLedgerView(context)"),
  "panel context should expose GM active-NPC Intel editing and player readonly revealed enemy Intel");
assert.ok(panelContextWorkflowSource.includes("isPlayerControlledActor") && panelContextWorkflowSource.includes("isGM: false"),
  "GM-selected player tokens should open player-facing Known Intel instead of the GM NPC reveal editor");
assert.ok(panelTemplateSource.includes("data-configure-intel"), "panel template should render the Recall Knowledge intel chip");
assert.ok(panelEventBindingsSource.includes("data-configure-intel") && panelEventBindingsSource.includes("_configureIntelLedger"),
  "panel bindings should open Recall Knowledge intel config from the header chip");
assert.ok(panelSource.includes("INTEL_LEDGER_FLAG") && panelSource.includes("setFlag(MODULE_ID, INTEL_LEDGER_FLAG"),
  "panel should persist Recall Knowledge intel on target actors");
assert.ok(panelSource.includes("INTEL_REVEAL_MODE_FLAG") && panelSource.includes("setFlag(MODULE_ID, INTEL_REVEAL_MODE_FLAG")
  && intelWindowTemplateSource.includes("data-intel-reveal-mode"),
  "GM Recall Knowledge editor should persist exact-vs-band reveal style per NPC");
assert.ok(panelSource.includes("openIntelWindow") && panelSource.includes("_saveIntelLedger"),
  "panel should let players inspect revealed Recall Knowledge facts without write controls");
assert.ok(intelWindowSource.includes("ApplicationV2") && intelWindowTemplateSource.includes("combater-intel-shell")
  && !intelWindowSource.includes("DialogV2"),
  "player-visible Recall Knowledge facts should share a reusable styled Intel window");
assert.ok(intelWindowSource.includes("resolveIntelWindowView") && intelWindowSource.includes("renderCombatTracker")
  && intelWindowSource.includes("updateToken") && panelSource.includes("viewProvider")
  && panelSource.includes('readCombatContext("intel-window"') && combatTrackerIntelSource.includes("combatantIntelViewById"),
  "open Known Intel windows should refresh from current combat context and combat tracker rows while they stay open");
assert.ok(mainSource.includes("registerCombatTrackerIntel") && mainSource.includes("actorUpdateChangesIntelLedger"),
  "main should wire player combat tracker Intel and refresh it when GM revealed data changes");
assert.ok(combatTrackerIntelSource.includes("renderCombatTracker") && combatTrackerIntelSource.includes("data-combatant-id")
  && combatTrackerIntelSource.includes("openIntelWindow") && combatTrackerIntelSource.includes("playerAccessAllowed"),
  "players should be able to open revealed NPC Recall Knowledge facts from combat tracker rows");
assert.ok(combatContextSource.includes("combatant?.playersCanSeeName") && combatContextSource.includes("COMBATANT.Unknown")
  && combatTrackerIntelSource.includes("combatantDisplayName") && combatTrackerIntelSource.includes("rowCombatantName")
  && combatTrackerIntelSource.includes("playersCanSeeName") && intelLedgerSource.includes("displayName"),
  "player-visible Recall Knowledge windows should follow combat tracker/token display names instead of leaking actor names");
assert.ok(panelViewModelSource.includes("canOpenTargetIntel") && panelTemplateSource.includes("data-open-target-intel"),
  "Combater panel target labels should expose target-specific Recall Knowledge data affordances");
assert.ok(panelEventBindingsSource.includes("data-open-target-intel") && panelEventBindingsSource.includes("_openTargetIntel"),
  "target Intel labels should open known target data without triggering parent action clicks");
assert.ok(panelSource.includes("_openTargetIntel") && panelSource.includes("intelTargetMatchesKey"),
  "panel should resolve clicked target labels to current battlefield targets before opening Known Intel");
assert.ok(panelTemplateSource.includes("combater-header-tactic-label"),
  "tactic chip should wrap its label in a dedicated span for constrained overflow");
assert.ok(panelEventBindingsSource.includes("data-configure-tactic") && panelEventBindingsSource.includes("_configureTacticPersonality"),
  "panel bindings should open tactic personality config from the header chip");
assert.ok(panelSource.includes("openTacticWindow") && panelSource.includes("_applyTacticPersonalityDecision"),
  "tactic configuration should use the styled tactic window and keep panel persistence in one callback");
assert.ok(
  /combater-header-tactic\s*\{[\s\S]*?min-height:\s*28px;/.test(panelStyleSource)
    && /combater-header-tactic-label\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/.test(panelStyleSource),
  "tactic chip should match header button height and truncate long Auto labels",
);
assert.ok(panelSource.includes("TACTIC_PERSONALITY_FLAG") && panelSource.includes("TACTIC_PERSONALITY_OVERRIDE_FLAG"),
  "panel should write actor default and token override tactic flags");
assert.ok(tacticWindowSource.includes("ApplicationV2") && tacticWindowTemplateSource.includes('name="customEnabled"')
  && tacticWindowTemplateSource.includes("data-custom-sliders") && tacticWindowTemplateSource.includes("{{#if showAdvanced}}")
  && tacticWindowSource.includes("showAdvanced") && !tacticWindowSource.includes("DialogV2"),
  "tactic window should hide NPC-only temperament/custom sliders behind advanced mode");
assert.ok(panelStyleSource.includes(".combater-tactic-editor:not(.is-custom)") && panelStyleSource.includes(".combater-tactic-custom-fields"),
  "tactic window CSS should show slider fields only when Customize is checked");
assert.ok(panelSource.includes("unsetFlag(MODULE_ID, TACTIC_PERSONALITY_OVERRIDE_FLAG"),
  "panel should support resetting the token tactic override");
assert.ok(combatContextSource.includes("documentName: document.documentName") && combatContextSource.includes("document,"),
  "combat context token summary should retain the TokenDocument so token tactic override flags can resolve");
assert.ok(scoringFactsSource.includes("canUseIntelCategory") && intelLedgerSource.includes("INTEL_LEDGER_FLAG"),
  "hidden defenses should be gated by Recall Knowledge intel categories");
assert.ok(combatContextSource.includes("readIntelLedger") && combatContextSource.includes("intelLedger"),
  "combat context should expose actor-saved Recall Knowledge intel to players without exposing the Actor document");
assert.ok(intelLedgerSource.includes("revealedIntelDetails") && intelLedgerSource.includes("hasPlayerVisibleIntel"),
  "intel ledger view should include revealed fact details and become visible to players with known data");
assert.ok(intelLedgerSource.includes("availableIntelDetails") && intelWindowSource.includes("entry.available")
  && panelStyleSource.includes(".combater-intel-shell.is-editable .combater-intel-entry"),
  "GM Recall Knowledge editor should show available system data in a compact edit layout before reveal");
assert.ok(intelWindowSource.includes("categoryColumns")
  && intelWindowTemplateSource.includes("combater-intel-category-column")
  && panelStyleSource.includes(".combater-intel-category-column")
  && panelStyleSource.includes("flex-direction: column")
  && panelStyleSource.includes("align-self: stretch"),
  "GM Recall Knowledge category cards should use independent vertical stacks without grid-row gaps");
assert.ok(panelStyleSource.includes("--color-pf-text-critical-success")
  && panelStyleSource.includes("--color-pf-text-success")
  && panelStyleSource.includes("--color-pf-text-failure")
  && panelStyleSource.includes("--color-pf-text-critical-failure")
  && panelStyleSource.includes("color-mix(in srgb, var(--rk-success)"),
  "Recall Knowledge degree colors should inherit PF2e system colors with translucent row washes");
assert.ok(panelStyleSource.includes("--rk-success-ink: color-mix(in srgb, var(--rk-success) 46%, white)")
  && panelStyleSource.includes("--rk-success-wash: color-mix(in srgb, var(--rk-success) 8%, rgb(255 255 255 / 10%))")
  && panelStyleSource.includes("color: var(--rk-success-ink)"),
  "Recall Knowledge success styling should adapt PF2e blue for readable dark adjudication surfaces");
assert.ok(panelStyleSource.includes("--color-proficiency-untrained")
  && panelStyleSource.includes("--color-proficiency-trained")
  && panelStyleSource.includes("--color-proficiency-expert")
  && panelStyleSource.includes("--color-proficiency-master")
  && panelStyleSource.includes("--color-proficiency-legendary")
  && panelStyleSource.includes("td.rank-4"),
  "Recall Knowledge proficiency labels should inherit every PF2e system rank color");
assert.ok(intelWindowSource.includes("_syncIntelEditorState") && intelWindowTemplateSource.includes("data-intel-category")
  && intelWindowTemplateSource.includes("data-intel-status"),
  "GM Recall Knowledge editor should update category card state immediately when reveal checkboxes change");
assert.ok(intelWindowSource.includes("_revealAll")
  && intelWindowTemplateSource.includes("data-intel-reveal-all")
  && panelStyleSource.includes(".combater-intel-reveal-all"),
  "GM Recall Knowledge editor should offer a per-NPC reveal-all control for every fact chip");
assert.ok(intelWindowSource.includes("_toggleCategory")
  && intelWindowTemplateSource.includes("data-intel-reveal-category")
  && intelWindowTemplateSource.includes("class=\"combater-intel-category-mark\"")
  && intelWindowTemplateSource.includes("{{markIcon}}")
  && panelStyleSource.includes(".combater-intel-category-mark:hover"),
  "GM Recall Knowledge category marker should toggle every fact and show partial state");
assert.ok(
  intelWindowTemplateSource.includes("data-intel-false-fact")
    && intelWindowTemplateSource.includes("data-intel-false-value")
    && intelWindowTemplateSource.includes("data-intel-remove-false")
    && intelWindowSource.includes("CONFIG?.PF2E?.[mapName]"),
  "GM false Intel should use structured PF2e choices, numeric values, and an explicit delete control",
);
assert.ok(
  /\.combater-intel-false-record\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 20px;/.test(panelStyleSource)
    && /\.combater-intel-false-list\s*\{[\s\S]*?flex-wrap:\s*wrap;/.test(panelStyleSource)
    && /\.combater-intel-false-record\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/.test(panelStyleSource)
    && /\.combater-intel-false-record\.has-value\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 20px;/.test(panelStyleSource)
    && /\.combater-intel-false-value\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*2;/.test(panelStyleSource)
    && intelWindowTemplateSource.includes('type="text" inputmode="numeric" pattern="[0-9]*"')
    && /\.combater-intel-false-value \[data-intel-false-value\]\s*\{[\s\S]*?display:\s*block;[\s\S]*?width:\s*58px;[\s\S]*?max-width:\s*58px;/.test(panelStyleSource)
    && intelWindowTemplateSource.includes("{{#if ../falseHasValue}}")
    && intelWindowTemplateSource.includes("combater-intel-false-value"),
  "false Intel controls should render as compact wrapping chips instead of full-width form cards",
);
assert.ok(
  /combater-intel-false-section-head[\s\S]*?data-intel-add-false[\s\S]*?<\/header>/.test(intelWindowTemplateSource)
    && /\.combater-intel-false-section\s*\{[\s\S]*?border-top:/.test(panelStyleSource)
    && intelWindowTemplateSource.includes("combater-intel-false-list"),
  "each Intel category should separate false facts under one labeled subsection with its own add control",
);
assert.ok(
  /\.combater-intel-false-record select\s*\{[\s\S]*?color-scheme:\s*dark;/.test(panelStyleSource)
    && /\.combater-intel-false-record select option\s*\{[\s\S]*?background:\s*#181b20;[\s\S]*?color:\s*#f0eee8;/.test(panelStyleSource),
  "false Intel PF2e selectors should keep native option popups dark and readable",
);
assert.ok(
  panelStyleSource.includes('.combater-intel-category input[type="checkbox"]')
    && !panelStyleSource.includes(".combater-intel-category input {"),
  "Intel checkbox hiding must not disable false-information text fields",
);
assert.ok(
  intelWindowTemplateSource.includes("is-false-information")
    && /\.combater-intel-revealed-section li\.is-false-information\s*\{/.test(panelStyleSource)
    && intelLedgerSource.includes("viewerIsGM ? { falseInformation }"),
  "GM player-perspective Intel should identify false facts without exposing markers to players",
);
assert.ok(
  intelWindowTemplateSource.includes("data-intel-toggle-false")
    && intelWindowSource.includes("falseInformationRevealCategory")
    && intelWindowSource.includes('dataset.intelFalseRevealed === "true"')
    && intelLedgerSource.includes("record.revealed === true"),
  "prepared false Intel should become player-visible only through critical-failure activation",
);
assert.ok(
  combatContextSource.includes("readIntelFalseInformation")
    && combatContextSource.includes("intelFalseInformation,"),
  "player-safe battlefield summaries should carry false Intel so players receive it as ordinary revealed facts",
);
assert.ok(intelLedgerSource.includes("intelTargets") && intelLedgerSource.includes("actorDefense"),
  "intel ledger view should support combat-tracker actor rows without a full Combater panel context");
assert.ok(intelLedgerSource.includes("isNpcIntelTarget") && panelViewModelSource.includes("isNpcIntelTarget")
  && combatTrackerIntelSource.includes("isNpcIntelTarget"),
  "Recall Knowledge intel affordances should be restricted to NPC targets, not player characters on NPC turns");
assert.ok(scoringSource.includes("playerIntelCategories") && recommendationSafetySource.includes("PLAYER_INTEL_REASON_PATTERNS"),
  "player-visible learned intel reasons should be allowed only for known Recall Knowledge categories");
assert.ok(intelLedgerSource.includes("canUseIntelFact") && scoringFactsSource.includes("canUseTargetSave")
  && scoringTargetsSource.includes("canUseTargetSave(context, target, defenseSlug)")
  && scoringTargetsSource.includes("actionSkillDcSlug(action)")
  && scoringSource.includes("actionSkillDcSlug"),
  "player scoring should use revealed save intel for DC math without enabling unrelated hidden defenses");
assert.ok(intelLedgerSource.includes('id: "perception"') && intelLedgerSource.includes("function perceptionFacts")
  && combatContextSource.includes('target, "perception", "perception"')
  && scoringFactsSource.includes('saveSlug === "perception" ? "perception" : "saves"'),
  "Perception should be a separate Recall Knowledge category from Fortitude/Reflex/Will saves");
assert.ok(intelLedgerSource.includes("SAVE_MODERATE_DCS_BY_LEVEL") && intelLedgerSource.includes("intelSaveBand")
  && combatContextSource.includes("intelSaveBands") && scoringFactsSource.includes("targetDcLabel"),
  "banded Recall Knowledge reveal style should hide exact NPC numbers while keeping player scoring usable");
assert.ok(intelLedgerSource.includes("canSeeExactIntelLabels") && intelWindowSource.includes("label.dataset.exactLabel"),
  "GM Intel windows should render exact numbers even when the saved player reveal style is banded");
assert.ok(intelWindowTemplateSource.includes("data-intel-fact") && intelWindowSource.includes("availableFacts")
  && combatContextSource.includes("readKnownDefense") && combatContextSource.includes("intelDefenseFactId"),
  "Recall Knowledge intel should reveal individual facts, not entire hidden categories");
assert.ok(scoringTacticsSource.includes("planMinionSubturn") && minionPlannerSource.includes("export function planMinionSubturn"),
  "Command an Animal should build a nested minion subturn plan");
assert.ok(genericActionReaderSource.includes("genericActionVariants") && genericActionReaderSource.includes("minionActionBudget: 2")
  && minionPlannerSource.includes("function minionActionBudget") && !scoringTacticsSource.includes("action.actionCost ?? action.activityProfile?.commandActionCost"),
  "Command an Animal for minions should stay one owner action and grant the minion's two-action turn");
assert.ok(scoringSource.includes("minionPlan") && panelViewModelSource.includes("decorateMinionPlan")
  && panelTemplateSource.includes("combater-minion-subturn") && panelDraftWorkflowSource.includes("activityProfile: { minionPlan"),
  "minion subturn plans should flow through Auto-fill draft steps into visible nested panel chips");
assert.ok(minionPlannerSource.includes("actionOptions")
  && minionPlannerSource.includes("movementOptions")
  && panelTemplateSource.includes("combater-minion-action-row")
  && panelTemplateSource.includes("data-cycle-minion-step")
  && panelTemplateSource.includes("data-cycle-minion-movement")
  && panelTemplateSource.includes("data-choose-minion-target")
  && panelTemplateSource.includes("data-choose-minion-destination")
  && panelTemplateSource.includes("data-preview-minion-step")
  && panelTemplateSource.includes("data-execute-minion-step")
  && panelTemplateSource.includes("data-revert-minion-step")
  && panelTemplateSource.includes("data-remove-minion-step")
  && panelEventBindingsSource.includes("_cycleMinionPlanStep")
  && panelEventBindingsSource.includes("_cycleMinionPlanMovement")
  && panelEventBindingsSource.includes("_chooseMinionTarget")
  && panelEventBindingsSource.includes("_chooseMinionDestination")
  && panelEventBindingsSource.includes("_showMinionActionPreview")
  && panelEventBindingsSource.includes("_executeMinionPlanStep")
  && panelEventBindingsSource.includes("_revertMinionPlanStep")
  && panelEventBindingsSource.includes("_removeMinionPlanStep")
  && panelEventBindingsSource.includes("activateMinionPlanStepBindings")
  && panelEventBindingsSource.includes("capture: true")
  && panelEventBindingsSource.includes("stopImmediatePropagation")
  && panelDraftWorkflowSource.includes("export function choosePanelMinionDestination")
  && panelDraftWorkflowSource.includes("export function minionPlanStepPreview")
  && panelDraftWorkflowSource.includes("export function showPanelMinionActionPreview")
  && panelDraftWorkflowSource.includes("export async function choosePanelMinionTarget")
  && panelDraftWorkflowSource.includes("export async function executePanelMinionPlanStep")
  && panelDraftWorkflowSource.includes("export async function cyclePanelMinionPlanMovement")
  && panelDraftWorkflowSource.includes("export async function revertPanelMinionPlanStep")
  && panelDraftWorkflowSource.includes("export async function removePanelMinionPlanStep")
  && panelDraftWorkflowSource.includes("export function cycleMinionPlanStep"),
  "Command an Animal sub-actions should render as indented editable child actions with target, destination, play, and revert controls");
assert.ok(combatContextSource.includes("isFamiliarActor")
  && combatContextSource.includes("familiarMasterIds")
  && combatContextSource.includes("isCompanionActor")
  && combatContextSource.includes("isEidolonActor")
  && combatContextSource.includes("!tokenInCombat(encounterCombat, token)")
  && combatContextSource.includes('actorType(actor) !== "character"'),
  "Command an Animal companion detection should follow PF2e familiar master links and character minion companion actors while excluding eidolons and ordinary NPC animals");
assert.ok(actionReachSource.includes("cost: Number(center.cost)") && scoringActivityTacticsSource.includes("Terrain-aware route costs"),
  "reachable movement routes should preserve terrain costs for activity scoring");
assert.ok(mainSource.includes("tacticPersonalityOverride") && mainSource.includes("tactic-update"),
  "token tactic override flag updates should refresh the active panel without requiring token geometry changes");
assert.equal(panelSource.includes("\u00e2"), false, "panel source should not contain mojibake");
assert.ok(panelSource.includes("setCombatant(combatant"), "panel should expose explicit combatant selection");
assert.ok(
  actorEligibilitySource.includes('new Set(["hazard", "loot"])')
    && combatContextSource.includes("!isPlannableActor(actor)")
    && panelSource.includes("!isPlannableCombatant(options.combatant)")
    && mainSource.includes("isPlannableCombatant(combatant)"),
  "hazards and loot must be rejected by shared actor-context, automatic-selection, and panel-open gates",
);
assert.ok(panelContextWorkflowSource.includes("combatant: panel._selectedCombatant"), "panel context should use selected explicit combatant");
assert.ok(panelSource.includes("this._onClose = typeof options.onClose === \"function\""), "panel should accept close callback");
assert.ok(panelSource.includes("this._onClose?.(this);"), "panel close should notify owner");
assert.ok(panelViewModelSource.includes("Quickened actions"), "panel view-model should render a quickened-only action shelf");
assert.ok(panelViewModelSource.includes("Range increment {value} ft"), "a range-increment weapon should get a distinct label from a flat max range");
assert.ok(panelViewModelSource.includes("display.isRanged"), "hasStepDetails should show the details row for a ranged step even with no target/area/traits");
assert.equal(
  panelTemplateSource.split('{{#if isRanged}}<span class="combater-detail-chip is-range">').length - 1,
  2,
  "both the draft-step chip and the auto-fill preview chip should render a visible range badge",
);
assert.ok(panelStyleSource.includes(".combater-detail-chip.is-range"), "the range badge should have its own styling, not blend in as plain muted text");
assert.ok(
  panelContextWorkflowSource.includes('from "./draft-helpers.js"')
    && panelSource.includes('from "./panel/draft-workflow.js"'),
  "panel context/draft workflows should use panel draft helpers for projected draft actions and Auto-fill movement guards",
);
assert.ok(
  panelDraftHelpersSource.includes("export function projectedDraftStepActions")
    && panelDraftHelpersSource.includes("export function findProjectedDraftAction")
    && panelDraftHelpersSource.includes("export function draftStepId")
    && panelDraftHelpersSource.includes("export function strideImprovesPosition")
    && panelDraftHelpersSource.includes("export function isBasicAutoFillMove"),
  "panel draft helpers should own projected draft lookup, draft ids, and Auto-fill movement guards",
);
for (const pattern of [
  "isRedundantAutoFillMove",
  "autoFillAppliesProne",
  "autoFillTargetCenter",
  "strideImprovesPosition",
  "autoFillStrideOverSpeed",
  "strideStepTowardPlannedTarget",
  "findProjectedDraftAction",
  "projectedDraftStepActions",
  "draftStepId",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(panelSource),
    false,
    `panel should not own draft helper ${pattern}`,
  );
}
assert.ok(
  panelSource.includes('from "./panel/draft-workflow.js"'),
  "panel should use panel draft workflow for draft mutations, favorites, Auto-fill, and player-plan sync",
);
assert.ok(
  panelDraftWorkflowSource.includes("export async function addPanelAction")
    && panelDraftWorkflowSource.includes("export async function autoFillPanelDraft")
    && panelDraftWorkflowSource.includes("export async function syncPanelDraftToGM")
    && panelDraftWorkflowSource.includes("export function atomizePanelAutoFillSteps"),
  "panel draft workflow should own manual adds/removes, Auto-fill assembly, and GM sync",
);
for (const pattern of [
  "writeSharedDraftPlanActorFlag",
  "shareDraftPlan",
  "recommendedMovementForStep",
  "bestAutoFillPlan",
  "plannedTargetSelection",
  "swapDraftSteps",
]) {
  assert.equal(
    panelSource.includes(pattern),
    false,
    `panel should not own draft workflow dependency ${pattern}`,
  );
}
assert.ok(
  panelSource.includes('from "./panel/picker-workflow.js"'),
  "panel should use panel picker workflow for destination, target, and area choices",
);
assert.ok(
  panelPickerWorkflowSource.includes("export function choosePanelDestination")
    && panelPickerWorkflowSource.includes("export async function choosePanelTarget")
    && panelPickerWorkflowSource.includes("export async function choosePanelArea")
    && panelPickerWorkflowSource.includes("export async function removePanelAreaTemplate"),
  "panel picker workflow should own destination picking, target capture, area picking, and area-template removal",
);
assert.ok(
  panelEventBindingsSource.includes("useBestTarget: event.shiftKey")
    && panelPickerWorkflowSource.includes("plannedTargetSelection")
    && panelPickerWorkflowSource.includes('targetSelection: useBestTarget ? "recommended" : "manual"'),
  "Shift-clicking target selection should commit the scored Best target while normal click keeps the current Foundry target",
);
for (const pattern of [
  "chooseDestination({",
  "chooseAreaMarker({",
  "currentTargetSelection",
  "tokensInAreaMarker",
  "projectContextForDraftStepOrigin",
]) {
  assert.equal(
    panelSource.includes(pattern),
    false,
    `panel should not own picker workflow dependency ${pattern}`,
  );
}
assert.ok(
  panelSource.includes('from "./panel/execution-workflow.js"'),
  "panel should use panel execution workflow for draft execution and revert",
);
assert.ok(
  panelExecutionWorkflowSource.includes("export async function executePanelDraftStep")
    && panelExecutionWorkflowSource.includes("export async function providePanelRetchDc")
    && panelExecutionWorkflowSource.includes("export async function revertPanelDraftStep")
    && panelExecutionWorkflowSource.includes("export async function resetPanelExecution"),
  "panel execution workflow should own execution, Retch adjudication, per-step revert, and reset",
);
for (const pattern of [
  "executeDraftStep({",
  "executionReadinessForStep",
  "revertDraftExecution",
  "revertDraftStep({",
  "promptRetchDc",
  "requestRetchDc",
  "requestRetchResult",
]) {
  assert.equal(
    panelSource.includes(pattern),
    false,
    `panel should not own execution workflow dependency ${pattern}`,
  );
}
assert.ok(
  panelSource.includes('from "./panel/event-bindings.js"'),
  "panel should use panel event bindings for DOM listener setup",
);
assert.ok(
  panelEventBindingsSource.includes("export function activatePanelRenderBindings")
    && panelEventBindingsSource.includes("function activateDraftDragBindings")
    && panelEventBindingsSource.includes("data-cycle-auto-fill")
    && panelEventBindingsSource.includes("forceFull: event.shiftKey")
    && panelEventBindingsSource.includes("data-preview-draft-step"),
  "panel event bindings should own render-time DOM listeners, drag reorder wiring, auto-fill Shift replacement, cycling, and preview hover wiring",
);
for (const pattern of [
  "[data-add-sustain-spell]",
  "[data-remove-draft-step]",
  "[data-drag-list]",
  "[data-cycle-auto-fill]",
  "[data-preview-draft-step]",
]) {
  assert.equal(
    panelSource.includes(pattern),
    false,
    `panel should not own render DOM binding selector ${pattern}`,
  );
}
assert.ok(
  panelSource.includes('from "./panel/context-workflow.js"'),
  "panel should use panel context workflow for combat-context and view-model preparation",
);
assert.ok(
  panelContextWorkflowSource.includes("export function preparePanelContext")
    && panelContextWorkflowSource.includes("export function viewPanelContext")
    && panelContextWorkflowSource.includes("function isPlayerControlledActor")
    && panelContextWorkflowSource.includes("readSharedDraftPlan(context)")
    && panelContextWorkflowSource.includes("decorateBuilder"),
  "panel context workflow should own combat context read, shared-player draft mode, builder model prep, and render context shaping",
);
for (const pattern of [
  "readSharedDraftPlan(context)",
  "isPlayerControlledActor",
  "headerSteps: groupDraftSteps",
  "decorateBuilder",
  "readSustainedSpellEntries",
  "actorMovementOptions",
  "actorStrikeOptions",
]) {
  assert.equal(
    panelSource.includes(pattern),
    false,
    `panel should not own context workflow detail ${pattern}`,
  );
}
assert.ok(mainSource.includes("handlePanelClosed(panel)"), "main should clear active panel through close callback");
assert.ok(mainSource.includes("onClose: handlePanelClosed"), "main should pass close callback when opening panel");
assert.ok(mainSource.includes("let autoOpenSuppressed = false;"), "main should track manual auto-open suppression");
assert.ok(
  /async function closeActivePanel\([\s\S]*autoOpenSuppressed = true;/.test(mainSource),
  "token-tool close should suppress automatic reopen on combatant changes",
);
assert.ok(
  /if \(toggled\) \{[\s\S]*autoOpenSuppressed = false;[\s\S]*await openSelectedOrCurrent\("token-tool"\);/.test(mainSource),
  "token-tool open should clear automatic reopen suppression",
);
assert.ok(
  /Hooks\.on\("updateCombat"[\s\S]*if \(autoOpenSuppressed && !activePanel\) return;/.test(mainSource),
  "combat-turn auto-open should stay closed after token-tool toggle off",
);
assert.equal(
  mainSource.includes("if (!setting(SETTINGS.autoOpen)) return;\r\n  await openCurrent(\"combat-turn\")")
  || mainSource.includes("if (!setting(SETTINGS.autoOpen)) return;\n  await openCurrent(\"combat-turn\")"),
  false,
  "combat-turn refresh should not be skipped while panel is already open and autoOpen is false",
);
assert.ok(
  /Hooks\.on\("controlToken"[\s\S]*?selectCombatant[\s\S]*?scheduleRefresh/.test(mainSource),
  "panel should follow the selected token (GM and players) via the controlToken hook, deferring the rebuild to the debounce",
);
assert.ok(
  /Hooks\.on\("updateActor", \(actor, changes\) => \{[\s\S]*?isSharedDraftPlanEcho\(changes\)[\s\S]*?"shared-draft-sync"[\s\S]*?"actor-update"/.test(mainSource),
  "updateActor should route a player's own shared-draft echo to a refresh source that does not reset the pinned Auto-fill plan",
);
assert.ok(
  /Hooks\.on\("updateActor"[\s\S]*?consumeSharedDraftPlanRefreshSuppression\(actor\)[\s\S]*?return/.test(mainSource),
  "panel-owned shared-draft writes should consume their local updateActor echo instead of rebuilding twice",
);
assert.ok(mainSource.includes("clearEndedTurnDraft"), "a combatant's execution plan should be cleared when its turn ends");
assert.ok(
  /Hooks\.on\("deleteCombat"[\s\S]*?clearCombatDraftPlans\(combat\)/.test(mainSource),
  "deleting a combat should clear all of its lingering draft plans",
);
assert.ok(
  /Hooks\.on\("deleteCombat"[\s\S]*?resetTurnIntent\(combat\)/.test(mainSource)
    && /Hooks\.on\("updateCombat"[\s\S]*?if \(!combat\.started\) \{[\s\S]*?resetTurnIntent\(combat\)/.test(mainSource),
  "ending or deleting an encounter should clear locked turn-intent decisions",
);
assert.equal(
  turnIntentTemplateSource.match(/data-turn-intent-lock=/g)?.length,
  5,
  "each turn-intent checkbox should have its own between-turn lock button",
);
assert.equal(
  turnIntentTemplateSource.includes('name="lockDecisions"'),
  false,
  "turn intent should not use one master lock checkbox",
);
// Ending a turn must reset BOTH the acting player's local plan and the GM-visible shared plan.
assert.ok(
  /function clearEndedTurnDraft\([\s\S]*?clearDraftPlan\(context\)[\s\S]*?clearSharedDraftPlan\(context\)/.test(mainSource),
  "ending a turn should clear both the local (player) and shared (GM-visible) draft plans",
);
// The clear runs before the auto-open early-return, so a closed panel still resets on turn end.
assert.ok(
  /Hooks\.on\("updateCombat"[\s\S]*?clearEndedTurnDraft\(combat\);[\s\S]*?if \(!setting\(SETTINGS\.autoOpen\) && !activePanel\) return;/.test(mainSource),
  "turn-end draft clear should run regardless of whether a panel is open",
);
assert.ok(
  /if \(activePanel\) \{[\s\S]*?refresh\("combat-turn"\)/.test(mainSource),
  "on turn change an open panel should refresh in place (follow selected token) rather than jump to the active combatant",
);
assert.ok(panelTemplateSource.includes("builder.tabsList"), "panel template should render builder tabs");
assert.ok(panelTemplateSource.includes("data-tab=\"{{id}}\""), "panel template should expose builder tab switches");
assert.equal(panelTemplateSource.includes("data-tab=\"search\""), false, "search should not be a standalone tab");
assert.equal(panelTemplateSource.includes("{{#if isSearch}}"), false, "search input should render inside each cost tab, not a search-only tab");
assert.ok(panelTemplateSource.includes("data-search-actions"), "each action-cost tab should expose an action-search input");
assert.equal(panelSource.includes("SEARCH_TAB"), false, "panel source should not define a standalone Search tab");
assert.ok(panelViewModelSource.includes("filterBuilderTabActions"), "panel view-model should filter actions inside each active tab");
// Search matches the title only — not row prose. "reach" must not match "...in reach." copy.
const searchHaystackBody = panelViewModelSource.match(/function actionSearchHaystack\([\s\S]*?\n}/)?.[0] ?? "";
assert.ok(searchHaystackBody.includes("action?.name"), "action search should match the action title");
for (const prose of ["disabledReason", "reason", "targetLabel", "costLabel"]) {
  assert.equal(searchHaystackBody.includes(prose), false,
    `action search should not match row prose (${prose}), only the title`);
}
assert.ok(panelViewModelSource.includes("groupActionsByBuilderCategory"), "panel view-model should group tab actions into combat categories");
assert.ok(panelViewModelSource.includes("actionDetailChips"), "panel view-model should decorate spell/action detail chips");
assert.ok(panelTemplateSource.includes("combater-detail-chips"), "panel template should render action detail chips");
const searchSetterBody = panelSource.match(/_setSearchQuery\(query,\s+input\s+=\s+null\)\s*\{([\s\S]*?)\n\s{2}\}/)?.[1] ?? "";
assert.ok(searchSetterBody, "search setter should accept the active input element");
assert.equal(searchSetterBody.includes("this.render"), false, "typing in search should not synchronously re-render and steal focus");
assert.ok(searchSetterBody.includes("_scheduleSearchRender"), "typing in search should debounce the filtered rerender");
assert.ok(panelSource.includes("_restoreSearchFocus"), "search rerenders should restore input focus and caret");
assert.deepEqual(
  groupActionsByBuilderCategory([
    { name: "Strike", source: "strike" },
    { name: "Stride", slug: "stride", role: "mobility" },
    { name: "Raise a Shield", slug: "raise-a-shield", role: "defense" },
    { name: "Demoralize", skill: "intimidation", role: "debuff" },
    { name: "Force Barrage", source: "spell-prepared", activityProfile: { spell: true } },
    { name: "Quick Bomber", source: "custom-curated", category: "classfeature" },
    { name: "Potion", item: { type: "consumable" } },
  ]).map((section) => ({ id: section.id, actions: section.actions.map((action) => action.name) })),
  [
    { id: "attacks", actions: ["Strike"] },
    { id: "movement", actions: ["Stride"] },
    { id: "defense", actions: ["Raise a Shield"] },
    { id: "skills", actions: ["Demoralize"] },
    { id: "spells", actions: ["Force Barrage"] },
    { id: "items", actions: ["Potion"] },
    { id: "class", actions: ["Quick Bomber"] },
  ],
  "builder tab actions should group into stable combat categories",
);
assert.deepEqual(
  groupActionsByBuilderCategory([
    { name: "Strike", source: "strike" },
    { name: "Stand", slug: "stand", role: "mobility", traits: ["move"], requiresProne: true, activityProfile: { includes: ["move"], removesCondition: "prone" } },
    { name: "Retch", slug: "retch", role: "recovery", requiresSickened: true, activityProfile: { reducesCondition: "sickened" } },
    { name: "Escape", slug: "escape", role: "defense", attackTrait: true, requiresGrabbedOrRestrained: true },
  ]).map((section) => ({ id: section.id, actions: section.actions.map((action) => action.name) })),
  [
    { id: "situational", actions: ["Stand", "Retch", "Escape"] },
    { id: "attacks", actions: ["Strike"] },
  ],
  "self-condition remedies should group under Situational, ranked above the other combat categories",
);
// A move-and-strike that Stands first is still an attack, not a Situational remedy.
assert.equal(
  builderActionCategory({
    name: "Stand -> Stride -> Claw",
    slug: "stand-stride-strike-claw",
    role: "mobility-attack",
    attackTrait: true,
    activityProfile: { includes: ["stand", "stride", "strike"], includesStrike: true, removesCondition: "prone" },
  }).id,
  "attacks",
  "a Stand-first move-and-strike composite should stay under Attacks",
);
// Situational is condition-gated: when prone, Stand/Crawl (condition met, even over budget) show,
// but Retch/Escape (condition unmet -> available:false) are dropped entirely, not shown disabled.
assert.deepEqual(
  groupActionsByBuilderCategory([
    { name: "Stand", slug: "stand", role: "mobility", traits: ["move"], available: true, overBudget: true, requiresProne: true, activityProfile: { includes: ["move"], removesCondition: "prone" } },
    { name: "Crawl", slug: "crawl", role: "mobility", traits: ["move"], available: true, requiresProne: true, activityProfile: { includes: ["move", "crawl"] } },
    { name: "Retch", slug: "retch", role: "recovery", available: false, requiresSickened: true, activityProfile: { reducesCondition: "sickened" } },
    { name: "Escape", slug: "escape", role: "defense", attackTrait: true, available: false, requiresGrabbedOrRestrained: true },
  ]).map((section) => ({ id: section.id, actions: section.actions.map((action) => action.name) })),
  [{ id: "situational", actions: ["Stand", "Crawl"] }],
  "Situational should drop condition-unmet remedies but keep condition-met ones that are only over budget",
);
assert.deepEqual(
  actionDetailChips({
    name: "Fireball",
    source: "spell-inferred",
    rank: 3,
    spellResource: { label: "Slots 2/4", tooltip: "Rank 3 spell slots: 2/4 left." },
    spellcastingEntryLabel: "Arcane Spontaneous",
    spellDc: 21,
    saveProfile: { stat: "reflex", basic: true },
    targetingProfile: { area: true, type: "burst", distance: 20, maxRange: 500 },
    activityProfile: { spell: true, duration: "1 minute", sustained: true },
    traits: ["incapacitation", "manipulate"],
  }).map((chip) => chip.label),
  ["Rank 3", "Slots 2/4", "Arcane Spontaneous", "DC 21 Reflex basic", "20-ft Burst", "Sustain", "Incapacitation", "Manipulate"],
  "spell action detail chips should show rank, resource, entry, resolution, area, duration, and notable traits",
);
assert.deepEqual(
  actionDetailChips({
    name: "Demoralize",
    source: "generic",
    suggestedTarget: { type: "enemy", id: "ogre", name: "Ogre" },
  }).map(({ label, tooltip, class: className }) => ({ label, tooltip, class: className })),
  [{
    label: "Best target: Ogre",
    tooltip: "Ogre is this action's highest-ranked target.",
    class: "is-best-target",
  }],
  "action detail chips should name the scored best combatant target",
);
const bestTargetReasonChip = actionDetailChips({
    name: "Frostbite",
    source: "spell-inferred",
    suggestedTarget: { type: "enemy", id: "isqulug", name: "Isqulug" },
    bestTargetReasons: ["Isqulug has cold weakness 10."],
  })[0];
assert.equal(bestTargetReasonChip?.tooltip, "Isqulug is this action's highest-ranked target. Why: Isqulug has cold weakness 10.");
assert.equal(
  bestTargetReasonChip?.tooltipHtml,
  "<p>Isqulug is this action&#39;s highest-ranked target.</p><strong>Why:</strong><ul><li>Isqulug has cold weakness 10.</li></ul>",
  "Best target tooltip should use native rich-tooltip list markup",
);
assert.ok(
  (panelTemplateSource.match(/data-tooltip-html="\{\{tooltipHtml\}\}"/gu) ?? []).length === 3,
  "Best target rich tooltip should reach plan and Browse chips",
);
const dropProneWithStaleTarget = {
  name: "Drop Prone",
  slug: "drop-prone",
  role: "defense",
  suggestedTarget: { type: "enemy", id: "wraith", name: "War Wraith" },
};
assert.equal(
  requiresTargetForAction(dropProneWithStaleTarget),
  false,
  "Drop Prone should stay targetless even when stale recommendation metadata contains an enemy",
);
assert.deepEqual(
  actionDetailChips(dropProneWithStaleTarget),
  [],
  "self-only Drop Prone should not render a Best target chip",
);
assert.deepEqual(
  traitChips({ name: "Arm", traits: ["agile", "reach-10", { slug: "magical" }] }).map((chip) => chip.label),
  ["Agile", "Reach 10", "Magical"],
  "traitChips should localize every trait on a non-spell action, not just a notable subset",
);
assert.deepEqual(
  traitChips({ name: "Longsword", item: { system: { traits: { value: ["finesse", "versatile-p"] } } } }).map((chip) => chip.label),
  ["Finesse", "Versatile P"],
  "traitChips should fall back to the item's own raw trait slugs when the action has no traits array",
);
assert.deepEqual(traitChips({ name: "Nothing" }), [], "an action with no traits at all should produce no chips");
assert.deepEqual(
  traitChips({ name: "Hurled Thorn", traits: ["attack"], attackEffects: ["grab", "knockdown"] }).map((chip) => chip.label),
  ["Attack", "Grab", "Knockdown"],
  "traitChips should include a strike's Additional Attack Effects alongside its real PF2e traits",
);
assert.deepEqual(
  traitChips({ name: "Deduped", traits: ["agile"], item: { system: { traits: { value: ["agile"] } } } }).map((chip) => chip.label),
  ["Agile"],
  "a trait present in both action.traits and the item's raw traits should not be duplicated",
);
assert.ok(panelTemplateSource.includes("combater-sustained-spells"), "panel template should expose sustained spell choices");
assert.ok(
  panelTemplateSource.indexOf("combater-sustained-spells") < panelTemplateSource.indexOf("combater-tabs"),
  "sustained spell section should render above action-cost tabs",
);
assert.ok(panelTemplateSource.includes("data-add-sustain-spell"), "sustained spell section should add a chosen Sustain a Spell step");
assert.ok(
  panelTemplateSource.includes('data-open-sustained-spell="{{spellUuid}}"')
    && panelEventBindingsSource.includes("[data-open-sustained-spell]")
    && panelEventBindingsSource.includes("_openSustainedSpellDetails")
    && panelSource.includes("async _openSustainedSpellDetails")
    && panelSource.includes("return renderSheetFromUuid(uuid)"),
  "clicking a sustained spell name should open that spell document",
);
assert.ok(panelSource.includes("_chooseSustainedSpellForStep"), "generic Sustain a Spell execution should ask which spell to sustain");
// Draft steps are tagged with their multiple-attack-penalty position so strikes roll the right MAP
// variant; uncounted attacks continue the plan's running attack count.
assert.ok(panelViewModelSource.includes("injectMapInfo"), "draft steps should be tagged with their multiple-attack-penalty position");
assert.ok(/injectMapInfo\(rawUncounted, planMap\.attackCount\)/.test(panelViewModelSource), "uncounted attacks should continue the plan's MAP count");
// Players can pin a strike's MAP level per attack (some abilities keep MAP flat across attacks).
assert.ok(panelSource.includes("_cycleStepMap"), "the panel should let the player cycle a strike's MAP level");
assert.ok(/mapOverride/.test(panelDraftWorkflowSource), "a pinned MAP override should feed the per-strike MAP");
assert.ok(panelTemplateSource.includes("data-cycle-map"), "the panel template should expose a MAP cycle control on strikes");
assert.ok(panelViewModelSource.includes("mapAppliesPerStrike"), "abilities whose rules text applies MAP normally per strike (e.g. Twin Takedown, Flurry of Blows) must be able to opt out of Double Attack's shared-tier group scan");
assert.ok(/groupId\s*&&\s*!perStrikeMap/.test(panelViewModelSource), "the shared-tier forward scan for a grouped composite's siblings must be skipped when mapAppliesPerStrike is set, so each atom gets its own escalating MAP tier instead of one shared tier");
// Players can pick which speed a Stride travels on (fly/burrow/swim/climb) when the actor has one.
assert.ok(panelSource.includes("_cycleStepMovement"), "the panel should let the player cycle a Stride's movement type");
assert.ok(/movementAction/.test(panelDraftWorkflowSource), "a pinned movement type should ride on the draft step");
assert.ok(panelTemplateSource.includes("data-cycle-movement"), "the panel template should expose a movement-type control on Strides");
assert.ok(panelSource.includes("_cycleStepRoute"), "the panel should let the player cycle a Stride's tactical route");
assert.ok(panelTemplateSource.includes("data-cycle-route"), "the panel template should expose a tactical-route control on Strides");
assert.ok(panelSource.includes("_cycleStepDestination"), "the panel should let the player cycle ranked Stride destinations");
assert.ok(panelTemplateSource.includes("data-cycle-destination"), "the panel template should expose a recommended-destination control on Strides");
assert.ok(
  panelDraftWorkflowSource.includes("recommendedMovementOptionsForStep")
    && panelDraftWorkflowSource.includes("movementAlternatives")
    && panelViewModelSource.includes("movementAlternativeToolLabel"),
  "Auto-fill should store three ranked Stride landings and expose their current position",
);
{
  const workflowLines = panelDraftWorkflowSource.split(/\r?\n/);
  const redundantSyncs = [];
  for (let index = 0; index < workflowLines.length; index += 1) {
    if (!workflowLines[index].includes("_persistActiveDraftStep(")) continue;
    let end = index;
    while (end < workflowLines.length && !workflowLines[end].trimEnd().endsWith(");")) end += 1;
    const nextLine = workflowLines.slice(end + 1).find((line) => line.trim().length > 0) ?? "";
    if (nextLine.includes("_syncDraftToGM()")) redundantSyncs.push(index + 1);
  }
  assert.deepEqual(redundantSyncs, [], "draft controls should not sync again after _persistActiveDraftStep already synced");
}
// actorMovementOptions enumerates the actor's Stride speeds: walking first, then only the non-walking
// speeds the actor actually has, mapping the "land" speed key to the "walk" movement action.
{
  const flier = actorMovementOptions({
    system: {
      movement: {
        speeds: {
          land: { total: 25 }, fly: { total: 60 }, burrow: { total: 0 }, swim: null, travel: { total: 25 },
        }
      }
    },
  });
  assert.deepEqual(flier.map((option) => option.action), ["walk", "fly"], "only walking and the actor's real fly speed should be offered");
  assert.equal(flier[0].speed, 25, "walking option should carry the land speed");
  assert.equal(flier[1].speed, 60, "fly option should carry the fly speed");
  const minionFlier = actorMovementOptions({
    movement: { speeds: { land: { value: 25 }, fly: { value: 25 } } },
  });
  assert.deepEqual(minionFlier.map((option) => option.action), ["walk", "fly"], "minion actor movement facade should offer land and fly speeds");
  assert.equal(minionFlier[1].speed, 25, "minion actor movement facade should read fly.value");
  const grounded = actorMovementOptions({ system: { attributes: { speed: { value: 30 } } } });
  assert.deepEqual(grounded.map((option) => option.action), ["walk"], "an actor with only a land speed offers no movement-type choice");
}
// Retch is the GM's call in two phases: the GM sets the DC, the player rolls, then the GM sets the
// result. A player routes the DC ask via requestRetchDc and the result ask via requestRetchResult,
// only prompting locally as a GM or when no GM is connected.
assert.ok(
  /providePanelRetchDc\([\s\S]*game\?\.user\?\.isGM === true[\s\S]*requestRetchDc\(/.test(panelExecutionWorkflowSource),
  "a player's Retch DC should be asked of the GM, not decided by the player",
);
assert.ok(
  /confirmPanelRetchResult\([\s\S]*game\?\.user\?\.isGM === true[\s\S]*requestRetchResult\(/.test(panelExecutionWorkflowSource),
  "a player's Retch result should be ruled by the GM after the roll",
);
assert.ok(
  /socketlib\.ready[\s\S]*registerModule[\s\S]*socket\.register\("promptRetchDc"/.test(mainSource),
  "main should register Retch adjudication handlers with socketlib",
);
assert.ok(mainSource.includes("promptUnsustainedSpellCleanup"), "turn changes should prompt cleanup for unsustained spells");
for (const oldTabId of ["plan", "alternatives", "debug"]) {
  assert.equal(panelTemplateSource.includes(`data-tab="${oldTabId}"`), false, `panel template should not expose old ${oldTabId} tab`);
}
for (const eventHook of [
  "data-add-action",
  "data-remove-draft-step",
  "data-drag-draft-step",
  "data-favorite-action",
  "data-auto-fill",
  "data-cycle-auto-fill",
  "data-choose-destination",
  "data-choose-target",
  "data-choose-area",
  "data-remove-area",
  "data-execute-draft-step",
  "data-reset-execution",
  "data-revert-step",
]) {
  assert.ok(panelTemplateSource.includes(eventHook), `panel template should expose ${eventHook}`);
}
assert.equal(panelTemplateSource.includes("data-execute-next"), false, "panel should not expose a global Execute next button");
assert.ok(panelContextWorkflowSource.includes("projectedDraftStepActions"), "draft steps should resolve actions from their projected origin");
assert.deepEqual(
  swapDraftSteps(
    [{ instanceId: "a" }, { instanceId: "b" }, { instanceId: "c" }, { instanceId: "d" }],
    "a", "c",
  ).map((step) => step.instanceId),
  ["c", "b", "a", "d"],
  "dropping a step on another should swap their positions",
);
assert.deepEqual(
  swapDraftSteps(
    [{ instanceId: "a" }, { instanceId: "b" }, { instanceId: "c" }, { instanceId: "d" }],
    "d", "b",
  ).map((step) => step.instanceId),
  ["a", "d", "c", "b"],
  "swapping should work symmetrically regardless of which side is later in the list",
);
assert.deepEqual(
  swapDraftSteps(
    [
      { instanceId: "t" },
      { instanceId: "g1a", groupId: "g1" },
      { instanceId: "g1b", groupId: "g1" },
      { instanceId: "u" },
    ],
    "t", "g1b",
  ).map((step) => step.instanceId),
  ["g1a", "g1b", "t", "u"],
  "dropping onto any atom of a group should swap with the whole group as one block",
);
assert.deepEqual(
  swapDraftSteps(
    [
      { instanceId: "t" },
      { instanceId: "g1a", groupId: "g1" },
      { instanceId: "g1b", groupId: "g1" },
      { instanceId: "u" },
    ],
    "g1a", "t",
  ).map((step) => step.instanceId),
  ["g1a", "g1b", "t", "u"],
  "dragging one atom of a group should swap the whole group as one block, same result regardless of drag direction",
);
const swapNoOpList = [{ instanceId: "a" }, { instanceId: "b" }];
assert.equal(
  swapDraftSteps(swapNoOpList, "a", "a"),
  swapNoOpList,
  "dropping a step onto itself should be a no-op",
);
const swapGroupNoOpList = [{ instanceId: "g1a", groupId: "g1" }, { instanceId: "g1b", groupId: "g1" }];
assert.equal(
  swapDraftSteps(swapGroupNoOpList, "g1a", "g1b"),
  swapGroupNoOpList,
  "dropping a step onto a member of its own group should be a no-op",
);
assert.deepEqual(swapFavorites(["a", "b", "c", "d"], "a", "c"), ["c", "b", "a", "d"], "swapping two favorites should trade their positions");
assert.deepEqual(swapFavorites(["a", "b", "c", "d"], "d", "b"), ["a", "d", "c", "b"], "swap should work symmetrically regardless of which side is later in the list");
const favoriteSwapNoOpList = ["a", "b"];
assert.equal(swapFavorites(favoriteSwapNoOpList, "a", "a"), favoriteSwapNoOpList, "dropping a favorite onto itself should be a no-op");
assert.equal(swapFavorites(favoriteSwapNoOpList, "a", "missing"), favoriteSwapNoOpList, "swapping with an unknown target should be a no-op");
assert.equal(swapFavorites(favoriteSwapNoOpList, "missing", "a"), favoriteSwapNoOpList, "swapping an unknown key should be a no-op");
assert.ok(panelSource.includes("_reorderDraftStep"), "panel should support drag-to-reorder");
assert.ok(panelDraftWorkflowSource.includes("import { swapDraftSteps }"), "panel draft workflow should reuse the pure swap helper for drag-and-drop");
assert.ok(
  /reorderPanelDraftStep\(panel, instanceId, targetInstanceId[\s\S]*?draftListForInstance\(draft, instanceId\)[\s\S]*?draftListForInstance\(draft, targetInstanceId\)/.test(panelDraftWorkflowSource),
  "drag-and-drop reorder should stay confined to the same list (steps vs uncounted), matching the old up/down buttons",
);
assert.equal(panelSource.includes("_moveDraftStep"), false, "the up/down reorder method should be fully replaced by drag-and-drop, not left dead");
assert.equal(panelTemplateSource.includes("data-move-draft-step"), false, "up/down reorder buttons should be replaced by the drag handle");
assert.equal(panelStyleSource.includes("combater-step-move"), false, "the dead up/down button styling should be removed along with the buttons");
assert.ok(panelTemplateSource.includes("data-drag-draft-step"), "each draggable step should expose a drag handle");
assert.ok(panelTemplateSource.includes("data-drag-row"), "each step/group row should be a valid drop target");
assert.ok(panelTemplateSource.includes("data-drag-list"), "each reorderable list should mark its drag/drop container");
assert.ok(panelViewModelSource.includes("canDragStep"), "decorated steps should expose whether they can be dragged");
assert.ok(panelStyleSource.includes(".combater-step-drag"), "the drag handle should have its own styling");
assert.ok(panelStyleSource.includes(".is-dragging"), "dragged rows should get a visual dragging state");
assert.ok(panelStyleSource.includes(".drop-target"), "drop targets should show a visual indicator");
assert.ok(panelSource.includes("_cycleAutoFillDraft"), "panel should cycle through auto-fill alternative plans");
assert.ok(panelEventBindingsSource.includes("contextmenu"), "shuffle right-click should cycle backward instead of opening the browser menu");
assert.ok(
  panelAutoFillContextSource.includes("export function contextWithCurrentAutoFillTargets")
    && panelContextWorkflowSource.includes("const autoFillContext = contextWithCurrentAutoFillTargets(intentContext")
    && panelContextWorkflowSource.includes("buildTurnPlans(autoFillContext")
    && panelSource.includes("contextWithCurrentAutoFillTargets(intentContext")
    && /cyclePanelAutoFillDraft\(panel[\s\S]*?const plans = panel\._activeAutoFillPlans\(\)[\s\S]*?preparedPlans: plans/.test(panelDraftWorkflowSource),
  "render, shuffle, and fill-gap Auto-fill plan lists should share selected-target focusing so the shuffle counter does not jump between broad and target-scoped cycles",
);
assert.equal(
  panelTemplateSource.includes("data-load-shared-draft"),
  false,
  "auto-updating player plans should not expose a redundant Load plan button",
);
assert.equal(
  /data-add-action="\{\{key\}\}"[^>]*\{\{#if disabled\}\}disabled\{\{\/if\}\}/.test(panelTemplateSource),
  false,
  "builder plus buttons should stay clickable for warned actions",
);
assert.equal(
  /_addAction\(actionKey\)[\s\S]*if \(!this\._context \|\| !action \|\| action\.disabled\)/.test(panelSource),
  false,
  "adding an action should not reject advisory warnings",
);
assert.equal(
  panelSource.includes("canLoadSharedDraft"),
  false,
  "panel model should not carry manual player-plan loading state",
);
assert.equal(panelSource.includes("Execute next"), false, "panel should not expose Execute next state");
assert.ok(panelSource.includes("_executeDraftStep(instanceId"), "panel should execute an explicit draft step by id");
assert.ok(panelTemplateSource.includes("data-reset-execution"), "panel should expose execution reset");
// --- Uncounted actions: template (Task 5) ---
assert.ok(panelTemplateSource.includes("builder.uncounted.hasEntries"), "template should gate the uncounted card");
assert.ok(panelTemplateSource.includes("combater-uncounted"), "template should render an uncounted card");
assert.ok(panelTemplateSource.includes("PF2E_COMBATER.Panel.UncountedActions"), "uncounted card should carry its (localized) title");
assert.ok(/data-add-uncounted="\{\{key\}\}"/.test(panelTemplateSource), "each action row should have a second add button for the uncounted list");
assert.ok(panelExecutionWorkflowSource.includes("executeDraftStep"), "panel execution workflow should use action executor instead of advisory-only execution");
assert.ok(panelViewModelSource.includes("nextPendingExecutionStep"), "panel view-model should find next executable draft step");
assert.ok(panelExecutionWorkflowSource.includes("revertDraftExecution"), "panel execution workflow reset should revert executed steps, not only clear status");
assert.ok(panelExecutionWorkflowSource.includes("revertDraftStep"), "panel execution workflow should revert an individual executed step");
// --- Uncounted actions: panel decoration (Task 4) ---
assert.ok(panelViewModelSource.includes("uncounted: {"), "decorateBuilder should expose a builder.uncounted view-model");
// --- Uncounted actions: panel handlers (Task 6) ---
assert.ok(panelDraftWorkflowSource.includes("draftListForInstance"), "panel draft workflow should resolve a step's list before persisting");
assert.ok(panelSource.includes("_addUncountedAction"), "panel should have an uncounted add handler");
assert.ok(browserSource.includes("data-add-uncounted"), "browser should wire the second (uncounted) add button");
// The action browser is a separate window that routes every mutation back through the panel.
assert.ok(browserSource.includes("combater-browser.hbs"), "browser window should render the browser template");
assert.ok(browserSource.includes("panel._addAction") && browserSource.includes("panel._addUncountedAction"),
  "browser add buttons should route through the panel");
assert.ok(browserSource.includes("panel._setActiveTab") && browserSource.includes("panel._setSearchQuery"),
  "browser tab/search should drive the panel view state");
assert.ok(panelSource.includes("browserViewContext"), "panel should expose its builder model to the browser");
assert.ok(panelSource.includes("_toggleBrowser") && panelSource.includes("_onBrowserClosed"),
  "panel should own the browser open/close lifecycle");
// Tabs + search live in a pinned header so they stay visible while the action list scrolls.
const browserTemplateSource = readFileSync(new URL("../../../templates/combater-browser.hbs", import.meta.url), "utf8");
assert.ok(
  browserTemplateSource.indexOf("combater-browser-header") < browserTemplateSource.indexOf("combater-body"),
  "tabs and search should sit in a header above the scrolling action body",
);
assert.ok(
  browserTemplateSource.indexOf("data-search-actions") < browserTemplateSource.indexOf("combater-body"),
  "the search input should live in the pinned header, not inside the scroll body",
);
assert.ok(panelStyleSource.includes(".combater-browser-header"), "the browser header should be styled as a pinned region");
// Window depth must be a box-shadow on the shell, never a `filter` on the window root: a filter
// re-composites over Foundry's live canvas every frame and lags the canvas while the window is open.
assert.equal(panelStyleSource.includes("filter: drop-shadow"), false,
  "the combater window must not use a filter (re-composites over the live canvas every frame)");
assert.ok(/\.combater-shell\s*\{[\s\S]*?box-shadow:/.test(panelStyleSource),
  "window depth should come from a cheap box-shadow on the shell");
// Re-renders (every search keystroke) rebuild the DOM; the list must not jump back to the top.
assert.ok(browserSource.includes("body.scrollTop = this._scrollTop"),
  "browser should restore the action list scroll offset across re-renders");
// Each cost tab already groups by action cost, so the glyph belongs on the tab header, not on
// every row. The tab carries the glyph; the action rows no longer repeat it.
assert.ok(browserTemplateSource.includes("combater-tab-glyph"),
  "the cost tab header should show the action-cost glyph");
assert.equal(browserTemplateSource.includes("combater-step-cost"), false,
  "browser action rows should not repeat the per-row cost glyph");
assert.ok(panelViewModelSource.includes("mergedSearchResults"), "decorateBuilder should expose merged cross-tab search results");
assert.ok(
  /mergedSearchResults = decoratedTabsList\.flatMap/.test(panelViewModelSource),
  "merged search results should be derived from the already-decorated per-tab list, not a separate filter pass",
);
assert.ok(
  /mergedSearchResults[\s\S]*?filter\(\(section\) => section\.hasActions\)/.test(panelViewModelSource),
  "merged search results should only include sections that actually matched",
);
assert.ok(browserTemplateSource.includes("builder.mergedSearchResults"), "browser template should render merged cross-tab results while searching");
assert.ok(
  /\{\{#if builder\.searchQuery\}\}[\s\S]*?builder\.mergedSearchResults[\s\S]*?\{\{else\}\}[\s\S]*?builder\.tabsList/.test(browserTemplateSource),
  "browser should fall back to the per-tab view when the search box is empty",
);
assert.ok(browserTemplateSource.includes("combater-section-tag"), "each merged result should show which tab it came from");
assert.ok(
  /data-tab="\{\{id\}\}" class="\{\{#if active\}\}active\{\{\/if\}\}" \{\{#if searchQuery\}\}disabled\{\{\/if\}\}/.test(browserTemplateSource),
  "tabs should be inert while a cross-tab search is active",
);
assert.ok(panelStyleSource.includes(".combater-tabs button:disabled"), "inert tabs should read as visually disabled");
assert.ok(panelStyleSource.includes(".combater-section-tag"), "the per-result tab tag should have its own styling");
assert.ok(browserTemplateSource.includes('{{#*inline "actionRows"}}'), "action row markup should be a shared partial, not duplicated between the merged and per-tab views");
assert.ok(panelViewModelSource.includes("canDragFavorite"), "favorites should expose whether they can be dragged");
assert.ok(panelViewModelSource.includes("isFavoritesSection"), "the favorites section should be identifiable in the template");
assert.ok(panelSource.includes("_reorderFavorite"), "panel should support drag-to-reorder for favorites");
assert.ok(panelDraftWorkflowSource.includes("import { reorderActionFavorite }") || panelDraftWorkflowSource.includes("reorderActionFavorite,"),
  "panel draft workflow should reuse the persistence-layer reorder helper");
assert.ok(browserTemplateSource.includes("data-drag-favorite"), "each draggable favorite should expose a drag handle");
assert.ok(browserTemplateSource.includes("data-drag-list"), "the favorites container should mark itself as a drag/drop list");
assert.ok(
  /isFavoritesSection[\s\S]*?data-drag-list/.test(browserTemplateSource) || /data-drag-list[\s\S]*?isFavoritesSection/.test(browserTemplateSource),
  "only the favorites section's container should be a drag/drop list",
);
assert.ok(browserSource.includes("panel._reorderFavorite"), "browser drag wiring should call into the panel");
assert.ok(browserSource.includes("data-drag-favorite"), "browser should wire dragstart on the favorite drag handle");
assert.ok(panelStyleSource.includes(".combater-action-row.is-dragging") || /\.combater-action-row\.is-dragging|combater-action-row,[\s\S]{0,80}is-dragging/.test(panelStyleSource),
  "dragged favorite rows should get the shared dragging visual state");
assert.ok(/async close\([\s\S]*this\._browser\?\.close\(\)/.test(panelSource), "closing the panel should close the browser");
assert.ok(panelSource.includes("_findActiveStep"), "panel should look up steps across both lists");
assert.ok(panelSource.includes('from "./panel/picker-workflow.js"'), "panel should delegate picker workflow to the panel picker workflow module");
assert.ok(panelPickerWorkflowSource.includes("currentTargetSelection"), "picker workflow should use Foundry's current target selection");
assert.ok(panelPickerWorkflowSource.includes("chooseAreaMarker"), "picker workflow should allow runtime AOE change");
assert.ok(
  /async refresh\([\s\S]*?if \(this\._areaPicker \|\| this\._destinationPicker\)[\s\S]*?return;/.test(panelSource),
  "refresh must not cancel an in-progress area or destination picker, or the canvas grid/region tools drop mid-selection",
);
assert.ok(areaPickerSource.includes("chooseAreaMarker"), "area picker should export chooseAreaMarker");
assert.ok(panelSource.includes("showActionPreview"), "plan hover should preview movement, target, or area choices");
assert.ok(panelSource.includes("clearActionPreview"), "plan hover cleanup should clear all action preview overlays");
assert.ok(panelPickerWorkflowSource.includes("export async function pickAreaTemplate"), "picker workflow should let the user pick which template to place");
assert.ok(panelPickerWorkflowSource.includes("targetingProfile?.templates"), "picker workflow should read the parsed multi-template list");
assert.ok(panelPickerWorkflowSource.includes("export async function choosePanelRecommendedArea"), "picker workflow should apply a scored recommended area placement");
assert.ok(panelEventBindingsSource.includes("data-choose-recommended-area"), "panel events should bind the recommended-area chooser");
assert.ok(panelTemplateSource.includes("data-choose-recommended-area"), "area steps should expose the recommended-area chooser");
assert.ok(panelViewModelSource.includes("recommendedAreaPlacementView"), "panel view model should label the active recommended placement");
assert.ok(panelSource.includes("_removeAreaTemplate"), "panel should let the user remove a placed template");
assert.ok(panelTemplateSource.includes("hasAreaMarker"), "remove-template button should only show when a template is set");
assert.ok(actionPreviewSource.includes("plannedTargetTokens"), "action preview should resolve planned target tokens");
assert.ok(actionPreviewSource.includes("drawAreaPreview"), "action preview should draw planned area markers");
assert.equal(
  panelTemplateSource.includes("data-share-draft"),
  false,
  "player plans should auto-sync instead of requiring a manual Share button",
);
assert.equal(
  (panelTemplateSource.match(/data-auto-fill/g) ?? []).length,
  1,
  "panel template should expose one top-level Auto-fill button only",
);
assert.equal(
  panelTemplateSource.includes("combater-auto-fill"),
  false,
  "panel template should not render an Auto-fill card in every tab",
);
assert.ok(panelTemplateSource.includes("builder.poolSummary"), "panel template should show action count in shared header");
assert.ok(panelTemplateSource.includes("builder.totalSummary"), "panel template should keep total action tooltip in shared header");
assert.ok(panelTemplateSource.includes("builder.reactionSummary"), "panel template should keep reaction tooltip in shared header");
assert.ok(panelTemplateSource.includes("combater-meta-row"), "panel header should separate status badges from actor name");
assert.ok(panelTemplateSource.includes("combater-identity"), "panel header should group portrait and actor status as identity");
assert.ok(panelTemplateSource.includes("combater-plan-strip"), "panel header should give selected actions a dedicated plan strip");
assert.ok(panelTemplateSource.includes("combater-step-main"), "selected action rows should separate action title from metadata");
assert.ok(panelTemplateSource.includes("combater-step-details"), "selected action rows should group target and destination metadata");
assert.ok(panelTemplateSource.includes("combater-step-tools"), "selected action tool buttons should stay inside the row");
assert.ok(
  /grid-template-areas:\s*"identity"\s*"actions"\s*"plan"/.test(panelStyleSource),
  "panel header should stack identity, controls, and selected actions so toolbar chips never hide actor status",
);
assert.ok(
  /\.pf2e-combater \.combater-plan-strip\s*\{[\s\S]*?grid-area:\s*plan;/.test(panelStyleSource),
  "selected action strip should occupy its own header grid area",
);
assert.ok(
  /\.pf2e-combater \.combater-plan-strip \.combater-sequence\s*\{[\s\S]*?flex-direction:\s*column;/.test(panelStyleSource),
  "selected action strip should render compact vertical rows instead of stretched slabs",
);
assert.ok(
  /\.pf2e-combater \.combater-plan-strip \.combater-header-step\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/.test(panelStyleSource),
  "selected action rows should keep step content and row tools aligned",
);
assert.ok(
  /\.pf2e-combater \.combater-step-details\s*\{[\s\S]*?flex-wrap:\s*wrap;/.test(panelStyleSource),
  "selected action metadata should wrap instead of overlapping",
);
assert.ok(
  /\.pf2e-combater\.combater-panel \.window-content\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/.test(panelStyleSource),
  "main panel window content should retain a viewport-capped scroll fallback when intrinsic flex sizing cannot shrink the plan",
);
assert.ok(
  /\.pf2e-combater\.combater-browser \.window-content\s*\{[\s\S]*?overflow:\s*hidden;/.test(panelStyleSource),
  "detached Browse windows should keep their pinned-header inner-list scroll owner",
);
assert.ok(
  /\.pf2e-combater\.combater-panel \.combater-shell\s*\{[\s\S]*?max-height:\s*inherit;/.test(panelStyleSource),
  "main panel shell should inherit the capped content height instead of growing past the viewport",
);
assert.ok(
  /\.pf2e-combater\.combater-panel \.combater-plan\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable;/.test(panelStyleSource),
  "main panel plan list should own vertical scrolling without shifting content when the scrollbar appears",
);
assert.ok(
  panelTemplateSource.includes('data-action="toggle-compact"'),
  "panel header should expose a compact-mode toggle button",
);
assert.ok(
  panelTemplateSource.includes('combater-shell{{#unless expanded}} is-compact{{/unless}}'),
  "panel shell should flag compact mode via a CSS class driven by the expanded flag",
);
assert.ok(
  /_setExpanded\(expanded\) \{[\s\S]*?setPosition\(\{ width: expanded \? 720 : 360 \}\)/.test(panelSource),
  "toggling compact mode should also shrink/restore the window width",
);
assert.ok(
  /\.combater-shell\.is-compact \.combater-step-tools \.combater-chip-tool:not\(\.is-execute\):not\(\.danger\):not\(\.combater-step-waiting\):not\(\[data-choose-target\]\):not\(\[data-choose-destination\]\):not\(\[data-choose-area\]\)[\s\S]*?display:\s*none;/.test(panelStyleSource),
  "compact mode should hide optional per-step tools but keep Execute/Remove/awaiting-GM and required choice controls visible",
);
assert.equal(
  /headerSummary:\s*draftSteps\.length/.test(panelSource),
  false,
  "selected step count should not render as visible header summary over the plan rows",
);
assert.equal(panelTemplateSource.includes("combater-confidence"), false,
  "the vestigial static \"Draft\" mode badge should be gone from the header");
assert.equal(panelSource.includes("headerMode"), false, "headerMode is removed; no frozen mode label");
assert.ok(panelTemplateSource.includes("PF2E_COMBATER.Panel.NoSelectedActions"), "panel template should start with empty draft copy");
assert.equal(
  panelSource.includes(": \"No selected actions.\""),
  false,
  "empty draft should not duplicate the no-selected-actions copy in header summary",
);
assert.ok(
  panelTemplateSource.includes("{{#if headerSummary}}"),
  "header summary should only render when non-empty",
);
assert.ok(
  panelViewModelSource.includes("remainingQuickenedActions"),
  "header action pool should include quickened actions left",
);
assert.ok(
  panelSource.includes("builderAtomicActionsForStep"),
  "auto-fill should split generated combo plan steps into atomic draft actions",
);
assert.ok(
  /function autoFillTargetCenter[\s\S]*canvas\?\.tokens\?\.placeables/.test(panelDraftHelpersSource),
  "a plain strike's target is often only a sanitized {id,name} ref with no embedded position -- " +
  "auto-fill's target-aimed Stride must fall back to resolving the live canvas token by id/uuid",
);
assert.equal(panelTemplateSource.includes("No usable action"), false, "panel template should not imply auto-fill is selected");
assert.ok(panelContextWorkflowSource.includes("headerSteps: groupDraftSteps(draftSteps)"), "panel header should render draft steps only");
assert.ok(panelPickerWorkflowSource.includes("projectContextForDraftStepOrigin"), "draft movement previews should use prior draft destinations as origin");
assert.ok(panelContextWorkflowSource.includes("panel._planningContext = planningContext"), "action-list previews should remember projected draft destination context");
assert.ok(
  /showActionPreview\(\s*this\._planningContext \?\? this\._context\b/.test(panelSource),
  "action-list hover preview should start from projected draft context",
);
assert.ok(
  /_onRender\(context, options\)[\s\S]*_restoreDestinationPickerPreview\(\)/.test(panelSource),
  "panel render should restore destination picker overlay while picker is active",
);
assert.ok(
  panelPickerWorkflowSource.includes("panel._destinationPicker.preview"),
  "destination picker refresh should restore the transient waypoint preview instead of resetting to the draft step",
);
assert.ok(
  /chooseDestination\(\{[\s\S]*enableWaypoints:\s*true/.test(panelPickerWorkflowSource),
  "stride destination planning should use combater-owned waypoints instead of Foundry's native ruler",
);
assert.equal(
  /choosePanelDestination\(panel, instanceId\)[\s\S]*useNativeRuler:\s*true/.test(panelPickerWorkflowSource),
  false,
  "plan-phase destination picking must not call Foundry native ruler because it can move tokens",
);
assert.ok(
  /clearActionPreviewUnlessPicking\(panel, event\)[\s\S]*const related = event\?\.relatedTarget[\s\S]*if \(!related \|\| !element\?\.contains\?\.\(related\)\) return;/.test(panelPickerWorkflowSource),
  "plan hover preview should stay visible when the pointer leaves the panel for the canvas or the pointer is cancelled",
);
assert.ok(
  /_showDraftActionPreview\(element\)[\s\S]*movementPlan:\s*step\.movementPlan/.test(panelSource),
  "draft movement hover preview should include stored custom waypoint path, not only the final destination",
);
// _showHoverGhost must forward the hover candidate's own movementPlan (built by the picker's
// candidatePlanFor, carrying whatever waypoints are already committed) through to showHoverGhost --
// without it, movementPreviewForStep's hoverOnly branch has no way to know a waypoint bend already
// exists, and validates/renders the hover point as if it were a direct line from the origin instead of
// routing through that waypoint first (reported live: the ghost showed available/green for a
// destination that only became beyond Speed once the mandatory waypoint detour was accounted for).
assert.ok(
  /showPanelHoverGhost\(panel, instanceId, destination, metadata = \{\}\)[\s\S]*movementPlan:\s*metadata\.movementPlan/.test(panelPickerWorkflowSource),
  "_showHoverGhost must forward the hover candidate's movementPlan (with any already-committed waypoints) to showHoverGhost",
);
assert.ok(
  /showPanelHoverGhost\(panel, instanceId, destination, metadata\)/.test(panelPickerWorkflowSource),
  "the hoverOnly branch of onPreview must pass its own metadata through to _showHoverGhost",
);
assert.ok(
  destinationPickerSource.includes('from "../engine/movement-route.js"'),
  "destination picker should read movement route data through the engine movement route module",
);
assert.equal(
  destinationPickerSource.includes("movementRouteToPoint"),
  false,
  "destination picker should not depend on movement-preview's route helper",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/movement.js"')
    && executionMovementSource.includes('from "../movement-route.js"'),
  "action executor should delegate movement execution to a movement execution module backed by movement routes",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/teleport.js"'),
  "action executor should delegate teleport spell execution to the teleport execution module",
);
assert.ok(
  executionTeleportSource.includes("export async function executeTeleport")
    && executionTeleportSource.includes('from "./movement.js"')
    && executionTeleportSource.includes('from "./native-item.js"')
    && executionTeleportSource.includes('from "./damage.js"'),
  "teleport execution module should own spell casting, instant token movement, damage follow-up, and undo data",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/results.js"')
    && executionMovementSource.includes('from "./results.js"'),
  "action execution branches should share result/revert envelopes through the execution results module",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/equipment.js"'),
  "action executor should delegate weapon draw/drop/sheathe/reload branches to equipment execution",
);
assert.ok(
  executionEquipmentSource.includes("export async function executeDrawWeapon")
    && executionEquipmentSource.includes("export async function executeDropWeapon")
    && executionEquipmentSource.includes("export async function executeSheatheWeapon")
    && executionEquipmentSource.includes("export async function executeReloadWeapon")
    && executionEquipmentSource.includes("export async function executeSwapItems")
    && actionExecutorSource.includes("executeSwapItems"),
  "equipment execution module should own item carry, reload, and Swap execution entrypoints",
);
assert.ok(
  equipmentItemsSource.includes("export function heldSwapItems")
    && equipmentItemsSource.includes("export function drawableSwapItems")
    && executionEquipmentSource.includes('from "../equipment-items.js"'),
  "Swap reading and execution should share physical-item carry-state selection rules",
);
assert.ok(
  executionEquipmentSource.includes('from "./guidance.js"')
    && executionSustainSource.includes('from "./guidance.js"'),
  "executor branches should share chat/reminder guidance through the execution guidance module",
);
assert.ok(
  executionGuidanceSource.includes("export async function createGuidance"),
  "execution guidance module should own guidance chat/reminder posting",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/conditions.js"')
    && actionRevertSource.includes('from "../execution/conditions.js"'),
  "executor and revert should share condition execution through the condition execution module",
);
assert.ok(
  executionConditionsSource.includes("export async function decreaseCondition")
    && executionConditionsSource.includes("export async function increaseCondition")
    && executionConditionsSource.includes("export async function revertCondition")
    && executionConditionsSource.includes("export async function executeStand")
    && executionConditionsSource.includes("export async function executeDropProne")
    && executionConditionsSource.includes("export async function executeRetch"),
  "condition execution module should own condition mutation plus Stand/Drop Prone/Retch execution",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/native-item.js"')
    && revertSpellSlotSource.includes('from "../execution/native-item.js"'),
  "executor and spell slot revert should share native PF2e item execution through the native item execution module",
);
assert.ok(
  executionNativeItemSource.includes("export async function executeOpenItem")
    && executionNativeItemSource.includes("export async function executeNativeAction")
    && executionNativeItemSource.includes("export function spellSlotRevertOp")
    && executionNativeItemSource.includes("export function findSpellcastingEntry"),
  "native item execution module should own PF2e item dispatch, default action execution, spell-slot revert capture, and spellcasting entry lookup",
);
assert.ok(
  executionNativeItemSource.includes('from "./damage.js"')
    && executionTeleportSource.includes('from "./damage.js"'),
  "native item and teleport execution should delegate PF2e damage rolling to the damage execution module",
);
assert.ok(
  executionDamageSource.includes("export async function rollActionDamageMessages")
    && executionDamageSource.includes("export async function flushPendingChat"),
  "damage execution module should own auto-damage rolling and chat-order flushing",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/system-action.js"'),
  "action executor should delegate PF2e system action API use to the system action execution module",
);
assert.ok(
  executionSystemActionSource.includes("export async function usePf2eAction")
    && executionSystemActionSource.includes("export async function executeSystemAction")
    && executionSystemActionSource.includes("pf2eRuntime.useAction")
    && pf2eRuntimeSource.includes("export function createPf2eRuntime")
    && pf2eRuntimeSource.includes("export function createFoundryPf2eAdapter")
    && pf2eRuntimeSource.includes("export function createFixturePf2eAdapter"),
  "system action execution should cross the PF2e runtime Module seam, backed by production and fixture Adapters",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/strike.js"'),
  "action executor should delegate PF2e Strike rolling to the strike execution module",
);
assert.ok(
  executionStrikeSource.includes("export async function executeStrike")
    && executionStrikeSource.includes("export function strikeVariantIndex")
    && executionStrikeSource.includes("function strikeVariant"),
  "strike execution module should own target selection, MAP variant choice, Strike rolling, and chat revert shaping",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/sustain.js"'),
  "action executor should delegate Sustain a Spell chat reposting to the sustain execution module",
);
assert.ok(
  executionSustainSource.includes("export async function resolveSustainedSpell")
    && executionSustainSource.includes("export async function executeSustainSpell"),
  "sustain execution module should own sustained spell lookup, chat reposting, fallback guidance, and chat revert shaping",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/area.js"'),
  "action executor should delegate area marker preparation, placement, timers, and targeting to area execution",
);
assert.ok(
  executionAreaSource.includes("export async function createAreaRegion")
    && executionAreaSource.includes("export async function createAreaTimer")
    && executionAreaSource.includes("export function areaTemplatePersists")
    && executionAreaSource.includes("export async function prepareAreaExecution")
    && executionAreaSource.includes("export function needsAreaChoiceForExecution"),
  "area execution module should own marker auto-resolution, Foundry Region creation, area timers, in-area targeting, and persistence policy",
);
assert.ok(
  executionNativeItemSource.includes('from "./chat-revert.js"')
    && executionStrikeSource.includes('from "./chat-revert.js"')
    && executionSystemActionSource.includes('from "./chat-revert.js"')
    && executionTeleportSource.includes('from "./chat-revert.js"'),
  "execution branches should delegate chat/resource/manual-warning revert shaping to chat revert execution",
);
assert.ok(
  executionChatRevertSource.includes("export function chatMessageIdFromResult")
    && executionChatRevertSource.includes("export function chatActionRevert"),
  "chat revert execution module should own chat message detection and chat-action revert envelope shaping",
);
assert.ok(
  executionResultsSource.includes("export function executionPatch")
    && executionResultsSource.includes("export function revertEnvelope")
    && executionResultsSource.includes("export function attachRevertOp"),
  "execution results module should own execution patch and revert-envelope helpers",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/state.js"')
    && panelExecutionWorkflowSource.includes('from "../../engine/execution/state.js"')
    && actionRevertSource.includes('from "../execution/state.js"'),
  "executor, panel execution workflow, and revert should share draft execution readiness/reset state through the execution state module",
);
assert.ok(
  executionStateSource.includes("export function executionAction")
    && executionStateSource.includes("export function executionReadinessForStep")
    && executionStateSource.includes("export function nextPendingExecutionStep")
    && executionStateSource.includes("export function resetDraftExecution"),
  "execution state module should own execution action merge, readiness, next-step selection, and draft reset",
);
assert.ok(
  actionRevertSource.includes('from "../revert/spell-slot.js"'),
  "action revert should delegate spell-slot restore to the spell slot revert module",
);
assert.ok(
  revertSpellSlotSource.includes("export async function revertSlot")
    && revertSpellSlotSource.includes("function restorePreparedSlot")
    && revertSpellSlotSource.includes("function restoreSlotPool")
    && revertSpellSlotSource.includes('from "../execution/native-item.js"'),
  "spell slot revert module should own prepared-slot matching, slot-pool restore, and spellcasting entry lookup",
);
assert.ok(
  actionRevertSource.includes('from "../revert/item-resources.js"'),
  "action revert should delegate item/resource restore to the item resource revert module",
);
assert.ok(
  revertItemResourcesSource.includes("export async function revertCarryType")
    && revertItemResourcesSource.includes("export async function revertConsumable")
    && revertItemResourcesSource.includes("export async function revertFrequency")
    && revertItemResourcesSource.includes("export async function revertReload"),
  "item resource revert module should own carry-type, consumable, frequency, and reload undo",
);
assert.ok(
  actionRevertSource.includes('from "../revert/movement.js"'),
  "action revert should delegate movement undo to the movement revert module",
);
assert.ok(
  revertMovementSource.includes("export async function revertMovement")
    && revertMovementSource.includes("function moveTokenTo")
    && revertMovementSource.includes('from "../execution/targets.js"'),
  "movement revert module should own token lookup and path rewind movement",
);
assert.ok(
  actionRevertSource.includes('from "../revert/documents.js"'),
  "action revert should delegate Region/effect/chat cleanup to the document revert module",
);
assert.ok(
  revertDocumentsSource.includes("export async function revertRegion")
    && revertDocumentsSource.includes("export async function revertEffect")
    && revertDocumentsSource.includes("export async function revertChat")
    && revertDocumentsSource.includes("function deleteEffect"),
  "document revert module should own Region cleanup, standalone/linked effect cleanup, and chat deletion",
);
assert.equal(
  actionRevertSource.includes("findSpellcastingEntry"),
  false,
  "action revert should not know spellcasting entry lookup after spell slot revert split",
);
for (const pattern of ["executionPatch", "revertEnvelope", "attachRevertOp"]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep execution result helper ${pattern}`,
  );
}
for (const pattern of [
  "executionAction",
  "executionReadinessForStep",
  "nextPendingExecutionStep",
  "resetDraftExecution",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep execution state helper ${pattern}`,
  );
}
for (const pattern of [
  "moveTokenTo",
  "revertMovement",
  "revertCondition",
  "confirmedRemoved",
  "deleteLinkedAreaEffect",
  "revertRegion",
  "revertChat",
  "systemFieldUpdatePath",
  "revertCarryType",
  "revertConsumable",
  "revertFrequency",
  "revertReload",
  "slotKeyForRank",
  "identityValues",
  "findPreparedSlot",
  "restorePreparedSlot",
  "restoreSlotPool",
  "revertSlot",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionRevertSource),
    false,
    `action revert should not keep spell slot revert helper ${pattern}`,
  );
}
for (const pattern of [
  "weaponCarryState",
  "changeWeaponCarry",
  "executeDrawWeapon",
  "executeDropWeapon",
  "executeSheatheWeapon",
  "findCompatibleAmmo",
  "weaponSubitemQuantities",
  "reloadRevertOpAfterAttach",
  "executeReloadWeapon",
  "escapeHtml",
  "createGuidance",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep equipment/guidance helper ${pattern}`,
  );
}
for (const pattern of [
  "decreaseCondition",
  "increaseCondition",
  "executeStand",
  "resultDegree",
  "degreeSucceeded",
  "isCriticalSuccessDegree",
  "rollFortitudeSave",
  "applyRetchResult",
  "executeRetch",
  "executeDropProne",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep condition execution helper ${pattern}`,
  );
}
for (const pattern of [
  "slotKeyForRank",
  "identityValues",
  "findPreparedSpellSlot",
  "slotSnapshot",
  "spellSlotRevertOp",
  "isCantripSpell",
  "spellCastResourceSufficient",
  "waitForChatMessage",
  "findSpellcastingEntry",
  "consumableUseSnapshot",
  "consumableRevertOpAfterUse",
  "frequencySnapshot",
  "consumeFrequencyIfUnspent",
  "executeNativeItem",
  "executeOpenItem",
  "executeNativeAction",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep native item execution helper ${pattern}`,
  );
}
for (const pattern of [
  "actionContextSlug",
  "pf2eDamageRollClass",
  "htmlEscape",
  "actionDisplayName",
  "damageContextOptions",
  "damageTargetFlag",
  "damageOriginFlag",
  "damageMessageFlags",
  "damageFlavor",
  "actionDamageFormula",
  "rollActionDamage",
  "damageRollCount",
  "flushPendingChat",
  "rollActionDamageMessages",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep damage execution helper ${pattern}`,
  );
}
for (const pattern of [
  "pf2eActionsCollection",
  "slugToCamel",
  "pf2eActionBySlug",
  "systemActionVariantList",
  "variantKey",
  "resolveActionVariant",
  "usePf2eAction",
  "executePf2eAction",
  "executeSystemAction",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep system action execution helper ${pattern}`,
  );
}
for (const pattern of [
  "strikeVariantIndex",
  "strikeVariant",
  "executeStrike",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep strike execution helper ${pattern}`,
  );
}
for (const pattern of [
  "resolveSustainedSpell",
  "executeSustainSpell",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep sustain execution helper ${pattern}`,
  );
}
for (const pattern of [
  "areaMarkerFromStep",
  "autoSelfCenteredAreaMarker",
  "autoTargetCenteredAreaMarker",
  "executionAreaMarker",
  "needsAreaChoiceForExecution",
  "prepareAreaExecution",
  "regionIdFromCreated",
  "createAreaRegion",
  "spellDurationInfo",
  "createAreaTimer",
  "areaTemplatePersists",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep area execution helper ${pattern}`,
  );
}
for (const pattern of [
  "chatMessageIdFromResult",
  "chatActionRevert",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep chat revert execution helper ${pattern}`,
  );
}
assert.ok(
  plannerSource.includes('from "./action/budget.js"'),
  "planner should use the shared action budget module instead of owning budget math inline",
);
assert.ok(
  actionBudgetSource.includes("export function actionBudget"),
  "action budget module should own slowed/stunned/quickened/spent budget math",
);
assert.ok(
  positionalKiteReaderSource.includes('from "../../engine/action/budget.js"'),
  "positional kite reader should read budget math through the action budget module",
);
assert.ok(
  plannerSource.includes('from "./planner/rules.js"'),
  "planner should delegate previous-action, target-condition, and target-inheritance rules through the planner rules module",
);
assert.ok(
  plannerRulesSource.includes("export function previousActionRequirements")
    && plannerRulesSource.includes("export function targetForCandidate")
    && plannerRulesSource.includes("export function inheritPlannedTarget")
    && plannerRulesSource.includes("export function targetConditionChainBonus")
    && plannerRulesSource.includes("export function isAttackAction"),
  "planner rules should own action facts, previous-action gates, target identity, target inheritance, and target-condition plan bonuses",
);
for (const pattern of [
  "previousActionRequirements",
  "targetForCandidate",
  "inheritPlannedTarget",
  "targetConditionChainBonus",
  "currentAttackRange",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(plannerSource),
    false,
    `planner should not own planner rule helper ${pattern}`,
  );
}
assert.ok(
  plannerSource.includes('from "./planner/conflicts.js"'),
  "planner should delegate plan-pair legality through the planner conflicts module",
);
assert.ok(
  plannerConflictsSource.includes("export function hasPlanConflict")
    && plannerConflictsSource.includes("export function hasAttackPathAvailable")
    && plannerConflictsSource.includes("export function isRepeatablePlanningAction")
    && plannerConflictsSource.includes("export function includesStand")
    && plannerConflictsSource.includes("export const BASIC_MOVE_SLUGS"),
  "planner conflicts should own movement/prone/retreat/cantrip/repeated-Stride plan legality",
);
for (const pattern of [
  "includesStand",
  "stridesWithoutStanding",
  "targetNeedsRepeatedStride",
  "isRepeatablePlanningAction",
  "allowsPostChargeTumbleThrough",
  "endsAwayFromMelee",
  "isMeleeOnlyAction",
  "reachesCurrentTarget",
  "canPairRepeatedStride",
  "hasAttackPathAvailable",
  "hasPlanConflict",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(plannerSource),
    false,
    `planner should not own plan-conflict helper ${pattern}`,
  );
}
assert.ok(
  plannerSource.includes('from "./planner/projections.js"'),
  "planner should delegate projected sibling candidates and projected movement scoring through the planner projections module",
);
assert.ok(
  plannerProjectionsSource.includes("export function withQuickenedCastingDiscountCandidates")
    && plannerProjectionsSource.includes("export function withLingeringCompositionCandidates")
    && plannerProjectionsSource.includes("export function withProjectedFollowUpStrikeCandidates")
    && plannerProjectionsSource.includes("export function projectedFollowUpSatisfied")
    && plannerProjectionsSource.includes("export function projectedVolleyPenalty"),
  "planner projections should own discount/extension sibling candidates, follow-up candidates, follow-up reach checks, and projected volley penalty",
);
for (const pattern of [
  "withQuickenedCastingDiscountCandidates",
  "withLingeringCompositionCandidates",
  "withProjectedFollowUpStrikeCandidates",
  "projectedFollowUpSatisfied",
  "projectedVolleyPenalty",
  "appliesProne",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(plannerSource),
    false,
    `planner should not own projected planner helper ${pattern}`,
  );
}
assert.equal(
  actionReaderSource.includes('from "../../engine/planner.js"'),
  false,
  "action reader should not depend on planner; that creates a reader-planner-scoring import cycle",
);
assert.ok(
  foundryDataSource.includes("export function collectionValues")
    && foundryDataSource.includes("export function systemValue")
    && foundryDataSource.includes("export function entityKey")
    && foundryDataSource.includes("export function actorItems")
    && foundryDataSource.includes("export function traitSlugs"),
  "foundry data module should own Collection/Map, entity key, actor item, system.value, and trait.value unwrapping",
);
assert.equal(
  entityKey({ token: { uuid: "Token.abc" }, name: "Fallback" }),
  "Token.abc",
  "foundry data entityKey should prefer stable token ids before names",
);
assert.deepEqual(
  actorItems({
    itemTypes: { effect: [{ id: "typed", type: "effect" }] },
    items: [{ id: "typed", type: "effect" }, { id: "fallback", type: "effect" }, { id: "other", type: "feat" }],
  }, "effect").map((item) => item.id),
  ["typed", "fallback"],
  "foundry data actorItems should merge typed item collections with actor.items fallback without duplicates",
);
assert.deepEqual(
  traitSlugs({ system: { traits: { value: new Set(["attack", "move"]) } } }),
  ["attack", "move"],
  "foundry data traitSlugs should unwrap PF2e trait sets",
);
assert.ok(
  actionTextSource.includes("export function slugify")
    && actionTextSource.includes("export function parseActionText"),
  "action text module should own slug and action-count text parsing",
);
assert.ok(
  actionReaderSource.includes('from "../../engine/action/text.js"')
    && spellReaderSource.includes('from "../engine/action/text.js"')
    && actionBudgetSource.includes('from "./text.js"')
    && actionBuilderAtomizeSource.includes('from "../text.js"')
    && executionSustainSource.includes('from "../action/text.js"')
    && plannerSource.includes('from "./action/text.js"')
    && scoringGatesSource.includes('from "../action/text.js"')
    && sustainedSpellsSource.includes('from "./action/text.js"'),
  "action and spell readers plus engine modules should share action text parsing through the action text module",
);
for (const [source, label] of [
  [actionBudgetSource, "action budget"],
  [actionBuilderSource, "action builder"],
  [actionBuilderAtomizeSource, "action builder atomize"],
  [actionBuilderMinionSource, "action builder minion"],
  [actionBuilderModelSource, "action builder model"],
  [actionExecutorSource, "action executor"],
  [plannerSource, "planner"],
  [scoringSource, "scoring"],
  [scoringGatesSource, "scoring gates"],
  [sustainedSpellsSource, "sustained spells"],
]) {
  assert.equal(
    /function (slugText|slugFromName|normalizeSpellKey|normalizeSlug)\s*\(/.test(source),
    false,
    `${label} should not duplicate action text slug parsing`,
  );
}
assert.ok(
  actionBuilderAtomizeSource.includes("return slugify(name);"),
  "action builder atomize should delegate action-name slug parsing to action text",
);
assert.ok(
  actionReaderSource.includes("return parseActionTextValue(value);")
    && !spellReaderSource.includes("function parseActionText"),
  "readers should delegate action-count text parsing to the action text module",
);
assert.ok(
  actionReaderSource.includes('from "../item-action-reader.js"'),
  "action reader should read item action costs and availability through the item action reader",
);
assert.ok(
  itemActionReaderSource.includes("export function readActionCost")
    && itemActionReaderSource.includes("export function readItemAvailability")
    && itemActionReaderSource.includes("export function parseActionCost")
    && itemActionReaderSource.includes("export function addConsumableInteractProfile")
    && itemActionReaderSource.includes("export function addItemTraitProfile"),
  "item action reader should own item action cost parsing, availability, consumable draw surcharge, and item trait profiles",
);
for (const pattern of [
  "readItemAvailability",
  "hasUnevaluatedPredicate",
  "readActivationActionCost",
  "withConsumableInteractCost",
  "addConsumableInteractProfile",
  "addItemTraitProfile",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own item action helper ${pattern}`,
  );
}
assert.ok(
  actionReaderSource.includes('from "../weapon-action-reader.js"'),
  "action reader should read weapon draw/reload activities through the weapon action reader",
);
assert.ok(
  actionReaderSource.includes('from "../swap-action-reader.js"')
    && swapActionReaderSource.includes("export function readSwapItemActions")
    && swapActionReaderSource.includes('from "../engine/equipment-items.js"'),
  "action reader should obtain Swap Items from its dedicated reader backed by shared carry-state rules",
);
assert.ok(
  weaponActionReaderSource.includes("export function readWeaponActions")
    && weaponActionReaderSource.includes('from "../engine/target-pool.js"')
    && weaponActionReaderSource.includes('from "./action/reach.js"')
    && weaponActionReaderSource.includes('from "./item-action-reader.js"'),
  "weapon action reader should own draw, sheathe, release, reload, and draw-strike activity reading",
);
for (const pattern of [
  "readWeaponRange",
  "readWeaponItems",
  "isDrawableWeapon",
  "readDrawStrikeActivities",
  "readDrawWeaponActions",
  "readSheatheWeaponActions",
  "readReleaseWeaponActions",
  "weaponReloadValue",
  "weaponHasLoadedAmmo",
  "readReloadWeaponActions",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own weapon action helper ${pattern}`,
  );
}
assert.ok(
  actionReaderSource.includes('from "./reader-helpers.js"'),
  "action reader should share movement/profile/condition helpers through the action reader helper module",
);
assert.ok(
  actionReaderHelpersSource.includes("export function contextProfile")
    && actionReaderHelpersSource.includes("export function hasCondition")
    && actionReaderHelpersSource.includes("export function uniqueTargets")
    && actionReaderHelpersSource.includes("export function movementBlockingCondition")
    && actionReaderHelpersSource.includes("export function actionUsesMovement"),
  "action reader helper module should own shared profile, condition, target, and movement-blocking helpers",
);
for (const pattern of [
  "contextProfile",
  "canStandBeforeMovement",
  "uniqueTargets",
  "meleeReach",
  "movementRange",
  "actionUsesMovement",
  "movementBlockingCondition",
  "hasCondition",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own shared reader helper ${pattern}`,
  );
}
assert.ok(
  actionReaderSource.includes('from "../positional/tactic-reader.js"'),
  "action reader should read positional movement tactics through the positional tactic reader",
);
assert.ok(
  positionalTacticReaderSource.includes("export function readPositionalMovementActions")
    && positionalTacticReaderSource.includes('from "./stride-reader.js"')
    && positionalTacticReaderSource.includes('from "./retreat-reader.js"')
    && positionalTacticReaderSource.includes('from "./flank-reader.js"')
    && positionalTacticReaderSource.includes('from "./kite-reader.js"'),
  "positional tactic reader should compose dedicated positional tactic family readers",
);
assert.ok(
  positionalStrideReaderSource.includes("export function readStrideStrikeActivities")
    && positionalStrideReaderSource.includes("export function readStrideMultiattackActivities")
    && positionalStrideReaderSource.includes('from "../action/reach.js"'),
  "positional stride reader should own Stride -> Strike and Stride -> multiattack tactics",
);
assert.ok(
  positionalRetreatReaderSource.includes("export function readRangedRetreatStrikeActivities")
    && positionalRetreatReaderSource.includes("export function readSkirmishStrikeActivities")
    && positionalRetreatReaderSource.includes('from "../../integrations/visioner.js"'),
  "positional retreat reader should own ranged retreat and cover-return skirmish tactics",
);
assert.ok(
  positionalFlankReaderSource.includes("export function readFlankStrikeActivities")
    && positionalFlankReaderSource.includes("function flanksTarget")
    && positionalFlankReaderSource.includes('from "../../rules/token-geometry.js"'),
  "positional flank reader should own flank-square geometry and flank setup actions",
);
assert.ok(
  positionalKiteReaderSource.includes("export function readSkirmishKiteActivities")
    && positionalKiteReaderSource.includes("function skirmishKitePlan")
    && positionalKiteReaderSource.includes('from "../../engine/action/budget.js"'),
  "positional kite reader should own low-HP/ranged-primary skirmish kite tactics",
);
assert.ok(
  positionalTacticHelpersSource.includes("export function strikeMeleeReach")
    && positionalTacticHelpersSource.includes("export function isRangedStrike")
    && positionalTacticHelpersSource.includes("export function candidateAverageDamage"),
  "positional tactic helpers should own shared reach/ranged/damage facts",
);
for (const pattern of [
  "readStrideStrikeActivities",
  "readStrideMultiattackActivities",
  "readRangedRetreatStrikeActivities",
  "readSkirmishStrikeActivities",
  "readPositionalTacticActivities",
  "flankStrikePlan",
  "skirmishKitePlan",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own positional tactic helper ${pattern}`,
  );
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(positionalTacticReaderSource),
    false,
    `positional tactic orchestrator should not own family helper ${pattern}`,
  );
}
for (const [source, patterns, label] of [
  [positionalStrideReaderSource, ["readRangedRetreatStrikeActivities", "readSkirmishStrikeActivities", "flankStrikePlan", "skirmishKitePlan"], "stride reader"],
  [positionalRetreatReaderSource, ["readStrideStrikeActivities", "readStrideMultiattackActivities", "flankStrikePlan", "skirmishKitePlan"], "retreat reader"],
  [positionalFlankReaderSource, ["readStrideStrikeActivities", "readRangedRetreatStrikeActivities", "skirmishKitePlan"], "flank reader"],
  [positionalKiteReaderSource, ["readStrideStrikeActivities", "readRangedRetreatStrikeActivities", "flankStrikePlan"], "kite reader"],
]) {
  for (const pattern of patterns) {
    assert.equal(
      new RegExp(`function ${pattern}\\s*\\(`).test(source),
      false,
      `positional ${label} should not own unrelated tactic helper ${pattern}`,
    );
  }
}
assert.ok(
  actionReaderSource.includes('from "../elemental-blast-reader.js"'),
  "action reader should read kineticist Elemental Blast actions through the elemental blast reader",
);
assert.ok(
  elementalBlastReaderSource.includes("export function readElementalBlastActions")
    && elementalBlastReaderSource.includes("export function actorHasElementalBlastConfigs")
    && elementalBlastReaderSource.includes("function selectedElementalDamageType")
    && elementalBlastReaderSource.includes("function elementalBlastAverage"),
  "elemental blast reader should own kineticist blast config, labels, action-cost variants, and damage estimates",
);
for (const pattern of [
  "elementalBlastItem",
  "kineticistBlastFlag",
  "elementalBlastConfigs",
  "selectedElementalDamageType",
  "selectedElementalBlastActionCost",
  "elementalBlastAverage",
  "elementalBlastLabel",
  "readElementalBlastActions",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own elemental blast helper ${pattern}`,
  );
}
assert.ok(
  actionReaderSource.includes('from "../defense-action-reader.js"'),
  "action reader should read shield and recovery availability through the defense action reader",
);
assert.ok(
  defenseActionReaderSource.includes("export function readShieldSpellBlockActions")
    && defenseActionReaderSource.includes("export function readShieldBlockAvailability")
    && defenseActionReaderSource.includes("export function readResourceRecoveryAvailability")
    && defenseActionReaderSource.includes("function shieldSpellDefenseActive")
    && defenseActionReaderSource.includes("function hasExpendedSpellResource"),
  "defense action reader should own Shield Block, Shield spell, and spell-resource recovery gates",
);
for (const pattern of [
  "hasExpendedSpellResource",
  "readResourceRecoveryAvailability",
  "readShieldBlockAvailability",
  "isShieldBlockAction",
  "actorHasShieldBlockAction",
  "shieldEffectEntries",
  "shieldSpellDefenseActive",
  "shieldBlockDefenseActive",
  "readShieldSpellBlockActions",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own defense action helper ${pattern}`,
  );
}
assert.ok(
  actionReaderSource.includes('from "../generic-action-reader.js"'),
  "action reader should read PF2e generic action rows and gates through the generic action reader",
);
assert.ok(
  genericActionReaderSource.includes("export function readGenericActions")
    && genericActionReaderSource.includes("export function readGenericActionAvailability")
    && genericActionReaderSource.includes("export function readMovementAvailability")
    && genericActionReaderSource.includes("export function hideNonCombatSystemAction")
    && genericActionReaderSource.includes("function hasSeekTarget")
    && genericActionReaderSource.includes("function hasTumbleThroughOpportunity"),
  "generic action reader should own generic catalog rows, combat relevance, movement, target, object, cover, Seek, and Tumble Through gates",
);
for (const pattern of [
  "hideGenericActionForContext",
  "hasCombatRelevantSystemActionSignal",
  "hideNonCombatSystemAction",
  "readGenericActions",
  "genericActionAvailability",
  "isGenericAvailable",
  "freeHands",
  "readMovementAvailability",
  "hasTerrain",
  "hasSeekTarget",
  "hasCombatSignal",
  "hasTumbleThroughOpportunity",
  "hasCoverOrConcealment",
  "hasCompanionOrMinion",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionReaderSource),
    false,
    `action reader should not own generic action helper ${pattern}`,
  );
}
assert.ok(
  targetPoolSource.includes("export function contextTargets")
    && targetPoolSource.includes("export function firstContextTarget")
    && targetPoolSource.includes("export function contextEnemies")
    && targetPoolSource.includes("export function contextAllies")
    && targetPoolSource.includes("export function targetReference")
    && targetPoolSource.includes("export function selfTargetReference")
    && targetPoolSource.includes("export function hasEnemyWithinRange")
    && targetPoolSource.includes("export function canAttackTarget")
    && targetPoolSource.includes("export function detectionState"),
  "target pool module should own context target/enemy/ally fallback lists, target refs, attack eligibility, detection state, and range queries",
);
assert.deepEqual(
  [
    firstContextTarget({ battlefield: { targets: [{ id: "target" }] } })?.id,
    contextTargets({ battlefield: { targets: [{ id: "target" }] } }).length,
    contextEnemies({ targets: [{ id: "fallback-target" }] })[0]?.id,
    contextAllies({ battlefield: { allies: [{ id: "ally" }] } })[0]?.id,
  ],
  ["target", 1, "fallback-target", "ally"],
  "target pool should normalize common combat-context list fallbacks",
);
assert.deepEqual(
  targetReference({ actor: { id: "actor-a", name: "Ally" } }, "ally"),
  { type: "ally", id: "actor-a", uuid: null, name: "Ally" },
  "target pool should build display-safe target references",
);
assert.deepEqual(
  selfTargetReference({ actor: { document: { id: "actor-self", name: "Self Actor" } } }),
  { type: "self", id: "actor-self", uuid: null, name: "Self Actor" },
  "target pool should build display-safe self references",
);
assert.ok(
  actionReaderSource.includes('from "../../engine/target-pool.js"')
    && spellReaderSource.includes('from "../engine/target-pool.js"')
    && plannerRulesSource.includes('from "../target-pool.js"')
    && scoringSource.includes('from "./target-pool.js"'),
  "readers, planner, and scoring should share target/enemy/ally pools through the target pool module",
);
assert.equal(
  /function (firstTarget|allies|enemies)\s*\(/.test(scoringSource),
  false,
  "scoring should not duplicate target pool fallback helpers",
);
assert.equal(
  /function (actorTarget|targetRef)\s*\(/.test(scoringSource),
  false,
  "scoring should not duplicate target pool reference helpers",
);
assert.ok(
  actorContextSource.includes("export function contextActorDocument"),
  "actor context module should own context actor-document extraction",
);
assert.equal(
  contextActorDocument({ actor: { document: { decreaseCondition: async () => {} } } }),
  null,
  "actor context strict mode should ignore lightweight actor adapters without Foundry document data",
);
assert.equal(
  typeof contextActorDocument({ actor: { document: { decreaseCondition: async () => {} } } }, { allowActorFallback: true })?.decreaseCondition,
  "function",
  "actor context fallback mode should preserve execution's previous actor adapter fallback",
);
assert.ok(
  actionReaderSource.includes('from "../../engine/actor-context.js"')
    && spellReaderSource.includes('from "../engine/actor-context.js"')
    && actionExecutorSource.includes('from "../actor-context.js"')
    && actionRevertSource.includes('from "../actor-context.js"')
    && scoringFactsSource.includes('from "../actor-context.js"')
    && sustainedSpellsSource.includes('from "./actor-context.js"'),
  "readers, scoring facts, execution, revert, and sustained spell cleanup should share actor document extraction",
);
assert.equal(
  actionRevertSource.includes('from "./action/executor.js"'),
  false,
  "action revert should not depend on action executor for actor context or token lookup",
);
for (const [source, label] of [
  [actionReaderSource, "action reader"],
  [spellReaderSource, "spell reader"],
  [actionRevertSource, "action revert"],
  [sustainedSpellsSource, "sustained spells"],
]) {
  assert.equal(
    /function (contextActor|actorDocument)\s*\(/.test(source),
    false,
    `${label} should not keep pass-through actor context adapters`,
  );
}
assert.ok(
  settingsSource.includes("export function settingOrDefault"),
  "settings module should own safe setting fallback reads",
);
assert.ok(
  candidatesSource.includes("settingOrDefault")
    && scoringSkillsSource.includes("settingOrDefault")
    && panelSource.includes("settingOrDefault"),
  "candidate building, scoring skill rules, and panel rendering should use the shared settings fallback helper",
);
assert.equal(
  /function readSetting\s*\(/.test(`${candidatesSource}\n${scoringSkillsSource}\n${panelSource}`),
  false,
  "candidate building, scoring skill rules, and panel rendering should not duplicate settings fallback helpers",
);
assert.ok(
  actionReaderSource.includes('from "../../foundry-data.js"')
    && spellReaderSource.includes('from "../foundry-data.js"')
    && actorProfileSource.includes('from "../foundry-data.js"')
    && executionSustainSource.includes('from "../../foundry-data.js"')
    && scoringTargetsSource.includes('from "../../foundry-data.js"')
    && movementCostSource.includes('from "../foundry-data.js"')
    && combatStateSource.includes('from "../foundry-data.js"')
    && panelContextWorkflowSource.includes('from "../../foundry-data.js"')
    && mainSource.includes('from "./foundry-data.js"'),
  "readers, engine, UI, and main should share Foundry data adapters instead of duplicating local helpers",
);
for (const [source, label] of [
  [actionReaderSource, "action reader"],
  [spellReaderSource, "spell reader"],
  [actorProfileSource, "actor profile"],
  [actionExecutorSource, "action executor"],
  [executionSustainSource, "sustain execution"],
  [scoringSource, "scoring"],
  [scoringTargetsSource, "scoring targets"],
  [battlefieldAnalysisSource, "battlefield analysis"],
  [movementCostSource, "movement cost"],
  [combatStateSource, "combat state"],
  [panelSource, "panel"],
]) {
  assert.equal(
    /function (collectionValues|systemValue|targetKey|entityKey|actorItems|readTraitSlugs)\s*\(/.test(source),
    false,
    `${label} should not duplicate Foundry data helpers`,
  );
}
assert.ok(
  scoringSource.includes('from "./backing-strike.js"'),
  "scorer should read borrowed Strike selection through the backing strike module",
);
assert.ok(
  candidatesSource.includes("scoreCandidate(context, action, spells, detected)"),
  "candidate scoring should pass the detected action pool so backing strike selection does not reread actors",
);
assert.ok(
  backingStrikeSource.includes("backingStrikeForAction")
    && backingStrikeSource.includes("backingStrikesForAction"),
  "backing strike module should own single and dual borrowed Strike selection",
);
assert.equal(
  scoringSource.includes('from "../readers/action/reader.js"'),
  false,
  "scorer should not import action-reader just to select backing Strikes",
);
assert.ok(
  actionBuilderModelSource.includes('from "../requirements.js"'),
  "action builder model should read destination/area requirement rules through the action requirements module",
);
assert.ok(
  actionExecutorSource.includes('from "./requirements.js"'),
  "action executor should read destination/target/area requirement rules through the action requirements module",
);
assert.ok(
  panelSource.includes('from "../engine/action/requirements.js"'),
  "panel should read choice requirement rules through the action requirements module",
);
assert.ok(
  actionRequirementsSource.includes("requiresDestinationForAction")
    && actionRequirementsSource.includes("requiresTargetForAction")
    && actionRequirementsSource.includes("requiresAreaMarkerForAction"),
  "action requirements module should own destination, target, and area marker decision rules",
);
assert.equal(
  actionBuilderSource.includes('from "../executor.js"'),
  false,
  "action builder should not depend on execution just to classify area/destination requirements",
);
assert.equal(
  actionExecutorSource.includes('from "./builder/index.js"'),
  false,
  "action executor should not depend on builder just to classify destination requirements",
);
assert.equal(
  /export function requiresDestinationForAction\s*\(/.test(actionBuilderSource),
  false,
  "action builder should not own destination requirement rules",
);
assert.equal(
  /export function requires(Target|AreaMarker)ForAction\s*\(/.test(actionExecutorSource),
  false,
  "action executor should not own target/area requirement rules",
);
assert.ok(
  actionExecutorSource.includes('from "../execution/targets.js"'),
  "action executor should resolve and apply Foundry targets through the execution targets module",
);
assert.ok(
  executionTargetsSource.includes("export function currentTargetSelection")
    && executionTargetsSource.includes("export function plannedTargetSelection")
    && executionTargetsSource.includes("export function resolveTarget")
    && executionTargetsSource.includes("export function setTokenTargets"),
  "execution targets module should own current target reads, planned target data, target resolution, and target writes",
);
for (const pattern of [
  "targetTokenById",
  "targetActor",
  "targetTokenUuid",
  "targetLabelFor",
  "clearTokenTargets",
  "applyTokenTarget",
  "setTarget",
  "resolveTarget",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep target helper ${pattern}`,
  );
}
assert.ok(
  executionAreaSource.includes('from "../area/region.js"'),
  "area execution should use area region data through the area region module",
);
assert.ok(
  areaPickerSource.includes('from "../engine/area/region.js"'),
  "area picker should use area region data without importing the action executor",
);
assert.ok(
  panelPickerWorkflowSource.includes('from "../../engine/area/region.js"'),
  "panel picker workflow should use area hit-testing through the area region module",
);
assert.ok(
  areaRegionSource.includes("areaMarkerShape")
    && areaRegionSource.includes("createAreaRegionData")
    && areaRegionSource.includes("tokensInAreaMarker"),
  "area region module should own marker shape primitives, region shape data, and token-in-area hit testing",
);
assert.ok(
  scoringRoleTacticsSource.includes('from "./area.js"'),
  "scoring role tactics should use the scored area placement module",
);
assert.ok(
  scoringAreaSource.includes("export function scoredAreaPlacement"),
  "scored area placement should expose one scoring-facing interface",
);
assert.equal(
  /function areaPlacement\s*\(/.test(scoringSource),
  false,
  "scoring should not own area placement implementation",
);
assert.ok(
  scoringAreaSource.includes('from "../../rules/canvas-geometry.js"')
    && scoringAreaSource.includes('from "../area/region.js"'),
  "scored area placement should own area geometry dependencies",
);
assert.ok(
  scoringSource.includes('from "./scoring/facts.js"'),
  "scoring should read PF2e action/target facts through the scoring facts module",
);
assert.ok(
  scoringFactsSource.includes("export function actionTraitSlugs")
    && scoringFactsSource.includes("export function damageAverage")
    && scoringFactsSource.includes("export function damageAdjustment")
    && scoringFactsSource.includes("export function saveScoreDelta")
    && scoringFactsSource.includes("export function hasCondition")
    && scoringFactsSource.includes("export function canUseTargetDefenses"),
  "scoring facts should own action traits, damage/defense facts, save odds, conditions, and GM defense visibility",
);
for (const pattern of [
  "actionTraitSlugs",
  "isRangedStrike",
  "maxRange",
  "inRange",
  "damageAverage",
  "damageAdjustment",
  "degreeDistribution",
  "saveScoreDelta",
  "hpPercent",
  "hasCondition",
  "targetDc",
  "canUseTargetDefenses",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own scoring fact helper ${pattern}`,
  );
}
assert.ok(
  scoringTacticsSource.includes('from "./buffs.js"'),
  "scoring tactics should read buff recipient valuation through the scoring buffs module",
);
assert.ok(
  scoringBuffsSource.includes("export function bestBuffRecipient")
    && scoringBuffsSource.includes("export function actionGrantsQuickened")
    && scoringBuffsSource.includes("export function targetAlreadyHasBuff")
    && scoringBuffsSource.includes("export function isMartialRecipient")
    && scoringBuffsSource.includes("export function isPrimarySpellcaster"),
  "scoring buffs should own buff recipient choice, quickened-grant detection, duplicate-buff checks, and class recipient facts",
);
for (const pattern of [
  "activeBuffKeys",
  "actionGrantsQuickened",
  "targetAlreadyHasBuff",
  "isMartialRecipient",
  "isSpellcasterRecipient",
  "isPrimarySpellcaster",
  "buffRecipients",
  "bestBuffRecipient",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own scoring buff helper ${pattern}`,
  );
}
assert.ok(
  scoringSource.includes('from "./scoring/skills.js"'),
  "scoring should read skill reliability through the scoring skills module",
);
assert.ok(
  scoringSkillsSource.includes("export function trainedSkillRequirement")
    && scoringSkillsSource.includes("export function skillCheckScore")
    && scoringSkillsSource.includes("export function ownSkillReliabilityScore"),
  "scoring skills should own trained-skill requirements, target DC skill odds, and actor skill reliability",
);
for (const pattern of [
  "skillEntry",
  "trainedSkillRequirement",
  "actionSkillDcSlug",
  "skillCheckScore",
  "ownSkillReliabilityScore",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own scoring skill helper ${pattern}`,
  );
}
assert.ok(
  scoringSource.includes('from "./scoring/spells.js"'),
  "scoring should read spell valuation through the scoring spells module",
);
assert.ok(
  scoringSpellsSource.includes("export function spellTacticalAdjustment")
    && scoringSpellsSource.includes("export function isRangeBuffSetup")
    && scoringSpellsSource.includes("export function rangeBuffIsNeeded"),
  "scoring spells should own spell resource valuation, range-buff setup detection, and reach-spell need checks",
);
for (const pattern of [
  "spellTacticalAdjustment",
  "isRangeBuffSetup",
  "spellHasReachableTarget",
  "rangeBuffIsNeeded",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own scoring spell helper ${pattern}`,
  );
}
assert.ok(
  scoringSource.includes('from "./scoring/gates.js"'),
  "scoring should read hard rejection decisions through the scoring gates module",
);
assert.ok(
  scoringGatesSource.includes("export function blockedCandidateResult")
    && scoringGatesSource.includes("function kineticAuraActive")
    && scoringGatesSource.includes("function isChannelElementsAction"),
  "scoring gates should own hard candidate rejection, redundant kinetic aura checks, and Channel Elements detection",
);
for (const pattern of [
  "blockedCandidateResult",
  "targetMarkLabel",
  "isChannelElementsAction",
  "kineticAuraActive",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own scoring gate helper ${pattern}`,
  );
}
assert.ok(
  scoringSource.includes('from "./scoring/targets.js"'),
  "scoring should choose targets through the scoring targets module",
);
assert.ok(
  scoringSource.includes("../rules/tactic-personality.js")
    && scoringSource.includes("tacticPersonalityAdjustment"),
  "scoring should apply tactic personality adjustments through the tactic personality module",
);
assert.ok(
  aggroSource.includes("./tactic-personality.js")
    && aggroSource.includes("tacticPersonalityTargetAdjustment"),
  "aggro target choice should apply tactic personality target preferences",
);
assert.ok(
  tacticPersonalitySource.includes("export function resolveTacticPersonality")
    && tacticPersonalitySource.includes("function inferTacticPersonality")
    && tacticPersonalitySource.includes("effectiveRole")
    && tacticPersonalitySource.includes("effectiveTemperament")
    && tacticPersonalitySource.includes("export function tacticPersonalityAdjustment")
    && tacticPersonalitySource.includes("export function tacticPersonalityTargetAdjustment")
    && tacticPersonalitySource.includes("export function tacticPersonalityView"),
  "tactic personality module should own flag resolution, Auto inference, effective scoring, target scoring, and view data",
);
assert.ok(
  scoringTargetsSource.includes("export function bestTargetForAction")
    && scoringTargetsSource.includes("export function distinctTargetsFor")
    && scoringTargetsSource.includes("export function attackableEnemies")
    && scoringTargetsSource.includes("export function canExtractElementFromTarget"),
  "scoring targets should own target pooling, best-target selection, multi-target selection, and kineticist extraction target checks",
);
for (const pattern of [
  "offensiveTargetValue",
  "canAffectTarget",
  "targetPoolForAction",
  "bestTargetForAction",
  "distinctTargetsFor",
  "attackableEnemies",
  "isExtractElementAction",
  "canExtractElementFromTarget",
  "kineticistElementProfiles",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own target selection helper ${pattern}`,
  );
}
assert.ok(
  scoringSource.includes('from "./scoring/tactics.js"'),
  "scoring should delegate role and slug score composition through the scoring tactics module",
);
assert.ok(
  scoringTacticsSource.includes("export function scoreRoleTactics")
    && scoringTacticsSource.includes("export function suggestedTargetFor"),
  "scoring tactics should own suggested targets and orchestrate tactical score/reason composition",
);
assert.ok(
  scoringTacticsSource.includes('from "./role-tactics.js"')
    && scoringRoleTacticsSource.includes("export function scoreCuratedRoleTactics")
    && scoringRoleTacticsSource.includes('"area-damage": areaDamageTactic')
    && scoringRoleTacticsSource.includes("buff: buffTactic")
    && scoringRoleTacticsSource.includes("defense: defenseTactic"),
  "scoring role tactics should own curated role score/reason blocks",
);
assert.ok(
  scoringTacticsSource.includes('from "./activity-tactics.js"')
    && scoringActivityTacticsSource.includes("export function scoreActivityProfileTactics")
    && scoringActivityTacticsSource.includes("ScoreReason.MovesOutOfMeleeBefore")
    && scoringActivityTacticsSource.includes("ScoreReason.FlanksForAnOffGuard")
    && scoringActivityTacticsSource.includes("ScoreReason.EnemiesAreInReachFor"),
  "scoring activity tactics should own move-and-strike, flank/skirmish, and multi-strike activity score blocks",
);
assert.ok(
  scoringTacticsSource.includes('from "./tactic-helpers.js"')
    && scoringTacticHelpersSource.includes("export function baseScore")
    && scoringTacticHelpersSource.includes("export function defaultReason")
    && scoringTacticHelpersSource.includes("export function includesStand")
    && scoringTacticHelpersSource.includes("export function profileReach"),
  "scoring tactic helpers should own shared base scoring, default reasons, stand detection, and reach helpers",
);
for (const pattern of [
  "profileSpeed",
  "profileReach",
  "strikeDamageScore",
  "suggestedTargetFor",
  "attackCenter",
  "scoreRoleTactics",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(scoringSource),
    false,
    `scoring should not own tactical scoring helper ${pattern}`,
  );
}
for (const pattern of [
  'role === "area-damage"',
  "ScoreReason.GrantsQuickened",
  "ScoreReason.DefensiveReactionIsAvailableFor",
  'ScoreReason.CanRecoverHitPoints',
]) {
  assert.equal(
    scoringTacticsSource.includes(pattern),
    false,
    `scoring tactics should not own curated role block ${pattern}`,
  );
}
for (const pattern of [
  "ScoreReason.MovesOutOfMeleeBefore",
  "ScoreReason.FlanksForAnOffGuard",
  "ScoreReason.EnemiesAreInReachFor",
  "ScoreReason.FocusesAttacksOn",
]) {
  assert.equal(
    scoringTacticsSource.includes(pattern),
    false,
    `scoring tactics should not own activity-profile score block ${pattern}`,
  );
}
assert.equal(
  areaPickerSource.includes('from "../engine/action/executor.js"'),
  false,
  "area picker should not depend on action execution to preview region geometry",
);
assert.equal(
  /export function createAreaRegionData\s*\(/.test(actionExecutorSource)
    || /export function tokensInAreaMarker\s*\(/.test(actionExecutorSource),
  false,
  "action executor should not own area region data or area hit-testing helpers",
);
for (const [source, label] of [
  [actionBuilderSource, "action builder"],
  [areaPickerSource, "area picker"],
  [actionPreviewSource, "action preview"],
]) {
  for (const pattern of ["actionShape", "actionDistance", "actionWidth", "areaMarkerDistance", "areaMarkerWidth", "areaMarkerLabel"]) {
    assert.equal(
      new RegExp(`function ${pattern}\\s*\\(`).test(source),
      false,
      `${label} should not duplicate area marker primitive ${pattern}`,
    );
  }
}
assert.ok(
  movementPreviewSource.includes('from "../rules/canvas-geometry.js"'),
  "movement preview should use the shared canvas geometry module for wall collision and reach geometry",
);
assert.ok(
  actionReachSource.includes('from "../../rules/canvas-geometry.js"'),
  "action reach should use the shared canvas geometry module for wall collision and reach geometry",
);
assert.ok(
  actionReaderSource.includes('from "./reach.js"') && mainSource.includes('from "./readers/action/reach.js"'),
  "action reader and main should use the action reach module instead of owning reach-cache internals",
);
assert.ok(
  canvasGeometrySource.includes("canvasMovementPathBlocked") && canvasGeometrySource.includes("canReachPlacementPerimeter"),
  "canvas geometry module should own Foundry movement collision and reach-perimeter helpers",
);
assert.ok(
  canvasGeometrySource.includes("canvasGridSize")
    && canvasGeometrySource.includes("canvasGridDistance")
    && canvasGeometrySource.includes("canvasDistancePixels")
    && canvasGeometrySource.includes("canvasPoint")
    && canvasGeometrySource.includes("contextTokenId")
    && canvasGeometrySource.includes("canvasTokenById"),
  "canvas geometry module should own canvas grid metrics, point parsing, live token lookup, and feet-to-pixels conversion",
);
assert.ok(
  areaRegionSource.includes('from "../../rules/canvas-geometry.js"')
    && actionPreviewSource.includes('from "../../rules/canvas-geometry.js"')
    && rangeOverlaySource.includes('from "../rules/canvas-geometry.js"')
    && executionTargetsSource.includes('from "../../rules/canvas-geometry.js"')
    && executionMovementSource.includes('from "../../rules/canvas-geometry.js"')
    && areaPickerSource.includes('from "../rules/canvas-geometry.js"')
    && destinationPickerSource.includes('from "../rules/canvas-geometry.js"')
    && movementPreviewSource.includes('from "../rules/canvas-geometry.js"')
    && actionReachSource.includes('from "../../rules/canvas-geometry.js"'),
  "area region, preview/picker UI, execution modules, and action reach should share canvas helpers through canvas geometry",
);
for (const [source, label] of [
  [areaRegionSource, "area region"],
  [actionPreviewSource, "action preview"],
  [rangeOverlaySource, "range overlay"],
  [areaPickerSource, "area picker"],
  [destinationPickerSource, "destination picker"],
  [movementPreviewSource, "movement preview"],
  [actionReachSource, "action reach"],
]) {
  for (const pattern of ["gridSize", "gridDistance", "distancePixels", "canvasTokenById"]) {
    assert.equal(
      new RegExp(`function ${pattern}\\s*\\(`).test(source),
      false,
      `${label} should not duplicate canvas metric helper ${pattern}`,
    );
  }
}
for (const pattern of ["gridSize", "gridDistance"]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not duplicate canvas metric helper ${pattern}`,
  );
}
for (const pattern of ["numeric", "point", "pixelScale"]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(rangeOverlaySource),
    false,
    `range overlay should not duplicate canvas geometry helper ${pattern}`,
  );
}
assert.ok(
  executionTargetsSource.includes("return contextTokenId(context);")
    && executionTargetsSource.includes("return canvasTokenByIdFromCanvas(id);"),
  "execution targets should preserve token lookup exports by delegating to canvas geometry",
);
for (const [source, label] of [
  [movementPreviewSource, "movement preview"],
  [actionReachSource, "action reach"],
  [battlefieldAnalysisSource, "battlefield analysis"],
]) {
  for (const pattern of [
    "rayForPoints",
    "wallDocument",
    "wallBlocksMovement",
    "wallBlocksLine",
    "wallEndpoints",
    "pointOnSegment",
    "segmentsIntersect",
    "wallSegment",
    "wallSegmentsBlockMovement",
    "wallSegmentsBlockLine",
    "rectangleDistance",
    "rectangleDistanceFeet",
    "gridReachDistance",
    "gridReachDistanceFeet",
    "perimeterSamplePoints",
    "nearestPoints",
  ]) {
    assert.equal(
      new RegExp(`function ${pattern}\\s*\\(`).test(source),
      false,
      `${label} should not duplicate canvas geometry helper ${pattern}`,
    );
  }
}
assert.equal(
  actionExecutorSource.includes("movementPreviewForStep"),
  false,
  "movement execution validation should not depend on movement-preview",
);
assert.ok(
  movementPreviewSource.includes("routeCornerWaypoints as engineRouteCornerWaypoints"),
  "movement preview should re-export route corner helper from the engine movement route module",
);
assert.equal(
  movementPreviewSource.includes("export function routeCornerWaypoints"),
  false,
  "movement preview should not keep its own duplicate route corner helper implementation",
);
assert.ok(
  movementPreviewSource.includes("reachableMovementCenters as engineReachableMovementCenters"),
  "movement preview should use engine reachable-area route module",
);
assert.equal(
  movementPreviewSource.includes("function reachableCenters"),
  false,
  "movement preview should not keep its own reachable-center grid generator",
);
assert.equal(
  movementPreviewSource.includes("function movementStepCost"),
  false,
  "movement preview should not keep unused route-cost helper duplication",
);
assert.ok(
  movementPreviewSource.includes("directMovementRouteToCenter as engineDirectMovementRouteToCenter"),
  "movement preview should use engine direct route search",
);
assert.equal(
  movementPreviewSource.includes("function routePriority"),
  false,
  "movement preview should not keep its own direct-route priority helper",
);
assert.equal(
  movementPreviewSource.includes("function movementHeuristic"),
  false,
  "movement preview should not keep its own direct-route heuristic helper",
);
assert.ok(
  actionReachSource.includes("reachableMovementCenters as engineReachableMovementCenters"),
  "action reach should use the engine movement route reachable-area module",
);
assert.ok(
  actionReachSource.includes("movementFootprintForToken"),
  "action reach should parse token footprints through the movement route module",
);
assert.ok(
  actionReachSource.includes("movementPlacementForCenter"),
  "action reach should build token-center placements through the movement route module",
);
assert.equal(
  /function tokenFootprintPixels\s*\(/.test(actionReaderSource),
  false,
  "action reader should not duplicate token footprint parsing",
);
assert.equal(
  /function rectangleForCenter\s*\(/.test(actionReaderSource),
  false,
  "action reader should not duplicate token placement rectangle math",
);
assert.equal(
  /function centerOccupiedByOtherToken\s*\(/.test(actionReaderSource),
  false,
  "action reader should not keep dead occupancy filtering after reachable centers moved to movement route",
);
assert.equal(
  /function rectanglesOverlap\s*\(/.test(actionReaderSource),
  false,
  "action reader should not keep dead occupancy overlap math",
);
assert.ok(
  battlefieldAnalysisSource.includes("movementPlacementForCenter"),
  "battlefield analysis should use shared token placement helper",
);
assert.equal(
  battlefieldAnalysisSource.includes('from "../engine/'),
  false,
  "battlefield analysis should not import engine modules for token geometry",
);
assert.equal(
  /function footprint\s*\(/.test(battlefieldAnalysisSource),
  false,
  "battlefield analysis should not duplicate token footprint parsing",
);
assert.equal(
  /function rectangleForCenter\s*\(/.test(battlefieldAnalysisSource),
  false,
  "battlefield analysis should not duplicate token placement rectangle math",
);
assert.ok(
  actionBuilderSource.includes('from "./projection.js"'),
  "action builder should delegate area marker and draft destination projection to the action builder projection module",
);
assert.ok(
  actionBuilderProjectionSource.includes("export function computeAreaMarker")
    && actionBuilderProjectionSource.includes("export function projectContextForDraftDestination")
    && actionBuilderProjectionSource.includes("export function projectContextForDraftStepOrigin")
    && actionBuilderProjectionSource.includes('from "../../plan-state.js"'),
  "action builder projection should own area markers and delegate draft state projection to plan state",
);
for (const pattern of [
  "computeAreaMarker",
  "projectContextForDraftDestination",
  "projectContextForDraftStepOrigin",
  "draftShieldCombatState",
  "projectContextToOrigin",
  "footprintDistanceFeet",
]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionBuilderSource),
    false,
    `action builder should not own projection helper ${pattern}`,
  );
}
assert.ok(
  planStateSource.includes("export function createPlanState")
    && planStateSource.includes("export function advancePlanState")
    && planStateSource.includes("export function projectContextFromPlanState")
    && planStateSource.includes("export function planStateSignature")
    && planStateSource.includes("export function evaluatePlan")
    && planStateSource.includes("footprintPathDistanceFeet")
    && plannerSource.includes('from "./plan-state.js"'),
  "planner and action builder should share one deep plan-state simulator and footprint-aware projection",
);
assert.equal(
  /function footprintCentersAt\s*\(/.test(actionBuilderSource),
  false,
  "action builder should not duplicate footprint center generation",
);
assert.ok(
  combatContextSource.includes("movementFootprintCentersForToken"),
  "combat context should use shared token footprint center helper for live distances",
);
assert.equal(
  actionReaderSource.includes("pf2eMovementSegmentCost"),
  false,
  "action reader should not carry its own PF2e segment-cost route loop",
);
assert.equal(
  actionReaderSource.includes("function movementNeighbors"),
  false,
  "action reader should not duplicate movement-route neighbor expansion",
);
assert.ok(
  destinationPickerSource.includes("movementBudgetForStep"),
  "destination picker should use movement route budget helper",
);
assert.equal(
  destinationPickerSource.includes("function typedMovementSpeed"),
  false,
  "destination picker should not duplicate typed movement speed lookup",
);
assert.ok(
  destinationPickerSource.includes("movementPlanForDestination as engineMovementPlanForDestination"),
  "destination picker should build routed destination movement plans through the movement route module",
);
assert.equal(
  /function movementRoutePlanForDestination\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not duplicate routed destination movement plan construction",
);
assert.ok(
  executionMovementSource.includes("movementRouteForStep"),
  "movement execution should ask movement route for destination verdicts",
);
assert.equal(
  executionMovementSource.includes("movementBudgetForStep"),
  true,
  "movement execution should compare Foundry/PF2e's native measured cost with the action's movement budget",
);
assert.ok(
  executionMovementSource.includes("measureMovementPath"),
  "movement execution should use the live PF2e token as its final movement-cost oracle",
);
assert.equal(
  executionMovementSource.includes("const maxCost = movementBudgetForStep"),
  false,
  "movement execution should not duplicate the route module's old maxCost flow",
);
assert.equal(
  /actor:\s*\{\s*\.\.\.\(context\?\.actor/.test(executionMovementSource),
  false,
  "movement execution should not synthesize actor speed for route validation",
);
assert.equal(
  executionMovementSource.includes("function movementMaxCostForAction"),
  false,
  "movement execution should not duplicate movement budget rules",
);
assert.equal(
  executionMovementSource.includes("function movementValidationOrigin"),
  false,
  "movement execution should not duplicate movement origin rules",
);
assert.equal(
  actionExecutorSource.includes('from "./movement-route.js"'),
  false,
  "action executor should not depend directly on movement routes after movement execution split",
);
for (const pattern of ["isTeleportAction", "teleportTokenTo", "executeMovement", "movementOrigin", "executeTeleport"]) {
  assert.equal(
    new RegExp(`function ${pattern}\\s*\\(`).test(actionExecutorSource),
    false,
    `action executor should not keep movement helper ${pattern}`,
  );
}
assert.ok(
  movementPreviewSource.includes("movementHorizontalBudgetForStep"),
  "movement preview should use movement route horizontal budget helper",
);
assert.equal(
  movementPreviewSource.includes("function movementDistanceFeet"),
  false,
  "movement preview should not duplicate movement distance budget rules",
);
assert.equal(
  movementPreviewSource.includes("function movementSpeedFeet"),
  false,
  "movement preview should not duplicate movement speed lookup rules",
);
assert.ok(
  movementPreviewSource.includes("movementDestinationForStep"),
  "movement preview should parse destinations through the movement route module",
);
assert.equal(
  /function explicitDestination\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate movement destination parsing",
);
assert.ok(
  movementPreviewSource.includes("movementWaypointsForStep"),
  "movement preview should parse waypoints through the movement route module",
);
assert.equal(
  movementPreviewSource.includes("function explicitWaypointCenters"),
  false,
  "movement preview should not duplicate movement waypoint parsing",
);
assert.ok(
  movementPreviewSource.includes("movementRouteSegmentCost"),
  "movement preview should use movement route segment-cost helper",
);
assert.equal(
  movementPreviewSource.includes("pf2eMovementSegmentCost"),
  false,
  "movement preview should not import raw PF2e segment-cost rules",
);
assert.ok(
  movementPreviewSource.includes("movementRouteForStep"),
  "movement preview should validate explicit destinations through the movement route module",
);
assert.equal(
  movementPreviewSource.includes("const routeContext ="),
  false,
  "movement preview should not synthesize route contexts now movement route accepts origin and collision token adapters",
);
assert.equal(
  /function validateWaypointPath\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate waypoint route validation",
);
assert.equal(
  /function explicitDestinationReason\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate route illegal-reason selection",
);
assert.equal(
  /function teleportRangeFeet\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate teleport movement budget rules",
);
assert.ok(
  /function movementRouteOptions\s*\(/.test(movementPreviewSource),
  "movement preview should keep Foundry route adapters behind one movement route options helper",
);
assert.equal(
  /function directRouteToCenter\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not keep a pass-through direct-route helper",
);
assert.equal(
  /function movementSegmentCost\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not keep a pass-through segment-cost helper",
);
assert.ok(
  movementPreviewSource.includes("movementOriginForContext"),
  "movement preview should use movement route origin helper",
);
assert.equal(
  movementPreviewSource.includes("const origin = point(context?.token)"),
  false,
  "movement preview should not duplicate direct token-center origin selection",
);
assert.equal(
  /function centerOccupiedByOtherToken\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not keep duplicate occupancy filtering after reachable centers moved to movement route",
);
assert.equal(
  /function rectanglesOverlap\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not keep occupancy rectangle math owned by movement route",
);
assert.ok(
  movementPreviewSource.includes("movementFootprintForToken as tokenFootprint"),
  "movement preview should read token footprint through the movement route module",
);
assert.ok(
  movementPreviewSource.includes("movementPlacementForCenter as placementForCenter"),
  "movement preview should build token placements through the movement route module",
);
assert.equal(
  /function placementForCenter\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate token placement rectangle math",
);
assert.equal(
  /function tokenFootprint\s*\(/.test(movementPreviewSource),
  false,
  "movement preview should not duplicate token footprint parsing",
);
assert.ok(
  destinationPickerSource.includes("movementFootprintForToken"),
  "destination picker should read token footprint through the movement route module",
);
assert.equal(
  /function tokenFootprintCells\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not duplicate token footprint parsing",
);
assert.ok(
  executionMovementSource.includes("movementFootprintForToken"),
  "movement execution should read token footprint through the movement route module",
);
assert.equal(
  /function tokenFootprint\s*\(/.test(executionMovementSource),
  false,
  "movement execution should not duplicate token footprint parsing",
);
assert.ok(
  destinationPickerSource.includes("movementPlanForWaypoints as engineMovementPlanForWaypoints"),
  "destination picker should build waypoint movement plans through the movement route module",
);
assert.equal(
  /function verticalPathCost\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not duplicate vertical waypoint path cost",
);
assert.equal(
  /function movementPlanForWaypoints\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not duplicate waypoint movement plan construction",
);
assert.ok(
  destinationPickerSource.includes("pf2eTokenMovementActionForStep"),
  "destination picker should use shared PF2e token movement action rules",
);
assert.equal(
  /function movementActionForAction\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not duplicate action-to-token-movement mapping",
);
assert.equal(
  /function actionSlug\s*\(/.test(destinationPickerSource),
  false,
  "destination picker should not keep slug parsing only for duplicated movement action mapping",
);
assert.ok(
  executionMovementSource.includes("pf2eTokenMovementActionForStep"),
  "movement execution should use shared PF2e token movement action rules",
);
assert.equal(
  /function movementActionForAction\s*\(/.test(executionMovementSource),
  false,
  "movement execution should not duplicate action-to-token-movement mapping",
);
assert.equal(
  GENERIC_ACTIONS.find((action) => action.slug === "raise-a-shield")?.uuid,
  "Compendium.pf2e.actionspf2e.Item.xjGwis0uaC2305pm",
  "Raise a Shield should open the PF2e system action compendium entry",
);
assert.ok(
  /_openActionDetails\(step\)[\s\S]*renderSheetFromUuid/.test(panelSource),
  "action details should resolve compendium UUIDs before chat guidance fallback",
);
assert.equal(panelSource.includes("combater is advisory only"), false, "execution should no longer be advisory-only");
assert.ok(panelContextWorkflowSource.includes("readSharedDraftPlan(context)"), "GM panel should read shared player draft plans");
assert.ok(mainSource.includes("receiveSharedDraft"), "main should register a handler that receives shared player draft plans");
assert.ok(panelViewModelSource.includes("isPlayerPlan"), "GM header should know when displayed draft is a player plan");
assert.ok(panelTemplateSource.includes("combater-player-plan-badge"), "GM header should show a visible player-plan badge");
assert.ok(
  panelStyleSource.includes(".pf2e-combater .combater-player-plan-badge"),
  "player-plan badge should have explicit header styling",
);
assert.ok(
  panelContextWorkflowSource.includes("gmViewingPlayerPlan"),
  "GM PC view should be a player-plan mirror instead of an editable GM draft",
);
assert.equal(
  panelSource.includes("const useSharedDraft = !loadedSharedDraft"),
  false,
  "loaded/shared GM player plans should keep following live player socket updates",
);
assert.equal(
  panelSource.includes("const sharedDraftAvailable = Boolean(sharedDraft?.steps?.length);"),
  false,
  "empty player shared drafts should still count as live updates so GM views clear stale plans",
);
assert.ok(
  /const useSharedDraft = gmEditingOfflinePlayerPlan[\s\S]*shouldDisplaySharedDraft\(draft, sharedDraft\)/.test(panelContextWorkflowSource),
  "shared-draft display decision should allow loaded shared drafts to be replaced by newer player payloads",
);
assert.ok(panelContextWorkflowSource.includes("hasSharedDraftPlan(sharedDraft)"), "GM panel should treat empty player drafts as known shared plans");
assert.ok(
  panelContextWorkflowSource.includes("isPlayerControlledActor"),
  "panel should detect player-controlled actors before allowing GM draft edits",
);
// Regression: an absent player's owned character used to leave the GM with an empty, read-only
// player-plan mirror. Offline ownership must remain detectable so the GM edits the actor-backed
// shared plan; any connected co-owner keeps it read-only to prevent competing writes.
assert.ok(
  panelContextWorkflowSource.includes("owners.every((candidate) => candidate?.active !== true)"),
  "GM player-plan editing should require every owning player to be offline",
);
// The offline-GM edit path intentionally stays on the shared draft, including before the first
// step exists, so actor-flag persistence and player ownership metadata remain intact.
assert.ok(
  /const activeDraft = \(gmViewingPlayerPlan && useSharedDraft\)/.test(panelContextWorkflowSource),
  "GM player-plan access should use the shared draft path",
);
assert.ok(
  /panel\._builder\.readonly = .*gmViewingPlayerPlan && !gmEditingOfflinePlayerPlan/.test(panelContextWorkflowSource),
  "GM PC view should be editable only while the owning players are offline",
);
assert.ok(
  panelTemplateSource.includes("{{#unless builder.readonly}}"),
  "GM PC view should hide top-level edit controls",
);
assert.ok(
  panelTemplateSource.includes("{{#unless readonly}}"),
  "GM PC view should hide per-action edit controls",
);
assert.ok(
  panelSource.includes("_syncDraftToGM"),
  "player draft mutations should sync plan to GM automatically",
);
assert.ok(
  panelDraftWorkflowSource.includes("writeSharedDraftPlanActorFlag"),
  "player draft sync should mirror the plan onto the owned actor so GM clients update even if module socket delivery is missed",
);
assert.ok(
  /addPanelAction\(panel, actionKey\)[\s\S]*panel\._writeActiveDraftPlan\(markManualDraft\(/.test(panelDraftWorkflowSource),
  "adding an action should sync updated player plan to GM",
);
// A persisted display name keeps a step readable after its action stops being generated (e.g. a
// drawn weapon no longer offers its Draw action), instead of falling back to the raw action key.
assert.ok(
  /addPanelAction\(panel, actionKey\)[\s\S]*name: atom\?\.name/.test(panelDraftWorkflowSource),
  "added plan steps should persist a display name",
);
assert.ok(
  /addPanelUncountedAction\(panel, actionKey\)[\s\S]*name: atom\?\.name/.test(panelDraftWorkflowSource),
  "added uncounted steps should persist a display name",
);
// A self-centered area (an emanation) has only one possible location -- pre-fill it the same way
// Auto-fill already does, instead of forcing a "Place template" prompt with no real choice to make.
assert.ok(
  /addPanelAction\(panel, actionKey\)[\s\S]*computeAreaMarker\(panel\._context, atom\)[\s\S]*presetAreaMarker \? \{ areaMarker: presetAreaMarker \}/.test(panelDraftWorkflowSource),
  "manually adding an action should pre-fill a self-computable area marker (e.g. an emanation), not force a placement prompt",
);
assert.ok(
  /addPanelUncountedAction\(panel, actionKey\)[\s\S]*computeAreaMarker\(panel\._context, atom\)[\s\S]*presetAreaMarker \? \{ areaMarker: presetAreaMarker \}/.test(panelDraftWorkflowSource),
  "manually adding an uncounted action should pre-fill a self-computable area marker (e.g. an emanation), not force a placement prompt",
);
// A self-centered area (an emanation) or a target-centered one (e.g. Circle of Protection) has
// nothing to manually place -- the "Place template" button itself should never render for either,
// unlike a burst/cone/line, which genuinely needs a picked point.
assert.ok(
  /const requiresManualArea = requiresArea[\s\S]*?!isSelfCenteredAreaAction\(requirementAction\)[\s\S]*?!isTargetCenteredAreaAction\(requirementAction\)[\s\S]*const canChooseArea = requiresManualArea/.test(panelViewModelSource),
  "decorateDraftStep should gate the manual area-placement button separately from requiresArea, excluding both self- and target-centered areas",
);
assert.equal(panelTemplateSource.includes("{{#if requiresArea}}"), false, "the template should gate the placement button on canChooseArea, not the raw requiresArea flag");
assert.ok(
  (panelTemplateSource.match(/data-choose-area="\{\{instanceId\}\}"/g) ?? []).length === 2
    && (panelTemplateSource.match(/\{\{#if canChooseArea\}\}[\s\S]*?data-choose-area="\{\{instanceId\}\}"/g) ?? []).length === 2,
  "both the step-chip and uncounted-row placement buttons should be gated on canChooseArea",
);
assert.ok(
  /removePanelDraftStep\(panel, instanceId\)[\s\S]*panel\._writeActiveDraftPlan\(markManualDraft\(/.test(panelDraftWorkflowSource),
  "removing an action should sync updated player plan to GM",
);
assert.ok(
  panelTemplateSource.includes("data-duplicate-draft-step"),
  "each draft step should expose a duplicate control",
);
assert.ok(
  panelViewModelSource.includes("canDuplicateStep")
    && /\{\{#if canDuplicateStep\}\}[\s\S]*?data-duplicate-draft-step="\{\{instanceId\}\}"/.test(panelTemplateSource),
  "the duplicate control should be gated by the view model so grouped composite atoms and minion command parents can't be duplicated individually",
);
assert.ok(
  /duplicatePanelDraftStep\(panel, instanceId\)[\s\S]*draftStepId\(\)[\s\S]*panel\._writeActiveDraftPlan\(markManualDraft\(/.test(panelDraftWorkflowSource),
  "duplicating a step should clone it with a fresh instanceId and persist through the same manual-draft write path as remove/move",
);
assert.ok(
  /autoFillPanelDraft\(panel, \{ plan = null, forceFull = false, preparedPlans = null \} = \{\}\)[\s\S]*source: "auto-fill"[\s\S]*panel\._writeActiveDraftPlan\(/.test(panelDraftWorkflowSource),
  "auto-fill should sync updated player plan to GM",
);
assert.ok(
  panelDraftWorkflowSource.includes("const contextualPlan = refreshedPlanForStaleSelection(plan, currentPlans)")
    && panelDraftWorkflowSource.includes(": bestAutoFillPlan(currentPlans)"),
  "pressing Auto-fill should load the best currently displayed plan even after cycling alternatives",
);
assert.ok(
  /autoFillPanelDraft\(panel, \{ plan = null, forceFull = false, preparedPlans = null \} = \{\}\) \{[\s\S]*if \(panel\._autoFillInFlight\) return;[\s\S]*panel\._autoFillInFlight = true;[\s\S]*\} finally \{[\s\S]*panel\._autoFillInFlight = false;/.test(panelDraftWorkflowSource),
  "a second Auto-fill invocation while one is already running must be a no-op -- two overlapping runs previously corrupted the resulting draft (e.g. a Stride wrongly warning the actor is prone)",
);
assert.ok(
  /actionKeyForPanelStep\(panel, step\)[\s\S]*step\?\.item\?\.uuid && candidate\.item\?\.uuid === step\.item\.uuid/.test(panelDraftWorkflowSource),
  "re-matching a draft step to its live candidate must not fall back to an item.uuid comparison when the step has no item at all -- an unguarded === there matched undefined against undefined, mis-keying any generic item-less action (Stride, Demoralize, ...) to whichever OTHER item-less candidate happened to sort first that pass",
);
assert.ok(
  /autoFillPanelDraft\(panel, \{ plan = null, forceFull = false, preparedPlans = null \} = \{\}\)[\s\S]*if \(!plan\) panel\._pinnedPlanId = null/.test(panelDraftWorkflowSource),
  "pressing Auto-fill should reset the alternative-plan cursor",
);
assert.ok(
  /onChoose: (?:async )?\(destination, metadata = \{\}\) =>[\s\S]*_persistActiveDraftStep\(/.test(panelPickerWorkflowSource),
  "choosing a movement destination should persist the updated plan",
);
assert.ok(
  /persistPanelActiveDraftStep\(panel, step, listKey\)[\s\S]*await panel\._syncDraftToGM\(\)/.test(panelDraftWorkflowSource),
  "persisting a draft step (local mode) should sync the player plan to GM",
);
// GM-executes-player-plan: the GM can run a shared plan on an AFK player's behalf, writing execution
// state back to the shared draft rather than the GM's local one.
assert.ok(
  panelSource.includes("_gmExecuteMode") && panelSource.includes("_canExecuteDraft"),
  "panel should support GM execution of a player's shared plan",
);
assert.ok(
  /writePanelActiveSharedDraft\(panel, draft\)[\s\S]*writeSharedDraftPlanActorFlag/.test(panelDraftWorkflowSource),
  "GM execution should write the shared draft back to the owned actor flag",
);
assert.ok(
  panelViewModelSource.includes("const canShowExecuteStep = !minionPlanAsChildren && canRunStep")
  && /canExecuteStep:[^\n]*canShowExecuteStep/.test(panelViewModelSource)
  && /canReset:[^\n]*canRunPlayerPlan/.test(panelViewModelSource),
  "per-step execute/reset controls should be enabled for a GM viewing a player's shared plan",
);
assert.ok(
  panelViewModelSource.includes("executionReadinessForStep(step, action ?? step)"),
  "draft-step decoration should compute execution readiness from stored dependencies",
);
assert.ok(
  /canExecuteStep:[^\n]*readiness\.status === "ready"/.test(panelViewModelSource),
  "play execution should only be enabled once target/template/destination dependencies are ready",
);
assert.ok(
  panelTemplateSource.includes("{{#if canShowExecuteStep}}")
  && panelTemplateSource.includes("{{#if executionBlocked}}disabled{{/if}}"),
  "missing dependencies should leave a disabled play button instead of an executable play button",
);
assert.ok(
  panelStyleSource.includes(".combater-chip-tool:disabled")
  && panelStyleSource.includes(".combater-step-run.is-execute:disabled"),
  "disabled play buttons should have explicit non-active styling",
);
assert.equal(
  panelSource.includes("this._handleExecutionChoice(step, readiness.choices[0], event);"),
  false,
  "clicking play with missing dependencies should not auto-open target/template/destination pickers",
);
assert.ok(
  panelExecutionWorkflowSource.includes("globalThis.ui?.notifications?.warn?.(readiness.warning"),
  "manual execute attempts with missing dependencies should warn instead of executing",
);
assert.ok(
  /executePanelDraftStep\(panel, instanceId, event\)[\s\S]*?if \(!panel\._canExecuteDraft\(\)\) return;/.test(panelExecutionWorkflowSource),
  "executing a draft step should allow GM execution, not just editing",
);
assert.ok(
  /canRevertStep: !minionPlanAsChildren && isExecutionDone && canRunStep/.test(panelViewModelSource),
  "per-step revert should be available to the owner or a GM running a player's shared plan",
);
assert.ok(
  panelTemplateSource.includes("{{#if canRevertStep}}"),
  "step template should gate per-step revert on canRevertStep, not raw readonly",
);
assert.ok(
  panelDraftWorkflowSource.includes("silent: !notify"),
  "automatic player plan sync should mark socket payloads silent",
);
const autoFillDraftWorkflowSource = panelDraftWorkflowSource.match(
  /export async function autoFillPanelDraft[\s\S]*?(?=\nexport async function fillPanelDraftGap)/,
)?.[0] ?? "";
const cycleAutoFillWorkflowSource = panelDraftWorkflowSource.match(
  /export async function cyclePanelAutoFillDraft[\s\S]*?(?=\nexport async function syncPanelDraftToGM)/,
)?.[0] ?? "";
assert.equal(
  autoFillDraftWorkflowSource.includes("refreshPanelAutoFillContext"),
  false,
  "Auto-fill should use plans already prepared for the visible panel instead of rebuilding them on click",
);
assert.equal(
  cycleAutoFillWorkflowSource.includes("refreshPanelAutoFillContext"),
  false,
  "cycling Auto-fill should reuse the visible plan list instead of rebuilding it before selecting the next plan",
);
assert.ok(
  panelSource.includes("this._fillGapPlanCache")
    && panelSource.includes("this._fillGapPlanCacheKey === cacheKey")
    && /_fillGapPlans\(\)[\s\S]*?includeCoverage: false/.test(panelSource)
    && !/preparePanelContext\(panel\)[\s\S]{0,220}panel\._fillGapPlanCache = null/.test(panelContextWorkflowSource),
  "remaining-budget Auto-fill plans should survive unrelated renders and skip exhaustive coverage work",
);
assert.ok(
  panelSource.includes("this._autoFillPreparationCache = null")
    && /async refresh\(refreshSource = "manual"\)[\s\S]*?this\._autoFillPreparationCache = null/.test(panelSource)
    && panelContextWorkflowSource.includes("const baseBuild = preparationCache?.baseBuild")
    && panelContextWorkflowSource.includes("panel._autoFillPreparationCache = {"),
  "draft-only renders should reuse the unchanged full-turn candidate/plan search while every external refresh invalidates it",
);
assert.equal(
  panelContextWorkflowSource.includes("buildTurnPlans(planningContext"),
  false,
  "panel render should not run a second projected planner search after its authoritative Auto-fill plan list is already built",
);
assert.ok(
  /const autoFillPlans[\s\S]*?buildTurnPlans\(autoFillContext,[\s\S]*?includeCoverage: false/.test(panelContextWorkflowSource)
    && /rebuildPanelAutoFillContext\(panel[\s\S]*?buildTurnPlans\(focusedContext, candidateBuild\.candidates, \{ includeCoverage: false \}\)/.test(panelDraftWorkflowSource),
  "interactive panel planning should keep exhaustive legal-action coverage in Browse instead of blocking refresh and target-change buttons",
);
assert.ok(
  panelContextWorkflowSource.includes("const needsProjectedCandidates = Boolean(panel._browser)")
    && panelContextWorkflowSource.includes("needsProjectedCandidates ? buildCandidates(planningContext) : baseBuild"),
  "main panel should defer projected Browse candidate generation until debug/browser UI needs it",
);
assert.ok(
  panelContextWorkflowSource.includes("const draftStepActions = needsProjectedCandidates")
    && panelContextWorkflowSource.includes("? projectedDraftStepActions(context, activeDraft)")
    && panelContextWorkflowSource.includes(": null;"),
  "main panel should defer per-step projected candidate scans until debug/browser UI needs their diagnostics",
);
assert.ok(
  /return steps\.filter\(\(step, index\) => \{[\s\S]*?if \(!isStrikeLikeAutoFillStep\(panel, step\)\) return true;[\s\S]*?findProjectedDraftAction/.test(panelDraftWorkflowSource),
  "Auto-fill reachability cleanup should not rebuild all candidates for non-Strike steps",
);
assert.ok(
  /syncPanelAutoFillTargets\(panel, draft = null\)[\s\S]*?targetKey === panel\._autoFillTargetKey\) return null;[\s\S]*?rebuildPanelAutoFillContext/.test(panelDraftWorkflowSource),
  "Auto-fill clicks should run only a target-id comparison unless the live target changed since render",
);
assert.ok(
  /if \(!payload\??\.silent\)/.test(mainSource),
  "GM should not receive notification spam for automatic plan sync",
);
assert.ok(
  /writeSharedDraftPlanPayload\(payload\);\s*scheduleRefresh\("shared-draft"\);/.test(mainSource),
  "shared player draft socket payloads should always refresh an open GM panel",
);
assert.equal(
  mainSource.includes("if (sharedDraftMatchesActiveContext(payload)) scheduleRefresh"),
  false,
  "shared player draft refresh should not be blocked by combatant-id matching drift",
);
assert.ok(
  /Hooks\.on\("updateCombat"[\s\S]*resetMovementPreview\(\);[\s\S]*if \(!setting\(SETTINGS\.autoOpen\) && !activePanel\) return;/.test(mainSource),
  "combat turn updates should clear stride overlay before panel auto-open gating",
);
// Movement refreshes coalesce: each grid step re-arms a longer trailing debounce so a multi-square
// move rebuilds once after it settles, not once per square.
assert.ok(
  /MOVEMENT_REFRESH_SOURCES\s*=\s*new Set\(\[[^\]]*"token-movement"[^\]]*"token-refresh"/.test(mainSource),
  "token movement/refresh sources should be grouped for coalesced refresh",
);
assert.ok(
  /MOVEMENT_REFRESH_SOURCES\.has\(source\)\s*\?\s*MOVEMENT_REFRESH_DELAY_MS\s*:\s*REFRESH_DELAY_MS/.test(mainSource),
  "movement refreshes should use a longer trailing debounce than other refreshes",
);
// A hold-and-drag spawns a preview clone whose position changes every frame; refreshing on it would
// rebuild the plan mid-drag. The refreshToken hook must ignore preview/clone tokens.
assert.ok(
  /Hooks\.on\("refreshToken"[\s\S]*?isPreview[\s\S]*?return;/.test(mainSource),
  "refreshToken should ignore drag-preview/clone tokens",
);
// Grabbing a token to drag selects it (controlToken). Rebuilding the panel for the token it already
// shows is the drag-start hitch — the hook must skip the rebuild when the controlled token is the
// one currently displayed.
assert.ok(
  /Hooks\.on\("controlToken"[\s\S]*?token\.id === activePanel\._context\?\.token\?\.id\) return;/.test(mainSource),
  "controlToken should not rebuild the panel for the token it already displays",
);
assert.ok(panelViewModelSource.includes("hideTarget ? \"\" : decorated.targetLabel"), "panel view-model should support hiding target labels per section");
assert.equal(
  panelSource.includes("toward ${name}"),
  false,
  "movement draft steps should not label an unknown destination as toward a target",
);
assert.ok(
  panelViewModelSource.includes(".filter((action) => !action.favorite)"),
  "All section should omit favorited actions",
);
assert.ok(
  /decorateAction\(action,\s*\{[^}]*hideTarget: true/.test(panelViewModelSource),
  "All section should hide tactical target labels",
);
assert.equal(panelSource.includes("label: \"Recommended\""), false, "panel should not render Recommended inside every tab");
assert.ok(mainSource.includes("getSceneControlButtons"), "main should add a token toolbar toggle");
assert.ok(mainSource.includes("toggle-panel"), "token toolbar should expose combater toggle tool");
assert.ok(mainSource.includes("inlineTurnCombatant("), "automatic panel refresh should follow inline initiative turn");
assert.ok(mainSource.includes("combatant: panelCombatantForAutomaticOpen()"), "automatic panel open should use resolved panel combatant");
assert.ok(
  /function panelCombatantForAutomaticOpen\(\)[\s\S]*game\.user\?\.isGM === true[\s\S]*selectedTokenCombatant\(\) \?\? inlineTurnCombatant\(game\.combat\)/.test(mainSource),
  "GM automatic panel selection should prefer selected token before current combatant",
);
assert.ok(mainSource.includes("function nextOwnedCombatant("), "player automatic panel selection should find next owned combatant");
assert.ok(mainSource.includes("function combatantOwnedByUser("), "player automatic panel selection should check combatant ownership");
assert.ok(
  /function panelCombatantForAutomaticOpen\(\)[\s\S]*nextOwnedCombatant\(game\.combat, game\.user\) \?\? inlineTurnCombatant\(game\.combat\)/.test(mainSource),
  "player automatic panel selection should prefer next owned combatant before active combatant",
);
assert.ok(
  /function panelCombatantForTokenTool\(\)[\s\S]*game\.user\?\.isGM !== true[\s\S]*return panelCombatantForAutomaticOpen\(\);[\s\S]*selectedTokenCombatant\(\) \?\? panelCombatantForAutomaticOpen\(\)/.test(mainSource),
  "token toolbar should use next-owned combatant for players and selected token for GM",
);
assert.ok(mainSource.includes("combatant: panelCombatantForTokenTool()"), "token toolbar should use role-aware combatant selection");
assert.ok(panelStyleSource.includes("object-position: center center;"), "panel portrait image should be centered");
assert.ok(panelStyleSource.includes(".pf2e-combater .combater-meta-row"), "panel header should style status badges as their own row");
assert.ok(
  /combater-name-row\s*\{[\s\S]*?justify-content: flex-start;/.test(panelStyleSource),
  "actor name should not share a squeezed row with status badges",
);
assert.ok(
  /combater-action-row \.combater-alt-promote\s*\{[\s\S]*?width: auto;/.test(panelStyleSource),
  "action-list name buttons should size to their text instead of spanning the row",
);
assert.ok(
  /\.pf2e-combater \.combater-action-row\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-size:/m.test(panelStyleSource),
  "action-list rows should use browser render containment so long action lists scroll smoothly",
);
assert.ok(
  /\.pf2e-combater \.combater-body\.is-scrolling \.combater-action-row/.test(panelStyleSource),
  "action-list scrolling should suppress hover/tooltip pointer work while the wheel is moving",
);
assert.ok(
  panelSource.includes("_activateActionListScrollPerformance(element)")
  && panelSource.includes("body.addEventListener(\"scroll\", markScrolling, { passive: true })"),
  "panel render should attach passive action-list scroll performance guard",
);
assert.equal(
  panelSource.includes("draftSteps.length ? draftSteps : autoFill.steps"),
  false,
  "panel header should not auto-render auto-fill plan before user chooses it",
);
assert.equal(
  panelTemplateSource.includes("combater-action-pool"),
  false,
  "panel template should not render action pool as a repeated tab body card",
);
assert.ok(panelTemplateSource.includes("combater-header-step"), "panel template should edit draft steps in shared header");
assert.equal(
  panelTemplateSource.includes("<strong>Draft</strong>"),
  false,
  "panel template should not render draft plan as a repeated tab body card",
);
for (const selectorHook of [
  "data-open-draft-step",
  "data-preview-step",
  "data-preview-draft-step",
  "data-preview-minion-step",
]) {
  assert.ok(panelTemplateSource.includes(selectorHook), `panel template should expose ${selectorHook}`);
  assert.ok(panelEventBindingsSource.includes(selectorHook), `panel event bindings should bind ${selectorHook}`);
}
// Opening action details is wired in the browser window now.
assert.ok(panelTemplateSource.includes("data-open-action"), "browser template should expose data-open-action");
assert.ok(browserSource.includes("data-open-action"), "browser source should bind data-open-action");
assert.ok(panelTemplateSource.includes("combater-debug"), "panel template should keep GM debug foldout");
