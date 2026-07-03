import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confidenceLabel } from "./confidence.js";
import { fighterContext, fixtureCandidates } from "./fixtures.js";
import { actionBudget, bestTurnPlan, buildTurnPlans } from "./planner.js";
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
  requiresDestinationForAction,
} from "./action-builder.js";
import {
  createAreaRegionData,
  currentTargetSelection,
  executeDraftStep,
  executionReadinessForStep,
  nextPendingExecutionStep,
  plannedTargetSelection,
  requiresAreaMarkerForAction,
  requiresTargetForAction,
  resetDraftExecution,
  setTokenTargets,
  tokensInAreaMarker,
} from "./action-executor.js";
import { revertDraftExecution, revertDraftStep } from "./action-revert.js";
import {
  areaTimerExpired,
  buildAreaTimerEffectData,
  buildAreaTimerFlag,
  expiredAreaRegionsForScene,
  parseSpellDuration,
} from "./area-duration.js";
import { scoreCandidate } from "./scoring.js";
import { buildCandidates } from "./candidates.js";
import { classifySystemAction } from "./action-classifier.js";
import { classifySpell } from "./spell-classifier.js";
import { actorStrikeOptions, backingStrikeFilterByPreset, bestReadyStrike, heldMeleeBackingStrikes, readActionCost, readActionSources } from "../readers/action-reader.js";
import { readActorProfile, readEffects, actorMovementOptions } from "../readers/actor-profile.js";
import { readSpellActions } from "../readers/spell-reader.js";
import {
  favoriteKey,
  readActionFavorites,
  toggleActionFavorite,
} from "../state/action-favorites.js";
import { readCombatContext } from "../state/combat-context.js";
import { documentRelevantToContext } from "../state/context-relevance.js";
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
} from "../state/draft-plans.js";
import * as draftPlanState from "../state/draft-plans.js";
import { coveredClassSlugs } from "../rules/class-tactics.js";
import { KNOWN_SUBCLASS_SLUGS } from "../rules/class-tactics-data/index.js";
import { displayStepEntries } from "../ui/display-steps.js";
import {
  captureMovementOrigin,
  consumeTokenRefreshChange,
  markMovementActionSpent,
  movementActionsSpent,
  tokenUpdateAffectsCombatGeometry,
  tokenUpdateAffectsMovement,
} from "../state/token-refresh.js";
import { readVisionerCoverState, readVisionerDetectionState } from "../integrations/visioner.js";
import { GENERIC_ACTIONS } from "../catalog/generic-actions.js";
import { findCustomAction } from "../catalog/custom-actions.js";
import { autoFillCyclePlans, bestAutoFillPlan, nextAutoFillPlan, previousAutoFillPlan, selectableAlternativePlans, selectDisplayPlan } from "../ui/plan-selection.js";
import { clearActionPreview, showActionPreview } from "../ui/action-preview.js";
import { clearMovementPreview, movementPreviewForStep, recommendedMovementForStep, routeCornerWaypoints, showMovementPreview } from "../ui/movement-preview.js";
import { cancelAreaPicker, chooseAreaMarker } from "../ui/area-picker.js";
import { computeRangeRing, rangeLabelText, spellRangeFeet } from "../ui/range-overlay.js";
import { cancelDestinationPicker, chooseDestination } from "../ui/destination-picker.js";
import { builderActionCategory, groupActionsByBuilderCategory } from "../ui/action-categories.js";
import { actionDetailChips, traitChips } from "../ui/action-details.js";
import { battlefieldPressure, compareTacticalCenters, threatCountAtCenter } from "../rules/battlefield-analysis.js";
import { aggroProfile, aggroTargetValue, canUseFullAggro } from "../rules/aggro.js";
import { promptRetchDc, promptRetchResult } from "../rules/retch-decision.js";
import { requestRetchDc, requestRetchResult, setSocket, shareDraftPlan } from "../socket.js";
import {
  readSustainedSpellEntries,
  removeSustainedSpellEntries,
  unsustainedSpellCleanupEntries,
} from "../rules/sustained-spells.js";
import { registerSettings, SETTINGS } from "../settings.js";
import { STORAGE_KEYS } from "../constants.js";

// The rendered UI spans two templates now: the plan-only panel and the detached browser
// window. Concatenate both so "the UI exposes X" assertions cover either window (the panel
// part comes first, so order-sensitive checks like "sustained renders before tabs" hold).
const panelTemplateSource = [
  readFileSync(new URL("../../templates/combater-panel.hbs", import.meta.url), "utf8"),
  readFileSync(new URL("../../templates/combater-browser.hbs", import.meta.url), "utf8"),
].join("\n");
const panelSource = readFileSync(new URL("../ui/CombaterPanel.js", import.meta.url), "utf8");
const browserSource = readFileSync(new URL("../ui/CombaterBrowser.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const actionExecutorSource = readFileSync(new URL("./action-executor.js", import.meta.url), "utf8");
const panelStyleSource = readFileSync(new URL("../../styles/combater.css", import.meta.url), "utf8");
const areaPickerSource = readFileSync(new URL("../ui/area-picker.js", import.meta.url), "utf8");
const actionPreviewSource = readFileSync(new URL("../ui/action-preview.js", import.meta.url), "utf8");
assert.ok(panelSource.includes("function actionGlyphIcon"), "panel action costs should map to PF2e action-cost icons");
assert.ok(panelTemplateSource.includes("combater-cost-glyph"), "panel template should render PF2e action-cost icon images");
assert.ok(panelSource.includes("icons/actions/OneAction.webp"), "panel should reference the PF2e action-cost icon set");
assert.ok(panelTemplateSource.includes("combater-chip-img") && panelTemplateSource.includes("combater-action-img"), "panel should show item images beside action names");
assert.equal(panelSource.includes("\u00e2"), false, "panel source should not contain mojibake");
assert.ok(panelSource.includes("setCombatant(combatant"), "panel should expose explicit combatant selection");
assert.ok(panelSource.includes("combatant: this._selectedCombatant"), "panel context should use selected explicit combatant");
assert.ok(panelSource.includes("this._onClose = typeof options.onClose === \"function\""), "panel should accept close callback");
assert.ok(panelSource.includes("this._onClose?.(this);"), "panel close should notify owner");
assert.ok(panelSource.includes("Quickened actions"), "panel should render a quickened-only action shelf");
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
assert.ok(mainSource.includes("clearEndedTurnDraft"), "a combatant's execution plan should be cleared when its turn ends");
assert.ok(
  /Hooks\.on\("deleteCombat"[\s\S]*?clearCombatDraftPlans\(combat\)/.test(mainSource),
  "deleting a combat should clear all of its lingering draft plans",
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
assert.ok(panelSource.includes("filterBuilderTabActions"), "panel source should filter actions inside each active tab");
// Search matches the title only — not row prose. "reach" must not match "...in reach." copy.
const searchHaystackBody = panelSource.match(/function actionSearchHaystack\([\s\S]*?\n}/)?.[0] ?? "";
assert.ok(searchHaystackBody.includes("action?.name"), "action search should match the action title");
for (const prose of ["disabledReason", "reason", "targetLabel", "costLabel"]) {
  assert.equal(searchHaystackBody.includes(prose), false,
    `action search should not match row prose (${prose}), only the title`);
}
assert.ok(panelSource.includes("groupActionsByBuilderCategory"), "panel should group tab actions into combat categories");
assert.ok(panelSource.includes("actionDetailChips"), "panel should decorate spell/action detail chips");
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
assert.ok(panelSource.includes("_chooseSustainedSpellForStep"), "generic Sustain a Spell execution should ask which spell to sustain");
// Draft steps are tagged with their multiple-attack-penalty position so strikes roll the right MAP
// variant; uncounted attacks continue the plan's running attack count.
assert.ok(panelSource.includes("injectMapInfo"), "draft steps should be tagged with their multiple-attack-penalty position");
assert.ok(/injectMapInfo\(rawUncounted, planMap\.attackCount\)/.test(panelSource), "uncounted attacks should continue the plan's MAP count");
// Players can pin a strike's MAP level per attack (some abilities keep MAP flat across attacks).
assert.ok(panelSource.includes("_cycleStepMap"), "the panel should let the player cycle a strike's MAP level");
assert.ok(/mapOverride/.test(panelSource), "a pinned MAP override should feed the per-strike MAP");
assert.ok(panelTemplateSource.includes("data-cycle-map"), "the panel template should expose a MAP cycle control on strikes");
assert.ok(panelSource.includes("mapAppliesPerStrike"), "abilities whose rules text applies MAP normally per strike (e.g. Twin Takedown, Flurry of Blows) must be able to opt out of Double Attack's shared-tier group scan");
assert.ok(/groupId\s*&&\s*!perStrikeMap/.test(panelSource), "the shared-tier forward scan for a grouped composite's siblings must be skipped when mapAppliesPerStrike is set, so each atom gets its own escalating MAP tier instead of one shared tier");
// Players can pick which speed a Stride travels on (fly/burrow/swim/climb) when the actor has one.
assert.ok(panelSource.includes("_cycleStepMovement"), "the panel should let the player cycle a Stride's movement type");
assert.ok(/movementAction/.test(panelSource), "a pinned movement type should ride on the draft step");
assert.ok(panelTemplateSource.includes("data-cycle-movement"), "the panel template should expose a movement-type control on Strides");
// actorMovementOptions enumerates the actor's Stride speeds: walking first, then only the non-walking
// speeds the actor actually has, mapping the "land" speed key to the "walk" movement action.
{
  const flier = actorMovementOptions({
    system: { movement: { speeds: {
      land: { total: 25 }, fly: { total: 60 }, burrow: { total: 0 }, swim: null, travel: { total: 25 },
    } } },
  });
  assert.deepEqual(flier.map((option) => option.action), ["walk", "fly"], "only walking and the actor's real fly speed should be offered");
  assert.equal(flier[0].speed, 25, "walking option should carry the land speed");
  assert.equal(flier[1].speed, 60, "fly option should carry the fly speed");
  const grounded = actorMovementOptions({ system: { attributes: { speed: { value: 30 } } } });
  assert.deepEqual(grounded.map((option) => option.action), ["walk"], "an actor with only a land speed offers no movement-type choice");
}
// Retch is the GM's call in two phases: the GM sets the DC, the player rolls, then the GM sets the
// result. A player routes the DC ask via requestRetchDc and the result ask via requestRetchResult,
// only prompting locally as a GM or when no GM is connected.
assert.ok(
  /_provideRetchDc\([\s\S]*game\?\.user\?\.isGM === true[\s\S]*requestRetchDc\(/.test(panelSource),
  "a player's Retch DC should be asked of the GM, not decided by the player",
);
assert.ok(
  /_confirmRetchResult\([\s\S]*game\?\.user\?\.isGM === true[\s\S]*requestRetchResult\(/.test(panelSource),
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
  "data-move-draft-step",
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
assert.ok(panelSource.includes("projectedDraftStepActions"), "draft steps should resolve actions from their projected origin");
assert.ok(panelSource.includes("_moveDraftStep"), "panel should support explicit draft-step reordering");
assert.ok(panelSource.includes("_cycleAutoFillDraft"), "panel should cycle through auto-fill alternative plans");
assert.ok(panelSource.includes("contextmenu"), "shuffle right-click should cycle backward instead of opening the browser menu");
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
assert.ok(panelSource.includes("executeDraftStep"), "panel should use action executor instead of advisory-only execution");
assert.ok(panelSource.includes("nextPendingExecutionStep"), "panel should find next executable draft step");
assert.ok(panelSource.includes("revertDraftExecution"), "panel reset should revert executed steps, not only clear status");
assert.ok(panelSource.includes("revertDraftStep"), "panel should revert an individual executed step");
// --- Uncounted actions: panel decoration (Task 4) ---
assert.ok(panelSource.includes("uncounted: {"), "decorateBuilder should expose a builder.uncounted view-model");
// --- Uncounted actions: panel handlers (Task 6) ---
assert.ok(panelSource.includes("draftListForInstance"), "panel should resolve a step's list before persisting");
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
const browserTemplateSource = readFileSync(new URL("../../templates/combater-browser.hbs", import.meta.url), "utf8");
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
assert.ok(/async close\([\s\S]*this\._browser\?\.close\(\)/.test(panelSource), "closing the panel should close the browser");
assert.ok(panelSource.includes("_findActiveStep"), "panel should look up steps across both lists");
assert.ok(panelSource.includes("currentTargetSelection"), "panel should use Foundry's current target selection");
assert.ok(panelSource.includes("chooseAreaMarker"), "panel should allow runtime AOE change");
assert.ok(
  /async refresh\([\s\S]*?if \(this\._areaPicker \|\| this\._destinationPicker\)[\s\S]*?return;/.test(panelSource),
  "refresh must not cancel an in-progress area or destination picker, or the canvas grid/region tools drop mid-selection",
);
assert.ok(areaPickerSource.includes("chooseAreaMarker"), "area picker should export chooseAreaMarker");
assert.ok(panelSource.includes("showActionPreview"), "plan hover should preview movement, target, or area choices");
assert.ok(panelSource.includes("clearActionPreview"), "plan hover cleanup should clear all action preview overlays");
assert.ok(panelSource.includes("_pickTemplate"), "panel should let the user pick which template to place");
assert.ok(panelSource.includes("targetingProfile?.templates"), "panel should read the parsed multi-template list");
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
  /grid-template-areas:\s*"identity actions"\s*"plan plan"/.test(panelStyleSource),
  "panel header should use a two-row grid so action chips do not fight execute controls",
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
  panelSource.includes("remainingQuickenedActions"),
  "header action pool should include quickened actions left",
);
assert.ok(
  panelSource.includes("builderAtomicActionsForStep"),
  "auto-fill should split generated combo plan steps into atomic draft actions",
);
assert.equal(panelTemplateSource.includes("No usable action"), false, "panel template should not imply auto-fill is selected");
assert.ok(panelSource.includes("headerSteps: groupDraftSteps(draftSteps)"), "panel header should render draft steps only");
assert.ok(panelSource.includes("projectContextForDraftStepOrigin"), "draft movement previews should use prior draft destinations as origin");
assert.ok(panelSource.includes("this._planningContext = planningContext"), "action-list previews should remember projected draft destination context");
assert.ok(
  /showActionPreview\(\s*this\._planningContext \?\? this\._context\b/.test(panelSource),
  "action-list hover preview should start from projected draft context",
);
assert.ok(
  /_onRender\(context, options\)[\s\S]*_restoreDestinationPickerPreview\(\)/.test(panelSource),
  "panel render should restore destination picker overlay while picker is active",
);
assert.ok(
  panelSource.includes("this._destinationPicker.preview"),
  "destination picker refresh should restore the transient waypoint preview instead of resetting to the draft step",
);
assert.ok(
  /chooseDestination\(\{[\s\S]*enableWaypoints:\s*true/.test(panelSource),
  "stride destination planning should use combater-owned waypoints instead of Foundry's native ruler",
);
assert.equal(
  /_chooseDestination\(instanceId\)[\s\S]*useNativeRuler:\s*true/.test(panelSource),
  false,
  "plan-phase destination picking must not call Foundry native ruler because it can move tokens",
);
assert.ok(
  /_clearActionPreviewUnlessPicking\(event\)[\s\S]*const related = event\?\.relatedTarget[\s\S]*if \(!related \|\| !element\?\.contains\?\.\(related\)\) return;/.test(panelSource),
  "plan hover preview should stay visible when the pointer leaves the panel for the canvas or the pointer is cancelled",
);
assert.ok(
  /_showDraftActionPreview\(element\)[\s\S]*movementPlan:\s*step\.movementPlan/.test(panelSource),
  "draft movement hover preview should include stored custom waypoint path, not only the final destination",
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
assert.ok(panelSource.includes("readSharedDraftPlan(context)"), "GM panel should read shared player draft plans");
assert.ok(mainSource.includes("receiveSharedDraft"), "main should register a handler that receives shared player draft plans");
assert.ok(panelSource.includes("isPlayerPlan"), "GM header should know when displayed draft is a player plan");
assert.ok(panelTemplateSource.includes("combater-player-plan-badge"), "GM header should show a visible player-plan badge");
assert.ok(
  panelStyleSource.includes(".pf2e-combater .combater-player-plan-badge"),
  "player-plan badge should have explicit header styling",
);
assert.ok(
  panelSource.includes("gmViewingPlayerPlan"),
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
  /const useSharedDraft = sharedDraftKnown[\s\S]*shouldDisplaySharedDraft\(draft, sharedDraft\)/.test(panelSource),
  "shared-draft display decision should allow loaded shared drafts to be replaced by newer player payloads",
);
assert.ok(panelSource.includes("hasSharedDraftPlan(sharedDraft)"), "GM panel should treat empty player drafts as known shared plans");
assert.ok(
  panelSource.includes("isPlayerControlledActor"),
  "panel should detect player-controlled actors before allowing GM draft edits",
);
// Regression: an absent player's owned character used to lock the GM out of Auto-fill/execute
// forever, because ownership is a static document flag with no regard for whether that owner is
// actually connected. The GM should get full plan/execute rights once every owning player is
// offline — the same rights they already have for any NPC they run.
assert.ok(
  /user\s*&&\s*user\.isGM\s*!==\s*true\s*&&\s*user\.active\s*===\s*true/.test(panelSource),
  "player-owner detection should require the owning user to be currently connected (user.active), not just hold a static ownership flag",
);
// Regression (edge case): sharedDraftKnown gets stamped for the rest of the encounter the moment a
// player ever shares any draft (even an empty one), so a stale shared draft from earlier in the
// session must not re-lock an absent player's actor read-only. The mirror/lock branch has to require
// gmViewingPlayerPlan directly, not just useSharedDraft, so it falls through to the GM's own editable
// local draft once the player disconnects.
assert.ok(
  /const activeDraft = \(gmViewingPlayerPlan && useSharedDraft\)/.test(panelSource),
  "shared-draft readonly mirroring must require the player to be actively online, not just a known shared draft",
);
assert.ok(
  /this\._builder\.readonly = .*gmViewingPlayerPlan/.test(panelSource),
  "GM PC view should mark builder readonly",
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
  panelSource.includes("writeSharedDraftPlanActorFlag"),
  "player draft sync should mirror the plan onto the owned actor so GM clients update even if module socket delivery is missed",
);
assert.ok(
  /_addAction\(actionKey\)[\s\S]*_writeActiveDraftPlan\(markManualDraft\(/.test(panelSource),
  "adding an action should sync updated player plan to GM",
);
// A persisted display name keeps a step readable after its action stops being generated (e.g. a
// drawn weapon no longer offers its Draw action), instead of falling back to the raw action key.
assert.ok(
  /_addAction\(actionKey\)[\s\S]*name: action\.name/.test(panelSource),
  "added plan steps should persist a display name",
);
assert.ok(
  /_addUncountedAction\(actionKey\)[\s\S]*name: action\.name/.test(panelSource),
  "added uncounted steps should persist a display name",
);
assert.ok(
  /_removeDraftStep\(instanceId\)[\s\S]*_writeActiveDraftPlan\(markManualDraft\(/.test(panelSource),
  "removing an action should sync updated player plan to GM",
);
assert.ok(
  /_autoFillDraft\(\{ plan = null \} = \{\}\)[\s\S]*source: "auto-fill"[\s\S]*_writeActiveDraftPlan\(/.test(panelSource),
  "auto-fill should sync updated player plan to GM",
);
assert.ok(
  /_autoFillDraft\(\{ plan = null \} = \{\}\)[\s\S]*bestAutoFillPlan\(this\._autoFillPlans\)/.test(panelSource),
  "pressing Auto-fill should load the best plan even after cycling alternatives",
);
assert.ok(
  /_autoFillDraft\(\{ plan = null \} = \{\}\)[\s\S]*if \(!plan\) this\._pinnedPlanId = null/.test(panelSource),
  "pressing Auto-fill should reset the alternative-plan cursor",
);
assert.ok(
  /onChoose: (?:async )?\(destination, metadata = \{\}\) =>[\s\S]*_persistActiveDraftStep\(/.test(panelSource),
  "choosing a movement destination should persist the updated plan",
);
assert.ok(
  /_persistActiveDraftStep\(step, listKey\)[\s\S]*await this\._syncDraftToGM\(\)/.test(panelSource),
  "persisting a draft step (local mode) should sync the player plan to GM",
);
// GM-executes-player-plan: the GM can run a shared plan on an AFK player's behalf, writing execution
// state back to the shared draft rather than the GM's local one.
assert.ok(
  panelSource.includes("_gmExecuteMode") && panelSource.includes("_canExecuteDraft"),
  "panel should support GM execution of a player's shared plan",
);
assert.ok(
  /_persistActiveDraftStep\(step, listKey\)[\s\S]*writeSharedDraftPlanActorFlag/.test(panelSource),
  "GM execution should write the shared draft back to the owned actor flag",
);
assert.ok(
  /canExecuteStep:[^\n]*canRunStep/.test(panelSource)
  && /canReset:[^\n]*gmCanRunPlayerPlan/.test(panelSource),
  "per-step execute/reset controls should be enabled for a GM viewing a player's shared plan",
);
assert.ok(
  panelSource.includes("executionReadinessForStep(step, action ?? step)"),
  "draft-step decoration should compute execution readiness from stored dependencies",
);
assert.ok(
  /canExecuteStep:[^\n]*readiness\.status === "ready"/.test(panelSource),
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
  panelSource.includes("globalThis.ui?.notifications?.warn?.(readiness.warning"),
  "manual execute attempts with missing dependencies should warn instead of executing",
);
assert.ok(
  /_executeDraftStep\(instanceId, event\)[\s\S]*?if \(!this\._canExecuteDraft\(\)\) return;/.test(panelSource),
  "executing a draft step should allow GM execution, not just editing",
);
assert.ok(
  /canRevertStep: isExecutionDone && canRunStep/.test(panelSource),
  "per-step revert should be available to the owner or a GM running a player's shared plan",
);
assert.ok(
  panelTemplateSource.includes("{{#if canRevertStep}}"),
  "step template should gate per-step revert on canRevertStep, not raw readonly",
);
assert.ok(
  panelSource.includes("silent: !notify"),
  "automatic player plan sync should mark socket payloads silent",
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
assert.ok(panelSource.includes("hideTarget ? \"\" : decorated.targetLabel"), "panel should support hiding target labels per section");
assert.equal(
  panelSource.includes("toward ${name}"),
  false,
  "movement draft steps should not label an unknown destination as toward a target",
);
assert.ok(
  panelSource.includes(".filter((action) => !action.favorite)"),
  "All section should omit favorited actions",
);
assert.ok(
  /decorateAction\(action,\s*\{[^}]*hideTarget: true/.test(panelSource),
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
]) {
  assert.ok(panelTemplateSource.includes(selectorHook), `panel template should expose ${selectorHook}`);
  assert.ok(panelSource.includes(selectorHook), `panel source should bind ${selectorHook}`);
}
// Opening action details is wired in the browser window now.
assert.ok(panelTemplateSource.includes("data-open-action"), "browser template should expose data-open-action");
assert.ok(browserSource.includes("data-open-action"), "browser source should bind data-open-action");
assert.ok(panelTemplateSource.includes("combater-debug"), "panel template should keep GM debug foldout");

const executionTargetAction = {
  name: "Demoralize",
  slug: "demoralize",
  executable: "pf2e-action",
  targetingProfile: { enemy: true, maxRange: 30 },
};
const executionAreaAction = {
  name: "Stinking Cloud",
  slug: "stinking-cloud",
  executable: "open-item",
  source: "spell-inferred",
  activityProfile: { spell: true, lastingDuration: true, duration: "1 minute" },
  targetingProfile: { area: true, type: "burst", distance: 20, maxRange: 500 },
  item: { name: "Stinking Cloud", uuid: "Item.stinking-cloud", img: "icons/cloud.webp" },
};
// --- Auto-expiring area templates: duration parsing & expiry (area-duration.js) ---
assert.equal(parseSpellDuration("instantaneous"), null, "instantaneous spells get no timer");
assert.equal(parseSpellDuration(""), null, "empty duration gets no timer");
assert.equal(parseSpellDuration("unlimited"), null, "unlimited duration gets no timer");
assert.equal(parseSpellDuration("until the start of your next turn"), null, "'until ...' durations get no timer");
const oneMinuteTimer = parseSpellDuration("1 minute");
assert.deepEqual(oneMinuteTimer, { value: 1, unit: "minutes", seconds: 60, rounds: 10, sustained: false });
assert.deepEqual(parseSpellDuration("2 rounds"), { value: 2, unit: "rounds", seconds: 12, rounds: 2, sustained: false });
assert.equal(parseSpellDuration("1 hour").seconds, 3600, "hours convert to seconds");
assert.deepEqual(
  parseSpellDuration("sustained", { sustained: true }),
  { value: 1, unit: "minutes", seconds: 60, rounds: 10, sustained: true },
  "a bare sustained spell caps at one minute",
);
const sustainedUpTo = parseSpellDuration("sustained up to 2 rounds", { sustained: true });
assert.equal(sustainedUpTo.rounds, 2, "'sustained up to N' uses the stated cap");
assert.equal(sustainedUpTo.sustained, true);

const areaTimerFlag = buildAreaTimerFlag({ duration: oneMinuteTimer, worldTime: 100, round: 3, effectUuid: "Effect.x", casterActorUuid: "Actor.y" });
assert.deepEqual(areaTimerFlag, {
  effectUuid: "Effect.x",
  casterActorUuid: "Actor.y",
  sustained: false,
  expiresWorldTime: 160,
  expiresRound: 13,
});
assert.equal(areaTimerExpired(areaTimerFlag, { worldTime: 159, round: 12 }), false, "timer not yet elapsed");
assert.equal(areaTimerExpired(areaTimerFlag, { worldTime: 160, round: 5 }), true, "elapsed by world time");
assert.equal(areaTimerExpired(areaTimerFlag, { worldTime: 0, round: 13 }), true, "elapsed by combat round");
assert.equal(areaTimerExpired(null, { worldTime: 999 }), false, "no flag means never expired");

const areaEffectData = buildAreaTimerEffectData({
  action: { name: "Darkness", item: { img: "icons/darkness.webp" } },
  regionId: "region-x",
  sceneId: "scene-x",
  duration: oneMinuteTimer,
  worldTime: 50,
  initiative: 12,
});
assert.equal(areaEffectData.type, "effect");
assert.equal(areaEffectData.name, "Darkness");
assert.equal(areaEffectData.img, "icons/darkness.webp");
assert.deepEqual(areaEffectData.system.duration, { value: 1, unit: "minutes", expiry: null, sustained: false });
assert.equal(areaEffectData.system.start.value, 50);
assert.deepEqual(areaEffectData.flags["pf2e-combater"].areaRegion, { regionId: "region-x", sceneId: "scene-x" });

assert.deepEqual(
  expiredAreaRegionsForScene({
    id: "scene-x",
    regions: [
      { id: "r-live", flags: { "pf2e-combater": { areaTimer: { expiresWorldTime: 200, expiresRound: null, effectUuid: "Effect.a" } } } },
      { id: "r-dead", flags: { "pf2e-combater": { areaTimer: { expiresWorldTime: 100, expiresRound: null, effectUuid: "Effect.b" } } } },
      { id: "r-plain", flags: {} },
    ],
  }, { worldTime: 150, round: null }),
  [{ regionId: "r-dead", sceneId: "scene-x", effectUuid: "Effect.b" }],
  "only regions past their expiry are swept",
);

assert.equal(requiresTargetForAction(executionTargetAction), true);
assert.equal(requiresTargetForAction({ name: "Stand", slug: "stand", targetingProfile: { self: true } }), false);
// A self-directed suggested target (scoring assigns one to defense/self actions) must not
// force the user to pick a target.
assert.equal(
  requiresTargetForAction({ name: "Raise a Shield", slug: "raise-a-shield", executable: "pf2e-action", role: "defense", suggestedTarget: { type: "self", id: "actor-token", name: "Valeros" } }),
  false,
  "a self-targeted suggestion should not require choosing a target",
);
assert.equal(requiresAreaMarkerForAction(executionAreaAction), true);
assert.equal(panelSource.includes("plannedTargetDraftFields"), false, "adding or auto-filling a draft action should not persist recommendation targets");
assert.equal(
  panelSource.includes("?? action?.suggestedTarget?.name"),
  false,
  "draft header labels should not reuse action recommendation targets as selected targets",
);
assert.equal(
  actionExecutorSource.includes("const planned = plannedTargetSelection(action)"),
  false,
  "execution readiness should not treat recommendation targets as selected targets",
);
assert.deepEqual(
  executionReadinessForStep({ instanceId: "needs-target" }, executionTargetAction).choices,
  ["target"],
  "targeted actions without a planned target should need an execution choice, not a blocking draft warning",
);
assert.deepEqual(
  executionReadinessForStep({
    instanceId: "suggested-target-is-not-selected",
  }, {
    ...executionTargetAction,
    suggestedTarget: { id: "target-token", name: "Goblin", token: { id: "target-token" } },
  }).choices,
  ["target"],
  "recommended targets should not satisfy execution readiness until the user selects a target",
);
const legacyAutoTargetStep = {
  instanceId: "legacy-auto-target",
  targetTokenIds: ["target-token"],
  targetLabel: "Target: Goblin",
};
const previousAutoTargetCanvas = globalThis.canvas;
try {
  globalThis.canvas = { tokens: { placeables: [{ id: "target-token", name: "Goblin", document: { id: "target-token" } }] } };
  assert.deepEqual(
    executionReadinessForStep(legacyAutoTargetStep, {
      ...executionTargetAction,
      suggestedTarget: { id: "target-token", name: "Goblin", token: { id: "target-token" } },
    }).choices,
    ["target"],
    "old draft rows with auto-stored recommendation targets should not count as selected targets",
  );
  assert.deepEqual(
    executionReadinessForStep({ ...legacyAutoTargetStep, targetSelection: "manual" }, {
      ...executionTargetAction,
      suggestedTarget: { id: "target-token", name: "Goblin", token: { id: "target-token" } },
    }).choices,
    [],
    "manual target picks should keep satisfying execution readiness even when they match the recommendation",
  );
} finally {
  globalThis.canvas = previousAutoTargetCanvas;
}
assert.ok(
  panelSource.includes('targetSelection: "manual"'),
  "manual target picks should be marked so old auto-target draft fields can be ignored safely",
);
assert.deepEqual(
  executionReadinessForStep({ instanceId: "needs-area" }, executionAreaAction).choices,
  ["area"],
  "area actions without a planned marker should need an execution choice",
);
assert.equal(
  nextPendingExecutionStep({
    steps: [
      { instanceId: "done", execution: { status: "done" } },
      { instanceId: "pending" },
      { instanceId: "later" },
    ],
  })?.instanceId,
  "pending",
);
assert.deepEqual(
  resetDraftExecution({
    steps: [
      { instanceId: "done", destination: { x: 10, y: 15 }, execution: { status: "done" } },
      { instanceId: "failed", targetTokenIds: ["target"], execution: { status: "failed", error: "stale" } },
    ],
  }).steps,
  [
    { instanceId: "done", destination: { x: 10, y: 15 }, execution: { status: "pending" } },
    { instanceId: "failed", targetTokenIds: ["target"], execution: { status: "pending" } },
  ],
  "reset should clear execution progress without dropping planned defaults",
);

const sustainedSpellAction = {
  id: "spell-animated-assault",
  name: "Animated Assault",
  slug: "animated-assault",
  uuid: "Actor.caster.Item.spell-animated-assault",
  sourceId: "Compendium.pf2e.spells-srd.Item.animated-assault",
  activityProfile: { spell: true, sustained: true },
  item: {
    id: "spell-animated-assault",
    uuid: "Actor.caster.Item.spell-animated-assault",
    sourceId: "Compendium.pf2e.spells-srd.Item.animated-assault",
  },
};
const sustainedSpellEffect = {
  id: "effect-animated-assault",
  _id: "effect-animated-assault",
  type: "effect",
  name: "Spell Effect: Animated Assault",
  sourceId: "Compendium.pf2e.spell-effects.Item.animated-assault",
  system: {
    slug: "spell-effect-animated-assault",
    source: { value: "Compendium.pf2e.spells-srd.Item.animated-assault" },
  },
};
const sustainedSpellDraft = {
  steps: [
    {
      instanceId: "cast-animated-assault",
      action: sustainedSpellAction,
      execution: {
        status: "done",
        revert: { ops: [{ kind: "region", regionId: "region-animated-assault", sceneId: "scene-1" }] },
      },
    },
  ],
};
const sustainedSpellContext = {
  actor: {
    document: {
      id: "caster",
      name: "Caster",
      itemTypes: { effect: [sustainedSpellEffect] },
      items: [sustainedSpellEffect],
    },
  },
  combat: { id: "combat-1" },
  combatant: { id: "combatant-1" },
};
assert.deepEqual(
  readSustainedSpellEntries(sustainedSpellContext, [sustainedSpellAction], sustainedSpellDraft).map((entry) => ({
    id: entry.id,
    name: entry.name,
    effectIds: entry.effectIds,
    templateRefs: entry.templateRefs,
    sustained: entry.sustained,
  })),
  [{
    id: "animated-assault",
    name: "Animated Assault",
    effectIds: ["effect-animated-assault"],
    templateRefs: [{ kind: "region", regionId: "region-animated-assault", sceneId: "scene-1" }],
    sustained: false,
  }],
  "sustained spell reader should connect active spell effects to module-created templates",
);
{
  const previousTemplateGame = globalThis.game;
  globalThis.game = {
    scenes: {
      values: () => [{
        id: "scene-live",
        regions: [{
          id: "region-live-animated-assault",
          flags: { "pf2e-combater": { originUuid: "Actor.caster.Item.spell-animated-assault" } },
        }],
      }],
    },
  };
  try {
    assert.deepEqual(
      readSustainedSpellEntries(sustainedSpellContext, [sustainedSpellAction], { steps: [] })[0]?.templateRefs,
      [{ kind: "region", regionId: "region-live-animated-assault", sceneId: "scene-live" }],
      "sustained spell reader should find live module template regions when current draft is empty",
    );
  } finally {
    globalThis.game = previousTemplateGame;
  }
}
assert.equal(
  unsustainedSpellCleanupEntries(sustainedSpellContext, [sustainedSpellAction], {
    steps: [
      ...sustainedSpellDraft.steps,
      {
        instanceId: "sustain-animated-assault",
        action: { slug: "sustain-a-spell" },
        sustainedSpell: { id: "animated-assault", name: "Animated Assault" },
        execution: { status: "done" },
      },
    ],
  }).length,
  0,
  "executed Sustain a Spell steps should suppress end-turn cleanup for the selected spell",
);
// A spell cast THIS turn cannot be sustained until next turn, so the cast turn's own draft
// (which holds the cast step) must suppress end-of-turn cleanup.
assert.equal(
  unsustainedSpellCleanupEntries(sustainedSpellContext, [sustainedSpellAction], sustainedSpellDraft).length,
  0,
  "a spell cast this turn should not be offered for cleanup at the end of the casting turn",
);
// Next turn the cast step is gone from the draft, so the lingering effect IS offered for cleanup.
assert.equal(
  unsustainedSpellCleanupEntries(sustainedSpellContext, [sustainedSpellAction], { steps: [] }).length,
  1,
  "a spell left unsustained on a later turn should be offered for cleanup",
);
assert.equal(
  readSustainedSpellEntries(sustainedSpellContext, [sustainedSpellAction], { steps: [] })[0]?.spellUuid,
  "Actor.caster.Item.spell-animated-assault",
  "sustained spell entries should carry the spell UUID for chat re-posting",
);
{
  const removed = [];
  const deletedRegions = [];
  const cleanupContext = {
    actor: {
      document: {
        id: "caster",
        name: "Caster",
        itemTypes: { effect: [sustainedSpellEffect] },
        items: [sustainedSpellEffect],
        deleteEmbeddedDocuments: async (type, ids) => {
          removed.push({ type, ids });
          return ids;
        },
      },
    },
  };
  const previousCleanupGame = globalThis.game;
  globalThis.game = {
    scenes: {
      get: (id) => id === "scene-1"
        ? { deleteEmbeddedDocuments: async (type, ids) => deletedRegions.push({ type, ids }) }
        : null,
    },
  };
  try {
    await removeSustainedSpellEntries(cleanupContext, readSustainedSpellEntries(sustainedSpellContext, [sustainedSpellAction], sustainedSpellDraft));
  } finally {
    globalThis.game = previousCleanupGame;
  }
  assert.deepEqual(removed, [{ type: "Item", ids: ["effect-animated-assault"] }], "cleanup should remove unsustained spell effects");
  assert.deepEqual(deletedRegions, [{ type: "Region", ids: ["region-animated-assault"] }], "cleanup should remove unsustained spell templates");
}

const previousExecutionGame = globalThis.game;
const previousExecutionCanvas = globalThis.canvas;
const previousExecutionChatMessage = globalThis.ChatMessage;
const previousExecutionFromUuid = globalThis.fromUuid;
try {
  const targetCalls = [];
  const pf2eActionCalls = [];
  const raiseShieldCalls = [];
  const tokenUpdates = [];
  const tokenMoves = [];
  const movementStarts = [];
  const conditionUpdates = [];
  const conditionIncreases = [];
  const regionCreates = [];
  const regionDeletes = [];
  const regionUpdates = [];
  const messageDeletes = [];
  const damageRolls = [];
  const damageMessages = [];
  const effectCreates = [];
  const effectDeletes = [];
  const carryChanges = [];
  const consumableUpdates = [];
  const createdEffects = new Map();
  const actorDocument = {
    name: "Valeros",
    uuid: "Actor.valeros",
    decreaseCondition: async (slug, options = {}) => {
      conditionUpdates.push({ slug, options });
    },
    increaseCondition: async (slug, options = {}) => {
      conditionIncreases.push({ slug, options });
    },
    changeCarryType: async (item, options = {}) => {
      carryChanges.push({ item: item?.id ?? item?.name, carryType: options.carryType, handsHeld: options.handsHeld ?? 0 });
    },
    createEmbeddedDocuments: async (type, documents) => {
      return documents.map((document, index) => {
        const uuid = `Actor.valeros.Item.effect-${effectCreates.length + index + 1}`;
        effectCreates.push({ type, document });
        const effect = { ...document, uuid, delete: async () => { effectDeletes.push(uuid); } };
        createdEffects.set(uuid, effect);
        return effect;
      });
    },
  };
  const actorToken = {
    id: "actor-token",
    center: { x: 0, y: 0 },
    document: {
      id: "actor-token",
      width: 1,
      height: 1,
      update: async (data) => {
        tokenUpdates.push(data);
      },
      move: async (waypoint, options = {}) => {
        tokenMoves.push({ waypoint, options });
        return true;
      },
      movement: { state: "completed", id: null },
      startMovement: async (id) => {
        movementStarts.push(id);
        return true;
      },
    },
  };
  const targetToken = {
    id: "target-token",
    name: "Goblin",
    document: {
      id: "target-token",
      uuid: "Scene.scene.Token.target-token",
      actor: { name: "Goblin" },
    },
    setTarget: (selected, options = {}) => {
      targetCalls.push({ selected, options });
    },
  };
  globalThis.canvas = {
    grid: { size: 5, distance: 5 },
    scene: {
      id: "scene-1",
      grid: { distance: 5 },
      createEmbeddedDocuments: async (type, documents) => {
        regionCreates.push({ type, documents });
        return documents.map((document, index) => ({ ...document, id: `region-${regionCreates.length}-${index}` }));
      },
      deleteEmbeddedDocuments: async (type, ids) => {
        regionDeletes.push({ type, ids });
        return ids;
      },
      updateEmbeddedDocuments: async (type, updates) => {
        regionUpdates.push({ type, updates });
        return updates;
      },
    },
    tokens: {
      placeables: [actorToken, targetToken],
      setTargets: (ids) => targetCalls.push({ reset: ids }),
    },
    walls: { placeables: [] },
  };
  const chatMessages = new Map([
    ["msg-strike-1", { id: "msg-strike-1", delete: async () => { messageDeletes.push("msg-strike-1"); } }],
  ]);
  globalThis.game = {
    user: { id: "user-1", targets: new Set() },
    time: { worldTime: 0 },
    scenes: { get: (id) => (id === "scene-1" ? globalThis.canvas.scene : null) },
    messages: { get: (id) => chatMessages.get(id) ?? null },
    pf2e: {
      DamageRoll: class {
        constructor(formula) {
          this.formula = formula;
          damageRolls.push({ formula });
        }

        async evaluate() {
          return this;
        }

        async toMessage(messageData = {}) {
          damageMessages.push(messageData);
          return { id: `dmg-msg-${damageRolls.length}` };
        }
      },
      actions: new Map([
        [
          "demoralize",
          {
            use: async (options) => {
              pf2eActionCalls.push(options);
              return { ok: true };
            },
          },
        ],
        [
          "create-a-diversion",
          {
            variants: [{ slug: "distracting-words" }, { slug: "gesture" }, { slug: "trick" }],
            use: async (options) => {
              pf2eActionCalls.push(options);
              return { ok: true };
            },
          },
        ],
      ]),
    },
  };
  // Raise a Shield is a legacy camelCase function on game.pf2e.actions, not a slug-keyed Action.
  globalThis.game.pf2e.actions.raiseAShield = async (options) => { raiseShieldCalls.push(options); };
  globalThis.ChatMessage = {
    getSpeaker: () => ({}),
    deleteDocuments: async (ids) => { messageDeletes.push(...ids); },
  };
  globalThis.fromUuid = async (uuid) => createdEffects.get(uuid) ?? null;
  const executionContext = {
    actor: { document: actorDocument },
    token: { id: "actor-token", center: { x: 0, y: 0 }, width: 1, height: 1 },
  };

  globalThis.game.user.targets = new Set([targetToken]);
  assert.deepEqual(currentTargetSelection().targetTokenIds, ["target-token"]);
  assert.deepEqual(
    executionReadinessForStep({ instanceId: "current-target-step" }, executionTargetAction).choices,
    ["target"],
    "current Foundry target selection alone should not satisfy execution readiness",
  );
  const currentTargetResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "current-target-step" },
    action: executionTargetAction,
    event: { type: "click" },
  });
  assert.equal(currentTargetResult.status, "needs-choice");
  assert.deepEqual(currentTargetResult.choices, ["target"]);
  const manualStoredTargetResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "manual-target-step", targetTokenIds: ["target-token"], targetSelection: "manual" },
    action: executionTargetAction,
    event: { type: "click" },
  });
  assert.equal(manualStoredTargetResult.status, "done");
  assert.deepEqual(manualStoredTargetResult.patch.targetTokenIds, ["target-token"]);
  assert.equal(pf2eActionCalls.at(-1).target.name, "Goblin");
  globalThis.game.user.targets = new Set();

  const plannedTargetAction = {
    ...executionTargetAction,
    suggestedTarget: { id: "target-token", name: "Goblin", token: { id: "target-token" } },
  };
  assert.deepEqual(
    executionReadinessForStep({ instanceId: "planned-target-step" }, plannedTargetAction).choices,
    ["target"],
    "plan-phase recommendation target should not satisfy execution readiness when no current target is selected",
  );
  const plannedTargetResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "planned-target-step" },
    action: plannedTargetAction,
    event: { type: "click" },
  });
  assert.equal(plannedTargetResult.status, "needs-choice");
  assert.deepEqual(plannedTargetResult.choices, ["target"]);

  const targetResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "target-step", targetTokenIds: ["stale-token"] },
    action: executionTargetAction,
    choices: { targetTokenIds: ["target-token"] },
    event: { type: "click" },
  });
  assert.equal(targetResult.status, "done");
  assert.deepEqual(targetResult.patch.targetTokenIds, ["target-token"]);
  assert.equal(targetCalls.some((call) => call.selected === true), true, "execution should set stored target");
  assert.equal(pf2eActionCalls[0].target.name, "Goblin");
  assert.equal(pf2eActionCalls[0].variant, undefined, "single-variant actions should not force a variant");

  // Multi-variant skill actions must pass a variant or PF2e's use() throws.
  const diversionResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "diversion-step" },
    action: { name: "Create a Diversion", slug: "create-a-diversion", executable: "pf2e-action" },
    event: { type: "click" },
  });
  assert.equal(diversionResult.status, "done");
  assert.equal(pf2eActionCalls.at(-1).variant, "distracting-words", "a multi-variant action should default to its first variant");

  const diversionTrickResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "diversion-trick-step" },
    action: { name: "Create a Diversion", slug: "create-a-diversion", executable: "pf2e-action", variant: "trick" },
    event: { type: "click" },
  });
  assert.equal(diversionTrickResult.status, "done");
  assert.equal(pf2eActionCalls.at(-1).variant, "trick", "an explicit valid action.variant should be honoured");

  // Open-item actions that parsed an @Damage formula auto-roll typed damage to chat.
  const damageActionResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "damage-action-step" },
    action: {
      name: "Searing Blast",
      executable: "open-item",
      item: { name: "Searing Blast" },
      damageProfile: { formula: "6d6", type: "fire" },
    },
  });
  assert.equal(damageActionResult.status, "done");
  assert.deepEqual(damageRolls.at(-1), { formula: "(6d6)[fire]" }, "an action with @Damage should auto-roll typed damage");
  assert.equal(
    damageMessages.at(-1)?.flags?.pf2e?.context?.type,
    "damage-roll",
    "auto-rolled damage messages should include PF2e damage context for Toolbelt merge",
  );
  assert.deepEqual(
    damageMessages.at(-1)?.flags?.pf2e?.context?.options,
    ["item:slug:searing-blast", "self:action:slug:searing-blast"],
    "PF2e damage context should include an options array for Toolbelt merge",
  );
  assert.ok(
    damageActionResult.patch.execution.revert?.ops?.some((op) => op.kind === "chat" && op.messageId === "dmg-msg-1"),
    "the auto-rolled damage message should be revertible",
  );

  // @Damage only in the description (no parsed damageProfile.formula) should still auto-roll.
  const damageFromDescription = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "damage-desc-step" },
    action: {
      name: "Cinder Burst",
      executable: "open-item",
      item: { name: "Cinder Burst", system: { description: { value: "Deals @Damage[1d10[cold]]." } } },
    },
  });
  assert.equal(damageFromDescription.status, "done");
  assert.deepEqual(damageRolls.at(-1), { formula: "(1d10)[cold]" }, "@Damage in the description should auto-roll even without a damageProfile");

  for (const actionCost of [1, 2, 3]) {
    const beforeDamageCount = damageRolls.length;
    const forceBarrageResult = await executeDraftStep({
      context: executionContext,
      step: { instanceId: `force-barrage-${actionCost}a` },
      action: {
        name: "Force Barrage",
        slug: "force-barrage",
        executable: "open-item",
        actionCost,
        item: { name: "Force Barrage" },
        activityProfile: { spell: true, damageScalesWithActions: true },
        damageProfile: { formula: "1d4+1", type: "force" },
      },
    });
    assert.equal(forceBarrageResult.status, "done");
    const newDamageRolls = damageRolls.slice(beforeDamageCount);
    assert.deepEqual(
      newDamageRolls,
      Array.from({ length: actionCost }, () => ({ formula: "(1d4+1)[force]" })),
      `${actionCost}-action Force Barrage should roll one damage message per action`,
    );
    const damageRevertOps = forceBarrageResult.patch.execution.revert?.ops
      ?.filter((op) => op.kind === "chat" && /^dmg-msg-/.test(op.messageId)) ?? [];
    assert.deepEqual(
      damageRevertOps.map((op) => op.messageId),
      Array.from({ length: actionCost }, (_value, index) => `dmg-msg-${beforeDamageCount + index + 1}`),
      `${actionCost}-action Force Barrage should make every damage message revertible`,
    );
  }

  // entry.cast() resolves to undefined even on success in current PF2e and posts the card on a
  // later tick, so cast success/failure is read from the RESOURCE before casting — never the return
  // value (which used to flag every spell as a failed cast). A spontaneous slot at 0 = failed cast,
  // no damage; a remaining slot = cast + damage.
  const spellCastEntry = {
    id: "entry-1",
    system: { prepared: { value: "spontaneous" }, slots: {} },
    cast: async () => undefined,
  };
  const spellCastActor = { name: "Wizard", itemTypes: { spellcastingEntry: [spellCastEntry] } };
  const spellCastContext = { actor: { document: spellCastActor }, token: { id: "wiz-token", center: { x: 0, y: 0 }, width: 1, height: 1 } };
  const spellCastAction = {
    name: "Fireball",
    source: "spell-spontaneous",
    executable: "open-item",
    spellcastingEntryId: "entry-1",
    castRank: 3,
    item: { id: "fireball", type: "spell", name: "Fireball" },
    activityProfile: { spell: true },
    damageProfile: { formula: "6d6", type: "fire" },
  };

  spellCastEntry.system.slots = { slot3: { value: 0 } };
  const beforeFailedCast = damageRolls.length;
  const failedCast = await executeDraftStep({ context: spellCastContext, step: { instanceId: "fireball-noslot" }, action: spellCastAction });
  assert.equal(failedCast.status, "failed", "a spell with no remaining slot should fail to execute");
  assert.equal(damageRolls.length, beforeFailedCast, "a spell that can't be cast must not roll its damage");

  spellCastEntry.system.slots = { slot3: { value: 1 } };
  const beforeGoodCast = damageRolls.length;
  const goodCast = await executeDraftStep({ context: spellCastContext, step: { instanceId: "fireball-cast" }, action: spellCastAction });
  assert.equal(goodCast.status, "done", "a spell with a remaining slot should cast");
  assert.equal(damageRolls.length, beforeGoodCast + 1, "a successful cast rolls the spell's damage");

  // PF2e can resolve entry.cast() before the spell chat card's createChatMessage hook fires. The
  // executor must wait for that delayed card before posting auto damage; otherwise the damage card
  // lands above the spell card in chat.
  const previousHooks = globalThis.Hooks;
  const previousDamageRoll = globalThis.game.pf2e.DamageRoll;
  const delayedChatListeners = new Map();
  let delayedHookId = 0;
  const delayedChatOrder = [];
  const emitDelayedSpellCard = () => {
    const message = {
      id: "spell-card-delayed",
      documentName: "ChatMessage",
      speaker: { actor: "wizard-delayed" },
      timestamp: 100,
    };
    delayedChatOrder.push("spell-card");
    for (const listener of delayedChatListeners.get("createChatMessage")?.values() ?? []) listener(message);
  };
  globalThis.Hooks = {
    on: (name, listener) => {
      const id = ++delayedHookId;
      const listeners = delayedChatListeners.get(name) ?? new Map();
      listeners.set(id, listener);
      delayedChatListeners.set(name, listeners);
      return id;
    },
    off: (name, id) => {
      delayedChatListeners.get(name)?.delete(id);
    },
  };
  globalThis.game.pf2e.DamageRoll = class {
    async evaluate() {
      return this;
    }

    async toMessage() {
      delayedChatOrder.push("damage");
      return { id: "dmg-delayed-card" };
    }
  };
  try {
    const delayedCastEntry = {
      id: "entry-delayed-card",
      system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
      cast: async () => {
        setTimeout(() => { setTimeout(emitDelayedSpellCard, 0); }, 0);
        return undefined;
      },
    };
    const delayedCastResult = await executeDraftStep({
      context: {
        actor: { document: { id: "wizard-delayed", name: "Wizard", itemTypes: { spellcastingEntry: [delayedCastEntry] } } },
        token: { id: "wiz-delayed-token", center: { x: 0, y: 0 }, width: 1, height: 1 },
      },
      step: { instanceId: "delayed-spell-card" },
      action: {
        name: "Breath Fire",
        source: "spell-spontaneous",
        executable: "open-item",
        spellcastingEntryId: "entry-delayed-card",
        castRank: 1,
        item: { id: "breath-fire", type: "spell", name: "Breath Fire" },
        activityProfile: { spell: true },
        damageProfile: { formula: "2d6", type: "fire" },
      },
    });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    assert.equal(delayedCastResult.status, "done", "delayed spell-card cast should still complete");
    assert.deepEqual(delayedChatOrder, ["spell-card", "damage"], "auto damage must wait for the spell chat card");
    assert.ok(
      delayedCastResult.patch.execution.revert.ops.some((op) => op.kind === "chat" && op.messageId === "spell-card-delayed"),
      "delayed spell card should stay revertible after being captured from the chat hook",
    );
  } finally {
    globalThis.Hooks = previousHooks;
    globalThis.game.pf2e.DamageRoll = previousDamageRoll;
  }

  // Focus spells use a focus point, not a slot. With a point available, a cast whose entry.cast()
  // returns nothing must still be a success (this was the false "no slot available" warning); with
  // no points it fails. Cantrips (no resource) always succeed.
  const focusEntry = { id: "entry-focus", system: { prepared: { value: "focus" } }, cast: async () => undefined };
  const focusActor = { name: "Cleric", system: { resources: { focus: { value: 1 } } }, itemTypes: { spellcastingEntry: [focusEntry] } };
  const focusContext = { actor: { document: focusActor }, token: { id: "cleric-token", center: { x: 0, y: 0 }, width: 1, height: 1 } };
  const focusAction = {
    name: "Heal",
    source: "spell-focus",
    executable: "open-item",
    spellcastingEntryId: "entry-focus",
    item: { id: "heal", type: "spell", name: "Heal" },
    activityProfile: { spell: true },
  };
  const focusCast = await executeDraftStep({ context: focusContext, step: { instanceId: "focus-cast" }, action: focusAction });
  assert.equal(focusCast.status, "done", "a focus spell with a focus point must cast (not a false 'no slot' failure) even though entry.cast() returns nothing");

  focusActor.system.resources.focus.value = 0;
  const focusNoPoints = await executeDraftStep({ context: focusContext, step: { instanceId: "focus-empty" }, action: focusAction });
  assert.equal(focusNoPoints.status, "failed", "a focus spell with no focus points should fail to execute");

  const cantripActor = { name: "Sorcerer", itemTypes: { spellcastingEntry: [{ id: "entry-cantrip", system: { prepared: { value: "spontaneous" }, slots: {} }, cast: async () => undefined }] } };
  const cantripCast = await executeDraftStep({
    context: { actor: { document: cantripActor }, token: { id: "sorc-token", center: { x: 0, y: 0 }, width: 1, height: 1 } },
    step: { instanceId: "cantrip-cast" },
    action: {
      name: "Electric Arc",
      source: "spell-spontaneous",
      executable: "open-item",
      spellcastingEntryId: "entry-cantrip",
      item: { id: "electric-arc", type: "spell", name: "Electric Arc", isCantrip: true },
      activityProfile: { spell: true },
    },
  });
  assert.equal(cantripCast.status, "done", "a cantrip uses no slot and must always cast");

  // Translocate (a teleportation spell) needs a destination like a Stride, then casts and moves the
  // token to it instantly — no movement animation. With no destination it asks for one first.
  let teleportUpdate = null;
  const teleportTokenDoc = { id: "ezren-token", x: 100, y: 100, update: async (data, options) => { teleportUpdate = { data, options }; } };
  const teleportActor = {
    name: "Ezren",
    system: { resources: { focus: { value: 0 } } },
    itemTypes: { spellcastingEntry: [{ id: "entry-tp", system: { prepared: { value: "spontaneous" }, slots: { slot4: { value: 1 } } }, cast: async () => undefined }] },
  };
  const teleportContext = { actor: { document: teleportActor }, token: { id: "ezren-token", center: { x: 100, y: 100 }, width: 1, height: 1, document: teleportTokenDoc } };
  const teleportAction = {
    name: "Translocate",
    source: "spell-spontaneous",
    executable: "open-item",
    spellcastingEntryId: "entry-tp",
    castRank: 4,
    item: { id: "translocate", type: "spell", name: "Translocate" },
    activityProfile: { spell: true, teleport: true },
    targetingProfile: { self: true },
  };
  const teleportNoDest = await executeDraftStep({ context: teleportContext, step: { instanceId: "tp-nodest" }, action: teleportAction });
  assert.equal(teleportNoDest.status, "needs-choice", "a teleport with no destination should ask for one");
  assert.deepEqual(teleportNoDest.choices, ["destination"]);
  assert.equal(teleportUpdate, null, "a teleport must not move the token before a destination is chosen");

  const teleportDone = await executeDraftStep({ context: teleportContext, step: { instanceId: "tp-go", destination: { x: 500, y: 300 } }, action: teleportAction });
  assert.equal(teleportDone.status, "done", "a teleport with a destination casts and resolves");
  assert.ok(teleportUpdate, "a teleport should reposition the token");
  assert.equal(teleportUpdate.options?.animate, false, "a teleport should move the token without a movement animation");
  assert.ok(
    teleportDone.patch.execution.revert.ops.some((op) => op.kind === "movement"),
    "reverting a teleport should restore the token's original position",
  );

  // Multiple distinct @Template embeds are surfaced so the player can pick which to place.
  // Both description sources are set so rawDescription concatenates them (doubling matches);
  // the picker must still show each distinct shape only once.
  const twinBlastDescription = "Make a basic Reflex save. Deals @Damage[6d6][fire]. Choose @Template[type:burst|distance:20] or @Template[type:cone|distance:30].";
  const twinBlast = classifySystemAction({
    name: "Twin Blast",
    description: { value: twinBlastDescription },
    system: { description: { value: twinBlastDescription } },
  }, { actionCost: 2 });
  assert.ok(twinBlast, "a damaging multi-template action should classify");
  assert.equal(twinBlast.targetingProfile?.templates?.length, 2, "duplicate @Template matches should be collapsed to distinct shapes");
  assert.deepEqual(twinBlast.targetingProfile.templates.map((template) => template.type), ["burst", "cone"]);
  assert.equal(twinBlast.targetingProfile.templates[1].distance, 30);

  const movementResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "move-step", destination: { x: 5, y: 0 } },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(movementResult.status, "done");
  assert.deepEqual(tokenMoves.at(-1), {
    waypoint: { x: 2.5, y: -2.5, action: "walk", explicit: true, checkpoint: true, snapped: true },
    options: { method: "api", showRuler: true },
  });
  assert.deepEqual(tokenUpdates, [], "execution movement should use Foundry movement API instead of raw document update");

  // A flying Stride to a chosen elevation moves with the fly movement action and applies the
  // elevation; reverting it later drops the token back to its take-off elevation.
  const flyMovementResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "fly-move-step", destination: { x: 5, y: 0, elevation: 15 } },
    action: { name: "Stride", slug: "stride", movementAction: "fly", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(flyMovementResult.status, "done");
  assert.deepEqual(tokenMoves.at(-1), {
    waypoint: { x: 2.5, y: -2.5, action: "fly", elevation: 15, explicit: true, checkpoint: true, snapped: true },
    options: { method: "api", showRuler: true },
  }, "a fly Stride should move with the fly movement action and apply the chosen elevation");

  // A multi-waypoint flight applies each leg's own elevation, so the token can climb to one height
  // then settle at another along the path.
  const flyMultiResult = await executeDraftStep({
    context: executionContext,
    step: {
      instanceId: "fly-multi-step",
      destination: { x: 10, y: 0, elevation: 10 },
      movementPlan: { native: false, waypoints: [{ x: 5, y: 0, elevation: 5 }, { x: 10, y: 0, elevation: 10 }] },
    },
    action: { name: "Stride", slug: "stride", movementAction: "fly", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(flyMultiResult.status, "done");
  assert.deepEqual(
    tokenMoves.slice(-2).map((entry) => ({
      x: entry.waypoint.x, y: entry.waypoint.y, elevation: entry.waypoint.elevation, action: entry.waypoint.action,
    })),
    [
      { x: 2.5, y: -2.5, elevation: 5, action: "fly" },
      { x: 7.5, y: -2.5, elevation: 10, action: "fly" },
    ],
    "each waypoint of a flight should move to its own elevation",
  );

  const stepMovementResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "step-move-step", destination: { x: 0, y: 5 } },
    action: { name: "Step", slug: "step", executable: "chat-guidance" },
  });
  assert.equal(stepMovementResult.status, "done");
  assert.deepEqual(tokenMoves.at(-1), {
    waypoint: { x: -2.5, y: 2.5, action: "walk", explicit: true, checkpoint: true, snapped: true },
    options: { method: "api", showRuler: true },
  }, "executing a planned Step should move with Foundry's walk movement mode to the selected adjacent square");

  const sparseStepMovementResult = await executeDraftStep({
    context: executionContext,
    step: {
      instanceId: "sparse-step-move-step",
      actionKey: "step",
      requiresDestination: true,
      destination: { x: 5, y: 0 },
    },
    action: { name: "Step", executable: "chat-guidance" },
  });
  assert.equal(sparseStepMovementResult.status, "done");
  assert.deepEqual(tokenMoves.at(-1), {
    waypoint: { x: 2.5, y: -2.5, action: "walk", explicit: true, checkpoint: true, snapped: true },
    options: { method: "api", showRuler: true },
  }, "Step execution should use the stored draft destination with Foundry's walk movement mode even when the resolved action lacks a slug");

  const beforeWaypointFailureMoveCount = tokenMoves.length;
  const waypointPathFailure = await executeDraftStep({
    context: executionContext,
    step: {
      instanceId: "over-budget-waypoint-step",
      destination: { x: 0, y: 20 },
      movementPlan: {
        native: false,
        waypoints: [{ x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
      },
    },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(waypointPathFailure.status, "failed");
  assert.equal(waypointPathFailure.error, "Waypoint path is beyond movement range.");
  assert.equal(tokenMoves.length, beforeWaypointFailureMoveCount, "over-budget custom waypoint path should not move the token");

  const waypointPathResult = await executeDraftStep({
    context: executionContext,
    step: {
      instanceId: "waypoint-move-step",
      destination: { x: 10, y: 10 },
      movementPlan: {
        native: false,
        waypoints: [{ x: 5, y: 0 }, { x: 10, y: 10 }],
      },
    },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(waypointPathResult.status, "done");
  assert.deepEqual(
    tokenMoves.slice(-2).map((entry) => entry.waypoint),
    [
      { x: 2.5, y: -2.5, action: "walk", explicit: true, checkpoint: true, snapped: true },
      { x: 7.5, y: 7.5, action: "walk", explicit: true, checkpoint: true, snapped: true },
    ],
    "custom waypoint execution should move through stored waypoints without native movement plan side effects",
  );

  globalThis.canvas.grid.size = 100;
  globalThis.canvas.scene.grid.distance = 5;
  actorToken.center = { x: 50, y: 50 };
  executionContext.token.center = { x: 50, y: 50 };
  const scaledMovementResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "scaled-move-step", destination: { x: 150, y: 50 } },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(scaledMovementResult.status, "done");
  assert.equal(
    scaledMovementResult.error,
    undefined,
    "executor should validate movement in scene distance units, not raw canvas pixels",
  );
  assert.deepEqual(tokenMoves.at(-1).waypoint, {
    x: 100,
    y: 0,
    action: "walk",
    explicit: true,
    checkpoint: true,
    snapped: true,
  });
  globalThis.canvas.grid.size = 5;
  globalThis.canvas.scene.grid.distance = 5;
  actorToken.center = { x: 0, y: 0 };
  executionContext.token.center = { x: 0, y: 0 };

  actorToken.document.movement = { state: "planned", id: "planned-move" };
  const plannedMovementResult = await executeDraftStep({
    context: executionContext,
    step: {
      instanceId: "planned-move-step",
      destination: { x: 10, y: 0 },
      movementPlan: { id: "planned-move" },
    },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(plannedMovementResult.status, "done");
  assert.equal(movementStarts.at(-1), "planned-move");

  globalThis.game.combat = { combatant: { tokenId: "other-token" } };
  actorToken.document.movement = { state: "completed", id: null };
  const offTurnMovementResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "off-turn-move-step", destination: { x: 15, y: 0 } },
    action: { name: "Stride", slug: "stride", executable: "chat-guidance", requiresDestination: true },
  });
  assert.equal(offTurnMovementResult.status, "failed");
  assert.equal(offTurnMovementResult.error, "Token can only move on its turn.");
  delete globalThis.game.combat;

  const standResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "stand-step" },
    action: { name: "Stand", slug: "stand", executable: "pf2e-action" },
  });
  assert.equal(standResult.status, "done");
  assert.deepEqual(conditionUpdates.at(-1), { slug: "prone", options: { forceRemove: true } });

  const retchResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "retch-step" },
    action: { name: "Retch", slug: "retch", executable: "pf2e-action" },
    choices: { retchSucceeded: true },
  });
  assert.equal(retchResult.status, "done");
  assert.deepEqual(conditionUpdates.at(-1), { slug: "sickened", options: {} });

  // Phase 2: given a DC, Retch rolls the Fortitude save against it (the player's roll) and returns a
  // "retch-result" choice carrying the rolled degree — it does NOT apply yet (the GM rules on it).
  let fortRollCount = 0;
  let fortRollDc = null;
  const retchSaveActor = {
    decreaseCondition: async (slug, options = {}) => { conditionUpdates.push({ slug, options }); },
    increaseCondition: async (slug, options = {}) => { conditionIncreases.push({ slug, options }); },
    saves: { fortitude: { roll: async ({ dc } = {}) => { fortRollCount += 1; fortRollDc = dc?.value ?? dc ?? null; return { degreeOfSuccess: 3 }; } } },
  };
  const retchSaveContext = { actor: { document: retchSaveActor }, token: { id: "retcher", center: { x: 0, y: 0 } } };
  const retchRolledResult = await executeDraftStep({
    context: retchSaveContext,
    step: { instanceId: "retch-roll-step" },
    action: { name: "Retch", slug: "retch", executable: "pf2e-action" },
    choices: { dc: 21 },
  });
  assert.equal(fortRollCount, 1, "Retch should roll the Fortitude save once a DC is supplied");
  assert.equal(fortRollDc, 21, "Retch should roll the save against the GM-supplied DC");
  assert.equal(retchRolledResult.status, "needs-choice");
  assert.deepEqual(retchRolledResult.choices, ["retch-result"]);
  assert.equal(retchRolledResult.rolled?.critical, true, "a degree-3 save should surface as a critical success for the GM to rule on");

  // Phase 3: the GM rules a critical success -> remove 2 sickened with two revert ops.
  const retchCritResult = await executeDraftStep({
    context: retchSaveContext,
    step: { instanceId: "retch-crit-step" },
    action: { name: "Retch", slug: "retch", executable: "pf2e-action" },
    choices: { retchSucceeded: true, retchCritical: true },
  });
  assert.equal(retchCritResult.status, "done");
  assert.equal(
    retchCritResult.patch.execution.revert.ops.filter((op) => op.kind === "condition" && op.slug === "sickened").length,
    2,
    "a critical-success Retch should remove 2 sickened (two revert ops)",
  );

  // Phase 1: without a DC (or preset outcome) Retch does NOT roll blind — it asks the GM for the DC.
  let blindRollCount = 0;
  const retchNoDcResult = await executeDraftStep({
    context: { actor: { document: { decreaseCondition: async () => {}, saves: { fortitude: { roll: async () => { blindRollCount += 1; return { degreeOfSuccess: 3 }; } } } } }, token: { id: "x", center: { x: 0, y: 0 } } },
    step: { instanceId: "retch-nodc-step" },
    action: { name: "Retch", slug: "retch", executable: "pf2e-action" },
  });
  assert.equal(retchNoDcResult.status, "needs-choice");
  assert.deepEqual(retchNoDcResult.choices, ["retch-dc"]);
  assert.equal(blindRollCount, 0, "Retch should not roll the save until a DC is supplied");

  // The GM-side prompts settle sensibly with no dialog available (headless): the DC prompt yields
  // null, and the result prompt mirrors the rolled degree (or no reduction when nothing was rolled).
  assert.equal(await promptRetchDc({ actorName: "Ezren" }), null, "headless promptRetchDc returns null without a dialog");
  assert.deepEqual(await promptRetchResult({ rolled: { succeeded: true, critical: true } }), { succeeded: true, critical: true }, "headless promptRetchResult settles to the rolled degree");
  assert.deepEqual(await promptRetchResult({}), { succeeded: false, critical: false }, "headless promptRetchResult with no roll is no reduction");

  // Retch is routed to the active GM over socketlib (executeAsGM), which runs the registered prompt
  // on the GM and returns its result. The typed callers in scripts/socket.js wrap that, returning
  // null when socketlib isn't ready so the panel falls back to a local prompt.
  assert.equal(await requestRetchDc({ actorName: "Ezren" }), null, "no socketlib → DC request returns null (local fallback)");
  assert.equal(await requestRetchResult({ actorName: "Ezren" }), null, "no socketlib → result request returns null (local fallback)");

  const socketCalls = [];
  const sharedDraftCalls = [];
  setSocket({
    executeAsGM: async (handler, args) => {
      socketCalls.push({ handler, args });
      if (handler === "promptRetchDc") return 18;
      if (handler === "promptRetchResult") return { succeeded: true, critical: true };
      return null;
    },
    executeForAllGMs: (handler, payload) => { sharedDraftCalls.push({ handler, payload }); },
  });
  try {
    assert.equal(await requestRetchDc({ actorName: "Ezren" }), 18, "DC request routes to the GM's promptRetchDc and returns its DC");
    assert.equal(socketCalls.at(-1)?.handler, "promptRetchDc");
    assert.deepEqual(await requestRetchResult({ actorName: "Ezren", rolled: { succeeded: true, critical: false } }), { succeeded: true, critical: true }, "result request routes to the GM's promptRetchResult");
    assert.equal(socketCalls.at(-1)?.handler, "promptRetchResult");

    shareDraftPlan({ type: "shareDraft", actorName: "Ezren" });
    assert.equal(sharedDraftCalls.at(-1)?.handler, "receiveSharedDraft", "sharing a plan routes to the GMs' receiveSharedDraft handler");

    // A handler that throws (e.g. no GM connected) degrades to null rather than rejecting.
    setSocket({ executeAsGM: async () => { throw new Error("No GM connected"); }, executeForAllGMs: () => {} });
    assert.equal(await requestRetchDc({ actorName: "Ezren" }), null, "a socketlib error (no GM) resolves to null so the caller can fall back");
  } finally {
    setSocket(null);
  }

  // Raise a Shield resolves through PF2e's legacy camelCase function (not a slug Action) and
  // needs no target — it should report done, not "PF2e action API is not available".
  const raiseShieldResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "raise-shield-step" },
    action: {
      name: "Raise a Shield",
      slug: "raise-a-shield",
      executable: "pf2e-action",
      role: "defense",
      suggestedTarget: { type: "self", id: "actor-token", name: "Valeros" },
    },
  });
  assert.equal(raiseShieldResult.status, "done", "Raise a Shield should execute via the legacy action function without asking for a target");

  // Drop Prone applies prone; revert clears it.
  const dropProneResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "drop-prone-step" },
    action: { name: "Drop Prone", slug: "drop-prone", executable: "drop-prone" },
  });
  assert.equal(dropProneResult.status, "done");
  assert.deepEqual(conditionIncreases.at(-1), { slug: "prone", options: {} }, "Drop Prone should apply the prone condition");
  const dropProneRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "drop-prone-step", execution: dropProneResult.patch.execution } });
  assert.equal(dropProneRevert.status, "reverted");
  assert.deepEqual(conditionUpdates.at(-1), { slug: "prone", options: { forceRemove: true } }, "reverting Drop Prone should clear prone");

  // Draw weapon sets it held; revert restores the prior carry state.
  const drawWeapon = { id: "sword", name: "Longsword", uuid: "Actor.valeros.Item.sword", actor: actorDocument, system: { equipped: { carryType: "worn", handsHeld: 0 }, usage: { hands: 1 } } };
  createdEffects.set(drawWeapon.uuid, drawWeapon);
  const drawResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "draw-weapon-step" },
    action: { name: "Draw Longsword", slug: "draw-longsword", executable: "draw-weapon", item: drawWeapon },
  });
  assert.equal(drawResult.status, "done");
  assert.deepEqual(carryChanges.at(-1), { item: "sword", carryType: "held", handsHeld: 1 }, "Draw should put the weapon in hand");
  const drawRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "draw-weapon-step", execution: drawResult.patch.execution } });
  assert.equal(drawRevert.status, "reverted");
  assert.deepEqual(carryChanges.at(-1), { item: "sword", carryType: "worn", handsHeld: 0 }, "reverting Draw should restore the prior carry state");

  // Release (drop) drops a held weapon; revert restores held.
  const heldWeapon = { id: "dagger", name: "Dagger", uuid: "Actor.valeros.Item.dagger", actor: actorDocument, system: { equipped: { carryType: "held", handsHeld: 1 }, usage: { hands: 1 } } };
  createdEffects.set(heldWeapon.uuid, heldWeapon);
  const releaseResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "release-weapon-step" },
    action: { name: "Release Dagger", slug: "release-dagger", executable: "drop-weapon", item: heldWeapon },
  });
  assert.equal(releaseResult.status, "done");
  assert.deepEqual(carryChanges.at(-1), { item: "dagger", carryType: "dropped", handsHeld: 0 }, "Release should drop the held weapon");
  const releaseRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "release-weapon-step", execution: releaseResult.patch.execution } });
  assert.equal(releaseRevert.status, "reverted");
  assert.deepEqual(carryChanges.at(-1), { item: "dagger", carryType: "held", handsHeld: 1 }, "reverting Release should restore the held weapon");
  // Sheathe (1 action) stows a held weapon to its worn slot; revert restores held.
  const sheatheWeapon = { id: "rapier", name: "Rapier", uuid: "Actor.valeros.Item.rapier", actor: actorDocument, system: { equipped: { carryType: "held", handsHeld: 1 }, usage: { hands: 1 } } };
  createdEffects.set(sheatheWeapon.uuid, sheatheWeapon);
  const sheatheResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "sheathe-weapon-step" },
    action: { name: "Sheathe Rapier", slug: "sheathe-rapier", executable: "sheathe-weapon", item: sheatheWeapon },
  });
  assert.equal(sheatheResult.status, "done");
  assert.deepEqual(carryChanges.at(-1), { item: "rapier", carryType: "worn", handsHeld: 0 }, "Sheathe should stow the held weapon");
  const sheatheRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "sheathe-weapon-step", execution: sheatheResult.patch.execution } });
  assert.equal(sheatheRevert.status, "reverted");
  assert.deepEqual(carryChanges.at(-1), { item: "rapier", carryType: "held", handsHeld: 1 }, "reverting Sheathe should restore the held weapon");

  // Using a consumable that still has quantity left: revert restores the quantity.
  let healingPotionQuantity = 2;
  const healingPotionUuid = "Actor.valeros.Item.healing-potion";
  const healingPotion = {
    id: "healing-potion",
    type: "consumable",
    uuid: healingPotionUuid,
    system: { quantity: { value: healingPotionQuantity } },
    toObject: () => ({ name: "Healing Potion", type: "consumable", system: { quantity: { value: healingPotionQuantity } } }),
    use: async () => {
      healingPotionQuantity -= 1;
      healingPotion.system.quantity.value = healingPotionQuantity;
      return null;
    },
    update: async (data) => {
      consumableUpdates.push({ item: "healing-potion", data });
      if ("system.quantity.value" in data) {
        healingPotionQuantity = data["system.quantity.value"];
        healingPotion.system.quantity.value = healingPotionQuantity;
      }
    },
  };
  createdEffects.set(healingPotionUuid, healingPotion);
  const potionResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "potion-step" },
    action: { name: "Healing Potion", slug: "healing-potion", executable: "open-item", item: healingPotion },
  });
  assert.equal(potionResult.status, "done");
  assert.equal(healingPotionQuantity, 1, "using the potion should decrement its quantity");
  const potionConsumableOp = potionResult.patch.execution.revert?.ops?.find((op) => op.kind === "consumable");
  assert.ok(potionConsumableOp, "using a consumable whose quantity changed should record a consumable revert op");
  assert.equal(potionConsumableOp.itemUuid, healingPotionUuid);
  assert.equal(potionConsumableOp.quantityBefore, 2, "the revert op should carry the quantity from BEFORE the use");

  // Using the last one of a consumable (PF2e deletes it once spent): the revert op carries the
  // full source data needed to recreate it, since there's no item left to restore a quantity on.
  const lastPotionUuid = "Actor.valeros.Item.last-potion";
  const lastPotionSourceData = { name: "Last Healing Potion", type: "consumable", system: { quantity: { value: 1 } } };
  const lastPotion = {
    id: "last-potion",
    type: "consumable",
    uuid: lastPotionUuid,
    system: { quantity: { value: 1 } },
    toObject: () => lastPotionSourceData,
    use: async () => {
      createdEffects.delete(lastPotionUuid); // simulate PF2e deleting the item once its last use is spent
      return null;
    },
  };
  createdEffects.set(lastPotionUuid, lastPotion);
  const lastPotionResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "last-potion-step" },
    action: { name: "Last Healing Potion", slug: "last-healing-potion", executable: "open-item", item: lastPotion },
  });
  assert.equal(lastPotionResult.status, "done");
  assert.equal(createdEffects.has(lastPotionUuid), false, "using the last potion should delete it (simulated)");
  const deletedConsumableOp = lastPotionResult.patch.execution.revert?.ops?.find((op) => op.kind === "consumable");
  assert.ok(deletedConsumableOp?.deleted, "consuming the last one should record a 'deleted' consumable revert op");
  assert.equal(deletedConsumableOp.sourceData?.name, "Last Healing Potion", "the deleted op should carry the source data needed to recreate the item");
  assert.equal(deletedConsumableOp.actorUuid, actorDocument.uuid);

  const potionRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "potion-step", execution: potionResult.patch.execution } });
  assert.equal(potionRevert.status, "reverted");
  assert.equal(healingPotionQuantity, 2, "reverting should restore the potion's quantity");
  assert.deepEqual(consumableUpdates.at(-1), { item: "healing-potion", data: { "system.quantity.value": 2 } }, "revert should write the quantity back via item.update");

  const lastPotionRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "last-potion-step", execution: lastPotionResult.patch.execution } });
  assert.equal(lastPotionRevert.status, "reverted");
  assert.equal(effectCreates.at(-1)?.type, "Item", "reverting a fully-consumed item should recreate it via createEmbeddedDocuments");
  assert.equal(effectCreates.at(-1)?.document?.name, "Last Healing Potion", "the recreated item should match the source data captured before it was consumed");

  // Real PF2e consumable documents have no .use() method at all -- only .consume(thisMany). Prove
  // executeNativeItem actually dispatches to it (and the capture/restore machinery from Tasks 1-2
  // still produces a working revert op), using a fixture shaped like the genuine document API.
  let scrollUsesValue = 1;
  const scrollUuid = "Actor.valeros.Item.scroll-of-fireball";
  const scroll = {
    id: "scroll-of-fireball",
    type: "consumable",
    uuid: scrollUuid,
    system: { quantity: 1, uses: { value: scrollUsesValue, max: 1 } },
    toObject: () => ({ name: "Scroll of Fireball", type: "consumable", system: { quantity: 1, uses: { value: scrollUsesValue, max: 1 } } }),
    consume: async () => {
      scrollUsesValue -= 1;
      scroll.system.uses.value = scrollUsesValue;
    },
    update: async (data) => {
      consumableUpdates.push({ item: "scroll-of-fireball", data });
      if ("system.uses.value" in data) {
        scrollUsesValue = data["system.uses.value"];
        scroll.system.uses.value = scrollUsesValue;
      }
    },
  };
  createdEffects.set(scrollUuid, scroll);
  assert.equal(typeof scroll.use, "undefined", "this fixture deliberately has no .use(), matching the real ConsumablePF2e API");
  const scrollResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "scroll-step" },
    action: { name: "Scroll of Fireball", slug: "scroll-of-fireball", executable: "open-item", item: scroll },
  });
  assert.equal(scrollResult.status, "done");
  assert.equal(scrollUsesValue, 0, "executeNativeItem should dispatch to .consume() for a real consumable, decrementing its uses");
  const scrollConsumableOp = scrollResult.patch.execution.revert?.ops?.find((op) => op.kind === "consumable");
  assert.ok(scrollConsumableOp, "consuming via .consume() should still record a consumable revert op");
  assert.equal(scrollConsumableOp.usesValueBefore, 1);
  const scrollRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "scroll-step", execution: scrollResult.patch.execution } });
  assert.equal(scrollRevert.status, "reverted");
  assert.equal(scrollUsesValue, 1, "reverting should restore the scroll's uses");

  // Real PF2e physical items (including consumables) carry system.quantity as a BARE NUMBER, not
  // { value: N } -- confirmed directly against a live actor's "Rations" item. Consuming the last
  // use of a stacked item also drops the stack by one and resets uses to max (mirroring the real
  // ConsumablePF2e#consume autoDestroy-with-quantity-left branch).
  let journeyCakeQuantity = 2;
  let journeyCakeUses = 1;
  const journeyCakeUuid = "Actor.valeros.Item.journey-cake";
  const journeyCake = {
    id: "journey-cake",
    type: "consumable",
    uuid: journeyCakeUuid,
    system: { quantity: journeyCakeQuantity, uses: { value: journeyCakeUses, max: 1, autoDestroy: true } },
    toObject: () => ({ name: "Journey Cake", type: "consumable", system: { quantity: journeyCakeQuantity, uses: { value: journeyCakeUses, max: 1 } } }),
    consume: async () => {
      journeyCakeQuantity -= 1;
      journeyCakeUses = 1;
      journeyCake.system.quantity = journeyCakeQuantity;
      journeyCake.system.uses.value = journeyCakeUses;
    },
    update: async (data) => {
      consumableUpdates.push({ item: "journey-cake", data });
      if ("system.quantity" in data) {
        journeyCakeQuantity = data["system.quantity"];
        journeyCake.system.quantity = journeyCakeQuantity;
      }
      if ("system.uses.value" in data) {
        journeyCakeUses = data["system.uses.value"];
        journeyCake.system.uses.value = journeyCakeUses;
      }
    },
  };
  createdEffects.set(journeyCakeUuid, journeyCake);
  const journeyCakeResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "journey-cake-step" },
    action: { name: "Journey Cake", slug: "journey-cake", executable: "open-item", item: journeyCake },
  });
  assert.equal(journeyCakeResult.status, "done");
  assert.equal(journeyCakeQuantity, 1, "consuming should decrement the bare-number quantity field");
  const journeyCakeOp = journeyCakeResult.patch.execution.revert?.ops?.find((op) => op.kind === "consumable");
  assert.ok(journeyCakeOp, "consuming a bare-number-quantity item should still record a consumable revert op");
  assert.equal(journeyCakeOp.quantityBefore, 2);
  const journeyCakeRevert = await revertDraftStep({ context: executionContext, step: { instanceId: "journey-cake-step", execution: journeyCakeResult.patch.execution } });
  assert.equal(journeyCakeRevert.status, "reverted");
  assert.equal(journeyCakeQuantity, 2, "reverting should restore the bare-number quantity field, not corrupt it to 0 via a nonexistent .value sub-path");
  assert.equal(consumableUpdates.at(-1)?.data?.["system.quantity"], 2, "the write path should target the bare field directly, matching its actual shape");
  assert.equal("system.quantity.value" in (consumableUpdates.at(-1)?.data ?? {}), false, "must not write the nonexistent .value sub-path on a bare-number field");

  assert.equal(raiseShieldCalls.length, 1, "Raise a Shield should call the legacy raiseAShield function");
  assert.equal(raiseShieldCalls[0].actors?.[0], actorDocument, "Raise a Shield should act on the acting actor with no canvas target");

  // Sustaining re-posts the spell's chat card so the player can re-use its data; the posted
  // message is recorded as a chat revert op.
  const sustainChatMessages = [];
  const sustainSpellItem = {
    id: "spell-bless",
    name: "Bless",
    uuid: "Actor.valeros.Item.spell-bless",
    toMessage: async () => {
      sustainChatMessages.push("sustain-msg-1");
      return { id: "sustain-msg-1" };
    },
  };
  createdEffects.set(sustainSpellItem.uuid, sustainSpellItem);
  const sustainResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "sustain-step", sustainedSpell: { id: "bless", name: "Bless", spellUuid: sustainSpellItem.uuid } },
    action: { name: "Sustain a Spell", slug: "sustain-a-spell", executable: "chat-guidance" },
  });
  assert.equal(sustainResult.status, "done");
  assert.equal(sustainChatMessages.length, 1, "sustaining should re-post the spell to chat to reuse its data");
  assert.deepEqual(
    sustainResult.patch.execution.revert.ops,
    [{ kind: "chat", messageId: "sustain-msg-1" }],
    "sustain should record a chat revert op for the re-posted spell card",
  );

  const areaMarker = { shape: "burst", center: { x: 100, y: 200 }, distance: 20, label: "Burst 20 ft" };
  const regionData = createAreaRegionData({ context: executionContext, action: executionAreaAction, marker: areaMarker });
  assert.equal(regionData.shapes[0].type, "circle");
  assert.equal(regionData.shapes[0].x, 100);
  assert.equal(regionData.shapes[0].y, 200);
  assert.equal(regionData.shapes[0].radius, 20);

  const areaResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "area-step", areaMarker },
    action: executionAreaAction,
  });
  assert.equal(areaResult.status, "done");
  assert.equal(regionCreates.at(-1).type, "Region");

  // A lasting-duration area also creates a linked PF2e timer effect and stamps the region.
  assert.equal(effectCreates.at(-1)?.type, "Item", "a lasting-duration area should create one timer effect");
  assert.deepEqual(effectCreates.at(-1).document.system.duration, { value: 1, unit: "minutes", expiry: null, sustained: false });
  assert.equal(effectCreates.at(-1).document.flags["pf2e-combater"].areaRegion.regionId, "region-1-0");
  assert.equal(regionUpdates.at(-1).updates[0]._id, "region-1-0", "the region should be stamped with its timer flag");
  assert.ok(regionUpdates.at(-1).updates[0]["flags.pf2e-combater.areaTimer"].effectUuid, "the region timer flag should link the effect");
  const areaRegionOp = areaResult.patch.execution.revert.ops.find((op) => op.kind === "region");
  assert.equal(areaRegionOp.effectUuid, `Actor.valeros.Item.effect-${effectCreates.length}`, "the region revert op should carry the linked effect uuid");

  // An instantaneous AoE spell (no sustained/lasting duration) targets but leaves no template.
  const instantBurstMarker = { shape: "burst", center: { x: 300, y: 300 }, distance: 20 };
  const instantVictim = { id: "burst-victim", center: { x: 305, y: 300 }, setTarget: () => { } };
  const placeablesBeforeInstant = globalThis.canvas.tokens.placeables;
  globalThis.canvas.tokens.placeables = [instantVictim];
  const regionCountBeforeInstant = regionCreates.length;
  const instantAreaResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "instant-area-step", areaMarker: instantBurstMarker },
    action: {
      name: "Fireball",
      slug: "fireball",
      executable: "open-item",
      source: "spell-inferred",
      activityProfile: { spell: true },
      targetingProfile: { area: true, type: "burst", distance: 20 },
    },
  });
  assert.equal(instantAreaResult.status, "done");
  assert.equal(regionCreates.length, regionCountBeforeInstant, "an instantaneous area spell should not leave a persistent region");
  assert.ok(
    !(instantAreaResult.patch.execution.revert?.ops ?? []).some((op) => op.kind === "region"),
    "an instantaneous area spell should have no region revert op",
  );
  assert.deepEqual(instantAreaResult.patch.targetTokenIds, ["burst-victim"], "tokens in the burst are still targeted");
  globalThis.canvas.tokens.placeables = placeablesBeforeInstant;

  // Tokens whose center falls inside a placed template become targets.
  const burstMarker = { shape: "burst", center: { x: 100, y: 200 }, distance: 20 };
  const insideTokenA = { id: "inside-a", center: { x: 105, y: 200 }, setTarget: () => { } };
  const insideTokenB = { id: "inside-b", center: { x: 100, y: 215 }, setTarget: () => { } };
  const outsideToken = { id: "outside", center: { x: 100, y: 230 }, setTarget: () => { } };
  const previousAreaPlaceables = globalThis.canvas.tokens.placeables;
  globalThis.canvas.tokens.placeables = [insideTokenA, insideTokenB, outsideToken];
  const insideTokens = tokensInAreaMarker({ context: executionContext, action: executionAreaAction, marker: burstMarker });
  assert.deepEqual(
    insideTokens.map((token) => token.id).sort(),
    ["inside-a", "inside-b"],
    "tokensInAreaMarker should return only tokens whose center is within the burst radius",
  );
  assert.equal(setTokenTargets(insideTokens), 2, "setTokenTargets should target each in-area token");
  globalThis.canvas.tokens.placeables = previousAreaPlaceables;

  const coneMarker = { shape: "cone", center: { x: 0, y: 0 }, distance: 30, rotation: 0 };
  const coneAction = { name: "Burning Hands", targetingProfile: { type: "cone", distance: 30, width: 5 } };
  const coneHit = { id: "cone-hit", center: { x: 20, y: 2 }, setTarget: () => { } };
  const coneMiss = { id: "cone-miss", center: { x: -20, y: 0 }, setTarget: () => { } };
  globalThis.canvas.tokens.placeables = [coneHit, coneMiss];
  const coneTokens = tokensInAreaMarker({ context: executionContext, action: coneAction, marker: coneMarker });
  assert.deepEqual(
    coneTokens.map((token) => token.id),
    ["cone-hit"],
    "tokensInAreaMarker should respect cone direction and angle",
  );
  globalThis.canvas.tokens.placeables = previousAreaPlaceables;

  // --- Revert execution ---------------------------------------------------
  const moveRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "move-step", execution: movementResult.patch.execution },
  });
  assert.equal(moveRevert.status, "reverted");
  assert.equal(moveRevert.patch.execution.status, "pending", "revert should reset the step to pending");
  assert.deepEqual(tokenUpdates.at(-1), { x: -2.5, y: -2.5 }, "reverting a move should reposition the token to its captured origin");

  // Reverting a multi-waypoint Stride retraces the path in reverse (skipping the current spot,
  // ending at the origin) rather than cutting a straight line back.
  const tokenUpdatesBeforeWaypointRevert = tokenUpdates.length;
  const waypointRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "waypoint-move-step", execution: waypointPathResult.patch.execution },
  });
  assert.equal(waypointRevert.status, "reverted");
  assert.deepEqual(
    tokenUpdates.slice(tokenUpdatesBeforeWaypointRevert),
    [{ x: 2.5, y: -2.5 }, { x: -2.5, y: -2.5 }],
    "reverting a waypoint stride should retrace the waypoints in reverse, not cut a straight line",
  );

  const standRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "stand-step", execution: standResult.patch.execution },
  });
  assert.equal(standRevert.status, "reverted");
  assert.deepEqual(conditionIncreases.at(-1), { slug: "prone", options: {} }, "reverting Stand should re-apply prone");

  const retchRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "retch-step", execution: retchResult.patch.execution },
  });
  assert.equal(retchRevert.status, "reverted");
  assert.deepEqual(conditionIncreases.at(-1), { slug: "sickened", options: {} }, "reverting a successful Retch should restore sickened");

  const retchFailResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "retch-fail-step" },
    action: { name: "Retch", slug: "retch", executable: "pf2e-action" },
    choices: { retchSucceeded: false },
  });
  assert.equal(retchFailResult.status, "done");
  assert.equal(retchFailResult.patch.execution.revert, undefined, "a failed Retch check should attach no revert payload");

  assert.ok(
    areaResult.patch.execution.revert?.ops?.some((op) => op.kind === "region"),
    "executing an area action should capture a region revert op",
  );
  const areaRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "area-step", execution: areaResult.patch.execution },
  });
  assert.equal(areaRevert.status, "reverted");
  assert.deepEqual(regionDeletes.at(-1), { type: "Region", ids: ["region-1-0"] }, "reverting an area action should delete the placed region");
  assert.ok(effectDeletes.includes(areaRegionOp.effectUuid), "reverting an area action should delete its linked timer effect");

  globalThis.game.user.targets = new Set([targetToken]);
  let strikeRollParams = null;
  const strikeResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "strike-revert-step", targetTokenIds: ["target-token"], targetSelection: "manual" },
    action: {
      name: "Strike",
      slug: "strike",
      executable: "strike",
      strike: {
        roll: async (params) => {
          strikeRollParams = params;
          return { documentName: "ChatMessage", id: "msg-strike-1" };
        },
      },
    },
    event: { type: "click" },
  });
  globalThis.game.user.targets = new Set();
  assert.equal(strikeResult.status, "done");
  assert.ok(
    targetCalls.some((call) => call.selected === true),
    "strike execution should set the Foundry target before rolling",
  );
  assert.equal(
    strikeRollParams?.target,
    undefined,
    "strike roll should rely on the selected target (game.user.targets), not a malformed target param",
  );
  // Strikes roll the multiple-attack-penalty variant for their position in the plan (variants[0]
  // full bonus, [1] MAP -5, [2] MAP -10) instead of always rolling at full bonus.
  globalThis.game.user.targets = new Set([targetToken]);
  const rolledVariants = [];
  const mapStrikeAction = {
    name: "Longsword",
    slug: "strike",
    source: "strike",
    executable: "strike",
    variants: [
      { roll: async () => { rolledVariants.push(0); return { documentName: "ChatMessage", id: "v0" }; } },
      { roll: async () => { rolledVariants.push(1); return { documentName: "ChatMessage", id: "v1" }; } },
      { roll: async () => { rolledVariants.push(2); return { documentName: "ChatMessage", id: "v2" }; } },
    ],
  };
  const mapStrikeBase = { targetTokenIds: ["target-token"], targetSelection: "manual" };
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-1", attackIndex: 1 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 0, "a 1st-attack strike rolls the full-bonus variant");
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-2", attackIndex: 2 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 1, "a 2nd-attack strike (attackIndex 2) rolls the MAP -5 variant");
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-3", attackIndex: 3 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 2, "a 3rd-attack strike (attackIndex 3) rolls the MAP -10 variant");
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-4", attackIndex: 5 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 2, "attack positions beyond the 3rd clamp to the MAP -10 variant");
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-c", attackIndex: 3 }, action: mapStrikeAction, event: {}, choices: { variantIndex: 0 } });
  assert.equal(rolledVariants.at(-1), 0, "an explicit variantIndex overrides the position-derived MAP");
  // A player-pinned MAP level (mapOverride) wins over the position-derived attack index.
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-pin0", attackIndex: 3, mapOverride: 0 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 0, "a pinned MAP 0 overrides a 3rd-attack position");
  await executeDraftStep({ context: executionContext, step: { ...mapStrikeBase, instanceId: "map-pin2", attackIndex: 1, mapOverride: 2 }, action: mapStrikeAction, event: {} });
  assert.equal(rolledVariants.at(-1), 2, "a pinned MAP -10 overrides a 1st-attack position");
  globalThis.game.user.targets = new Set();

  const strikeRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "strike-revert-step", execution: strikeResult.patch.execution },
  });
  assert.equal(strikeRevert.status, "reverted");
  assert.ok(messageDeletes.includes("msg-strike-1"), "reverting a strike should delete the produced chat message");
  assert.ok(
    strikeRevert.warnings.some((warning) => /undo them manually/i.test(warning)),
    "strike revert should warn about effects applied to the target",
  );

  const demoralizeRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "target-step", execution: targetResult.patch.execution },
  });
  assert.equal(demoralizeRevert.status, "reverted");
  assert.ok(
    demoralizeRevert.warnings.some((warning) => /could not be tracked/i.test(warning)),
    "an opened PF2e action without a trackable chat message should warn for manual undo",
  );

  const preparedSpellSlot = { id: "prepared-spell", spellId: "prepared-spell", expended: false };
  const preparedSpellSlotUpdates = [];
  const preparedSpellEntry = {
    id: "prepared-entry",
    uuid: "Actor.valeros.Item.prepared-entry",
    system: {
      prepared: { value: "prepared" },
      slots: { slot1: { prepared: [preparedSpellSlot] } },
    },
    update: async (data) => {
      preparedSpellSlotUpdates.push(data);
      if (Object.prototype.hasOwnProperty.call(data, "system.slots.slot1.prepared.0.expended")) {
        preparedSpellSlot.expended = data["system.slots.slot1.prepared.0.expended"];
      }
    },
    cast: async (_item, options = {}) => {
      assert.equal(options.rank, 1);
      preparedSpellSlot.expended = true;
      return { documentName: "ChatMessage", id: "msg-prepared-cast" };
    },
  };
  actorDocument.itemTypes = { spellcastingEntry: [preparedSpellEntry] };
  const preparedSpellResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "prepared-spell-step" },
    action: {
      id: "spell-prepared",
      name: "Magic Missile",
      slug: "magic-missile",
      source: "spell-curated",
      executable: "open-item",
      item: {
        id: "prepared-spell",
        uuid: "Actor.valeros.Item.prepared-spell",
        slug: "magic-missile",
        type: "spell",
      },
      spellcastingEntryId: "prepared-entry",
      spellcastingEntryUuid: "Actor.valeros.Item.prepared-entry",
      spellcastingEntryType: "prepared",
      castRank: 1,
      rank: 1,
      location: "prepared-entry",
    },
  });
  assert.equal(preparedSpellResult.status, "done");
  assert.equal(preparedSpellSlot.expended, true, "test cast should expend the prepared spell");
  const preparedSlotOp = preparedSpellResult.patch.execution.revert?.ops?.find((op) => op.kind === "slot");
  assert.equal(preparedSlotOp.slotKey, "slot1", "prepared spell revert should record the prepared slot key");
  assert.equal(preparedSlotOp.preparedIndex, 0, "prepared spell revert should record the prepared slot index");
  const preparedSpellRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "prepared-spell-step", execution: preparedSpellResult.patch.execution },
  });
  assert.equal(preparedSpellRevert.status, "reverted");
  assert.equal(preparedSpellSlot.expended, false, "reverting a prepared spell should unexpend that prepared slot");
  assert.deepEqual(
    preparedSpellSlotUpdates.at(-1),
    { "system.slots.slot1.prepared.0.expended": false },
    "prepared spell revert should update the exact prepared spell slot",
  );

  const preparedApiSlot = { id: "prepared-api-spell", expended: true };
  const preparedApiCalls = [];
  actorDocument.itemTypes = {
    spellcastingEntry: [{
      id: "prepared-api-entry",
      uuid: "Actor.valeros.Item.prepared-api-entry",
      system: {
        prepared: { value: "prepared" },
        slots: { slot1: { prepared: [preparedApiSlot] } },
      },
      setSlotExpendedState: async (groupId, slotIndex, value) => {
        preparedApiCalls.push({ groupId, slotIndex, value });
        preparedApiSlot.expended = value;
      },
      update: async () => {
        throw new Error("prepared slot array path update should not be used when PF2e API is available");
      },
    }],
  };
  const preparedApiRevert = await revertDraftStep({
    context: executionContext,
    step: {
      instanceId: "prepared-api-step",
      execution: {
        status: "done",
        revert: {
          ops: [{
            kind: "slot",
            entryId: "prepared-api-entry",
            entryUuid: "Actor.valeros.Item.prepared-api-entry",
            rank: 1,
            slotId: "prepared-api-entry",
            slotIdExplicit: false,
            slotKey: "slot1",
            preparedIndex: 0,
            preparedExpendedBefore: false,
          }],
          manualWarnings: [],
        },
      },
    },
  });
  assert.equal(preparedApiRevert.status, "reverted");
  assert.equal(preparedApiSlot.expended, false, "prepared spell revert should use PF2e slot API when available");
  assert.deepEqual(
    preparedApiCalls.at(-1),
    { groupId: 1, slotIndex: 0, value: false },
    "prepared spell revert should pass rank and prepared slot index to PF2e",
  );

  const legacyPreparedSlot = { id: "legacy-prepared-spell", expended: true };
  const legacyPreparedCalls = [];
  actorDocument.itemTypes = {
    spellcastingEntry: [{
      id: "legacy-prepared-entry",
      uuid: "Actor.valeros.Item.legacy-prepared-entry",
      system: {
        prepared: { value: "prepared" },
        slots: { slot1: { prepared: [legacyPreparedSlot] } },
      },
      setSlotExpendedState: async (groupId, slotIndex, value) => {
        legacyPreparedCalls.push({ groupId, slotIndex, value });
        legacyPreparedSlot.expended = value;
      },
    }],
  };
  const legacyPreparedRevert = await revertDraftStep({
    context: executionContext,
    step: {
      instanceId: "legacy-prepared-step",
      execution: {
        status: "done",
        revert: {
          ops: [{
            kind: "slot",
            entryId: "legacy-prepared-entry",
            entryUuid: "Actor.valeros.Item.legacy-prepared-entry",
            rank: 1,
            slotId: "legacy-prepared-entry",
            slotIdExplicit: false,
          }],
          manualWarnings: [],
        },
      },
    },
  });
  assert.equal(legacyPreparedRevert.status, "reverted");
  assert.equal(legacyPreparedSlot.expended, false, "legacy prepared spell undo should unexpend the only expended prepared slot");
  assert.deepEqual(
    legacyPreparedCalls.at(-1),
    { groupId: 1, slotIndex: 0, value: false },
    "legacy prepared spell undo should infer the prepared slot index from the expended slot",
  );

  const spontaneousSlotUpdates = [];
  const spontaneousEntry = {
    id: "spont-entry",
    uuid: "Actor.valeros.Item.spont-entry",
    system: {
      prepared: { value: "spontaneous" },
      slots: { slot2: { value: 1, max: 2 } },
    },
    update: async (data) => {
      spontaneousSlotUpdates.push(data);
      if (Object.prototype.hasOwnProperty.call(data, "system.slots.slot2.value")) {
        spontaneousEntry.system.slots.slot2.value = data["system.slots.slot2.value"];
      }
    },
    cast: async (_item, options = {}) => {
      assert.equal(options.rank, 2);
      spontaneousEntry.system.slots.slot2.value = 0;
      return { documentName: "ChatMessage", id: "msg-spont-cast" };
    },
  };
  actorDocument.itemTypes = { spellcastingEntry: [spontaneousEntry] };
  const spontaneousSpellResult = await executeDraftStep({
    context: executionContext,
    step: { instanceId: "spontaneous-spell-step" },
    action: {
      id: "spell-spont",
      name: "Blur",
      slug: "blur",
      source: "spell-curated",
      executable: "open-item",
      item: {
        id: "spont-spell",
        uuid: "Actor.valeros.Item.spont-spell",
        slug: "blur",
        type: "spell",
      },
      spellcastingEntryId: "spont-entry",
      spellcastingEntryUuid: "Actor.valeros.Item.spont-entry",
      spellcastingEntryType: "spontaneous",
      castRank: 2,
      rank: 2,
      location: "spont-entry",
    },
  });
  assert.equal(spontaneousSpellResult.status, "done");
  assert.equal(spontaneousEntry.system.slots.slot2.value, 0, "test cast should spend the spontaneous slot");
  const spontaneousSlotOp = spontaneousSpellResult.patch.execution.revert?.ops?.find((op) => op.kind === "slot");
  assert.equal(spontaneousSlotOp.slotKey, "slot2", "spontaneous spell revert should record the rank slot key");
  assert.equal(spontaneousSlotOp.valueBefore, 1, "spontaneous spell revert should record the pre-cast slot count");
  const spontaneousSpellRevert = await revertDraftStep({
    context: executionContext,
    step: { instanceId: "spontaneous-spell-step", execution: spontaneousSpellResult.patch.execution },
  });
  assert.equal(spontaneousSpellRevert.status, "reverted");
  assert.equal(spontaneousEntry.system.slots.slot2.value, 1, "reverting a spontaneous spell should restore the slot count");
  assert.deepEqual(
    spontaneousSlotUpdates.at(-1),
    { "system.slots.slot2.value": 1 },
    "spontaneous spell revert should update the rank's remaining slot count",
  );

  const increasesBeforeRevertAll = conditionIncreases.length;
  const revertAll = await revertDraftExecution({
    context: executionContext,
    draft: {
      steps: [
        { instanceId: "all-stand", execution: standResult.patch.execution },
        { instanceId: "all-retch", execution: retchResult.patch.execution },
      ],
    },
  });
  assert.deepEqual(
    conditionIncreases.slice(increasesBeforeRevertAll).map((entry) => entry.slug),
    ["sickened", "prone"],
    "revert-all should undo completed steps in reverse execution order",
  );
  assert.ok(
    revertAll.draft.steps.every((step) => step.execution.status === "pending"),
    "revert-all should reset every step to pending",
  );
} finally {
  globalThis.game = previousExecutionGame;
  globalThis.canvas = previousExecutionCanvas;
  globalThis.ChatMessage = previousExecutionChatMessage;
  globalThis.fromUuid = previousExecutionFromUuid;
}

// --- Uncounted actions: unified reset/revert (Task 2) ---
{
  const reverted = [];
  const ctx = {};
  const unifiedDraft = {
    steps: [
      { instanceId: "p1", execution: { status: "done", completedAt: 100, revert: { ops: [{ kind: "marker", id: "p1" }] } } },
    ],
    uncounted: [
      { instanceId: "u1", execution: { status: "done", completedAt: 300, revert: { ops: [{ kind: "marker", id: "u1" }] } } },
      { instanceId: "u2", execution: { status: "done", completedAt: 200, revert: { ops: [{ kind: "marker", id: "u2" }] } } },
    ],
  };
  const reset = resetDraftExecution(unifiedDraft);
  assert.ok(reset.steps.every((s) => s.execution.status === "pending"), "reset should clear plan step status");
  assert.ok(reset.uncounted.every((s) => s.execution.status === "pending"), "reset should clear uncounted status");

  const unifiedResult = await revertDraftExecution({
    context: ctx,
    draft: unifiedDraft,
    contextForStep: (step) => { reverted.push(step.instanceId); return ctx; },
  });
  assert.deepEqual(reverted, ["u1", "u2", "p1"], "revert order should be newest completedAt first across both lists");
  assert.ok(unifiedResult.draft.uncounted.every((s) => s.execution.status === "pending"), "returned draft should reset uncounted");
}

const plans = buildTurnPlans(fighterContext, fixtureCandidates);
assert.ok(plans.length >= 1);

const best = bestTurnPlan(fighterContext, fixtureCandidates);
assert.equal(best.id, "demoralize+strike+raise-a-shield");
assert.equal(best.actor.id, "fighter-1");
assert.equal(best.target.name, "Ogre");
assert.equal(best.totalCost, 3);
assert.equal(best.summary, "Demoralize -> Strike -> Raise a Shield");
assert.equal(confidenceLabel(best.confidence), "Medium");

assert.equal(tokenUpdateAffectsCombatGeometry({ name: "Calder" }), false);
assert.equal(tokenUpdateAffectsCombatGeometry({ x: 10 }), true);
assert.equal(tokenUpdateAffectsCombatGeometry({ document: { y: 20 } }), true);
// Visibility toggles (e.g. pf2e-visioner) must NOT trigger a plan rebuild — that churn lagged the
// canvas the whole time the panel was open.
assert.equal(tokenUpdateAffectsCombatGeometry({ hidden: true }), false, "a hidden/visibility change must not trigger a plan rebuild");
assert.equal(tokenUpdateAffectsMovement({ name: "Calder" }), false);
assert.equal(tokenUpdateAffectsMovement({ x: 10 }), true);
assert.equal(tokenUpdateAffectsMovement({ document: { elevation: 5 } }), true);
const tokenRefreshSnapshots = new Map();
const movingToken = {
  id: "token-calder",
  x: 0,
  y: 0,
  document: { uuid: "Scene.Token.token-calder", x: 0, y: 0 },
};
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), true);
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), false);
// Animating the placeable position (token.x/y), with the DOCUMENT unchanged, must NOT schedule a
// refresh — that animation churn caused the continuous ~400ms-rebuild lag.
movingToken.x = 5;
movingToken.y = 7;
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), false, "animation of the placeable position must not schedule a refresh");
// A visibility flip with no movement must NOT count as a refresh-worthy change.
movingToken.document.hidden = true;
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), false, "toggling token visibility should not schedule a refresh");
// A real DOCUMENT move still schedules a refresh.
movingToken.document.x = 50;
assert.equal(consumeTokenRefreshChange(movingToken, tokenRefreshSnapshots), true, "an actual document move still schedules a refresh");
const movementSpendMap = new Map();
const movementDistanceMap = new Map();
const movementOriginMap = new Map();
const movementCombat = {
  id: "combat-1",
  round: 1,
  turn: 0,
  started: true,
  combatant: {
    id: "combatant-calder",
    tokenId: "token-calder",
    token: { id: "token-calder" },
    tokenDocument: { uuid: "Scene.Token.token-calder" },
  },
};
assert.equal(markMovementActionSpent({ id: "other-token" }, { combat: movementCombat, changed: { x: 5 }, spends: movementSpendMap }), false);
assert.equal(markMovementActionSpent(movingToken, { combat: movementCombat, changed: { name: "Calder" }, spends: movementSpendMap }), false);

const trackedMovementToken = {
  id: "token-calder",
  x: 0,
  y: 0,
  document: { uuid: "Scene.Token.token-calder", x: 0, y: 0 },
};
function moveTrackedToken(token, changed) {
  captureMovementOrigin(token, { changed, origins: movementOriginMap });
  Object.assign(token, changed);
  Object.assign(token.document, changed);
  return markMovementActionSpent(token, {
    combat: movementCombat,
    changed,
    origins: movementOriginMap,
    spends: movementSpendMap,
    distances: movementDistanceMap,
  });
}
assert.equal(moveTrackedToken(trackedMovementToken, { x: 5 }), true);
assert.equal(movementActionsSpent(movementCombat, movementSpendMap), 1);
assert.equal(moveTrackedToken(trackedMovementToken, { x: 10 }), false);
assert.equal(moveTrackedToken(trackedMovementToken, { x: 25 }), false);
assert.equal(movementActionsSpent(movementCombat, movementSpendMap), 1);
assert.equal(moveTrackedToken(trackedMovementToken, { x: 30 }), true);
assert.equal(movementActionsSpent(movementCombat, movementSpendMap), 2);
assert.equal(moveTrackedToken(trackedMovementToken, { x: 55 }), true);
assert.equal(moveTrackedToken(trackedMovementToken, { x: 60 }), false);
assert.equal(movementActionsSpent(movementCombat, movementSpendMap), 3);
assert.equal(movementActionsSpent({ ...movementCombat, turn: 1 }, movementSpendMap), 0);
const routedMovementSpendMap = new Map();
const routedMovementDistanceMap = new Map();
const routedMovementOrigins = new Map();
const routedMovementCombat = {
  ...movementCombat,
  combatant: {
    ...movementCombat.combatant,
    actor: {
      system: {
        attributes: { speed: { value: 25 } },
      },
    },
  },
};
captureMovementOrigin({
  id: "token-calder",
  x: 0,
  y: 0,
  document: { uuid: "Scene.Token.token-calder", x: 0, y: 0 },
}, { changed: { x: 20 }, origins: routedMovementOrigins });
assert.equal(markMovementActionSpent({
  id: "token-calder",
  x: 20,
  y: 0,
  document: { uuid: "Scene.Token.token-calder", x: 20, y: 0 },
}, {
  combat: routedMovementCombat,
  changed: {
    x: 20,
    waypoints: [{ x: 0, y: 25 }, { x: 20, y: 25 }],
  },
  origins: routedMovementOrigins,
  spends: routedMovementSpendMap,
  distances: routedMovementDistanceMap,
}), true);
assert.equal(movementActionsSpent(routedMovementCombat, routedMovementSpendMap), 3);

const relevanceContext = {
  actor: { id: "actor-active" },
  combatant: { actor: { id: "actor-active" } },
  token: { id: "token-active", uuid: "Scene.scene.Token.token-active" },
  battlefield: {
    targets: [{
      actor: { id: "actor-target" },
      token: { id: "token-target", uuid: "Scene.scene.Token.token-target" },
    }],
  },
};
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-active.Item.condition" }, relevanceContext), true);
assert.equal(
  documentRelevantToContext({ type: "condition", uuid: "Scene.scene.Token.token-active.Actor.actor-active.Item.condition" }, relevanceContext),
  true,
);
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-target.Item.condition" }, relevanceContext), true);
assert.equal(documentRelevantToContext({ type: "condition", uuid: "Actor.actor-other.Item.condition" }, relevanceContext), false);
assert.equal(documentRelevantToContext({ documentName: "Actor", id: "actor-active" }, relevanceContext), true);

const hadStorageGame = Object.hasOwn(globalThis, "game");
const previousStorageGame = globalThis.game;
const hadLocalStorage = Object.hasOwn(globalThis, "localStorage");
const previousLocalStorage = globalThis.localStorage;
const hadStorageFoundry = Object.hasOwn(globalThis, "foundry");
const previousStorageFoundry = globalThis.foundry;
try {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
  };
  const builderContext = {
    combat: { id: "combat-1", round: 2 },
    combatant: { id: "combatant-1" },
    actor: { uuid: "Actor.actor-1" },
  };
  globalThis.game = { user: { id: "user-1" } };
  assert.equal(favoriteKey(builderContext, "strike-longsword"), "user-1|Actor.actor-1|strike-longsword");
  assert.deepEqual(readActionFavorites(builderContext), new Set());
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), true);
  assert.deepEqual([...readActionFavorites(builderContext)], ["strike-longsword"]);
  assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), false);
  assert.deepEqual([...readActionFavorites(builderContext)], []);
  // Drafts are keyed per combatant (no round) so a plan survives turn/round changes.
  assert.equal(draftPlanKey(builderContext), "user-1|combat-1|combatant-1");
  assert.equal(sharedDraftPlanKey(builderContext), "combat-1|combatant-1");
  writeDraftPlan(builderContext, { steps: [] });
  upsertDraftStep(builderContext, { instanceId: "step-1", actionKey: "stride", actionCost: 1 });
  assert.equal(readDraftPlan(builderContext).steps[0].actionKey, "stride");
  removeDraftStep(builderContext, "step-1");
  assert.deepEqual(readDraftPlan(builderContext).steps, []);
  upsertDraftStep(builderContext, { instanceId: "step-clear", actionKey: "stride", actionCost: 1 });
  assert.equal(readDraftPlan(builderContext).steps.length, 1);
  draftPlanState.clearDraftPlan(builderContext);
  assert.deepEqual(readDraftPlan(builderContext).steps, [], "clearDraftPlan should drop the stored plan when a turn ends");

  globalThis.foundry = { utils: { randomID: () => "generated-step-id-1" } };
  const generatedStep = upsertDraftStep(builderContext, { actionKey: "stride", actionCost: 1 });
  assert.equal(generatedStep.instanceId, "generated-step-id-1");
  assert.equal(readDraftPlan(builderContext).steps[0].instanceId, "generated-step-id-1");
  let nextGeneratedId = 2;
  globalThis.foundry = { utils: { randomID: () => `generated-step-id-${nextGeneratedId++}` } };
  const secondGeneratedStep = upsertDraftStep(builderContext, { actionKey: "strike", actionCost: 1 });
  const thirdGeneratedStep = upsertDraftStep(builderContext, { actionKey: "raise-a-shield", actionCost: 1 });
  assert.notEqual(secondGeneratedStep.instanceId, thirdGeneratedStep.instanceId);
  assert.deepEqual(readDraftPlan(builderContext).steps.map((step) => step.actionKey), [
    "stride",
    "strike",
    "raise-a-shield",
  ]);
  assert.equal(moveDraftStep(builderContext, thirdGeneratedStep.instanceId, -1), true);
  assert.deepEqual(readDraftPlan(builderContext).steps.map((step) => step.actionKey), [
    "stride",
    "raise-a-shield",
    "strike",
  ]);
  assert.equal(moveDraftStep(builderContext, generatedStep.instanceId, -1), false);
  assert.equal(moveDraftStep(builderContext, "missing-step", 1), false);

  // --- Uncounted actions: draft storage (Task 1) ---
  {
    const previousStorage = globalThis.localStorage;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    };
    const previousGame = globalThis.game;
    globalThis.game = { user: { id: "user-1", name: "Player One" } };
    const ctx = { combat: { id: "combat-uc" }, combatant: { id: "combatant-uc" } };
    try {
      assert.deepEqual(emptyDraftPlan().uncounted, [], "emptyDraftPlan should include an uncounted list");

      upsertDraftStep(ctx, { instanceId: "p1", actionKey: "stride", actionCost: 1 }, "steps");
      upsertDraftStep(ctx, { instanceId: "u1", actionKey: "stride", actionCost: 1 }, "uncounted");
      upsertDraftStep(ctx, { instanceId: "u2", actionKey: "strike", actionCost: 1 }, "uncounted");
      let draft = readDraftPlan(ctx);
      assert.deepEqual(draft.steps.map((s) => s.instanceId), ["p1"], "plan list should hold only plan steps");
      assert.deepEqual(draft.uncounted.map((s) => s.instanceId), ["u1", "u2"], "uncounted list should hold its own steps");

      assert.equal(draftListForInstance(draft, "p1"), "steps");
      assert.equal(draftListForInstance(draft, "u2"), "uncounted");
      assert.equal(draftListForInstance(draft, "missing"), "steps", "unknown ids default to the plan list");

      assert.equal(moveDraftStep(ctx, "u2", -1, "uncounted"), true);
      draft = readDraftPlan(ctx);
      assert.deepEqual(draft.uncounted.map((s) => s.instanceId), ["u2", "u1"], "move should reorder within the uncounted list");
      removeDraftStep(ctx, "u1", "uncounted");
      draft = readDraftPlan(ctx);
      assert.deepEqual(draft.uncounted.map((s) => s.instanceId), ["u2"], "remove should drop only the targeted uncounted step");
      assert.deepEqual(draft.steps.map((s) => s.instanceId), ["p1"], "removing an uncounted step must not affect the plan");

      assert.equal(hasSharedDraftPlan({ steps: [], uncounted: [{ instanceId: "u" }] }), true,
        "an uncounted-only draft should be shareable");
      assert.equal(shouldDisplaySharedDraft({ steps: [], uncounted: [] }, { steps: [], uncounted: [{ instanceId: "u" }], updatedAt: 5 }), true,
        "a shared draft with uncounted entries should display over an empty local draft");
    } finally {
      globalThis.localStorage = previousStorage;
      globalThis.game = previousGame;
    }
  }

  writeSharedDraftPlan(builderContext, {
    steps: [{ instanceId: "shared-1", actionKey: "stride", actionCost: 1 }],
    userId: "user-1",
    userName: "Player One",
  });
  assert.equal(readSharedDraftPlan(builderContext).steps[0].actionKey, "stride");
  assert.equal(readSharedDraftPlan(builderContext).userName, "Player One");
  writeSharedDraftPlanPayload({
    combatId: "combat-1",
    round: 2,
    combatantId: "combatant-1",
    steps: [{ instanceId: "shared-2", actionKey: "strike", actionCost: 1 }],
    userId: "user-2",
    userName: "Player Two",
  });
  assert.equal(readSharedDraftPlan(builderContext).steps[0].actionKey, "strike");
  assert.equal(readSharedDraftPlan(builderContext).userName, "Player Two");

  let actorSharedDrafts = {};
  const actorFlagDocument = {
    uuid: "Actor.actor-1",
    getFlag: (scope, key) => scope === "pf2e-combater" && key === "sharedDraftPlans" ? actorSharedDrafts : undefined,
    setFlag: async (scope, key, value) => {
      if (scope === "pf2e-combater" && key === "sharedDraftPlans") actorSharedDrafts = value;
      return value;
    },
  };
  const actorFlagContext = {
    ...builderContext,
    actor: { uuid: "Actor.actor-1", document: actorFlagDocument },
    combatant: { ...builderContext.combatant, actor: actorFlagDocument },
  };
  localStore.set(STORAGE_KEYS.sharedDraftPlans, "{}");
  assert.equal(
    await writeSharedDraftPlanActorFlag(actorFlagContext, {
      steps: [{ instanceId: "shared-flag-1", actionKey: "haste", actionCost: 2 }],
      userId: "user-2",
      userName: "Player Two",
      updatedAt: 500,
    }),
    true,
    "owned actor flag should accept mirrored player shared drafts",
  );
  assert.equal(
    readSharedDraftPlan(actorFlagContext).steps[0].actionKey,
    "haste",
    "GM should read player plan from the actor flag when no socket-local shared draft exists",
  );
  localStore.set(STORAGE_KEYS.sharedDraftPlans, JSON.stringify({
    [sharedDraftPlanKey(builderContext)]: {
      steps: [{ instanceId: "stale-local", actionKey: "shield", actionCost: 1 }],
      userId: "user-2",
      userName: "Player Two",
      updatedAt: 400,
    },
  }));
  assert.equal(
    readSharedDraftPlan(actorFlagContext).steps[0].actionKey,
    "haste",
    "GM should prefer the newer actor-flag player plan over stale socket-local storage",
  );
  await writeSharedDraftPlanActorFlag(actorFlagContext, {
    steps: [],
    userId: "user-2",
    userName: "Player Two",
    updatedAt: 600,
  });
  assert.deepEqual(
    readSharedDraftPlan(actorFlagContext).steps,
    [],
    "GM should clear stale local player plan when the actor flag mirrors an empty player draft",
  );

  assert.equal(
    isSharedDraftPlanEcho({ _id: "actor-1", flags: { "pf2e-combater": { sharedDraftPlans: { "combat-1|combatant-1": {} } } } }),
    true,
    "a pure shared-draft-plan flag write should be recognized as an echo of our own sync",
  );
  assert.equal(
    isSharedDraftPlanEcho({
      flags: { "pf2e-combater": { sharedDraftPlans: { "combat-1|combatant-1": {} } } },
      _stats: { modifiedTime: 1700000000000 },
      _id: "actor-1",
    }),
    true,
    "Foundry's auto-stamped _stats diff field should not disqualify a real setFlag echo (confirmed live against an actual updateActor hook firing)",
  );
  assert.equal(
    isSharedDraftPlanEcho({ system: { attributes: { hp: { value: 5 } } } }),
    false,
    "a real actor data change should not be treated as an echo",
  );
  assert.equal(
    isSharedDraftPlanEcho({ flags: { "pf2e-combater": { sharedDraftPlans: {} }, "other-module": { foo: 1 } } }),
    false,
    "a change that also touches another module's flags should not be treated as a pure echo",
  );
  assert.equal(
    isSharedDraftPlanEcho({ flags: { "pf2e-combater": { sharedDraftPlans: {}, someOtherFlag: true } } }),
    false,
    "a change that also touches one of our OWN other flags should not be treated as a pure sharedDraftPlans-only echo",
  );
  assert.equal(isSharedDraftPlanEcho(null), false, "a missing changes object should not crash and should not be treated as an echo");
  assert.equal(isSharedDraftPlanEcho(undefined), false, "an undefined changes object should not crash and should not be treated as an echo");

  // End-of-turn reset: clearEndedTurnDraft() runs clearDraftPlan (the acting player's local plan)
  // and clearSharedDraftPlan (the GM-visible shared store + actor flag). After a turn ends neither
  // role should still see the ended combatant's plan.
  const endTurnContext = {
    combat: { id: "combat-1" },
    combatant: { id: "combatant-1", actor: actorFlagDocument },
    actor: { uuid: "Actor.actor-1", document: actorFlagDocument },
  };
  localStore.set(STORAGE_KEYS.sharedDraftPlans, "{}");
  writeDraftPlan(endTurnContext, { steps: [{ instanceId: "local-end", actionKey: "stride", actionCost: 1 }] });
  writeSharedDraftPlan(endTurnContext, {
    steps: [{ instanceId: "shared-end", actionKey: "strike", actionCost: 1 }],
    userId: "user-1",
    userName: "Player One",
  });
  await writeSharedDraftPlanActorFlag(endTurnContext, {
    steps: [{ instanceId: "flag-end", actionKey: "haste", actionCost: 2 }],
    userId: "user-1",
    userName: "Player One",
    updatedAt: 700,
  });
  assert.equal(readDraftPlan(endTurnContext).steps.length, 1, "precondition: the player has a local plan before the turn ends");
  assert.equal(readSharedDraftPlan(endTurnContext).steps.length, 1, "precondition: the GM sees a shared plan before the turn ends");

  draftPlanState.clearDraftPlan(endTurnContext);
  await draftPlanState.clearSharedDraftPlan(endTurnContext);

  assert.deepEqual(readDraftPlan(endTurnContext).steps, [], "ending a turn resets the player's local plan");
  assert.deepEqual(
    readSharedDraftPlan(endTurnContext).steps,
    [],
    "ending a turn resets the GM-visible shared plan (socket store + actor flag)",
  );

  // Deleting a combat wipes EVERY combatant's drafts for that combat — local, shared store, and
  // actor flag — without touching another combat's plans.
  let firstActorFlags = {};
  const firstActor = {
    uuid: "Actor.del-1",
    getFlag: (scope, key) => scope === "pf2e-combater" && key === "sharedDraftPlans" ? firstActorFlags : undefined,
    setFlag: async (scope, key, value) => { if (scope === "pf2e-combater" && key === "sharedDraftPlans") firstActorFlags = value; return value; },
  };
  let secondActorFlags = {};
  const secondActor = {
    uuid: "Actor.del-2",
    getFlag: (scope, key) => scope === "pf2e-combater" && key === "sharedDraftPlans" ? secondActorFlags : undefined,
    setFlag: async (scope, key, value) => { if (scope === "pf2e-combater" && key === "sharedDraftPlans") secondActorFlags = value; return value; },
  };
  const deletedCombat = {
    id: "combat-del",
    combatants: [{ id: "c-a", actor: firstActor }, { id: "c-b", actor: secondActor }],
  };
  const ctxA = { combat: deletedCombat, combatant: { id: "c-a", actor: firstActor }, actor: { document: firstActor } };
  const ctxB = { combat: deletedCombat, combatant: { id: "c-b", actor: secondActor }, actor: { document: secondActor } };
  const survivorCtx = { combat: { id: "combat-keep" }, combatant: { id: "c-keep" }, actor: { uuid: "Actor.keep" } };

  localStore.set(STORAGE_KEYS.sharedDraftPlans, "{}");
  writeDraftPlan(ctxA, { steps: [{ instanceId: "a-local", actionKey: "stride", actionCost: 1 }] });
  writeDraftPlan(ctxB, { steps: [{ instanceId: "b-local", actionKey: "step", actionCost: 1 }] });
  writeDraftPlan(survivorCtx, { steps: [{ instanceId: "keep-local", actionKey: "strike", actionCost: 1 }] });
  writeSharedDraftPlan(ctxA, { steps: [{ instanceId: "a-shared", actionKey: "stride", actionCost: 1 }], userId: "user-1" });
  writeSharedDraftPlan(survivorCtx, { steps: [{ instanceId: "keep-shared", actionKey: "strike", actionCost: 1 }], userId: "user-1" });
  await writeSharedDraftPlanActorFlag(ctxA, { steps: [{ instanceId: "a-flag", actionKey: "haste", actionCost: 2 }], userId: "user-1", updatedAt: 800 });
  await writeSharedDraftPlanActorFlag(ctxB, { steps: [{ instanceId: "b-flag", actionKey: "haste", actionCost: 2 }], userId: "user-1", updatedAt: 800 });

  await draftPlanState.clearCombatDraftPlans(deletedCombat);

  assert.deepEqual(readDraftPlan(ctxA).steps, [], "deleting a combat clears each combatant's local plan");
  assert.deepEqual(readDraftPlan(ctxB).steps, [], "deleting a combat clears every combatant's local plan");
  assert.deepEqual(readSharedDraftPlan(ctxA).steps, [], "deleting a combat clears the shared store + actor flag");
  assert.deepEqual(secondActorFlags, {}, "deleting a combat clears every combatant actor's flag mirror");
  assert.equal(readDraftPlan(survivorCtx).steps.length, 1, "deleting one combat must not touch another combat's local plan");
  assert.equal(readSharedDraftPlan(survivorCtx).steps.length, 1, "deleting one combat must not touch another combat's shared plan");

  assert.equal(typeof draftPlanState.shouldDisplaySharedDraft, "function");
  assert.equal(
    draftPlanState.shouldDisplaySharedDraft(
      { steps: [{ actionKey: "old-local" }], updatedAt: 100 },
      { steps: [{ actionKey: "new-shared" }], updatedAt: 200 },
    ),
    true,
    "new player shared draft should replace stale GM local draft in live view",
  );
  assert.equal(
    draftPlanState.shouldDisplaySharedDraft(
      { steps: [{ actionKey: "new-local" }], updatedAt: 300 },
      { steps: [{ actionKey: "old-shared" }], updatedAt: 200 },
    ),
    false,
    "older player shared draft should not replace a newer GM local edit",
  );
  assert.equal(
    draftPlanState.shouldDisplaySharedDraft(
      { steps: [{ actionKey: "loaded-shared" }], source: "shared", updatedAt: 300 },
      { steps: [{ actionKey: "shared" }], updatedAt: 200 },
    ),
    true,
    "GM copies of shared player drafts should stay linked to live player updates",
  );
  assert.equal(
    draftPlanState.shouldDisplaySharedDraft(
      { steps: [{ actionKey: "stale-loaded-shared" }], source: "shared", updatedAt: 300 },
      { steps: [], userId: "user-2", userName: "Player Two", updatedAt: 400 },
    ),
    true,
    "GM copies of shared player drafts should clear when the player removes every planned action",
  );

  for (const invalidValue of ["null", "\"invalid-shape\"", "[]"]) {
    localStore.set(STORAGE_KEYS.actionFavorites, invalidValue);
    assert.doesNotThrow(() => toggleActionFavorite(builderContext, "strike-longsword"));
    assert.deepEqual([...readActionFavorites(builderContext)], ["strike-longsword"]);

    localStore.set(STORAGE_KEYS.draftPlans, invalidValue);
    assert.doesNotThrow(() => writeDraftPlan(builderContext, { steps: [] }));
    assert.deepEqual(readDraftPlan(builderContext).steps, []);

    localStore.set(STORAGE_KEYS.sharedDraftPlans, invalidValue);
    assert.doesNotThrow(() => writeSharedDraftPlan(builderContext, { steps: [] }));
    assert.deepEqual(readSharedDraftPlan(builderContext).steps, []);
  }
} finally {
  if (hadStorageGame) {
    globalThis.game = previousStorageGame;
  } else {
    delete globalThis.game;
  }
  if (hadLocalStorage) {
    globalThis.localStorage = previousLocalStorage;
  } else {
    delete globalThis.localStorage;
  }
  if (hadStorageFoundry) {
    globalThis.foundry = previousStorageFoundry;
  } else {
    delete globalThis.foundry;
  }
}
assert.equal(Object.hasOwn(globalThis, "game"), hadStorageGame);
assert.equal(Object.hasOwn(globalThis, "localStorage"), hadLocalStorage);
assert.equal(Object.hasOwn(globalThis, "foundry"), hadStorageFoundry);

const builderCandidates = [
  { id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 10, reason: "Move.", confidence: "medium" },
  { id: "fireball", slug: "fireball", name: "Fireball", actionCost: 2, score: 30, reason: "Blast.", confidence: "high" },
  { id: "shield", slug: "shield", name: "Shield", actionCost: 1, score: 20, reason: "Defend.", confidence: "medium" },
  { id: "wayfinder", slug: "wayfinder", name: "Wayfinder", actionCost: 0, score: 4, reason: "Free.", confidence: "low" },
  {
    id: "reactive-shield",
    slug: "reactive-shield",
    name: "Reactive Shield",
    actionCost: "reaction",
    score: 8,
    reason: "React.",
    confidence: "medium",
  },
];
const builderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: builderCandidates,
  plans: [{ id: "auto", steps: [builderCandidates[2], builderCandidates[1]], summary: "Shield -> Fireball" }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "fireball", actionCost: 2 }] },
  favorites: new Set(["shield"]),
});
assert.deepEqual(ACTION_BUILDER_TABS.map((tab) => tab.id), ["one", "two", "three", "free", "reaction"]);
assert.equal(actionBuilderKey(builderCandidates[0]), "stride");
assert.equal(builderModel.tabs.one.favorites[0].key, "shield");
assert.equal(builderModel.tabs.two.all[0].key, "fireball");
assert.equal(builderModel.tabs.two.all[0].disabled, false);
assert.equal(builderModel.tabs.two.all[0].disabledReason, "Not enough actions remaining.");
// Over-budget normal actions are flagged so the plan "+" can refuse them while the
// off-budget uncounted "+" stays unlimited.
assert.equal(builderModel.tabs.two.all[0].overBudget, true, "over-budget normal action is flagged overBudget");
assert.equal(builderModel.tabs.free.all[0].overBudget, false, "a free action is never over budget");
assert.equal(builderModel.draft.steps[0].warning, "");
assert.equal(builderModel.tabs.free.all[0].key, "wayfinder");
assert.equal(builderModel.tabs.reaction.all[0].key, "reactive-shield");
assert.equal(builderModel.autoFill.summary, "Shield -> Fireball");

// --- Uncounted actions: builder model resolves the list (Task 3) ---
{
  const ucModel = buildActionBuilderModel({
    context: { profile: { actions: 3 } },
    candidates: [],
    plans: [],
    draft: {
      steps: [{ instanceId: "p1", actionKey: "stride", actionCost: 1 }],
      uncounted: [
        { instanceId: "u1", actionKey: "stride", actionCost: 1 },
        { instanceId: "u2", actionKey: "strike", actionCost: 1 },
      ],
    },
  });
  assert.deepEqual(ucModel.draft.uncounted.map((s) => s.instanceId), ["u1", "u2"],
    "builder model should resolve the uncounted list parallel to steps");
  // resolveDraftSteps adds resolver-only fields (key/warning) the raw input lacks.
  assert.equal(ucModel.draft.uncounted[0].key, "stride",
    "uncounted entries should be data-resolved like plan steps");
  assert.equal(typeof ucModel.draft.uncounted[1].warning, "string",
    "resolved uncounted entries should carry a warning field");
  assert.equal(ucModel.draft.steps.length, 1, "plan steps should be unchanged");
  const baseModel = buildActionBuilderModel({
    context: { profile: { actions: 3 } },
    candidates: [],
    plans: [],
    draft: { steps: [{ instanceId: "p1", actionKey: "stride", actionCost: 1 }] },
  });
  assert.equal(ucModel.remainingTotalActions, baseModel.remainingTotalActions,
    "uncounted steps must not consume the action budget");
}

const atomicBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 40 },
    { id: "longsword", slug: "strike", source: "strike", name: "Longsword", actionCost: 1, score: 30 },
    {
      id: "stride-strike-longsword",
      slug: "stride-strike-longsword",
      source: "system-inferred",
      name: "Stride -> Longsword",
      actionCost: 2,
      score: 50,
      activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1 },
    },
    {
      id: "power-attack",
      slug: "power-attack",
      source: "system-inferred",
      name: "Power Attack",
      actionCost: 2,
      score: 20,
      activityProfile: { includes: ["strike"], includesStrike: true },
    },
    {
      id: "sudden-charge",
      slug: "sudden-charge",
      source: "system-inferred",
      name: "Sudden Charge",
      actionCost: 2,
      score: 15,
      activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 2 },
    },
  ],
  draft: { steps: [] },
});
assert.equal(atomicBuilderModel.tabs.one.all.some((action) => action.name === "Stride"), true);
assert.equal(atomicBuilderModel.tabs.one.all.some((action) => action.name === "Longsword"), true);
assert.equal(atomicBuilderModel.tabs.two.all.some((action) => action.name === "Stride -> Longsword"), false);
assert.equal(atomicBuilderModel.tabs.two.all.some((action) => action.name === "Power Attack"), true);
assert.equal(atomicBuilderModel.tabs.two.all.some((action) => action.name === "Sudden Charge"), true);
assert.deepEqual(
  builderAtomicActionsForStep(atomicBuilderModel.autoFill ?? {
    id: "stride-strike-strike-longsword",
    slug: "stride-strike-longsword",
    name: "Stride -> Longsword",
    actionCost: 2,
    activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1 },
  }).map((action) => [action.name, action.actionCost]),
  [["Stride", 1], ["Longsword", 1]],
);

const splitConsumableBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [{
    id: "item-healing-potion-minor",
    slug: "healing-potion-minor",
    source: "system-inferred",
    name: "Interact -> Healing Potion (Minor)",
    actionCost: 2,
    activationActionCost: 1,
    interactDrawCost: 1,
    score: 30,
    activityProfile: { consumable: true, interactDraw: true, includes: ["healing", "interact"] },
  }],
  draft: { steps: [] },
});
assert.equal(splitConsumableBuilderModel.tabs.one.all.some((action) => action.name === "Interact"), true);
assert.equal(splitConsumableBuilderModel.tabs.one.all.some((action) => action.name === "Healing Potion (Minor)"), true);
assert.equal(splitConsumableBuilderModel.tabs.two.all.some((action) => action.name === "Interact -> Healing Potion (Minor)"), false);

// Sustain a Spell is no longer injected as a builder-tab action — the dedicated sustained-spells
// section handles sustaining. It must not appear in the tabs even for a caster with a
// sustainable spell available.
const spellcasterContext = { actor: { document: { itemTypes: { spellcastingEntry: [{ id: "arcane" }] } } } };
const sustainPresentModel = buildActionBuilderModel({
  context: spellcasterContext,
  candidates: [{ id: "web", name: "Web", slug: "web", source: "spell-inferred", actionCost: 2, score: 30, activityProfile: { spell: true, sustained: true, includes: ["control"] } }],
  draft: { steps: [] },
});
assert.equal(
  sustainPresentModel.tabs.one.all.some((action) => action.name === "Sustain a Spell"),
  false,
  "Sustain a Spell should not be injected into the builder tabs (the sustained-spells section handles it)",
);
// Sustained is the structured duration flag, not any spell that lasts a turn (e.g. Sure Strike).
const sureStrikeClassification = classifySpell({
  name: "Sure Strike",
  system: {
    duration: { value: "until the end of your turn", sustained: false },
    description: { value: "The next time you make an attack roll before the end of your turn, roll twice and use the higher result." },
  },
});
assert.equal(
  Boolean(sureStrikeClassification?.activityProfile?.sustained),
  false,
  "a non-sustained spell with a turn-long duration must not be flagged sustainable",
);
const weaponStrikeSpellClassification = classifySpell({
  name: "Hand of the Apprentice",
  system: {
    traits: { value: ["attack", "focus"] },
    range: { value: "500 feet" },
    target: { value: "1 creature" },
    damage: {},
    description: { value: "Make a ranged Strike using a weapon you are wielding, using your spell attack modifier for the attack roll." },
  },
});
assert.equal(
  weaponStrikeSpellClassification?.role,
  "weapon-strike",
  "a spell that makes a Strike with the actor's own weapon (attack trait, no stored damage, not self-targeted) should classify as weapon-strike, not fall through to combat-utility",
);
const weaponStrikeActor = {
  id: "weapon-strike-actor",
  itemTypes: { spell: [{
    id: "hand-of-the-apprentice",
    slug: "hand-of-the-apprentice",
    name: "Hand of the Apprentice",
    system: {
      traits: { value: ["attack", "focus"] },
      time: { value: "1" },
      range: { value: "500 feet" },
      target: { value: "1 creature" },
      damage: {},
      level: { value: 4 },
      description: { value: "Make a ranged Strike using a weapon you are wielding." },
    },
  }] },
  system: {
    actions: [{
      type: "strike",
      slug: "longsword",
      label: "Longsword",
      ready: true,
      visible: true,
      canAttack: true,
      item: { system: { damageRolls: { base: { damage: "1d8+4", damageType: "slashing" } } } },
    }],
  },
};
const weaponStrikeActions = readSpellActions({ actor: { document: weaponStrikeActor } });
const weaponStrikeAction = weaponStrikeActions.find((action) => action.slug === "hand-of-the-apprentice");
assert.ok(weaponStrikeAction, "Hand of the Apprentice should be read as a spell action");
assert.equal(
  weaponStrikeAction.activityProfile?.averageDamage,
  8.5,
  "a weapon-strike spell should be enriched with the actor's best ready Strike's average damage (1d8+4 = 4.5+4 = 8.5)",
);
const weaponStrikeCandidate = {
  id: "hand-of-the-apprentice",
  name: "Hand of the Apprentice",
  slug: "hand-of-the-apprentice",
  actionCost: 1,
  source: "spell-inferred",
  role: "weapon-strike",
  activityProfile: { averageDamage: 8.5 },
};
const weaponStrikeScoringContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 30 }],
};
const weaponStrikeScored = scoreCandidate(weaponStrikeScoringContext, weaponStrikeCandidate);
const misclassifiedAsUtilityScored = scoreCandidate(weaponStrikeScoringContext, { ...weaponStrikeCandidate, role: "combat-utility" });
assert.ok(
  weaponStrikeScored.score > misclassifiedAsUtilityScored.score,
  `a weapon-strike spell should score higher than the identical spell misclassified as combat-utility, got weapon-strike=${weaponStrikeScored.score} combat-utility=${misclassifiedAsUtilityScored.score}`,
);
const scorchingRaySpellClassification = classifySpell({
  name: "Scorching Ray",
  system: {
    traits: { value: ["attack", "fire"] },
    range: { value: "120 feet" },
    target: { value: "1 or more creatures" },
    damage: {},
    description: { value: "You launch a searing ray of fire. Make a spell attack roll." },
  },
});
assert.equal(
  scorchingRaySpellClassification?.role,
  "weapon-strike",
  "a real damage/attack spell whose damage this reader can't parse (Scorching Ray, found live with an empty system.damage) must not fall into role: buff",
);
const rayOfEnfeeblementClassification = classifySpell({
  name: "Ray of Enfeeblement",
  system: {
    traits: { value: ["attack"] },
    range: { value: "30 feet" },
    target: { value: "1 creature" },
    damage: {},
    description: { value: "You divert the target's vital forces to disrupt its physical prowess. Make a spell attack roll against the target. Enfeebled 2" },
  },
});
assert.equal(
  rayOfEnfeeblementClassification?.role,
  "control",
  "an attack-roll spell that only applies a condition (Ray of Enfeeblement never deals damage by design) must keep classifying as control, not get swept into the new weapon-strike branch",
);
assert.deepEqual(
  builderAtomicActionsForStep({
    id: "item-healing-potion-minor",
    slug: "healing-potion-minor",
    name: "Interact -> Healing Potion (Minor)",
    actionCost: 2,
    activationActionCost: 1,
    interactDrawCost: 1,
  }).map((action) => [action.name, action.actionCost]),
  [["Interact", 1], ["Healing Potion (Minor)", 1]],
);

// Positional tactic expansion: flank -> [Stride(to flank square), melee Strike].
const flankExpansion = builderAtomicActionsForStep({
  slug: "flank-strike-claw",
  name: "Flank -> Claw",
  preferredTarget: { id: "goblin", name: "Goblin" },
  activityProfile: {
    positionalTactic: "flank",
    attackCenter: { x: -5, y: 0 },
    includes: ["stride", "strike"],
    includesStrike: true,
    meleeStrike: { slug: "strike", source: "strike", name: "Claw", executable: "strike", item: { id: "claw" } },
  },
});
assert.deepEqual(flankExpansion.map((action) => action.slug), ["stride", "strike"]);
assert.deepEqual(flankExpansion[0].destination, { x: -5, y: 0 });
assert.equal(flankExpansion[0].requiresDestination, true);
assert.equal(flankExpansion[1].name, "Claw");
assert.equal(flankExpansion[1].preferredTarget.id, "goblin");

// A composite needing 2 Strides to reach its target (e.g. Giant Centipede closing 55 ft on a
// 30 ft speed) must expand to two separate Stride atoms, not collapse to one via Set dedup.
const doubleStrideExpansion = builderAtomicActionsForStep({
  slug: "stride-strike-mandibles",
  name: "Stride -> Stride -> Mandibles",
  preferredTarget: { id: "isqulug", name: "Isqulug" },
  activityProfile: {
    includes: ["stride", "stride", "strike"],
    includesStrike: true,
    strideCount: 2,
    attackCenter: { x: 10, y: 0 },
  },
});
assert.deepEqual(
  doubleStrideExpansion.map((action) => action.slug),
  ["stride", "stride", "strike"],
  "a strideCount: 2 composite must expand to two Stride atoms, not one",
);

const suddenChargeAtomFixture = {
  id: "sudden-charge",
  name: "Sudden Charge",
  slug: "sudden-charge",
  actionCost: 2,
  activityProfile: {
    includes: ["stride", "stride", "strike"],
    strideCount: 2,
    includesStrike: true,
    requiresBackingStrike: true,
    backingStrike: { name: "Longsword", executable: "strike", source: "strike", item: { name: "Longsword" }, strike: {}, variants: [], attack: null, damage: null, damageProfile: null, averageDamage: 8, critical: null, traits: ["versatile-p"], weaponTraits: [], range: null, reload: null },
  },
};
const suddenChargeAtoms = builderAtomicActionsForStep(suddenChargeAtomFixture);
assert.deepEqual(suddenChargeAtoms.map((atom) => atom.slug), ["stride", "stride", "strike"], "Sudden Charge must atomize into two Strides and one Strike, not stay as one un-atomized action");
assert.deepEqual(suddenChargeAtoms.map((atom) => atom.actionCost), [2, 0, 0], "the composite's own 2-action cost must land entirely on the first atom, with every atom after it free");
assert.equal(suddenChargeAtoms[2].name, "Sudden Charge -> Longsword", "the Strike atom must borrow the real weapon's name, exactly like a Double Attack atom does");
assert.equal(suddenChargeAtoms[0].groupId, suddenChargeAtoms[2].groupId, "every atom (Strides included) must share one group id so the panel can nest them under one header");
assert.equal(suddenChargeAtoms[0].groupLabel, "Sudden Charge");
assert.deepEqual(suddenChargeAtoms.map((atom) => atom.atomIndex), [0, 1, 2], "each atom must record its own position for later re-matching a persisted step back to the exact atom it came from");

// A requiresBackingStrike action that fails to atomize into 2+ atoms (e.g. malformed includes) must
// be returned unchanged, exactly like requiresDistinctTargets already falls back safely.
const malformedBackingStrikeFixture = { id: "malformed", name: "Malformed", slug: "malformed", actionCost: 1, activityProfile: { includes: [], requiresBackingStrike: true } };
assert.deepEqual(builderAtomicActionsForStep(malformedBackingStrikeFixture), [malformedBackingStrikeFixture], "a requiresBackingStrike action with nothing to atomize should pass through unchanged");

// Skirmish with a 1-action ranged Strike finisher -> [melee Strike, Stride away, ranged Strike].
const skirmishStrikeExpansion = builderAtomicActionsForStep({
  slug: "skirmish-strike-dart",
  name: "Claw -> Stride Away -> Dart",
  preferredTarget: { id: "bruiser", name: "Bruiser" },
  activityProfile: {
    positionalTactic: "skirmish",
    attackCenter: { x: -25, y: 0 },
    includesStrike: true,
    meleeStrike: { slug: "strike", source: "strike", name: "Claw", executable: "strike", item: { id: "claw" } },
    finisher: {
      kind: "strike",
      actionCost: 1,
      ref: { slug: "strike", source: "strike", name: "Dart", executable: "strike", item: { id: "dart" } },
    },
  },
});
assert.deepEqual(skirmishStrikeExpansion.map((action) => action.slug), ["strike", "stride", "strike"]);
assert.equal(skirmishStrikeExpansion[0].name, "Claw");
assert.deepEqual(skirmishStrikeExpansion[1].destination, { x: -25, y: 0 });
assert.equal(skirmishStrikeExpansion[2].name, "Dart");
assert.equal(skirmishStrikeExpansion[2].preferredTarget.id, "bruiser");

// Skirmish with a 2-action spell finisher -> [Stride away, Cast] (no melee prepend).
const skirmishSpellExpansion = builderAtomicActionsForStep({
  slug: "skirmish-spell-fireball",
  name: "Stride Away -> Fireball",
  preferredTarget: { id: "bruiser", name: "Bruiser" },
  activityProfile: {
    positionalTactic: "skirmish",
    attackCenter: { x: -25, y: 0 },
    includesStrike: true,
    meleeStrike: null,
    finisher: {
      kind: "spell",
      actionCost: 2,
      ref: { slug: "fireball", name: "Fireball", executable: "open-item", item: { id: "fireball" } },
    },
  },
});
assert.deepEqual(skirmishSpellExpansion.map((action) => action.slug), ["stride", "fireball"]);
assert.equal(skirmishSpellExpansion[1].name, "Fireball");
assert.equal(skirmishSpellExpansion[1].preferredTarget.id, "bruiser");

// Auto-fill must drop a Strike that can't reach its target with no earlier move to fix it, but keep
// a Strike that follows a move, an in-range Strike, and non-strike steps.
const outOfRangeMelee = { source: "strike", available: false, unavailableReason: "No target in range." };
assert.equal(isUnreachableStrikeStep(outOfRangeMelee, false), true, "an out-of-range Strike with no earlier move is unreachable");
assert.equal(isUnreachableStrikeStep(outOfRangeMelee, true), false, "a Strike that follows a move may be brought into range");
assert.equal(
  isUnreachableStrikeStep({ source: "strike", available: true }, false),
  false,
  "an in-range Strike is kept",
);
assert.equal(
  isUnreachableStrikeStep({ source: "strike", available: false, unavailableReason: "Already grabbing the target." }, false),
  false,
  "a Strike disabled for a non-range reason is not pruned as unreachable",
);
assert.equal(
  isUnreachableStrikeStep({ source: "generic", slug: "stride", available: false, unavailableReason: "No target in range." }, false),
  false,
  "a non-Strike step is never pruned by the unreachable-Strike guard",
);
assert.equal(
  isUnreachableStrikeStep({ attackTrait: true, available: false, disabledReason: "No target in range." }, false),
  true,
  "an attack-trait action out of range with no earlier move is unreachable",
);

const previousProjectedDraftCanvas = globalThis.canvas;
try {
  globalThis.canvas = { grid: { size: 5 }, scene: { grid: { distance: 5 } } };
  const projectedDraftTarget = {
    id: "target-ezren",
    name: "Ezren",
    distance: 10,
    token: { center: { x: 10, y: 0 } },
  };
  const projectedDraftContext = {
    actor: {
      document: {
        itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [], weapon: [] },
        items: [],
        system: {
          actions: [{
            slug: "shortsword",
            label: "Shortsword",
            name: "Shortsword",
            type: "strike",
            visible: true,
            ready: true,
            canAttack: true,
            item: { system: { traits: { value: [] } } },
          }],
        },
      },
    },
    token: { center: { x: 0, y: 0 } },
    profile: {
      reach: 5,
      meleeReach: 5,
      speed: 25,
      conditions: { slugs: [], values: {} },
      skills: {},
    },
    battlefield: {
      targets: [projectedDraftTarget],
      enemies: [projectedDraftTarget],
      allies: [],
    },
  };
  assert.equal(
    buildCandidates(projectedDraftContext).candidates.some((action) => action.name === "Shortsword"),
    false,
  );
  const projectedAfterStride = projectContextForDraftDestination(projectedDraftContext, {
    steps: [{ instanceId: "draft-1", actionKey: "stride", requiresDestination: true, destination: { x: 5, y: 0 } }],
  });
  assert.notEqual(projectedAfterStride, projectedDraftContext);
  assert.equal(projectedAfterStride.token.center.x, 5);
  assert.equal(projectedAfterStride.battlefield.targets[0].distance, 5);
  assert.equal(
    buildCandidates(projectedAfterStride).candidates.some((action) => action.name === "Shortsword"),
    true,
  );
  const chainedDraft = {
    steps: [
      { instanceId: "draft-1", actionKey: "stride", requiresDestination: true, destination: { x: 5, y: 0 } },
      { instanceId: "draft-2", actionKey: "stride", requiresDestination: true, destination: { x: 15, y: 0 } },
    ],
  };
  const secondStrideOrigin = projectContextForDraftStepOrigin(projectedDraftContext, chainedDraft, "draft-2");
  assert.equal(secondStrideOrigin.token.center.x, 5);
  assert.equal(secondStrideOrigin.token.plannedCenter.x, 5);
  assert.equal(secondStrideOrigin.battlefield.targets[0].distance, 5);
  const afterAllStrides = projectContextForDraftDestination(projectedDraftContext, chainedDraft);
  assert.equal(afterAllStrides.token.center.x, 15);
  assert.equal(afterAllStrides.token.plannedCenter.x, 15);
  assert.equal(afterAllStrides.battlefield.targets[0].distance, 5);
  // With no plan steps, the first uncounted stride starts from the token's real origin
  // and later uncounted strides chain off the prior one.
  const uncountedChainedDraft = {
    steps: [],
    uncounted: [
      { instanceId: "uc-1", actionKey: "stride", requiresDestination: true, destination: { x: 5, y: 0 } },
      { instanceId: "uc-2", actionKey: "stride", requiresDestination: true, destination: { x: 15, y: 0 } },
    ],
  };
  const firstUncountedOrigin = projectContextForDraftStepOrigin(projectedDraftContext, uncountedChainedDraft, "uc-1");
  assert.equal(firstUncountedOrigin.token.center.x, 0, "first uncounted stride starts from the token's real origin when the plan has no movement");
  const secondUncountedOrigin = projectContextForDraftStepOrigin(projectedDraftContext, uncountedChainedDraft, "uc-2");
  assert.equal(secondUncountedOrigin.token.center.x, 5, "second uncounted stride chains off the first uncounted stride");
  assert.equal(secondUncountedOrigin.token.plannedCenter.x, 5);
  // The uncounted sequence continues from the plan's last stride: the first uncounted
  // stride starts where the plan's movement ended, then chains within the uncounted list.
  const planThenUncountedDraft = {
    steps: [{ instanceId: "draft-1", actionKey: "stride", requiresDestination: true, destination: { x: 20, y: 0 } }],
    uncounted: [
      { instanceId: "uc-1", actionKey: "stride", requiresDestination: true, destination: { x: 30, y: 0 } },
      { instanceId: "uc-2", actionKey: "stride", requiresDestination: true, destination: { x: 40, y: 0 } },
    ],
  };
  const firstUcAfterPlan = projectContextForDraftStepOrigin(projectedDraftContext, planThenUncountedDraft, "uc-1");
  assert.equal(firstUcAfterPlan.token.center.x, 20, "first uncounted stride starts from the plan's last stride destination");
  const secondUcAfterPlan = projectContextForDraftStepOrigin(projectedDraftContext, planThenUncountedDraft, "uc-2");
  assert.equal(secondUcAfterPlan.token.center.x, 30, "second uncounted stride still chains off the first uncounted stride");

  assert.equal(
    buildCandidates(projectedDraftContext).candidates.some((action) => action.slug === "take-cover"),
    false,
    "Take Cover should not be directly available without cover or prone",
  );
  const takeCoverAfterDropProne = projectContextForDraftStepOrigin(projectedDraftContext, {
    steps: [
      { instanceId: "drop", actionKey: "drop-prone", actionCost: 1 },
      { instanceId: "cover", actionKey: "take-cover", actionCost: 1 },
    ],
  }, "cover");
  assert.equal(
    buildCandidates(takeCoverAfterDropProne).candidates.some((action) => action.slug === "take-cover"),
    true,
    "projected draft state should make Take Cover available after Drop Prone",
  );
} finally {
  if (previousProjectedDraftCanvas === undefined) {
    delete globalThis.canvas;
  } else {
    globalThis.canvas = previousProjectedDraftCanvas;
  }
}

// Regression: a melee Strike must read as in range after a Stride lands the actor diagonally
// adjacent (center-to-center 7.07 ft) or beside a large target — the projected distance is now
// footprint/grid-aware, matching the unprojected combat-context distance.
const previousDiagonalReachCanvas = globalThis.canvas;
try {
  globalThis.canvas = { grid: { size: 5 }, scene: { grid: { distance: 5 } } };
  const meleeOnlyActor = (target) => ({
    actor: {
      document: {
        itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [], weapon: [] },
        items: [],
        system: {
          actions: [{
            slug: "shortsword", label: "Shortsword", name: "Shortsword", type: "strike",
            visible: true, ready: true, canAttack: true,
            item: { system: { traits: { value: [] } } },
          }],
        },
      },
    },
    token: { center: { x: 0, y: 0 }, width: 1, height: 1 },
    profile: { reach: 5, meleeReach: 5, speed: 25, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: { targets: [target], enemies: [target], allies: [] },
  });

  // Diagonally adjacent: center-to-center is 7.07 ft (would fail a reach-5 check), grid reach is 5 ft.
  const diagonalTarget = { id: "brute", name: "Brute", distance: 10, token: { center: { x: 10, y: 10 } } };
  const diagonalProjected = projectContextForDraftDestination(meleeOnlyActor(diagonalTarget), {
    steps: [{ instanceId: "d1", actionKey: "stride", requiresDestination: true, destination: { x: 5, y: 5 } }],
  });
  assert.equal(diagonalProjected.battlefield.targets[0].distance, 5, "diagonal adjacency should read as 5 ft, not 7.07");
  assert.equal(
    buildCandidates(diagonalProjected).candidates.some((action) => action.name === "Shortsword"),
    true,
    "melee Strike should be reachable after a diagonal Stride",
  );

  // Large (2x2) target: striding beside its near edge is 5 ft even though the center is far.
  const largeTarget = { id: "ogre", name: "Ogre", distance: 30, token: { center: { x: 20, y: 20 }, width: 2, height: 2 } };
  const largeProjected = projectContextForDraftDestination(meleeOnlyActor(largeTarget), {
    steps: [{ instanceId: "d1", actionKey: "stride", requiresDestination: true, destination: { x: 12.5, y: 20 } }],
  });
  assert.equal(largeProjected.battlefield.targets[0].distance, 5, "adjacency to a large target's footprint should read as 5 ft");
  assert.equal(
    buildCandidates(largeProjected).candidates.some((action) => action.name === "Shortsword"),
    true,
    "melee Strike should be reachable beside a large target",
  );
} finally {
  if (previousDiagonalReachCanvas === undefined) {
    delete globalThis.canvas;
  } else {
    globalThis.canvas = previousDiagonalReachCanvas;
  }
}

const projectedDraftFallbackBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [{ id: "shortsword", slug: "strike", name: "Shortsword", actionCost: 1, score: 20 }],
  draftFallbackActions: [{ id: "crossbow", slug: "strike", name: "Crossbow", actionCost: 1, score: 10 }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "crossbow", actionCost: 1 }] },
});
assert.equal(projectedDraftFallbackBuilderModel.draft.steps[0].stale, false);
assert.equal(projectedDraftFallbackBuilderModel.draft.steps[0].action.name, "Crossbow");
assert.equal(projectedDraftFallbackBuilderModel.tabs.one.all.some((action) => action.name === "Crossbow"), false);

const projectedMeleeDraftActions = {
  "grapple-after-stride": { id: "grapple", slug: "grapple", name: "Grapple", actionCost: 1, available: true },
  "grapple-before-stride": {
    id: "grapple",
    slug: "grapple",
    name: "Grapple",
    actionCost: 1,
    available: false,
    unavailableReason: "No enemy in reach.",
  },
};
const projectedMeleeActions = [
  { id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 20 },
  { id: "grapple", slug: "grapple", name: "Grapple", actionCost: 1, score: 30 },
];
const grappleAfterStrideBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: projectedMeleeActions,
  draftStepActions: projectedMeleeDraftActions,
  draft: {
    steps: [
      { instanceId: "stride-step", actionKey: "stride", actionCost: 1, destination: { x: 5, y: 0 } },
      { instanceId: "grapple-after-stride", actionKey: "grapple", actionCost: 1 },
    ],
  },
});
assert.equal(grappleAfterStrideBuilderModel.draft.steps[1].warning, "");
const grappleBeforeStrideBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: projectedMeleeActions,
  draftStepActions: projectedMeleeDraftActions,
  draft: {
    steps: [
      { instanceId: "grapple-before-stride", actionKey: "grapple", actionCost: 1 },
      { instanceId: "stride-step", actionKey: "stride", actionCost: 1, destination: { x: 5, y: 0 } },
    ],
  },
});
assert.equal(
  grappleBeforeStrideBuilderModel.draft.steps[0].warning,
  "No enemy in reach.",
  "draft melee warnings should use the projected origin before that step, not the final planned position",
);

const missingDraftCostBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [
    { id: "fireball", slug: "fireball", name: "Fireball", actionCost: 2, score: 30 },
    { id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 20 },
    { id: "power-attack", slug: "power-attack", name: "Power Attack", actionCost: 2, score: 10 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "fireball" }] },
});
assert.equal(missingDraftCostBuilderModel.usage.normal, 2);
assert.equal(missingDraftCostBuilderModel.remainingActions, 1);
assert.equal(missingDraftCostBuilderModel.remainingNormalActions, 1);
assert.equal(missingDraftCostBuilderModel.remainingTotalActions, 1);
assert.equal(missingDraftCostBuilderModel.tabs.one.all.find((action) => action.key === "stride").disabled, false);
assert.equal(missingDraftCostBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabled, false);
assert.equal(missingDraftCostBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabledReason, "Not enough actions remaining.");

const plannedDraftCostBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [
    { id: "reload-crossbow", slug: "reload-crossbow", name: "Reload -> Crossbow", actionCost: 1, score: 30 },
    { id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 20 },
    { id: "power-attack", slug: "power-attack", name: "Power Attack", actionCost: 2, score: 10 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "reload-crossbow", actionCost: 2 }] },
});
assert.equal(plannedDraftCostBuilderModel.usage.normal, 2);
assert.equal(plannedDraftCostBuilderModel.remainingActions, 1);
assert.equal(plannedDraftCostBuilderModel.remainingNormalActions, 1);
assert.equal(plannedDraftCostBuilderModel.draft.steps[0].actionCost, 2);
assert.equal(plannedDraftCostBuilderModel.draft.steps[0].action.actionCost, 1);
assert.equal(plannedDraftCostBuilderModel.tabs.one.all.find((action) => action.key === "stride").disabled, false);
assert.equal(plannedDraftCostBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabled, false);
assert.equal(plannedDraftCostBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabledReason, "Not enough actions remaining.");

const warningBuilderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: [
    {
      id: "stride",
      slug: "stride",
      name: "Stride",
      actionCost: 1,
      score: 10,
      requiresDestination: true,
      confidence: "medium",
    },
  ],
  draft: {
    steps: [
      { instanceId: "draft-1", actionKey: "stride", actionCost: 1 },
      { instanceId: "draft-2", actionKey: "missing", actionCost: 1 },
    ],
  },
});
assert.equal(warningBuilderModel.draft.steps[0].stale, false);
assert.equal(warningBuilderModel.draft.steps[0].warning, "Choose destination at execution.");
assert.equal(warningBuilderModel.draft.steps[1].stale, true);
assert.equal(warningBuilderModel.draft.steps[1].warning, "Action is no longer available.");

const unavailableDraftBuilderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: [
    {
      id: "stride",
      slug: "stride",
      name: "Stride",
      actionCost: 1,
      score: 10,
      available: false,
      unavailableReason: "Actor is prone; move actions are unavailable.",
      requiresDestination: true,
    },
    {
      id: "reactive-shield",
      slug: "reactive-shield",
      name: "Reactive Shield",
      actionCost: "reaction",
      score: 8,
      disabled: true,
      disabledReason: "Reaction already planned.",
    },
  ],
  draft: {
    steps: [
      { instanceId: "draft-1", actionKey: "stride", actionCost: 1 },
      { instanceId: "draft-2", actionKey: "reactive-shield", actionCost: "reaction" },
    ],
  },
});
assert.equal(unavailableDraftBuilderModel.draft.steps.length, 2);
assert.equal(unavailableDraftBuilderModel.draft.steps[0].stale, false);
assert.equal(unavailableDraftBuilderModel.draft.steps[0].warning, "Actor is prone; move actions are unavailable.");
assert.equal(unavailableDraftBuilderModel.draft.steps[1].stale, false);
assert.equal(unavailableDraftBuilderModel.draft.steps[1].warning, "Reaction already planned.");

const panelRejectedDraftBuilderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: [
    { id: "shield", slug: "shield", name: "Shield", actionCost: 1, score: 20, reason: "Defend." },
  ],
  rejected: [{
    action: {
      id: "stride",
      slug: "stride",
      name: "Stride",
      actionCost: 1,
      available: false,
      activityProfile: { includes: ["stride"], strideCount: 1 },
    },
    reason: "No collision-free movement path.",
  }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "stride", actionCost: 1 }] },
});
const rejectedStrideRow = panelRejectedDraftBuilderModel.tabs.one.all.find((action) => action.key === "stride");
assert.ok(rejectedStrideRow, "rejected movement actions should stay visible in action builder");
assert.equal(rejectedStrideRow.disabled, false);
assert.equal(rejectedStrideRow.disabledReason, "No collision-free movement path.");
assert.equal(panelRejectedDraftBuilderModel.draft.steps[0].stale, false);
assert.equal(panelRejectedDraftBuilderModel.draft.steps[0].action.name, "Stride");
assert.equal(panelRejectedDraftBuilderModel.draft.steps[0].warning, "No collision-free movement path.");

const inapplicableMovementBuilderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: [],
  rejected: [{
    action: {
      id: "stand",
      slug: "stand",
      name: "Stand",
      actionCost: 1,
      available: false,
      role: "mobility",
      activityProfile: { includes: ["move"], removesCondition: "prone" },
      unavailableReason: "Actor is not prone.",
    },
    reason: "Actor is not prone.",
  }],
  draft: { steps: [] },
});
assert.equal(inapplicableMovementBuilderModel.tabs.one.all.some((action) => action.key === "stand"), true);
assert.equal(inapplicableMovementBuilderModel.tabs.one.all.find((action) => action.key === "stand").disabledReason, "Actor is not prone.");

const standLikeMoveAction = {
  id: "stand",
  slug: "stand",
  name: "Stand",
  actionCost: 1,
  activityProfile: { includes: ["move"], removesCondition: "prone" },
};
assert.equal(requiresDestinationForAction(standLikeMoveAction), false);
const standDraftBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [{ ...standLikeMoveAction, requiresDestination: requiresDestinationForAction(standLikeMoveAction) }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "stand", actionCost: 1 }] },
});
assert.equal(standDraftBuilderModel.draft.steps[0].warning, "");

const quickenedBuilderModel = buildActionBuilderModel({
  context: {
    profile: { conditions: { slugs: ["quickened"], values: { quickened: null } } },
  },
  candidates: [
    { id: "full-turn", slug: "full-turn", name: "Full Turn", actionCost: 3, score: 1 },
    { id: "strike", slug: "strike", source: "strike", name: "Strike", actionCost: 1, score: 30 },
    { id: "aid", slug: "aid", source: "generic", name: "Aid", actionCost: 1, score: 20 },
    { id: "heal", slug: "heal", source: "spell-inferred", name: "Heal", actionCost: 2, score: 10 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "full-turn", actionCost: 3 }] },
});
assert.equal(quickenedBuilderModel.tabs.one.all.find((action) => action.key === "strike").disabled, false);
assert.equal(quickenedBuilderModel.tabs.one.all.find((action) => action.key === "aid").disabled, false);
assert.equal(quickenedBuilderModel.tabs.one.all.find((action) => action.key === "aid").disabledReason, "Not enough actions remaining.");
assert.equal(quickenedBuilderModel.tabs.two.all.find((action) => action.key === "heal").disabled, false);
assert.equal(quickenedBuilderModel.tabs.two.all.find((action) => action.key === "heal").disabledReason, "Not enough actions remaining.");
assert.equal(quickenedBuilderModel.remainingActions, 0);
assert.equal(quickenedBuilderModel.remainingNormalActions, 0);
assert.equal(quickenedBuilderModel.remainingQuickenedActions, 1);
assert.equal(quickenedBuilderModel.remainingTotalActions, 1);

const quickenedShelfBuilderModel = buildActionBuilderModel({
  context: {
    profile: { conditions: { slugs: ["quickened"], values: { quickened: null } } },
  },
  candidates: [
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 40 },
    { id: "step", slug: "step", source: "generic", name: "Step", actionCost: 1, score: 30 },
    { id: "shortsword", slug: "shortsword", source: "strike", name: "Shortsword", actionCost: 1, score: 20 },
    { id: "aid", slug: "aid", source: "generic", name: "Aid", actionCost: 1, score: 10 },
    { id: "heal", slug: "heal", source: "spell-inferred", name: "Heal", actionCost: 2, score: 5 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "heal", actionCost: 2 }] },
});
assert.deepEqual(quickenedShelfBuilderModel.tabs.one.quickened.map((action) => action.key), ["stride", "shortsword"]);
assert.equal(quickenedShelfBuilderModel.tabs.two.quickened.length, 0);
assert.equal(quickenedShelfBuilderModel.tabs.one.quickened.some((action) => action.key === "aid"), false);

const quickenedRejectedStrikeBuilderModel = buildActionBuilderModel({
  context: {
    profile: { conditions: { slugs: ["quickened"], values: { quickened: null } } },
  },
  candidates: [
    { id: "strike-crossbow", slug: "strike", source: "strike", name: "Crossbow", actionCost: 1, score: 40 },
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 30 },
    { id: "step", slug: "step", source: "generic", name: "Step", actionCost: 1, score: 20 },
  ],
  rejected: [{
    action: {
      id: "strike-shortsword",
      slug: "strike",
      source: "strike",
      name: "Shortsword",
      actionCost: 1,
      score: -999,
      available: false,
      unavailableReason: "Target is not in reach.",
    },
    reason: "Target is not in reach.",
  }],
  draft: { steps: [] },
});
assert.deepEqual(
  quickenedRejectedStrikeBuilderModel.tabs.one.quickened.map((action) => action.key),
  ["strike-crossbow", "stride", "strike-shortsword"],
);
assert.equal(quickenedRejectedStrikeBuilderModel.tabs.one.quickened.at(-1).disabled, false);
assert.equal(quickenedRejectedStrikeBuilderModel.tabs.one.quickened.at(-1).disabledReason, "Target is not in reach.");

const mixedQuickenedDraftBuilderModel = buildActionBuilderModel({
  context: {
    profile: {
      conditions: { slugs: ["quickened"], values: { quickened: null } },
      effects: [{ slug: "quickened", name: "Quickened" }],
    },
  },
  candidates: [
    { id: "strike", slug: "strike", source: "strike", name: "Strike", actionCost: 1, score: 30 },
    { id: "aid", slug: "aid", source: "generic", name: "Aid", actionCost: 1, score: 20 },
    { id: "heal", slug: "heal", source: "spell-inferred", name: "Heal", actionCost: 2, score: 10 },
    { id: "power-attack", slug: "power-attack", source: "generic", name: "Power Attack", actionCost: 2, score: 5 },
  ],
  draft: {
    steps: [
      { instanceId: "draft-1", actionKey: "strike", actionCost: 1 },
      { instanceId: "draft-2", actionKey: "heal", actionCost: 2 },
    ],
  },
});
assert.equal(mixedQuickenedDraftBuilderModel.actionBudget.quickenedActions, 1);
assert.equal(mixedQuickenedDraftBuilderModel.remainingNormalActions, 1);
assert.equal(mixedQuickenedDraftBuilderModel.remainingQuickenedActions, 0);
assert.equal(mixedQuickenedDraftBuilderModel.remainingTotalActions, 1);
assert.equal(mixedQuickenedDraftBuilderModel.tabs.one.all.find((action) => action.key === "aid").disabled, false);
assert.equal(mixedQuickenedDraftBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabled, false);
assert.equal(mixedQuickenedDraftBuilderModel.tabs.two.all.find((action) => action.key === "power-attack").disabledReason, "Not enough actions remaining.");
assert.equal(mixedQuickenedDraftBuilderModel.tabs.one.quickened.length, 0);

// Planning a self-cast Haste (slug "haste") anticipates the quickened action before the condition
// is applied: the current combatant gains an extra Stride/Strike this turn.
const anticipatedHasteBuilderModel = buildActionBuilderModel({
  context: {
    token: { id: "self-token" },
    profile: { conditions: { slugs: [], values: {} } },
  },
  candidates: [
    { id: "haste", slug: "haste", source: "spell-inferred", name: "Haste", actionCost: 2, score: 50, activityProfile: { extraAction: true }, targetingProfile: { ally: true, self: true } },
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 40 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "haste", actionCost: 2, targetTokenIds: ["self-token"] }] },
});
assert.equal(anticipatedHasteBuilderModel.actionBudget.quickenedActions ?? 0, 0);
assert.equal(anticipatedHasteBuilderModel.remainingNormalActions, 1);
assert.equal(anticipatedHasteBuilderModel.remainingQuickenedActions, 1);
assert.equal(anticipatedHasteBuilderModel.remainingTotalActions, 2);
assert.ok(anticipatedHasteBuilderModel.tabs.one.quickened.some((action) => action.key === "stride"));

// Casting Haste on an ally does NOT quicken the current combatant — no extra action anticipated.
const allyHasteBuilderModel = buildActionBuilderModel({
  context: {
    token: { id: "self-token" },
    profile: { conditions: { slugs: [], values: {} } },
  },
  candidates: [
    { id: "haste", slug: "haste", source: "spell-inferred", name: "Haste", actionCost: 2, score: 50, activityProfile: { extraAction: true }, targetingProfile: { ally: true, self: true } },
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 40 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "haste", actionCost: 2, targetTokenIds: ["ally-token"] }] },
});
assert.equal(allyHasteBuilderModel.remainingQuickenedActions, 0);
assert.equal(allyHasteBuilderModel.remainingTotalActions, 1);
assert.equal(allyHasteBuilderModel.tabs.one.quickened.length, 0);

// A non-Haste self-only spell flagged with extraAction (and no explicit target) also anticipates it.
const extraActionSelfBuilderModel = buildActionBuilderModel({
  context: {
    token: { id: "self-token" },
    profile: { conditions: { slugs: [], values: {} } },
  },
  candidates: [
    { id: "energize", slug: "energize", source: "spell-inferred", name: "Energize", actionCost: 2, score: 50, activityProfile: { extraAction: true }, targetingProfile: { self: true } },
    { id: "stride", slug: "stride", source: "generic", name: "Stride", actionCost: 1, score: 40 },
  ],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "energize", actionCost: 2 }] },
});
assert.equal(extraActionSelfBuilderModel.remainingQuickenedActions, 1);
assert.equal(extraActionSelfBuilderModel.remainingTotalActions, 2);
assert.equal(
  classifySpell({ name: "Haste", system: { description: { value: "Magic speeds a willing creature." } } })?.activityProfile?.extraAction,
  true,
  "Haste should be classified as an extra-action/quickened buff",
);
const hasteBuffScore = scoreCandidate({
  ...fighterContext,
  allies: [{ id: "calder", name: "Calder", hpPercent: 1, classSlug: "fighter" }],
  battlefield: {
    ...(fighterContext.battlefield ?? {}),
    allies: [{ id: "calder", name: "Calder", hpPercent: 1, classSlug: "fighter" }],
  },
}, {
  id: "haste",
  slug: "haste",
  source: "spell-inferred",
  name: "Haste",
  actionCost: 2,
  role: "buff",
  activityProfile: { includes: ["buff"] },
  targetingProfile: { ally: true, self: true },
});
assert.ok(hasteBuffScore.reasons.some((reason) => reason === "Haste grants quickened."));
assert.equal(
  hasteBuffScore.reasons.some((reason) => reason.includes("boost Calder")),
  false,
  "Haste reason should say it grants quickened without naming who it boosts",
);

const staleBudgetBuilderModel = buildActionBuilderModel({
  context: { actionsSpent: { normal: 2, total: 2 } },
  candidates: [{ id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 10 }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "missing-three", actionCost: 3 }] },
});
assert.equal(staleBudgetBuilderModel.usage.normal, 0);
assert.equal(staleBudgetBuilderModel.draft.steps[0].stale, true);
assert.equal(staleBudgetBuilderModel.tabs.one.all[0].disabled, false);

const staleReactionBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [{ id: "reactive-shield", slug: "reactive-shield", name: "Reactive Shield", actionCost: "reaction", score: 10 }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "missing-reaction", actionCost: "reaction" }] },
});
assert.equal(staleReactionBuilderModel.usage.reaction, 0);
assert.equal(staleReactionBuilderModel.draft.steps[0].stale, true);
assert.equal(staleReactionBuilderModel.tabs.reaction.all[0].disabled, false);

const collisionBuilderModel = buildActionBuilderModel({
  context: {},
  candidates: [
    { id: "duplicate-action", slug: "first", name: "First Duplicate", actionCost: 1, score: 20 },
    { id: "duplicate-action", slug: "second", name: "Second Duplicate", actionCost: 1, score: 10 },
  ],
  draft: {
    steps: [
      { instanceId: "draft-1", actionKey: "duplicate-action", actionCost: 1 },
      { instanceId: "draft-2", actionKey: "duplicate-action#2", actionCost: 1 },
    ],
  },
  favorites: new Set(["duplicate-action#2"]),
});
assert.deepEqual(collisionBuilderModel.tabs.one.all.map((action) => action.key), ["duplicate-action", "duplicate-action#2"]);
assert.deepEqual(collisionBuilderModel.tabs.one.all.map((action) => action.baseKey), ["duplicate-action", "duplicate-action"]);
assert.deepEqual(collisionBuilderModel.tabs.one.favorites.map((action) => action.key), ["duplicate-action#2"]);
assert.deepEqual(collisionBuilderModel.draft.steps.map((step) => step.action.name), ["First Duplicate", "Second Duplicate"]);

const stableDuplicateCandidates = [
  { id: "dup", item: { uuid: "Item.alpha" }, slug: "dup", name: "Alpha Duplicate", actionCost: 1, score: 10 },
  { id: "dup", item: { uuid: "Item.beta" }, slug: "dup", name: "Beta Duplicate", actionCost: 1, score: 50 },
];
const stableDuplicateHighBeta = buildActionBuilderModel({
  context: {},
  candidates: stableDuplicateCandidates,
  draft: { steps: [{ instanceId: "draft-1", actionKey: "dup#2", actionCost: 1 }] },
});
const stableDuplicateHighAlpha = buildActionBuilderModel({
  context: {},
  candidates: stableDuplicateCandidates.map((action) => ({
    ...action,
    score: action.name.startsWith("Alpha") ? 50 : 10,
  })),
  draft: { steps: [{ instanceId: "draft-1", actionKey: "dup#2", actionCost: 1 }] },
});
assert.deepEqual(
  stableDuplicateHighBeta.tabs.one.all.map((action) => `${action.key}:${action.name}`),
  ["dup#2:Beta Duplicate", "dup:Alpha Duplicate"],
);
assert.deepEqual(
  stableDuplicateHighAlpha.tabs.one.all.map((action) => `${action.key}:${action.name}`),
  ["dup:Alpha Duplicate", "dup#2:Beta Duplicate"],
);
assert.equal(stableDuplicateHighBeta.draft.steps[0].action.name, "Beta Duplicate");
assert.equal(stableDuplicateHighAlpha.draft.steps[0].action.name, "Beta Duplicate");

const excellentSingleAction = bestTurnPlan(fighterContext, [
  {
    id: "excellent",
    name: "Excellent Strike",
    actionCost: 1,
    score: 100,
    confidence: "high",
    reason: "Best value.",
  },
  {
    id: "bad-one",
    name: "Bad Filler One",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
  {
    id: "bad-two",
    name: "Bad Filler Two",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
  {
    id: "bad-three",
    name: "Bad Filler Three",
    actionCost: 1,
    score: -25,
    confidence: "medium",
    reason: "Low value.",
  },
]);
assert.equal(excellentSingleAction.summary, "Excellent Strike");

const untargetedStrike = scoreCandidate({
  actor: { id: "kobold", name: "Nakpik" },
  token: { id: "token-nakpik", name: "Nakpik" },
  battlefield: { targets: [], enemies: [] },
}, {
  id: "shortsword",
  name: "Shortsword",
  slug: "strike",
  source: "strike",
  actionCost: 1,
  range: { max: 5 },
});
assert.equal(untargetedStrike.score, -999);
assert.equal(untargetedStrike.suggestedTarget, null);
assert.equal(untargetedStrike.reason, "No valid enemy target.");

const untargetedStep = scoreCandidate({
  actor: { id: "kobold", name: "Nakpik" },
  token: { id: "token-nakpik", name: "Nakpik" },
  battlefield: { targets: [], enemies: [] },
}, {
  id: "step",
  name: "Step",
  slug: "step",
  source: "generic",
  actionCost: 1,
});
assert.equal(untargetedStep.score, -999);
assert.equal(untargetedStep.suggestedTarget, null);
assert.equal(untargetedStep.reason, "No valid enemy target.");

const noTargetBuild = buildCandidates({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "shortsword",
          type: "strike",
          label: "Shortsword",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "shortsword", system: { traits: { value: [] } } },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: { speed: 25, conditions: { slugs: [], values: {} } },
  token: { id: "token-nakpik", name: "Nakpik", center: { x: 0, y: 0 } },
  battlefield: { targets: [], enemies: [] },
  targets: undefined,
});
assert.equal(noTargetBuild.candidates.some((action) => ["step", "stride", "strike"].includes(action.slug)), false);

const sickenedGenericContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [], weapon: [] },
      items: [],
    },
  },
  profile: {
    speed: 25,
    conditions: { slugs: ["sickened"], values: { sickened: 1 } },
    skills: {},
  },
  token: { id: "actor-token", name: "Actor", center: { x: 0, y: 0 } },
  battlefield: { targets: [], enemies: [], allies: [] },
};
const sickenedSources = readActionSources(sickenedGenericContext);
assert.equal(sickenedSources.find((action) => action.slug === "retch")?.available, true);
const retchCandidate = buildCandidates(sickenedGenericContext).candidates.find((action) => action.slug === "retch");
assert.ok(retchCandidate, "Retch should be a 1-action option while sickened");
assert.equal(retchCandidate.actionCost, 1);
assert.equal(retchCandidate.suggestedTarget?.type, "self");
assert.ok(retchCandidate.reasons.some((reason) => reason.includes("sickened")));
const healthySources = readActionSources({
  ...sickenedGenericContext,
  profile: { ...sickenedGenericContext.profile, conditions: { slugs: [], values: {} } },
});
assert.equal(healthySources.find((action) => action.slug === "retch")?.available, false);

const proneGenericTarget = { id: "generic-enemy", name: "Enemy", distance: 20, attackTargetable: true };
const proneGenericContext = {
  ...sickenedGenericContext,
  profile: { ...sickenedGenericContext.profile, conditions: { slugs: ["prone"], values: { prone: 1 } } },
  targets: [proneGenericTarget],
  battlefield: { targets: [proneGenericTarget], enemies: [proneGenericTarget], allies: [] },
};
const standCandidate = buildCandidates(proneGenericContext).candidates.find((action) => action.slug === "stand");
assert.ok(standCandidate, "Stand should be a 1-action option while prone");
assert.equal(standCandidate.actionCost, 1);
assert.equal(requiresDestinationForAction(standCandidate), false);
const crawlCandidate = buildCandidates(proneGenericContext).candidates.find((action) => action.slug === "crawl");
assert.ok(crawlCandidate, "Crawl should be a 1-action movement option while prone");
assert.equal(crawlCandidate.actionCost, 1);
assert.equal(requiresDestinationForAction(crawlCandidate), true);
// Move-and-strike activities (e.g. Sudden Charge) auto-plot their movement toward the
// target and delegate manual movement to uncounted Strides, so they must NOT prompt
// for a destination — even though they include strides.
assert.equal(requiresDestinationForAction({
  slug: "sudden-charge",
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 2 },
}), false, "move-and-strike activities should not require a manual destination");
// A stale requiresDestination flag baked into an older draft step must be overridden for
// move-and-strike activities.
assert.equal(requiresDestinationForAction({
  slug: "sudden-charge",
  requiresDestination: true,
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 2 },
}), false, "move-and-strike overrides a stale requiresDestination flag");
// A pure movement action still requires one.
assert.equal(requiresDestinationForAction({ slug: "stride" }), true);
// Move-and-strike activities resolve their target automatically (the recommendation already
// chose it), so — like their destination — they should not prompt for a manual target.
assert.equal(requiresTargetForAction({
  slug: "sudden-charge",
  targetingProfile: { enemy: true, reachAfterMove: true },
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 2 },
}), false, "move-and-strike activities should not require a manual target");
// A plain strike (strike with no movement) still needs a target.
assert.equal(requiresTargetForAction({
  slug: "longsword",
  source: "strike",
  targetingProfile: { enemy: true },
  activityProfile: { includes: ["strike"], includesStrike: true },
}), true, "a plain strike still requires a target");
const projectedAfterStandGeneric = projectContextForDraftDestination(proneGenericContext, {
  steps: [{ instanceId: "stand-1", actionKey: "stand", actionCost: 1 }],
});
assert.equal(projectedAfterStandGeneric.profile.conditions.slugs.includes("prone"), false);
assert.equal(
  buildCandidates(projectedAfterStandGeneric).candidates.some((action) => action.slug === "stride"),
  true,
  "Stand in draft should restore normal movement actions for later choices",
);

const immobilizedGenericContext = {
  ...sickenedGenericContext,
  profile: { ...sickenedGenericContext.profile, conditions: { slugs: ["immobilized"], values: { immobilized: 1 } } },
  targets: [proneGenericTarget],
  battlefield: { targets: [proneGenericTarget], enemies: [proneGenericTarget], allies: [] },
};
const immobilizedEscape = readActionSources(immobilizedGenericContext).find((action) => action.slug === "escape");
assert.equal(immobilizedEscape.available, true);
const projectedAfterEscape = projectContextForDraftDestination(immobilizedGenericContext, {
  steps: [{ instanceId: "escape-1", actionKey: "escape", actionCost: 1 }],
});
assert.equal(projectedAfterEscape.profile.conditions.slugs.includes("immobilized"), false);
assert.equal(
  buildCandidates(projectedAfterEscape).candidates.some((action) => action.slug === "stride"),
  true,
  "Escape in draft should restore movement actions for later choices",
);

const aggroDefenderTarget = {
  id: "defender",
  name: "Shield Guard",
  distance: 5,
  hpPercent: 0.95,
  ac: 27,
  attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: {
    document: {
      type: "character",
      itemTypes: {
        action: [{ slug: "raise-a-shield", name: "Raise a Shield" }],
        spell: [],
        spellcastingEntry: [],
        weapon: [{ name: "Shield Boss", system: { traits: { value: [] } } }],
      },
      system: { attributes: { hp: { value: 60, max: 60 }, ac: { value: 27 } } },
    },
  },
};
const aggroHealerTarget = {
  id: "healer",
  name: "Temple Healer",
  distance: 30,
  hpPercent: 0.9,
  ac: 18,
  attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: {
    document: {
      type: "character",
      itemTypes: {
        action: [],
        spell: [{ id: "heal", slug: "heal", name: "Heal", system: { traits: { value: ["healing"] } } }],
        spellcastingEntry: [{ system: { prepared: { value: "prepared" }, slots: { slot1: { prepared: [{ id: "heal" }] } } } }],
        weapon: [],
      },
      system: { attributes: { hp: { value: 45, max: 50 }, ac: { value: 18 } } },
    },
  },
};
const aggroCasterTarget = {
  id: "caster",
  name: "Battle Mage",
  distance: 25,
  hpPercent: 0.7,
  ac: 16,
  attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: {
    document: {
      type: "character",
      itemTypes: {
        action: [],
        spell: [{
          slug: "fireball",
          name: "Fireball",
          system: { traits: { value: ["fire"] }, defense: { save: { statistic: "reflex" } } },
        }, {
          slug: "slow",
          name: "Slow",
          system: { traits: { value: ["incapacitation"] }, defense: { save: { statistic: "will" } } },
        }],
        spellcastingEntry: [{ system: { prepared: { value: "prepared" }, slots: { slot3: { value: 1 } } } }],
        weapon: [],
      },
      system: { attributes: { hp: { value: 28, max: 40 }, ac: { value: 16 } } },
    },
  },
};
const npcAggroContext = {
  isGM: true,
  actor: {
    id: "mitflit",
    name: "Mitflit",
    document: { type: "npc", itemTypes: {}, system: { attributes: { hp: { value: 10, max: 10 } } } },
  },
  profile: {
    actorType: "npc",
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    skills: {},
  },
  token: { id: "mitflit-token", name: "Mitflit", center: { x: 0, y: 0 } },
  targets: [aggroDefenderTarget],
  battlefield: {
    targets: [aggroDefenderTarget],
    enemies: [aggroDefenderTarget, aggroHealerTarget, aggroCasterTarget],
    allies: [],
  },
};
const healerAggro = aggroProfile(npcAggroContext, aggroHealerTarget);
assert.equal(healerAggro.roles.includes("healer"), true);
assert.equal(healerAggro.gmOnly, true);
assert.ok(aggroTargetValue(npcAggroContext, { role: "damage" }, "damage", aggroHealerTarget)
  > aggroTargetValue(npcAggroContext, { role: "damage" }, "damage", aggroDefenderTarget));
const npcAggroShot = scoreCandidate(npcAggroContext, {
  id: "shortbow",
  name: "Shortbow",
  slug: "strike",
  source: "strike",
  actionCost: 1,
  range: { max: 60 },
});
assert.equal(npcAggroShot.suggestedTarget.name, "Temple Healer");

// Main-defender detection is relative to the other targets in the fight, not an absolute AC number.
// The same AC can be "the tank" or "the squishy" depending on who else is on the field.
const relAggroTarget = (id, name, ac) => ({
  id, name, distance: 20, hpPercent: 1, ac,
  attackTargetable: true, conditions: { slugs: [], values: {} },
  actor: { document: { type: "npc",
    itemTypes: { action: [], spell: [], spellcastingEntry: [], weapon: [] },
    system: { attributes: { hp: { value: 30, max: 30 }, ac: { value: ac } } } } },
});
const relTank = relAggroTarget("tank", "Steel Wall", 24);
const relStriker = relAggroTarget("striker", "Duelist", 18);
const relMage = relAggroTarget("mage", "Sorcerer", 16);
const relPartyContext = {
  ...npcAggroContext,
  targets: [relTank, relStriker, relMage],
  battlefield: { targets: [relTank, relStriker, relMage], enemies: [relTank, relStriker, relMage], allies: [] },
};
// Party mean AC ≈ 19.3; only the AC-24 target clears mean + margin.
assert.equal(aggroProfile(relPartyContext, relTank).roles.includes("main-defender"), true,
  "highest-AC target in the party reads as the defender");
assert.equal(aggroProfile(relPartyContext, relStriker).roles.includes("main-defender"), false,
  "mid-AC target is not the defender");
assert.equal(aggroProfile(relPartyContext, relMage).roles.includes("main-defender"), false,
  "low-AC target is not the defender");
// With no peers to compare against, AC alone can't flag a defender (kit cues still can elsewhere).
const relSoloContext = {
  ...npcAggroContext,
  targets: [relTank],
  battlefield: { targets: [relTank], enemies: [relTank], allies: [] },
};
assert.equal(aggroProfile(relSoloContext, relTank).roles.includes("main-defender"), false,
  "a lone target has no party to look tanky against");

// finisher-target keys on low HP or actively dying — NOT the wounded counter, which can sit on a
// fully-healed creature.
const woundedFullHpTarget = {
  id: "wounded-full", name: "Recovered Knight", distance: 30, hpPercent: 1,
  attackTargetable: true, conditions: { slugs: ["wounded"], values: { wounded: 1 } },
  actor: { document: { type: "npc", itemTypes: {}, system: { attributes: { hp: { value: 50, max: 50 } } } } },
};
const dyingTarget = {
  id: "dying", name: "Fallen Scout", distance: 30, hpPercent: 1,
  attackTargetable: true, conditions: { slugs: ["dying"], values: { dying: 1 } },
  actor: { document: { type: "npc", itemTypes: {}, system: { attributes: { hp: { value: 50, max: 50 } } } } },
};
assert.equal(aggroProfile(npcAggroContext, woundedFullHpTarget).roles.includes("finisher-target"), false,
  "a full-HP wounded creature is not a finisher target");
assert.equal(aggroProfile(npcAggroContext, dyingTarget).roles.includes("finisher-target"), true,
  "a dying creature is a finisher target");

// Incapacitation: a hard-control spell is worth much less against a target of more than twice its
// rank (it resists a degree better), and the reason is surfaced.
const incapSpell = {
  id: "slow", name: "Slow", slug: "slow", source: "spell-inferred", actionCost: 2, role: "control",
  castRank: 2, traits: ["incapacitation"], targetingProfile: { enemy: true, maxRange: 60 },
  saveProfile: { stat: "will" },
};
const incapContext = (targetLevel) => ({
  isGM: true,
  profile: { actorType: "npc", spellDc: 30, hpPercent: 1, conditions: { slugs: [], values: {} }, skills: {} },
  actor: { id: "boss", name: "Boss", document: { type: "npc", itemTypes: {}, system: { attributes: { hp: { value: 100, max: 100 } } } } },
  token: { id: "boss-t", name: "Boss", center: { x: 0, y: 0 } },
  targets: [],
  battlefield: { targets: [], allies: [], enemies: [{
    id: "foe", name: "Foe", level: targetLevel, distance: 30, hpPercent: 1, attackTargetable: true,
    conditions: { slugs: [], values: {} }, saves: { will: { dc: 20 }, reflex: { dc: 18 }, fortitude: { dc: 18 } },
    actor: { document: { type: "character", itemTypes: {},
      system: { details: { level: { value: targetLevel } }, attributes: { hp: { value: 100, max: 100 }, ac: { value: 20 } } } } },
  }] },
});
const incapVsLow = scoreCandidate(incapContext(3), incapSpell);
const incapVsHigh = scoreCandidate(incapContext(20), incapSpell);
assert.ok(incapVsHigh.score < incapVsLow.score,
  "an incapacitation spell scores lower against a target more than twice its rank");
assert.ok(incapVsHigh.reasons.some((reason) => /incapacitation/i.test(reason)),
  "the incapacitation degrade is surfaced in the reasons");

// Skill checks are weighted by degree of success, so a near-guaranteed critical Demoralize is worth
// far more than a barely-succeeding one — a wider gap than a flat success chance would give.
const skillDemoralize = {
  id: "demoralize", name: "Demoralize", slug: "demoralize", source: "generic", actionCost: 1,
  role: "debuff", skill: "intimidation", targetingProfile: { enemy: true, maxRange: 30 },
};
const skillContext = (intimidationMod) => ({
  isGM: true,
  profile: { actorType: "npc", hpPercent: 1, conditions: { slugs: [], values: {} },
    skills: { intimidation: { mod: intimidationMod, rank: 2 } } },
  actor: { id: "boss", name: "Boss", document: { type: "npc", itemTypes: {}, system: { attributes: { hp: { value: 100, max: 100 } } } } },
  token: { id: "boss-t", name: "Boss", center: { x: 0, y: 0 } },
  targets: [],
  battlefield: { targets: [], allies: [], enemies: [{
    id: "foe", name: "Foe", distance: 20, hpPercent: 1, attackTargetable: true,
    conditions: { slugs: [], values: {} }, saves: { will: { dc: 20 }, reflex: { dc: 18 }, fortitude: { dc: 18 } },
    perception: { dc: 20 },
    actor: { document: { type: "character", itemTypes: {}, system: { attributes: { hp: { value: 100, max: 100 }, ac: { value: 20 } } } } },
  }] },
});
const critDemoralize = scoreCandidate(skillContext(40), skillDemoralize);
const evenDemoralize = scoreCandidate(skillContext(10), skillDemoralize);
assert.ok(critDemoralize.score - evenDemoralize.score > 25,
  "degree-of-success weighting rewards a crit-heavy skill check well beyond a flat success chance");

// Role cues ignore description prose: an ability that only mentions conditions in its text (e.g.
// "immune to fear") must not be misread as a controller.
const prosyTarget = {
  id: "prosy", name: "Stoic", distance: 30, hpPercent: 1, ac: 18, attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: { document: { type: "npc",
    itemTypes: { spell: [], spellcastingEntry: [], weapon: [],
      action: [{ slug: "steady-nerves", name: "Steady Nerves",
        system: { traits: { value: [] }, description: { value: "This creature cannot be slowed, frightened, or stunned." } } }] },
    system: { attributes: { hp: { value: 40, max: 40 }, ac: { value: 18 } } } } },
};
assert.equal(aggroProfile(npcAggroContext, prosyTarget).roles.includes("controller"), false,
  "control words in description prose no longer flag a controller");

// main-attacker scales with actual offense — a feat-stacked, multi-weapon striker outranks a mook.
const mookTarget = {
  id: "mook", name: "Mook", distance: 30, hpPercent: 1, ac: 16, attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: { document: { type: "npc",
    itemTypes: { action: [], feat: [], spell: [], spellcastingEntry: [],
      weapon: [{ name: "Club", system: { traits: { value: [] } } }] },
    system: { attributes: { hp: { value: 20, max: 20 }, ac: { value: 16 } } } } },
};
const strikerTarget = {
  id: "striker", name: "Blademaster", distance: 30, hpPercent: 1, ac: 16, attackTargetable: true,
  conditions: { slugs: [], values: {} },
  actor: { document: { type: "npc",
    itemTypes: { action: [], spell: [], spellcastingEntry: [],
      feat: [
        { slug: "power-attack", name: "Power Attack", system: { traits: { value: [] } } },
        { slug: "sneak-attack", name: "Sneak Attack", system: { traits: { value: [] } } },
      ],
      weapon: [
        { name: "Sword", system: { traits: { value: [] } } },
        { name: "Dagger", system: { traits: { value: [] } } },
      ] },
    system: { attributes: { hp: { value: 40, max: 40 }, ac: { value: 16 } } } } },
};
assert.ok(
  aggroProfile(npcAggroContext, strikerTarget).roleScores["main-attacker"]
    > aggroProfile(npcAggroContext, mookTarget).roleScores["main-attacker"],
  "a feat-stacked, multi-weapon striker reads as a bigger attacker than a one-weapon mook");

// Aggro-driven auto-fill: the GM's NPC auto-fill should pre-pick the target.
assert.equal(canUseFullAggro({ isGM: true, profile: { actorType: "npc" } }), true, "GM + NPC enables aggro target picking");
assert.equal(canUseFullAggro({ isGM: true, profile: { actorType: "character" } }), false, "GM + PC does not pick aggro targets");
assert.equal(canUseFullAggro({ isGM: false, profile: { actorType: "npc" } }), false, "players do not pick aggro targets");
const prefillTarget = plannedTargetSelection({ suggestedTarget: { id: "t1", name: "Healer", token: { id: "t1" } } });
assert.deepEqual(prefillTarget.targetTokenIds, ["t1"], "planned target selection exposes the suggested target token id");
assert.ok(panelSource.includes("canUseFullAggro") && panelSource.includes("plannedTargetSelection"),
  "auto-fill should consult aggro + planned target selection");
assert.ok(/_autoFillDraft\([\s\S]*targetSelection: "manual"/.test(panelSource),
  "auto-fill should store the aggro target as a manual selection for GM NPCs");
assert.ok(panelSource.includes("recommendedMovementForStep"), "auto-fill should recommend a stride destination");
assert.ok(/_autoFillDraft\([\s\S]*recommendedMovementForStep[\s\S]*movementPlan/.test(panelSource),
  "auto-fill should store the recommended destination and waypoints for GM NPCs");
assert.ok(/_autoFillDraft\([\s\S]*strideStepTowardPlannedTarget\(step, atomicSteps, index\)/.test(panelSource),
  "auto-fill should aim a generic stride at the plan's upcoming attack target");
// Speed guard: auto-fill must reject any stride destination (preset or recommended) the ruler says
// is beyond the actor's Speed, so it never commits a move past the reachable range.
assert.ok(panelSource.includes("autoFillStrideOverSpeed"), "auto-fill should clamp stride destinations to the actor's Speed");
assert.ok(
  /function autoFillStrideOverSpeed[\s\S]*canvas\?\.grid\?\.measurePath[\s\S]*cost > speed/.test(panelSource),
  "the Speed clamp should measure with Foundry's ruler and reject over-Speed destinations",
);
// Boundary guard: auto-fill drops a negative-scored generic basic move so a redundant in-reach
// Stride can never be pre-filled, even from a pinned plan variant.
assert.ok(/_autoFillDraft\([\s\S]*filter\(\(step\) => !isRedundantAutoFillMove\(step\)\)/.test(panelSource),
  "auto-fill should skip redundant (negative-scored) generic basic moves");
assert.ok(/function isRedundantAutoFillMove\([\s\S]*Number\(step\?\.score\) < 0/.test(panelSource),
  "a redundant auto-fill move is a negative-scored generic basic move");
// Hard guard at assembly: if the plan applies prone, no Stride/Step reaches the draft (can't Stride
// while prone) — regardless of what the planner produced. The slug match is substring-based because
// the candidate slug is the action id ("generic-drop-prone").
assert.ok(/function autoFillAppliesProne\([\s\S]*includes\("drop-prone"\)/.test(panelSource),
  "auto-fill prone detection should match a slug containing drop-prone");
assert.ok(/_autoFillDraft\([\s\S]*planAppliesProne[\s\S]*AUTO_FILL_BASIC_MOVE_SLUGS\.has/.test(panelSource),
  "auto-fill should drop Stride/Step when the plan applies prone");
// A target-aimed Stride that can't get closer to the planned target (blocked path) is dropped —
// that's the "Stride to the same place" the GM sees.
assert.ok(
  /_autoFillDraft\([\s\S]*replacingDraft[\s\S]*buildCandidates\(this\._context\)[\s\S]*bestTurnPlan\(this\._context/.test(panelSource),
  "replacing an existing draft should rebuild Auto-fill from the real context, not the draft-projected context",
);
assert.ok(/function strideImprovesPosition\([\s\S]*before - after\) >= minGain/.test(panelSource),
  "a kept Stride must improve position toward its target");
assert.ok(/_autoFillDraft\([\s\S]*!strideImprovesPosition\([\s\S]*return null/.test(panelSource),
  "auto-fill should drop a basic move that can't improve position toward its target");

// A generic stride preceding a strike must close on the strike's target, not the first listed
// enemy. recommendedMovementForStep honours a preferredTarget that matches a combat target, so
// borrowing the next attack step's target makes the stride head the right way.
const strideTowardPlannedTarget = recommendedMovementForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [
      { id: "bystander", name: "Bystander", token: { id: "bystander", center: { x: -100, y: 0 } }, distance: 100 },
      { id: "alon", name: "Alon", token: { id: "alon", center: { x: 100, y: 0 } }, distance: 100 },
    ],
  },
}, {
  slug: "stride",
  preferredTarget: { id: "alon", name: "Alon", token: { id: "alon" } },
});
assert.ok(strideTowardPlannedTarget && strideTowardPlannedTarget.destination.x > 0,
  "a stride borrows the strike's target and heads toward it, not the first listed enemy");

const npcAggroControl = scoreCandidate(npcAggroContext, {
  id: "slow",
  name: "Slow",
  slug: "slow",
  source: "spell-inferred",
  actionCost: 2,
  role: "control",
  targetingProfile: { enemy: true, maxRange: 60 },
  saveProfile: { stat: "will" },
});
assert.equal(npcAggroControl.suggestedTarget.name, "Battle Mage");

const playerSafeAggroShot = scoreCandidate({
  ...npcAggroContext,
  isGM: false,
  profile: { ...npcAggroContext.profile, actorType: "character" },
}, {
  id: "shortbow",
  name: "Shortbow",
  slug: "strike",
  source: "strike",
  actionCost: 1,
  range: { max: 60 },
});
assert.equal(playerSafeAggroShot.suggestedTarget.name, "Battle Mage");
assert.equal(playerSafeAggroShot.reasons.some((reason) => /aggro|healer|caster/i.test(reason)), false);

const pressureContext = {
  profile: { hpPercent: 1, hasShield: true, conditions: { slugs: [], values: {} } },
  token: { id: "hero", name: "Hero", center: { x: 0, y: 0 }, width: 1, height: 1 },
  battlefield: {
    targets: [],
    allies: [],
    enemies: [
      { id: "goblin", name: "Goblin", center: { x: 5, y: 0 }, token: { center: { x: 5, y: 0 }, width: 1, height: 1 } },
      { id: "archer", name: "Archer", center: { x: 30, y: 0 }, token: { center: { x: 30, y: 0 }, width: 1, height: 1 } },
    ],
  },
};
const pressure = battlefieldPressure(pressureContext);
assert.equal(pressure.inMeleeThreat, true);
assert.equal(pressure.hasOpenEnemyLine, true);
assert.equal(threatCountAtCenter(pressureContext, { x: -10, y: 0 }), 0);
assert.ok(compareTacticalCenters(pressureContext, { x: -10, y: 0, cost: 10 }, { x: 0, y: 0, cost: 0 }) < 0);

const previousPressureCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      placeables: [{ document: { c: [2.5, -2.5, 2.5, 2.5] } }],
    },
  };
  assert.equal(battlefieldPressure(pressureContext).inMeleeThreat, false);
} finally {
  globalThis.canvas = previousPressureCanvas;
}

const pressuredShield = scoreCandidate(pressureContext, {
  id: "raise-a-shield",
  name: "Raise a Shield",
  slug: "raise-a-shield",
  actionCost: 1,
  source: "generic",
  role: "defense",
  score: 10,
});
const quietShield = scoreCandidate({
  ...pressureContext,
  battlefield: { targets: [], allies: [], enemies: [] },
}, {
  id: "raise-a-shield",
  name: "Raise a Shield",
  slug: "raise-a-shield",
  actionCost: 1,
  source: "generic",
  role: "defense",
  score: 10,
});
assert.ok(pressuredShield.score > quietShield.score);
assert.ok(pressuredShield.reasons.includes("Enemies have a clear attack line."));

const proneMeleeTarget = { ...fighterContext.targets[0], distance: 5 };
const proneMeleeContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    speed: 25,
    conditions: {
      slugs: ["prone"],
      values: { prone: 1 },
    },
  },
  targets: [proneMeleeTarget],
  battlefield: {
    targets: [proneMeleeTarget],
    enemies: [proneMeleeTarget],
    allies: [],
  },
};
const proneSources = readActionSources(proneMeleeContext);
const proneStand = proneSources.find((action) => action.slug === "stand");
const proneStride = proneSources.find((action) => action.slug === "stride");
assert.equal(proneStand.available, true);
assert.equal(proneStride.available, false);
assert.equal(proneStride.unavailableReason, "Actor is prone; move actions are unavailable.");

const uprightSources = readActionSources(fighterContext);
assert.equal(uprightSources.find((action) => action.slug === "stand").available, false);

// Regression: a Large creature was picking its weaker 2d10 ranged beam over its harder-hitting 2d12
// melee Pincer against an ADJACENT target. Two causes — (1) distance for a Large token now uses
// token.distanceTo (adjacent = 5 ft, not center-to-center 10 ft), and (2) the strike damage bonus no
// longer caps into a tie, so higher dice win. Here we lock in cause (2) at the scoring seam.
const dualStrikeContext = (distance) => {
  const target = { id: "petal", name: "Petal", distance, attackTargetable: true, center: { x: 0, y: 0 }, token: { center: { x: 0, y: 0 } } };
  const meleeItem = (damage, type, traits, range = null) => ({ type: "melee", system: { damageRolls: { r: { damage, damageType: type } }, range, traits: { value: traits } } });
  return {
    actor: { document: { itemTypes: {}, system: { traits: { size: { value: "lg" } }, actions: [
      { type: "strike", name: "Pincer", label: "Pincer", item: meleeItem("2d12+12", "piercing", ["magical"]), traits: [], weaponTraits: [], variants: [] },
      { type: "strike", name: "Energy Beam", label: "Energy Beam", item: meleeItem("2d10+10", "fire", ["fire", "magical"], { increment: null, max: 60 }), traits: [], weaponTraits: [], variants: [] },
    ] } } },
    battlefield: { allies: [], enemies: [target], targets: [target] },
    targets: [target],
  };
};
const adjacentDualCtx = dualStrikeContext(5);
const adjacentStrikes = readActionSources(adjacentDualCtx).filter((a) => a.source === "strike");
const adjacentPincer = adjacentStrikes.find((a) => a.name === "Pincer");
const adjacentBeam = adjacentStrikes.find((a) => a.name === "Energy Beam");
assert.equal(adjacentPincer.range.max, 5, "a melee Strike with no reach trait reaches 5 ft");
assert.ok(scoreCandidate(adjacentDualCtx, adjacentPincer).score > scoreCandidate(adjacentDualCtx, adjacentBeam).score,
  "the harder-hitting in-reach melee Pincer beats the weaker ranged beam against an adjacent target");

// Regression: cause (3) of the same bug. PF2e injects a synthetic RitualSpellcasting entry into
// EVERY actor's `spellcasting.collections`, spellcaster or not (ActorSpellcasting#prepareDataFromItems
// always appends `new RitualSpellcasting(this)`). hasSpellcastingCapability used to treat any non-empty
// `spellcasting.collections` as "this actor casts spells", which was true for 100% of actors — so
// every melee Strike on every non-caster creature that also had any other Strike ate an incorrect
// -18 "prefer spell options" penalty. Only actual spell/spellcastingEntry items should count.
const phantomRitualContext = dualStrikeContext(5);
phantomRitualContext.actor.document.spellcasting = { collections: new Map([["rituals", {}]]), entries: [] };
const phantomStrikes = readActionSources(phantomRitualContext).filter((a) => a.source === "strike");
const phantomPincer = phantomStrikes.find((a) => a.name === "Pincer");
const phantomScore = scoreCandidate(phantomRitualContext, phantomPincer);
assert.equal(
  phantomScore.reasons.some((reason) => /lower priority than spell options/i.test(reason)),
  false,
  "a non-spellcaster's melee Strike must not be penalized just because of PF2e's built-in ritual-casting placeholder",
);

const scoredStand = scoreCandidate(proneMeleeContext, proneStand);
assert.ok(scoredStand.score > 70);
assert.ok(scoredStand.reasons.includes("Removes prone and restores normal movement."));
assert.ok(scoredStand.reasons.includes("Standing removes melee attack penalty and off-guard risk."));

const proneStandStrikePlan = buildTurnPlans(proneMeleeContext, [
  scoredStand,
  {
    id: "strike-longsword",
    name: "Longsword",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    score: 92,
    confidence: "medium",
    reason: "Melee target is in reach.",
  },
]).find((plan) => plan.steps.some((step) => step.slug === "stand") && plan.steps.some((step) => step.slug === "strike"));
assert.ok(proneStandStrikePlan.steps.findIndex((step) => step.slug === "stand")
  < proneStandStrikePlan.steps.findIndex((step) => step.slug === "strike"));

const proneFarTarget = { ...fighterContext.targets[0], distance: 20 };
const proneFarContext = {
  ...proneMeleeContext,
  targets: [proneFarTarget],
  battlefield: {
    targets: [proneFarTarget],
    enemies: [proneFarTarget],
    allies: [],
  },
};
const standStride = readActionSources(proneFarContext).find((action) => action.slug === "stand-stride");
assert.equal(standStride.available, true);
assert.equal(standStride.actionCost, 2);
assert.equal(standStride.preferredTarget.name, "Ogre");
const scoredStandStride = scoreCandidate(proneFarContext, standStride);
assert.ok(scoredStandStride.reasons.includes("Closes distance toward the target."));

// A generic Stride toward a target already within reach closes no distance, so it must score
// negative — below the planner's unused-action penalty — or the planner pads a spare action with
// a "Stride to the same square" that auto-fill then recommends as a no-op move.
const redundantStrideScore = scoreCandidate({
  profile: { reach: 5, speed: { value: 25 } },
  targets: [{ id: "adjacent", name: "Adjacent", distance: 5 }],
  battlefield: {
    targets: [{ id: "adjacent", name: "Adjacent", distance: 5 }],
    enemies: [{ id: "adjacent", name: "Adjacent", distance: 5 }],
  },
}, { id: "stride", name: "Stride", slug: "stride", source: "generic", actionCost: 1, role: "mobility" });
assert.ok(
  redundantStrideScore.reasons.includes("Target already in reach; repositioning is low priority."),
  "a stride toward an in-reach target should flag the repositioning as low priority",
);
assert.ok(
  redundantStrideScore.score < 0,
  "a redundant in-reach Stride must score negative so the planner never pads it as filler",
);

const proneStrideStrikeContext = {
  ...proneFarContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: {
        actions: [{
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "longsword", system: { traits: { value: [] } } },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
};
const standStrideStrike = readActionSources(proneStrideStrikeContext)
  .find((action) => action.slug === "stand-stride-strike-longsword");
assert.equal(standStrideStrike.name, "Stand -> Stride -> Longsword");
assert.equal(standStrideStrike.actionCost, 3);
assert.deepEqual(standStrideStrike.activityProfile.includes, ["stand", "stride", "strike"]);

const previousTacticalCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: {
      size: 5,
      measurePath(points) {
        const [from, to] = points;
        return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      },
    },
    walls: { placeables: [] },
  };

  const tacticalMoveContext = {
    ...fighterContext,
    profile: {
      ...fighterContext.profile,
      speed: 25,
      reach: 5,
      conditions: { slugs: [], values: {} },
    },
    token: { id: "hero", name: "Hero", center: { x: 0, y: 0 }, width: 1, height: 1 },
    actor: {
      ...fighterContext.actor,
      document: {
        system: {
          actions: [{
            slug: "longsword",
            type: "strike",
            label: "Longsword",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "longsword", system: { traits: { value: [] } } },
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    targets: [{
      id: "target",
      name: "Target",
      distance: 25,
      center: { x: 25, y: 0 },
      token: { center: { x: 25, y: 0 }, width: 1, height: 1 },
      conditions: { slugs: [], values: {} },
    }],
    battlefield: {
      targets: [{
        id: "target",
        name: "Target",
        distance: 25,
        center: { x: 25, y: 0 },
        token: { center: { x: 25, y: 0 }, width: 1, height: 1 },
        conditions: { slugs: [], values: {} },
      }],
      allies: [],
      enemies: [{
        id: "target",
        name: "Target",
        distance: 25,
        center: { x: 25, y: 0 },
        token: { center: { x: 25, y: 0 }, width: 1, height: 1 },
        conditions: { slugs: [], values: {} },
      }, {
        id: "guard",
        name: "Guard",
        distance: 20,
        center: { x: 20, y: 5 },
        token: { center: { x: 20, y: 5 }, width: 1, height: 1 },
        conditions: { slugs: [], values: {} },
      }],
    },
  };
  const tacticalStrideStrike = readActionSources(tacticalMoveContext)
    .find((action) => action.slug === "stride-strike-longsword");
  assert.ok(tacticalStrideStrike.activityProfile.attackCenter);
  assert.ok(
    threatCountAtCenter(tacticalMoveContext, tacticalStrideStrike.activityProfile.attackCenter) < 2,
    "move-strike should avoid equal-cost square threatened by a second enemy",
  );
} finally {
  globalThis.canvas = previousTacticalCanvas;
}

const scoredStandStrideStrike = scoreCandidate(proneStrideStrikeContext, standStrideStrike);
const scoredProneTwoActionSpell = scoreCandidate(proneStrideStrikeContext, {
  id: "two-action-prone-spell",
  name: "Two-Action Spell",
  slug: "two-action-prone-spell",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  preferredTarget: proneFarTarget,
  damageProfile: { formula: "5d8", type: "force", types: ["force"], average: 22.5 },
  activityProfile: { includes: ["damage"], includesStrike: false, averageDamage: 22.5 },
  targetingProfile: { enemy: true, maxRange: 60 },
});
const standThenSpellPlan = bestTurnPlan(proneStrideStrikeContext, [
  scoredStand,
  scoredStandStrideStrike,
  scoredProneTwoActionSpell,
]);
assert.deepEqual(standThenSpellPlan.steps.map((step) => step.slug), ["stand", "two-action-prone-spell"]);

const manyFreeActions = Array.from({ length: 40 }, (_, index) => ({
  id: `free-${index}`,
  name: `Free ${index}`,
  actionCost: 0,
  score: 100 - index,
  confidence: "high",
  reason: "Free option.",
}));
const boundedPlans = buildTurnPlans(fighterContext, manyFreeActions);
assert.ok(boundedPlans.length <= 256);
assert.ok(boundedPlans.every((plan) => plan.steps.filter((step) => step.actionCost === 0).length <= 1));

const bespellCandidate = {
  id: "bespell-strikes",
  name: "Bespell Strikes",
  slug: "bespell-strikes",
  actionCost: 0,
  score: 120,
  confidence: "high",
  role: "setup",
  source: "system-inferred",
  activityProfile: {
    includes: ["setup"],
    damageBuff: true,
    previousActionRequirements: ["non-cantrip-spell"],
  },
  gatingProfile: {
    eventTriggerOnly: true,
    eventTriggers: ["previous-action", "spell-cast"],
    previousActionRequirements: ["non-cantrip-spell"],
  },
  setupFor: ["strike", "damage"],
  reason: "Bespell Strikes requires a prior non-cantrip spell.",
};
const nonCantripSpellCandidate = {
  id: "frostbite",
  name: "Frostbite",
  slug: "frostbite",
  actionCost: 2,
  score: 90,
  confidence: "high",
  source: "spell-inferred",
  role: "save-damage",
  rank: 1,
  castRank: 1,
  isCantrip: false,
  reason: "Frostbite can damage a target.",
};
const cantripSpellCandidate = {
  ...nonCantripSpellCandidate,
  id: "electric-arc",
  name: "Electric Arc",
  slug: "electric-arc",
  score: 91,
  rank: 0,
  castRank: 0,
  isCantrip: true,
};
const bespellStrikeCandidate = {
  id: "staff-strike",
  name: "Staff",
  slug: "strike",
  actionCost: 1,
  score: 85,
  confidence: "high",
  source: "strike",
  range: { max: 5 },
  reason: "Staff Strike.",
};
const bespellPlan = bestTurnPlan(fighterContext, [
  bespellCandidate,
  nonCantripSpellCandidate,
  bespellStrikeCandidate,
]);
assert.deepEqual(bespellPlan.steps.map((step) => step.slug), ["frostbite", "bespell-strikes", "strike"]);
assert.equal(bestTurnPlan(fighterContext, [bespellCandidate]).steps.some((step) => step.slug === "bespell-strikes"), false);
assert.equal(
  bestTurnPlan(fighterContext, [bespellCandidate, cantripSpellCandidate, bespellStrikeCandidate])
    .steps.some((step) => step.slug === "bespell-strikes"),
  false,
);

const slowedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["slowed"],
      values: { slowed: 2 },
    },
  },
};
assert.equal(actionBudget(slowedContext).normalActions, 1);
assert.equal(bestTurnPlan(slowedContext, fixtureCandidates).totalCost, 1);

const stunnedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["stunned"],
      values: { stunned: 2 },
    },
  },
};
assert.equal(actionBudget(stunnedContext).normalActions, 1);
assert.equal(bestTurnPlan(stunnedContext, fixtureCandidates).totalCost, 1);

const movedThisTurnContext = {
  ...fighterContext,
  actionsSpent: {
    movement: 2,
    normal: 2,
    total: 2,
  },
};
assert.equal(actionBudget(movedThisTurnContext).normalActions, 1);
assert.equal(bestTurnPlan(movedThisTurnContext, fixtureCandidates).totalCost, 1);

const quickenedContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["quickened"],
      values: { quickened: null },
    },
  },
};
const quickenedPlan = bestTurnPlan(quickenedContext, [
  ...fixtureCandidates,
  {
    id: "stride",
    name: "Stride",
    slug: "stride",
    actionCost: 1,
    source: "generic",
    score: 55,
    confidence: "medium",
    reason: "Use quickened action to reposition.",
  },
]);
assert.equal(actionBudget(quickenedContext).quickenedActions, 1);
assert.equal(quickenedPlan.totalCost, 4);
assert.ok(quickenedPlan.steps.some((step) => ["strike", "stride", "step"].includes(step.slug)));

const quickenedProfile = readActorProfile({
  id: "quickened-actor",
  name: "Quickened Actor",
  itemTypes: {
    condition: [{
      name: "Quickened",
      system: { slug: { value: "quickened" } },
    }],
  },
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    movement: { speeds: { land: { value: 25 } } },
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(quickenedProfile.conditions.slugs, ["quickened"]);
assert.equal(actionBudget({ profile: quickenedProfile }).quickenedActions, 1);

const quickenedEffectProfile = readActorProfile({
  id: "quickened-effect-actor",
  name: "Quickened Effect Actor",
  itemTypes: {
    condition: [],
    effect: [{
      name: "Quickened",
      system: { slug: { value: "quickened" } },
    }],
  },
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    movement: { speeds: { land: { value: 25 } } },
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(quickenedEffectProfile.conditions.slugs, []);
assert.deepEqual(quickenedEffectProfile.effects.map((effect) => effect.slug), ["quickened"]);
assert.equal(actionBudget({ profile: quickenedEffectProfile }).quickenedActions, 1);

const alchemistSubclassProfile = readActorProfile({
  id: "alchemist-subclass-actor",
  name: "Alchemist Subclass Actor",
  itemTypes: {
    class: [{ name: "Alchemist", type: "class", system: { slug: "alchemist" } }],
    feat: [{
      id: "field-bomber",
      name: "Bomber",
      type: "feat",
      system: {
        category: "classfeature",
        slug: "bomber",
        traits: { value: ["alchemist"], otherTags: ["alchemist-research-field"] },
      },
    }, {
      id: "weapon-specialization",
      name: "Weapon Specialization",
      type: "feat",
      system: {
        category: "classfeature",
        slug: "weapon-specialization",
        traits: { value: ["alchemist"], otherTags: [] },
      },
    }],
    condition: [],
    effect: [],
  },
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    movement: { speeds: { land: { value: 25 } } },
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(alchemistSubclassProfile.classSlugs, ["alchemist"]);
assert.deepEqual(alchemistSubclassProfile.subclassSlugs, ["bomber"]);
assert.equal(KNOWN_SUBCLASS_SLUGS.has("bomber"), true);

const kineticistGateProfile = readActorProfile({
  id: "kineticist-gate-actor",
  name: "Kineticist Gate Actor",
  itemTypes: {
    class: [{ name: "Kineticist", type: "class", system: { slug: "kineticist" } }],
    feat: [{
      id: "fire-gate",
      name: "Fire Gate",
      type: "feat",
      system: { category: "classfeature", slug: "fire-gate", traits: { value: [] } },
    }],
    condition: [],
    effect: [],
  },
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    movement: { speeds: { land: { value: 25 } } },
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(kineticistGateProfile.subclassSlugs, ["fire-gate"]);

const quickenedEffectContext = {
  ...quickenedContext,
  profile: {
    ...fighterContext.profile,
    conditions: { slugs: [], values: {} },
    effects: [{ slug: "effect-quickened", name: "Effect: Quickened" }],
  },
};
const quickenedEffectPlan = bestTurnPlan(quickenedEffectContext, [
  ...fixtureCandidates,
  {
    id: "stride",
    name: "Stride",
    slug: "stride",
    actionCost: 1,
    source: "generic",
    score: 55,
    confidence: "medium",
    reason: "Use quickened action to reposition.",
  },
]);
assert.equal(actionBudget(quickenedEffectContext).quickenedActions, 1);
assert.equal(quickenedEffectPlan.totalCost, 4);

const nestedQuickenedEffectContext = {
  ...quickenedEffectContext,
  profile: undefined,
  actor: {
    ...fighterContext.actor,
    profile: quickenedEffectProfile,
  },
};
assert.equal(actionBudget(nestedQuickenedEffectContext).quickenedActions, 1);
assert.equal(bestTurnPlan(nestedQuickenedEffectContext, [
  ...fixtureCandidates,
  {
    id: "stride",
    name: "Stride",
    slug: "stride",
    actionCost: 1,
    source: "generic",
    score: 55,
    confidence: "medium",
    reason: "Use quickened action to reposition.",
  },
]).totalCost, 4);

const redundantBasicMovementPlan = bestTurnPlan(fighterContext, [{
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  score: 70,
  confidence: "medium",
  reason: "Target is not frightened.",
}, {
  id: "step",
  name: "Step",
  slug: "step",
  actionCost: 1,
  source: "generic",
  score: 60,
  confidence: "medium",
  reason: "Adjust position.",
}, {
  id: "stride",
  name: "Stride",
  slug: "stride",
  actionCost: 1,
  source: "generic",
  score: 59,
  confidence: "medium",
  reason: "Move to a better square.",
}]);
assert.equal(
  redundantBasicMovementPlan.steps.filter((step) => ["step", "stride"].includes(step.slug)).length,
  1,
);

// "Drop Prone -> Stride" is illegal (can't Stride while prone), so no plan should contain both a
// prone-applying action and a Stride/Step. Crawl is still allowed alongside Drop Prone.
// The live candidate's slug is the action id ("generic-drop-prone") with no appliesConditions —
// match the real shape so the conflict can't regress on the exact-slug assumption.
const dropProneStridePlans = buildTurnPlans(fighterContext, [
  { id: "generic-drop-prone", name: "Drop Prone", slug: "generic-drop-prone", source: "system-inferred", actionCost: 1, score: 60, confidence: "low", reason: "Cover." },
  { id: "stride", name: "Stride", slug: "stride", source: "generic", actionCost: 1, score: 55, confidence: "medium", reason: "Move." },
  { id: "crawl", name: "Crawl", slug: "crawl", source: "generic", actionCost: 1, score: 20, confidence: "low", reason: "Crawl." },
]);
assert.equal(
  dropProneStridePlans.some((plan) =>
    plan.steps.some((step) => step.slug.includes("drop-prone")) && plan.steps.some((step) => step.slug === "stride")),
  false,
  "no plan should pair Drop Prone with a Stride (illegal while prone)",
);
assert.ok(
  dropProneStridePlans.some((plan) =>
    plan.steps.some((step) => step.slug.includes("drop-prone")) && plan.steps.some((step) => step.slug === "crawl")),
  "Drop Prone may still pair with Crawl (legal while prone)",
);

// The Stride can be baked into a move-and-strike composite (e.g. "stride-away-strike-dart",
// strideCount > 0) whose slug is NOT a bare move slug. Drop Prone must still conflict with it.
const dropProneMoveStrikePlans = buildTurnPlans(fighterContext, [
  { id: "generic-drop-prone", name: "Drop Prone", slug: "generic-drop-prone", source: "system-inferred", actionCost: 1, score: 60, confidence: "low", reason: "Cover." },
  { id: "stride-away-strike-dart", name: "Stride + Dart", slug: "stride-away-strike-dart", source: "strike", actionCost: 2, score: 80, confidence: "medium", reason: "Kite.", activityProfile: { includesStrike: true, strideCount: 1 } },
]);
assert.equal(
  dropProneMoveStrikePlans.some((plan) =>
    plan.steps.some((step) => step.slug.includes("drop-prone"))
    && plan.steps.some((step) => Number(step.activityProfile?.strideCount) > 0)),
  false,
  "no plan should pair Drop Prone with a move-and-strike that Strides (illegal while prone)",
);
const proneRecoveryPlans = buildTurnPlans({
  ...fighterContext,
  profile: { ...(fighterContext.profile ?? {}), conditions: { slugs: ["prone"], values: { prone: 1 } } },
}, [
  { id: "stand", name: "Stand", slug: "stand", source: "generic", actionCost: 1, score: 80, confidence: "medium", reason: "Stand.", activityProfile: { includes: ["stand"], removesCondition: "prone" } },
  { id: "crawl", name: "Crawl", slug: "crawl", source: "generic", actionCost: 1, score: 70, confidence: "medium", reason: "Crawl.", activityProfile: { includes: ["move", "crawl"], crawlDistance: 5 } },
  { id: "take-cover", name: "Take Cover", slug: "take-cover", source: "generic", actionCost: 1, score: 65, confidence: "medium", reason: "Cover.", activityProfile: { requiresProneCover: true } },
]);
assert.equal(
  proneRecoveryPlans.some((plan) =>
    plan.steps.some((step) => step.slug === "stand")
    && plan.steps.some((step) => ["crawl", "take-cover"].includes(step.slug))),
  false,
  "standing removes prone, so the same plan must not also Crawl or use prone-only Take Cover",
);
const dropProneTakeCoverPlan = bestTurnPlan({ ...fighterContext, actionsSpent: { normal: 1, total: 1 } }, [
  { id: "generic-drop-prone", name: "Drop Prone", slug: "generic-drop-prone", source: "system-inferred", actionCost: 1, score: 60, confidence: "low", reason: "Cover." },
]);
assert.equal(
  dropProneTakeCoverPlan.summary,
  "Drop Prone -> Take Cover",
  "Drop Prone should spend a remaining action on Take Cover when no stronger follow-up exists",
);

const fullBudgetPreferencePlans = buildTurnPlans(fighterContext, [
  { id: "two-action-burst", name: "Two Action Burst", slug: "two-action-burst", source: "system-inferred", actionCost: 2, score: 100, confidence: "high", reason: "Strong two-action option." },
  { id: "minor-one", name: "Minor One", slug: "minor-one", source: "system-inferred", actionCost: 1, score: 30, confidence: "low", reason: "Legal spare-action option." },
  { id: "minor-two", name: "Minor Two", slug: "minor-two", source: "system-inferred", actionCost: 1, score: 30, confidence: "low", reason: "Legal spare-action option." },
  { id: "minor-three", name: "Minor Three", slug: "minor-three", source: "system-inferred", actionCost: 1, score: 30, confidence: "low", reason: "Legal spare-action option." },
]);
assert.equal(
  fullBudgetPreferencePlans[0].totalCost,
  3,
  "planner should prefer a legal full-budget plan over a higher-scoring partial plan",
);

const setupBeforeStrikePlans = buildTurnPlans(fighterContext, [{
  id: "mandibles",
  name: "Mandibles",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Melee target is in reach.",
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  role: "debuff",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Target is not frightened.",
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  role: "setup",
  actionCost: 1,
  source: "generic",
  score: 75,
  confidence: "medium",
  reason: "Target is in melee and not off-guard.",
}]);
const feintStrikePlan = setupBeforeStrikePlans.find((plan) => {
  const ids = new Set(plan.steps.map((step) => step.id));
  return ids.has("mandibles") && ids.has("demoralize") && ids.has("feint");
});
assert.deepEqual(
  feintStrikePlan.steps.map((step) => step.slug),
  ["demoralize", "feint", "strike"],
);

const speedProfile = readActorProfile({
  id: "speedy",
  name: "Speedy",
  items: [],
  itemTypes: { condition: [] },
  system: {
    attributes: {
      speed: { value: 35 },
      hp: { value: 10, max: 10 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(speedProfile.speed, 35);
assert.deepEqual(speedProfile.effects, []);

const rangedWeaponActor = {
  id: "ranged-weapon-actor",
  items: [{
    type: "weapon",
    system: {
      range: { value: 60 },
      equipped: { carryType: "held", handsHeld: 1 },
    },
  }],
  itemTypes: {},
  system: { attributes: {}, movement: {}, details: {} },
};
assert.equal(
  readActorProfile(rangedWeaponActor).equippedRangedWeapon,
  true,
  "readActorProfile should flag an actor with an equipped ranged weapon (system.range set)",
);
const meleeOnlyActor = {
  id: "melee-only-actor",
  items: [{
    type: "weapon",
    system: { equipped: { carryType: "held", handsHeld: 1 } },
  }],
  itemTypes: {},
  system: { attributes: {}, movement: {}, details: {} },
};
assert.equal(
  readActorProfile(meleeOnlyActor).equippedRangedWeapon,
  false,
  "readActorProfile should not flag an actor whose equipped weapon has no range",
);

const perceptionProfile = readActorProfile({
  id: "perceptive",
  name: "Perceptive",
  type: "character",
  items: [],
  itemTypes: { condition: [] },
  system: {
    perception: { rank: 1, mod: 9 },
    attributes: {
      hp: { value: 10, max: 10 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(perceptionProfile.skills.perception, { rank: 1, mod: 9 });

const npcTopLevelSkillsProfile = readActorProfile({
  id: "npc-skills",
  name: "NPC Skills",
  type: "npc",
  items: [],
  itemTypes: { condition: [] },
  skills: {
    acrobatics: { rank: 1, mod: 8 },
  },
  perception: { rank: null, mod: 6 },
  system: {
    attributes: {
      hp: { value: 10, max: 10 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.deepEqual(npcTopLevelSkillsProfile.skills.acrobatics, { rank: 1, mod: 8 });
assert.deepEqual(npcTopLevelSkillsProfile.skills.perception, { rank: null, mod: 6 });

const classProfile = readActorProfile({
  id: "fighter-class-actor",
  name: "Classed Fighter",
  items: [],
  itemTypes: {
    class: [{
      id: "fighter-class",
      name: "Fighter",
      type: "class",
      system: { slug: "fighter" },
    }],
    condition: [],
  },
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    details: { level: { value: 1 } },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(classProfile.classSlug, "fighter");
assert.deepEqual(classProfile.classSlugs, ["fighter"]);

const demoralizeEffectEntries = readEffects({
  itemTypes: {
    effect: [{
      id: "demoralize-immunity",
      name: "Effect: Demoralize Immunity",
      slug: "effect-demoralize-immunity",
      type: "effect",
      sourceId: "Compendium.xdy-pf2e-workbench.xdy-pf2e-workbench-items.Item.demoralize-immunity",
    }],
  },
  items: [],
});
assert.deepEqual(demoralizeEffectEntries, [{
  id: "demoralize-immunity",
  uuid: null,
  name: "Effect: Demoralize Immunity",
  slug: "effect-demoralize-immunity",
  sourceId: "Compendium.xdy-pf2e-workbench.xdy-pf2e-workbench-items.Item.demoralize-immunity",
}]);

// Prepared PF2e actors expose Speed under system.movement.speeds.land.
const movementSpeedProfile = readActorProfile({
  id: "bulette",
  name: "Bulette",
  items: [],
  itemTypes: { condition: [] },
  system: {
    movement: { speeds: { land: { type: "land", value: 40, base: 40 } } },
    attributes: { hp: { value: 10, max: 10 } },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(movementSpeedProfile.speed, 40);

const hydraProfileFromGeneratedStrike = readActorProfile({
  id: "hydra-reach",
  name: "Hydra Reach",
  type: "npc",
  items: [],
  itemTypes: { condition: [] },
  system: {
    actions: [{
      type: "strike",
      slug: "fangs",
      label: "Fangs",
      item: {
        system: { traits: { value: ["reach-10"] } },
      },
      traits: [{ slug: "attack" }, { slug: "reach-10" }],
    }],
    attributes: {
      speed: { value: 25 },
      hp: { value: 90, max: 90 },
    },
    saves: {},
    skills: {},
    abilities: {},
  },
});
assert.equal(hydraProfileFromGeneratedStrike.reach, 10);
assert.equal(hydraProfileFromGeneratedStrike.meleeReach, 10);

const focusedAssaultFromGeneratedReach = scoreCandidate({
  ...fighterContext,
  profile: hydraProfileFromGeneratedStrike,
  targets: [{
    ...fighterContext.targets[0],
    name: "Valeros",
    distance: 10,
  }],
}, {
  id: "focused-assault",
  name: "Focused Assault",
  slug: "focused-assault",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  activityProfile: {
    includesStrike: true,
    focusedStrike: true,
  },
});
assert.ok(focusedAssaultFromGeneratedReach.score > 100);
assert.equal(focusedAssaultFromGeneratedReach.reason, "Focused Assault focuses attacks on Valeros.");

const displayPlans = [
  { id: "main", summary: "Main" },
  { id: "alt", summary: "Alternative" },
  { id: "third", summary: "Third" },
];
assert.equal(bestAutoFillPlan(displayPlans).id, "main");
assert.equal(selectDisplayPlan(displayPlans, null).id, "main");
assert.equal(selectDisplayPlan(displayPlans, "alt").id, "alt");
assert.equal(selectDisplayPlan(displayPlans, "missing").id, "main");
assert.deepEqual(
  selectableAlternativePlans(displayPlans, displayPlans[1]).map((plan) => plan.id),
  ["main", "third"],
);
assert.deepEqual(autoFillCyclePlans(displayPlans).map((plan) => plan.id), ["main", "alt", "third"]);
assert.equal(nextAutoFillPlan(displayPlans, null).id, "main");
assert.equal(nextAutoFillPlan(displayPlans, "main").id, "alt");
assert.equal(nextAutoFillPlan(displayPlans, "alt").id, "third");
assert.equal(nextAutoFillPlan(displayPlans, "third").id, "main");
assert.equal(previousAutoFillPlan(displayPlans, null).id, "third");
assert.equal(previousAutoFillPlan(displayPlans, "main").id, "third");
assert.equal(previousAutoFillPlan(displayPlans, "alt").id, "main");
assert.equal(previousAutoFillPlan(displayPlans, "third").id, "alt");
const quickenedDisplayPlans = [
  { id: "main", summary: "Main", totalCost: 4, actionBudget: { totalActions: 4 } },
  { id: "short", summary: "Short", totalCost: 2, actionBudget: { totalActions: 4 } },
  { id: "full", summary: "Full", totalCost: 4, actionBudget: { totalActions: 4 } },
  { id: "also-full", summary: "Also Full", totalCost: 4, actionBudget: { totalActions: 4 } },
];
assert.deepEqual(
  selectableAlternativePlans(quickenedDisplayPlans, quickenedDisplayPlans[0]).map((plan) => plan.id),
  ["full", "also-full", "short"],
);
assert.deepEqual(
  selectableAlternativePlans(quickenedDisplayPlans.slice(0, 2), quickenedDisplayPlans[0]).map((plan) => plan.id),
  ["short"],
);
const spellHeavyAlternativePlans = [
  {
    id: "main",
    summary: "Main",
    totalCost: 3,
    score: 500,
    actionBudget: { totalActions: 3 },
    steps: [{ id: "main-spell", source: "spell-inferred", slug: "frostbite" }],
  },
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `spell-alt-${index}`,
    summary: `Spell ${index}`,
    totalCost: 3,
    score: 400 - index,
    steps: [{ id: `spell-${index}`, source: "spell-inferred", slug: `spell-${index}` }],
  })),
  {
    id: "glaive-alt",
    summary: "Glaive",
    totalCost: 1,
    score: 120,
    steps: [{ id: "glaive", source: "strike", slug: "strike" }],
  },
];
assert.ok(
  selectableAlternativePlans(spellHeavyAlternativePlans, spellHeavyAlternativePlans[0])
    .slice(0, 6)
    .some((plan) => plan.id === "glaive-alt"),
);

const stridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ogre",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, { slug: "stride" }, { gridSize: 5 });
assert.equal(stridePreview.enabled, true);
assert.equal(stridePreview.distanceFeet, 25);
assert.equal(stridePreview.recommendedCenter.x, 25);
assert.equal(stridePreview.recommendedCenter.y, 0);

// routeCornerWaypoints keeps only the bends, so a straight route needs no waypoints.
assert.deepEqual(
  routeCornerWaypoints({ x: 0, y: 0 }, [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 0 }]),
  [],
  "a straight route has no corner waypoints",
);
assert.deepEqual(
  routeCornerWaypoints({ x: 0, y: 0 }, [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }]),
  [{ x: 10, y: 0 }],
  "a bent route keeps the corner as a waypoint",
);

// recommendedMovementForStep returns a destination toward the target (pixel coords).
const autoMovement = recommendedMovementForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Ogre", token: { center: { x: 100, y: 0 } }, distance: 100 }] },
}, { slug: "stride" });
assert.ok(autoMovement && autoMovement.destination.x > 0, "auto-fill recommends a stride destination toward the target");
assert.equal(autoMovement.destination.y, 0, "the recommended stride stays on the line to the target");
assert.equal(autoMovement.waypoints, undefined, "a straight recommended route needs no waypoints");

const standStridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ogre",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, { slug: "stand-stride" }, { gridSize: 5 });
assert.equal(standStridePreview.enabled, true);
assert.equal(standStridePreview.distanceFeet, 25);
assert.equal(standStridePreview.recommendedCenter.x, 25);
assert.equal(standStridePreview.recommendedCenter.y, 0);

const combatOnlyStridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      id: "combat-target",
      name: "Combat Target",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, {
  slug: "stride",
  preferredTarget: {
    id: "off-combat-target",
    name: "Off Combat Target",
    token: { center: { x: -100, y: 0 } },
    distance: 100,
  },
}, { gridSize: 5 });
assert.equal(combatOnlyStridePreview.enabled, true);
assert.equal(combatOnlyStridePreview.recommendedCenter.x, 25);
assert.equal(combatOnlyStridePreview.recommendedCenter.y, 0);

const wallAwareStridePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ogre",
      token: { center: { x: 100, y: 0 } },
      distance: 100,
    }],
  },
}, { slug: "stride" }, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 25 && to.y === 0,
});
assert.equal(wallAwareStridePreview.enabled, true);
assert.notDeepEqual(wallAwareStridePreview.recommendedCenter, { x: 25, y: 0 });
assert.ok(!wallAwareStridePreview.reachableCenters.some((center) => center.x === 25 && center.y === 0));

const explicitMovementPreview = movementPreviewForStep({
  token: { id: "token-moving", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{ name: "Decoy", token: { center: { x: 25, y: 0 } }, distance: 25 }],
  },
}, {
  slug: "stride",
  actionCost: 1,
  destination: { x: 10, y: 0 },
}, {
  gridSize: 5,
  pathBlocked: () => false,
  pointVisible: () => true,
});
assert.equal(explicitMovementPreview.enabled, true);
assert.equal(explicitMovementPreview.destinationAvailable, true);
assert.equal(explicitMovementPreview.destinationCenter.x, 10);
assert.equal(explicitMovementPreview.destinationCenter.y, 0);
assert.equal(explicitMovementPreview.recommendedCenter.x, 10);
assert.equal(explicitMovementPreview.stridePath.length, 1);
assert.deepEqual(explicitMovementPreview.stridePath[0].trail.map((point) => [point.x, point.y]), [[5, 0], [10, 0]]);

const blockedExplicitMovementPreview = movementPreviewForStep({
  token: { id: "token-moving", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{ name: "Fallback Target", token: { center: { x: -25, y: 0 } }, distance: 25 }],
  },
}, {
  slug: "stride",
  actionCost: 1,
  destination: { x: 10, y: 0 },
}, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 10 && to.y === 0,
  pointVisible: () => true,
});
assert.equal(blockedExplicitMovementPreview.enabled, true);
assert.equal(blockedExplicitMovementPreview.destinationAvailable, false);
assert.equal(blockedExplicitMovementPreview.destinationCenter.x, 10);
assert.equal(blockedExplicitMovementPreview.recommendedCenter, null);
assert.equal(blockedExplicitMovementPreview.stridePath.length, 0);
assert.ok(blockedExplicitMovementPreview.destinationPlacement);
assert.ok(blockedExplicitMovementPreview.destinationMarker);
assert.match(blockedExplicitMovementPreview.destinationIllegalReason, /movement path/i);

// A teleport (Translocate) gets a range-bounded preview: squares within the spell's range plus the
// chosen destination, with no stride path. In-range destinations are available; beyond-range aren't.
const teleportRangePreview = movementPreviewForStep({
  token: { id: "token-tp", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
}, {
  slug: "translocate",
  activityProfile: { teleport: true },
  targetingProfile: { self: true, maxRange: 30 },
  destination: { x: 15, y: 0 },
}, { gridSize: 5, pointVisible: () => true });
assert.equal(teleportRangePreview.enabled, true);
assert.equal(teleportRangePreview.teleport, true, "a teleport should get its own range-bounded preview");
assert.equal(teleportRangePreview.teleportRange, 30, "the teleport range ring should match the spell's range");
assert.equal(teleportRangePreview.destinationAvailable, true, "an in-range teleport destination is available");
assert.ok(teleportRangePreview.destinationPlacement, "a teleport should mark the chosen destination");

const farTeleportPreview = movementPreviewForStep({
  token: { id: "token-tp", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
}, {
  slug: "translocate",
  activityProfile: { teleport: true },
  targetingProfile: { self: true, maxRange: 30 },
  destination: { x: 50, y: 0 },
}, { gridSize: 5, pointVisible: () => true });
assert.equal(farTeleportPreview.destinationAvailable, false, "a teleport beyond the spell's range is unavailable");
assert.match(farTeleportPreview.destinationIllegalReason, /range/i);

const hiddenExplicitMovementPreview = movementPreviewForStep({
  token: { id: "token-moving", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{ name: "Fallback Target", token: { center: { x: -25, y: 0 } }, distance: 25 }],
  },
}, {
  slug: "stride",
  actionCost: 1,
  destination: { x: 10, y: 0 },
}, {
  gridSize: 5,
  pathBlocked: () => false,
  pointVisible: (point) => point.x !== 10 || point.y !== 0,
});
assert.equal(hiddenExplicitMovementPreview.enabled, true);
assert.equal(hiddenExplicitMovementPreview.destinationAvailable, false);
assert.equal(hiddenExplicitMovementPreview.destinationIllegalReason, "Destination is not visible.");
assert.equal(hiddenExplicitMovementPreview.destinationPlacement, null);
assert.equal(hiddenExplicitMovementPreview.destinationMarker, null);
assert.equal(hiddenExplicitMovementPreview.recommendedCenter, null);
assert.equal(hiddenExplicitMovementPreview.recommendedPlacement, null);
assert.equal(hiddenExplicitMovementPreview.recommendedMarker, null);
assert.deepEqual(hiddenExplicitMovementPreview.stridePath, []);
assert.deepEqual(hiddenExplicitMovementPreview.reachableCenters, []);
assert.deepEqual(hiddenExplicitMovementPreview.reachablePlacements, []);
assert.deepEqual(hiddenExplicitMovementPreview.reachableMarkers, []);

const overBudgetWaypointPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 0, y: 20 },
  movementPlan: {
    native: false,
    waypoints: [{ x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  },
}, { gridSize: 5 });
assert.equal(overBudgetWaypointPreview.enabled, true);
assert.equal(overBudgetWaypointPreview.explicitDestination, true);
assert.equal(overBudgetWaypointPreview.destinationAvailable, false);
assert.equal(overBudgetWaypointPreview.destinationIllegalReason, "Waypoint path is beyond movement range.");
assert.deepEqual(overBudgetWaypointPreview.stridePath, []);

const partialWaypointPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 10, y: 0 },
  movementPlan: {
    native: false,
    waypoints: [{ x: 10, y: 0 }],
  },
}, { gridSize: 5 });
assert.equal(partialWaypointPreview.enabled, true);
assert.equal(partialWaypointPreview.destinationAvailable, true);
assert.ok(
  partialWaypointPreview.reachableMarkers.length > 0,
  "custom waypoint preview should keep reachable grid highlights after setting a waypoint",
);
assert.deepEqual(partialWaypointPreview.segmentLabels, [{
  text: "10 ft",
  from: { x: 0, y: 0 },
  to: { x: 10, y: 0 },
  center: { x: 5, y: 0 },
}]);

const cumulativeWaypointPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 10, y: 10 },
  movementPlan: {
    native: false,
    waypoints: [{ x: 10, y: 0 }, { x: 10, y: 10 }],
  },
}, { gridSize: 5 });
assert.deepEqual(
  cumulativeWaypointPreview.segmentLabels.map((label) => label.text),
  ["10 ft", "20 ft"],
  "waypoint distance labels should show cumulative path distance",
);

const diagonalWaypointPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 10, y: 10 },
  movementPlan: {
    native: false,
    waypoints: [{ x: 5, y: 5 }, { x: 10, y: 10 }],
  },
}, { gridSize: 5 });
assert.deepEqual(
  diagonalWaypointPreview.segmentLabels.map((label) => label.text),
  ["5 ft", "15 ft"],
  "PF2e diagonal movement should alternate 5 ft, then 10 ft, cumulatively",
);

const shortDiagonalPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 10 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 10, y: 10 },
}, { gridSize: 5 });
assert.equal(shortDiagonalPreview.destinationAvailable, false);
assert.equal(shortDiagonalPreview.destinationIllegalReason, "Destination is beyond movement range.");

const shortDiagonalReachablePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 10 } },
  battlefield: { targets: [] },
}, { slug: "stride" }, { gridSize: 5 });
assert.equal(
  shortDiagonalReachablePreview.reachableCenters.some((center) => center.x === 10 && center.y === 10),
  false,
  "reachable grid highlights should respect PF2e 5-10-5 diagonal movement",
);

const pf2eDifficultTerrainRegion = {
  shapes: [{ type: "rectangle", x: 7.5, y: -2.5, width: 5, height: 5 }],
  behaviors: [{
    type: "modifyMovementCost",
    system: { difficulties: { walk: 2, step: 1, crawl: 2 } },
  }],
};
const pf2eDifficultTerrainPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 10 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 10, y: 0 },
}, {
  gridSize: 5,
  regions: [pf2eDifficultTerrainRegion],
});
assert.equal(pf2eDifficultTerrainPreview.destinationAvailable, false);
assert.equal(
  pf2eDifficultTerrainPreview.destinationIllegalReason,
  "Destination is beyond movement range.",
  "PF2e difficult terrain behavior should make the entered square cost extra movement",
);
assert.equal(
  movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 10 } },
    battlefield: { targets: [] },
  }, { slug: "stride" }, { gridSize: 5, regions: [pf2eDifficultTerrainRegion] })
    .reachableCenters.some((center) => center.x === 10 && center.y === 0),
  false,
  "reachable grid highlights should account for PF2e difficult terrain cost",
);
assert.equal(
  movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 5 } },
    battlefield: { targets: [] },
  }, {
    slug: "step",
    destination: { x: 5, y: 0 },
  }, { gridSize: 5, regions: [pf2eDifficultTerrainRegion] }).destinationAvailable,
  true,
  "PF2e terrain behavior should use action-specific difficulties, so Step ignores walk-only difficult terrain",
);
const pf2eGreaterTerrainRegion = {
  shapes: [{ type: "rectangle", x: 2.5, y: -2.5, width: 5, height: 5 }],
  behaviors: [{
    type: "modifyMovementCost",
    system: { difficulties: { walk: 3 } },
  }],
};
const pf2eGreaterTerrainPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: {
    profile: { speed: 10 },
    system: {
      movement: {
        terrain: {
          difficult: { ignored: [{ environment: "all", feature: "all" }] },
          greater: { ignored: [] },
        },
      },
    },
  },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  destination: { x: 5, y: 0 },
  movementPlan: { native: false, waypoints: [{ x: 5, y: 0 }] },
}, { gridSize: 5, regions: [pf2eGreaterTerrainRegion] });
assert.deepEqual(
  pf2eGreaterTerrainPreview.segmentLabels.map((label) => label.text),
  ["10 ft"],
  "PF2e greater difficult terrain should use system mitigation math, not a generic multiplier",
);

const previousMovementColorGame = globalThis.game;
try {
  globalThis.game = { user: { color: "#ff3366" } };
  const playerColorMovementPreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [] },
  }, {
    slug: "stride",
    destination: { x: 10, y: 0 },
  }, { gridSize: 5 });
  assert.equal(playerColorMovementPreview.destinationAvailable, true);
  assert.equal(
    playerColorMovementPreview.stridePath[0].color,
    0xff3366,
    "planned movement path should use the current user's Foundry color",
  );
  assert.equal(
    playerColorMovementPreview.reachableMarkerColor,
    0xff3366,
    "planned movement grid highlights should use the current user's Foundry color",
  );
} finally {
  globalThis.game = previousMovementColorGame;
}

const previousDestinationPickerCanvas = globalThis.canvas;
try {
  delete globalThis.canvas;
  assert.equal(chooseDestination({ onChoose: () => assert.fail("headless picker must not choose") }), null);
  assert.doesNotThrow(() => cancelDestinationPicker());

  const nativeRulerPlanCalls = [];
  const nativeRulerDestinations = [];
  const nativeRulerTokenEvents = [];
  let nativeRulerTokenControlled = false;
  globalThis.canvas = {
    grid: { size: 10 },
    tokens: {
      placeables: [{
        id: "actor-token",
        document: { id: "actor-token", width: 1, height: 1 },
        layer: {
          activate: ({ tool } = {}) => nativeRulerTokenEvents.push({ control: "tokens-layer", tool }),
        },
        actor: { system: { movement: { speeds: { land: { value: 25, step: 5, crawl: 5 } } } } },
        control: (options = {}) => {
          nativeRulerTokenControlled = true;
          nativeRulerTokenEvents.push({ control: "token", options });
        },
        planMovement: async (options) => {
          assert.equal(nativeRulerTokenControlled, true, "native ruler planning should control the token before planMovement");
          nativeRulerPlanCalls.push(options);
          return {
            id: "planned-move",
            origin: { x: 0, y: 0, width: 1, height: 1 },
            destination: { x: 10, y: 20, width: 1, height: 1 },
            waypoints: [{ x: 10, y: 20, width: 1, height: 1, action: "walk" }],
          };
        },
      }],
    },
  };
  const nativeRulerPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    useNativeRuler: true,
    onChoose: (destination, metadata) => nativeRulerDestinations.push({ destination, metadata }),
  });
  assert.ok(nativeRulerPicker);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(nativeRulerTokenEvents, [
    { control: "tokens-layer", tool: "select" },
    { control: "token", options: { releaseOthers: true } },
  ]);
  assert.deepEqual(nativeRulerPlanCalls.at(-1), {
    allowedActions: ["walk"],
    maxDistance: 25,
    maxCost: 25,
    preventDrop: true,
  });
  assert.deepEqual(nativeRulerDestinations, [{
    destination: { x: 15, y: 25 },
    metadata: {
      movementPlan: {
        id: "planned-move",
        origin: { x: 0, y: 0, width: 1, height: 1 },
        destination: { x: 10, y: 20, width: 1, height: 1 },
        waypoints: [{ x: 10, y: 20, width: 1, height: 1, action: "walk" }],
      },
    },
  }]);
  cancelDestinationPicker();

  nativeRulerTokenControlled = false;
  nativeRulerTokenEvents.length = 0;
  const nativeStepPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Step", slug: "step" },
    useNativeRuler: true,
    onChoose: () => { },
  });
  assert.ok(nativeStepPicker);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(nativeRulerPlanCalls.at(-1), {
    allowedActions: ["walk"],
    maxDistance: 5,
    maxCost: 5,
    preventDrop: true,
  }, "native Step planning should use Foundry's walk movement mode capped to one square");
  cancelDestinationPicker();

  let pointerHandler = null;
  let pointerRemoved = false;
  globalThis.canvas = {
    grid: { size: 10 },
    tokens: {
      placeables: [{
        id: "actor-token",
        document: { id: "actor-token", width: 1, height: 1 },
        planMovement: () => assert.fail("destination click picker should not use token.planMovement by default"),
      }],
    },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        pointerHandler = handler;
      },
      off: (event, handler) => {
        assert.equal(event, "pointerdown");
        assert.equal(handler, pointerHandler);
        pointerRemoved = true;
        pointerHandler = null;
      },
    },
  };
  const chosenDestinations = [];
  const suppressed = [];
  const picker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    onChoose: (destination) => chosenDestinations.push(destination),
  });
  assert.ok(picker);
  assert.equal(picker.native, undefined);
  assert.equal(typeof pointerHandler, "function");
  pointerHandler({
    button: 2,
    global: { x: 12, y: 18 },
    preventDefault: () => suppressed.push("secondary-default"),
    stopPropagation: () => suppressed.push("secondary-propagation"),
  });
  assert.deepEqual(chosenDestinations, []);
  assert.deepEqual(suppressed, []);
  assert.equal(pointerRemoved, false);
  assert.equal(typeof pointerHandler, "function");
  pointerHandler({
    button: 0,
    global: { x: 12, y: 18 },
    preventDefault: () => suppressed.push("primary-default"),
    stopPropagation: () => suppressed.push("primary-propagation"),
  });
  assert.deepEqual(chosenDestinations, [{ x: 15, y: 15 }]);
  assert.deepEqual(suppressed, ["primary-default", "primary-propagation"]);
  assert.equal(pointerRemoved, true);
  assert.equal(pointerHandler, null);

  let projectedOriginPointerHandler = null;
  const projectedOriginWarnings = [];
  globalThis.ui = { notifications: { warn: (message) => projectedOriginWarnings.push(message) } };
  globalThis.canvas = {
    grid: { size: 10 },
    scene: { grid: { distance: 5 } },
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 5, y: 5 },
        document: { id: "actor-token", width: 1, height: 1 },
        actor: { system: { movement: { speeds: { land: { value: 25, step: 5, crawl: 5 } } } } },
      }],
    },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        projectedOriginPointerHandler = handler;
      },
      off: () => {
        projectedOriginPointerHandler = null;
      },
    },
  };
  const projectedOriginDestinations = [];
  const projectedOriginPicker = chooseDestination({
    context: { token: { id: "actor-token", center: { x: 105, y: 5 }, plannedCenter: { x: 105, y: 5 } } },
    action: { name: "Step", slug: "step" },
    enableWaypoints: true,
    onChoose: (destination, metadata) => projectedOriginDestinations.push({ destination, metadata }),
  });
  assert.ok(projectedOriginPicker);
  projectedOriginPointerHandler({
    button: 0,
    global: { x: 112, y: 8 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(projectedOriginWarnings, []);
  assert.deepEqual(projectedOriginDestinations, [{
    destination: { x: 115, y: 5 },
    metadata: {},
  }], "Step after a planned Stride should measure from projected draft origin instead of actual token position");

  let waypointPointerHandler = null;
  let waypointPointerRemoved = false;
  const waypointWarnings = [];
  const previousDestinationUi = globalThis.ui;
  globalThis.ui = { notifications: { warn: (message) => waypointWarnings.push(message) } };
  globalThis.canvas = {
    grid: { size: 10 },
    scene: { grid: { distance: 5 } },
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 5, y: 5 },
        document: { id: "actor-token", width: 1, height: 1 },
        actor: { system: { movement: { speeds: { land: { value: 15 } } } } },
        planMovement: () => assert.fail("custom waypoint picker must not use token.planMovement"),
      }],
    },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        waypointPointerHandler = handler;
      },
      off: (event, handler) => {
        assert.equal(event, "pointerdown");
        assert.equal(handler, waypointPointerHandler);
        waypointPointerRemoved = true;
        waypointPointerHandler = null;
      },
    },
  };
  const waypointDestinations = [];
  const waypointPreviews = [];
  const waypointPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onPreview: (destination, metadata) => waypointPreviews.push({ destination, metadata }),
    onChoose: (destination, metadata) => waypointDestinations.push({ destination, metadata }),
  });
  assert.ok(waypointPicker);
  assert.equal(typeof waypointPointerHandler, "function");
  waypointPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(waypointDestinations, []);
  assert.equal(waypointPointerRemoved, false);
  assert.deepEqual(waypointPreviews.at(-1), {
    destination: { x: 15, y: 15 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 15 }],
        cost: 5,
        maxCost: 15,
      },
    },
  });
  waypointPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 45, y: 15 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(waypointDestinations, []);
  assert.equal(waypointWarnings.at(-1), "Destination is beyond movement range.");
  assert.deepEqual(waypointPreviews.at(-1).metadata.movementPlan.waypoints, [{ x: 15, y: 15 }]);
  waypointPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 22, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(waypointPreviews.at(-1), {
    destination: { x: 25, y: 15 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 15 }, { x: 25, y: 15 }],
        cost: 10,
        maxCost: 15,
      },
    },
  });
  waypointPointerHandler({
    button: 2,
    shiftKey: true,
    global: { x: 22, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(waypointDestinations, []);
  assert.deepEqual(waypointPreviews.at(-1), {
    destination: { x: 15, y: 15 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 15 }],
        cost: 5,
        maxCost: 15,
      },
    },
  }, "shift-right-click should remove the last waypoint and keep picker active");
  waypointPointerHandler({
    button: 0,
    global: { x: 22, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(waypointDestinations, [{
    destination: { x: 25, y: 15 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 15 }, { x: 25, y: 15 }],
        cost: 10,
        maxCost: 15,
      },
    },
  }]);
  assert.equal(waypointPointerRemoved, true);

  // A flying Stride stamps the target elevation (here just the token's current elevation, since no
  // scroll happened) onto the chosen destination so the executor can apply it. A walking Stride
  // never carries an elevation.
  let verticalPointerHandler = null;
  globalThis.ui = { notifications: { warn: () => { }, info: () => { } } };
  globalThis.canvas = {
    grid: { size: 10 },
    scene: { grid: { distance: 5 } },
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 5, y: 5 },
        document: { id: "actor-token", width: 1, height: 1, elevation: 10 },
        actor: { system: { movement: { speeds: { land: { value: 25 }, fly: { value: 30 } } } } },
      }],
    },
    stage: {
      on: (event, handler) => { if (event === "pointerdown") verticalPointerHandler = handler; },
      off: () => { verticalPointerHandler = null; },
    },
  };
  const verticalDestinations = [];
  const verticalPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride", movementAction: "fly" },
    enableWaypoints: true,
    onChoose: (destination, metadata) => verticalDestinations.push({ destination, metadata }),
  });
  assert.ok(verticalPicker);
  verticalPointerHandler({
    button: 0,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(verticalDestinations, [{
    destination: { x: 15, y: 15, elevation: 10 },
    metadata: { elevation: 10 },
  }], "a fly Stride should stamp the target elevation onto the destination");

  let diagonalCostPointerHandler = null;
  const diagonalCostWarnings = [];
  globalThis.ui = { notifications: { warn: (message) => diagonalCostWarnings.push(message) } };
  globalThis.canvas = {
    grid: { size: 10 },
    scene: { grid: { distance: 5 } },
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 5, y: 5 },
        document: { id: "actor-token", width: 1, height: 1 },
        actor: { system: { movement: { speeds: { land: { value: 10 } } } } },
      }],
    },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        diagonalCostPointerHandler = handler;
      },
      off: () => {
        diagonalCostPointerHandler = null;
      },
    },
  };
  const diagonalCostPreviews = [];
  const diagonalCostPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onPreview: (destination, metadata) => diagonalCostPreviews.push({ destination, metadata }),
    onChoose: () => assert.fail("over-budget diagonal waypoint should not finalize"),
  });
  assert.ok(diagonalCostPicker);
  diagonalCostPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  diagonalCostPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 22, y: 28 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.equal(diagonalCostWarnings.at(-1), "Destination is beyond movement range.");
  assert.deepEqual(
    diagonalCostPreviews.at(-1).metadata.movementPlan,
    {
      native: false,
      waypoints: [{ x: 15, y: 15 }],
      cost: 5,
      maxCost: 10,
    },
    "waypoint picker range budget should use PF2e 5-10-5 diagonal movement",
  );

  let terrainCostPointerHandler = null;
  const terrainCostWarnings = [];
  globalThis.ui = { notifications: { warn: (message) => terrainCostWarnings.push(message) } };
  globalThis.canvas = {
    grid: { size: 10 },
    scene: {
      grid: { distance: 5 },
      regions: [{
        shapes: [{ type: "rectangle", x: 20, y: 10, width: 10, height: 10 }],
        behaviors: [{
          type: "modifyMovementCost",
          system: { difficulties: { walk: 2 } },
        }],
      }],
    },
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 5, y: 15 },
        document: { id: "actor-token", width: 1, height: 1 },
        actor: { system: { movement: { speeds: { land: { value: 10 } } } } },
      }],
    },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        terrainCostPointerHandler = handler;
      },
      off: () => {
        terrainCostPointerHandler = null;
      },
    },
  };
  const terrainCostPreviews = [];
  const terrainCostPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onPreview: (destination, metadata) => terrainCostPreviews.push({ destination, metadata }),
    onChoose: () => assert.fail("over-budget difficult-terrain waypoint should not finalize"),
  });
  assert.ok(terrainCostPicker);
  terrainCostPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  terrainCostPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 22, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.equal(terrainCostWarnings.at(-1), "Destination is beyond movement range.");
  assert.deepEqual(
    terrainCostPreviews.at(-1).metadata.movementPlan,
    {
      native: false,
      waypoints: [{ x: 15, y: 15 }],
      cost: 5,
      maxCost: 10,
    },
    "waypoint picker range budget should include PF2e difficult terrain behavior cost",
  );

  let doubleClickPointerHandler = null;
  let doubleClickPointerRemoved = false;
  globalThis.canvas.tokens.placeables[0].actor.system.movement.speeds.land.value = 15;
  globalThis.canvas.scene.regions = [];
  globalThis.canvas.stage = {
    on: (event, handler) => {
      assert.equal(event, "pointerdown");
      doubleClickPointerHandler = handler;
    },
    off: (event, handler) => {
      assert.equal(event, "pointerdown");
      assert.equal(handler, doubleClickPointerHandler);
      doubleClickPointerRemoved = true;
      doubleClickPointerHandler = null;
    },
  };
  const doubleClickDestinations = [];
  const doubleClickPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onChoose: (destination, metadata = {}) => doubleClickDestinations.push({ destination, metadata }),
  });
  assert.ok(doubleClickPicker);
  doubleClickPointerHandler({
    button: 0,
    shiftKey: true,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(doubleClickDestinations, []);
  doubleClickPointerHandler({
    button: 0,
    detail: 2,
    shiftKey: true,
    global: { x: 22, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(doubleClickDestinations, [{
    destination: { x: 25, y: 15 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 15 }, { x: 25, y: 15 }],
        cost: 10,
        maxCost: 15,
      },
    },
  }], "shift-double-click should add the final waypoint and finalize the path");
  assert.equal(doubleClickPointerRemoved, true);

  let directWaypointPointerHandler = null;
  globalThis.canvas.stage = {
    on: (event, handler) => {
      assert.equal(event, "pointerdown");
      directWaypointPointerHandler = handler;
    },
    off: () => {
      directWaypointPointerHandler = null;
    },
  };
  const directWaypointDestinations = [];
  const directWaypointPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onChoose: (destination, metadata = {}) => directWaypointDestinations.push({ destination, metadata }),
  });
  assert.ok(directWaypointPicker);
  directWaypointPointerHandler({
    button: 0,
    global: { x: 12, y: 18 },
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(directWaypointDestinations, [{
    destination: { x: 15, y: 15 },
    metadata: {},
  }], "one-click destination should not store custom waypoint data unless a waypoint was added");
  globalThis.ui = previousDestinationUi;

  let domPointerHandler = null;
  let domPointerUpHandler = null;
  let domClickHandler = null;
  let domDoubleClickHandler = null;
  let domContextHandler = null;
  let domPointerOptions = null;
  let domPointerRemoved = false;
  let domPointerUpRemoved = false;
  let domClickRemoved = false;
  let domDoubleClickRemoved = false;
  let domContextRemoved = false;
  const destinationCanvasView = {
    addEventListener: (event, handler, options) => {
      if (event === "pointerdown") {
        domPointerHandler = handler;
        domPointerOptions = options;
      } else if (event === "pointerup") {
        domPointerUpHandler = handler;
      } else if (event === "click") {
        domClickHandler = handler;
      } else if (event === "dblclick") {
        domDoubleClickHandler = handler;
      } else if (event === "contextmenu") {
        domContextHandler = handler;
      } else {
        assert.fail(`unexpected destination picker event listener: ${event}`);
      }
    },
    removeEventListener: (event, handler) => {
      if (event === "pointerdown") {
        assert.equal(handler, domPointerHandler);
        domPointerRemoved = true;
        domPointerHandler = null;
      } else if (event === "pointerup") {
        assert.equal(handler, domPointerUpHandler);
        domPointerUpRemoved = true;
        domPointerUpHandler = null;
      } else if (event === "click") {
        assert.equal(handler, domClickHandler);
        domClickRemoved = true;
        domClickHandler = null;
      } else if (event === "dblclick") {
        assert.equal(handler, domDoubleClickHandler);
        domDoubleClickRemoved = true;
        domDoubleClickHandler = null;
      } else if (event === "contextmenu") {
        assert.equal(handler, domContextHandler);
        domContextRemoved = true;
        domContextHandler = null;
      } else {
        assert.fail(`unexpected destination picker event cleanup: ${event}`);
      }
    },
    setPointerCapture: (id) => {
      assert.ok([7, 9].includes(id));
    },
    releasePointerCapture: (id) => {
      assert.ok([7, 9].includes(id));
    },
  };
  const ignoredStageHandlers = [];
  globalThis.canvas = {
    app: { view: destinationCanvasView },
    grid: { size: 10 },
    stage: {
      on: (event, handler) => {
        assert.equal(event, "pointerdown");
        ignoredStageHandlers.push(handler);
      },
      off: () => { },
    },
    canvasCoordinatesFromClient: ({ x, y }) => ({ x: x - 100, y: y - 50 }),
  };
  const domDestinations = [];
  const domSuppressed = [];
  const domPicker = chooseDestination({
    onChoose: (destination) => domDestinations.push(destination),
  });
  assert.ok(domPicker);
  assert.equal(domPointerOptions?.capture, true);
  assert.equal(typeof domPointerHandler, "function");
  assert.equal(typeof domPointerUpHandler, "function");
  assert.equal(typeof domContextHandler, "function");
  domPointerHandler({
    button: 0,
    pointerId: 7,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 86,
    preventDefault: () => domSuppressed.push("down-default"),
    stopPropagation: () => domSuppressed.push("down-propagation"),
    stopImmediatePropagation: () => domSuppressed.push("down-immediate"),
  });
  assert.deepEqual(domDestinations, []);
  assert.deepEqual(domSuppressed, ["down-default", "down-propagation", "down-immediate"]);
  assert.equal(domPointerRemoved, false);
  domPointerUpHandler({
    button: 0,
    pointerId: 7,
    target: { nodeType: 1, contains: () => false },
    clientX: 124,
    clientY: 86,
    preventDefault: () => domSuppressed.push("up-default"),
    stopPropagation: () => domSuppressed.push("up-propagation"),
    stopImmediatePropagation: () => domSuppressed.push("up-immediate"),
  });
  assert.deepEqual(domDestinations, [{ x: 25, y: 35 }]);
  assert.deepEqual(domSuppressed, [
    "down-default",
    "down-propagation",
    "down-immediate",
    "up-default",
    "up-propagation",
    "up-immediate",
  ]);
  assert.equal(domPointerRemoved, true);
  assert.equal(domPointerUpRemoved, true);
  assert.equal(domClickRemoved, true);
  assert.equal(domContextRemoved, true);
  assert.equal(domPointerHandler, null);

  domPointerHandler = null;
  domPointerUpHandler = null;
  domClickHandler = null;
  domDoubleClickHandler = null;
  domContextHandler = null;
  domPointerRemoved = false;
  domPointerUpRemoved = false;
  domClickRemoved = false;
  domDoubleClickRemoved = false;
  domContextRemoved = false;
  globalThis.canvas.tokens = {
    placeables: [{
      id: "actor-token",
      center: { x: 5, y: 5 },
      document: { id: "actor-token", width: 1, height: 1 },
      actor: { system: { movement: { speeds: { land: { value: 25 } } } } },
    }],
  };
  const domWaypointDestinations = [];
  const domWaypointPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onChoose: (destination, metadata = {}) => domWaypointDestinations.push({ destination, metadata }),
  });
  assert.ok(domWaypointPicker);
  domPointerHandler({
    button: 0,
    detail: 1,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 114,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  domPointerUpHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 114,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  assert.deepEqual(domWaypointDestinations, []);
  assert.equal(domPointerRemoved, false);
  domPointerHandler({
    button: 0,
    detail: 2,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  domPointerUpHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  assert.deepEqual(domWaypointDestinations, [{
    destination: { x: 25, y: 5 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 5 }, { x: 25, y: 5 }],
        cost: 10,
        maxCost: 25,
      },
    },
  }], "DOM shift-double-click should finalize a waypoint path even when pointerup loses click count");
  assert.equal(domPointerRemoved, true);
  assert.equal(domPointerUpRemoved, true);
  assert.equal(domClickRemoved, true);
  assert.equal(domContextRemoved, true);

  domPointerHandler = null;
  domPointerUpHandler = null;
  domClickHandler = null;
  domDoubleClickHandler = null;
  domContextHandler = null;
  domPointerRemoved = false;
  domPointerUpRemoved = false;
  domClickRemoved = false;
  domDoubleClickRemoved = false;
  domContextRemoved = false;
  const domDblClickDestinations = [];
  const domDblClickPicker = chooseDestination({
    context: { token: { id: "actor-token" } },
    action: { name: "Stride", slug: "stride" },
    enableWaypoints: true,
    onChoose: (destination, metadata = {}) => domDblClickDestinations.push({ destination, metadata }),
  });
  assert.ok(domDblClickPicker);
  assert.equal(typeof domDoubleClickHandler, "function");
  domPointerHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 114,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  domPointerUpHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 114,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  domPointerHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  domPointerUpHandler({
    button: 0,
    shiftKey: true,
    pointerId: 9,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  assert.deepEqual(domDblClickDestinations, []);
  domDoubleClickHandler({
    detail: 2,
    shiftKey: true,
    target: destinationCanvasView,
    clientX: 124,
    clientY: 56,
    preventDefault: () => { },
    stopPropagation: () => { },
    stopImmediatePropagation: () => { },
  });
  assert.deepEqual(domDblClickDestinations, [{
    destination: { x: 25, y: 5 },
    metadata: {
      movementPlan: {
        native: false,
        waypoints: [{ x: 15, y: 5 }, { x: 25, y: 5 }],
        cost: 10,
        maxCost: 25,
      },
    },
  }], "DOM dblclick should finalize the existing waypoint path without duplicating the final point");
  assert.equal(domPointerRemoved, true);
  assert.equal(domPointerUpRemoved, true);
  assert.equal(domClickRemoved, true);
  assert.equal(domDoubleClickRemoved, true);
  assert.equal(domContextRemoved, true);
} finally {
  cancelDestinationPicker();
  globalThis.canvas = previousDestinationPickerCanvas;
}

const previousAreaPickerCanvas = globalThis.canvas;
const previousAreaPickerGame = globalThis.game;
const previousAreaPickerUi = globalThis.ui;
const previousAreaPickerConsoleWarn = globalThis.console?.warn;
try {
  delete globalThis.canvas;
  assert.equal(chooseAreaMarker({ onChoose: () => assert.fail("headless area picker must not choose") }), null);
  assert.doesNotThrow(() => cancelAreaPicker());

  let nativePlacement = null;
  let nativePlacementCancelled = false;
  const nativeShape = { type: "cone", x: 40, y: 60, radius: 30, angle: 90, rotation: 25 };
  globalThis.game = {
    user: {
      id: "user-1",
      color: { toString: () => "#123456" },
    },
  };
  globalThis.canvas = {
    dimensions: { distance: 5, distancePixels: 2 },
    grid: { size: 10, distance: 5 },
    mousePosition: { x: 30, y: 40 },
    level: { id: "level-1" },
    tokens: {
      active: true,
      placeables: [{ id: "caster-token", center: { x: 0, y: 0 } }],
      activate: ({ tool } = {}) => {
        nativeControlEvents.push({ control: "tokens-layer", tool });
        globalThis.canvas.tokens.active = true;
        globalThis.canvas.regions.active = false;
      },
    },
    regions: {
      active: false,
      activate: ({ tool } = {}) => {
        nativeControlEvents.push({ control: "regions-layer", tool });
        globalThis.canvas.regions.active = true;
        globalThis.canvas.tokens.active = false;
      },
      placeRegion: (data, options = {}) => {
        assert.equal(globalThis.canvas.tokens.active, false, "native region placement should not start while token layer is active");
        assert.equal(globalThis.canvas.regions.active, true, "native region placement should start from active region layer");
        nativePlacement = { data, options };
        options.onChange?.({
          document: { shapes: [{ toObject: () => nativeShape }] },
          shape: nativeShape,
        });
        return new Promise((resolve) => {
          nativePlacement.resolve = resolve;
        });
      },
      _cancelPlacement: () => {
        nativePlacementCancelled = true;
      },
    },
  };
  const nativeAreas = [];
  const nativeControlEvents = [];
  globalThis.ui = {
    controls: {
      activate: async (options) => {
        nativeControlEvents.push(options);
      },
    },
  };
  const nativePicker = chooseAreaMarker({
    context: { token: { id: "caster-token", center: { x: 0, y: 0 } } },
    action: { name: "Breathe Fire", targetingProfile: { type: "cone", distance: 15, width: 5 } },
    onChoose: (marker) => nativeAreas.push(marker),
  });
  assert.ok(nativePicker);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(nativePlacement.data.color, "#123456");
  assert.equal(nativePlacement.data.highlightMode, "coverage");
  assert.equal(nativePlacement.data.displayMeasurements, true);
  assert.deepEqual(nativePlacement.data.levels, ["level-1"]);
  assert.equal(nativePlacement.data.shapes[0].type, "cone");
  assert.equal(nativePlacement.data.shapes[0].radius, 30);
  assert.equal(
    Object.hasOwn(nativePlacement.data.flags.pf2e, "origin"),
    false,
    "planner template regions should not include invalid null PF2e origin flag",
  );
  assert.equal(nativePlacement.options.create, false);
  assert.equal(typeof nativePlacement.options.onChange, "function");
  assert.equal(typeof nativePlacement.options.preConfirm, "function");
  assert.deepEqual(nativeAreas, []);
  assert.equal(nativePlacementCancelled, false);
  assert.deepEqual(
    nativeControlEvents,
    [{ control: "regions", tool: "cone" }, { control: "regions-layer", tool: "cone" }],
    "native area placement should stay on Region cone tool until placement is confirmed",
  );

  nativePlacement.options.preConfirm({
    document: { shapes: [{ toObject: () => nativeShape }] },
    shape: nativeShape,
  });
  nativePlacement.resolve({ shapes: [{ toObject: () => nativeShape }] });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(nativeAreas, [{
    shape: "cone",
    center: { x: 40, y: 60 },
    distance: 15,
    width: 5,
    rotation: 25,
    originTokenId: "caster-token",
    label: "Cone 15 ft",
  }]);
  assert.equal(nativePlacementCancelled, false);
  assert.deepEqual(
    nativeControlEvents,
    [
      { control: "regions", tool: "cone" },
      { control: "regions-layer", tool: "cone" },
      { control: "tokens", tool: "select" },
      { control: "tokens-layer", tool: "select" },
    ],
    "native area placement should show Region tools during placement and return to Token tools after choosing",
  );

  let stubbornPlacementStartedWithTokenLayer = null;
  const stubbornNativeEvents = [];
  let stubbornPlacement = null;
  globalThis.canvas = {
    dimensions: { distance: 5, distancePixels: 2 },
    grid: { size: 10, distance: 5 },
    mousePosition: { x: 30, y: 40 },
    tokens: {
      active: true,
      placeables: [{ id: "caster-token", center: { x: 0, y: 0 } }],
      deactivate: () => {
        stubbornNativeEvents.push("tokens-deactivate");
        globalThis.canvas.tokens.active = false;
      },
    },
    regions: {
      active: false,
      activate: ({ tool } = {}) => {
        stubbornNativeEvents.push({ control: "regions-layer", tool });
        globalThis.canvas.regions.active = true;
      },
      placeRegion: (data, options = {}) => {
        stubbornPlacementStartedWithTokenLayer = globalThis.canvas.tokens.active;
        stubbornPlacement = { data, options };
        return new Promise((resolve) => {
          stubbornPlacement.resolve = resolve;
        });
      },
    },
  };
  globalThis.ui = {
    controls: {
      activate: async (options) => {
        stubbornNativeEvents.push(options);
      },
    },
  };
  const stubbornAreas = [];
  const stubbornPicker = chooseAreaMarker({
    context: { token: { id: "caster-token", center: { x: 0, y: 0 } } },
    action: { name: "Breathe Fire", targetingProfile: { type: "cone", distance: 15, width: 5 } },
    onChoose: (marker) => stubbornAreas.push(marker),
  });
  assert.ok(stubbornPicker);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    stubbornPlacementStartedWithTokenLayer,
    false,
    "native region placement should force the token layer inactive before calling placeRegion",
  );
  assert.deepEqual(
    stubbornNativeEvents.slice(0, 3),
    [{ control: "regions", tool: "cone" }, { control: "regions-layer", tool: "cone" }, "tokens-deactivate"],
    "native region placement should not let token-layer activity make Foundry switch back to Token tools",
  );
  stubbornPlacement.options.preConfirm({
    document: { shapes: [{ toObject: () => nativeShape }] },
    shape: nativeShape,
  });
  stubbornPlacement.resolve({ shapes: [{ toObject: () => nativeShape }] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stubbornAreas.length, 1);

  const nativeWarnings = [];
  let fallbackAfterNativeFailure = false;
  if (globalThis.console) globalThis.console.warn = () => { };
  globalThis.ui = { notifications: { warn: (message) => nativeWarnings.push(message) } };
  globalThis.canvas = {
    app: {
      canvas: {
        addEventListener: () => {
          fallbackAfterNativeFailure = true;
        },
      },
    },
    regions: {
      placeRegion: () => {
        throw new Error("bad region data");
      },
    },
  };
  const failedNativePicker = chooseAreaMarker({
    context: { token: { id: "caster-token", center: { x: 0, y: 0 } } },
    action: { name: "Breathe Fire", targetingProfile: { type: "cone", distance: 15, width: 5 } },
    onChoose: () => assert.fail("failed native placement must not choose an area"),
  });
  assert.ok(failedNativePicker);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(fallbackAfterNativeFailure, false);
  assert.ok(nativeWarnings.some((message) => message === "Area template preview failed: bad region data"));

  let areaPointerHandler = null;
  let areaPointerRemoved = false;
  const view = {
    addEventListener: (event, handler) => {
      assert.equal(event, "pointerdown");
      areaPointerHandler = handler;
    },
    removeEventListener: (event, handler) => {
      assert.equal(event, "pointerdown");
      assert.equal(handler, areaPointerHandler);
      areaPointerRemoved = true;
      areaPointerHandler = null;
    },
  };
  globalThis.canvas = {
    app: { view },
    grid: { size: 10 },
    tokens: { placeables: [{ id: "caster-token", center: { x: 0, y: 0 } }] },
    canvasCoordinatesFromClient: ({ x, y }) => ({ x: x - 100, y: y - 50 }),
  };
  const chosenAreas = [];
  const picker = chooseAreaMarker({
    context: { token: { id: "caster-token", center: { x: 0, y: 0 } } },
    action: { name: "Breathe Fire", targetingProfile: { type: "cone", distance: 15, width: 5 } },
    onChoose: (marker) => chosenAreas.push(marker),
  });
  assert.ok(picker);
  assert.equal(typeof areaPointerHandler, "function");
  areaPointerHandler({
    button: 0,
    clientX: 124,
    clientY: 86,
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(chosenAreas, [{
    shape: "cone",
    center: { x: 25, y: 35 },
    distance: 15,
    width: 5,
    rotation: 54,
    originTokenId: "caster-token",
    label: "Cone 15 ft",
  }]);
  assert.equal(areaPointerRemoved, true);
  assert.equal(areaPointerHandler, null);

  let v14PointerHandler = null;
  let v14PointerRemoved = false;
  const appCanvas = {
    addEventListener: (event, handler) => {
      assert.equal(event, "pointerdown");
      v14PointerHandler = handler;
    },
    removeEventListener: (event, handler) => {
      assert.equal(event, "pointerdown");
      assert.equal(handler, v14PointerHandler);
      v14PointerRemoved = true;
      v14PointerHandler = null;
    },
  };
  globalThis.canvas = {
    app: { canvas: appCanvas },
    grid: { size: 10 },
    mousePosition: { x: 41, y: 59 },
    tokens: { placeables: [{ id: "caster-token", center: { x: 0, y: 0 } }] },
  };
  const v14Areas = [];
  const v14Picker = chooseAreaMarker({
    context: { token: { id: "caster-token", center: { x: 0, y: 0 } } },
    action: { name: "Breathe Fire", targetingProfile: { type: "cone", distance: 15, width: 5 } },
    onChoose: (marker) => v14Areas.push(marker),
  });
  assert.ok(v14Picker);
  assert.equal(typeof v14PointerHandler, "function");
  v14PointerHandler({
    button: 0,
    preventDefault: () => { },
    stopPropagation: () => { },
  });
  assert.deepEqual(v14Areas, [{
    shape: "cone",
    center: { x: 45, y: 55 },
    distance: 15,
    width: 5,
    rotation: 51,
    originTokenId: "caster-token",
    label: "Cone 15 ft",
  }]);
  assert.equal(v14PointerRemoved, true);
  assert.equal(v14PointerHandler, null);
} finally {
  cancelAreaPicker();
  globalThis.canvas = previousAreaPickerCanvas;
  globalThis.game = previousAreaPickerGame;
  globalThis.ui = previousAreaPickerUi;
  if (globalThis.console && previousAreaPickerConsoleWarn) globalThis.console.warn = previousAreaPickerConsoleWarn;
}

const previousWallPreviewCanvas = globalThis.canvas;
const previousWallPreviewFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move" && ray.B.x === 50 && ray.B.y === 0,
    },
  };
  const foundryWallAwareStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: {
      targets: [{
        name: "Ogre",
        token: { center: { x: 100, y: 0 } },
        distance: 100,
      }],
    },
  }, { slug: "stride" }, { gridSize: 5, collisionScale: 2 });
  assert.notDeepEqual(foundryWallAwareStridePreview.recommendedCenter, { x: 25, y: 0 });
} finally {
  globalThis.canvas = previousWallPreviewCanvas;
  globalThis.foundry = previousWallPreviewFoundry;
}

const previousTokenCollisionPreviewCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    tokens: {
      placeables: [{
        id: "active-token",
        checkCollision: (to, options) => options?.type === "move" && to.x === 25 && to.y === 0,
      }],
    },
  };
  const tokenCollisionStridePreview = movementPreviewForStep({
    token: { id: "active-token", center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: {
      targets: [{
        name: "Ogre",
        token: { center: { x: 100, y: 0 } },
        distance: 100,
      }],
    },
  }, { slug: "stride" }, { gridSize: 5 });
  assert.notDeepEqual(tokenCollisionStridePreview.recommendedCenter, { x: 25, y: 0 });
} finally {
  globalThis.canvas = previousTokenCollisionPreviewCanvas;
}

const stepPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, { slug: "step" }, { gridSize: 5 });
assert.equal(stepPreview.enabled, true);
assert.equal(stepPreview.distanceFeet, 5);
assert.equal(stepPreview.reachableCenters.length, 8);
const crawlPreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, { slug: "crawl" }, { gridSize: 5 });
assert.equal(crawlPreview.enabled, true);
assert.equal(crawlPreview.distanceFeet, 5);
assert.equal(crawlPreview.reachableCenters.length, 8);

// A Stride -> Stride -> Strike composite previews one landing cell per Stride,
// each in its own colour, progressing toward the target.
const compositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: 0 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(compositePreview.enabled, true);
assert.equal(compositePreview.stridePath.length, 2);
assert.notEqual(compositePreview.stridePath[0].color, compositePreview.stridePath[1].color);
assert.ok(compositePreview.stridePath[1].center.x > compositePreview.stridePath[0].center.x);
assert.ok(compositePreview.stridePath[0].marker.strokes.length === 2);

const fiveFootReachCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Nakpik", token: { center: { x: 35, y: 0 } }, distance: 35 }] },
}, {
  slug: "stride-strike-longsword",
  activityProfile: { includesStrike: true, strideCount: 2, strikeReach: 5 },
}, { gridSize: 5 });
assert.equal(fiveFootReachCompositePreview.enabled, true);
assert.equal(fiveFootReachCompositePreview.destinationCenter.x, 30);
assert.equal(fiveFootReachCompositePreview.stridePath.at(-1).center.x, 30);

const attackBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 30, y: 0 } }, distance: 30 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x >= 27.5 && to.x <= 32.5 && to.y >= -2.5 && to.y <= 2.5,
});
assert.equal(attackBlockedCompositePreview.enabled, false);

const centerBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 30, y: 0 } }, distance: 30 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x === 30 && to.y === 0,
});
assert.equal(centerBlockedCompositePreview.enabled, false);

const perimeterBlockedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 35 } },
  battlefield: {
    targets: [{
      name: "Caged Mitflit",
      token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      distance: 40,
    }],
  },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  attackPathBlocked: (_from, to) => to.x !== 40 || to.y !== 0,
});
assert.equal(perimeterBlockedCompositePreview.enabled, false);

const preferredTargetCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{ id: "blocked", name: "Blocked", token: { center: { x: -35, y: 0 } }, distance: 35 }],
    enemies: [{ id: "mitflit", name: "Mitflit", token: { center: { x: 35, y: 0 } }, distance: 35 }],
  },
}, {
  slug: "stride-strike-claw",
  preferredTarget: { id: "mitflit", name: "Mitflit", token: { center: { x: 35, y: 0 } }, distance: 35 },
  targetingProfile: { preferredTargetId: "mitflit", preferredTargetName: "Mitflit" },
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(preferredTargetCompositePreview.enabled, true);
assert.ok(preferredTargetCompositePreview.destinationCenter.x > 0);

const stepwiseCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 20 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  pathBlocked: (from, to) => Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) > 5,
});
assert.equal(stepwiseCompositePreview.enabled, true);
assert.equal(stepwiseCompositePreview.stridePath.length, 1);

const routedCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 20 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: 0 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 20 && to.y === 0,
});
assert.equal(routedCompositePreview.enabled, true);
assert.equal(routedCompositePreview.stridePath.length, 2);
assert.ok(!routedCompositePreview.stridePath.some((step) => step.center.x === 20 && step.center.y === 0));

const fastestCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 30 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 35, y: 0 } }, distance: 35 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 1 },
}, {
  gridSize: 5,
  pathBlocked: (_from, to) => to.x === 25 && to.y === 0,
});
assert.equal(fastestCompositePreview.enabled, true);
assert.equal(fastestCompositePreview.destinationCenter.cost, 30);

const directCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 45, y: -10 } }, distance: 45 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(directCompositePreview.enabled, true);
assert.ok(directCompositePreview.stridePath.every((step) =>
  step.trail.every((point) => point.y >= -10),
));

const shortTwoStrideCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
}, {
  slug: "stride-strike-claw",
  activityProfile: { includesStrike: true, strideCount: 2 },
}, { gridSize: 5 });
assert.equal(shortTwoStrideCompositePreview.enabled, true);
assert.equal(shortTwoStrideCompositePreview.stridePath.length, 2);
assert.notEqual(
  `${shortTwoStrideCompositePreview.stridePath[0].center.x},${shortTwoStrideCompositePreview.stridePath[0].center.y}`,
  `${shortTwoStrideCompositePreview.stridePath[1].center.x},${shortTwoStrideCompositePreview.stridePath[1].center.y}`,
);

const skirmishCompositePreview = movementPreviewForStep({
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [{ id: "mitflit", name: "Mitflit", token: { center: { x: 80, y: 0 } }, distance: 80 }] },
}, {
  slug: "stride-strike-stride-shortbow",
  preferredTarget: { id: "mitflit", name: "Mitflit", token: { center: { x: 80, y: 0 } }, distance: 80 },
  targetingProfile: { preferredTargetId: "mitflit", preferredTargetName: "Mitflit" },
  activityProfile: { includesStrike: true, retreatAfterStrike: true, strideCount: 2, strikeReach: 60 },
}, { gridSize: 5 });
assert.equal(skirmishCompositePreview.enabled, true);
assert.equal(skirmishCompositePreview.stridePath.length, 2);
assert.ok(skirmishCompositePreview.stridePath[0].center.x > 0);
assert.deepEqual(skirmishCompositePreview.stridePath[1].center, { x: 0, y: 0 });

const previousScaledPreviewCanvas = globalThis.canvas;
const previousScaledPreviewPixi = globalThis.PIXI;
try {
  const previewDrawCalls = [];
  class TestGraphics {
    constructor() {
      this.children = [];
    }
    lineStyle(width, color, alpha) {
      previewDrawCalls.push({ type: "lineStyle", width, color, alpha });
    }
    beginFill(color, alpha) {
      previewDrawCalls.push({ type: "beginFill", color, alpha });
    }
    drawRect() {
      previewDrawCalls.push({ type: "drawRect" });
    }
    drawCircle(x, y, radius) {
      previewDrawCalls.push({ type: "drawCircle", x, y, radius });
    }
    endFill() { }
    moveTo() { }
    lineTo() { }
    addChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    destroy() {
      this.parent = null;
      this.children = [];
    }
  }
  class TestText {
    constructor(text = "", style = {}) {
      this.text = String(text);
      this.style = style;
      this.anchor = { set: (x, y = x) => { this.anchorValue = { x, y }; } };
      this.position = { set: (x, y) => { this.positionValue = { x, y }; } };
      previewDrawCalls.push({ type: "text", text: this.text, style });
    }
  }
  const layer = {
    children: [],
    sortableChildren: false,
    addChild: (child) => {
      child.parent = layer;
      layer.children.push(child);
    },
    removeChild: (child) => {
      layer.children = layer.children.filter((entry) => entry !== child);
      child.parent = null;
    },
  };
  globalThis.PIXI = { Graphics: TestGraphics, Text: TestText };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 100 },
    tokens: {
      placeables: [{
        id: "calder-token",
        center: { x: 200, y: 200 },
        document: { id: "calder-token", uuid: "Scene.Token.calder-token", width: 1, height: 1 },
      }, {
        id: "mitflit-token",
        center: { x: 300, y: 200 },
        document: { id: "mitflit-token", uuid: "Scene.Token.mitflit-token", width: 1, height: 1 },
      }],
    },
    interface: layer,
  };
  const scaledRetreatPreview = showMovementPreview({
    token: { id: "calder-token" },
    actor: { profile: { speed: 25 } },
    battlefield: {
      targets: [{
        id: "mitflit-token",
        name: "Mitflit",
        token: { id: "mitflit-token" },
        distance: 5,
      }],
    },
  }, {
    slug: "stride-away-strike-versatile-vial",
    preferredTarget: { id: "mitflit-token", name: "Mitflit", token: { id: "mitflit-token" }, distance: 5 },
    targetingProfile: { preferredTargetId: "mitflit-token", preferredTargetName: "Mitflit" },
    activityProfile: {
      includesStrike: true,
      retreatBeforeStrike: true,
      strideCount: 1,
      strikeReach: 20,
      attackCenter: { x: 100, y: 200 },
    },
  });
  assert.equal(scaledRetreatPreview.enabled, true);
  assert.deepEqual(scaledRetreatPreview.origin, { x: 10, y: 10 });
  assert.deepEqual(scaledRetreatPreview.destinationCenter, { x: 5, y: 10 });
  assert.deepEqual(scaledRetreatPreview.stridePath[0].center, { x: 5, y: 10 });
  const projectedCenterPreview = showMovementPreview({
    token: { id: "calder-token", center: { x: 100, y: 200 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [] },
  }, { slug: "stride" });
  assert.equal(projectedCenterPreview.enabled, true);
  assert.deepEqual(projectedCenterPreview.origin, { x: 5, y: 10 });
  const plannedCenterPreview = showMovementPreview({
    token: { id: "calder-token", plannedCenter: { x: 100, y: 200 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [] },
  }, { slug: "stride" });
  assert.equal(plannedCenterPreview.enabled, true);
  assert.deepEqual(plannedCenterPreview.origin, { x: 5, y: 10 });
  const waypointIndicatorPreview = showMovementPreview({
    token: { id: "calder-token" },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [] },
  }, {
    slug: "stride",
    destination: { x: 300, y: 300 },
    movementPlan: {
      native: false,
      waypoints: [{ x: 200, y: 300 }, { x: 300, y: 300 }],
    },
  });
  assert.equal(waypointIndicatorPreview.enabled, true);
  assert.equal(
    previewDrawCalls.filter((call) => call.type === "drawCircle").length >= 2,
    true,
    "custom waypoint preview should draw visible waypoint indicators",
  );
  assert.ok(
    Math.max(...previewDrawCalls
      .filter((call) => call.type === "drawCircle")
      .map((call) => call.radius)) >= 10,
    "custom waypoint indicators should be large enough to read on busy maps",
  );
  assert.equal(
    previewDrawCalls.some((call) => call.type === "text" && call.text === "5 ft"),
    true,
    "custom waypoint preview should draw first cumulative distance label",
  );
  assert.equal(
    previewDrawCalls.some((call) => call.type === "text" && call.text === "10 ft"),
    true,
    "custom waypoint preview should draw cumulative distance label after second waypoint",
  );
  assert.ok(
    previewDrawCalls
      .filter((call) => call.type === "text")
      .every((call) => Number(call.style?.fontSize) >= 16),
    "custom waypoint labels should scale dynamically from grid size instead of staying tiny",
  );
  assert.equal(
    previewDrawCalls.some((call) => call.type === "text" && call.text.includes("[object Object]")),
    false,
    "distance labels should pass text string to PIXI.Text, not constructor options object",
  );
  assert.equal(layer.children.length, 1, "movement preview should replace stale overlay graphics");
  assert.ok(previewDrawCalls.some((call) =>
    call.type === "lineStyle" && call.color === 0x101418 && call.width >= 4),
    "movement preview squares should draw a dark contrast border");
  assert.ok(previewDrawCalls.some((call) =>
    call.type === "lineStyle" && call.color !== 0x101418 && call.width >= 2 && call.alpha >= 0.88),
    "movement preview squares should draw visible colored borders");
  assert.ok(previewDrawCalls.some((call) =>
    call.type === "beginFill" && call.alpha > 0 && call.alpha <= 0.08),
    "movement preview square fill should stay light so border is primary");
} finally {
  clearMovementPreview();
  globalThis.canvas = previousScaledPreviewCanvas;
  globalThis.PIXI = previousScaledPreviewPixi;
}

const previousStablePreviewCanvas = globalThis.canvas;
const previousStablePreviewPixi = globalThis.PIXI;
try {
  class StableGraphics {
    lineStyle() { }
    beginFill() { }
    drawRect() { }
    endFill() { }
    moveTo() { }
    lineTo() { }
    destroy() {
      this.parent = null;
    }
  }
  class StableContainer {
    constructor() {
      this.children = [];
    }
    addChild(child) {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      child.parent = null;
    }
    destroy() {
      for (const child of this.children) child.parent = null;
      this.children = [];
      this.parent = null;
    }
  }
  const interfaceLayer = { children: [], addChild: (child) => interfaceLayer.children.push(child) };
  const stageLayer = new StableContainer();
  globalThis.PIXI = { Graphics: StableGraphics, Container: StableContainer };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 50, distance: 5 },
    interface: interfaceLayer,
    stage: stageLayer,
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 100, y: 100 },
        document: { id: "actor-token", uuid: "Scene.Token.actor-token", width: 1, height: 1 },
      }],
    },
  };
  const stablePreview = showMovementPreview({
    token: { id: "actor-token" },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [] },
  }, { slug: "stride" });
  assert.equal(stablePreview.enabled, true);
  assert.equal(interfaceLayer.children.length, 0, "movement preview should not mount on Foundry interface layer");
  assert.equal(stageLayer.children.length, 1, "movement preview should use a module-owned stage overlay");
  // The overlay must NOT force the main stage to sort: that made PIXI re-sort every scene child on
  // each change and dropped canvas FPS while the panel was open. The overlay renders on top via
  // insertion order instead, sorting only its own (tiny) child list.
  assert.notEqual(stageLayer.sortableChildren, true, "preview overlay must not flip the main stage's sortableChildren");
  const stablePreviewLayer = stageLayer.children[0];
  assert.equal(stablePreviewLayer.eventMode, "none");
  assert.equal(stablePreviewLayer.interactiveChildren, false);
  assert.equal(stablePreviewLayer.children.length, 1);
} finally {
  clearMovementPreview();
  globalThis.canvas = previousStablePreviewCanvas;
  globalThis.PIXI = previousStablePreviewPixi;
}

const previousActionPreviewCanvas = globalThis.canvas;
const previousActionPreviewPixi = globalThis.PIXI;
try {
  const actionPreviewCalls = [];
  class ActionPreviewGraphics {
    lineStyle(width, color, alpha) {
      actionPreviewCalls.push({ type: "lineStyle", width, color, alpha });
    }
    beginFill(color, alpha) {
      actionPreviewCalls.push({ type: "beginFill", color, alpha });
    }
    drawRect(x, y, width, height) {
      actionPreviewCalls.push({ type: "drawRect", x, y, width, height });
    }
    drawCircle(x, y, radius) {
      actionPreviewCalls.push({ type: "drawCircle", x, y, radius });
    }
    drawPolygon(points) {
      actionPreviewCalls.push({ type: "drawPolygon", points });
    }
    moveTo(x, y) {
      actionPreviewCalls.push({ type: "moveTo", x, y });
    }
    lineTo(x, y) {
      actionPreviewCalls.push({ type: "lineTo", x, y });
    }
    arc(x, y, radius, start, end) {
      actionPreviewCalls.push({ type: "arc", x, y, radius, start, end });
    }
    endFill() { }
    destroy() {
      this.destroyed = true;
      this.parent = null;
    }
  }
  const actionPreviewLayer = {
    children: [],
    sortableChildren: false,
    addChild: (child) => {
      child.parent = actionPreviewLayer;
      actionPreviewLayer.children.push(child);
    },
    removeChild: (child) => {
      actionPreviewLayer.children = actionPreviewLayer.children.filter((entry) => entry !== child);
      child.parent = null;
    },
  };
  globalThis.PIXI = { Graphics: ActionPreviewGraphics };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 50, distance: 5 },
    interface: actionPreviewLayer,
    tokens: {
      placeables: [{
        id: "actor-token",
        center: { x: 100, y: 100 },
        document: { id: "actor-token", uuid: "Scene.Token.actor-token", width: 1, height: 1 },
      }, {
        id: "target-token",
        center: { x: 200, y: 150 },
        document: { id: "target-token", uuid: "Scene.Token.target-token", width: 2, height: 1 },
      }],
    },
  };
  // Strikes / general actions (non-spell) highlight their resolved target ONLY when scoring
  // marked it an enemy target (suggestedTarget.type === "enemy") — that gate is what stops a
  // self-targeted action's actorTarget() from ever reaching the highlight path.
  actionPreviewCalls.length = 0;
  const strikePreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Strike",
    slug: "strike",
    suggestedTarget: { type: "enemy", id: "target-token", name: "Ogre" },
    targetTokenIds: ["target-token"],
  });
  assert.equal(strikePreview.type, "target", "a strike hover with an enemy suggestedTarget should draw the target overlay");
  assert.ok(actionPreviewCalls.some((call) =>
    call.type === "drawRect" && call.x === 150 && call.y === 125 && call.width === 100 && call.height === 50),
    "a strike hover should frame the resolved enemy token's footprint");

  // Self-targeted actions (Drop Prone, Raise a Shield) resolve suggestedTarget.type === "self" —
  // this must never draw a highlight, even when targetTokenIds is (incorrectly) populated. This
  // is the regression guard for the bug that got the whole feature disabled originally: a blind
  // fallback used to highlight a random enemy for exactly this case.
  actionPreviewCalls.length = 0;
  const selfActionPreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Drop Prone",
    slug: "drop-prone",
    suggestedTarget: { type: "self", id: "actor-token", name: "Self" },
    targetTokenIds: ["target-token"],
  });
  assert.equal(selfActionPreview, null, "a self-targeted action hover should draw no overlay");
  assert.equal(actionPreviewCalls.some((call) => call.type === "drawRect"), false,
    "a self-targeted action hover should not draw a target box");

  // A step with no suggestedTarget at all (legacy/ambiguous shape) must not draw a highlight
  // just because targetTokenIds happens to be populated — the gate requires an explicit
  // "enemy" type, not merely the presence of a token id.
  actionPreviewCalls.length = 0;
  const untypedActionPreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Mystery Action",
    slug: "mystery-action",
    targetTokenIds: ["target-token"],
  });
  assert.equal(untypedActionPreview, null, "an action hover with no typed suggestedTarget should draw no overlay");

  // Ranged spells keep the target highlight + range ring as placement guidance.
  actionPreviewCalls.length = 0;
  const targetPreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Daze",
    slug: "daze",
    source: "spell-curated",
    range: { max: 30 },
    targetTokenIds: ["target-token"],
  });
  assert.equal(targetPreview.type, "target");
  assert.ok(actionPreviewCalls.some((call) =>
    call.type === "drawRect" && call.x === 150 && call.y === 125 && call.width === 100 && call.height === 50),
    "ranged spell hover should frame the planned target token footprint");
  assert.equal(actionPreviewCalls.some((call) => call.type === "lineTo"), false,
    "hover preview should NOT draw a scene-spanning line to the planned target");

  actionPreviewCalls.length = 0;
  const areaPreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Fireball",
    slug: "fireball",
    areaMarker: { shape: "burst", center: { x: 300, y: 250 }, distance: 20 },
  });
  assert.equal(areaPreview.type, "area");
  assert.equal(actionPreviewLayer.children.length, 1, "area hover preview should replace target preview overlay");
  assert.ok(actionPreviewCalls.some((call) =>
    call.type === "drawCircle" && call.x === 300 && call.y === 250 && call.radius === 200),
    "area hover preview should draw the planned template footprint");

  // An executed step's movement is already spent: with skipMovement the stride overlay is
  // suppressed and a bare stride (no target/area) draws nothing on hover.
  actionPreviewCalls.length = 0;
  const doneStridePreview = showActionPreview({
    token: { id: "actor-token" },
  }, {
    name: "Stride",
    slug: "stride",
    requiresDestination: true,
  }, { skipMovement: true });
  assert.equal(doneStridePreview, null, "skipMovement should suppress the stride overlay for an executed step");
  assert.equal(actionPreviewLayer.children.length, 0, "a skipped-movement done step draws nothing on hover");

  clearActionPreview();
  assert.equal(actionPreviewLayer.children.length, 0);
} finally {
  clearActionPreview();
  globalThis.canvas = previousActionPreviewCanvas;
  globalThis.PIXI = previousActionPreviewPixi;
}
assert.ok(/_showDraftActionPreview\([\s\S]*execution\?\.status === "done"[\s\S]*skipMovement: isDone/.test(panelSource),
  "hovering an executed draft step should skip its movement overlay");

const previousPreviewVisibilityGame = globalThis.game;
const previousPreviewVisibilityCanvas = globalThis.canvas;
try {
  globalThis.game = { user: { isGM: false } };
  const playerVisibleStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, { slug: "stride" }, {
    gridSize: 5,
    pointVisible: (point) => point.x <= 10,
  });
  assert.ok(!playerVisibleStridePreview.reachableCenters.some((point) => point.x > 10));

  const playerHiddenPathCompositePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, {
    slug: "stride-strike-claw",
    activityProfile: { includesStrike: true, strideCount: 1 },
  }, {
    gridSize: 5,
    pointVisible: (point) => point.x <= 10,
  });
  assert.equal(playerHiddenPathCompositePreview.enabled, false);

  globalThis.canvas = {
    visibility: {
      testVisibility: (point) => point.x <= 20,
    },
  };
  const foundryVisibilityStridePreview = movementPreviewForStep({
    token: { center: { x: 0, y: 0 } },
    actor: { profile: { speed: 25 } },
    battlefield: { targets: [{ name: "Amiri", token: { center: { x: 25, y: 0 } }, distance: 25 }] },
  }, { slug: "stride" }, { gridSize: 5, collisionScale: 2 });
  assert.ok(!foundryVisibilityStridePreview.reachableCenters.some((point) => point.x > 10));
} finally {
  globalThis.game = previousPreviewVisibilityGame;
  globalThis.canvas = previousPreviewVisibilityCanvas;
}

const hugeStridePreview = movementPreviewForStep({
  token: { center: { x: 15, y: 15 }, width: 3, height: 3 },
  actor: { profile: { speed: 25 } },
  battlefield: {
    targets: [{
      name: "Ezren",
      token: { center: { x: 55, y: 15 }, width: 1, height: 1 },
    }],
  },
}, { slug: "stride" }, { gridSize: 5 });
assert.equal(hugeStridePreview.footprint.widthCells, 3);
assert.equal(hugeStridePreview.footprint.heightCells, 3);
assert.equal(hugeStridePreview.reachablePlacements[0].width, 15);
assert.equal(hugeStridePreview.reachablePlacements[0].height, 15);
assert.equal(hugeStridePreview.recommendedPlacement.width, 15);
assert.equal(hugeStridePreview.recommendedCenter.x, 40);
assert.equal(hugeStridePreview.recommendedCenter.y, 15);
assert.deepEqual(hugeStridePreview.recommendedMarker.strokes, [{
  start: { x: 32.5, y: 7.5 },
  end: { x: 47.5, y: 22.5 },
}, {
  start: { x: 47.5, y: 7.5 },
  end: { x: 32.5, y: 22.5 },
}]);
assert.equal(hugeStridePreview.reachableMarkers[0].width, 5);
assert.equal(hugeStridePreview.reachableMarkers[0].height, 5);
assert.ok(hugeStridePreview.reachableMarkers.length <= 48);

const battlefieldTargetPlan = bestTurnPlan({
  ...fighterContext,
  targets: undefined,
  battlefield: {
    targets: fighterContext.targets,
  },
}, fixtureCandidates);
assert.equal(battlefieldTargetPlan.target.name, "Ogre");

const scoredDemoralize = scoreCandidate(fighterContext, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  role: "debuff",
});
assert.ok(scoredDemoralize.score > 42);
assert.equal(scoredDemoralize.reason, "Target is not frightened.");
assert.equal(scoredDemoralize.suggestedTarget.name, "Ogre");

const highIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 13, rank: 2 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
const lowIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 3, rank: 0 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
assert.ok(highIntimidationDemoralize.score > lowIntimidationDemoralize.score + 20);
assert.equal(highIntimidationDemoralize.skillCheck.label, "Intimidation +13 vs Will DC 16");
assert.equal(lowIntimidationDemoralize.skillCheck.label, "Intimidation +3 vs Will DC 16");

const playerHighIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: false,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 13, rank: 2 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
const playerLowIntimidationDemoralize = scoreCandidate({
  ...fighterContext,
  isGM: false,
  profile: {
    ...fighterContext.profile,
    skills: {
      intimidation: { mod: 3, rank: 0 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    saves: { will: 16 },
  }],
}, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  skill: "intimidation",
  targetSave: "will",
});
assert.equal(playerHighIntimidationDemoralize.skillCheck, null);
assert.equal(playerLowIntimidationDemoralize.skillCheck, null);
assert.equal(playerHighIntimidationDemoralize.score, playerLowIntimidationDemoralize.score);

const scoredTripSkillOdds = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      athletics: { mod: 7, rank: 1 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    saves: { reflex: 16 },
  }],
}, {
  id: "trip",
  name: "Trip",
  slug: "trip",
  actionCost: 1,
  source: "generic",
  skill: "athletics",
});
assert.equal(scoredTripSkillOdds.skillCheck.label, "Athletics +7 vs Reflex DC 16");
assert.ok(scoredTripSkillOdds.reasons.includes("Athletics +7 vs Reflex DC 16."));

const scoredFeintSkillOdds = scoreCandidate({
  ...fighterContext,
  isGM: true,
  profile: {
    ...fighterContext.profile,
    skills: {
      deception: { mod: 10, rank: 1 },
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    perceptionDC: 17,
  }],
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  skill: "deception",
});
assert.equal(scoredFeintSkillOdds.skillCheck.label, "Deception +10 vs Perception DC 17");

const scoredTripAgainstProne = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    conditions: {
      slugs: ["prone"],
      values: { prone: null },
    },
  }],
}, {
  id: "trip",
  name: "Trip",
  slug: "trip",
  actionCost: 1,
  source: "generic",
});
assert.equal(scoredTripAgainstProne.score, 42);
assert.ok(!scoredTripAgainstProne.reasons.includes("Target is standing and can be knocked prone."));

const scoredShield = scoreCandidate(fighterContext, {
  id: "raise-a-shield",
  name: "Raise a Shield",
  slug: "raise-a-shield",
  actionCost: 1,
  source: "generic",
});
assert.equal(scoredShield.suggestedTarget.name, "Valeros");

const scoredHeal = scoreCandidate({
  ...fighterContext,
  allies: [{
    id: "ally-1",
    name: "Kyra",
    hpPercent: 0.25,
  }],
}, {
  id: "heal",
  name: "Heal",
  slug: "heal",
  actionCost: 2,
  source: "spell-curated",
  curated: { role: "healing" },
});
assert.equal(scoredHeal.suggestedTarget.name, "Kyra");

const systemActionContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "system-sudden-charge",
          name: "System Sudden Charge",
          type: "action",
          system: {
            slug: "sudden-charge",
            actionType: { value: "action" },
            actions: { value: 1 },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const hybridAction = readActionSources(systemActionContext).find((action) => action.slug === "sudden-charge");
assert.equal(hybridAction.name, "System Sudden Charge");
assert.equal(hybridAction.actionCost, 1);
assert.equal(hybridAction.role, "mobility-attack");
assert.equal(hybridAction.source, "custom-curated");

const explorationSkillItemContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "squeeze-action",
          name: "Squeeze",
          type: "action",
          system: {
            slug: "squeeze",
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["exploration", "move"] },
            description: { value: "<p>You contort yourself through a tight space.</p>" },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
  battlefield: { targets: [], enemies: [], allies: [] },
};
assert.equal(
  readActionSources(explorationSkillItemContext).some((action) => action.slug === "squeeze"),
  false,
  "exploration skill item actions should not be suggested",
);

const generatedExplorationSkillContext = {
  actor: {
    document: {
      system: {
        actions: [{
          id: "follow-the-expert-action",
          name: "Follow the Expert",
          slug: "follow-the-expert",
          type: "action",
          actionType: "action",
          actions: 1,
          traits: ["exploration"],
          description: "<p>Choose an ally attempting a recurring skill task.</p>",
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
  battlefield: { targets: [], enemies: [], allies: [] },
};
assert.equal(
  readActionSources(generatedExplorationSkillContext).some((action) => action.slug === "follow-the-expert"),
  false,
  "generated exploration skill actions should not be suggested",
);

const triggeredActionContext = {
  actor: {
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "quick-tempered",
          name: "Quick-Tempered",
          type: "action",
          system: {
            slug: "quick-tempered",
            actionType: { value: "free" },
            actions: { value: null },
            description: {
              value: "<p><strong>Trigger</strong> You roll initiative.</p><hr /><p>You Rage.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const blockedTriggeredAction = readActionSources(triggeredActionContext)
  .find((action) => action.slug === "quick-tempered");
assert.equal(blockedTriggeredAction.trigger, "You roll initiative.");
assert.equal(blockedTriggeredAction.available, false);
assert.equal(blockedTriggeredAction.unavailableReason, "Trigger is not active: You roll initiative.");

const activeTriggeredAction = readActionSources({
  ...triggeredActionContext,
  triggerEvents: ["initiative"],
}).find((action) => action.slug === "quick-tempered");
assert.equal(activeTriggeredAction.available, true);

const generatedTriggerContext = {
  actor: {
    document: {
      system: {
        actions: [{
          id: "follow-up-feint",
          name: "Follow-Up Feint",
          slug: "follow-up-feint",
          type: "action",
          actionType: "free",
          actions: 0,
          description: "<p><strong>Trigger</strong> Your last action was a Strike.</p><p>The target is off-guard to your next Strike.</p>",
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const blockedGeneratedTrigger = readActionSources(generatedTriggerContext)
  .find((action) => action.slug === "follow-up-feint");
assert.equal(blockedGeneratedTrigger.available, false);
assert.equal(blockedGeneratedTrigger.unavailableReason, "Trigger is not active: Your last action was a Strike.");
const activeGeneratedTrigger = readActionSources({
  ...generatedTriggerContext,
  triggerEvents: ["after-strike"],
}).find((action) => action.slug === "follow-up-feint");
assert.equal(activeGeneratedTrigger.available, true);

const failedCheckTriggerContext = {
  actor: {
    document: {
      system: {
        actions: [{
          id: "lucky-retry",
          name: "Lucky Retry",
          slug: "lucky-retry",
          type: "action",
          actionType: "free",
          actions: 0,
          description: "<p><strong>Trigger</strong> You fail a skill check.</p><p>You gain a +1 status bonus to the reroll.</p>",
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
};
const blockedFailedCheckTrigger = readActionSources(failedCheckTriggerContext)
  .find((action) => action.slug === "lucky-retry");
assert.equal(blockedFailedCheckTrigger.available, false);
assert.equal(blockedFailedCheckTrigger.unavailableReason, "Trigger is not active: You fail a skill check.");
const activeFailedCheckTrigger = readActionSources({
  ...failedCheckTriggerContext,
  triggerEvents: ["after-check-fail"],
}).find((action) => action.slug === "lucky-retry");
assert.equal(activeFailedCheckTrigger.available, true);

// Reactions (unlike triggered free actions) should be listed as available on the actor's own
// turn even when their trigger is not currently firing — the trigger is shown for reference.
const reactionFeatContext = {
  actor: {
    document: {
      system: {},
      itemTypes: {
        action: [],
        feat: [{
          id: "nimble-dodge",
          name: "Nimble Dodge",
          type: "feat",
          system: {
            slug: "nimble-dodge",
            actionType: { value: "reaction" },
            actions: { value: null },
            description: {
              value: "<p><strong>Trigger</strong> A creature targets you with an attack and you can see the attacker.</p><p>You gain a +2 circumstance bonus to AC against the triggering attack.</p>",
            },
          },
        }],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [],
  triggerEvents: [],
  events: [],
};
const reactionOnOwnTurn = readActionSources(reactionFeatContext).find((action) => action.slug === "nimble-dodge");
assert.ok(reactionOnOwnTurn, "reactions should be listed even with no active trigger");
assert.equal(reactionOnOwnTurn.available, true, "a reaction should be available on the actor's own turn without an active trigger");
assert.ok(reactionOnOwnTurn.trigger, "the reaction should still carry its trigger text for reference");

// Draw (1 action) per sheathed weapon, Drop/Release (free) per held weapon, and Drop Prone.
const weaponActionsContext = {
  actor: {
    document: {
      itemTypes: {
        weapon: [
          { id: "w-sheathed", name: "Longsword", type: "weapon", uuid: "Actor.x.Item.w-sheathed", system: { category: "martial", equipped: { carryType: "worn", handsHeld: 0 }, usage: { hands: 1 }, traits: { value: [] } } },
          { id: "w-held", name: "Dagger", type: "weapon", uuid: "Actor.x.Item.w-held", system: { category: "simple", equipped: { carryType: "held", handsHeld: 1 }, usage: { hands: 1 }, traits: { value: [] } } },
        ],
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
    profile: {},
  },
  profile: {},
  targets: [],
};
const weaponSources = readActionSources(weaponActionsContext);
const drawLongsword = weaponSources.find((action) => action.slug === "draw-longsword");
assert.ok(drawLongsword, "a sheathed weapon should get a Draw action");
assert.equal(drawLongsword.actionCost, 1);
assert.equal(drawLongsword.executable, "draw-weapon");
assert.equal(drawLongsword.item.id, "w-sheathed");
const releaseDagger = weaponSources.find((action) => action.slug === "release-dagger");
assert.ok(releaseDagger, "a held weapon should get a Release (free) action");
assert.equal(releaseDagger.actionCost, 0);
assert.equal(releaseDagger.executable, "drop-weapon");
assert.equal(releaseDagger.name, "Release Dagger");
assert.ok(!weaponSources.some((action) => action.slug === "release-longsword"), "a sheathed weapon should not get a Release");
assert.ok(!weaponSources.some((action) => action.slug === "draw-dagger"), "a held weapon should not get a Draw");
const sheatheDagger = weaponSources.find((action) => action.slug === "sheathe-dagger");
assert.ok(sheatheDagger, "a held weapon should get a Sheathe (1-action) action");
assert.equal(sheatheDagger.actionCost, 1);
assert.equal(sheatheDagger.executable, "sheathe-weapon");
assert.equal(sheatheDagger.name, "Sheathe Dagger");
assert.ok(!weaponSources.some((action) => action.slug === "sheathe-longsword"), "a sheathed weapon should not get a Sheathe");
const ownTurnDropProne = weaponSources.find((action) => action.slug === "drop-prone");
assert.ok(ownTurnDropProne, "Drop Prone should be offered when the actor lacks its own");
assert.equal(ownTurnDropProne.actionCost, 1);
assert.equal(ownTurnDropProne.available, true);

// Drop Prone is hidden when the actor already carries its own, and disabled when already prone.
const hasOwnDropProne = readActionSources({
  ...weaponActionsContext,
  actor: {
    ...weaponActionsContext.actor,
    document: {
      ...weaponActionsContext.actor.document,
      itemTypes: { ...weaponActionsContext.actor.document.itemTypes, action: [{ name: "Drop Prone", type: "action", system: { slug: "drop-prone" } }] },
    },
  },
}).filter((action) => action.slug === "drop-prone" && action.source === "system-inferred");
assert.equal(hasOwnDropProne.length, 0, "the generic Drop Prone should not duplicate the actor's own");
const proneDropProne = readActionSources({
  ...weaponActionsContext,
  actor: { ...weaponActionsContext.actor, profile: { conditions: [{ slug: "prone" }] } },
  profile: { conditions: [{ slug: "prone" }] },
}).find((action) => action.slug === "drop-prone");
assert.equal(proneDropProne?.available, false, "Drop Prone should be unavailable when already prone");

// Reload (cost = the weapon's reload value) for a held firearm/crossbow.
const reloadContext = {
  actor: {
    document: {
      itemTypes: {
        weapon: [{ id: "w-gun", name: "Pistol", type: "weapon", uuid: "Actor.x.Item.w-gun", system: { category: "martial", equipped: { carryType: "held", handsHeld: 1 }, usage: { hands: 1 }, reload: { value: "1" }, traits: { value: [] } } }],
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
    profile: {},
  },
  profile: {},
  targets: [],
};
const reloadPistol = readActionSources(reloadContext).find((action) => action.slug === "reload-pistol");
assert.ok(reloadPistol, "a held firearm with a reload value should get a Reload action");
assert.equal(reloadPistol.actionCost, 1);
assert.equal(reloadPistol.executable, "reload-weapon");
assert.ok(!readActionSources(weaponActionsContext).some((action) => action.slug && action.slug.startsWith("reload-")), "non-reload weapons should not get a Reload action");

// A reload-0 ammunition weapon (e.g. a bow) reloads as part of firing: still show the Reload step,
// but as a free action that does not draw from the action budget.
const bowReloadContext = {
  actor: {
    document: {
      itemTypes: {
        weapon: [{ id: "w-bow", name: "Longbow", type: "weapon", uuid: "Actor.x.Item.w-bow", system: { category: "martial", equipped: { carryType: "held", handsHeld: 2 }, usage: { hands: 2 }, reload: { value: "0" }, traits: { value: [] } } }],
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
    profile: {},
  },
  profile: {},
  targets: [],
};
const reloadBow = readActionSources(bowReloadContext).find((action) => action.slug === "reload-longbow");
assert.ok(reloadBow, "a reload-0 ammunition weapon should still show a Reload step");
assert.equal(reloadBow.actionCost, 0, "a reload-0 Reload should not draw from the action budget");
assert.equal(reloadBow.actionType, "free");
assert.equal(reloadBow.executable, "reload-weapon");

const amiriContext = {
  actor: {
    id: "amiri-1",
    name: "Amiri",
    profile: {
      actorType: "character",
      classSlug: "barbarian",
      speed: 25,
      reach: 5,
      conditions: { slugs: [], values: {} },
      skills: {
        acrobatics: { rank: 1, mod: 7 },
      },
    },
    document: {
      system: {
        actions: [{
          slug: "bastard-sword",
          type: "strike",
          label: "Bastard Sword",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "bastard-sword",
            system: { traits: { value: [] } },
          },
          roll: () => null,
        }],
      },
      itemTypes: {
        action: [{
          id: "rage",
          name: "Rage",
          type: "action",
          system: {
            slug: "rage",
            actionType: { value: "action" },
            actions: { value: 1 },
          },
        }, {
          id: "sudden-charge",
          name: "Sudden Charge",
          type: "action",
          system: {
            slug: "sudden-charge",
            actionType: { value: "action" },
            actions: { value: 2 },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {
    actorType: "character",
    classSlug: "barbarian",
    speed: 25,
    reach: 5,
    conditions: { slugs: [], values: {} },
    skills: {
      acrobatics: { rank: 1, mod: 7 },
    },
  },
  targets: [{
    id: "target-1",
    name: "Giant Centipede",
    distance: 30,
    hpPercent: 1,
    conditions: [],
    saves: {},
    ac: 17,
  }],
};
const amiriCandidates = buildCandidates(amiriContext).candidates;
const amiriBest = bestTurnPlan(amiriContext, amiriCandidates);
assert.equal(amiriBest.summary, "Rage -> Sudden Charge");
assert.ok(amiriBest.reason.includes("Rage"));
assert.equal(amiriBest.steps.find((step) => step.slug === "sudden-charge").actionCost, 2);
assert.equal(amiriCandidates.some((candidate) => candidate.slug === "tumble-through"), false);
assert.equal(
  buildTurnPlans(amiriContext, amiriCandidates)
    .some((plan) => plan.summary === "Sudden Charge -> Tumble Through"),
  false,
);

const blockedTumbleThrough = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}).find((action) => action.slug === "tumble-through");
assert.equal(blockedTumbleThrough.available, false);
assert.equal(blockedTumbleThrough.unavailableReason, "No useful path through enemy detected.");

const allowedTumbleThrough = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    blocksPath: true,
  }],
}).find((action) => action.slug === "tumble-through");
assert.equal(allowedTumbleThrough.available, true);

const amiriBlockedPostChargeTumbleCandidates = buildCandidates({
  ...amiriContext,
  targets: [{
    ...amiriContext.targets[0],
    distance: 20,
    blocksPath: true,
  }],
}).candidates;
assert.equal(
  amiriBlockedPostChargeTumbleCandidates.some((candidate) => candidate.slug === "tumble-through"),
  true,
);
assert.equal(
  buildTurnPlans(amiriContext, amiriBlockedPostChargeTumbleCandidates)
    .some((plan) => plan.summary === "Sudden Charge -> Tumble Through"),
  false,
);

const hydraContext = {
  actor: {
    id: "hydra-1",
    name: "Hydra",
    profile: {
      actorType: "npc",
      speed: 25,
      reach: 10,
      hpPercent: 1,
      conditions: { slugs: [], values: {} },
      skills: {},
    },
    document: {
      system: {
        actions: [{
          slug: "fangs",
          type: "strike",
          label: "Fangs",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "fangs",
            system: { traits: { value: ["reach-10"] } },
          },
          roll: () => null,
        }, {
          slug: "focused-assault",
          label: "Focused Assault",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The hydra makes a single Strike with each of its heads against one target.</p>",
          },
        }, {
          slug: "storm-of-jaws",
          type: "action",
          label: "Storm of Jaws",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The hydra makes Strikes up to its number of heads, each against a different target. These attacks count toward MAP, but MAP doesn't increase until after all attacks.</p>",
          },
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {
    actorType: "npc",
    speed: 25,
    reach: 10,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    skills: {},
  },
  targets: [{
    id: "ezren-1",
    name: "Ezren",
    distance: 10,
    hpPercent: 1,
    conditions: [],
    saves: {},
    ac: 16,
  }],
};
const hydraCandidates = buildCandidates(hydraContext).candidates;
assert.equal(findCustomAction("focused-assault"), null);
assert.equal(findCustomAction("storm-of-jaws"), null);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "focused-assault"), true);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "storm-of-jaws"), true);
assert.equal(hydraCandidates.find((candidate) => candidate.slug === "focused-assault").source, "system-inferred");
assert.equal(hydraCandidates.find((candidate) => candidate.slug === "storm-of-jaws").role, "multiattack");
assert.equal(hydraCandidates.some((candidate) => candidate.source === "strike" && candidate.name === "Focused Assault"), false);
assert.equal(hydraCandidates.some((candidate) => candidate.slug === "recall-knowledge"), false);
const hydraBest = bestTurnPlan(hydraContext, hydraCandidates);
assert.ok(
  hydraBest.steps.some((step) => ["focused-assault", "storm-of-jaws"].includes(step.slug)),
  `Hydra best plan should use a two-action activity, got ${hydraBest.summary}`,
);

const npcUtilityContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: {
        actions: [{
          slug: "claw",
          type: "strike",
          label: "Claw",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "claw",
            system: { traits: { value: [] } },
          },
          roll: () => null,
        }, {
          slug: "pose-menacingly",
          type: "action",
          label: "Pose Menacingly",
          actions: { value: 1 },
          visible: true,
          description: {
            value: "<p>The monster takes an impressive pose.</p>",
          },
        }],
      },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
};
const npcUtilityBuild = buildCandidates(npcUtilityContext);
assert.equal(npcUtilityBuild.candidates.some((candidate) => candidate.slug === "pose-menacingly"), false);
assert.equal(npcUtilityBuild.detected.some((candidate) => candidate.slug === "pose-menacingly"), true);
assert.equal(
  npcUtilityBuild.rejected.some((entry) =>
    entry.action?.slug === "pose-menacingly"
    && entry.reason === "Low-confidence NPC utility hidden because stronger combat options exist.",
  ),
  true,
);

const npcOnlyUtilityBuild = buildCandidates({
  ...npcUtilityContext,
  actor: {
    ...npcUtilityContext.actor,
    document: {
      ...npcUtilityContext.actor.document,
      system: {
        actions: npcUtilityContext.actor.document.system.actions.filter((action) => action.slug === "pose-menacingly"),
      },
    },
  },
  targets: [],
  battlefield: { enemies: [], targets: [], allies: [] },
});
assert.equal(npcOnlyUtilityBuild.candidates.some((candidate) => candidate.slug === "pose-menacingly"), true);

assert.equal(
  readActionSources({ ...hydraContext, isGM: true }).some((action) => action.slug === "recall-knowledge"),
  false,
  "GM NPC action sources should not include Recall Knowledge at all",
);

const pounceContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      ...hydraContext.actor.document,
      system: {
        actions: [{
          slug: "rending-pounce",
          label: "Rending Pounce",
          actions: { value: 2 },
          visible: true,
          description: {
            value: "<p>The monster Strides up to its Speed and makes a jaws Strike.</p>",
          },
        }],
      },
    },
  },
  targets: [{
    ...hydraContext.targets[0],
    distance: 30,
  }],
};
const pounceCandidate = buildCandidates(pounceContext).candidates
  .find((candidate) => candidate.slug === "rending-pounce");
assert.equal(pounceCandidate.source, "system-inferred");
assert.equal(pounceCandidate.role, "mobility-attack");
assert.equal(pounceCandidate.activityProfile.includesStrike, true);
assert.equal(pounceCandidate.activityProfile.requiresBackingStrike, true, "the generic move-and-strike classifier fallback must tag its output as needing a borrowed weapon, the same as the curated Sudden Charge entry -- otherwise any uncurated ability matching this shape (like this real NPC ability) silently executes as inert text instead of moving and striking");

const twinTakedownShapedAction = {
  id: "custom-dual-strike",
  name: "Custom Dual Strike",
  slug: "custom-dual-strike",
  actionCost: 1,
  description: "Requirements You are wielding two melee weapons, each in a different hand. Make two Strikes against the same target, one with each of the required weapons. Apply your multiple attack penalty to each Strike normally.",
};
const twinTakedownShapedResult = classifySystemAction(twinTakedownShapedAction, { actionCost: 1, type: "action" });
assert.equal(twinTakedownShapedResult.role, "multiattack");
assert.equal(twinTakedownShapedResult.activityProfile.requiresBackingStrike, true, "an uncurated ability whose Requirements clause matches Twin Takedown's own real templated text ('wielding two melee weapons, each in a different hand') must get the same generic treatment Twin Takedown itself received, with zero curation");
assert.equal(twinTakedownShapedResult.activityProfile.requiresDualBackingStrike, true);
assert.equal(twinTakedownShapedResult.activityProfile.mapAppliesPerStrike, true, "the text has no 'counts as N attacks' phrase, so this ability must escalate MAP normally per strike, like the real Twin Takedown");
assert.equal(twinTakedownShapedResult.activityProfile.backingStrikeFilter, undefined);
assert.deepEqual(twinTakedownShapedResult.activityProfile.includes, ["strike", "strike"], "the classifier must tell the atomizer to build TWO Strike atoms, not baseAttackProfile's default single 'strike' -- otherwise builderAtomicActionsForStep silently produces only one atom and the whole borrowed-weapon mechanism never fires");

const doubleSliceShapedAction = {
  id: "custom-double-slice",
  name: "Custom Double Slice",
  slug: "custom-double-slice",
  actionCost: 1,
  description: "Requirements You are wielding two melee weapons, each in a different hand. Make two Strikes, one with each of your two melee weapons, each using your current multiple attack penalty. This counts as two attacks when calculating your multiple attack penalty.",
};
const doubleSliceShapedResult = classifySystemAction(doubleSliceShapedAction, { actionCost: 1, type: "action" });
assert.equal(doubleSliceShapedResult.activityProfile.requiresBackingStrike, true);
assert.equal(doubleSliceShapedResult.activityProfile.requiresDualBackingStrike, true, "the real fighter feat Double Slice uses the identical 'wielding two melee weapons, each in a different hand' requirement as Twin Takedown, and is NOT curated anywhere in this codebase -- this is the generalization proof");
assert.equal(doubleSliceShapedResult.activityProfile.mapAttacks, 2, "the existing, unmodified readMapAttacks helper must still detect this ability's own 'counts as two attacks' phrase");
assert.equal(doubleSliceShapedResult.activityProfile.mapAppliesPerStrike, undefined, "unlike Twin Takedown, Double Slice's own text says its two Strikes count as two attacks (Double Attack's shared-tier phrasing), not 'apply normally' -- it must NOT get the per-strike MAP flag, so it falls into the pre-existing shared-tier behavior instead");
assert.deepEqual(doubleSliceShapedResult.activityProfile.includes, ["strike", "strike"]);

const huntedShotShapedAction = {
  id: "custom-ranged-shot",
  name: "Custom Ranged Shot",
  slug: "custom-ranged-shot",
  actionCost: 1,
  description: "Requirements You are wielding a ranged weapon with reload 0. Make two Strikes against the same target with the required weapon. Apply your multiple attack penalty to each Strike normally.",
};
const huntedShotShapedResult = classifySystemAction(huntedShotShapedAction, { actionCost: 1, type: "action" });
assert.equal(huntedShotShapedResult.activityProfile.requiresBackingStrike, true);
assert.equal(huntedShotShapedResult.activityProfile.backingStrikeFilter, "ranged-reload-zero", "an uncurated ability whose Requirements clause matches Hunted Shot's own real templated text must get the same weapon-class filter");
assert.equal(huntedShotShapedResult.activityProfile.requiresDualBackingStrike, undefined);
assert.equal(huntedShotShapedResult.activityProfile.mapAppliesPerStrike, true);
assert.deepEqual(huntedShotShapedResult.activityProfile.includes, ["strike", "strike"]);

const flurryShapedAction = {
  id: "custom-flurry",
  name: "Custom Flurry",
  slug: "custom-flurry",
  actionCost: 1,
  description: "Make two unarmed Strikes. If both hit the same creature, combine their damage for the purpose of resistances and weaknesses. Apply your multiple attack penalty to the Strikes normally.",
};
const flurryShapedResult = classifySystemAction(flurryShapedAction, { actionCost: 1, type: "action" });
assert.equal(flurryShapedResult.activityProfile.requiresBackingStrike, true, "Flurry of Blows' real text has NO 'Requirements' clause at all -- the unarmed-strike detection must work from the ability's main body text too, not just a Requirements clause");
assert.equal(flurryShapedResult.activityProfile.backingStrikeFilter, "unarmed");
assert.equal(flurryShapedResult.activityProfile.requiresDualBackingStrike, undefined);
assert.equal(flurryShapedResult.activityProfile.mapAppliesPerStrike, true);
assert.deepEqual(flurryShapedResult.activityProfile.includes, ["strike", "strike"]);

const dualHandedAssaultShapedAction = {
  id: "custom-dual-handed",
  name: "Custom Dual-Handed Assault",
  slug: "custom-dual-handed",
  actionCost: 1,
  description: "Requirements You are wielding a one-handed melee weapon and have a free hand. Make a Strike with the required weapon using two hands.",
};
const dualHandedAssaultShapedResult = classifySystemAction(dualHandedAssaultShapedAction, { actionCost: 1, type: "action" });
assert.notEqual(dualHandedAssaultShapedResult?.role, "multiattack", "a single-Strike ability that merely mentions a free hand must not be misdetected as a two-weapon multiattack, and must not reach the new branch at all");

const ordinaryMultiStrikeAction = {
  id: "custom-ordinary-multistrike",
  name: "Custom Double Claw",
  slug: "custom-ordinary-multistrike",
  actionCost: 1,
  description: "Make two claw Strikes against the same target.",
};
const ordinaryMultiStrikeResult = classifySystemAction(ordinaryMultiStrikeAction, { actionCost: 1, type: "action" });
assert.equal(ordinaryMultiStrikeResult.activityProfile.multiStrike, true);
assert.equal(ordinaryMultiStrikeResult.activityProfile.requiresBackingStrike, undefined, "an ordinary same-target multi-strike ability with no weapon-class or two-weapon requirement in its text must NOT get any of the new flags -- it stays exactly as it classified before this plan");
assert.equal(ordinaryMultiStrikeResult.activityProfile.backingStrikeFilter, undefined);
assert.equal(ordinaryMultiStrikeResult.activityProfile.requiresDualBackingStrike, undefined);
assert.equal(ordinaryMultiStrikeResult.activityProfile.mapAppliesPerStrike, undefined);

const twinTakedownShapedAtoms = builderAtomicActionsForStep({
  ...twinTakedownShapedAction,
  ...twinTakedownShapedResult,
});
assert.equal(twinTakedownShapedAtoms.length, 2, "end-to-end: an uncurated dual-weapon-shaped ability must actually atomize into two real Strike atoms when piped through the real builder, not just carry the right flags in isolation");

const itemAbilityContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "sweeping-claws",
          name: "Sweeping Claws",
          type: "action",
          system: {
            slug: "sweeping-claws",
            actionType: { value: "action" },
            actions: { value: 2 },
            description: {
              value: "<p>The monster makes two claw Strikes, each against a different target.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  battlefield: {
    enemies: [{
      id: "enemy-1",
      name: "Enemy One",
      distance: 5,
    }, {
      id: "enemy-2",
      name: "Enemy Two",
      distance: 10,
    }],
    targets: [{
      id: "enemy-1",
      name: "Enemy One",
      distance: 5,
    }],
  },
  targets: undefined,
};
const itemAbilityCandidate = buildCandidates(itemAbilityContext).candidates
  .find((candidate) => candidate.slug === "sweeping-claws");
assert.equal(itemAbilityCandidate.source, "system-inferred");
assert.equal(itemAbilityCandidate.role, "multiattack");
assert.ok(itemAbilityCandidate.score > 100);

const wornHealingPotion = {
  id: "healing-potion-minor",
  name: "Healing Potion (Minor)",
  type: "consumable",
  system: {
    slug: "healing-potion-minor",
    category: "potion",
    usage: { value: "held-in-one-hand" },
    equipped: { carryType: "worn", handsHeld: 0 },
    quantity: 1,
    traits: { value: ["consumable", "healing", "magical", "potion"] },
    description: {
      value: "<p><strong>Activate</strong> A (manipulate)</p><p>When you drink a healing potion, you regain @Damage[1d8[healing]] Hit Points.</p>",
    },
  },
};
const wornPotionCost = readActionCost(wornHealingPotion);
assert.equal(wornPotionCost.activationActionCost, 1);
assert.equal(wornPotionCost.interactDrawCost, 1);
assert.equal(wornPotionCost.actionCost, 2);

const heldPotionCost = readActionCost({
  ...wornHealingPotion,
  system: {
    ...wornHealingPotion.system,
    equipped: { carryType: "held", handsHeld: 1 },
  },
});
assert.equal(heldPotionCost.actionCost, 1);
assert.equal(heldPotionCost.interactDrawCost ?? 0, 0);

const potionClassification = classifySystemAction(wornHealingPotion, wornPotionCost);
assert.equal(potionClassification.role, "healing");
assert.equal(potionClassification.activityProfile.consumable, true);
assert.equal(potionClassification.activityProfile.interactDraw, true);

const giantCentipedeVenom = {
  id: "giant-centipede-venom",
  name: "Giant Centipede Venom",
  type: "consumable",
  system: {
    slug: "giant-centipede-venom",
    category: "poison",
    traits: { value: ["consumable", "poison"] },
    description: {
      value: "<p>Giant centipede venom causes severe muscle stiffness.</p><hr><p><strong>Activate</strong> <span class=\"action-glyph\">2</span> (manipulate)</p><p><strong>Saving Throw</strong> @Check[fortitude|dc:17]</p><p><strong>Maximum Duration</strong> 6 rounds</p><p><strong>Stage 1</strong> @Damage[1d4[poison]] and clumsy 1 (1 round)</p>",
    },
  },
};
const venomClassification = classifySystemAction(giantCentipedeVenom, { actionCost: 2 });
assert.equal(
  venomClassification?.role,
  "setup",
  "an apply-poison consumable activates the poison onto a weapon; the save only fires on a later Strike, so it must not classify as an instant save-damage attack",
);

const potionContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    hpPercent: 0.35,
  },
  actor: {
    ...fighterContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [wornHealingPotion],
      },
      items: [],
    },
  },
};
const potionAction = readActionSources(potionContext).find((action) => action.slug === "healing-potion-minor");
assert.equal(potionAction.name, "Interact -> Healing Potion (Minor)");
assert.equal(potionAction.actionCost, 2);
assert.equal(potionAction.activationActionCost, 1);
assert.equal(potionAction.interactDrawCost, 1);
assert.equal(potionAction.role, "healing");
const scoredPotion = scoreCandidate(potionContext, potionAction);
assert.ok(scoredPotion.reasons.includes("Includes Interact to draw or retrieve the consumable."));
assert.ok(scoredPotion.reasons.includes("Valeros is badly injured."));

const mundaneChalk = {
  id: "chalk",
  name: "Chalk",
  type: "consumable",
  system: {
    slug: "chalk",
    category: "other",
    usage: { value: "held-in-one-hand" },
    equipped: { carryType: "worn", handsHeld: 0 },
    quantity: 10,
    actionType: { value: "action" },
    traits: { value: ["common", "consumable"] },
    description: { value: "<p>A piece of chalk used for marking surfaces.</p>" },
  },
};
assert.equal(readActionCost(mundaneChalk).actionCost, null);
const chalkContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [mundaneChalk],
      },
      items: [],
    },
  },
};
assert.equal(readActionSources(chalkContext).some((action) => action.slug === "chalk"), false);
assert.equal(buildCandidates(chalkContext).candidates.some((candidate) => candidate.slug === "chalk"), false);

const poisonDisplaySteps = displayStepEntries([{
  id: "item-giant-centipede-venom",
  name: "Interact -> Giant Centipede Venom",
  actionCost: 3,
  activationActionCost: 2,
  interactDrawCost: 1,
  suggestedTarget: { name: "Mitflit" },
  reason: "Giant Centipede Venom can force a fortitude save.",
}]);
assert.deepEqual(poisonDisplaySteps.map((entry) => entry.step.name), ["Interact", "Giant Centipede Venom"]);
assert.deepEqual(poisonDisplaySteps.map((entry) => entry.step.actionCost), [1, 2]);
assert.deepEqual(poisonDisplaySteps.map((entry) => entry.sourceIndex), [0, 0]);
assert.equal(poisonDisplaySteps[0].step.reason, "Draw or retrieve Giant Centipede Venom.");
assert.equal(poisonDisplaySteps[1].step.suggestedTarget.name, "Mitflit");

const activatedCloak = {
  id: "cloak-of-illusions",
  name: "Cloak of Illusions",
  type: "equipment",
  system: {
    slug: "cloak-of-illusions",
    usage: { value: "worncloak" },
    equipped: { carryType: "worn", handsHeld: 0 },
    traits: { value: ["illusion", "invested", "magical"] },
    actionType: { value: "passive" },
    description: {
      value: "<p>This cloak bends nearby light.</p><hr /><p><strong>Activate—Draw Hood</strong> <span class=\"action-glyph\">2</span> (manipulate)</p><p><strong>Effect</strong> You become invisible.</p>",
    },
  },
};
const activatedCloakCost = readActionCost(activatedCloak);
assert.equal(activatedCloakCost.actionCost, 2);
assert.equal(activatedCloakCost.type, "action");
assert.equal(activatedCloakCost.activationInDescription, true);

const activatedArmorCost = readActionCost({
  id: "second-chance-shield",
  name: "Second Chance Shield",
  type: "armor",
  system: {
    slug: "second-chance-shield",
    traits: { value: ["magical"] },
    description: {
      value: "<p><strong>Activate—Second Chance</strong> <span class=\"action-glyph\">R</span> (fortune)</p><p><strong>Trigger</strong> You would die.</p>",
    },
  },
});
assert.equal(activatedArmorCost.actionCost, "reaction");
assert.equal(activatedArmorCost.type, "reaction");

const longActivationCost = readActionCost({
  id: "planar-ribbon",
  name: "Planar Ribbon",
  type: "equipment",
  system: {
    slug: "planar-ribbon",
    traits: { value: ["occult"] },
    description: {
      value: "<p><strong>Activate</strong> 1 minute (command, envision, Interact)</p><p><strong>Effect</strong> You open a viewing window.</p>",
    },
  },
});
assert.equal(longActivationCost.actionCost, null);

const activatedItemContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [],
        feat: [],
        feature: [],
        consumable: [],
        equipment: [activatedCloak],
      },
      items: [],
    },
  },
};
const activatedItemAction = readActionSources(activatedItemContext)
  .find((action) => action.slug === "cloak-of-illusions");
assert.equal(activatedItemAction.source, "system-inferred");
assert.equal(activatedItemAction.role, "utility");
assert.equal(activatedItemAction.actionCost, 2);
assert.equal(activatedItemAction.activationActionCost, 2);

const throwRockClassification = classifySystemAction({
  name: "Throw Rock",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.ThrowRock]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(throwRockClassification.role, "damage");
assert.equal(throwRockClassification.activityProfile.includesStrike, true);
assert.equal(throwRockClassification.targetingProfile.maxRange, 120);

const scoredThrowRock = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 60,
  }],
}, {
  id: "throw-rock",
  name: "Throw Rock",
  slug: "throw-rock",
  actionCost: 1,
  source: "system-inferred",
  role: throwRockClassification.role,
  activityProfile: throwRockClassification.activityProfile,
  targetingProfile: throwRockClassification.targetingProfile,
});
assert.ok(scoredThrowRock.score > 70);
assert.equal(scoredThrowRock.suggestedTarget.name, "Ogre");

const huntPreyClassification = classifySystemAction({
  name: "Hunt Prey",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>The hunter designates a single creature as prey. The first time it hits its hunted prey in a round, it deals 1d8 additional precision damage.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(huntPreyClassification.role, "setup");
assert.deepEqual(huntPreyClassification.setupFor, ["strike", "damage"]);

const exploitVulnerabilityClassification = classifySystemAction({
  name: "Exploit Vulnerability",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>You scour your experiences and learning to identify something that might repel your foe. You attempt an Esoteric Lore check and exploit mortal weakness or apply a personal antithesis. Your Strikes gain bonus damage.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(exploitVulnerabilityClassification.role, "setup");
assert.equal(exploitVulnerabilityClassification.activityProfile.targetMark, "exploited-vulnerability");
assert.deepEqual(exploitVulnerabilityClassification.setupFor, ["strike", "damage"]);

const swiftLeapClassification = classifySystemAction({
  name: "Swift Leap",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["move"] },
    description: {
      value: "<p>The cultist jumps up to half its Speed. This movement doesn't trigger reactions.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(swiftLeapClassification.role, "mobility");
assert.equal(swiftLeapClassification.activityProfile.strideCount, 0.5);
assert.equal(swiftLeapClassification.activityProfile.safeMovement, true);

const gallopClassification = classifySystemAction({
  name: "Gallop",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: {
      value: "<p>The war pony Strides twice. It has a +10-foot circumstance bonus to its Speed during these Strides.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(gallopClassification.role, "mobility");
assert.equal(gallopClassification.activityProfile.strideCount, 2);

const tumbleBehindClassification = classifySystemAction({
  name: "Tumble Behind",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["move"] },
    description: {
      value: "<p>The rogue Tumbles Through an enemy's space. If successful, the enemy is off-guard against the rogue's next Strike this turn.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(tumbleBehindClassification.role, "setup");
assert.equal(tumbleBehindClassification.activityProfile.appliesCondition, "off-guard");
assert.deepEqual(tumbleBehindClassification.setupFor, ["strike", "damage"]);

const drinkBloodClassification = classifySystemAction({
  name: "Drink Blood",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>Requirement A @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}, @UUID[Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM]{Restrained}, or willing creature is within reach. Effect The vampire drinks its blood. This requires an @Check[athletics|defense:fortitude] check. The victim is @UUID[Compendium.pf2e.conditionitems.Item.4D2KBtexWXa6oUMR]{Drained 2} and the vampire regains Hit Points.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(drinkBloodClassification.role, "drain");
assert.deepEqual(drinkBloodClassification.activityProfile.requiresAnyTargetCondition, ["grabbed", "restrained", "paralyzed", "unconscious"]);
assert.equal(drinkBloodClassification.activityProfile.appliesCondition, "drained");

const scoredDrinkBlood = scoreCandidate({
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    hpPercent: 0.3,
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
    conditions: { slugs: ["grabbed"], values: { grabbed: 1 } },
  }],
}, {
  id: "drink-blood",
  name: "Drink Blood",
  slug: "drink-blood",
  actionCost: 1,
  source: "system-inferred",
  role: drinkBloodClassification.role,
  activityProfile: drinkBloodClassification.activityProfile,
});
assert.ok(scoredDrinkBlood.score > 90);

const focusGazeClassification = classifySystemAction({
  name: "Focus Gaze",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["concentrate", "mental", "visual"] },
    description: {
      value: "<p>The creature fixes its glare at a creature it can see within 30 feet. The target must immediately attempt a Will save. On a failed save, it is Paralyzed for 1 round.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(focusGazeClassification.role, "control");
assert.equal(focusGazeClassification.saveProfile.stat, "will");
assert.equal(focusGazeClassification.targetingProfile.maxRange, 30);

const fastSwallowClassification = classifySystemAction({
  name: "Fast Swallow",
  system: {
    actionType: { value: "reaction" },
    actions: { value: null },
    category: "offensive",
    description: {
      value: "<p><strong>Trigger</strong> The monster Grabs a creature. <strong>Effect</strong> The monster uses Swallow Whole.</p>",
    },
  },
}, { actionCost: "reaction", type: "reaction" });
assert.equal(fastSwallowClassification.role, "control");
assert.equal(fastSwallowClassification.activityProfile.reaction, true);

const consumeFleshClassification = classifySystemAction({
  name: "Consume Flesh",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["manipulate"] },
    description: {
      value: "<p>Requirements The ghoul is adjacent to the corpse of a creature that died within the last hour. Effect The ghoul devours flesh and regains @Damage[3d6[healing]] Hit Points.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(consumeFleshClassification.role, "self-healing");
assert.equal(consumeFleshClassification.activityProfile.requiresCorpse, true);
assert.equal(consumeFleshClassification.damageProfile.type, "healing");

const poisonWeaponClassification = classifySystemAction({
  name: "Poison Weapon",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>The rogue applies poison to a piercing or slashing weapon. If the next attack hits, it applies the poison.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(poisonWeaponClassification.role, "setup");
assert.deepEqual(poisonWeaponClassification.setupFor, ["strike", "damage"]);
assert.equal(poisonWeaponClassification.activityProfile.weaponBuff, true);

const changeShapeClassification = classifySystemAction({
  name: "Change Shape",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["concentrate", "polymorph"] },
    description: {
      value: "<p>The creature changes into human form. While in human form it can't use its fangs attack. @Localize[PF2E.NPC.Abilities.Glossary.ChangeShape]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(changeShapeClassification.role, "transformation");
assert.equal(changeShapeClassification.activityProfile.includesStrike, false);

const rageClassification = classifySystemAction({
  name: "Rage",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The creature flies into a rage and gains bonus damage with melee Strikes.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(rageClassification.role, "setup");
assert.deepEqual(rageClassification.setupFor, ["strike", "damage"]);

const burningJetClassification = classifySystemAction({
  name: "Burning Jet",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    traits: { value: ["fire", "impulse", "primal"] },
    description: {
      value: "<p>A condensed burst of flame shoots behind you. Stride up to 40 feet in a straight line. Movement from this impulse ignores difficult terrain and doesn't trigger reactions.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(burningJetClassification.role, "mobility");
assert.equal(burningJetClassification.activityProfile.fixedDistance, 40);
assert.equal(burningJetClassification.activityProfile.safeMovement, true);

// Crawling Fire summons a creature that Strides via Sustain ("you can have the crawling fire Stride
// up to 40 feet") — that's the minion moving, not the actor. It must NOT be classified as the actor's
// own movement, or it gets wrongly move-gated (e.g. disabled while the actor is prone).
const crawlingFireClassification = classifySystemAction({
  name: "Crawling Fire",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    traits: { value: ["fire", "impulse", "manipulate", "primal"] },
    description: {
      value: "<p>You mimic the motions of a beast, and it becomes real, appearing in an unoccupied space within 30 feet. The creation lasts until the end of your next turn, but you can Sustain it up to 1 minute. Each time you Sustain it, you can have the crawling fire Stride up to 40 feet.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.notEqual(crawlingFireClassification.role, "mobility", "Crawling Fire's Stride belongs to the summoned creature, not the actor");

const blazingWaveClassification = classifySystemAction({
  name: "Blazing Wave",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    traits: { value: ["fire", "impulse", "primal"] },
    description: {
      value: "<p>Creatures in a 30-foot cone take @Damage[4d6[fire]] damage with a basic @Check[reflex] save.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(blazingWaveClassification.role, "area-damage");
assert.equal(blazingWaveClassification.targetingProfile.type, "cone");
assert.equal(blazingWaveClassification.targetingProfile.distance, 30);

const reachSpellClassification = classifySystemAction({
  name: "Reach Spell",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The next spell the creature casts this turn has its range increased.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(reachSpellClassification.role, "setup");
assert.deepEqual(reachSpellClassification.setupFor, ["spell", "damage", "control"]);

const drainBondedItemClassification = classifySystemAction({
  name: "Drain Bonded Item",
  system: {
    actionType: { value: "free" },
    actions: { value: null },
    category: "offensive",
    description: { value: "<p>The wizard expends the power stored in their bonded item to cast one spell they prepared and already cast today.</p>" },
  },
}, { actionCost: 0, type: "free" });
assert.equal(drainBondedItemClassification.role, "resource-recovery");

const rechargeClassification = classifySystemAction({
  name: "Recharge Breath Weapon",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The creature recharges its breath weapon.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(rechargeClassification.role, "resource-recovery");
assert.equal(rechargeClassification.activityProfile.npcFamily, "recharge");

const runningReloadClassification = classifySystemAction({
  name: "Running Reload",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>The creature Strides, Steps, or Sneaks, then Interacts to reload.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(runningReloadClassification.role, "mobility");
assert.equal(runningReloadClassification.activityProfile.reload, true);

const bloodDrainClassification = classifySystemAction({
  name: "Blood Drain",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "<p>Requirements A grabbed or restrained creature is within reach. The monster drains blood, dealing damage and regaining Hit Points.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(bloodDrainClassification.role, "drain");

const battleMedicineClassification = classifySystemAction({
  name: "Battle Medicine",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    description: { value: "<p>The healer uses Medicine to patch wounds during combat and restore Hit Points.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(battleMedicineClassification.role, "healing");

const raiseShieldClassification = classifySystemAction({
  name: "Raise a Shield",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    description: { value: "<p>The creature positions its shield to protect itself until its next turn.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(raiseShieldClassification.role, "defense");

const grabClassification = classifySystemAction({
  name: "Grab",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Localize[PF2E.NPC.Abilities.Glossary.Grab]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(grabClassification.role, "grab");
assert.equal(grabClassification.activityProfile.includesGrab, true);
assert.equal(grabClassification.activityProfile.appliesCondition, "grabbed");
assert.equal(grabClassification.activityProfile.npcFamily, "grab-rider");
assert.deepEqual(grabClassification.activityProfile.previousActionRequirements, ["after-strike"]);

const arcaneSlamClassification = classifySystemAction({
  name: "Arcane Slam",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p><strong>Requirements</strong> The champion has a creature @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}. <strong>Effect</strong> The grabbed creature takes @Damage[3d6[bludgeoning]] and @Damage[3d6[fire]] damage, is knocked @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone} and must attempt a @Check[fortitude|dc:29] save.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(arcaneSlamClassification.role, "save-damage");
assert.equal(arcaneSlamClassification.activityProfile.requiresTargetCondition, "grabbed");

const captiveRakeClassification = classifySystemAction({
  name: "Captive Rake",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p><strong>Requirements</strong> A creature is grabbed in the glabrezu's pincer. <strong>Effect</strong> The glabrezu pulls the grabbed creature closer, then makes two claw Strikes against it.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(captiveRakeClassification.role, "multiattack");
assert.equal(captiveRakeClassification.activityProfile.requiresTargetCondition, "grabbed");

const haulAwayClassification = classifySystemAction({
  name: "Haul Away",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p><strong>Requirements</strong> The giant ant army has at least one restrained creature. <strong>Effect</strong> The army Strides up to its Speed, carrying any restrained creatures with it.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(haulAwayClassification.role, "mobility");
assert.equal(haulAwayClassification.activityProfile.requiresTargetCondition, "restrained");

const focusedGazeCooldownClassification = classifySystemAction({
  name: "Focused Gaze",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["concentrate", "visual"] },
    description: {
      value: "<p>The bythos focuses its gaze on a creature it can see within 30 feet. A bythos can't use this ability against the same creature more than once per turn.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(focusedGazeCooldownClassification.activityProfile.npcFamily, "gaze");
assert.equal(focusedGazeCooldownClassification.gatingProfile.frequency, true);

const aldoriParryClassification = classifySystemAction({
  name: "Aldori Parry",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    description: {
      value: "<p>The swordlord gains a +2 circumstance bonus to AC until the start of their next turn.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(aldoriParryClassification.role, "defense");
assert.equal(aldoriParryClassification.activityProfile.acBuff, true);
assert.equal(aldoriParryClassification.activityProfile.parry, true);

const goDarkClassification = classifySystemAction({
  name: "Go Dark",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    traits: { value: ["concentrate"] },
    description: {
      value: "<p>The will-o'-wisp extinguishes its glow, becoming invisible. It can end this effect with another use of this action.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(goDarkClassification.role, "stealth-defense");
assert.equal(goDarkClassification.activityProfile.invisible, true);
assert.equal(goDarkClassification.targetingProfile.self, true);

const barkOrdersClassification = classifySystemAction({
  name: "Bark Orders",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "interaction",
    traits: { value: ["auditory", "linguistic"] },
    description: {
      value: "<p>The captain barks orders to an ally within 30 feet. The ally can immediately Step or Strike.</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(barkOrdersClassification.role, "buff");
assert.equal(barkOrdersClassification.activityProfile.commandSupport, true);
assert.equal(barkOrdersClassification.activityProfile.extraAction, true);
assert.deepEqual(barkOrdersClassification.setupFor, ["strike", "damage"]);

const efficientCaptureClassification = classifySystemAction({
  name: "Efficient Capture",
  system: {
    actionType: { value: "action" },
    actions: { value: 3 },
    category: "offensive",
    traits: { value: ["attack", "manipulate"] },
    description: {
      value: "<p><strong>Requirements</strong> The sneak has manacles in hand and is adjacent to a creature. <strong>Effect</strong> The sneak attempts to bind the creature's wrists or ankles with the manacles. On a success, the creature is restrained.</p>",
    },
  },
}, { actionCost: 3, type: "action" });
assert.equal(efficientCaptureClassification.role, "control");
assert.equal(efficientCaptureClassification.activityProfile.npcFamily, "capture-restraint");
assert.equal(efficientCaptureClassification.activityProfile.appliesCondition, "restrained");

const skirmishingDashClassification = classifySystemAction({
  name: "Skirmishing Dash",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: {
      value: "<p>The duelist Strides or Steps, then Strikes. This Strike deals an additional 3d6 damage.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(skirmishingDashClassification.role, "mobility-attack");
assert.equal(skirmishingDashClassification.damageProfile.formula, "3d6");

{
  const flintTarget = {
    id: "flint",
    name: "Flint Glade",
    distance: 5,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    saves: { fortitude: 12, reflex: 15, will: 18 },
    ac: 24,
    token: { center: { x: 0, y: 5 } },
  };
  const target = {
    id: "centipede",
    name: "Giant Centipede",
    distance: 5,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    saves: { fortitude: 8, reflex: 15, will: 12 },
    ac: 24,
    token: { center: { x: 5, y: 0 } },
  };
  const actionItem = (id, name, description) => ({
    id,
    name,
    type: "action",
    slug: id,
    system: {
      slug: id,
      actionType: { value: "action" },
      actions: { value: 1 },
      category: "offensive",
      description: { value: description },
      traits: { value: [] },
    },
  });
  const championAutomatonContext = {
    isGM: true,
    actor: {
      id: "champion-automaton",
      name: "Champion Automaton",
      document: {
        type: "npc",
        system: {
          actions: [{
            slug: "pincer",
            type: "strike",
            label: "Pincer",
            visible: true,
            ready: true,
            canAttack: true,
            traits: ["magical"],
            item: {
              id: "pincer",
              system: {
                traits: { value: ["magical"] },
                damageRolls: { main: { damage: "2d12+12", damageType: "piercing" } },
              },
            },
            roll: () => null,
          }],
        },
        items: [],
        itemTypes: {
          action: [
            actionItem("arcane-slam", "Arcane Slam", "<p><strong>Requirements</strong> The champion has a creature @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed}. <strong>Effect</strong> The grabbed creature takes @Damage[3d6[bludgeoning]] and @Damage[3d6[fire]] damage, is knocked @UUID[Compendium.pf2e.conditionitems.Item.j91X7x0XSomq8d60]{Prone} and must attempt a @Check[fortitude|dc:29] save.</p>"),
            actionItem("grab", "Grab", "<p><strong>Requirements</strong> The monster's last action was a successful Strike that lists Grab in its damage entry, or the monster has a creature @UUID[Compendium.pf2e.conditionitems.Item.kWc1fhmv9LBiTuei]{Grabbed} or @UUID[Compendium.pf2e.conditionitems.Item.VcDeM8A5oI6VqhbM]{Restrained}. <strong>Effect</strong> If used after a Strike, the monster attempts to @UUID[Compendium.pf2e.actionspf2e.Item.PMbdMWc2QroouFGD]{Grapple} the creature.</p>"),
          ],
          feat: [],
          feature: [],
          consumable: [],
        },
      },
    },
    profile: {
      actorType: "npc",
      hpPercent: 1,
      reach: 10,
      speed: 25,
      conditions: { slugs: [], values: {} },
      skills: { athletics: { mod: 27, rank: 4 } },
    },
    token: { center: { x: 0, y: 0 } },
    targets: [flintTarget, target],
    battlefield: { targets: [flintTarget, target], enemies: [flintTarget, target], allies: [] },
  };
  const automatonCandidates = buildCandidates(championAutomatonContext).candidates;
  assert.ok(automatonCandidates.some((candidate) => candidate.name === "Grab"), "Champion Automaton should expose NPC Grab as a candidate");
  const automatonPlan = bestTurnPlan(championAutomatonContext, automatonCandidates);
  assert.equal(automatonPlan.summary, "Pincer -> Grab -> Arcane Slam", `grab-gated follow-up plan should include Grab before Arcane Slam, got ${automatonPlan.summary}`);
  assert.equal(
    new Set(automatonPlan.steps.map((step) => step.preferredTarget?.name ?? step.suggestedTarget?.name)).size,
    1,
    "grab-gated follow-up plan should keep Strike, Grab, and Arcane Slam on one target",
  );

  const targetedPincer = {
    id: "targeted-pincer",
    slug: "pincer",
    name: "Pincer",
    source: "strike",
    actionCost: 1,
    score: 116,
    confidence: 0.9,
    attack: true,
    preferredTarget: target,
  };
  const offTargetGrab = {
    id: "off-target-grab",
    slug: "grab",
    name: "Grab",
    source: "system-inferred",
    role: "grab",
    actionCost: 1,
    score: 108,
    confidence: 0.9,
    suggestedTarget: flintTarget,
    activityProfile: {
      includesGrab: true,
      appliesCondition: "grabbed",
      previousActionRequirements: ["after-strike"],
    },
  };
  const offTargetArcaneSlam = {
    id: "off-target-arcane-slam",
    slug: "arcane-slam",
    name: "Arcane Slam",
    source: "system-inferred",
    role: "save-damage",
    actionCost: 1,
    score: 122,
    confidence: 0.9,
    suggestedTarget: flintTarget,
    activityProfile: { requiresTargetCondition: "grabbed" },
  };
  const mixedTargetPlan = bestTurnPlan(championAutomatonContext, [
    {
      id: "demoralize",
      slug: "demoralize",
      name: "Demoralize",
      source: "generic",
      role: "debuff",
      actionCost: 1,
      score: 64,
      confidence: 0.7,
      suggestedTarget: flintTarget,
      setupFor: ["attack"],
      activityProfile: { appliesCondition: "frightened" },
    },
    targetedPincer,
    offTargetGrab,
    offTargetArcaneSlam,
  ]);
  assert.equal(mixedTargetPlan.summary, "Pincer -> Grab -> Arcane Slam");
  assert.deepEqual(
    mixedTargetPlan.steps.map((step) => step.preferredTarget?.name ?? step.suggestedTarget?.name),
    ["Giant Centipede", "Giant Centipede", "Giant Centipede"],
    "Grab and Arcane Slam should inherit the struck/grabbed target, not the first target",
  );

  const liveLikeFillers = [
    ["stride-away-strike-energy-beam", "Stride Away -> Energy Beam", "system-inferred", 126, 2],
    ["spinning-toss", "Spinning Toss", "system-inferred", 124, 2],
    ["strike-energy-beam", "Energy Beam", "strike", 115, 1],
    ["trip", "Trip", "generic", 108, 1],
    ["reposition", "Reposition", "generic", 106, 1],
    ["shove", "Shove", "generic", 105, 1],
    ["disarm", "Disarm", "generic", 103, 1],
    ["generic-drop-prone", "Drop Prone", "system-inferred", 102, 1],
    ["take-cover", "Take Cover", "generic", 101, 1],
    ["raise-a-shield", "Raise a Shield", "generic", 100, 1],
    ["step", "Step", "generic", 99, 1],
    ["seek", "Seek", "generic", 98, 1],
  ].map(([slug, name, source, score, actionCost]) => ({
    id: slug,
    slug,
    name,
    source,
    actionCost,
    score,
    confidence: 0.7,
    suggestedTarget: flintTarget,
    ...(source === "strike" ? { attack: true, preferredTarget: target } : {}),
  }));
  const liveLikePlan = bestTurnPlan(championAutomatonContext, [
    ...liveLikeFillers,
    {
      id: "demoralize-live",
      slug: "demoralize",
      name: "Demoralize",
      source: "generic",
      role: "debuff",
      actionCost: 1,
      score: 110,
      confidence: 0.7,
      suggestedTarget: flintTarget,
      setupFor: ["attack"],
      activityProfile: { appliesCondition: "frightened" },
    },
    targetedPincer,
    {
      id: "grapple-live",
      slug: "grapple",
      name: "Grapple",
      source: "generic",
      role: "grab",
      actionCost: 1,
      score: 86,
      confidence: 0.7,
      attack: true,
      suggestedTarget: flintTarget,
    },
    { ...offTargetGrab, id: "buried-grab", score: 70 },
    offTargetArcaneSlam,
  ]);
  assert.equal(
    liveLikePlan.summary,
    "Pincer -> Grab -> Arcane Slam",
    `buried NPC Grab chain should beat filler strikes, got ${liveLikePlan.summary}`,
  );
  assert.deepEqual(
    liveLikePlan.steps.map((step) => step.preferredTarget?.name ?? step.suggestedTarget?.name),
    ["Giant Centipede", "Giant Centipede", "Giant Centipede"],
    "buried NPC Grab chain should stay on the struck target",
  );

  const genericGrappleFallbackPlan = bestTurnPlan(championAutomatonContext, [
    targetedPincer,
    {
      id: "generic-grapple-fallback",
      slug: "grapple",
      name: "Grapple",
      source: "generic",
      role: "grab",
      actionCost: 1,
      score: 86,
      confidence: 0.7,
      attack: true,
      suggestedTarget: flintTarget,
    },
    offTargetArcaneSlam,
  ]);
  assert.equal(genericGrappleFallbackPlan.summary, "Pincer -> Grapple -> Arcane Slam");
  assert.deepEqual(
    genericGrappleFallbackPlan.steps.map((step) => step.preferredTarget?.name ?? step.suggestedTarget?.name),
    ["Giant Centipede", "Giant Centipede", "Giant Centipede"],
    "generic Grapple fallback should inherit the struck target when it sets up Arcane Slam",
  );

  const farFlintTarget = {
    ...flintTarget,
    distance: 80,
    token: { center: { x: 80, y: 0 } },
  };
  const farGrabContext = {
    ...championAutomatonContext,
    targets: [farFlintTarget],
    battlefield: { targets: [farFlintTarget], enemies: [farFlintTarget], allies: [] },
  };
  const eventOnlyGrabPlan = bestTurnPlan({
    ...farGrabContext,
    triggerEvents: ["after-strike"],
  }, [
    { ...offTargetGrab, id: "event-only-grab", actionCost: 0, score: 160, suggestedTarget: farFlintTarget },
    { ...offTargetArcaneSlam, id: "event-only-arcane-slam", score: 150, suggestedTarget: farFlintTarget },
  ]);
  assert.ok(
    !eventOnlyGrabPlan.steps.some((step) => ["grab", "arcane-slam"].includes(step.slug)),
    `coarse after-strike event should not unlock far Grab chain, got ${eventOnlyGrabPlan.summary}`,
  );

  const rangedStrikeGrabPlan = bestTurnPlan(farGrabContext, [
    {
      id: "far-energy-beam",
      slug: "strike",
      name: "Energy Beam",
      source: "strike",
      actionCost: 1,
      score: 170,
      confidence: 0.9,
      attack: true,
      range: { max: 60 },
      traits: ["ranged"],
      preferredTarget: farFlintTarget,
    },
    { ...offTargetGrab, id: "ranged-strike-grab", score: 160, suggestedTarget: farFlintTarget },
    { ...offTargetArcaneSlam, id: "ranged-strike-arcane-slam", score: 150, suggestedTarget: farFlintTarget },
  ]);
  assert.ok(
    !rangedStrikeGrabPlan.steps.some((step) => ["grab", "arcane-slam"].includes(step.slug)),
    `ranged Strike should not unlock NPC Grab chain, got ${rangedStrikeGrabPlan.summary}`,
  );
}

const constrictClassification = classifySystemAction({
  name: "Constrict",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Damage[1d8+4[bludgeoning]] @Check[fortitude|dc:20|basic] @Localize[PF2E.NPC.Abilities.Glossary.Constrict]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(constrictClassification.role, "save-damage");
assert.equal(constrictClassification.saveProfile.stat, "fortitude");
assert.equal(constrictClassification.damageProfile.formula, "1d8+4");
assert.equal(constrictClassification.activityProfile.requiresTargetCondition, "grabbed");
assert.equal(constrictClassification.activityProfile.npcFamily, "grab-followup");

const swallowWholeClassification = classifySystemAction({
  name: "Swallow Whole",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: {
      value: "<p>@Damage[2d6[bludgeoning]] @Check[reflex|dc:21] @Localize[PF2E.NPC.Abilities.Glossary.SwallowWhole]</p>",
    },
  },
}, { actionCost: 1, type: "action" });
assert.equal(swallowWholeClassification.role, "control");
assert.equal(swallowWholeClassification.activityProfile.npcFamily, "swallow-whole");

const gazeClassification = classifySystemAction({
  name: "Terrifying Gaze",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: {
      value: "<p>The monster fixes its gaze on a creature within 30 feet. The target attempts a @Check[will|dc:20] save.</p>",
    },
  },
}, { actionCost: 2, type: "action" });
assert.equal(gazeClassification.role, "control");
assert.equal(gazeClassification.activityProfile.npcFamily, "gaze");

const auraClassification = classifySystemAction({
  name: "Frightful Aura",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "defensive",
    traits: { value: ["aura"] },
    description: { value: "<p>Allies near the creature are bolstered by its aura.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(auraClassification.role, "buff");
assert.equal(auraClassification.activityProfile.npcFamily, "aura");

const formUpClassification = classifySystemAction({
  name: "Form Up",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    traits: { value: ["troop"] },
    description: { value: "<p>The troop reforms its space.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(formUpClassification.role, "mobility");
assert.equal(formUpClassification.activityProfile.npcFamily, "troop-action");

const deathBurstClassification = classifySystemAction({
  name: "Death Throes",
  system: {
    actionType: { value: "free" },
    actions: { value: null },
    category: "offensive",
    description: {
      value: "<p>When reduced to 0 Hit Points, the creature explodes. @Template[type:burst|distance:10] @Damage[2d6[fire]] @Check[reflex|dc:18|basic]</p>",
    },
  },
}, { actionCost: 0, type: "free" });
assert.equal(deathBurstClassification.role, "area-damage");
assert.equal(deathBurstClassification.activityProfile.npcFamily, "death-trigger");

const breathWeaponContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "breath-weapon",
          name: "Breath Weapon",
          type: "action",
          system: {
            slug: null,
            actionType: { value: "action" },
            actions: { value: 2 },
            category: "offensive",
            description: {
              value: "<p>The dragon breathes fire. @Template[type:cone|distance:30] @Damage[5d6[fire]] @Check[reflex|dc:22|basic]</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  battlefield: {
    enemies: [{
      id: "enemy-1",
      name: "Ezren",
      distance: 20,
    }, {
      id: "enemy-2",
      name: "Valeros",
      distance: 25,
    }],
    allies: [],
    targets: [{
      id: "enemy-1",
      name: "Ezren",
      distance: 20,
    }],
  },
  targets: undefined,
};
const breathWeaponCandidate = buildCandidates(breathWeaponContext).candidates
  .find((candidate) => candidate.name === "Breath Weapon");
assert.equal(breathWeaponCandidate.source, "system-inferred");
assert.equal(breathWeaponCandidate.role, "area-damage");
assert.equal(breathWeaponCandidate.activityProfile.npcFamily, "breath-weapon");
assert.equal(breathWeaponCandidate.targetingProfile.area, true);
assert.equal(breathWeaponCandidate.saveProfile.stat, "reflex");
assert.ok(breathWeaponCandidate.score > 100);
assert.ok(breathWeaponCandidate.reasons.includes("NPC signature area ability can catch multiple enemies."));
const breathWeaponFallbackStrike = scoreCandidate(breathWeaponContext, {
  id: "fallback-claw",
  name: "Fallback Claw",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 30, increment: 30 },
  averageDamage: 12,
});
assert.ok(
  breathWeaponCandidate.score > breathWeaponFallbackStrike.score,
  `breath weapon should beat plain Strike when it catches multiple enemies, got ${breathWeaponCandidate.score} vs ${breathWeaponFallbackStrike.score}`,
);

const trampleClassification = classifySystemAction({
  name: "Trample",
  system: {
    actionType: { value: "action" },
    actions: { value: 3 },
    category: "offensive",
    description: {
      value: "<p>The monster Strides up to double its Speed and can move through enemies. @Damage[2d8+8[bludgeoning]] @Check[reflex|dc:23|basic] @Localize[PF2E.NPC.Abilities.Glossary.Trample]</p>",
    },
  },
}, { actionCost: 3, type: "action" });
assert.equal(trampleClassification.role, "mobility-attack");
assert.equal(trampleClassification.activityProfile.strideCount, 2);
assert.equal(trampleClassification.activityProfile.npcFamily, "trample");
assert.equal(trampleClassification.saveProfile.stat, "reflex");

const reactionContext = {
  ...hydraContext,
  actor: {
    ...hydraContext.actor,
    document: {
      system: { actions: [] },
      itemTypes: {
        action: [{
          id: "reactive-strike",
          name: "Reactive Strike",
          type: "action",
          system: {
            actionType: { value: "reaction" },
            actions: { value: null },
            category: "offensive",
            description: {
              value: "<p><strong>Trigger</strong> A creature within reach uses a manipulate action or leaves a square during a move action.</p><p>The monster makes a melee Strike against the triggering creature.</p>",
            },
          },
        }, {
          id: "shield-block",
          name: "Shield Block",
          type: "action",
          system: {
            actionType: { value: "reaction" },
            actions: { value: null },
            category: "defensive",
            description: {
              value: "<p><strong>Trigger</strong> The monster would take damage from a physical attack while its shield is raised.</p><p>The monster blocks with its shield.</p>",
            },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  triggerEvents: ["provokes-reaction"],
};
const reactionSources = readActionSources(reactionContext);
const reactiveStrike = reactionSources.find((action) => action.name === "Reactive Strike");
assert.equal(reactiveStrike.source, "system-inferred");
assert.equal(reactiveStrike.role, "reaction-attack");
assert.equal(reactiveStrike.actionCost, "reaction");
assert.equal(reactiveStrike.available, true);
const shieldBlock = reactionSources.find((action) => action.name === "Shield Block");
assert.equal(shieldBlock.source, "system-inferred");
assert.equal(shieldBlock.role, "defense");
assert.equal(shieldBlock.available, false);

const shieldBlockTriggerContext = {
  ...reactionContext,
  actor: {
    ...reactionContext.actor,
    profile: {
      ...reactionContext.actor.profile,
      effects: [],
    },
  },
  triggerEvents: ["attacked"],
};
const shieldBlockNoDefense = readActionSources(shieldBlockTriggerContext)
  .find((action) => action.name === "Shield Block");
assert.equal(shieldBlockNoDefense.available, false);
assert.equal(
  shieldBlockNoDefense.unavailableReason,
  "Shield Block requires Raise a Shield or an active Shield spell.",
);

const shieldBlockWithRaisedShield = readActionSources({
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [{ slug: "effect-raise-a-shield", name: "Effect: Raise a Shield" }],
    },
  },
}).find((action) => action.name === "Shield Block");
assert.equal(shieldBlockWithRaisedShield.available, true, shieldBlockWithRaisedShield.unavailableReason);

const shieldBlockWithShieldSpell = readActionSources({
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [{ slug: "spell-effect-shield", name: "Spell Effect: Shield" }],
    },
  },
}).find((action) => action.name === "Shield Block");
assert.equal(shieldBlockWithShieldSpell.available, true, shieldBlockWithShieldSpell.unavailableReason);

// The Shield spell effect can carry a rank/variant suffix on its slug — Shield Block must
// still be granted, but the post-block "Shield Immunity" cooldown must NOT grant it.
const shieldBlockWithSuffixedSpell = readActionSources({
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [{ slug: "spell-effect-shield-rank-1", name: "Spell Effect: Shield" }],
    },
  },
}).find((action) => action.name === "Shield Block");
assert.ok(shieldBlockWithSuffixedSpell, "a suffixed Shield spell effect should still grant Shield Block");
assert.equal(shieldBlockWithSuffixedSpell.available, true, shieldBlockWithSuffixedSpell.unavailableReason);

const shieldBlockWithImmunityOnly = readActionSources({
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [{ slug: "effect-shield-immunity", name: "Effect: Shield Immunity" }],
    },
  },
}).find((action) => action.name === "Shield Block");
assert.equal(shieldBlockWithImmunityOnly?.available, false, "the Shield Block cooldown alone must not make Shield Block available");

const shieldBlockFeatContext = {
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    document: {
      ...shieldBlockTriggerContext.actor.document,
      itemTypes: {
        ...shieldBlockTriggerContext.actor.document.itemTypes,
        action: [],
        feat: [{
          id: "shield-block-feat",
          name: "Shield Block",
          type: "feat",
          system: {
            actionType: { value: "reaction" },
            actions: { value: null },
            category: "defensive",
            description: {
              value: "<p><strong>Trigger</strong> You would take damage from a physical attack while your shield is raised.</p><p>You snap your shield into place.</p>",
            },
          },
        }],
      },
    },
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [],
    },
  },
};
const plannedRaiseShieldBlock = readActionSources(projectContextForDraftDestination(shieldBlockFeatContext, {
  steps: [{
    instanceId: "raise-shield",
    actionCost: 1,
    action: { slug: "raise-a-shield", name: "Raise a Shield", actionCost: 1 },
  }],
})).find((action) => action.name === "Shield Block");
assert.equal(plannedRaiseShieldBlock.available, true, plannedRaiseShieldBlock.unavailableReason);

const noShieldBlockContext = {
  ...shieldBlockTriggerContext,
  actor: {
    ...shieldBlockTriggerContext.actor,
    document: {
      ...shieldBlockTriggerContext.actor.document,
      itemTypes: {
        ...shieldBlockTriggerContext.actor.document.itemTypes,
        action: [],
        feat: [],
      },
    },
    profile: {
      ...shieldBlockTriggerContext.actor.profile,
      effects: [],
    },
  },
};

// Caster's own turn after casting Shield: the spell effect is active but no incoming-attack
// event is in context. Shield Block must still be offered as an available reaction (it should
// not be gated on the attack trigger firing right now).
const shieldSpellOwnTurnBlock = readActionSources({
  ...noShieldBlockContext,
  triggerEvents: [],
  events: [],
  actor: {
    ...noShieldBlockContext.actor,
    profile: {
      ...noShieldBlockContext.actor.profile,
      effects: [{ slug: "spell-effect-shield", name: "Spell Effect: Shield" }],
    },
  },
}).find((action) => action.slug === "shield-block" && action.source === "spell-inferred");
assert.ok(shieldSpellOwnTurnBlock, "Shield spell should offer Shield Block with no active attack trigger");
assert.equal(shieldSpellOwnTurnBlock.available, true, shieldSpellOwnTurnBlock.unavailableReason);

const plannedRaiseWithoutShieldBlock = readActionSources(projectContextForDraftDestination(noShieldBlockContext, {
  steps: [{
    instanceId: "raise-shield-no-feat",
    actionCost: 1,
    action: { slug: "raise-a-shield", name: "Raise a Shield", actionCost: 1 },
  }],
}));
assert.equal(
  plannedRaiseWithoutShieldBlock.some((action) => action.slug === "shield-block"),
  false,
  "Raise a Shield should not create Shield Block when no Shield Block feat/action exists",
);

const plannedShieldSpellBlock = readActionSources(projectContextForDraftDestination(noShieldBlockContext, {
  steps: [{
    instanceId: "cast-shield",
    actionCost: 1,
    action: {
      slug: "shield",
      name: "Shield",
      actionCost: 1,
      source: "spell-curated",
      activityProfile: { spell: true },
    },
  }],
})).find((action) => action.slug === "shield-block");
assert.ok(plannedShieldSpellBlock, "Shield spell should grant Shield Block even without the Shield Block feat");
assert.equal(plannedShieldSpellBlock.available, true, plannedShieldSpellBlock.unavailableReason);
assert.equal(plannedShieldSpellBlock.source, "spell-inferred");

const expandedGenericSlugs = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}).map((action) => action.slug);
for (const slug of [
  "seek",
  "sense-motive",
  "climb",
  "swim",
  "tumble-through",
  "disarm",
  "force-open",
  "reposition",
  "shove",
  "create-a-diversion",
  "feint",
  "administer-first-aid",
  "stabilize",
  "command-an-animal",
  "hide",
  "sneak",
  "palm-an-object",
  "steal",
  "take-cover",
  "escape",
]) {
  assert.ok(expandedGenericSlugs.includes(slug), `${slug} should be cataloged`);
}
for (const slug of ["balance", "high-jump", "long-jump"]) {
  assert.equal(expandedGenericSlugs.includes(slug), false, `${slug} should stay hidden from suggestions`);
  assert.equal(
    GENERIC_ACTIONS.find((action) => action.slug === slug)?.hideFromSuggestions,
    true,
    `${slug} should remain in the catalog as a manual-only action`,
  );
}

const grantsShieldOptionAction = {
  name: "Inspiring Word",
  slug: "inspiring-word",
  system: {
    description: {
      value: "All allies within the dragon's heartening aura become Quickened for 1 round. Allies can use this extra action to Raise a Shield, Step, Stride, or Strike.",
    },
    traits: { value: [] },
    time: { value: "2" },
  },
};
const grantsShieldOptionClassified = classifySystemAction(grantsShieldOptionAction);
assert.notEqual(
  grantsShieldOptionClassified.role,
  "defense",
  "an action that merely grants an ally an extra action they could optionally spend on Raise a Shield must not itself classify as a defense action",
);
assert.ok(
  !grantsShieldOptionClassified.reasons?.some((reason) => reason.includes("Raise a Shield")),
  "reasons must not describe Raise a Shield's mechanic for an action that doesn't raise a shield",
);

const farTrip = readActionSources({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 20,
  }],
}).find((action) => action.slug === "trip");
assert.equal(farTrip.available, false);
assert.equal(farTrip.unavailableReason, "No enemy in reach.");

// Demoralize has a 30 ft range — unavailable against a target beyond it.
const farDemoralize = readActionSources({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 35 }],
}).find((action) => action.slug === "demoralize");
assert.equal(farDemoralize.available, false);
assert.equal(farDemoralize.unavailableReason, "No target within 30 feet.");

const nearDemoralize = readActionSources({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}).find((action) => action.slug === "demoralize");
assert.equal(nearDemoralize.available, true);

const demoralizeImmuneTarget = {
  ...fighterContext.targets[0],
  distance: 20,
  effects: [{ slug: "effect-demoralize-immunity", name: "Effect: Demoralize Immunity" }],
};
const immuneDemoralizeContext = {
  ...fighterContext,
  targets: [demoralizeImmuneTarget],
  battlefield: {
    targets: [demoralizeImmuneTarget],
    enemies: [demoralizeImmuneTarget],
    allies: [],
  },
};
const immuneDemoralize = readActionSources(immuneDemoralizeContext)
  .find((action) => action.slug === "demoralize");
assert.equal(immuneDemoralize.available, false);
assert.equal(immuneDemoralize.unavailableReason, "Target is temporarily immune to Demoralize.");
assert.equal(
  buildCandidates(immuneDemoralizeContext).candidates.some((action) => action.slug === "demoralize"),
  false,
);
const scoredImmuneDemoralize = scoreCandidate(immuneDemoralizeContext, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  role: "debuff",
  maxRange: 30,
});
assert.equal(scoredImmuneDemoralize.score, -999);
assert.equal(scoredImmuneDemoralize.reason, "Target is temporarily immune to Demoralize.");

// Create a Diversion carries a default PF2e variant so execution doesn't error.
const diversionAction = readActionSources(fighterContext).find((action) => action.slug === "create-a-diversion");
assert.equal(diversionAction.variant, "gesture");

const handedContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
};
const armedSteal = readActionSources(handedContext).find((action) => action.slug === "steal");
assert.equal(armedSteal.available, true);

const handlessContext = {
  ...handedContext,
  profile: { ...fighterContext.profile, handsFree: 0 },
};
const handlessSources = readActionSources(handlessContext);
const handlessSteal = handlessSources.find((action) => action.slug === "steal");
assert.equal(handlessSteal.available, false);
assert.equal(handlessSteal.unavailableReason, "No free hand to manipulate an object.");
const handlessPalm = handlessSources.find((action) => action.slug === "palm-an-object");
assert.equal(handlessPalm.available, false);
const handlessDisarm = handlessSources.find((action) => action.slug === "disarm");
assert.equal(handlessDisarm.available, true);

const closeFeint = scoreCandidate({
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    skills: {
      ...fighterContext.profile.skills,
      deception: 10,
    },
  },
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}, {
  id: "feint",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  skill: "deception",
  role: "setup",
  targetDefense: "perception",
  requiresEnemyInReach: true,
});
assert.ok(closeFeint.score > 42);
assert.equal(closeFeint.reason, "Target is in melee and not off-guard.");
assert.equal(closeFeint.suggestedTarget.name, "Ogre");

const areaDamageCandidate = {
  id: "overwhelming-blast",
  name: "Overwhelming Blast",
  slug: "overwhelming-blast",
  actionCost: 2,
  source: "spell-curated",
  curated: { role: "area-damage" },
  role: "area-damage",
  targetingProfile: { type: "burst", distance: 20, maxRange: 60, enemy: true },
  activityProfile: { spell: true },
};
const areaDamageScored = scoreCandidate({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  targets: [{ ...fighterContext.targets[0], distance: 20, center: { x: 100, y: 0 } }],
}, areaDamageCandidate);
assert.deepEqual(areaDamageScored.activityProfile.areaPlacementCenter, { x: 100, y: 0 });
assert.equal(areaDamageScored.activityProfile.areaPlacementAimPoint, null);

const noEnemyAreaScored = scoreCandidate({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  targets: [],
}, areaDamageCandidate);
assert.equal(noEnemyAreaScored.activityProfile.areaPlacementCenter, null);

const lineDamageCandidate = {
  id: "far-lance",
  name: "Far Lance",
  slug: "far-lance",
  actionCost: 2,
  source: "spell-curated",
  curated: { role: "area-damage" },
  role: "area-damage",
  targetingProfile: { type: "line", distance: 30, maxRange: 30, enemy: true },
  activityProfile: { spell: true },
};
const lineDamageScored = scoreCandidate({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  targets: [{ ...fighterContext.targets[0], distance: 15, center: { x: 0, y: 75 } }],
}, lineDamageCandidate);
assert.equal(lineDamageScored.activityProfile.areaPlacementCenter, null);
assert.deepEqual(lineDamageScored.activityProfile.areaPlacementAimPoint, { x: 0, y: 75 });

const burstMarkerAction = {
  id: "overwhelming-blast",
  name: "Overwhelming Blast",
  slug: "overwhelming-blast",
  role: "area-damage",
  curated: { role: "area-damage" },
  targetingProfile: { type: "burst", distance: 20, enemy: true, area: true },
  activityProfile: { spell: true, areaPlacementCenter: { x: 100, y: 0 }, areaPlacementAimPoint: null },
};
const burstMarkerContext = { ...fighterContext, token: { center: { x: 0, y: 0 } } };
const burstMarker = computeAreaMarker(burstMarkerContext, burstMarkerAction);
assert.deepEqual(burstMarker?.center, { x: 100, y: 0 });

const lineMarkerAction = {
  id: "far-lance",
  name: "Far Lance",
  slug: "far-lance",
  role: "area-damage",
  curated: { role: "area-damage" },
  targetingProfile: { type: "line", distance: 30, enemy: true, area: true },
  activityProfile: { spell: true, areaPlacementCenter: null, areaPlacementAimPoint: { x: 0, y: 100 } },
};
const lineMarker = computeAreaMarker(burstMarkerContext, lineMarkerAction);
assert.deepEqual(lineMarker?.center, { x: 0, y: 0 });
assert.equal(lineMarker?.rotation, 90);

const noPlacementAction = { ...burstMarkerAction, activityProfile: { spell: true, areaPlacementCenter: null, areaPlacementAimPoint: null } };
assert.equal(computeAreaMarker(burstMarkerContext, noPlacementAction), null);

const nonAreaAction = { id: "strike", name: "Strike", slug: "strike", role: "damage", source: "strike" };
assert.equal(computeAreaMarker(burstMarkerContext, nonAreaAction), null);

// movementReachableCenters (the shared BFS behind the Stride-into-reach composite, among other
// callers) must never land a destination on a square another creature already occupies.
// gridReachDistanceFeet clamps overlap to 0, so a fully-overlapping destination previously read as
// an ordinary adjacent square and slipped through reachableAttackCenters' reach filter. Exercised
// through readActionSources' "stride-strike-claw" composite (movementReachableCenters and
// reachableAttackCenters are both private to action-reader.js) since its
// activityProfile.attackCenter is the nearest exported, observable proof of which square the BFS
// actually picked.
//
// The blocker is placed in battlefield.allies, not battlefield.enemies: compareTacticalCenters'
// tie-break (in battlefield-analysis.js) weighs threatCountAtCenter, which only counts enemies. An
// enemy blocker would confound the test, since the "best" square could shift merely because it now
// has more nearby enemy threats -- independent of the occupancy bug this test targets. An ally
// blocker isolates the occupancy effect cleanly.
const occupancyBaseContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "claw", type: "strike", label: "Claw",
          visible: true, ready: true, canAttack: true,
          item: { id: "claw", system: { traits: { value: [] } } },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  token: { id: "active-token", center: { x: 0, y: 0 } },
  profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
  battlefield: {
    enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
  },
  targets: undefined,
};
const occupancyClearComposite = readActionSources(occupancyBaseContext).find((a) => a.slug === "stride-strike-claw");
assert.ok(occupancyClearComposite, "expected a Stride -> Claw composite when nothing blocks the destination");
const occupancyBestSquare = occupancyClearComposite.activityProfile.attackCenter;
assert.ok(occupancyBestSquare, "expected an attackCenter on the clear composite");

const occupancyBlockedContext = {
  ...occupancyBaseContext,
  battlefield: {
    allies: [
      { id: "ally-blocker", name: "Ally Blocker", distance: 25, token: { center: occupancyBestSquare, width: 1, height: 1 } },
    ],
    enemies: occupancyBaseContext.battlefield.enemies,
    targets: occupancyBaseContext.battlefield.targets,
  },
};
const occupancyBlockedComposite = readActionSources(occupancyBlockedContext).find((a) => a.slug === "stride-strike-claw");
assert.ok(occupancyBlockedComposite, "expected an alternate legal Stride -> Claw composite even with the best square occupied");
assert.notDeepEqual(
  occupancyBlockedComposite.activityProfile.attackCenter,
  occupancyBestSquare,
  "attackCenter must not land on a square another creature already occupies",
);

// reachableMovementCenters (the BFS behind the interactive movement-preview overlay in
// movement-preview.js) has the same missing-occupancy-check gap as the scoring engine's
// movementReachableCenters above, in a structurally parallel but separately implemented BFS.
// Unlike the composite-attackCenter proof above, this file computes raw reachable squares for
// DISPLAY, not a scored/tie-broken "best" square, so the assertion checks the raw reachableCenters
// list directly for the blocked square's absence -- that list isn't run through this file's
// recommendedPlacement sort/tie-break at all, so it can't be confounded by a scoring mechanism
// steering the result away from the blocker for unrelated reasons the way a "best pick" could be.
const movementOccupancyBaseContext = {
  token: { center: { x: 0, y: 0 } },
  actor: { profile: { speed: 25 } },
  battlefield: {},
};
const movementOccupancyBlockerSquare = { x: 10, y: 0 };
const movementOccupancyClearPreview = movementPreviewForStep(movementOccupancyBaseContext, { slug: "stride" }, { gridSize: 5 });
assert.ok(
  movementOccupancyClearPreview.reachableCenters.some((center) => center.x === movementOccupancyBlockerSquare.x && center.y === movementOccupancyBlockerSquare.y),
  "sanity: (10,0) should be reachable with nothing blocking it",
);

const movementOccupancyBlockedContext = {
  ...movementOccupancyBaseContext,
  battlefield: {
    enemies: [{ id: "movement-blocker", name: "Movement Blocker", token: { center: movementOccupancyBlockerSquare, width: 1, height: 1 } }],
  },
};
const movementOccupancyBlockedPreview = movementPreviewForStep(movementOccupancyBlockedContext, { slug: "stride" }, { gridSize: 5 });
assert.equal(
  movementOccupancyBlockedPreview.reachableCenters.some((center) => center.x === movementOccupancyBlockerSquare.x && center.y === movementOccupancyBlockerSquare.y),
  false,
  "reachableCenters must not include a square occupied by another battlefield creature",
);

// Scope check: occupancy only excludes a square as a LANDING destination -- it must not block a
// route from passing through an occupied square to reach a square beyond it.
const movementOccupancyBeyondSquare = { x: 20, y: 0 };
assert.ok(
  movementOccupancyBlockedPreview.reachableCenters.some((center) => center.x === movementOccupancyBeyondSquare.x && center.y === movementOccupancyBeyondSquare.y),
  "a square beyond the blocker must still be reachable; occupancy must not block pass-through",
);

const hiddenStrikeCandidate = {
  id: "hidden-target-strike",
  name: "Strike",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  role: "damage",
  activityProfile: { averageDamage: 10 },
};
const observedStrikeScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
}, hiddenStrikeCandidate);
const hiddenStrikeScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5, visionerDetectionState: "hidden" }],
}, hiddenStrikeCandidate);
assert.ok(
  hiddenStrikeScored.score < observedStrikeScored.score,
  `an attack against a hidden target must score lower than the identical attack against an observed target (the DC 11 flat check can fail before the attack roll matters), got hidden=${hiddenStrikeScored.score} observed=${observedStrikeScored.score}`,
);
assert.ok(
  hiddenStrikeScored.reasons.some((reason) => reason.includes("hidden") || reason.includes("flat check")),
  "the score reasons should mention the hidden target's flat check, not just silently lower the number",
);
const undetectedStrikeScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5, visionerDetectionState: "undetected" }],
}, hiddenStrikeCandidate);
assert.equal(
  undetectedStrikeScored.score,
  -999,
  "an undetected target should still be fully excluded by the existing canAttackTarget gate, not merely discounted like a hidden one",
);

const outOfRangeControlCandidate = {
  id: "out-of-range-control",
  name: "Overwhelming Presence",
  slug: "overwhelming-presence",
  actionCost: 2,
  source: "spell-inferred",
  role: "control",
  targetingProfile: { enemy: true, maxRange: 30 },
  activityProfile: { spell: true },
};
const outOfRangeControlScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 60 }],
}, outOfRangeControlCandidate);
assert.equal(
  outOfRangeControlScored.suggestedTarget,
  null,
  "an offensive-role action with no enemy inside its own range must show no target at all, not the caster itself",
);
assert.ok(
  !outOfRangeControlScored.reasons.some((reason) => reason.includes("Ogre")),
  "reasons must not describe acting on an enemy the action can't actually reach",
);

const inRangeControlScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}, outOfRangeControlCandidate);
assert.equal(inRangeControlScored.suggestedTarget?.name, "Ogre");

const selfOnlyBuffCandidate = {
  id: "self-rage",
  name: "Rage",
  slug: "rage",
  actionCost: 1,
  source: "custom-curated",
  role: "combat-buff",
  targetingProfile: null,
  activityProfile: {},
};
const selfOnlyBuffScored = scoreCandidate(fighterContext, selfOnlyBuffCandidate);
assert.equal(
  selfOnlyBuffScored.suggestedTarget?.name,
  fighterContext.actor.name,
  "a self-only buff with no enemy-targeting profile must still resolve to the actor itself, even though fighterContext.targets is non-empty — this is the regression guard for the fix above",
);

const outOfRangeCuratedDamageCandidate = {
  id: "tooth-tug",
  name: "Tooth Tug",
  slug: "tooth-tug",
  actionCost: 1,
  source: "custom-curated",
  role: "damage",
  targetingProfile: { enemy: true, maxRange: 15 },
  activityProfile: { averageDamage: 6 },
};
const outOfRangeCuratedDamageScored = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 60 }],
}, outOfRangeCuratedDamageCandidate);
assert.ok(
  !outOfRangeCuratedDamageScored.reasons.some((reason) => reason.includes("can damage")),
  "the curated damage-role bonus must not fire when nothing is in range, even indirectly via a stale target",
);

const outOfRangeSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "system-far-control",
          name: "System Far Control",
          slug: "system-far-control",
          system: {
            slug: "system-far-control",
            time: { value: "2" },
            traits: { value: ["mental"] },
            level: { value: 3 },
            range: { value: "30 feet" },
            defense: { save: { statistic: "will", basic: false } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: {
            prepared: { value: "spontaneous" },
            slots: { slot3: { value: 1 } },
          },
        }],
      },
    },
  },
  targets: [{ id: "far-target", name: "Ogre", distance: 60, hpPercent: 1, conditions: [], saves: { will: 5 }, ac: 19 }],
};
const outOfRangeSpell = readSpellActions(outOfRangeSpellContext).find((spell) => spell.slug === "system-far-control");
assert.equal(
  outOfRangeSpell.available,
  false,
  "a spell whose only possible target is farther than its own range must not be marked available",
);
assert.equal(outOfRangeSpell.unavailableReason, "No target within 30 feet.");

const inRangeSpellContext = {
  ...outOfRangeSpellContext,
  targets: [{ ...outOfRangeSpellContext.targets[0], distance: 25 }],
};
const inRangeSpell = readSpellActions(inRangeSpellContext).find((spell) => spell.slug === "system-far-control");
assert.equal(inRangeSpell.available, true);

const rangedDropProneScored = scoreCandidate({
  ...fighterContext,
  profile: { ...fighterContext.profile, equippedRangedWeapon: true },
}, {
  id: "generic-drop-prone",
  name: "Drop Prone",
  slug: "drop-prone",
  actionCost: 1,
  source: "system-inferred",
  role: "defense",
});
const meleeDropProneScored = scoreCandidate({
  ...fighterContext,
  profile: { ...fighterContext.profile, equippedRangedWeapon: false },
}, {
  id: "generic-drop-prone",
  name: "Drop Prone",
  slug: "drop-prone",
  actionCost: 1,
  source: "system-inferred",
  role: "defense",
});
assert.equal(
  meleeDropProneScored.score - rangedDropProneScored.score,
  10,
  `a ranged actor's Drop Prone should score exactly 10 points lower than a melee actor's identical Drop Prone (the ranged penalty in isolation), got melee=${meleeDropProneScored.score} ranged=${rangedDropProneScored.score}`,
);
assert.equal(
  rangedDropProneScored.reason,
  "Dropping prone gives cover but penalizes the actor's own attacks.",
  "Drop Prone must not reuse the reaction-flavored defense reason (it is a proactive action with no trigger)",
);

const medicineSources = readActionSources({
  ...fighterContext,
  allies: [{
    id: "ally-dying",
    name: "Kyra",
    hpPercent: 0,
    conditions: { slugs: ["dying"], values: { dying: 1 } },
  }],
});
assert.equal(medicineSources.find((action) => action.slug === "administer-first-aid").available, true);
assert.equal(medicineSources.find((action) => action.slug === "stabilize").available, true);

const noCompanionCommand = readActionSources(fighterContext).find((action) => action.slug === "command-an-animal");
assert.equal(noCompanionCommand.available, false);
assert.equal(noCompanionCommand.unavailableReason, "No companion or minion detected.");

const withCompanionCommand = readActionSources({
  ...fighterContext,
  minions: [{ id: "companion-1", name: "Rex" }],
}).find((action) => action.slug === "command-an-animal");
assert.equal(withCompanionCommand.available, true);

const scoredStabilize = scoreCandidate({
  ...fighterContext,
  allies: [{
    id: "ally-dying",
    name: "Kyra",
    hpPercent: 0,
    conditions: { slugs: ["dying"], values: { dying: 1 } },
  }],
}, {
  id: "stabilize",
  name: "Stabilize",
  slug: "stabilize",
  actionCost: 2,
  source: "generic",
  role: "healing",
});
assert.ok(scoredStabilize.score > 42);
assert.equal(scoredStabilize.reason, "Kyra is dying.");
assert.equal(scoredStabilize.suggestedTarget.name, "Kyra");

const hiddenAction = readActionSources(fighterContext).find((action) => action.slug === "hide");
assert.equal(hiddenAction.available, false);
assert.equal(hiddenAction.unavailableReason, "No cover or concealment detected.");

const noAdjacentWallTakeCover = readActionSources({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  profile: {
    ...fighterContext.profile,
    hasCover: true,
  },
}).find((action) => action.slug === "take-cover");
assert.equal(noAdjacentWallTakeCover.available, false);
assert.equal(noAdjacentWallTakeCover.unavailableReason, "No adjacent wall or cover.");

const systemTakeCoverNoWallCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: { placeables: [] },
  };
  const systemTakeCoverNoWallContext = {
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
    actor: {
      ...fighterContext.actor,
      document: {
        itemTypes: {
          action: [{
            id: "system-take-cover",
            name: "Take Cover",
            slug: "take-cover",
            type: "action",
            system: {
              slug: "take-cover",
              actionType: { value: "action" },
              actions: { value: 1 },
              description: { value: "<p>You press yourself against cover.</p>" },
            },
          }],
          feat: [],
          feature: [],
          consumable: [],
        },
        items: [],
      },
    },
  };
  assert.equal(
    buildCandidates(systemTakeCoverNoWallContext).candidates.some((action) => action.slug === "take-cover"),
    false,
  );
} finally {
  globalThis.canvas = systemTakeCoverNoWallCanvas;
}

const previousTakeCoverWallCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      placeables: [{
        document: { c: [2.5, -2.5, 2.5, 2.5] },
      }],
    },
  };
  const adjacentWallTakeCover = readActionSources({
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
  }).find((action) => action.slug === "take-cover");
  assert.equal(adjacentWallTakeCover.available, true);
} finally {
  globalThis.canvas = previousTakeCoverWallCanvas;
}

const previousSeekVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner" ? { active: true, api: {} } : null,
    },
  };

  const visibleSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(visibleSeek.available, false);
  assert.equal(visibleSeek.unavailableReason, "No hidden or undetected target detected.");

  const observedConditionSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
        conditions: [{ slug: "hidden" }],
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(observedConditionSeek.available, false);
  assert.equal(observedConditionSeek.unavailableReason, "No hidden or undetected target detected.");

  const hiddenSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "hidden",
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(hiddenSeek.available, true);
} finally {
  globalThis.game = previousSeekVisionerGame;
}

const previousInactiveVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner" ? { active: false, api: {} } : null,
    },
  };

  const inactiveVisionerSystemSeek = readActionSources({
    ...fighterContext,
    token: { id: "observer-token" },
    battlefield: {
      targets: [{
        ...fighterContext.targets[0],
        token: { id: "target-token" },
        visionerDetectionState: "observed",
        conditions: [{ slug: "hidden" }],
      }],
    },
    targets: undefined,
  }).find((action) => action.slug === "seek");
  assert.equal(inactiveVisionerSystemSeek.available, true);
} finally {
  globalThis.game = previousInactiveVisionerGame;
}

const attackVisibilityContext = (targetPatch = {}) => ({
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: {
        actions: [{
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "longsword", system: { traits: { value: [] } } },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  token: { id: "observer-token", center: { x: 0, y: 0 } },
  battlefield: {
    targets: [{
      ...fighterContext.targets[0],
      distance: 5,
      token: { id: "target-token", center: { x: 5, y: 0 } },
      ...targetPatch,
    }],
    enemies: [{
      ...fighterContext.targets[0],
      distance: 5,
      token: { id: "target-token", center: { x: 5, y: 0 } },
      ...targetPatch,
    }],
  },
  targets: undefined,
});

const hiddenStrike = readActionSources(attackVisibilityContext({
  conditions: [{ slug: "hidden" }],
})).find((action) => action.source === "strike");
assert.equal(hiddenStrike.available, true);

const hiddenDemoralize = readActionSources(attackVisibilityContext({
  conditions: [{ slug: "hidden" }],
})).find((action) => action.slug === "demoralize");
assert.equal(hiddenDemoralize.available, true);

const systemUndetectedStrike = readActionSources(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
})).find((action) => action.source === "strike");
assert.equal(systemUndetectedStrike.available, false);
assert.equal(systemUndetectedStrike.unavailableReason, "No target in range.");

const systemUndetectedDemoralize = readActionSources(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
})).find((action) => action.slug === "demoralize");
assert.equal(systemUndetectedDemoralize.available, false);
assert.equal(systemUndetectedDemoralize.unavailableReason, "No enemy target selected.");

const scoredSystemUndetectedStrike = scoreCandidate(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
}), {
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.equal(scoredSystemUndetectedStrike.score, -999);
assert.equal(scoredSystemUndetectedStrike.reason, "No valid enemy target.");

const scoredSystemUndetectedSpell = scoreCandidate(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
}), {
  id: "force",
  name: "Force",
  slug: "force",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { average: 10, type: "force", types: ["force"] },
  activityProfile: { includes: ["damage"], averageDamage: 10 },
  targetingProfile: { enemy: true, maxRange: 30 },
});
assert.equal(scoredSystemUndetectedSpell.score, -999);
assert.equal(scoredSystemUndetectedSpell.reason, "No attackable enemy target.");

const scoredSystemUndetectedSetup = scoreCandidate(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
}), {
  id: "feint-like",
  name: "Feint-Like",
  slug: "feint-like",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  targetingProfile: { enemy: true, maxRange: 30 },
  activityProfile: { includes: ["setup"], appliesCondition: "off-guard" },
});
assert.equal(scoredSystemUndetectedSetup.score, -999);
assert.equal(scoredSystemUndetectedSetup.reason, "No targetable enemy target.");

const scoredSystemUndetectedAreaSpell = scoreCandidate(attackVisibilityContext({
  conditions: [{ slug: "undetected" }],
}), {
  id: "breathe-fire",
  name: "Breathe Fire",
  slug: "breathe-fire",
  actionCost: 2,
  source: "spell-inferred",
  role: "area-damage",
  damageProfile: { average: 8, type: "fire", types: ["fire"] },
  activityProfile: { includes: ["damage"], averageDamage: 8 },
  targetingProfile: { type: "cone", distance: 15 },
});
assert.equal(scoredSystemUndetectedAreaSpell.score, -999);
assert.equal(scoredSystemUndetectedAreaSpell.reason, "No attackable enemy target.");

const visionerUndetectedStrike = readActionSources(attackVisibilityContext({
  visionerDetectionState: "undetected",
})).find((action) => action.source === "strike");
assert.equal(visionerUndetectedStrike.available, false);
assert.equal(visionerUndetectedStrike.unavailableReason, "No target in range.");

const blockedSenseMotive = readActionSources(fighterContext).find((action) => action.slug === "sense-motive");
assert.equal(blockedSenseMotive.available, false);
assert.equal(blockedSenseMotive.unavailableReason, "No combat-relevant deception or mental effect detected.");

const allowedSenseMotive = readActionSources({
  ...fighterContext,
  battlefield: {
    targets: [{
      ...fighterContext.targets[0],
      behaviorSignals: ["deception"],
    }],
  },
  targets: undefined,
}).find((action) => action.slug === "sense-motive");
assert.equal(allowedSenseMotive.available, true);

const previousVisionerGame = globalThis.game;
try {
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner"
        ? {
          api: {
            autoVisibility: {
              getPerceptionProfile: () => ({
                detectionState: "undetected",
                hasConcealment: false,
                coverState: "none",
                awarenessState: null,
              }),
            },
          },
        }
        : null,
    },
  };
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "undetected",
  );
  assert.equal(
    readVisionerCoverState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "none",
  );
  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({
            detectionState: "observed",
            awarenessState: "hidden",
          }),
        },
      },
    }
    : null;
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    "observed",
  );
  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      active: false,
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({ detectionState: "hidden" }),
        },
      },
    }
    : null;
  assert.equal(
    readVisionerDetectionState({ token: { id: "observer-token" } }, { token: { id: "target-token" } }),
    null,
  );
} finally {
  globalThis.game = previousVisionerGame;
}

const forceOpenAction = readActionSources(fighterContext).find((action) => action.slug === "force-open");
assert.equal(forceOpenAction.available, false);
assert.equal(forceOpenAction.unavailableReason, "No obstacle or object in reach.");

const previousForceOpenDoorCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    walls: {
      placeables: [{
        document: {
          door: 1,
          ds: 2,
          c: [5, -5, 5, 5],
        },
      }],
    },
  };
  const forceOpenDoorAction = readActionSources({
    ...fighterContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...fighterContext.profile,
      reach: 5,
    },
  }).find((action) => action.slug === "force-open");
  assert.equal(forceOpenDoorAction.available, true);
} finally {
  globalThis.canvas = previousForceOpenDoorCanvas;
}

const climbAction = readActionSources({
  ...fighterContext,
  battlefield: {
    terrain: { climb: true },
  },
}).find((action) => action.slug === "climb");
assert.equal(climbAction.available, true);

const strikeSources = readActionSources({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {},
  targets: [],
});
assert.equal(strikeSources.find((action) => action.name === "Longsword").executable, "strike");

const drawStrikeContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "dagger",
          type: "strike",
          label: "Dagger",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "dagger",
            name: "Dagger",
            type: "weapon",
            system: {
              traits: { value: ["agile"] },
            },
          },
        }],
      },
      itemTypes: {
        weapon: [{
          id: "shortbow",
          name: "Shortbow",
          type: "weapon",
          isHeld: false,
          isEquipped: false,
          system: {
            equipped: { carryType: "worn", handsHeld: 0 },
            range: { increment: 60 },
            traits: { value: ["deadly-d10"] },
          },
        }],
        action: [],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {},
  targets: [{
    id: "ogre",
    name: "Ogre",
    distance: 30,
  }],
  battlefield: {
    enemies: [{
      id: "ogre",
      name: "Ogre",
      distance: 30,
    }],
    targets: [{
      id: "ogre",
      name: "Ogre",
      distance: 30,
    }],
  },
};
const drawStrikeSources = readActionSources(drawStrikeContext);
const drawShortbow = drawStrikeSources.find((action) => action.slug === "draw-strike-shortbow");
assert.equal(drawShortbow.name, "Draw Shortbow -> Strike");
assert.equal(drawShortbow.actionCost, 2);
assert.equal(drawShortbow.source, "system-inferred");
assert.equal(drawShortbow.activityProfile.drawsWeapon, true);
assert.equal(drawShortbow.targetingProfile.maxRange, 60);

const scoredDrawShortbow = buildCandidates(drawStrikeContext).candidates
  .find((candidate) => candidate.slug === "draw-strike-shortbow");
assert.ok(scoredDrawShortbow.score > 100);
assert.equal(scoredDrawShortbow.reason, "Draw Shortbow and Strike Ogre.");

const drawStrikeInMeleeContext = {
  ...drawStrikeContext,
  targets: [{
    id: "ogre",
    name: "Ogre",
    distance: 5,
  }],
  battlefield: {
    enemies: [{
      id: "ogre",
      name: "Ogre",
      distance: 5,
    }],
    targets: [{
      id: "ogre",
      name: "Ogre",
      distance: 5,
    }],
  },
};
assert.equal(
  readActionSources(drawStrikeInMeleeContext).some((action) => action.slug === "draw-strike-shortbow"),
  false,
);

const drawStrikeFarEnemyContext = {
  ...drawStrikeContext,
  targets: [{
    id: "near-ogre",
    name: "Near Ogre",
    distance: 5,
  }],
  battlefield: {
    enemies: [{
      id: "near-ogre",
      name: "Near Ogre",
      distance: 5,
    }, {
      id: "far-ogre",
      name: "Far Ogre",
      distance: 30,
    }],
    targets: [{
      id: "near-ogre",
      name: "Near Ogre",
      distance: 5,
    }],
  },
};
const farEnemyDrawShortbow = buildCandidates(drawStrikeFarEnemyContext).candidates
  .find((candidate) => candidate.slug === "draw-strike-shortbow");
assert.equal(farEnemyDrawShortbow.suggestedTarget.name, "Far Ogre");
assert.equal(farEnemyDrawShortbow.reason, "Draw Shortbow and Strike Far Ogre.");

const repeatedStrikePlan = bestTurnPlan(fighterContext, [{
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}]);
assert.equal(repeatedStrikePlan.steps.length, 2);
assert.deepEqual(repeatedStrikePlan.steps.map((step) => step.mapPenalty), [0, 5]);

const repeatedReloadStrikePlan = bestTurnPlan(fighterContext, [{
  id: "crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  reload: 1,
  range: { max: 120 },
  score: 90,
  confidence: "medium",
  reason: "Shoot.",
}]);
assert.equal(repeatedReloadStrikePlan.steps.length, 2);
assert.equal(repeatedReloadStrikePlan.totalCost, 3);
assert.deepEqual(repeatedReloadStrikePlan.steps.map((step) => step.name), ["Crossbow", "Reload -> Crossbow"]);
assert.deepEqual(repeatedReloadStrikePlan.steps.map((step) => step.actionCost), [1, 2]);
assert.deepEqual(repeatedReloadStrikePlan.steps.map((step) => step.mapPenalty), [0, 5]);

const quickenedReloadPlan = bestTurnPlan(quickenedContext, [{
  id: "demoralize-reload",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Target is not frightened.",
}, {
  id: "crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  reload: 1,
  range: { max: 120 },
  score: 90,
  confidence: "medium",
  reason: "Shoot.",
}]);
assert.equal(quickenedReloadPlan.actionBudget.quickenedActions, 1);
assert.equal(quickenedReloadPlan.totalCost, 4);
assert.deepEqual(quickenedReloadPlan.steps.map((step) => step.name), ["Demoralize", "Crossbow", "Reload -> Crossbow"]);

const rangedAlreadyInRangeContext = {
  ...fighterContext,
  targets: [{
    id: "calder",
    name: "Calder",
    distance: 40,
  }],
  battlefield: {
    targets: [{
      id: "calder",
      name: "Calder",
      distance: 40,
    }],
    enemies: [{
      id: "calder",
      name: "Calder",
      distance: 40,
    }],
  },
};
const rangedAlreadyInRangePlans = buildTurnPlans(rangedAlreadyInRangeContext, [{
  id: "stride",
  name: "Stride",
  slug: "stride",
  actionCost: 1,
  source: "generic",
  score: 100,
  confidence: "medium",
  reason: "Move.",
}, {
  id: "crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120 },
  score: 90,
  confidence: "medium",
  reason: "Shoot.",
}]);
assert.equal(
  rangedAlreadyInRangePlans.some((plan) =>
    plan.steps.some((step) => step.slug === "stride")
    && plan.steps.some((step) => step.name === "Crossbow"),
  ),
  false,
);
assert.deepEqual(
  rangedAlreadyInRangePlans[0].steps.map((step) => step.name),
  ["Crossbow", "Crossbow"],
);


// Integrated check: a generic Stride toward an in-reach target, scored by the real scoring pass
// (so it carries the negative "repositioning is low priority" score), must never be padded into a
// plan — even when the actor has a spare action a non-repeatable attack can't fill. The planner
// should leave the action unused rather than add a "Stride to the same square".
const adjacentRangedContext = {
  ...fighterContext,
  profile: { ...fighterContext.profile, reach: 5 },
  targets: [{ id: "gromog", name: "Gromog", distance: 5 }],
  battlefield: {
    targets: [{ id: "gromog", name: "Gromog", distance: 5 }],
    enemies: [{ id: "gromog", name: "Gromog", distance: 5 }],
  },
};
const scoredAdjacentStride = scoreCandidate(adjacentRangedContext, {
  id: "stride", name: "Stride", slug: "stride", source: "generic", actionCost: 1,
});
assert.ok(scoredAdjacentStride.score < 0, "the scored in-reach Stride should be negative before planning");
const paddedStridePlans = buildTurnPlans(adjacentRangedContext, [
  scoredAdjacentStride,
  { id: "take-cover", name: "Take Cover", slug: "take-cover", source: "generic", actionCost: 1, score: 30, confidence: "medium", reason: "Cover." },
]);
assert.equal(
  paddedStridePlans[0].steps.some((step) => step.slug === "stride"),
  false,
  "the best plan must not pad a spare action with a redundant in-reach Stride",
);

const twoActionOrderingContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    conditions: {
      slugs: ["slowed"],
      values: { slowed: 1 },
    },
  },
};

const demoralizeBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "longsword-ordering",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "demoralize-ordering",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Lower target defenses.",
}]);
assert.deepEqual(demoralizeBeforeStrikePlan.steps.map((step) => step.slug), ["demoralize", "strike"]);

const feintBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "longsword-feint-ordering",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "feint-ordering",
  name: "Feint",
  slug: "feint",
  actionCost: 1,
  source: "generic",
  score: 80,
  confidence: "medium",
  reason: "Make target off-guard.",
}]);
assert.deepEqual(feintBeforeStrikePlan.steps.map((step) => step.slug), ["feint", "strike"]);

const acSetupBeforeStrikePlan = bestTurnPlan(twoActionOrderingContext, [{
  id: "claw-ordering",
  name: "Claw",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 90,
  confidence: "medium",
  reason: "Hit it.",
}, {
  id: "expose-weak-point",
  name: "Expose Weak Point",
  slug: "expose-weak-point",
  actionCost: 1,
  source: "system-inferred",
  role: "control",
  activityProfile: {
    appliesCondition: "off-guard",
  },
  score: 80,
  confidence: "medium",
  reason: "Makes target off-guard.",
}]);
assert.deepEqual(acSetupBeforeStrikePlan.steps.map((step) => step.slug), ["expose-weak-point", "strike"]);

const attackTraitPlan = bestTurnPlan(fighterContext, [
  {
    id: "trip",
    name: "Trip",
    slug: "trip",
    actionCost: 1,
    source: "generic",
    attackTrait: true,
    score: 90,
    confidence: "medium",
    reason: "Knock prone.",
  },
  {
    id: "longsword",
    name: "Longsword",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    score: 80,
    confidence: "medium",
    reason: "Follow up.",
  },
]);
assert.equal(attackTraitPlan.steps.filter((step) => step.slug === "trip").length, 1);
assert.equal(attackTraitPlan.steps.filter((step) => step.attackIndex).length, 3);
assert.equal(attackTraitPlan.steps.filter((step) => step.slug === "strike").length, 2);
assert.deepEqual(attackTraitPlan.steps.map((step) => step.mapPenalty), [0, 5, 10]);

const farStrikeTarget = {
  ...fighterContext.targets[0],
  distance: 30,
};
const farMeleeStrike = scoreCandidate({
  ...fighterContext,
  targets: [farStrikeTarget],
  enemies: [],
  battlefield: {
    enemies: [],
    targets: [farStrikeTarget],
  },
}, {
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(farMeleeStrike.score < 0);
assert.equal(farMeleeStrike.reason, "Target is out of range.");
assert.equal(farMeleeStrike.suggestedTarget, null);

const strikeWithNearbyEnemy = scoreCandidate({
  ...fighterContext,
  targets: [{
    id: "far-target",
    name: "Fe'Ral",
    distance: 30,
    conditions: [],
  }],
  battlefield: {
    enemies: [{
      id: "far-target",
      name: "Fe'Ral",
      distance: 30,
      conditions: [],
    }, {
      id: "near-target",
      name: "Amiri",
      distance: 5,
      conditions: [],
    }],
  },
}, {
  id: "mandibles",
  name: "Mandibles",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(strikeWithNearbyEnemy.score > 46);
assert.equal(strikeWithNearbyEnemy.suggestedTarget.name, "Amiri");
assert.equal(strikeWithNearbyEnemy.reason, "Melee target is in reach.");

const previousHugeTargetGame = globalThis.game;
const previousHugeTargetCanvas = globalThis.canvas;
try {
  const makeActor = (id, name) => ({
    id,
    uuid: `Actor.${id}`,
    name,
    img: "icons/svg/mystery-man.svg",
    documentName: "Actor",
    isOwner: true,
    items: [],
    itemTypes: { condition: [] },
    getActiveTokens: () => [],
    system: {
      attributes: { hp: { value: 10, max: 10 }, ac: { value: 16 } },
      saves: {},
      skills: {},
      abilities: {},
    },
  });
  const makeToken = (id, name, actor, disposition, x, width = 1, height = 1) => ({
    id,
    name,
    actor,
    x,
    y: 0,
    document: {
      id,
      uuid: `Scene.Token.${id}`,
      name,
      actor,
      disposition,
      x,
      y: 0,
      width,
      height,
      texture: { src: "" },
    },
  });
  const actor = makeActor("feral", "Fe'Ral");
  const hydraActor = makeActor("hydra", "Hydra");
  const activeToken = makeToken("token-feral", "Fe'Ral", actor, 1, 0);
  const hydraToken = makeToken("token-hydra", "Hydra", hydraActor, -1, 5, 3, 3);
  actor.getActiveTokens = () => [activeToken];
  globalThis.canvas = {
    grid: {
      size: 5,
      measurePath: ([from, to]) => Math.abs(to.x - from.x),
    },
    tokens: {
      placeables: [activeToken, hydraToken],
    },
  };
  globalThis.game = {
    user: { isGM: true, targets: new Set([hydraToken]) },
    combat: {
      id: "combat-huge-target",
      round: 1,
      turn: 0,
      started: true,
      combatant: {
        id: "combatant-feral",
        name: "Fe'Ral",
        actor,
        token: { object: activeToken },
      },
      combatants: [{
        id: "combatant-feral",
        name: "Fe'Ral",
        actor,
        tokenId: activeToken.id,
        token: { object: activeToken, id: activeToken.id, uuid: activeToken.document.uuid },
      }, {
        id: "combatant-hydra",
        name: "Hydra",
        actor: hydraActor,
        tokenId: hydraToken.id,
        token: { object: hydraToken, id: hydraToken.id, uuid: hydraToken.document.uuid },
      }],
    },
  };
  const hugeTargetContext = readCombatContext("huge-target-test");
  assert.equal(hugeTargetContext.battlefield.targets[0].distance, 5);
  const adjacentClaw = scoreCandidate({
    ...hugeTargetContext,
    profile: { reach: 5, meleeReach: 5 },
    targets: hugeTargetContext.battlefield.targets,
  }, {
    id: "claw",
    name: "Claw",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    range: { max: 5 },
  });
  assert.equal(adjacentClaw.reason, "Melee target is in reach.");
} finally {
  globalThis.game = previousHugeTargetGame;
  globalThis.canvas = previousHugeTargetCanvas;
}

const closeMeleeStrike = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 5,
  }],
}, {
  id: "longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
});
assert.ok(closeMeleeStrike.score > 46);
assert.equal(closeMeleeStrike.suggestedTarget.name, "Ogre");

const rangedStrike = scoreCandidate({
  ...fighterContext,
  targets: [{
    ...fighterContext.targets[0],
    distance: 30,
  }],
}, {
  id: "shortbow",
  name: "Shortbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 60 },
});
assert.equal(rangedStrike.reason, "Target is in range.");

const spellcasterSpellPriorityContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      itemTypes: {
        spell: [{ id: "needle-darts", type: "spell" }],
        spellcastingEntry: [{ id: "entry-1", type: "spellcastingEntry" }],
      },
      items: [],
    },
  },
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
  battlefield: {
    enemies: [{ ...fighterContext.targets[0], distance: 5 }],
    allies: [],
    targets: [{ ...fighterContext.targets[0], distance: 5 }],
  },
};
const spellcasterMeleeStrike = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "staff",
  name: "Staff",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 8,
});
const spellcasterDamageSpell = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "needle-darts",
  name: "Needle Darts",
  slug: "needle-darts",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { average: 8, type: "piercing", types: ["piercing"] },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
assert.ok(
  spellcasterDamageSpell.score > spellcasterMeleeStrike.score,
  `spellcaster spell should beat melee fallback, got ${spellcasterDamageSpell.score} vs ${spellcasterMeleeStrike.score}`,
);
assert.ok(spellcasterDamageSpell.reasons.includes("Spellcaster spell option is preferred over melee fallback."));
assert.ok(spellcasterMeleeStrike.reasons.includes("Spellcaster melee Strike is lower priority than spell options."));
const spellcasterRangedStrike = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120, increment: 120 },
  averageDamage: 8,
});
assert.equal(
  spellcasterRangedStrike.reasons.includes("Spellcaster melee Strike is lower priority than spell options."),
  false,
);
const spellCrowdedPlans = buildTurnPlans(spellcasterSpellPriorityContext, [
  ...Array.from({ length: 14 }, (_, index) => ({
    id: `spell-crowd-${index}`,
    name: `Spell Crowd ${index}`,
    slug: `spell-crowd-${index}`,
    actionCost: 1,
    source: "spell-inferred",
    score: 200 - index,
    confidence: "medium",
  })),
  {
    id: "staff-fallback",
    name: "Staff",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    score: 70,
    confidence: "medium",
  },
]);
assert.ok(
  spellCrowdedPlans.some((plan) => plan.steps.some((step) => step.id === "staff-fallback")),
  "spell-heavy candidate pool should still keep a martial fallback plan",
);
const supportCrowdedPlans = buildTurnPlans(spellcasterSpellPriorityContext, [
  ...Array.from({ length: 14 }, (_, index) => ({
    id: `spell-crowd-${index}`,
    name: `Spell Crowd ${index}`,
    slug: `spell-crowd-${index}`,
    actionCost: 1,
    source: "spell-inferred",
    role: "damage",
    score: 200 - index,
    confidence: "medium",
  })),
  {
    id: "invisibility",
    name: "Invisibility",
    slug: "invisibility",
    actionCost: 2,
    source: "spell-inferred",
    role: "stealth-defense",
    score: 70,
    confidence: "medium",
  },
]);
assert.ok(
  supportCrowdedPlans.some((plan) => plan.steps.some((step) => step.id === "invisibility")),
  "spell-heavy candidate pool should still keep stealth-defense support like Invisibility",
);
const weakAthleticsWizardContext = {
  ...spellcasterSpellPriorityContext,
  profile: {
    ...spellcasterSpellPriorityContext.profile,
    classSlugs: ["wizard"],
    attackModifier: 8,
    skills: {
      athletics: { rank: 0, mod: 1 },
    },
  },
  actor: {
    ...spellcasterSpellPriorityContext.actor,
    profile: {
      ...spellcasterSpellPriorityContext.profile,
      classSlugs: ["wizard"],
      attackModifier: 8,
      skills: {
        athletics: { rank: 0, mod: 1 },
      },
    },
  },
  isGM: false,
};
const weakAthleticsWizardCandidates = [
  scoreCandidate(weakAthleticsWizardContext, {
    id: "wizard-grapple",
    name: "Grapple",
    slug: "grapple",
    actionCost: 1,
    source: "generic",
    role: "control",
    skill: "athletics",
    targetSave: "fortitude",
    requiresEnemyInReach: true,
    attackTrait: true,
  }),
  scoreCandidate(weakAthleticsWizardContext, {
    id: "wizard-electric-arc",
    name: "Electric Arc",
    slug: "electric-arc",
    actionCost: 2,
    source: "spell-inferred",
    role: "save-damage",
    damageProfile: { average: 7, type: "electricity", types: ["electricity"] },
    saveProfile: { stat: "reflex", basic: true },
    activityProfile: { includes: ["damage"], cantrip: true, averageDamage: 7 },
    targetingProfile: { enemy: true, maxRange: 30 },
  }),
];
const weakAthleticsWizardPlan = bestTurnPlan(weakAthleticsWizardContext, weakAthleticsWizardCandidates);
assert.ok(
  !weakAthleticsWizardPlan.steps.some((step) => step.slug === "grapple"),
  `untrained wizard should not fill a spell turn with Grapple, got ${weakAthleticsWizardPlan.summary}`,
);

const skillGateTarget = {
  id: "skill-gate-target",
  name: "Mitflit",
  distance: 5,
  hpPercent: 1,
  conditions: [],
};
function skillGateContext(skills, actorType = "character", target = skillGateTarget) {
  const profile = {
    actorType,
    hpPercent: 1,
    speed: 25,
    reach: 5,
    handsFree: 2,
    hasShield: false,
    conditions: { slugs: [], values: {} },
    skills,
  };
  const actorDocument = {
    id: `skill-gate-${actorType}`,
    name: "Skill Gate Actor",
    type: actorType,
    system: { actions: [] },
    itemTypes: {
      action: [],
      feat: [],
      feature: [],
      consumable: [],
      spell: [],
      spellcastingEntry: [],
    },
    items: [],
  };
  return {
    actor: { id: actorDocument.id, name: actorDocument.name, document: actorDocument, profile },
    profile,
    token: { id: `token-${actorType}`, name: actorDocument.name, center: { x: 0, y: 0 } },
    targets: [target],
    battlefield: { targets: [target], enemies: [target], allies: [] },
    isGM: false,
  };
}

const untrainedSkillGate = buildCandidates(skillGateContext({
  athletics: { rank: 0, mod: 5 },
  intimidation: { rank: 0, mod: 5 },
  deception: { rank: 0, mod: 5 },
  acrobatics: { rank: 0, mod: 5 },
}));
assert.equal(untrainedSkillGate.candidates.some((action) => action.slug === "grapple"), false);
assert.equal(untrainedSkillGate.candidates.some((action) => action.slug === "trip"), false);
assert.equal(untrainedSkillGate.candidates.some((action) => action.slug === "shove"), false);
assert.equal(untrainedSkillGate.candidates.some((action) => action.slug === "demoralize"), false);
assert.equal(untrainedSkillGate.candidates.some((action) => action.slug === "feint"), false);
assert.ok(untrainedSkillGate.rejected.some(({ action, reason }) =>
  action.slug === "grapple" && reason === "Requires trained Athletics.",
));
assert.ok(untrainedSkillGate.rejected.some(({ action, reason }) =>
  action.slug === "demoralize" && reason === "Requires trained Intimidation.",
));

const trainedSkillGate = buildCandidates(skillGateContext({
  athletics: { rank: 1, mod: 7 },
  intimidation: { rank: 1, mod: 7 },
  deception: { rank: 1, mod: 7 },
  acrobatics: { rank: 1, mod: 7 },
}));
assert.equal(trainedSkillGate.candidates.some((action) => action.slug === "grapple"), true);
assert.equal(trainedSkillGate.candidates.some((action) => action.slug === "trip"), true);
assert.equal(trainedSkillGate.candidates.some((action) => action.slug === "shove"), true);
assert.equal(trainedSkillGate.candidates.some((action) => action.slug === "demoralize"), true);
assert.equal(trainedSkillGate.candidates.some((action) => action.slug === "feint"), true);

const hiddenSkillGateTarget = {
  ...skillGateTarget,
  id: "hidden-skill-gate-target",
  distance: 30,
  conditions: ["hidden"],
};
const untrainedPerceptionGate = buildCandidates(skillGateContext({
  perception: { rank: 0, mod: 6 },
}, "character", hiddenSkillGateTarget));
assert.equal(untrainedPerceptionGate.candidates.some((action) => action.slug === "seek"), false);
assert.ok(untrainedPerceptionGate.rejected.some(({ action, reason }) =>
  action.slug === "seek" && reason === "Requires trained Perception.",
));

const trainedPerceptionGate = buildCandidates(skillGateContext({
  perception: { rank: 1, mod: 8 },
}, "character", hiddenSkillGateTarget));
assert.equal(trainedPerceptionGate.candidates.some((action) => action.slug === "seek"), true);

const originalGameForUntrainedSkillSetting = globalThis.game;
const registeredSettings = [];
try {
  globalThis.game = {
    settings: {
      register: (moduleId, key, config) => registeredSettings.push({ moduleId, key, config }),
      get: (_moduleId, key) => key === SETTINGS.hideUntrainedSkillActions ? false : undefined,
    },
  };
  registerSettings();
  const hideUntrainedSkillActionsSetting = registeredSettings.find((entry) =>
    entry.key === SETTINGS.hideUntrainedSkillActions,
  );
  assert.equal(hideUntrainedSkillActionsSetting?.config?.default, true);
  assert.equal(hideUntrainedSkillActionsSetting?.config?.scope, "world");

  const visibleUntrainedPcSkillGate = buildCandidates(skillGateContext({
    athletics: { rank: 0, mod: 5 },
    intimidation: { rank: 0, mod: 5 },
  }));
  assert.equal(visibleUntrainedPcSkillGate.candidates.some((action) => action.slug === "grapple"), true);
  assert.equal(visibleUntrainedPcSkillGate.candidates.some((action) => action.slug === "demoralize"), true);

  const visibleUntrainedNpcSkillGate = buildCandidates(skillGateContext({
    athletics: { rank: 0, mod: 5 },
    intimidation: { rank: 0, mod: 5 },
  }, "npc"));
  assert.equal(visibleUntrainedNpcSkillGate.candidates.some((action) => action.slug === "grapple"), true);
  assert.equal(visibleUntrainedNpcSkillGate.candidates.some((action) => action.slug === "demoralize"), true);
} finally {
  globalThis.game = originalGameForUntrainedSkillSetting;
}

const npcSkillGate = buildCandidates(skillGateContext({}, "npc"));
assert.equal(npcSkillGate.candidates.some((action) => action.slug === "grapple"), true);
assert.equal(npcSkillGate.candidates.some((action) => action.slug === "demoralize"), true);

const untrainedNpcSkillGate = buildCandidates(skillGateContext({
  athletics: { rank: 0, mod: 5 },
  intimidation: { rank: 0, mod: 5 },
}, "npc"));
assert.equal(untrainedNpcSkillGate.candidates.some((action) => action.slug === "grapple"), false);
assert.equal(untrainedNpcSkillGate.candidates.some((action) => action.slug === "demoralize"), false);
assert.ok(untrainedNpcSkillGate.rejected.some(({ action, reason }) =>
  action.slug === "grapple" && reason === "Requires trained Athletics.",
));

const trainedNpcSkillGate = buildCandidates(skillGateContext({
  athletics: { rank: 1, mod: 7 },
  intimidation: { rank: 1, mod: 7 },
}, "npc"));
assert.equal(trainedNpcSkillGate.candidates.some((action) => action.slug === "grapple"), true);
assert.equal(trainedNpcSkillGate.candidates.some((action) => action.slug === "demoralize"), true);

const unknownNpcRankSkillGate = buildCandidates(skillGateContext({
  athletics: { rank: null, mod: 5 },
  intimidation: { rank: null, mod: 5 },
}, "npc"));
assert.equal(unknownNpcRankSkillGate.candidates.some((action) => action.slug === "grapple"), true);
assert.equal(unknownNpcRankSkillGate.candidates.some((action) => action.slug === "demoralize"), true);

const unknownNpcPerceptionGate = buildCandidates(skillGateContext({
  perception: { rank: null, mod: 8 },
}, "npc", hiddenSkillGateTarget));
assert.equal(unknownNpcPerceptionGate.candidates.some((action) => action.slug === "seek"), true);

const pf2eClassSlugs = [
  "alchemist",
  "animist",
  "barbarian",
  "bard",
  "champion",
  "cleric",
  "commander",
  "druid",
  "exemplar",
  "fighter",
  "guardian",
  "gunslinger",
  "inventor",
  "investigator",
  "kineticist",
  "magus",
  "monk",
  "oracle",
  "psychic",
  "ranger",
  "rogue",
  "sorcerer",
  "summoner",
  "swashbuckler",
  "thaumaturge",
  "witch",
  "wizard",
];
const coveredClasses = coveredClassSlugs();
for (const slug of pf2eClassSlugs) {
  assert.ok(coveredClasses.includes(slug), `missing class tactic coverage for ${slug}`);
}
assert.ok(coveredClasses.includes("runesmith"));
const classTacticsSource = readFileSync(new URL("../rules/class-tactics.js", import.meta.url), "utf8");
assert.equal(classTacticsSource.includes("const CLASS_TACTICS = {"), false);
assert.equal(classTacticsSource.includes("  alchemist: {"), false);

const fighterClassTacticContext = {
  ...fighterContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "fighter",
    classSlugs: ["fighter"],
  },
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
  battlefield: {
    enemies: [{ ...fighterContext.targets[0], distance: 5 }],
    allies: [],
    targets: [{ ...fighterContext.targets[0], distance: 5 }],
  },
};
const fighterClassStrike = scoreCandidate(fighterClassTacticContext, {
  id: "fighter-longsword",
  name: "Longsword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 8,
});
assert.ok(fighterClassStrike.reasons.includes("Fighter tactic favors melee Strikes."));

const wizardClassSpell = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "wizard",
    classSlugs: ["wizard"],
  },
}, {
  id: "wizard-fire-ray",
  name: "Fire Ray",
  slug: "fire-ray",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { average: 10, type: "fire", types: ["fire"] },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
assert.ok(wizardClassSpell.reasons.some((reason) => reason.startsWith("Wizard tactic favors")));

const gunslingerClassTacticContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "gunslinger",
    classSlugs: ["gunslinger"],
  },
};
const gunslingerMeleeStrike = scoreCandidate(gunslingerClassTacticContext, {
  id: "gunslinger-dagger",
  name: "Dagger",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 8,
});
const gunslingerRangedStrike = scoreCandidate(gunslingerClassTacticContext, {
  id: "gunslinger-crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120, increment: 120 },
  averageDamage: 8,
});
assert.ok(
  gunslingerRangedStrike.score > gunslingerMeleeStrike.score,
  `gunslinger ranged Strike should beat melee fallback, got ${gunslingerRangedStrike.score} vs ${gunslingerMeleeStrike.score}`,
);
assert.ok(gunslingerRangedStrike.reasons.some((reason) => reason.includes("Gunslinger") && reason.includes("ranged")));

function classContext(slug, { combatState = {}, target = null, allies = [], subclassSlugs = [] } = {}) {
  const activeTarget = target ?? { ...fighterContext.targets[0], distance: 5 };
  return {
    ...fighterClassTacticContext,
    profile: {
      ...fighterContext.profile,
      classSlug: slug,
      classSlugs: [slug],
      subclassSlug: subclassSlugs[0] ?? null,
      subclassSlugs,
      combatState,
    },
    targets: [activeTarget],
    battlefield: {
      enemies: [activeTarget],
      allies,
      targets: [activeTarget],
    },
  };
}

function mergeCandidate(slug, name, extra = {}) {
  const tactic = findCustomAction(slug) ?? {};
  return {
    id: slug,
    name,
    source: "system-inferred",
    ...tactic,
    ...extra,
    slug,
    actionCost: extra.actionCost ?? tactic.actionCost ?? 1,
    activityProfile: {
      ...(tactic.activityProfile ?? {}),
      ...(extra.activityProfile ?? {}),
    },
    targetingProfile: {
      ...(tactic.targetingProfile ?? {}),
      ...(extra.targetingProfile ?? {}),
    },
  };
}

function expectReason(scored, text) {
  assert.ok(
    scored.reasons.some((reason) => reason.includes(text)),
    `expected reason containing "${text}", got ${scored.reasons.join(" | ")}`,
  );
}

expectReason(
  scoreCandidate(classContext("alchemist", { subclassSlugs: ["bomber"] }), mergeCandidate("quick-bomber", "Quick Bomber")),
  "Bomber field favors bombs",
);
expectReason(
  scoreCandidate(classContext("alchemist", {
    subclassSlugs: ["chirurgeon"],
    allies: [{ id: "ally-1", name: "Ally", hpPercent: 0.45 }],
  }), {
    id: "healing-elixir",
    name: "Healing Elixir",
    slug: "healing-elixir",
    actionCost: 1,
    source: "item",
    type: "consumable",
    item: { type: "consumable", system: { traits: { value: ["alchemical", "elixir"] } } },
    role: "healing",
    activityProfile: { includes: ["healing"] },
    targetingProfile: { ally: true },
  }),
  "Chirurgeon field favors healing",
);
expectReason(
  scoreCandidate(classContext("kineticist", { subclassSlugs: ["fire-gate"] }), {
    id: "elemental-blast-fire",
    name: "Elemental Blast (Fire)",
    slug: "elemental-blast",
    actionCost: 1,
    source: "system-inferred",
    role: "damage",
    traits: ["kineticist", "impulse", "fire"],
    activityProfile: { impulse: true, includes: ["damage"] },
    targetingProfile: { enemy: true, maxRange: 60 },
  }),
  "Fire gate favors fire impulses",
);
expectReason(
  scoreCandidate(classContext("ranger", {
    subclassSlugs: ["flurry"],
    target: { ...fighterContext.targets[0], distance: 5, effects: [{ slug: "hunted-prey" }] },
  }), mergeCandidate("hunted-shot", "Hunted Shot")),
  "Flurry edge favors multiple attacks",
);
expectReason(
  scoreCandidate(classContext("magus", {
    subclassSlugs: ["starlit-span"],
    combatState: { spellstrikeCharged: true },
    target: { ...fighterContext.targets[0], distance: 40 },
  }), {
    id: "ranged-spellstrike",
    name: "Ranged Spellstrike",
    slug: "spellstrike",
    actionCost: 2,
    source: "system-inferred",
    role: "damage",
    traits: ["magus", "ranged"],
    activityProfile: { includes: ["spell", "strike"], includesStrike: true, spellstrike: true },
    targetingProfile: { enemy: true, maxRange: 120 },
  }),
  "Starlit Span favors ranged Spellstrike",
);
expectReason(
  scoreCandidate(classContext("swashbuckler", { subclassSlugs: ["gymnast"] }), mergeCandidate("grapple", "Grapple", {
    role: "control",
    activityProfile: { includes: ["control"], appliesCondition: "grabbed" },
    targetingProfile: { enemy: true, reach: true },
  })),
  "Gymnast style favors athletics",
);
expectReason(
  scoreCandidate(classContext("thaumaturge", {
    subclassSlugs: ["weapon"],
    target: { ...fighterContext.targets[0], distance: 5, effects: [{ slug: "exploited-vulnerability" }] },
  }), {
    id: "weapon-implement-strike",
    name: "Weapon Implement Strike",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    role: "damage",
    averageDamage: 8,
    range: { max: 5 },
    activityProfile: { includes: ["strike"], includesStrike: true },
    traits: ["thaumaturge"],
  }),
  "Weapon implement favors Strike payoffs",
);
expectReason(
  scoreCandidate(classContext("wizard", { subclassSlugs: ["staff-nexus"] }), mergeCandidate("drain-bonded-item", "Drain Bonded Item")),
  "Staff Nexus favors staff",
);

expectReason(
  scoreCandidate(classContext("alchemist"), mergeCandidate("quick-alchemy", "Quick Alchemy")),
  "Quick Alchemy creates the right tool",
);
expectReason(
  scoreCandidate(classContext("animist"), mergeCandidate("circle-of-spirits", "Circle of Spirits", {
    role: "buff",
    activityProfile: { includes: ["buff"] },
    targetingProfile: { self: true },
  })),
  "Animist apparition actions set up spirit magic",
);
expectReason(
  scoreCandidate(classContext("barbarian"), mergeCandidate("rage", "Rage")),
  "Barbarian wants Rage before attacking",
);
expectReason(
  scoreCandidate(classContext("barbarian", { combatState: { rageActive: true } }), mergeCandidate("rage", "Rage")),
  "Rage is already active",
);
expectReason(
  scoreCandidate(classContext("bard", { allies: [{ id: "ally-1", name: "Ally", hpPercent: 1 }] }), mergeCandidate("courageous-anthem", "Courageous Anthem")),
  "Bard composition should anchor the turn",
);
expectReason(
  scoreCandidate(classContext("champion", { allies: [{ id: "ally-1", name: "Ally", hpPercent: 0.4 }] }), mergeCandidate("lay-on-hands", "Lay on Hands")),
  "Champion healing protects wounded allies",
);
expectReason(
  scoreCandidate(classContext("cleric", { allies: [{ id: "ally-1", name: "Ally", hpPercent: 0.4 }] }), {
    id: "heal",
    name: "Heal",
    slug: "heal",
    actionCost: 2,
    source: "spell-inferred",
    role: "healing",
    activityProfile: { includes: ["healing"], spell: true },
    targetingProfile: { ally: true, self: true },
  }),
  "Cleric should stabilize wounded allies",
);
expectReason(
  scoreCandidate(classContext("commander", { allies: [{ id: "ally-1", name: "Ally", hpPercent: 1 }] }), mergeCandidate("strike-hard", "Strike Hard", {
    role: "buff",
    activityProfile: { includes: ["buff"], ally: true },
    targetingProfile: { ally: true },
  })),
  "Commander tactics are high value with allies",
);
expectReason(
  scoreCandidate(classContext("commander"), mergeCandidate("strike-hard", "Strike Hard", {
    role: "buff",
    activityProfile: { includes: ["buff"], ally: true },
    targetingProfile: { ally: true },
  })),
  "Commander tactics need allies",
);
expectReason(
  scoreCandidate(classContext("druid"), mergeCandidate("wild-shape", "Wild Shape")),
  "Wild Shape opens Druid martial options",
);
expectReason(
  scoreCandidate(classContext("exemplar", { combatState: {}, target: { ...fighterContext.targets[0], distance: 20 } }), mergeCandidate("spark-transcendence", "Spark Transcendence", {
    role: "damage",
    activityProfile: { includes: ["damage"] },
    targetingProfile: { enemy: true, maxRange: 30 },
  })),
  "Spark Transcendence is Exemplar",
);
expectReason(
  scoreCandidate(classContext("fighter"), mergeCandidate("power-attack", "Power Attack")),
  "Fighter class Strike is stronger than a plain Strike",
);
expectReason(
  scoreCandidate(classContext("guardian"), mergeCandidate("taunt", "Taunt")),
  "Guardian wants Taunt before defensive payoffs",
);
expectReason(
  scoreCandidate(classContext("inventor"), mergeCandidate("overdrive", "Overdrive")),
  "Inventor wants Overdrive before attacking",
);
expectReason(
  scoreCandidate(classContext("inventor", { combatState: { overdriveActive: true } }), mergeCandidate("overdrive", "Overdrive")),
  "Overdrive is already active",
);
expectReason(
  scoreCandidate(classContext("monk"), mergeCandidate("flurry-of-blows", "Flurry of Blows")),
  "Flurry-style action is Monk",
);
expectReason(
  scoreCandidate(classContext("oracle"), mergeCandidate("whispers-of-weakness", "Whispers of Weakness", {
    role: "debuff",
    activityProfile: { includes: ["debuff"] },
    targetingProfile: { enemy: true, maxRange: 60 },
  })),
  "Oracle revelation action is a class payoff",
);
expectReason(
  scoreCandidate(classContext("psychic"), mergeCandidate("unleash-psyche", "Unleash Psyche")),
  "Psychic wants Unleash Psyche before burst spells",
);
expectReason(
  scoreCandidate(classContext("psychic", { combatState: { unleashPsycheActive: true }, target: { ...fighterContext.targets[0], distance: 30 } }), {
    id: "amp-cantrip",
    name: "Amped Cantrip",
    slug: "amp-cantrip",
    actionCost: 2,
    source: "spell-inferred",
    role: "damage",
    damageProfile: { average: 12, type: "mental", types: ["mental"] },
    activityProfile: { includes: ["damage"], spell: true },
    targetingProfile: { enemy: true, maxRange: 60 },
  }),
  "Unleashed Psyche boosts Psychic burst actions",
);
expectReason(
  scoreCandidate(classContext("rogue"), mergeCandidate("feint", "Feint", {
    role: "setup",
    activityProfile: { includes: ["setup"], appliesCondition: "off-guard" },
    targetingProfile: { enemy: true, reach: true },
  })),
  "Rogue wants off-guard before damage",
);
expectReason(
  scoreCandidate(classContext("rogue", { target: { ...fighterContext.targets[0], distance: 5, conditions: { slugs: ["off-guard"] } } }), {
    id: "rogue-strike",
    name: "Rapier",
    slug: "strike",
    actionCost: 1,
    source: "strike",
    range: { max: 5 },
    averageDamage: 8,
  }),
  "Off-guard target enables Rogue payoff damage",
);
expectReason(
  scoreCandidate(classContext("runesmith"), mergeCandidate("trace-rune", "Trace Rune")),
  "Runesmith wants a rune traced before invoking",
);
expectReason(
  scoreCandidate(classContext("runesmith", { target: { ...fighterContext.targets[0], distance: 20, effects: [{ slug: "traced-rune" }] } }), mergeCandidate("invoke-rune", "Invoke Rune", {
    targetingProfile: { enemy: true, maxRange: 30 },
  })),
  "Invoke Rune pays off a traced rune",
);
expectReason(
  scoreCandidate(classContext("sorcerer", { target: { ...fighterContext.targets[0], distance: 30 } }), {
    id: "bloodline-spell",
    name: "Bloodline Spell",
    slug: "bloodline-spell",
    actionCost: 2,
    source: "spell-inferred",
    role: "damage",
    damageProfile: { average: 12, type: "fire", types: ["fire"] },
    activityProfile: { includes: ["damage"], spell: true },
    targetingProfile: { enemy: true, maxRange: 60 },
  }),
  "Sorcerer should lean into spell damage",
);
expectReason(
  scoreCandidate(classContext("summoner"), mergeCandidate("manifest-eidolon", "Manifest Eidolon")),
  "Summoner wants Eidolon manifested first",
);
expectReason(
  scoreCandidate(classContext("summoner", { combatState: { eidolonManifested: true } }), mergeCandidate("act-together", "Act Together")),
  "Tandem action pays off manifested Eidolon",
);
expectReason(
  scoreCandidate(classContext("witch", { target: { ...fighterContext.targets[0], distance: 30 } }), mergeCandidate("split-hex", "Split Hex", {
    role: "debuff",
    activityProfile: { includes: ["debuff"] },
    targetingProfile: { enemy: true, maxRange: 60 },
  })),
  "Split Hex wants multiple valid enemies",
);
expectReason(
  scoreCandidate(classContext("wizard", { target: { ...fighterContext.targets[0], distance: 30 } }), {
    id: "control-spell",
    name: "Wall Spell",
    slug: "wall-spell",
    actionCost: 3,
    source: "spell-inferred",
    role: "control",
    activityProfile: { includes: ["control"], spell: true },
    targetingProfile: { enemy: true, maxRange: 120 },
  }),
  "Wizard should prioritize high-impact spells",
);

const thaumaturgeClassTacticContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "thaumaturge",
    classSlugs: ["thaumaturge"],
  },
};
const thaumaturgeExploit = scoreCandidate(thaumaturgeClassTacticContext, {
  id: "exploit-vulnerability",
  name: "Exploit Vulnerability",
  slug: "exploit-vulnerability",
  actionCost: 1,
  source: "system-inferred",
  role: exploitVulnerabilityClassification.role,
  activityProfile: exploitVulnerabilityClassification.activityProfile,
  targetingProfile: exploitVulnerabilityClassification.targetingProfile,
  setupFor: exploitVulnerabilityClassification.setupFor,
  traits: ["thaumaturge", "esoterica", "manipulate"],
});
const thaumaturgeDemoralize = scoreCandidate(thaumaturgeClassTacticContext, {
  id: "demoralize",
  name: "Demoralize",
  slug: "demoralize",
  actionCost: 1,
  source: "generic",
  role: "debuff",
  skill: "intimidation",
  targetingProfile: { enemy: true },
});
assert.ok(
  thaumaturgeExploit.score > thaumaturgeDemoralize.score,
  `thaumaturge should prefer Exploit Vulnerability over generic filler, got ${thaumaturgeExploit.score} vs ${thaumaturgeDemoralize.score}`,
);
assert.ok(thaumaturgeExploit.reasons.some((reason) => reason.includes("Exploit Vulnerability signature")));

const kineticistImpulseContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "kineticist",
    classSlugs: ["kineticist"],
  },
  targets: [{ ...fighterContext.targets[0], distance: 35 }],
  battlefield: {
    enemies: [{ ...fighterContext.targets[0], distance: 35 }],
    allies: [],
    targets: [{ ...fighterContext.targets[0], distance: 35 }],
  },
};
const kineticistBurningJet = scoreCandidate(kineticistImpulseContext, {
  id: "burning-jet",
  name: "Burning Jet",
  slug: "burning-jet",
  actionCost: 2,
  source: "system-inferred",
  role: "mobility",
  traits: ["fire", "impulse", "primal"],
  activityProfile: {
    includes: ["stride"],
    strideCount: 1,
    fixedDistance: 40,
    safeMovement: true,
    impulse: true,
  },
  targetingProfile: { self: true },
});
assert.ok(kineticistBurningJet.reasons.some((reason) => reason.includes("Kineticist tactic favors impulses")));
assert.ok(kineticistBurningJet.score > 80);

const kineticistBlastContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      level: 5,
      flags: {
        pf2e: {
          kineticist: {
            elementalBlast: {
              fire: {
                element: "fire",
                label: "PF2E.SpecificRule.Kineticist.Impulse.ElementalBlast.Label.Fire",
                img: "icons/magic/fire/projectile-fireball-smoke-orange.webp",
                damageTypes: ["fire"],
                dieFaces: 6,
                range: 30,
              },
            },
          },
        },
      },
      system: {
        details: { level: { value: 5 } },
        actions: [{
          slug: "battle-axe",
          type: "strike",
          label: "Battle Axe",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "battle-axe",
            name: "Battle Axe",
            system: { damage: { dice: 1, die: "d8", modifier: 4 } },
          },
        }],
      },
      itemTypes: {
        action: [{
          id: "elemental-blast",
          name: "Elemental Blast",
          slug: "elemental-blast",
          type: "action",
          flags: {
            pf2e: {
              rulesSelections: { actionCost: 1 },
              damageSelections: { fire: "fire" },
            },
          },
          system: {
            slug: "elemental-blast",
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["attack", "impulse", "kineticist"] },
          },
        }],
        feat: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: {
    ...fighterContext.profile,
    classSlug: "kineticist",
    classSlugs: ["kineticist"],
  },
  targets: [{ ...fighterContext.targets[0], distance: 25 }],
  battlefield: {
    enemies: [{ ...fighterContext.targets[0], distance: 25 }],
    allies: [],
    targets: [{ ...fighterContext.targets[0], distance: 25 }],
  },
};
const kineticistBlastSources = readActionSources(kineticistBlastContext)
  .filter((action) => action.tacticSlug === "elemental-blast");
assert.equal(kineticistBlastSources.length, 4);
assert.equal(
  kineticistBlastSources.some((action) => action.name === "Elemental Blast (Fire) (ranged)" && action.available),
  true,
);
assert.deepEqual([...new Set(kineticistBlastSources.map((action) => action.actionCost))].toSorted(), [1, 2]);
assert.equal(
  kineticistBlastSources.some((action) => action.name === "Elemental Blast (Fire) (ranged, 2 actions)" && action.available),
  true,
);
assert.ok(
  kineticistBlastSources.find((action) => action.name === "Elemental Blast (Fire) (ranged, 2 actions)").averageDamage
  > kineticistBlastSources.find((action) => action.name === "Elemental Blast (Fire) (ranged)").averageDamage,
);
assert.equal(
  readActionSources(kineticistBlastContext).filter((action) => action.slug === "elemental-blast").length,
  0,
);
const kineticistPlan = bestTurnPlan(kineticistBlastContext, buildCandidates(kineticistBlastContext).candidates);
assert.ok(
  kineticistPlan.steps.some((step) => step.tacticSlug === "elemental-blast"),
  `kineticist plan should include Elemental Blast, got ${kineticistPlan.summary}`,
);
const kineticistBlastBuild = buildCandidates(kineticistBlastContext);
const kineticistBlastBuilder = buildActionBuilderModel({
  context: kineticistBlastContext,
  candidates: kineticistBlastBuild.candidates,
  rejected: kineticistBlastBuild.rejected,
  draft: { steps: [] },
});
const kineticistBlastOneActionRows = kineticistBlastBuilder.tabs.one.all.map((action) => ({
  name: action.name,
  disabled: action.disabled,
  disabledReason: action.disabledReason,
}));
assert.ok(
  kineticistBlastOneActionRows.some((action) => action.name === "Elemental Blast (Fire) (ranged)" && !action.disabled),
  "Action builder should show available ranged Elemental Blast.",
);
assert.ok(
  kineticistBlastOneActionRows.some((action) =>
    action.name === "Elemental Blast (Fire) (melee)" && !action.disabled && action.disabledReason),
  `Action builder should keep melee Elemental Blast visible with a warning; got ${JSON.stringify(kineticistBlastOneActionRows)}`,
);

const extractElementAction = {
  id: "extract-element",
  name: "Extract Element",
  slug: "extract-element",
  actionCost: 1,
  source: "system-inferred",
  role: "save-damage",
  traits: ["kineticist", "impulse", "primal"],
  saveProfile: { stat: "fortitude", basic: false },
  damageProfile: { average: 10, type: "untyped", types: ["untyped"] },
  targetingProfile: { enemy: true, maxRange: 30 },
};

function kineticistExtractContext(target, { isGM = true } = {}) {
  const enemy = {
    ...kineticistBlastContext.targets[0],
    distance: 25,
    ...target,
  };
  return {
    ...kineticistBlastContext,
    isGM,
    targets: [enemy],
    battlefield: {
      allies: [],
      enemies: [enemy],
      targets: [],
    },
  };
}

const mitflitExtractContext = kineticistExtractContext({
  id: "mitflit",
  name: "Mitflit",
  traits: ["fey", "gremlin"],
  weaknesses: [{ type: "cold-iron", value: 2 }],
  resistances: [],
  immunities: [],
});
const invalidExtractElement = scoreCandidate(mitflitExtractContext, extractElementAction);
assert.equal(invalidExtractElement.score, -999);
assert.equal(invalidExtractElement.suggestedTarget, null);
assert.equal(invalidExtractElement.reason, "No valid elemental target.");

const fireTargetExtractElement = scoreCandidate(kineticistExtractContext({
  id: "fire-target",
  name: "Fire Elemental",
  traits: ["elemental", "fire"],
  weaknesses: [],
  resistances: [],
  immunities: [],
}), extractElementAction);
assert.equal(fireTargetExtractElement.suggestedTarget?.name, "Fire Elemental");
assert.ok(fireTargetExtractElement.score > -999);

const fireWeaknessExtractElement = scoreCandidate(kineticistExtractContext({
  id: "fire-weakness-target",
  name: "Oil Ooze",
  traits: ["ooze"],
  weaknesses: [{ type: "fire", value: 5 }],
  resistances: [],
  immunities: [],
}), extractElementAction);
assert.equal(fireWeaknessExtractElement.suggestedTarget?.name, "Oil Ooze");
assert.ok(fireWeaknessExtractElement.score > -999);

const hiddenWeaknessExtractElement = scoreCandidate(kineticistExtractContext({
  id: "hidden-fire-weakness-target",
  name: "Unknown Creature",
  actor: {
    document: {
      system: {
        traits: { value: ["ooze"] },
        attributes: { weaknesses: [{ type: "fire", value: 5 }] },
      },
    },
  },
  resistances: null,
  weaknesses: null,
  immunities: null,
}, { isGM: false }), extractElementAction);
assert.equal(hiddenWeaknessExtractElement.score, -999);
assert.equal(hiddenWeaknessExtractElement.reason, "No valid elemental target.");

const comboStateProfile = readActorProfile({
  id: "combo-state",
  name: "Combo State",
  type: "character",
  itemTypes: {
    class: [{ name: "Magus", type: "class", system: { slug: "magus" } }],
    condition: [],
    effect: [{
      name: "Spellstrike Expended",
      type: "effect",
      system: { slug: { value: "spellstrike-expended" } },
    }, {
      name: "Arcane Cascade",
      type: "effect",
      system: { slug: { value: "arcane-cascade" } },
    }, {
      name: "Panache",
      type: "effect",
      system: { slug: { value: "panache" } },
    }, {
      name: "Rage",
      type: "effect",
      system: { slug: { value: "rage" } },
    }, {
      name: "Overdrive",
      type: "effect",
      system: { slug: { value: "overdrive" } },
    }, {
      name: "Unleash Psyche",
      type: "effect",
      system: { slug: { value: "unleash-psyche" } },
    }, {
      name: "Manifest Eidolon",
      type: "effect",
      system: { slug: { value: "manifest-eidolon" } },
    }, {
      name: "Courageous Anthem",
      type: "effect",
      system: { slug: { value: "courageous-anthem" } },
    }, {
      name: "Lingering Composition",
      type: "effect",
      system: { slug: { value: "lingering-composition" } },
    }, {
      name: "Smite",
      type: "effect",
      system: { slug: { value: "smite" } },
    }, {
      name: "Mutagen",
      type: "effect",
      system: { slug: { value: "mutagen" } },
    }, {
      name: "Cursebound",
      type: "effect",
      system: { slug: { value: "cursebound" } },
    }, {
      name: "Unstable Function",
      type: "effect",
      system: { slug: { value: "unstable-function" } },
    }],
  },
  items: [],
  system: {
    attributes: { hp: { value: 10, max: 10 } },
    movement: { speeds: { land: { value: 25 } } },
    skills: {},
    abilities: {},
  },
});
assert.equal(comboStateProfile.combatState.spellstrikeNeedsRecharge, true);
assert.equal(comboStateProfile.combatState.spellstrikeCharged, false);
assert.equal(comboStateProfile.combatState.arcaneCascadeActive, true);
assert.equal(comboStateProfile.combatState.panacheActive, true);
assert.equal(comboStateProfile.combatState.rageActive, true);
assert.equal(comboStateProfile.combatState.overdriveActive, true);
assert.equal(comboStateProfile.combatState.unleashPsycheActive, true);
assert.equal(comboStateProfile.combatState.eidolonManifested, true);
assert.equal(comboStateProfile.combatState.compositionActive, true);
assert.equal(comboStateProfile.combatState.lingeringCompositionActive, true);
assert.equal(comboStateProfile.combatState.smiteActive, true);
assert.equal(comboStateProfile.combatState.mutagenActive, true);
assert.equal(comboStateProfile.combatState.curseActive, true);
assert.equal(comboStateProfile.combatState.unstableUsed, true);

const weaponInfusionClassification = classifySystemAction({
  name: "Weapon Infusion",
  type: "feat",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["kineticist", "impulse"] },
    description: { value: "<p>If your next action is an Elemental Blast, choose a weapon shape.</p>" },
  },
}, { actionCost: 1 });
assert.equal(weaponInfusionClassification.role, "setup");
assert.equal(weaponInfusionClassification.activityProfile.nextAction, "elemental-blast");
assert.deepEqual(weaponInfusionClassification.setupFor, ["elemental-blast", "damage"]);

const infusionPlan = bestTurnPlan({
  ...kineticistImpulseContext,
  profile: {
    ...kineticistImpulseContext.profile,
    combatState: { kineticistAuraActive: true },
  },
}, [
  {
    id: "weapon-infusion",
    name: "Weapon Infusion",
    slug: "weapon-infusion",
    actionCost: 1,
    source: "system-inferred",
    role: weaponInfusionClassification.role,
    score: 70,
    confidence: "medium",
    activityProfile: weaponInfusionClassification.activityProfile,
    setupFor: weaponInfusionClassification.setupFor,
  },
  {
    id: "elemental-blast-fire",
    name: "Elemental Blast",
    slug: "strike",
    tacticSlug: "elemental-blast",
    actionCost: 1,
    source: "strike",
    score: 80,
    confidence: "medium",
    attackTrait: true,
    range: { max: 30 },
  },
]);
assert.deepEqual(infusionPlan.steps.map((step) => step.id).slice(0, 2), ["weapon-infusion", "elemental-blast-fire"]);

const inactiveAuraKineticistContext = {
  ...kineticistImpulseContext,
  profile: {
    ...kineticistImpulseContext.profile,
    combatState: { kineticistAuraActive: false },
  },
};
const channelElementsScore = scoreCandidate(inactiveAuraKineticistContext, {
  id: "channel-elements",
  name: "Channel Elements",
  slug: "channel-elements",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  traits: ["kineticist", "impulse"],
  activityProfile: { includes: ["setup"], impulse: true },
  targetingProfile: { self: true },
});
const inactiveAuraBlastScore = scoreCandidate(inactiveAuraKineticistContext, {
  id: "elemental-blast-fire",
  name: "Elemental Blast",
  slug: "strike",
  tacticSlug: "elemental-blast",
  actionCost: 1,
  source: "strike",
  traits: ["kineticist", "impulse", "fire"],
  range: { max: 60 },
  averageDamage: 8,
  attackTrait: true,
});
assert.ok(channelElementsScore.score > inactiveAuraBlastScore.score);
assert.ok(channelElementsScore.reasons.includes("Channel Elements opens kinetic aura for impulses."));
assert.ok(inactiveAuraBlastScore.reasons.includes("Impulse wants Channel Elements active first."));

const activeAuraChannelScore = scoreCandidate({
  ...inactiveAuraKineticistContext,
  profile: {
    ...inactiveAuraKineticistContext.profile,
    combatState: { kineticistAuraActive: true },
  },
}, {
  id: "channel-elements",
  name: "Channel Elements",
  slug: "channel-elements",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  traits: ["kineticist", "impulse"],
  activityProfile: { includes: ["setup"], impulse: true },
  targetingProfile: { self: true },
});
assert.equal(activeAuraChannelScore.score, -999);
assert.ok(activeAuraChannelScore.reasons.includes("Kinetic aura already active; Channel Elements is redundant."));

const effectAuraProfile = readActorProfile({
  id: "kineticist-aura-actor",
  name: "Alon",
  itemTypes: {
    class: [{ name: "Kineticist", type: "class", system: { slug: "kineticist" } }],
    effect: [{ name: "Effect: Kinetic Aura", type: "effect" }],
  },
  items: [],
  system: {
    attributes: { hp: { value: 40, max: 40 } },
    skills: {},
    actions: [],
  },
});
assert.equal(effectAuraProfile.combatState.kineticistAuraActive, true);
const effectAuraChannelScore = scoreCandidate({
  ...inactiveAuraKineticistContext,
  profile: effectAuraProfile,
}, {
  id: "channel-elements",
  name: "Channel Elements",
  slug: "channel-elements",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  traits: ["kineticist", "impulse"],
  activityProfile: { includes: ["setup"], impulse: true },
  targetingProfile: { self: true },
});
assert.equal(effectAuraChannelScore.score, -999);

const overflowImpulseAction = {
  id: "blazing-wave",
  name: "Blazing Wave",
  slug: "blazing-wave",
  actionCost: 2,
  source: "system-inferred",
  role: "save-damage",
  traits: ["kineticist", "impulse", "overflow", "fire"],
  activityProfile: { includes: ["damage"], impulse: true, overflow: true },
  targetingProfile: { enemy: true, maxRange: 30 },
  saveProfile: { stat: "reflex", basic: true },
  damageProfile: { average: 18, type: "fire", types: ["fire"] },
};
const inactiveAuraOverflowScore = scoreCandidate(inactiveAuraKineticistContext, overflowImpulseAction);
assert.ok(channelElementsScore.score > inactiveAuraOverflowScore.score);
assert.ok(inactiveAuraOverflowScore.reasons.includes("Impulse wants Channel Elements active first."));
const activeAuraOverflowScore = scoreCandidate({
  ...inactiveAuraKineticistContext,
  profile: {
    ...inactiveAuraKineticistContext.profile,
    combatState: { kineticistAuraActive: true },
  },
}, overflowImpulseAction);
assert.ok(activeAuraOverflowScore.reasons.includes("Overflow impulse spends the aura for a strong payoff."));

const magusBaseContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "magus",
    classSlugs: ["magus"],
    combatState: { spellstrikeCharged: false, spellstrikeNeedsRecharge: true },
  },
};
const needsRechargeSpellstrike = scoreCandidate(magusBaseContext, {
  id: "spellstrike",
  name: "Spellstrike",
  slug: "spellstrike",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  traits: ["magus"],
  activityProfile: { includes: ["spell", "strike"], includesStrike: true, spellstrike: true },
  targetingProfile: { enemy: true, reach: true },
});
const rechargeSpellstrike = scoreCandidate(magusBaseContext, {
  id: "recharge-spellstrike",
  name: "Recharge Spellstrike",
  slug: "recharge-spellstrike",
  actionCost: 1,
  source: "system-inferred",
  role: "resource-recovery",
  traits: ["magus"],
  activityProfile: { includes: ["resource"], rechargeSpellstrike: true },
  targetingProfile: { self: true },
});
assert.ok(rechargeSpellstrike.score > needsRechargeSpellstrike.score);
assert.ok(needsRechargeSpellstrike.reasons.includes("Spellstrike needs recharge before use."));
assert.ok(rechargeSpellstrike.reasons.includes("Recharge Spellstrike restores Magus' main payoff."));

const chargedMagusContext = {
  ...magusBaseContext,
  profile: {
    ...magusBaseContext.profile,
    combatState: { spellstrikeCharged: true, spellstrikeNeedsRecharge: false },
  },
};
const chargedSpellstrike = scoreCandidate(chargedMagusContext, {
  id: "spellstrike",
  name: "Spellstrike",
  slug: "spellstrike",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  traits: ["magus"],
  activityProfile: { includes: ["spell", "strike"], includesStrike: true, spellstrike: true },
  targetingProfile: { enemy: true, reach: true },
});
const chargedRecharge = scoreCandidate(chargedMagusContext, {
  id: "recharge-spellstrike",
  name: "Recharge Spellstrike",
  slug: "recharge-spellstrike",
  actionCost: 1,
  source: "system-inferred",
  role: "resource-recovery",
  traits: ["magus"],
  activityProfile: { includes: ["resource"], rechargeSpellstrike: true },
  targetingProfile: { self: true },
});
assert.ok(chargedSpellstrike.score > chargedRecharge.score);
assert.ok(chargedSpellstrike.reasons.includes("Spellstrike is charged."));
assert.ok(chargedRecharge.reasons.includes("Spellstrike is already charged."));

const exploitedTarget = {
  ...fighterContext.targets[0],
  distance: 5,
  effects: [{ slug: "exploited-vulnerability", name: "Exploited Vulnerability" }],
};
const exploitedThaumaturgeContext = {
  ...thaumaturgeClassTacticContext,
  targets: [exploitedTarget],
  battlefield: { targets: [exploitedTarget], enemies: [exploitedTarget], allies: [] },
};
const duplicateExploit = scoreCandidate(exploitedThaumaturgeContext, {
  id: "exploit-vulnerability",
  name: "Exploit Vulnerability",
  slug: "exploit-vulnerability",
  actionCost: 1,
  source: "system-inferred",
  role: exploitVulnerabilityClassification.role,
  activityProfile: exploitVulnerabilityClassification.activityProfile,
  targetingProfile: exploitVulnerabilityClassification.targetingProfile,
  setupFor: exploitVulnerabilityClassification.setupFor,
  traits: ["thaumaturge", "esoterica", "manipulate"],
});
assert.equal(duplicateExploit.score, -999);
assert.equal(duplicateExploit.reason, "Target is already exploited.");

const primaryEvTarget = {
  ...fighterContext.targets[0],
  distance: 5,
  effects: [{ name: "Primary EV Target: Calder Stoneplow" }],
};
const primaryEvContext = {
  ...thaumaturgeClassTacticContext,
  targets: [primaryEvTarget],
  battlefield: { targets: [primaryEvTarget], enemies: [primaryEvTarget], allies: [] },
};
const duplicatePrimaryEv = scoreCandidate(primaryEvContext, {
  id: "exploit-vulnerability-primary",
  name: "Exploit Vulnerability",
  slug: "exploit-vulnerability",
  actionCost: 1,
  source: "system-inferred",
  role: exploitVulnerabilityClassification.role,
  activityProfile: exploitVulnerabilityClassification.activityProfile,
  targetingProfile: exploitVulnerabilityClassification.targetingProfile,
  setupFor: exploitVulnerabilityClassification.setupFor,
  traits: ["thaumaturge", "esoterica", "manipulate"],
});
assert.equal(duplicatePrimaryEv.score, -999);
assert.equal(duplicatePrimaryEv.reason, "Target is already exploited.");

const personalAntithesisTarget = {
  ...fighterContext.targets[0],
  distance: 5,
  effects: [{ name: "Personal Antithesis" }],
};
const duplicatePersonalAntithesis = scoreCandidate({
  ...thaumaturgeClassTacticContext,
  targets: [personalAntithesisTarget],
  battlefield: { targets: [personalAntithesisTarget], enemies: [personalAntithesisTarget], allies: [] },
}, {
  id: "exploit-vulnerability-personal-antithesis",
  name: "Exploit Vulnerability",
  slug: "exploit-vulnerability",
  actionCost: 1,
  source: "system-inferred",
  role: exploitVulnerabilityClassification.role,
  activityProfile: exploitVulnerabilityClassification.activityProfile,
  targetingProfile: exploitVulnerabilityClassification.targetingProfile,
  setupFor: exploitVulnerabilityClassification.setupFor,
  traits: ["thaumaturge", "esoterica", "manipulate"],
});
assert.equal(duplicatePersonalAntithesis.score, -999);
assert.equal(duplicatePersonalAntithesis.reason, "Target is already exploited.");

const unexploitedSecondTarget = {
  id: "second-target",
  name: "Second Target",
  distance: 10,
  hpPercent: 1,
  conditions: [],
};
const retargetExploit = scoreCandidate({
  ...thaumaturgeClassTacticContext,
  targets: [primaryEvTarget],
  battlefield: { targets: [primaryEvTarget], enemies: [primaryEvTarget, unexploitedSecondTarget], allies: [] },
}, {
  id: "exploit-vulnerability-retarget",
  name: "Exploit Vulnerability",
  slug: "exploit-vulnerability",
  actionCost: 1,
  source: "system-inferred",
  role: exploitVulnerabilityClassification.role,
  activityProfile: exploitVulnerabilityClassification.activityProfile,
  targetingProfile: exploitVulnerabilityClassification.targetingProfile,
  setupFor: exploitVulnerabilityClassification.setupFor,
  traits: ["thaumaturge", "esoterica", "manipulate"],
});
assert.equal(retargetExploit.suggestedTarget?.name, "Second Target");
const exploitedStrike = scoreCandidate(exploitedThaumaturgeContext, {
  id: "thaumaturge-strike",
  name: "Weapon Strike",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 8,
});
assert.ok(exploitedStrike.reasons.includes("Exploited target makes Thaumaturge damage better."));

const rangerClassTacticContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "ranger",
    classSlugs: ["ranger"],
    combatState: { huntedPreyActive: false },
  },
};
const rangerHuntPrey = scoreCandidate(rangerClassTacticContext, {
  id: "hunt-prey",
  name: "Hunt Prey",
  slug: "hunt-prey",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "hunted-prey" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["ranger"],
});
const rangerStrikeWithoutPrey = scoreCandidate(rangerClassTacticContext, {
  id: "ranger-strike",
  name: "Longbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 100, increment: 100 },
  averageDamage: 8,
});
assert.ok(
  rangerHuntPrey.score > rangerStrikeWithoutPrey.score,
  `ranger should prefer Hunt Prey setup first, got ${rangerHuntPrey.score} vs ${rangerStrikeWithoutPrey.score}`,
);
assert.ok(rangerHuntPrey.reasons.includes("Hunt Prey should come before Ranger attacks."));
assert.ok(rangerStrikeWithoutPrey.reasons.includes("Ranger attacks want Hunt Prey first."));

const huntedPreyTarget = {
  ...fighterContext.targets[0],
  distance: 30,
  effects: [{ slug: "hunted-prey", name: "Hunted Prey" }],
};
const huntedRangerContext = {
  ...rangerClassTacticContext,
  profile: {
    ...rangerClassTacticContext.profile,
    combatState: { huntedPreyActive: true },
  },
  targets: [huntedPreyTarget],
  battlefield: { targets: [huntedPreyTarget], enemies: [huntedPreyTarget], allies: [] },
};
const duplicateHuntPrey = scoreCandidate(huntedRangerContext, {
  id: "hunt-prey",
  name: "Hunt Prey",
  slug: "hunt-prey",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "hunted-prey" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["ranger"],
});
const huntedRangerStrike = scoreCandidate(huntedRangerContext, {
  id: "hunted-shot",
  name: "Hunted Shot",
  slug: "hunted-shot",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  activityProfile: { includes: ["strike"], includesStrike: true, multiStrike: true },
  targetingProfile: { enemy: true },
  traits: ["ranger"],
});
assert.ok(huntedRangerStrike.score > duplicateHuntPrey.score);
assert.equal(duplicateHuntPrey.score, -999);
assert.equal(duplicateHuntPrey.reason, "Target already has Hunted Prey.");
assert.ok(huntedRangerStrike.reasons.includes("Hunted prey makes Ranger attacks better."));

const secondPreyTarget = {
  id: "second-prey",
  name: "Second Prey",
  distance: 40,
  hpPercent: 1,
  conditions: [],
};
const retargetHuntPrey = scoreCandidate({
  ...huntedRangerContext,
  battlefield: { targets: [huntedPreyTarget], enemies: [huntedPreyTarget, secondPreyTarget], allies: [] },
}, {
  id: "hunt-prey-retarget",
  name: "Hunt Prey",
  slug: "hunt-prey",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "hunted-prey" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["ranger"],
});
assert.equal(retargetHuntPrey.suggestedTarget?.name, "Second Prey");

const wrongPreyContext = {
  ...rangerClassTacticContext,
  profile: {
    ...rangerClassTacticContext.profile,
    combatState: { huntedPreyActive: true },
  },
  targets: [secondPreyTarget],
  battlefield: { targets: [secondPreyTarget], enemies: [secondPreyTarget], allies: [] },
};
const rangerStrikeWrongPrey = scoreCandidate(wrongPreyContext, {
  id: "ranger-strike-wrong-prey",
  name: "Longbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 100, increment: 100 },
  averageDamage: 8,
});
assert.ok(rangerStrikeWrongPrey.reasons.includes("This target is not the hunted prey."));
assert.equal(rangerStrikeWrongPrey.reasons.includes("Hunted prey makes Ranger attacks better."), false);

const investigatorClassTacticContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "investigator",
    classSlugs: ["investigator"],
    combatState: { deviseStratagemActive: false },
  },
};
const deviseStratagem = scoreCandidate(investigatorClassTacticContext, {
  id: "devise-a-stratagem",
  name: "Devise a Stratagem",
  slug: "devise-a-stratagem",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "devised-stratagem" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["investigator"],
});
const investigatorStrikeWithoutDevise = scoreCandidate(investigatorClassTacticContext, {
  id: "investigator-crossbow",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120, increment: 120 },
  averageDamage: 8,
});
assert.ok(deviseStratagem.score > investigatorStrikeWithoutDevise.score);
assert.ok(deviseStratagem.reasons.includes("Devise a Stratagem should come before Investigator attacks."));
assert.ok(investigatorStrikeWithoutDevise.reasons.includes("Investigator attacks want Devise a Stratagem first."));

const devisedTarget = {
  ...fighterContext.targets[0],
  distance: 5,
  effects: [{ slug: "devised-stratagem", name: "Devised Stratagem" }],
};
const devisedInvestigatorContext = {
  ...investigatorClassTacticContext,
  profile: {
    ...investigatorClassTacticContext.profile,
    combatState: { deviseStratagemActive: true },
  },
  targets: [devisedTarget],
  battlefield: { targets: [devisedTarget], enemies: [devisedTarget], allies: [] },
};
const duplicateDevise = scoreCandidate(devisedInvestigatorContext, {
  id: "devise-a-stratagem",
  name: "Devise a Stratagem",
  slug: "devise-a-stratagem",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "devised-stratagem" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["investigator"],
});
const devisedInvestigatorStrike = scoreCandidate(devisedInvestigatorContext, {
  id: "investigator-strike",
  name: "Rapier",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 8,
});
assert.ok(devisedInvestigatorStrike.score > duplicateDevise.score);
assert.equal(duplicateDevise.score, -999);
assert.equal(duplicateDevise.reason, "Target already has Devised Stratagem.");
assert.ok(devisedInvestigatorStrike.reasons.includes("Devised Stratagem supports this attack."));

const secondDeviseTarget = {
  id: "second-devise",
  name: "Second Suspect",
  distance: 20,
  hpPercent: 1,
  conditions: [],
};
const retargetDevise = scoreCandidate({
  ...devisedInvestigatorContext,
  battlefield: { targets: [devisedTarget], enemies: [devisedTarget, secondDeviseTarget], allies: [] },
}, {
  id: "devise-a-stratagem-retarget",
  name: "Devise a Stratagem",
  slug: "devise-a-stratagem",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], targetMark: "devised-stratagem" },
  targetingProfile: { enemy: true },
  setupFor: ["strike", "damage"],
  traits: ["investigator"],
});
assert.equal(retargetDevise.suggestedTarget?.name, "Second Suspect");

const wrongDeviseContext = {
  ...investigatorClassTacticContext,
  profile: {
    ...investigatorClassTacticContext.profile,
    combatState: { deviseStratagemActive: true },
  },
  targets: [secondDeviseTarget],
  battlefield: { targets: [secondDeviseTarget], enemies: [secondDeviseTarget], allies: [] },
};
const investigatorStrikeWrongDevise = scoreCandidate(wrongDeviseContext, {
  id: "investigator-strike-wrong-devise",
  name: "Crossbow",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 120, increment: 120 },
  averageDamage: 8,
});
assert.ok(investigatorStrikeWrongDevise.reasons.includes("This target is not the devised target."));
assert.equal(investigatorStrikeWrongDevise.reasons.includes("Devised Stratagem supports this attack."), false);

const swashbucklerClassTacticContext = {
  ...fighterClassTacticContext,
  profile: {
    ...fighterContext.profile,
    classSlug: "swashbuckler",
    classSlugs: ["swashbuckler"],
    combatState: { panacheActive: false },
  },
};
const tumbleThrough = scoreCandidate(swashbucklerClassTacticContext, {
  id: "tumble-through",
  name: "Tumble Through",
  slug: "tumble-through",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], gainPanache: true },
  targetingProfile: { enemy: true },
  setupFor: ["finisher", "strike", "damage"],
  traits: ["swashbuckler", "move"],
});
const unreadyFinisher = scoreCandidate(swashbucklerClassTacticContext, {
  id: "confident-finisher",
  name: "Confident Finisher",
  slug: "confident-finisher",
  actionCost: 1,
  source: "system-inferred",
  role: "damage",
  activityProfile: { includes: ["strike"], includesStrike: true, finisher: true },
  targetingProfile: { enemy: true, reach: true },
  traits: ["swashbuckler", "finisher"],
});
assert.ok(tumbleThrough.score > unreadyFinisher.score);
assert.ok(tumbleThrough.reasons.includes("Swashbuckler wants panache before finishers."));
assert.ok(unreadyFinisher.reasons.includes("Finisher needs panache first."));

const panacheSwashbucklerContext = {
  ...swashbucklerClassTacticContext,
  profile: {
    ...swashbucklerClassTacticContext.profile,
    combatState: { panacheActive: true },
  },
};
const readyFinisher = scoreCandidate(panacheSwashbucklerContext, {
  id: "confident-finisher",
  name: "Confident Finisher",
  slug: "confident-finisher",
  actionCost: 1,
  source: "system-inferred",
  role: "damage",
  activityProfile: { includes: ["strike"], includesStrike: true, finisher: true },
  targetingProfile: { enemy: true, reach: true },
  traits: ["swashbuckler", "finisher"],
});
const redundantPanacheGain = scoreCandidate(panacheSwashbucklerContext, {
  id: "tumble-through",
  name: "Tumble Through",
  slug: "tumble-through",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], gainPanache: true },
  targetingProfile: { enemy: true },
  traits: ["swashbuckler", "move"],
});
assert.ok(readyFinisher.score > redundantPanacheGain.score);
assert.ok(readyFinisher.reasons.includes("Panache active; finisher is ready."));
assert.ok(redundantPanacheGain.reasons.includes("Panache already active; gaining panache is lower value."));

const previousGame = globalThis.game;
const previousCanvas = globalThis.canvas;
const previousConst = globalThis.CONST;
try {
  const makeActor = (id, name, type = "npc") => ({
    id,
    uuid: `Actor.${id}`,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    documentName: "Actor",
    isOwner: true,
    items: [],
    itemTypes: { condition: [] },
    getActiveTokens: () => [],
    system: {
      attributes: {
        hp: { value: 10, max: 10 },
        ac: { value: 16 },
        resistances: [{ type: "fire", value: 5 }],
        weaknesses: [{ type: "cold", value: 3 }],
        immunities: [{ type: "poison" }],
      },
      perception: { dc: 20, mod: 10 },
      saves: {
        fortitude: { dc: 17 },
        reflex: { dc: 18 },
        will: { dc: 19 },
      },
      skills: {},
      abilities: {},
    },
  });
  const valerosActor = makeActor("valeros", "Valeros");
  const ezrenActor = makeActor("ezren", "Ezren");
  const centipedeActor = makeActor("centipede", "Giant Centipede");
  const nakpikActor = makeActor("nakpik", "Nakpik");
  const hiddenPitActor = makeActor("hidden-pit", "Hidden Pit", "hazard");
  const treasureActor = makeActor("treasure", "Treasure", "loot");
  const makeToken = (id, name, actor, disposition, x) => ({
    id,
    name,
    actor,
    x,
    y: 0,
    document: {
      id,
      uuid: `Scene.Token.${id}`,
      name,
      actor,
      disposition,
      x,
      y: 0,
      width: 1,
      height: 1,
      texture: { src: "" },
    },
  });
  const activeToken = makeToken("token-valeros", "Valeros", valerosActor, 1, 0);
  const allyToken = makeToken("token-ezren", "Ezren", ezrenActor, 1, 5);
  const enemyToken = makeToken("token-centipede", "Giant Centipede", centipedeActor, -1, 40);
  const neutralToken = makeToken("token-nakpik", "Nakpik", nakpikActor, 0, 10);
  const hiddenPitToken = makeToken("token-hidden-pit", "Hidden Pit", hiddenPitActor, -1, 10);
  const treasureToken = makeToken("token-treasure", "Treasure", treasureActor, -1, 15);
  const makeCombatant = (token) => ({
    id: `combatant-${token.id}`,
    name: token.name,
    actor: token.actor,
    tokenId: token.id,
    token: { object: token, id: token.id, uuid: token.document.uuid },
  });
  const combatantsFor = (tokens) => tokens.map((token) => makeCombatant(token));
  const activeCombatant = makeCombatant(activeToken);
  valerosActor.getActiveTokens = () => [activeToken];
  globalThis.canvas = {
    grid: {
      size: 1,
      measurePath: ([from, to]) => Math.abs(to.x - from.x),
    },
    tokens: {
      placeables: [activeToken, allyToken, enemyToken],
    },
  };
  globalThis.game = {
    user: {
      isGM: true,
      targets: new Set([allyToken]),
    },
    combat: {
      id: "combat-1",
      round: 1,
      turn: 0,
      started: true,
      combatant: activeCombatant,
      combatants: combatantsFor([activeToken, allyToken, enemyToken]),
    },
  };
  const setCombatants = (tokens) => {
    globalThis.game.combat.combatants = combatantsFor(tokens);
  };
  const contextWithFriendlyTarget = readCombatContext("test");
  assert.equal(contextWithFriendlyTarget.battlefield.targets.length, 1);
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].name, "Giant Centipede");
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].disposition, -1);
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].ac, 16);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].saves, {
    fortitude: 17,
    reflex: 18,
    will: 19,
  });
  assert.equal(contextWithFriendlyTarget.battlefield.targets[0].perceptionDC, 20);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].resistances, [{ type: "fire", value: 5 }]);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].weaknesses, [{ type: "cold", value: 3 }]);
  assert.deepEqual(contextWithFriendlyTarget.battlefield.targets[0].immunities, [{ type: "poison" }]);

  centipedeActor.itemTypes.effect = [{
    id: "demoralize-immunity",
    name: "Effect: Demoralize Immunity",
    slug: "effect-demoralize-immunity",
  }];
  const demoralizeEffectContext = readCombatContext("demoralize-effect-test");
  assert.deepEqual(demoralizeEffectContext.battlefield.targets[0].effects, [{
    id: "demoralize-immunity",
    uuid: null,
    name: "Effect: Demoralize Immunity",
    slug: "effect-demoralize-immunity",
    sourceId: null,
  }]);
  centipedeActor.itemTypes.effect = [];

  centipedeActor.itemTypes.condition = [{ slug: "undetected", system: { value: { value: 1 } } }];
  globalThis.game.user.targets = new Set([enemyToken]);
  const undetectedTargetContext = readCombatContext("undetected-target-test");
  assert.equal(undetectedTargetContext.battlefield.targets[0].name, "Giant Centipede");
  assert.equal(undetectedTargetContext.battlefield.targets[0].attackTargetable, false);
  assert.equal(undetectedTargetContext.battlefield.targets[0].conditions.slugs.includes("undetected"), true);
  centipedeActor.itemTypes.condition = [];

  globalThis.game.user.isGM = false;
  centipedeActor.itemTypes.effect = [{
    id: "visible-mark",
    name: "Visible Mark",
    slug: "visible-mark",
  }, {
    id: "secret-weakness",
    name: "Secret Weakness",
    slug: "secret-weakness",
    hidden: true,
  }];
  const playerContextWithoutDefenses = readCombatContext("player-test");
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].name, "Giant Centipede");
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].ac, null);
  assert.deepEqual(playerContextWithoutDefenses.battlefield.targets[0].saves, {});
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].perceptionDC, null);
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].resistances, null);
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].weaknesses, null);
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].immunities, null);
  assert.equal(playerContextWithoutDefenses.battlefield.targets[0].actor.document, undefined);
  assert.equal(playerContextWithoutDefenses.battlefield.enemies[0].actor.document, undefined);
  assert.deepEqual(
    playerContextWithoutDefenses.battlefield.targets[0].effects.map((effect) => effect.name),
    ["Visible Mark"],
  );
  centipedeActor.itemTypes.effect = [];

  enemyToken.hidden = true;
  enemyToken.document.hidden = true;
  const playerContextWithoutHiddenEnemy = readCombatContext("player-hidden-token-test");
  assert.equal(playerContextWithoutHiddenEnemy.battlefield.enemies.length, 0);
  assert.equal(playerContextWithoutHiddenEnemy.battlefield.targets.length, 0);
  enemyToken.hidden = false;
  enemyToken.document.hidden = false;

  globalThis.game.user.isGM = true;
  globalThis.game.user.targets = new Set([neutralToken]);
  globalThis.canvas.tokens.placeables = [activeToken, neutralToken, enemyToken];
  const neutralTargetContext = readCombatContext("neutral-target-test");
  assert.deepEqual(
    neutralTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(neutralTargetContext.battlefield.targets.length, 1);
  assert.equal(neutralTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const calderActor = makeActor("calder", "Calder Stoneplow");
  const calderToken = makeToken("token-calder", "Calder Stoneplow", calderActor, 1, 30);
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [neutralToken, calderToken];
  globalThis.game.combat.combatant = makeCombatant(neutralToken);
  setCombatants([neutralToken, calderToken]);
  const neutralActiveContext = readCombatContext("neutral-active-test");
  assert.equal(neutralActiveContext.actor.name, "Nakpik");
  assert.deepEqual(
    neutralActiveContext.battlefield.enemies.map((target) => target.name),
    ["Calder Stoneplow"],
  );
  assert.equal(neutralActiveContext.battlefield.targets[0].name, "Calder Stoneplow");
  assert.ok(
    buildCandidates(neutralActiveContext).candidates.some((action) => ["step", "stride"].includes(action.slug)),
  );

  globalThis.game.user.targets = new Set([hiddenPitToken, treasureToken]);
  globalThis.canvas.tokens.placeables = [activeToken, hiddenPitToken, treasureToken, enemyToken];
  globalThis.game.combat.combatant = activeCombatant;
  setCombatants([activeToken, hiddenPitToken, treasureToken, enemyToken]);
  const objectTargetContext = readCombatContext("object-target-test");
  assert.deepEqual(
    objectTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(objectTargetContext.battlefield.targets.length, 1);
  assert.equal(objectTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const offCombatActor = makeActor("off-combat", "Off Combat Target");
  const offCombatToken = makeToken("token-off-combat", "Off Combat Target", offCombatActor, -1, 1);
  globalThis.game.user.targets = new Set([offCombatToken]);
  globalThis.canvas.tokens.placeables = [activeToken, offCombatToken, enemyToken];
  setCombatants([activeToken, enemyToken]);
  const outOfCombatTargetContext = readCombatContext("out-of-combat-target-test");
  assert.deepEqual(
    outOfCombatTargetContext.battlefield.enemies.map((target) => target.name),
    ["Giant Centipede"],
  );
  assert.equal(outOfCombatTargetContext.battlefield.targets.length, 1);
  assert.equal(outOfCombatTargetContext.battlefield.targets[0].name, "Giant Centipede");

  const farEnemyActor = makeActor("feral", "Fe'Ral");
  const nearEnemyActor = makeActor("amiri", "Amiri");
  const farEnemyToken = makeToken("token-feral", "Fe'Ral", farEnemyActor, -1, 60);
  const nearEnemyToken = makeToken("token-amiri", "Amiri", nearEnemyActor, -1, 5);
  globalThis.game.user.isGM = true;
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [activeToken, farEnemyToken, nearEnemyToken];
  setCombatants([activeToken, farEnemyToken, nearEnemyToken]);
  const nearestFallbackContext = readCombatContext("nearest-test");
  assert.equal(nearestFallbackContext.battlefield.targets[0].name, "Amiri");

  const sootscaleActor = makeActor("sootscale-kobold-scout", "Sootscale Kobold Scout");
  const nakpikToken = makeToken("token-nakpik-active", "Nakpik", sootscaleActor, -1, 0);
  const otherSootscaleToken = makeToken("token-sootscale-other", "Sootscale Kobold Scout", sootscaleActor, -1, 10);
  sootscaleActor.getActiveTokens = () => [otherSootscaleToken, nakpikToken];
  globalThis.game.user.targets = new Set();
  globalThis.canvas.tokens.placeables = [otherSootscaleToken, nakpikToken, calderToken];
  globalThis.game.combat.combatant = {
    id: "combatant-nakpik",
    name: "Nakpik",
    actor: sootscaleActor,
    tokenId: nakpikToken.id,
    token: { id: nakpikToken.id, uuid: nakpikToken.document.uuid },
  };
  globalThis.game.combat.combatants = [
    globalThis.game.combat.combatant,
    makeCombatant(calderToken),
  ];
  const namedTokenContext = readCombatContext("named-token-test");
  assert.equal(namedTokenContext.actor.name, "Nakpik");
  assert.equal(namedTokenContext.token.name, "Nakpik");
  assert.deepEqual(
    namedTokenContext.battlefield.enemies.map((target) => target.name),
    ["Calder Stoneplow"],
  );
  assert.equal(namedTokenContext.battlefield.targets[0].name, "Calder Stoneplow");

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: "OWNER" } };
  const expectedOwnerPermission = globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  const ownedActor = {
    id: "actor-owned",
    uuid: "Actor.actor-owned",
    name: "Owned Hero",
    img: "owned.webp",
    type: "character",
    system: { attributes: { hp: { value: 10, max: 10 } } },
    itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [] },
    items: [],
    testUserPermission: (_user, permission) => {
      assert.equal(permission, expectedOwnerPermission);
      return true;
    },
  };
  const unownedActor = {
    ...ownedActor,
    id: "actor-unowned",
    uuid: "Actor.actor-unowned",
    name: "Unowned Hero",
    testUserPermission: () => false,
  };
  const selectedCombatant = {
    id: "combatant-owned",
    actor: ownedActor,
    name: "Owned Hero",
    tokenId: "token-owned",
    token: { object: { id: "token-owned", document: { id: "token-owned", x: 0, y: 0, width: 1, height: 1 }, actor: ownedActor } },
  };
  const unownedCombatant = {
    id: "combatant-unowned",
    actor: unownedActor,
    name: "Unowned Hero",
    tokenId: "token-unowned",
    token: { object: { id: "token-unowned", document: { id: "token-unowned", x: 5, y: 0, width: 1, height: 1 }, actor: unownedActor } },
  };
  globalThis.game = {
    user: { isGM: false },
    combat: {
      id: "combat-builder",
      round: 1,
      turn: 0,
      started: true,
      combatant: selectedCombatant,
      combatants: [selectedCombatant, unownedCombatant],
    },
  };
  globalThis.canvas = {
    grid: { size: 5 },
    tokens: {
      controlled: [],
      placeables: [selectedCombatant.token.object, unownedCombatant.token.object],
    },
  };
  const selectedContext = readCombatContext("test", { combatant: selectedCombatant });
  assert.equal(selectedContext.combatant.id, "combatant-owned");
  const blockedContext = readCombatContext("test", { combatant: unownedCombatant });
  assert.equal(blockedContext, null);
  globalThis.game.combat.combatant = unownedCombatant;
  globalThis.canvas.tokens.controlled = [selectedCombatant.token.object];
  const controlledContext = readCombatContext("test");
  assert.equal(controlledContext.combatant.id, "combatant-owned");
  globalThis.canvas.tokens.controlled = [unownedCombatant.token.object];
  assert.equal(readCombatContext("test"), null);
  globalThis.game.user.isGM = true;
  globalThis.canvas.tokens.controlled = [];
  const gmContext = readCombatContext("test", { combatant: unownedCombatant });
  assert.equal(gmContext.combatant.id, "combatant-unowned");

  globalThis.game.combat.combatant = selectedCombatant;
  selectedCombatant.token.object.x = 5;
  selectedCombatant.token.object.document.x = 5;
  assert.equal(markMovementActionSpent(selectedCombatant.token.object, {
    combat: globalThis.game.combat,
    changed: { x: 5 },
  }), true);
  const explicitOtherContext = readCombatContext("explicit-other-movement-test", { combatant: unownedCombatant });
  assert.equal(explicitOtherContext.combatant.id, "combatant-unowned");
  assert.equal(explicitOtherContext.actionsSpent.normal, 0);
  globalThis.canvas.tokens.controlled = [unownedCombatant.token.object];
  const controlledOtherContext = readCombatContext("controlled-other-movement-test");
  assert.equal(controlledOtherContext.combatant.id, "combatant-unowned");
  assert.equal(controlledOtherContext.actionsSpent.normal, 0);

  const foreignCombatant = {
    id: "combatant-foreign",
    actor: ownedActor,
    name: "Foreign Hero",
    tokenId: "token-foreign",
    token: { object: { id: "token-foreign", document: { id: "token-foreign", x: 10, y: 0, width: 1, height: 1 }, actor: ownedActor } },
  };
  assert.equal(readCombatContext("foreign-combatant-test", { combatant: foreignCombatant }), null);
} finally {
  globalThis.game = previousGame;
  globalThis.canvas = previousCanvas;
  globalThis.CONST = previousConst;
}

{
  const previousMinionGame = globalThis.game;
  const previousMinionCanvas = globalThis.canvas;
  try {
    const makeMinionActor = (id, name, overrides = {}) => ({
      id,
      uuid: `Actor.${id}`,
      name,
      type: overrides.type ?? "character",
      img: "icons/svg/mystery-man.svg",
      documentName: "Actor",
      isOwner: true,
      items: [],
      itemTypes: { condition: [] },
      getActiveTokens: () => [],
      ownership: overrides.ownership ?? {},
      familiar: overrides.familiar ?? null,
      system: {
        attributes: { hp: { value: 10, max: 10 } },
        traits: { value: overrides.traits ?? [] },
        skills: {},
        abilities: {},
      },
    });
    const makeMinionToken = (id, name, actor) => ({
      id,
      name,
      actor,
      x: 5,
      y: 0,
      document: {
        id,
        uuid: `Scene.Token.${id}`,
        name,
        actor,
        disposition: 1,
        x: 5,
        y: 0,
        width: 1,
        height: 1,
        texture: { src: "" },
      },
    });
    const makeMinionCombatant = (token) => ({
      id: `combatant-${token.id}`,
      name: token.name,
      actor: token.actor,
      tokenId: token.id,
      token: { object: token, id: token.id, uuid: token.document.uuid },
    });

    const casterActor = makeMinionActor("caster", "Caster", { ownership: { "user-1": 3 } });
    const casterToken = makeMinionToken("token-caster", "Caster", casterActor);
    const casterCombatant = makeMinionCombatant(casterToken);

    const familiarActor = makeMinionActor("familiar", "Familiar", { type: "familiar", traits: ["minion"] });
    casterActor.familiar = familiarActor;
    const familiarToken = makeMinionToken("token-familiar", "Familiar", familiarActor);

    const companionActor = makeMinionActor("companion", "Animal Companion", {
      traits: ["minion", "animal"],
      ownership: { "user-1": 3 },
    });
    const companionToken = makeMinionToken("token-companion", "Animal Companion", companionActor);

    const eidolonActor = makeMinionActor("eidolon", "Eidolon", {
      traits: ["eidolon"],
      ownership: { "user-1": 3 },
    });
    const eidolonToken = makeMinionToken("token-eidolon", "Eidolon", eidolonActor);

    const unownedCompanionActor = makeMinionActor("stray", "Stray Wolf", {
      traits: ["minion", "animal"],
      ownership: { "user-2": 3 },
    });
    const unownedCompanionToken = makeMinionToken("token-stray", "Stray Wolf", unownedCompanionActor);

    globalThis.game = {
      user: { isGM: true, targets: new Set() },
      combat: {
        id: "combat-minion",
        round: 1,
        turn: 0,
        started: true,
        combatant: casterCombatant,
        combatants: [casterCombatant],
      },
    };
    globalThis.canvas = {
      grid: { size: 1, measurePath: ([from, to]) => Math.abs(to.x - from.x) },
      tokens: {
        placeables: [casterToken, familiarToken, companionToken, eidolonToken, unownedCompanionToken],
      },
    };

    const minionContext = readCombatContext("minion-detection-test");
    assert.deepEqual(
      minionContext.minions.map((minion) => minion.name).sort(),
      ["Animal Companion", "Familiar"],
      "familiar (via actor.familiar) and owned minion-trait companion should both be detected; eidolon and unowned stray should not",
    );
  } finally {
    globalThis.game = previousMinionGame;
    globalThis.canvas = previousMinionCanvas;
  }
}

const systemSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "system-electric-arc",
          name: "System Electric Arc",
          slug: "electric-arc",
          system: {
            slug: "electric-arc",
            time: { value: "1" },
            traits: { value: ["cantrip"] },
            level: { value: 0 },
            range: { value: "30 feet" },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d4", type: "electricity" } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: {
            prepared: { value: "spontaneous" },
            slots: {},
          },
        }],
      },
    },
  },
};
const hybridSpell = readSpellActions(systemSpellContext).find((spell) => spell.slug === "electric-arc");
assert.equal(hybridSpell.name, "System Electric Arc");
assert.equal(hybridSpell.actionCost, 1);
assert.equal(hybridSpell.curated.role, "damage");
assert.equal(hybridSpell.source, "spell-curated");
assert.equal(hybridSpell.role, "save-damage");
assert.equal(hybridSpell.saveProfile.stat, "reflex");
assert.equal(hybridSpell.damageProfile.average, 5);
assert.equal(hybridSpell.targetingProfile.maxRange, 30);

const staleCantripContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "stale-frostbite",
          name: "Frostbite",
          slug: "frostbite",
          system: {
            slug: "frostbite",
            time: { value: "2" },
            traits: { value: ["cantrip", "cold", "concentrate", "manipulate"] },
            level: { value: 1 },
            location: { value: "missing-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "fortitude" } },
            damage: { "0": { formula: "2d4", type: "cold" } },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: {
            prepared: { value: "spontaneous" },
            slots: {},
          },
        }],
      },
    },
  },
};
const staleCantrip = readSpellActions(staleCantripContext).find((spell) => spell.slug === "frostbite");
assert.equal(staleCantrip.available, false);
assert.equal(staleCantrip.unavailableReason, "Spell is not assigned to an active spellcasting entry.");

const mismatchedLocationCantripContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "mismatched-frostbite",
          name: "Frostbite",
          slug: "frostbite",
          system: {
            slug: "frostbite",
            time: { value: "2" },
            traits: { value: ["cantrip", "cold", "concentrate", "manipulate"] },
            level: { value: 1 },
            location: { value: "old-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "fortitude" } },
            damage: { "0": { formula: "2d4", type: "cold" } },
          },
        }],
        spellcastingEntry: [{
          id: "new-entry",
          system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
        }],
      },
    },
  },
};
const mismatchedLocationCantrip = readSpellActions(mismatchedLocationCantripContext).find((spell) => spell.slug === "frostbite");
assert.equal(mismatchedLocationCantrip.available, false);
assert.equal(mismatchedLocationCantrip.spellcastingEntryId, null);

const hiddenEntryCantripContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "hidden-entry-frostbite",
          name: "Frostbite",
          slug: "frostbite",
          system: {
            slug: "frostbite",
            time: { value: "2" },
            traits: { value: ["cantrip", "cold", "concentrate", "manipulate"] },
            level: { value: 1 },
            location: { value: "hidden-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "fortitude" } },
            damage: { "0": { formula: "2d4", type: "cold" } },
          },
        }],
        spellcastingEntry: [{
          id: "hidden-entry",
          visible: false,
          system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
        }],
      },
    },
  },
};
const hiddenEntryCantrip = readSpellActions(hiddenEntryCantripContext).find((spell) => spell.slug === "frostbite");
assert.equal(hiddenEntryCantrip.available, false);
assert.equal(hiddenEntryCantrip.unavailableReason, "Spell is not assigned to an active spellcasting entry.");

const preparedCantripContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "spellbook-frostbite",
          name: "Frostbite",
          slug: "frostbite",
          system: {
            slug: "frostbite",
            time: { value: "2" },
            traits: { value: ["cantrip", "cold", "concentrate", "manipulate"] },
            level: { value: 1 },
            location: { value: "prepared-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "fortitude" } },
            damage: { "0": { formula: "2d4", type: "cold" } },
          },
        }, {
          id: "prepared-electric-arc",
          name: "Electric Arc",
          slug: "electric-arc",
          system: {
            slug: "electric-arc",
            time: { value: "2" },
            traits: { value: ["cantrip", "electricity", "concentrate", "manipulate"] },
            level: { value: 1 },
            location: { value: "prepared-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d4", type: "electricity" } },
          },
        }],
        spellcastingEntry: [{
          id: "prepared-entry",
          system: {
            prepared: { value: "prepared" },
            slots: { slot0: { prepared: [{ id: "prepared-electric-arc", expended: false }] } },
          },
        }],
      },
    },
  },
};
const preparedCantrips = readSpellActions(preparedCantripContext);
const spellbookFrostbite = preparedCantrips.find((spell) => spell.slug === "frostbite");
assert.equal(spellbookFrostbite.available, false);
assert.equal(spellbookFrostbite.unavailableReason, "Prepared spell is not available or is expended.");
const preparedElectricArc = preparedCantrips.find((spell) => spell.slug === "electric-arc");
assert.equal(preparedElectricArc.available, true);

const itemSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "staff-breathe-fire",
          name: "Breathe Fire",
          slug: "breathe-fire",
          system: {
            slug: "breathe-fire",
            time: { value: "2" },
            traits: { value: ["fire", "manipulate"] },
            level: { value: 1 },
            range: { value: "" },
            area: { type: "cone", value: 15 },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d6", type: "fire" } },
            location: { value: "staff-entry", uses: { value: 3, max: 3 } },
          },
        }],
        spellcastingEntry: [{
          id: "staff-entry",
          system: { prepared: { value: "items" }, slots: { slot1: { value: 0 } } },
        }],
      },
    },
  },
};
const itemSpell = readSpellActions(itemSpellContext).find((spell) => spell.slug === "breathe-fire");
assert.equal(itemSpell.available, true);
assert.equal(itemSpell.role, "area-damage");
assert.equal(itemSpell.spellResource.label, "Uses 3/3");

const multiEntrySpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "arcane-cantrip",
          name: "Arcane Cantrip",
          slug: "telekinetic-projectile",
          system: {
            slug: "telekinetic-projectile",
            time: { value: "2" },
            traits: { value: ["attack", "cantrip"] },
            level: { value: 0 },
            location: { value: "arcane-entry" },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "bludgeoning" } },
          },
        }, {
          id: "arcane-slot-spell",
          name: "Magic Missile",
          slug: "magic-missile",
          system: {
            slug: "magic-missile",
            time: { value: "2" },
            traits: { value: ["force"] },
            level: { value: 1 },
            location: { value: "arcane-entry" },
            range: { value: "120 feet" },
            damage: { "0": { formula: "1d4+1", type: "force" } },
          },
        }, {
          id: "divine-prepared",
          name: "Divine Prepared",
          slug: "fear",
          system: {
            slug: "fear",
            time: { value: "2" },
            traits: { value: ["emotion", "fear", "mental"] },
            level: { value: 1 },
            location: { value: "divine-entry" },
            range: { value: "30 feet" },
            defense: { save: { statistic: "will" } },
            description: { value: "<p>The target becomes frightened on a failed save.</p>" },
          },
        }, {
          id: "slot-matched",
          name: "Slot Matched",
          slug: "fireball",
          system: {
            slug: "fireball",
            time: { value: "2" },
            traits: { value: ["fire"] },
            level: { value: 3 },
            range: { value: "500 feet" },
            area: { type: "burst", value: 20 },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "6d6", type: "fire" } },
          },
        }, {
          id: "uuid-matched",
          uuid: "Actor.silva.Item.invisibility",
          sourceId: "Compendium.pf2e.spells-srd.Item.invisibility",
          name: "Invisibility",
          slug: "invisibility",
          system: {
            slug: "invisibility",
            time: { value: "2" },
            traits: { value: ["illusion"] },
            level: { value: 2 },
            location: { value: "occult-entry" },
            range: { value: "30 feet" },
            target: { value: "1 creature" },
            duration: { value: "10 minutes" },
            description: { value: "<p>The target becomes invisible and is undetected by observers.</p>" },
          },
        }],
        spellcastingEntry: [{
          id: "arcane-entry",
          name: "Arcane Spontaneous",
          system: {
            prepared: { value: "spontaneous" },
            tradition: { value: "arcane" },
            statistic: { dc: { value: 22 } },
            slots: { slot1: { value: 1, max: 3 }, slot3: { value: 0, prepared: [] } },
          },
        }, {
          id: "divine-entry",
          name: "Divine Prepared",
          system: {
            prepared: { value: "prepared" },
            tradition: { value: "divine" },
            statistic: { dc: { value: 18 } },
            slots: { slot1: { prepared: [{ id: "other-spell", expended: false }] } },
          },
        }, {
          id: "occult-entry",
          name: "Occult Prepared",
          system: {
            prepared: { value: "prepared" },
            tradition: { value: "occult" },
            statistic: { dc: { value: 20 } },
            slots: {
              slot2: { prepared: [{ uuid: "Actor.silva.Item.invisibility", expended: false }] },
              slot3: { prepared: [{ id: "slot-matched", expended: false }] },
            },
          },
        }],
      },
    },
  },
};
const multiEntrySpells = readSpellActions(multiEntrySpellContext);
const arcaneCantrip = multiEntrySpells.find((spell) => spell.id === "spell-arcane-cantrip");
assert.equal(arcaneCantrip.spellcastingEntryId, "arcane-entry");
assert.equal(arcaneCantrip.spellDc, 22);
assert.equal(arcaneCantrip.available, true);
assert.equal(arcaneCantrip.spellResource.label, "No slot");
assert.equal(arcaneCantrip.spellcastingEntryLabel, "Arcane Spontaneous");
const arcaneSlotSpell = multiEntrySpells.find((spell) => spell.id === "spell-arcane-slot-spell");
assert.equal(arcaneSlotSpell.spellResource.label, "Slots 1/3");
assert.equal(arcaneSlotSpell.spellResource.tooltip, "Rank 1 spell slots: 1/3 left.");
const divinePrepared = multiEntrySpells.find((spell) => spell.id === "spell-divine-prepared");
assert.equal(divinePrepared.spellcastingEntryId, "divine-entry");
assert.equal(divinePrepared.spellDc, 18);
assert.equal(divinePrepared.available, false);
assert.equal(divinePrepared.unavailableReason, "Prepared spell is not available or is expended.");
const slotMatchedSpell = multiEntrySpells.find((spell) => spell.id === "spell-slot-matched");
assert.equal(slotMatchedSpell.spellcastingEntryId, "occult-entry");
assert.equal(slotMatchedSpell.spellDc, 20);
assert.equal(slotMatchedSpell.available, true);
assert.equal(slotMatchedSpell.spellResource.label, "Prepared 1/1");
assert.equal(slotMatchedSpell.spellResource.tooltip, "Rank 3 prepared slots: 1/1 unexpended.");
const uuidMatchedSpell = multiEntrySpells.find((spell) => spell.id === "spell-uuid-matched");
assert.equal(uuidMatchedSpell.spellcastingEntryId, "occult-entry");
assert.equal(uuidMatchedSpell.available, true);
assert.equal(uuidMatchedSpell.role, "stealth-defense");

// Divine Font auto-heightens Heal/Harm into the entry's highest-rank slot, so a base-rank-1 Heal's
// prepared copies live in slot2 (not the empty rank-1 slot). The resource chip must count the slot
// the spell is actually prepared in, otherwise it reads "Prepared 0/0" despite full font slots.
const divineFontContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "font-heal",
          uuid: "Actor.kyra.Item.font-heal",
          name: "Heal",
          slug: "heal",
          system: {
            slug: "heal",
            time: { value: "1" },
            traits: { value: ["healing", "vitality", "manipulate"] },
            level: { value: 1 },
            location: { value: "divine-font" },
          },
        }],
        spellcastingEntry: [{
          id: "divine-font",
          name: "Divine Font (Healing)",
          system: {
            prepared: { value: "prepared" },
            tradition: { value: "divine" },
            statistic: { dc: { value: 19 } },
            slots: {
              slot1: { value: 0, max: 0, prepared: [] },
              slot2: { value: 0, max: 4, prepared: [
                { id: "font-heal", expended: false },
                { id: "font-heal", expended: false },
                { id: "font-heal", expended: false },
                { id: "font-heal", expended: false },
              ] },
            },
          },
        }],
      },
    },
  },
};
const fontHeal = readSpellActions(divineFontContext).find((spell) => spell.slug === "heal");
assert.equal(fontHeal.spellcastingEntryId, "divine-font");
assert.equal(fontHeal.available, true, "Divine Font heal prepared at a heightened slot should be castable");
assert.equal(
  fontHeal.spellResource.label,
  "Prepared 4/4",
  "Divine Font heal should report the heightened slot's prepared copies, not the empty base-rank slot",
);
assert.equal(fontHeal.spellResource.tooltip, "Rank 2 prepared slots: 4/4 unexpended.");

const heightenedPreparedSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "sepulchral-mask",
          name: "Sepulchral Mask",
          slug: "sepulchral-mask",
          system: {
            slug: "sepulchral-mask",
            time: { value: "2" },
            traits: { value: ["void"] },
            level: { value: 1 },
            location: { value: "prepared-entry" },
            area: { type: "emanation", value: 5 },
            damage: { "0": { formula: "2d4", type: "void" } },
            heightening: { type: "interval", interval: 1, area: 5, damage: { "0": "2d4" } },
          },
        }, {
          id: "frozen-ray",
          name: "Frozen Ray",
          slug: "frozen-ray",
          system: {
            slug: "frozen-ray",
            time: { value: "2" },
            traits: { value: ["attack", "cold"] },
            level: { value: 1 },
            location: { value: "prepared-entry" },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "cold" } },
            heightening: {
              type: "fixed",
              levels: {
                3: {
                  range: { value: "120 feet" },
                  damage: { "0": { formula: "6d6", type: "cold" } },
                },
              },
            },
          },
        }],
        spellcastingEntry: [{
          id: "prepared-entry",
          name: "Prepared Heightening",
          system: {
            prepared: { value: "prepared" },
            tradition: { value: "arcane" },
            slots: {
              slot3: {
                prepared: [
                  { id: "sepulchral-mask", expended: false },
                  { id: "frozen-ray", expended: false },
                ],
              },
            },
          },
        }],
      },
    },
  },
};
const heightenedPreparedSpells = readSpellActions(heightenedPreparedSpellContext);
const rank3Mask = heightenedPreparedSpells.find((spell) => spell.slug === "sepulchral-mask" && spell.castRank === 3);
assert.ok(rank3Mask, "prepared spell should produce a variant at the rank it is prepared in");
assert.equal(rank3Mask.rank, 1);
assert.equal(rank3Mask.castRank, 3);
assert.equal(rank3Mask.available, true);
assert.equal(rank3Mask.targetingProfile.distance, 15, "interval heightening should increase template size");
assert.equal(rank3Mask.damageProfile.average, 15, "interval heightening should increase damage");
assert.equal(rank3Mask.spellResource.tooltip, "Rank 3 prepared slots: 2/2 unexpended.");
const rank3Ray = heightenedPreparedSpells.find((spell) => spell.slug === "frozen-ray" && spell.castRank === 3);
assert.ok(rank3Ray, "fixed heightening should produce the prepared-rank variant");
assert.equal(rank3Ray.targetingProfile.maxRange, 120, "fixed heightening should update range");
assert.equal(rank3Ray.damageProfile.average, 21, "fixed heightening should replace fixed-rank damage");

const heightenedSignatureSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "signature-fire",
          name: "Breathe Fire",
          slug: "breathe-fire",
          system: {
            slug: "breathe-fire",
            time: { value: "2" },
            traits: { value: ["fire", "manipulate"] },
            level: { value: 1 },
            location: { value: "spontaneous-entry", signature: true },
            area: { type: "cone", value: 15 },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d6", type: "fire" } },
            heightening: { type: "interval", interval: 1, damage: { "0": "2d6" } },
          },
        }],
        spellcastingEntry: [{
          id: "spontaneous-entry",
          name: "Spontaneous Heightening",
          system: {
            prepared: { value: "spontaneous" },
            tradition: { value: "arcane" },
            slots: {
              slot1: { value: 0, max: 2 },
              slot2: { value: 0, max: 2 },
              slot3: { value: 1, max: 2 },
            },
          },
        }],
      },
    },
  },
};
const rank3BreatheFire = readSpellActions(heightenedSignatureSpellContext)
  .find((spell) => spell.slug === "breathe-fire" && spell.castRank === 3);
assert.ok(rank3BreatheFire, "signature spontaneous spell should produce a heightened slot variant");
assert.equal(rank3BreatheFire.name, "Breathe Fire (Rank 3)");
assert.equal(rank3BreatheFire.available, true);
assert.equal(rank3BreatheFire.spellResource.label, "Slots 1/2");
assert.equal(rank3BreatheFire.damageProfile.average, 21);

const stanceClassification = classifySystemAction({
  name: "Dragon Stance",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["stance", "monk"] },
    description: { value: "<p>You enter the stance of a dragon and can make tail Strikes.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(stanceClassification.role, "setup");
assert.equal(stanceClassification.activityProfile.stance, true);
assert.deepEqual(stanceClassification.setupFor, ["strike", "damage"]);

assert.equal(findCustomAction("power-attack").role, "damage");
assert.equal(findCustomAction("power-attack").activityProfile.focusedStrike, true);
assert.equal(findCustomAction("vicious-swing").role, "damage");

const widenSpellClassification = classifySystemAction({
  name: "Widen Spell",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["spellshape", "wizard"] },
    description: { value: "<p>You manipulate the energy of your spell, causing it to affect a wider area.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(widenSpellClassification.role, "setup");
assert.equal(widenSpellClassification.activityProfile.spellBuff, true);
assert.deepEqual(widenSpellClassification.setupFor, ["spell", "damage", "control", "healing"]);

const followUpClassification = classifySystemAction({
  name: "Follow-Up Feint",
  system: {
    actionType: { value: "free" },
    actions: { value: 0 },
    traits: { value: ["fortune"] },
    description: {
      value: "<p><strong>Trigger</strong> Your last action was a Strike.</p><p>The target is off-guard to your next Strike.</p>",
    },
  },
}, { actionCost: 0, type: "free" });
assert.equal(followUpClassification.role, "setup");
assert.equal(followUpClassification.gatingProfile.eventTriggerOnly, true);
assert.deepEqual(followUpClassification.gatingProfile.eventTriggers, ["after-strike", "previous-action"]);

const bespellClassification = classifySystemAction({
  name: "Bespell Strikes",
  system: {
    actionType: { value: "free" },
    actions: { value: 0 },
    traits: { value: ["wizard"] },
    description: {
      value: "<p><strong>Requirements</strong> Your most recent action was to cast a non-cantrip spell.</p><p>Until the end of your turn, one weapon Strike deals extra damage.</p>",
    },
  },
}, { actionCost: 0, type: "free" });
assert.equal(bespellClassification.role, "setup");
assert.equal(bespellClassification.targetingProfile.self, true);
assert.equal(bespellClassification.gatingProfile.eventTriggerOnly, true);
assert.deepEqual(bespellClassification.gatingProfile.previousActionRequirements, ["non-cantrip-spell"]);

const failedCheckClassification = classifySystemAction({
  name: "Lucky Retry",
  system: {
    actionType: { value: "free" },
    actions: { value: 0 },
    traits: { value: ["fortune"] },
    description: {
      value: "<p><strong>Trigger</strong> You fail a skill check.</p><p>You gain a +1 status bonus to the reroll.</p>",
    },
  },
}, { actionCost: 0, type: "free" });
assert.equal(failedCheckClassification.role, "buff");
assert.equal(failedCheckClassification.gatingProfile.eventTriggerOnly, true);
assert.deepEqual(failedCheckClassification.gatingProfile.eventTriggers, ["after-check-fail"]);

const fireballClassification = classifySpell({
  name: "Fireball",
  system: {
    traits: { value: ["fire"] },
    level: { value: 3 },
    range: { value: "500 feet" },
    area: { type: "burst", value: 20 },
    defense: { save: { statistic: "reflex", basic: true } },
    damage: { "0": { formula: "6d6", type: "fire" } },
  },
});
assert.equal(fireballClassification.role, "area-damage");
assert.equal(fireballClassification.saveProfile.stat, "reflex");
assert.equal(fireballClassification.targetingProfile.area, true);
assert.equal(fireballClassification.targetingProfile.distance, 20);
assert.equal(fireballClassification.damageProfile.type, "fire");
assert.equal(fireballClassification.damageProfile.average, 21);
assert.equal(fireballClassification.activityProfile.rank, 3);
assert.deepEqual(fireballClassification.activityProfile.damageTypes, ["fire"]);

const wallOfStoneClassification = classifySpell({
  name: "Wall of Stone",
  system: {
    traits: { value: ["earth"] },
    level: { value: 5 },
    range: { value: "120 feet" },
    duration: { value: "1 minute" },
    description: {
      value: "<p>You create a wall of stone that blocks movement and makes difficult terrain around broken sections.</p>",
    },
  },
});
assert.equal(wallOfStoneClassification.role, "control");
assert.equal(wallOfStoneClassification.activityProfile.wall, true);
assert.equal(wallOfStoneClassification.activityProfile.terrainControl, true);
assert.equal(wallOfStoneClassification.activityProfile.lastingDuration, true);

// A teleportation spell classifies as a teleport even when it self-targets ("you"), so it isn't
// mistaken for a self-buff — and it carries the spell range for the destination picker.
const translocateClassification = classifySpell({
  name: "Translocate",
  system: {
    traits: { value: ["concentrate", "manipulate", "teleportation"] },
    level: { value: 4 },
    range: { value: "120 feet" },
    target: { value: "you" },
    description: { value: "<p>You instantly transport yourself from your current space to an unoccupied space within range you can see.</p>" },
  },
});
assert.equal(translocateClassification.role, "mobility");
assert.equal(translocateClassification.activityProfile.teleport, true, "a teleportation spell classifies as a teleport, not a self-buff");
assert.equal(translocateClassification.targetingProfile.maxRange, 120, "teleport carries the spell range for the destination picker");

// A numeric range value (no "feet" suffix) must still be read as feet, so the teleport range ring
// and picker aren't truncated to a default short distance.
const numericRangeTeleport = classifySpell({
  name: "Translocate",
  system: {
    traits: { value: ["teleportation"] },
    level: { value: 4 },
    range: { value: 120 },
    target: { value: "you" },
    description: { value: "<p>You instantly transport yourself to a space within range.</p>" },
  },
});
assert.equal(numericRangeTeleport.targetingProfile.maxRange, 120, "a numeric spell range is read as feet");
const wallControlScore = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  battlefield: {
    ...spellcasterSpellPriorityContext.battlefield,
    enemies: [
      { ...fighterContext.targets[0], id: "ogre-1", name: "Ogre 1", distance: 40 },
      { ...fighterContext.targets[0], id: "ogre-2", name: "Ogre 2", distance: 55 },
    ],
    targets: [{ ...fighterContext.targets[0], id: "ogre-1", name: "Ogre 1", distance: 40 }],
  },
  targets: [{ ...fighterContext.targets[0], id: "ogre-1", name: "Ogre 1", distance: 40 }],
}, {
  id: "wall-of-stone",
  name: "Wall of Stone",
  slug: "wall-of-stone",
  actionCost: 3,
  source: "spell-inferred",
  ...wallOfStoneClassification,
});
assert.ok(wallControlScore.reasons.includes("Battlefield control can restrict enemy movement."));
assert.ok(wallControlScore.reasons.includes("Duration can persist beyond this turn."));
assert.ok(wallControlScore.reasons.includes("Uses a ranked spell slot."));

const cantripDamageScore = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "ray-of-frost",
  name: "Ray of Frost",
  slug: "ray-of-frost",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { average: 7, type: "cold", types: ["cold"] },
  activityProfile: { includes: ["damage"], cantrip: true, averageDamage: 7 },
  targetingProfile: { enemy: true, maxRange: 120 },
});
assert.ok(cantripDamageScore.reasons.includes("Cantrip conserves spell slots."));

const focusControlScore = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "force-bolt",
  name: "Force Bolt",
  slug: "force-bolt",
  actionCost: 1,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { average: 5, type: "force", types: ["force"] },
  activityProfile: { includes: ["damage"], focus: true, averageDamage: 5 },
  targetingProfile: { enemy: true, maxRange: 30 },
});
assert.ok(focusControlScore.reasons.includes("Focus spell is recoverable after combat."));

const phantasmalClassification = classifySpell({
  name: "Phantasmal Killer",
  system: {
    traits: { value: ["illusion", "mental"] },
    level: { value: 4 },
    range: { value: "30 feet" },
    defense: { save: { statistic: "will", basic: false } },
    damage: { "0": { formula: "8d6", type: "mental" } },
  },
});
assert.equal(phantasmalClassification.role, "save-damage");
assert.equal(phantasmalClassification.saveProfile.stat, "will");
assert.equal(phantasmalClassification.targetingProfile.maxRange, 30);

const telekineticClassification = classifySpell({
  name: "Telekinetic Projectile",
  system: {
    traits: { value: ["attack", "cantrip"] },
    level: { value: 0 },
    range: { value: "30 feet" },
    damage: { "0": { formula: "2d6", type: "bludgeoning" } },
  },
});
assert.equal(telekineticClassification.role, "damage");
assert.equal(telekineticClassification.activityProfile.spellAttack, true);
assert.equal(telekineticClassification.targetingProfile.maxRange, 30);

const forceBarrageClassification = classifySpell({
  name: "Force Barrage",
  system: {
    traits: { value: ["concentrate", "force", "manipulate"] },
    level: { value: 1 },
    range: { value: "120 feet" },
    damage: { "0": { formula: "1d4+1", type: "force" } },
    description: { value: "<p>For each additional action you use when Casting the Spell, increase the number of shards by one.</p>" },
  },
});
assert.equal(forceBarrageClassification.role, "damage");
assert.equal(forceBarrageClassification.activityProfile.spellAttack, false);
assert.equal(forceBarrageClassification.targetingProfile.maxRange, 120);
assert.equal(forceBarrageClassification.activityProfile.damageScalesWithActions, true);

const forceBarrageContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "force-barrage",
          name: "Force Barrage",
          slug: "force-barrage",
          system: {
            slug: "force-barrage",
            time: { value: "1 to 3" },
            traits: { value: ["concentrate", "force", "manipulate"] },
            level: { value: 1 },
            range: { value: "120 feet" },
            damage: { "0": { formula: "1d4+1", type: "force" } },
            description: { value: "<p>It automatically hits and deals 1d4+1 force damage. For each additional action you use when Casting the Spell, increase the number of shards by one.</p>" },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
        }],
      },
    },
  },
};
const forceBarrageVariants = readSpellActions(forceBarrageContext)
  .filter((spell) => spell.slug === "force-barrage")
  .toSorted((left, right) => left.actionCost - right.actionCost);
assert.deepEqual(forceBarrageVariants.map((spell) => spell.actionCost), [1, 2, 3]);
assert.equal(new Set(forceBarrageVariants.map((spell) => spell.variantGroup)).size, 1);
const forceBarrageScores = forceBarrageVariants.map((spell) => scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 30 }],
}, spell));
assert.ok(forceBarrageScores[2].score > forceBarrageScores[1].score);
assert.ok(forceBarrageScores[1].score > forceBarrageScores[0].score);
assert.equal(
  buildTurnPlans(fighterContext, forceBarrageScores).some((plan) =>
    plan.steps.filter((step) => step.slug === "force-barrage").length > 1,
  ),
  false,
);

const previousForceBarrageComparisonCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    grid: { size: 100 },
    scene: { grid: { distance: 5 } },
    walls: {},
  };
  const singleTargetSpellContext = {
    ...fighterContext,
    isGM: false,
    token: { center: { x: 0, y: 0 } },
    targets: [{
      id: "mitflit",
      name: "Mitflit",
      distance: 10,
      token: { center: { x: 200, y: 0 } },
    }],
    allies: [],
  };
  const singleTargetBreatheScore = scoreCandidate(singleTargetSpellContext, {
    id: "breathe-fire",
    name: "Breathe Fire",
    slug: "breathe-fire",
    actionCost: 2,
    source: "spell-inferred",
    role: "area-damage",
    damageProfile: { formula: "2d6", type: "fire", types: ["fire"], average: 7 },
    activityProfile: { includes: ["damage", "area"], includesStrike: false, damageTypes: ["fire"], averageDamage: 7 },
    targetingProfile: { area: true, type: "cone", distance: 15, enemy: true },
  });
  const threeActionForceBarrageScore = scoreCandidate(
    singleTargetSpellContext,
    forceBarrageVariants.find((spell) => spell.actionCost === 3),
  );
  assert.ok(
    threeActionForceBarrageScore.score > singleTargetBreatheScore.score,
    `3-action Force Barrage should beat one-target Breathe Fire, got ${threeActionForceBarrageScore.score} vs ${singleTargetBreatheScore.score}`,
  );
} finally {
  globalThis.canvas = previousForceBarrageComparisonCanvas;
}

const multiActionSpellScore = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}, {
  id: "spell-twoaction",
  name: "Two-Action Nuke",
  slug: "two-action-nuke",
  actionCost: 2,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { formula: "4d6", type: "fire" },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
const oneActionSpellScore = scoreCandidate({
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 20 }],
}, {
  id: "spell-oneaction",
  name: "One-Action Zap",
  slug: "one-action-zap",
  actionCost: 1,
  source: "spell-inferred",
  role: "damage",
  damageProfile: { formula: "2d6", type: "fire" },
  activityProfile: { includes: ["damage"], includesStrike: false, spellAttack: true },
  targetingProfile: { enemy: true, maxRange: 60 },
});
assert.ok(
  multiActionSpellScore.score >= oneActionSpellScore.score + 40,
  `2-action spell should be credited for its extra action, got ${multiActionSpellScore.score} vs ${oneActionSpellScore.score}`,
);
assert.ok(multiActionSpellScore.reasons.some((reason) => reason.includes("Commits 2 actions")));

const fireSaveSpell = {
  id: "spell-fire-ray",
  name: "Fire Ray",
  slug: "fire-ray",
  actionCost: 2,
  source: "spell-inferred",
  role: "save-damage",
  spellDc: 20,
  saveProfile: { stat: "reflex", dc: null, basic: true },
  damageProfile: { formula: "4d6", type: "fire", types: ["fire"], average: 14 },
  activityProfile: { includes: ["damage"], includesStrike: false, damageTypes: ["fire"], averageDamage: 14 },
  targetingProfile: { enemy: true, maxRange: 60 },
};
const fireResistantTarget = {
  id: "fire-resistant",
  name: "Fire Resistant",
  distance: 30,
  hpPercent: 1,
  saves: { reflex: 18 },
  resistances: [{ type: "fire", value: 10 }],
};
const fireWeakTarget = {
  id: "fire-weak",
  name: "Fire Weak",
  distance: 30,
  hpPercent: 1,
  saves: { reflex: 18 },
  weaknesses: [{ type: "fire", value: 5 }],
};
const gmFireSpellScore = scoreCandidate({
  ...fighterContext,
  isGM: true,
  targets: [fireResistantTarget, fireWeakTarget],
}, fireSaveSpell);
assert.equal(gmFireSpellScore.suggestedTarget.name, "Fire Weak");
assert.ok(gmFireSpellScore.reasons.some((reason) => reason.includes("weakness 5")));

const playerFireSpellScore = scoreCandidate({
  ...fighterContext,
  isGM: false,
  targets: [fireResistantTarget, fireWeakTarget],
}, fireSaveSpell);
assert.equal(playerFireSpellScore.suggestedTarget.name, "Fire Resistant");
assert.ok(!playerFireSpellScore.reasons.some((reason) => /weakness|resists|immune|spell DC/i.test(reason)));

const gmFireStrikeScore = scoreCandidate({
  ...fighterContext,
  isGM: true,
  targets: [{ ...fireResistantTarget, distance: 5 }, { ...fireWeakTarget, distance: 5 }],
}, {
  id: "flaming-sword",
  name: "Flaming Sword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 12,
  damageProfile: { type: "fire", types: ["fire"], average: 12 },
});
assert.equal(gmFireStrikeScore.suggestedTarget.name, "Fire Weak");

const playerFireStrikeScore = scoreCandidate({
  ...fighterContext,
  isGM: false,
  targets: [{ ...fireResistantTarget, distance: 5 }, { ...fireWeakTarget, distance: 5 }],
}, {
  id: "flaming-sword",
  name: "Flaming Sword",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  range: { max: 5 },
  averageDamage: 12,
  damageProfile: { type: "fire", types: ["fire"], average: 12 },
});
assert.equal(playerFireStrikeScore.suggestedTarget.name, "Fire Resistant");

const previousAreaPlacementCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    grid: { size: 100 },
    scene: { grid: { distance: 5 } },
    walls: {},
  };
  const areaSpellScore = scoreCandidate({
    ...fighterContext,
    isGM: true,
    token: { center: { x: 0, y: 0 } },
    targets: [{
      id: "cluster-a",
      name: "Cluster A",
      distance: 30,
      token: { center: { x: 100, y: 0 } },
      saves: { reflex: 18 },
    }, {
      id: "cluster-b",
      name: "Cluster B",
      distance: 35,
      token: { center: { x: 180, y: 0 } },
      saves: { reflex: 18 },
    }],
    allies: [{
      id: "ally-far",
      name: "Ally Far",
      distance: 40,
      token: { center: { x: 800, y: 0 } },
    }],
  }, {
    id: "burst",
    name: "Burst",
    slug: "burst",
    actionCost: 2,
    source: "spell-inferred",
    role: "area-damage",
    spellDc: 20,
    saveProfile: { stat: "reflex", dc: null, basic: true },
    damageProfile: { formula: "6d6", type: "fire", types: ["fire"], average: 21 },
    activityProfile: { includes: ["damage", "area"], includesStrike: false, damageTypes: ["fire"], averageDamage: 21 },
    targetingProfile: { area: true, type: "burst", distance: 10, maxRange: 120, enemy: true },
  });
  assert.ok(areaSpellScore.reasons.some((reason) => reason.includes("2 enemies")));
  assert.ok(areaSpellScore.reasons.some((reason) => reason.includes("avoids allies")));
} finally {
  globalThis.canvas = previousAreaPlacementCanvas;
}

const previousConePlacementCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    grid: { size: 100 },
    scene: { grid: { distance: 5 } },
    walls: {},
  };
  const coneSpellScore = scoreCandidate({
    ...fighterContext,
    isGM: false,
    token: { center: { x: 0, y: 0 } },
    targets: [{
      id: "east",
      name: "East",
      distance: 10,
      token: { center: { x: 200, y: 0 } },
    }, {
      id: "north",
      name: "North",
      distance: 10,
      token: { center: { x: 0, y: 200 } },
    }],
  }, {
    id: "breathe-fire",
    name: "Breathe Fire",
    slug: "breathe-fire",
    actionCost: 2,
    source: "spell-inferred",
    role: "area-damage",
    saveProfile: { stat: "reflex", dc: null, basic: true },
    damageProfile: { formula: "2d6", type: "fire", types: ["fire"], average: 7 },
    activityProfile: { includes: ["damage", "area"], includesStrike: false, damageTypes: ["fire"], averageDamage: 7 },
    targetingProfile: { area: true, type: "cone", distance: 15, enemy: true },
  });
  assert.ok(coneSpellScore.reasons.some((reason) => reason.includes("1 enemy")));
  assert.ok(!coneSpellScore.reasons.some((reason) => reason.includes("2 enemies")));
  assert.equal(coneSpellScore.suggestedTarget.name, "East");
} finally {
  globalThis.canvas = previousConePlacementCanvas;
}

const fearClassification = classifySpell({
  name: "Fear",
  system: {
    traits: { value: ["emotion", "fear", "mental"] },
    level: { value: 1 },
    range: { value: "30 feet" },
    defense: { save: { statistic: "will", basic: false } },
    description: { value: "<p>The target becomes frightened on a failed save.</p>" },
  },
});
assert.equal(fearClassification.role, "control");
assert.equal(fearClassification.saveProfile.stat, "will");
assert.equal(fearClassification.activityProfile.appliesCondition, "frightened");

const dirgeClassification = classifySpell({
  name: "Dirge of Doom",
  system: {
    traits: { value: ["bard", "cantrip", "composition", "emotion", "fear", "mental"] },
    level: { value: 0 },
    area: { type: "emanation", value: 30 },
    description: { value: "<p>Enemies within the area are Frightened 1.</p>" },
  },
});
assert.equal(dirgeClassification.role, "control");
assert.equal(dirgeClassification.activityProfile.appliesCondition, "frightened");
assert.equal(dirgeClassification.targetingProfile.area, true);
assert.equal(dirgeClassification.targetingProfile.selfCentered, true);
assert.equal(dirgeClassification.targetingProfile.enemy, false);

const baneClassification = classifySpell({
  name: "Bane",
  system: {
    traits: { value: ["concentrate", "manipulate", "mental"] },
    level: { value: 1 },
    area: { type: "emanation", value: 5 },
    target: { value: "enemies in the area" },
    defense: { save: { statistic: "will", basic: false } },
    duration: { value: "1 minute" },
    description: { value: "<p>Enemies in the area must succeed at a Will save.</p>" },
  },
});
assert.equal(baneClassification.role, "control");
assert.equal(baneClassification.targetingProfile.selfCentered, true);
assert.equal(baneClassification.targetingProfile.enemy, false);
const baneScore = scoreCandidate({
  ...fighterContext,
  token: { center: { x: 0, y: 0 } },
  battlefield: {
    enemies: [
      { id: "adjacent", name: "Adjacent Enemy", distance: 5, token: { center: { x: 100, y: 0 } } },
      { id: "far", name: "Far Enemy", distance: 20, token: { center: { x: 400, y: 0 } } },
    ],
    allies: [],
    targets: [{ id: "adjacent", name: "Adjacent Enemy", distance: 5, token: { center: { x: 100, y: 0 } } }],
  },
  targets: [{ id: "adjacent", name: "Adjacent Enemy", distance: 5, token: { center: { x: 100, y: 0 } } }],
}, {
  id: "spell-bane",
  name: "Bane",
  slug: "bane",
  actionCost: 2,
  source: "spell-inferred",
  ...baneClassification,
});
assert.equal(baneScore.suggestedTarget, null);
assert.ok(baneScore.reasons.some((reason) => reason.includes("Bane can affect 1 enemy")));

const healClassification = classifySpell({
  name: "Heal",
  system: {
    traits: { value: ["healing", "vitality"] },
    level: { value: 1 },
    range: { value: "touch" },
    damage: { "0": { formula: "1d8", type: "healing" } },
  },
});
assert.equal(healClassification.role, "healing");
assert.equal(healClassification.targetingProfile.ally, true);

const heroismClassification = classifySpell({
  name: "Heroism",
  system: {
    traits: { value: ["enchantment", "mental"] },
    level: { value: 3 },
    range: { value: "touch" },
    target: { value: "1 creature" },
    description: { value: "<p>The target gains a +1 status bonus to attack rolls, Perception, and saving throws.</p>" },
  },
});
assert.equal(heroismClassification.role, "buff");
assert.equal(heroismClassification.activityProfile.attackBuff, true);
assert.equal(heroismClassification.targetingProfile.ally, true);

const heroismScore = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  profile: { name: "Ezren", hpPercent: 1, classSlugs: ["wizard"], speed: 25, reach: 5 },
  actor: { name: "Ezren" },
  allies: [{
    id: "valeros",
    name: "Valeros",
    hpPercent: 1,
    classSlug: "fighter",
    hasStrike: true,
  }, {
    id: "merisiel",
    name: "Merisiel",
    hpPercent: 1,
    classSlug: "rogue",
    hasStrike: true,
    effects: [{ slug: "heroism", name: "Spell Effect: Heroism" }],
  }, {
    id: "kyra",
    name: "Kyra",
    hpPercent: 1,
    classSlug: "cleric",
    hasSpellcasting: true,
  }],
}, {
  id: "heroism",
  name: "Heroism",
  slug: "heroism",
  actionCost: 2,
  source: "spell-inferred",
  ...heroismClassification,
});
assert.equal(heroismScore.suggestedTarget.name, "Valeros");
assert.ok(heroismScore.reasons[0].includes("Valeros"));

const alreadyBuffedHeroismScore = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  profile: { name: "Ezren", hpPercent: 1, classSlugs: ["wizard"], speed: 25, reach: 5 },
  actor: { name: "Ezren" },
  allies: [{
    id: "valeros",
    name: "Valeros",
    hpPercent: 1,
    classSlug: "fighter",
    hasStrike: true,
    effects: [{ slug: "heroism", name: "Spell Effect: Heroism" }],
  }],
}, {
  id: "heroism",
  name: "Heroism",
  slug: "heroism",
  actionCost: 2,
  source: "spell-inferred",
  role: "buff",
  activityProfile: { ...heroismClassification.activityProfile, ally: true },
  targetingProfile: { ally: true, self: false },
});
assert.ok(alreadyBuffedHeroismScore.reasons.some((reason) => reason.includes("already has Heroism")));

const liberatingCommandClassification = classifySpell({
  name: "Liberating Command",
  system: {
    traits: { value: ["auditory", "concentrate"] },
    level: { value: 1 },
    range: { value: "60 feet" },
    target: { value: "1 ally" },
    description: { value: "<p>You urge an ally to break free from an effect that holds them in place. The target attempts to Escape.</p>" },
  },
});
assert.equal(liberatingCommandClassification.role, "buff");
assert.equal(liberatingCommandClassification.activityProfile.removesCondition, true);
assert.equal(liberatingCommandClassification.targetingProfile.ally, true);

const liberatingCommandScore = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  profile: { name: "Ezren", hpPercent: 1, classSlugs: ["wizard"], speed: 25, reach: 5 },
  actor: { name: "Ezren" },
  allies: [{
    id: "grabbed-ally",
    name: "Grabbed Ally",
    hpPercent: 0.8,
    conditions: { slugs: ["grabbed"] },
  }, {
    id: "free-ally",
    name: "Free Ally",
    hpPercent: 0.8,
  }],
}, {
  id: "liberating-command",
  name: "Liberating Command",
  slug: "liberating-command",
  actionCost: 1,
  source: "spell-inferred",
  ...liberatingCommandClassification,
});
assert.equal(liberatingCommandScore.suggestedTarget.name, "Grabbed Ally");

const invisibilityClassification = classifySpell({
  name: "Invisibility",
  system: {
    traits: { value: ["illusion"] },
    level: { value: 2 },
    range: { value: "30 feet" },
    target: { value: "1 creature" },
    duration: { value: "10 minutes" },
    description: { value: "<p>The target becomes invisible and is undetected by observers.</p>" },
  },
});
assert.equal(invisibilityClassification.role, "stealth-defense");
assert.equal(invisibilityClassification.activityProfile.invisible, true);
assert.equal(invisibilityClassification.targetingProfile.ally, true);
const invisibilityScore = scoreCandidate({
  ...spellcasterSpellPriorityContext,
  profile: { name: "Ezren", hpPercent: 1, classSlugs: ["wizard"], speed: 25, reach: 5 },
  actor: { name: "Ezren" },
  allies: [{
    id: "injured-rogue",
    name: "Injured Rogue",
    hpPercent: 0.4,
    classSlug: "rogue",
    hasStrike: true,
  }],
}, {
  id: "invisibility",
  name: "Invisibility",
  slug: "invisibility",
  actionCost: 2,
  source: "spell-inferred",
  ...invisibilityClassification,
});
assert.equal(invisibilityScore.suggestedTarget.name, "Injured Rogue");
assert.ok(invisibilityScore.reasons[0].includes("harder to target"));

// A non-combat utility spell is not a buff, but with max-coverage it still
// surfaces as a low-priority exploration option rather than being dropped.
const utilitySpellNotBuff = classifySpell({
  name: "Detect Magic",
  system: {
    traits: { value: ["detection"] },
    level: { value: 1 },
    range: { value: "30 feet" },
    time: { value: "2" },
    description: { value: "<p>You send out a pulse that registers the presence of magic.</p>" },
  },
});
assert.equal(utilitySpellNotBuff.role, "exploration-utility");
assert.equal(utilitySpellNotBuff.activityProfile.utilitySubtype, "exploration-utility");
assert.notEqual(utilitySpellNotBuff.role, "buff");
const detectMagicScore = scoreCandidate(spellcasterSpellPriorityContext, {
  id: "detect-magic",
  name: "Detect Magic",
  slug: "detect-magic",
  actionCost: 2,
  source: "spell-inferred",
  ...utilitySpellNotBuff,
});
assert.ok(detectMagicScore.score < cantripDamageScore.score);

const buffActionClassification = classifySystemAction({
  name: "Inspiring Banner",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["bravado"] },
    description: { value: "<p>Allies within 30 feet gain a +1 status bonus to attack rolls until the start of your next turn.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(buffActionClassification.role, "buff");
assert.equal(buffActionClassification.targetingProfile.ally, true);
assert.deepEqual(buffActionClassification.setupFor, ["strike", "damage"]);

const teleportSpellClassification = classifySpell({
  name: "Dimension Door",
  system: {
    traits: { value: ["conjuration", "teleportation"] },
    level: { value: 4 },
    range: { value: "120 feet" },
    time: { value: "2" },
    description: { value: "<p>You instantly transport yourself to a location.</p>" },
  },
});
assert.equal(teleportSpellClassification.role, "mobility");

const summonClassification = classifySystemAction({
  name: "Summon Lesser Spirit",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    traits: { value: ["summon", "occult"] },
    description: { value: "<p>You summon forth a spirit to fight at your side.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(summonClassification.role, "summon");

const utilityActionClassification = classifySystemAction({
  name: "Obscure Inkblot",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    traits: { value: ["concentrate"] },
    description: { value: "<p>You smudge a glyph so it cannot be read until tomorrow.</p>" },
  },
}, { actionCost: 1, type: "action" });
assert.equal(utilityActionClassification.role, "utility");

// Trigger-gated reactions with no tactical pattern stay null (not proactive picks).
const triggerReactionClassification = classifySystemAction({
  name: "Lucky Stumble",
  system: {
    actionType: { value: "reaction" },
    actions: { value: null },
    traits: { value: ["fortune"] },
    description: { value: "<p>Trigger You fail a check. Effect You reroll.</p>" },
  },
}, { actionCost: "reaction", type: "reaction" });
assert.equal(triggerReactionClassification, null);

// An enemy-targeted setup (Taunt-style off-guard) suggests the enemy, not self.
const enemySetupTarget = scoreCandidate(fighterContext, {
  id: "taunt",
  name: "Taunt",
  slug: "taunt",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], appliesCondition: "off-guard" },
  targetingProfile: { enemy: true, maxRange: 30 },
  setupFor: ["strike", "damage"],
});
assert.equal(enemySetupTarget.suggestedTarget.name, "Ogre");
assert.equal(enemySetupTarget.suggestedTarget.type, "enemy");

// A self-targeted setup (stance/rage) suggests the actor.
const selfSetupTarget = scoreCandidate(fighterContext, {
  id: "dragon-stance",
  name: "Dragon Stance",
  slug: "dragon-stance",
  actionCost: 1,
  source: "system-inferred",
  role: "setup",
  activityProfile: { includes: ["setup"], stance: true },
  targetingProfile: { self: true },
  setupFor: ["strike", "damage"],
});
assert.equal(selfSetupTarget.suggestedTarget.name, "Valeros");
assert.equal(selfSetupTarget.suggestedTarget.type, "self");

// Focused Assault "counts as a number of attacks equal to the number of heads"
// toward MAP, so a follow-up Strike should be at full MAP -10, not -5.
const focusedAssaultMap = classifySystemAction({
  name: "Focused Assault",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "<p>The hydra Strikes with its fangs. This Strike counts as a number of attacks equal to the number of heads the hydra has toward the hydra's multiple attack penalty.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(focusedAssaultMap.activityProfile.mapAttacks, "variable");

const mapPlans = buildTurnPlans(fighterContext, [{
  id: "focused-assault",
  name: "Focused Assault",
  slug: "focused-assault",
  actionCost: 2,
  source: "system-inferred",
  role: "damage",
  score: 90,
  confidence: "medium",
  attackTrait: true,
  activityProfile: { includesStrike: true, focusedStrike: true, mapAttacks: "variable" },
}, {
  id: "fangs",
  name: "Fangs",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 80,
  confidence: "medium",
  attackTrait: true,
}]);
const faThenStrike = mapPlans.find((plan) => plan.summary === "Focused Assault -> Fangs");
assert.ok(faThenStrike, "expected a Focused Assault -> Fangs plan");
const fangsStep = faThenStrike.steps.find((step) => step.slug === "strike");
assert.equal(fangsStep.mapPenalty, 10);

// A plain Strike before any MAP-heavy activity stays at MAP 0.
const plainFirstStrike = buildTurnPlans(fighterContext, [{
  id: "fangs-solo",
  name: "Fangs",
  slug: "strike",
  actionCost: 1,
  source: "strike",
  score: 80,
  confidence: "medium",
  attackTrait: true,
}])[0];
assert.equal(plainFirstStrike.steps[0].mapPenalty, 0);

// A leap/charge that moves and Strikes is a move-and-strike, not a stationary
// Strike — so it can be recommended when the target needs closing distance.
const leapingChargeClassification = classifySystemAction({
  name: "Leaping Charge",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "<p>The bulette Leaps up to its Speed and makes a jaws Strike against a creature.</p>" },
  },
}, { actionCost: 2, type: "action" });
assert.equal(leapingChargeClassification.role, "mobility-attack");
assert.equal(leapingChargeClassification.activityProfile.includesStrike, true);

// Strike scoring reads expected damage so a bigger weapon outranks a smaller one
// for the opening attack (Jaws 2d10+10 ~21 vs Claw 2d8+10 ~19).
const meleeContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
};
const jawsStrikeScore = scoreCandidate(meleeContext, {
  id: "jaws", name: "Jaws", slug: "strike", actionCost: 1, source: "strike",
  range: { max: 5 }, averageDamage: 21,
});
const clawStrikeScore = scoreCandidate(meleeContext, {
  id: "claw", name: "Claw", slug: "strike", actionCost: 1, source: "strike",
  range: { max: 5 }, averageDamage: 19,
});
assert.ok(
  jawsStrikeScore.score > clawStrikeScore.score,
  `harder-hitting strike should outrank a smaller one, got Jaws ${jawsStrikeScore.score} vs Claw ${clawStrikeScore.score}`,
);

const swordVsUnarmedContext = {
  ...fighterContext,
  actor: {
    ...fighterContext.actor,
    document: {
      system: {
        actions: [{
          slug: "unarmed-attack",
          type: "strike",
          label: "Unarmed Attack",
          visible: true,
          ready: true,
          canAttack: true,
          traits: [{ slug: "agile" }, { slug: "unarmed" }],
          item: {
            id: "unarmed-attack",
            name: "Unarmed Attack",
            system: { damage: { dice: 1, die: "d4", modifier: 4 } },
          },
        }, {
          slug: "longsword",
          type: "strike",
          label: "Longsword",
          visible: true,
          ready: true,
          canAttack: true,
          traits: [],
          item: {
            id: "longsword",
            name: "Longsword",
            system: { damage: { dice: 1, die: "d8", modifier: 4 } },
          },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {
    ...fighterContext.profile,
    conditions: { slugs: ["slowed"], values: { slowed: 1 } },
  },
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
  battlefield: {
    ...fighterContext.battlefield,
    targets: [{ ...fighterContext.targets[0], distance: 5 }],
  },
};
const swordVsUnarmedSources = readActionSources(swordVsUnarmedContext).filter((action) => action.source === "strike");
assert.equal(swordVsUnarmedSources.find((action) => action.name === "Unarmed Attack").averageDamage, 6.5);
assert.equal(swordVsUnarmedSources.find((action) => action.name === "Longsword").averageDamage, 8.5);
const swordVsUnarmedStrikes = swordVsUnarmedSources.map((action) => scoreCandidate(swordVsUnarmedContext, action));
const swordAfterGrapplePlan = bestTurnPlan(swordVsUnarmedContext, [{
  id: "grapple-primer",
  name: "Grapple",
  slug: "grapple",
  actionCost: 1,
  source: "generic",
  attackTrait: true,
  score: 100,
  confidence: "medium",
  reason: "Control target.",
}, ...swordVsUnarmedStrikes]);
assert.equal(swordAfterGrapplePlan.steps[1].name, "Longsword");

// The strike reader derives average damage from the NPC damageRolls shape.
const damageReaderStrike = readActionSources({
  actor: {
    document: {
      system: {
        actions: [{
          slug: "jaws",
          type: "strike",
          label: "Jaws",
          visible: true,
          ready: true,
          canAttack: true,
          item: { id: "jaws", system: { damageRolls: { "0": { damage: "2d10+10", damageType: "piercing" } } } },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {},
  targets: [],
}).find((entry) => entry.name === "Jaws");
assert.equal(damageReaderStrike.averageDamage, 21);

const reloadReaderStrike = readActionSources({
  ...fighterContext,
  actor: {
    document: {
      system: {
        actions: [{
          slug: "crossbow",
          type: "strike",
          label: "Crossbow",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "crossbow",
            system: {
              range: { max: 120 },
              reload: { value: "1" },
              traits: { value: ["ranged"] },
            },
          },
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
}).find((entry) => entry.name === "Crossbow");
assert.equal(reloadReaderStrike.reload, 1);

const previousDirectStrikeBlockedCanvas = globalThis.canvas;
const previousDirectStrikeBlockedFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) => options?.type === "sight" && ray.A.x < 5,
    },
  };
  const blockedDirectCrossbowContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "crossbow",
            type: "strike",
            label: "Crossbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "crossbow", system: { range: { max: 120 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  const blockedDirectCrossbow = readActionSources(blockedDirectCrossbowContext)
    .find((action) => action.name === "Crossbow");
  assert.equal(blockedDirectCrossbow.available, false);
  assert.equal(blockedDirectCrossbow.unavailableReason, "Attack path to target is blocked.");
  assert.equal(
    buildCandidates(blockedDirectCrossbowContext).candidates.some((action) => action.name === "Crossbow"),
    false,
  );
  const moveToShootCrossbow = readActionSources(blockedDirectCrossbowContext)
    .find((action) => action.slug === "stride-strike-crossbow");
  assert.ok(moveToShootCrossbow, "expected Stride -> Crossbow when current shot is blocked");
  assert.equal(moveToShootCrossbow.actionCost, 2);
} finally {
  globalThis.canvas = previousDirectStrikeBlockedCanvas;
  globalThis.foundry = previousDirectStrikeBlockedFoundry;
}

const previousCenterBlockedShotCanvas = globalThis.canvas;
const previousCenterBlockedShotFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "sight" && ray.B.x === 30 && ray.B.y === 0,
    },
  };
  const centerBlockedShotContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "crossbow",
            type: "strike",
            label: "Crossbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "crossbow", system: { range: { max: 120 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "calder", name: "Calder", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(centerBlockedShotContext).find((action) => action.slug === "stride-strike-crossbow"),
    undefined,
  );
} finally {
  globalThis.canvas = previousCenterBlockedShotCanvas;
  globalThis.foundry = previousCenterBlockedShotFoundry;
}

// A target two Strides away (45 ft, Speed 25, reach 5) gets a "Stride -> Stride ->
// Strike" composite so the planner can recommend closing the gap and attacking.
const twoStrideContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "claw", type: "strike", label: "Claw",
          visible: true, ready: true, canAttack: true,
          item: { id: "claw", system: { traits: { value: [] } } },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
  battlefield: {
    enemies: [{ id: "amiri", name: "Amiri", distance: 45 }],
    targets: [{ id: "amiri", name: "Amiri", distance: 45 }],
  },
  targets: undefined,
};
const twoStrideComposite = readActionSources(twoStrideContext).find((a) => a.slug === "stride-strike-claw");
assert.ok(twoStrideComposite, "expected a two-Stride composite for a far target");
assert.equal(twoStrideComposite.actionCost, 3);
assert.equal(twoStrideComposite.activityProfile.strideCount, 2);
assert.equal(twoStrideComposite.name, "Stride -> Stride -> Claw");
const twoStrideBest = bestTurnPlan(twoStrideContext, buildCandidates(twoStrideContext).candidates);
assert.ok(
  twoStrideBest.steps.some((step) => step.slug === "stride-strike-claw"),
  `far-target plan should move twice and Strike, got ${twoStrideBest.summary}`,
);

const previousBlockedStrikeCanvas = globalThis.canvas;
const previousBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move" && ray.B.x > 0,
    },
  };
  const blockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(blockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousBlockedStrikeCanvas;
  globalThis.foundry = previousBlockedStrikeFoundry;
}

const previousTokenBlockedStrikeCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: {
      placeables: [{
        id: "active-token",
        checkCollision: (to, options) => options?.type === "move" && to.x > 0,
      }],
    },
  };
  const tokenBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { id: "active-token", center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(tokenBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousTokenBlockedStrikeCanvas;
}

const previousAttackBlockedStrikeCanvas = globalThis.canvas;
const previousAttackBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "sight"
        && ray.B.x >= 27.5
        && ray.B.x <= 32.5
        && ray.B.y >= -2.5
        && ray.B.y <= 2.5,
    },
  };
  const attackBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 25, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 30, token: { center: { x: 30, y: 0 } } }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(attackBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousAttackBlockedStrikeCanvas;
  globalThis.foundry = previousAttackBlockedStrikeFoundry;
}

const previousStepwiseStrideStrikeCanvas = globalThis.canvas;
const previousStepwiseStrideStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: {
      size: 5,
      measurePath: ([from, to]) => Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)),
    },
    walls: {
      checkCollision: (ray, options) =>
        options?.type === "move"
        && Math.max(Math.abs(ray.B.x - ray.A.x), Math.abs(ray.B.y - ray.A.y)) > 5,
    },
  };
  const stepwiseStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 20, reach: 5 },
    battlefield: {
      enemies: [{ id: "amiri", name: "Amiri", distance: 25, token: { center: { x: 25, y: 0 } } }],
      targets: [{ id: "amiri", name: "Amiri", distance: 25, token: { center: { x: 25, y: 0 } } }],
    },
    targets: undefined,
  };
  const stepwiseStrideStrike = readActionSources(stepwiseStrideStrikeContext)
    .find((action) => action.slug === "stride-strike-claw");
  assert.equal(stepwiseStrideStrike.activityProfile.strideCount, 1);
} finally {
  globalThis.canvas = previousStepwiseStrideStrikeCanvas;
  globalThis.foundry = previousStepwiseStrideStrikeFoundry;
}

// A target within one Stride still uses a single-Stride composite.
const oneStrideContext = {
  ...twoStrideContext,
  battlefield: {
    enemies: [{ id: "amiri", name: "Amiri", distance: 20 }],
    targets: [{ id: "amiri", name: "Amiri", distance: 20 }],
  },
};
const oneStrideComposite = readActionSources(oneStrideContext).find((a) => a.slug === "stride-strike-claw");
assert.equal(oneStrideComposite.actionCost, 2);
assert.equal(oneStrideComposite.activityProfile.strideCount, 1);

// Ranged move-and-strike composites must score against the Strike range, not the actor's
// melee reach, or filler actions can outrank a valid "Stride -> ranged Strike" plan.
const oneStrideRangedContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "energy-beam",
          type: "strike",
          label: "Energy Beam",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "energy-beam",
            system: {
              range: { max: 60 },
              traits: { value: ["ranged"] },
              damageRolls: { "0": { damage: "2d6+8", damageType: "fire" } },
            },
          },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  token: { id: "champion", center: { x: 0, y: 0 } },
  profile: { speed: 25, reach: 10, conditions: { slugs: [], values: {} }, skills: {} },
  battlefield: {
    enemies: [{ id: "centipede", name: "Giant Centipede", distance: 80, token: { center: { x: 80, y: 0 } } }],
    targets: [{ id: "centipede", name: "Giant Centipede", distance: 80, token: { center: { x: 80, y: 0 } } }],
  },
  targets: undefined,
};
const oneStrideRangedPlan = bestTurnPlan(oneStrideRangedContext, buildCandidates(oneStrideRangedContext).candidates);
assert.ok(
  oneStrideRangedPlan.steps.some((step) => step.slug === "stride-strike-energy-beam"),
  `ranged target just beyond max range should use Stride -> Energy Beam, got ${oneStrideRangedPlan.summary}`,
);
assert.ok(
  !oneStrideRangedPlan.steps.some((step) => ["drop-prone", "high-jump", "long-jump"].includes(step.slug)),
  `ranged move-and-strike should beat filler, got ${oneStrideRangedPlan.summary}`,
);
const oneStrideRangedNoKnowledgeCandidates = buildCandidates(oneStrideRangedContext).candidates
  .filter((candidate) => candidate.slug !== "recall-knowledge");
const oneStrideRangedNoKnowledgePlan = bestTurnPlan(oneStrideRangedContext, oneStrideRangedNoKnowledgeCandidates);
assert.equal(
  oneStrideRangedNoKnowledgePlan.summary,
  "Stride -> Energy Beam -> Energy Beam",
  `third action after closing should be another ranged Strike, got ${oneStrideRangedNoKnowledgePlan.summary}`,
);
assert.deepEqual(
  oneStrideRangedNoKnowledgePlan.steps.flatMap((step) => builderAtomicActionsForStep(step).map((part) => part.name)),
  ["Stride", "Energy Beam", "Energy Beam"],
  "auto-fill should expand the closing plan into three executable action rows",
);

const dropProneAttackPlan = bestTurnPlan(oneStrideRangedContext, [{
  id: "drop-prone",
  slug: "drop-prone",
  name: "Drop Prone",
  actionCost: 1,
  source: "system-inferred",
  role: "defense",
  score: 70,
  activityProfile: { appliesConditions: ["prone"] },
}, {
  id: "energy-beam",
  slug: "energy-beam",
  name: "Energy Beam",
  actionCost: 1,
  source: "strike",
  role: "damage",
  attackTrait: true,
  score: 80,
  preferredTarget: oneStrideRangedContext.battlefield.enemies[0],
  targetingProfile: { enemy: true, maxRange: 60 },
}]);
assert.ok(
  !dropProneAttackPlan.steps.some((step) => step.slug === "drop-prone")
    || !dropProneAttackPlan.steps.some((step) => step.slug === "energy-beam"),
  `planner should not pair Drop Prone with a later attack-roll action, got ${dropProneAttackPlan.summary}`,
);

// A target beyond both current range and any move-and-strike composite should
// still get useful closing movement, not defensive or situational filler.
const beyondRangedReachContext = {
  actor: {
    document: {
      system: {
        actions: [{
          slug: "energy-beam",
          type: "strike",
          label: "Energy Beam",
          visible: true,
          ready: true,
          canAttack: true,
          item: {
            id: "energy-beam",
            system: {
              range: { max: 60 },
              traits: { value: ["ranged"] },
              damageRolls: { "0": { damage: "2d6+8", damageType: "fire" } },
            },
          },
          roll: () => null,
        }],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  token: { id: "champion", center: { x: 0, y: 0 } },
  profile: { speed: 25, reach: 10, conditions: { slugs: [], values: {} }, skills: {} },
  battlefield: {
    enemies: [{ id: "centipede", name: "Giant Centipede", distance: 130, token: { center: { x: 130, y: 0 } } }],
    targets: [{ id: "centipede", name: "Giant Centipede", distance: 130, token: { center: { x: 130, y: 0 } } }],
  },
  targets: undefined,
};
const beyondRangedReachPlan = bestTurnPlan(beyondRangedReachContext, buildCandidates(beyondRangedReachContext).candidates);
assert.ok(
  beyondRangedReachPlan.steps.some((step) => step.slug === "stride"),
  `far ranged target should prioritize closing distance, got ${beyondRangedReachPlan.summary}`,
);
assert.ok(
  !beyondRangedReachPlan.steps.some((step) => ["drop-prone", "high-jump", "long-jump"].includes(step.slug)),
  `far ranged target should not pad with prone/jump filler, got ${beyondRangedReachPlan.summary}`,
);
const noSelectedFarRangedContext = {
  ...beyondRangedReachContext,
  actionsSpent: { normal: 1, total: 1 },
  battlefield: {
    ...beyondRangedReachContext.battlefield,
    targets: [],
  },
  targets: undefined,
};
const noSelectedFarRangedPlan = bestTurnPlan(noSelectedFarRangedContext, buildCandidates(noSelectedFarRangedContext).candidates);
assert.equal(
  noSelectedFarRangedPlan.summary,
  "Stride -> Stride",
  `with no selected target, remaining actions should close toward the known enemy, got ${noSelectedFarRangedPlan.summary}`,
);

const previousSkirmishGame = globalThis.game;
const previousSkirmishCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
  };
  globalThis.game = {
    modules: {
      get: (id) => id === "pf2e-visioner"
        ? {
          api: {
            autoVisibility: {
              getPerceptionProfile: (observerId, targetId) => ({
                coverState: observerId === "target-token" && targetId === "observer-token"
                  ? "standard"
                  : "none",
              }),
            },
          },
        }
        : null,
    },
  };
  const rangedSkirmishContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "shortbow",
            type: "strike",
            label: "Shortbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "shortbow", system: { range: { max: 60 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "observer-token", center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "target-token", name: "Mitflit", distance: 80, token: { center: { x: 80, y: 0 } } }],
      targets: [{ id: "target-token", name: "Mitflit", distance: 80, token: { center: { x: 80, y: 0 } } }],
    },
    targets: undefined,
  };
  const skirmishAction = readActionSources(rangedSkirmishContext)
    .find((action) => action.slug === "stride-strike-stride-shortbow");
  assert.ok(skirmishAction, "expected a covered ranged skirmish composite");
  assert.equal(skirmishAction.actionCost, 3);
  assert.equal(skirmishAction.name, "Stride -> Shortbow -> Stride");
  assert.equal(skirmishAction.activityProfile.retreatAfterStrike, true);
  assert.equal(skirmishAction.activityProfile.defensiveCoverState, "standard");

  globalThis.game.modules.get = (id) => id === "pf2e-visioner"
    ? {
      api: {
        autoVisibility: {
          getPerceptionProfile: () => ({ coverState: "none" }),
        },
      },
    }
    : null;
  assert.equal(
    readActionSources(rangedSkirmishContext).find((action) => action.slug === "stride-strike-stride-shortbow"),
    undefined,
  );
} finally {
  globalThis.game = previousSkirmishGame;
  globalThis.canvas = previousSkirmishCanvas;
}

// Diagonal Strides cost more (PF2e 5-10-5): a target the same number of cells away diagonally
// needs more movement than one reached in a straight line, so the move-and-strike must not pick
// an attack square beyond the actor's Speed (the bug: measuring each step reset the diagonal count).
const previousDiagonalCostCanvas = globalThis.canvas;
try {
  // A walls layer must be present or canMoveIntoReach optimistically skips the reach BFS.
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: { placeables: [] },
    walls: { checkCollision: () => false },
  };
  const diagonalCostContext = (center) => ({
    actor: {
      document: {
        system: {
          actions: [{
            slug: "claw", type: "strike", label: "Claw", visible: true, ready: true, canAttack: true,
            item: { id: "claw", system: { traits: { value: [] } } }, roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "stalker", center: { x: 0, y: 0 } },
    profile: { speed: 20, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "prey", name: "Prey", distance: 15, token: { center } }],
      targets: [{ id: "prey", name: "Prey", distance: 15, token: { center } }],
    },
    targets: undefined,
  });
  // Straight 4 cells = 20 ft (= Speed 20): one Stride reaches the attack square.
  const straightComposite = readActionSources(diagonalCostContext({ x: 25, y: 0 }))
    .find((action) => action.slug === "stride-strike-claw");
  // Diagonal 4 cells = 30 ft (5+10+5+10): the attack square is beyond one Stride, so two are needed.
  const diagonalComposite = readActionSources(diagonalCostContext({ x: 25, y: 25 }))
    .find((action) => action.slug === "stride-strike-claw");
  assert.ok(straightComposite && diagonalComposite, "both targets should yield a move-and-strike composite");
  assert.equal(straightComposite.activityProfile.strideCount, 1, "a straight-line approach reaches in one Stride");
  assert.equal(diagonalComposite.activityProfile.strideCount, 2, "a diagonal approach costs more, needing two Strides");
} finally {
  globalThis.canvas = previousDiagonalCostCanvas;
}

const previousRangedRetreatCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: { placeables: [] },
  };
  const rangedRetreatContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "shortbow",
            type: "strike",
            label: "Shortbow",
            visible: true,
            ready: true,
            canAttack: true,
            item: { id: "shortbow", system: { range: { max: 60 }, traits: { value: ["ranged"] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "archer-token", center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "target-token", name: "Mitflit", distance: 5, token: { center: { x: 5, y: 0 } } }],
      targets: [{ id: "target-token", name: "Mitflit", distance: 5, token: { center: { x: 5, y: 0 } } }],
    },
    targets: undefined,
  };
  const retreatAction = readActionSources(rangedRetreatContext)
    .find((action) => action.slug === "stride-away-strike-shortbow");
  assert.ok(retreatAction, "expected ranged retreat composite");
  assert.equal(retreatAction.actionCost, 2);
  assert.equal(retreatAction.name, "Stride Away -> Shortbow");
  assert.equal(retreatAction.activityProfile.retreatBeforeStrike, true);
  assert.ok(retreatAction.activityProfile.attackCenter.x < 0, "expected retreat square away from target");

  const retreatPreview = movementPreviewForStep(rangedRetreatContext, retreatAction, { gridSize: 5 });
  assert.equal(retreatPreview.enabled, true);
  assert.deepEqual(retreatPreview.destinationCenter, retreatAction.activityProfile.attackCenter);

  const scoredRetreat = scoreCandidate(rangedRetreatContext, retreatAction);
  const scoredPlainShot = scoreCandidate(rangedRetreatContext, readActionSources(rangedRetreatContext)
    .find((action) => action.source === "strike" && action.name === "Shortbow"));
  assert.ok(scoredRetreat.score > scoredPlainShot.score, "retreat shot should outscore adjacent ranged shot");

  const retreatGrapplePlans = buildTurnPlans(rangedRetreatContext, [{
    ...retreatAction,
    score: 80,
  }, {
    id: "grapple",
    name: "Grapple",
    slug: "grapple",
    actionCost: 1,
    source: "generic",
    confidence: "medium",
    role: "control",
    skill: "athletics",
    requiresEnemyInReach: true,
    attackTrait: true,
    score: 70,
    preferredTarget: rangedRetreatContext.battlefield.targets[0],
    reason: "Target is not grabbed.",
  }]);
  assert.equal(
    retreatGrapplePlans.some((plan) =>
      plan.steps.some((step) => step.id === retreatAction.id)
      && plan.steps.some((step) => step.slug === "grapple"),
    ),
    false,
    "retreating out of melee for a ranged attack must not be paired with Grapple",
  );
} finally {
  globalThis.canvas = previousRangedRetreatCanvas;
}

// Flank-and-Strike: an ally adjacent to the target lets the actor Stride to the
// opposite side and Strike an off-guard enemy.
const previousFlankCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: { placeables: [] },
  };
  const flankContext = {
    actor: {
      document: {
        system: {
          actions: [{
            slug: "claw", type: "strike", label: "Claw",
            visible: true, ready: true, canAttack: true,
            item: { id: "claw", system: { traits: { value: [] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "brute-token", center: { x: -30, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      allies: [{ id: "valeros", name: "Valeros", token: { center: { x: 5, y: 0 } } }],
      enemies: [{ id: "goblin", name: "Goblin", distance: 30, token: { center: { x: 0, y: 0 } } }],
      targets: [{ id: "goblin", name: "Goblin", distance: 30, token: { center: { x: 0, y: 0 } } }],
    },
    targets: undefined,
  };
  const flankComposite = readActionSources(flankContext).find((action) => action.slug === "flank-strike-claw");
  assert.ok(flankComposite, "expected a flank composite when an ally is adjacent to the target");
  assert.equal(flankComposite.actionCost, 2);
  assert.equal(flankComposite.name, "Flank -> Claw");
  assert.equal(flankComposite.activityProfile.positionalTactic, "flank");
  assert.equal(flankComposite.activityProfile.targetOffGuard, true);
  assert.equal(flankComposite.activityProfile.flankAllyId, "valeros");
  const flankSquare = flankComposite.activityProfile.attackCenter;
  const flankDot = (flankSquare.x - 0) * (5 - 0) + (flankSquare.y - 0) * (0 - 0);
  assert.ok(flankDot < 0, `flank square should sit opposite the ally, got ${JSON.stringify(flankSquare)}`);

  const noAllyContext = {
    ...flankContext,
    battlefield: { ...flankContext.battlefield, allies: [] },
  };
  assert.equal(
    readActionSources(noAllyContext).find((action) => action.slug === "flank-strike-claw"),
    undefined,
    "no flank composite without an adjacent ally",
  );

  const farAllyContext = {
    ...flankContext,
    battlefield: {
      ...flankContext.battlefield,
      allies: [{ id: "valeros", name: "Valeros", token: { center: { x: 40, y: 0 } } }],
    },
  };
  assert.equal(
    readActionSources(farAllyContext).find((action) => action.slug === "flank-strike-claw"),
    undefined,
    "no flank composite when the ally is not adjacent to the target",
  );
} finally {
  globalThis.canvas = previousFlankCanvas;
}

// Skirmish / kite: in an enemy's melee threat, recommend Stride-out + ranged finisher
// only when fragile or ranged-primary; budget decides whether a melee Strike leads.
const previousSkirmishKiteCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: { placeables: [] },
  };
  const skirmishActorActions = (meleeDie, rangedDie) => [
    {
      slug: "claw", type: "strike", label: "Claw",
      visible: true, ready: true, canAttack: true,
      item: { id: "claw", system: { damage: { dice: 1, die: meleeDie, damageType: "slashing" }, traits: { value: [] } } },
      roll: () => null,
    },
    {
      slug: "dart", type: "strike", label: "Dart",
      visible: true, ready: true, canAttack: true,
      item: {
        id: "dart",
        system: { range: { max: 20 }, damage: { dice: 1, die: rangedDie, damageType: "piercing" }, traits: { value: ["thrown"] } },
      },
      roll: () => null,
    },
  ];
  const skirmishContext = (overrides = {}) => ({
    actor: {
      document: {
        system: { actions: skirmishActorActions(overrides.meleeDie ?? "d8", overrides.rangedDie ?? "d4") },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "skirmisher", center: { x: 0, y: 0 } },
    profile: {
      speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {},
      ...(overrides.hp ? { hp: overrides.hp } : {}),
    },
    battlefield: {
      enemies: [{ id: "bruiser", name: "Bruiser", distance: 5, token: { center: { x: 5, y: 0 } } }],
      targets: [{ id: "bruiser", name: "Bruiser", distance: 5, token: { center: { x: 5, y: 0 } } }],
    },
    targets: undefined,
  });

  // Healthy melee-primary with only a weak ranged option: no skirmish.
  const healthyMeleePrimary = readActionSources(skirmishContext({ meleeDie: "d8", rangedDie: "d4" }))
    .filter((action) => action.slug && action.slug.startsWith("skirmish-"));
  assert.equal(healthyMeleePrimary.length, 0, "healthy melee-primary should not get a skirmish composite");

  // Same actor, now fragile (HP < 50%): skirmish triggers with a melee prepend (budget 3).
  const fragileSkirmish = readActionSources(skirmishContext({ meleeDie: "d8", rangedDie: "d4", hp: { percent: 0.3 } }))
    .find((action) => action.slug === "skirmish-strike-dart");
  assert.ok(fragileSkirmish, "a fragile actor in melee threat should get a skirmish composite");
  assert.equal(fragileSkirmish.actionCost, 3);
  assert.equal(fragileSkirmish.name, "Claw -> Stride Away -> Dart");
  assert.equal(fragileSkirmish.activityProfile.positionalTactic, "skirmish");
  assert.ok(fragileSkirmish.activityProfile.meleeStrike, "fragile skirmish should include a melee prepend at budget 3");
  assert.equal(fragileSkirmish.activityProfile.finisher.kind, "strike");
  assert.ok(fragileSkirmish.activityProfile.attackCenter.x < 0, "skirmish retreat square should move away from the threat");

  // Healthy but ranged-primary (ranged out-damages melee): skirmish triggers without fragility.
  const rangedPrimarySkirmish = readActionSources(skirmishContext({ meleeDie: "d4", rangedDie: "d8" }))
    .find((action) => action.slug === "skirmish-strike-dart");
  assert.ok(rangedPrimarySkirmish, "a ranged-primary actor should get a skirmish composite");
  assert.ok(rangedPrimarySkirmish.activityProfile.meleeStrike, "ranged-primary skirmish should include a melee prepend at budget 3");

  // Spell finisher: a 2-action offensive ranged spell yields a Stride -> Cast composite (no melee prepend).
  const spellFinishers = [{
    id: "fireball", name: "Fireball", slug: "fireball",
    actionCost: 2, available: true, role: "save-damage",
    item: { id: "fireball" },
    targetingProfile: { enemy: true, maxRange: 120 },
    damageProfile: { average: 28 },
    averageDamage: 28,
  }];
  const spellSkirmish = readActionSources(skirmishContext({ hp: { percent: 0.3 } }), spellFinishers)
    .find((action) => action.slug === "skirmish-spell-fireball");
  assert.ok(spellSkirmish, "an offensive ranged spell should yield a Stride -> Cast skirmish composite");
  assert.equal(spellSkirmish.actionCost, 3);
  assert.equal(spellSkirmish.name, "Stride Away -> Fireball");
  assert.equal(spellSkirmish.activityProfile.finisher.kind, "spell");
  assert.equal(spellSkirmish.activityProfile.meleeStrike, null, "a 2-action spell finisher leaves no budget for a melee prepend");
} finally {
  globalThis.canvas = previousSkirmishKiteCanvas;
}

// GM-NPC scoring preference: the GM auto-plan leads with the positional tactics; a player's
// recommendation sees the same composites but without the preference bonus.
const previousPositionalScoringCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    tokens: { placeables: [] },
  };
  const flankScoreContext = (isGM) => ({
    isGM,
    actor: {
      document: {
        system: {
          actions: [{
            slug: "claw", type: "strike", label: "Claw",
            visible: true, ready: true, canAttack: true,
            item: { id: "claw", system: { damage: { dice: 1, die: "d6", damageType: "slashing" }, traits: { value: [] } } },
            roll: () => null,
          }],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "brute-token", center: { x: -30, y: 0 } },
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      allies: [{ id: "valeros", name: "Valeros", token: { center: { x: 5, y: 0 } } }],
      enemies: [{ id: "goblin", name: "Goblin", distance: 30, token: { center: { x: 0, y: 0 } } }],
      targets: [{ id: "goblin", name: "Goblin", distance: 30, token: { center: { x: 0, y: 0 } } }],
    },
    targets: undefined,
  });
  const gmFlankCtx = flankScoreContext(true);
  const playerFlankCtx = flankScoreContext(false);
  const gmFlank = readActionSources(gmFlankCtx).find((action) => action.slug === "flank-strike-claw");
  const playerFlank = readActionSources(playerFlankCtx).find((action) => action.slug === "flank-strike-claw");
  assert.ok(gmFlank && playerFlank, "flank composite should be generated for both GM and player");
  const gmFlankScore = scoreCandidate(gmFlankCtx, gmFlank);
  const playerFlankScore = scoreCandidate(playerFlankCtx, playerFlank);
  assert.ok(
    gmFlankScore.reasons.some((reason) => reason.includes("Flanks ")),
    "GM flank score should cite the off-guard flank advantage",
  );
  assert.ok(
    !playerFlankScore.reasons.some((reason) => reason.includes("Flanks ")),
    "player flank score should not receive the GM flank bonus",
  );
  assert.ok(gmFlankScore.score > playerFlankScore.score, "GM should score the flank higher than a player does");
  const gmFlankPlan = bestTurnPlan(gmFlankCtx, buildCandidates(gmFlankCtx).candidates);
  assert.ok(
    gmFlankPlan.steps.some((step) => step.slug === "flank-strike-claw"),
    `GM auto-plan should lead with the flank, got ${gmFlankPlan.summary}`,
  );

  const skirmishScoreContext = (isGM) => ({
    isGM,
    actor: {
      document: {
        system: {
          actions: [
            {
              slug: "claw", type: "strike", label: "Claw", visible: true, ready: true, canAttack: true,
              item: { id: "claw", system: { damage: { dice: 1, die: "d8", damageType: "slashing" }, traits: { value: [] } } },
              roll: () => null,
            },
            {
              slug: "dart", type: "strike", label: "Dart", visible: true, ready: true, canAttack: true,
              item: { id: "dart", system: { range: { max: 20 }, damage: { dice: 1, die: "d4", damageType: "piercing" }, traits: { value: ["thrown"] } } },
              roll: () => null,
            },
          ],
        },
        itemTypes: { action: [], feat: [], feature: [], consumable: [] },
        items: [],
      },
    },
    token: { id: "skirmisher", center: { x: 0, y: 0 } },
    profile: { speed: 25, reach: 5, hp: { percent: 0.3 }, conditions: { slugs: [], values: {} }, skills: {} },
    battlefield: {
      enemies: [{ id: "bruiser", name: "Bruiser", distance: 5, token: { center: { x: 5, y: 0 } } }],
      targets: [{ id: "bruiser", name: "Bruiser", distance: 5, token: { center: { x: 5, y: 0 } } }],
    },
    targets: undefined,
  });
  const gmSkirmishCtx = skirmishScoreContext(true);
  const playerSkirmishCtx = skirmishScoreContext(false);
  const gmSkirmish = readActionSources(gmSkirmishCtx).find((action) => action.slug === "skirmish-strike-dart");
  const playerSkirmish = readActionSources(playerSkirmishCtx).find((action) => action.slug === "skirmish-strike-dart");
  assert.ok(gmSkirmish && playerSkirmish, "skirmish composite should be generated for both GM and player");
  const gmSkirmishScore = scoreCandidate(gmSkirmishCtx, gmSkirmish);
  const playerSkirmishScore = scoreCandidate(playerSkirmishCtx, playerSkirmish);
  assert.ok(
    gmSkirmishScore.reasons.some((reason) => reason.toLowerCase().includes("kites out of melee")),
    "GM skirmish score should cite kiting out of melee",
  );
  assert.ok(gmSkirmishScore.score > playerSkirmishScore.score, "GM should score the skirmish higher than a player does");
  const gmSkirmishPlan = bestTurnPlan(gmSkirmishCtx, buildCandidates(gmSkirmishCtx).candidates);
  assert.ok(
    gmSkirmishPlan.steps.some((step) => String(step.slug).startsWith("skirmish-")),
    `GM auto-plan should lead with the skirmish, got ${gmSkirmishPlan.summary}`,
  );
} finally {
  globalThis.canvas = previousPositionalScoringCanvas;
}

// Volley weapons take a -2 (=-10 score) penalty within their volley range. An identical bow
// with and without the trait isolates the penalty: a gap of 10 within range, none beyond it.
const volleyLongbow = {
  source: "strike", slug: "strike", name: "Longbow", actionCost: 1,
  range: { max: 100 }, traits: ["ranged", "volley-30"], averageDamage: 12, attackTrait: true,
};
const plainLongbow = { ...volleyLongbow, name: "Composite Longbow", traits: ["ranged"] };
const volleyDistanceContext = (distance) => ({
  profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
  token: { center: { x: 0, y: 0 } },
  battlefield: {
    enemies: [{ id: "kobold", name: "Kobold", distance, token: { center: { x: distance, y: 0 } } }],
    targets: [{ id: "kobold", name: "Kobold", distance, token: { center: { x: distance, y: 0 } } }],
  },
  targets: undefined,
});
const volleyCloseScore = scoreCandidate(volleyDistanceContext(20), volleyLongbow);
const plainCloseScore = scoreCandidate(volleyDistanceContext(20), plainLongbow);
assert.equal(plainCloseScore.score - volleyCloseScore.score, 10, "a volley weapon within range costs the -2 (=-10) penalty");
assert.ok(volleyCloseScore.reasons.some((reason) => reason.includes("Volley")), "a close volley shot should cite the volley penalty");
const volleyFarScore = scoreCandidate(volleyDistanceContext(50), volleyLongbow);
const plainFarScore = scoreCandidate(volleyDistanceContext(50), plainLongbow);
assert.equal(volleyFarScore.score, plainFarScore.score, "beyond its volley range a volley weapon has no penalty");
assert.ok(volleyFarScore.score > volleyCloseScore.score, "a volley weapon should prefer firing from beyond its volley range");

// Per-step projected volley penalty: a volley Strike taken AFTER a move-and-strike composite is
// fired from the moved-in square (5 ft, inside volley 30) even though the base position (60 ft) was
// beyond it — so the planner penalizes it, where base-position scoring alone cannot.
const previousPlannerVolleyCanvas = globalThis.canvas;
try {
  globalThis.canvas = { grid: { size: 5 }, scene: { grid: { distance: 5 } } };
  const projectedVolleyTarget = { id: "ogre", name: "Ogre", distance: 60, token: { center: { x: 60, y: 0 } } };
  const moveAndStrike = {
    id: "stride-strike-claw", slug: "stride-strike-claw", name: "Stride -> Claw",
    source: "system-inferred", role: "mobility-attack", actionCost: 2, score: 90,
    attackTrait: true, preferredTarget: projectedVolleyTarget,
    activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1, attackCenter: { x: 55, y: 0 } },
  };
  const projectedVolleyShot = {
    id: "strike-longbow", slug: "strike", name: "Longbow", source: "strike", actionCost: 1, score: 60,
    attackTrait: true, range: { max: 100 }, traits: ["ranged", "volley-30"],
    preferredTarget: projectedVolleyTarget, averageDamage: 12,
  };
  const projectedPlainShot = { ...projectedVolleyShot, id: "strike-crossbow", name: "Crossbow", traits: ["ranged"] };
  const plannerVolleyContext = {
    profile: { speed: 25, reach: 5, conditions: { slugs: [], values: {} }, skills: {} },
    token: { center: { x: 0, y: 0 } },
    battlefield: { enemies: [projectedVolleyTarget], targets: [projectedVolleyTarget] },
    targets: undefined,
  };
  const findCombo = (plans, shotName) => plans.find((plan) =>
    plan.steps.some((step) => step.slug === "stride-strike-claw") && plan.steps.some((step) => step.name === shotName));
  const volleyCombo = findCombo(buildTurnPlans(plannerVolleyContext, [moveAndStrike, projectedVolleyShot]), "Longbow");
  const plainCombo = findCombo(buildTurnPlans(plannerVolleyContext, [moveAndStrike, projectedPlainShot]), "Crossbow");
  assert.ok(volleyCombo && plainCombo, "planner should build the move-and-strike + ranged-shot combo");
  const volleyComboStep = volleyCombo.steps.find((step) => step.name === "Longbow");
  const plainComboStep = plainCombo.steps.find((step) => step.name === "Crossbow");
  assert.equal(
    plainComboStep.score - volleyComboStep.score,
    10,
    "a volley shot fired from the moved-in square takes the projected -2 penalty the base score missed",
  );
  // No prior movement -> no projected penalty (the volley shot stands at the unmoved 60 ft).
  const standingVolleyPlans = buildTurnPlans(plannerVolleyContext, [projectedVolleyShot]);
  const standingVolleyStep = standingVolleyPlans.flatMap((plan) => plan.steps).find((step) => step.name === "Longbow");
  assert.equal(standingVolleyStep.score, 60, "a volley shot with no prior move keeps its base score");
} finally {
  if (previousPlannerVolleyCanvas === undefined) {
    delete globalThis.canvas;
  } else {
    globalThis.canvas = previousPlannerVolleyCanvas;
  }
}

const previousPerimeterBlockedStrikeCanvas = globalThis.canvas;
const previousPerimeterBlockedStrikeFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray) => ray.B.x !== 40 || ray.B.y !== 0,
    },
  };
  const perimeterBlockedStrideStrikeContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: { ...twoStrideContext.profile, speed: 35, reach: 5 },
    battlefield: {
      enemies: [{
        id: "caged-mitflit",
        name: "Caged Mitflit",
        distance: 40,
        token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      }],
      targets: [{
        id: "caged-mitflit",
        name: "Caged Mitflit",
        distance: 40,
        token: { center: { x: 40, y: 0 }, width: 2, height: 2 },
      }],
    },
    targets: undefined,
  };
  assert.equal(
    readActionSources(perimeterBlockedStrideStrikeContext).find((action) => action.slug === "stride-strike-claw"),
    undefined,
  );
} finally {
  globalThis.canvas = previousPerimeterBlockedStrikeCanvas;
  globalThis.foundry = previousPerimeterBlockedStrikeFoundry;
}

const movementLimitedContext = {
  ...twoStrideContext,
  actor: {
    document: {
      system: {
        actions: [
          ...twoStrideContext.actor.document.system.actions,
          {
            slug: "gallop",
            type: "action",
            label: "Gallop",
            actionType: "action",
            actions: 2,
            traits: [{ slug: "move" }],
            description: { value: "<p>The war pony Strides twice.</p>" },
          },
        ],
      },
      itemTypes: { action: [], feat: [], feature: [], consumable: [] },
      items: [],
    },
  },
  profile: {
    ...twoStrideContext.profile,
    hasCover: true,
    conditions: { slugs: ["grabbed"], values: { grabbed: 1 } },
  },
};

const previousCagedMoveCanvas = globalThis.canvas;
const previousCagedMoveFoundry = globalThis.foundry;
try {
  globalThis.foundry = {
    utils: {
      Ray: class Ray {
        constructor(A, B) {
          this.A = A;
          this.B = B;
        }
      },
    },
  };
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      checkCollision: (ray, options) =>
        ["move", "movement"].includes(options?.type)
        && (ray.A.x !== ray.B.x || ray.A.y !== ray.B.y),
    },
  };
  const cagedMovementContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...twoStrideContext.profile,
      speed: 25,
      conditions: { slugs: [], values: {} },
    },
  };
  const cagedMovementActions = readActionSources(cagedMovementContext);
  assert.equal(cagedMovementActions.find((action) => action.slug === "step").available, false);
  assert.equal(cagedMovementActions.find((action) => action.slug === "step").unavailableReason, "No collision-free movement path.");
  assert.equal(cagedMovementActions.find((action) => action.slug === "stride").available, false);
  assert.equal(cagedMovementActions.find((action) => action.slug === "stride").unavailableReason, "No collision-free movement path.");
  assert.equal(buildCandidates(cagedMovementContext).candidates.some((action) => ["step", "stride"].includes(action.slug)), false);
} finally {
  globalThis.canvas = previousCagedMoveCanvas;
  globalThis.foundry = previousCagedMoveFoundry;
}

const previousSegmentCagedMoveCanvas = globalThis.canvas;
try {
  globalThis.canvas = {
    scene: { grid: { distance: 5 } },
    grid: { size: 5 },
    walls: {
      placeables: [
        { document: { c: [-2.5, -2.5, 2.5, -2.5] } },
        { document: { c: [2.5, -2.5, 2.5, 2.5] } },
        { document: { c: [2.5, 2.5, -2.5, 2.5] } },
        { document: { c: [-2.5, 2.5, -2.5, -2.5] } },
      ],
    },
  };
  const segmentCagedMovementContext = {
    ...twoStrideContext,
    token: { center: { x: 0, y: 0 } },
    profile: {
      ...twoStrideContext.profile,
      speed: 25,
      conditions: { slugs: [], values: {} },
    },
  };
  const segmentCagedMovementActions = readActionSources(segmentCagedMovementContext);
  assert.equal(segmentCagedMovementActions.find((action) => action.slug === "step").available, false);
  assert.equal(segmentCagedMovementActions.find((action) => action.slug === "stride").available, false);
} finally {
  globalThis.canvas = previousSegmentCagedMoveCanvas;
}

const movementLimitedActions = readActionSources(movementLimitedContext);
assert.equal(movementLimitedActions.find((action) => action.slug === "step").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "stride").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "sneak").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "escape").available, true);
assert.equal(movementLimitedActions.find((action) => action.slug === "gallop").available, false);
assert.equal(movementLimitedActions.find((action) => action.slug === "stride-strike-claw"), undefined);
const movementLimitedCandidates = buildCandidates(movementLimitedContext).candidates;
assert.equal(movementLimitedCandidates.some((action) =>
  ["step", "stride", "sneak", "gallop", "stride-strike-claw"].includes(action.slug),
), false);

const inferredSpellContext = {
  actor: {
    document: {
      itemTypes: {
        spell: [{
          id: "system-telekinetic",
          name: "Telekinetic Projectile",
          slug: "telekinetic-projectile",
          system: {
            slug: "telekinetic-projectile",
            time: { value: "2" },
            traits: { value: ["attack", "cantrip"] },
            level: { value: 0 },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "bludgeoning" } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: {
            prepared: { value: "spontaneous" },
            slots: {},
          },
        }],
      },
    },
  },
};
const inferredSpell = readSpellActions(inferredSpellContext).find((spell) => spell.slug === "telekinetic-projectile");
assert.equal(inferredSpell.source, "spell-inferred");
assert.equal(inferredSpell.role, "damage");
assert.equal(inferredSpell.available, true);
assert.equal(inferredSpell.targetingProfile.maxRange, 30);

const scoredInferredAreaSpell = scoreCandidate({
  ...fighterContext,
  battlefield: {
    enemies: [
      { id: "e1", name: "Ezren", distance: 15 },
      { id: "e2", name: "Merisiel", distance: 18 },
    ],
    allies: [],
    targets: [{ id: "e1", name: "Ezren", distance: 15 }],
  },
  targets: undefined,
}, {
  id: "spell-fireball",
  name: "Fireball",
  slug: "fireball",
  actionCost: 2,
  source: "spell-inferred",
  role: "area-damage",
  saveProfile: { stat: "reflex", dc: null, basic: true },
  damageProfile: { formula: "6d6", type: "fire" },
  activityProfile: { includes: ["damage", "area"], includesStrike: false },
  targetingProfile: { area: true, type: "burst", distance: 20, maxRange: 500, enemy: true },
});
assert.ok(scoredInferredAreaSpell.score > 80, `area spell should score for enemies in area, got ${scoredInferredAreaSpell.score}`);
assert.ok(scoredInferredAreaSpell.reasons.some((reason) => reason.includes("Fireball can hit")));

const spellcasterProfile = {
  actorType: "character",
  speed: 25,
  reach: 5,
  hpPercent: 1,
  conditions: { slugs: [], values: {} },
  skills: {},
};
const spellcasterPipelineContext = {
  actor: {
    id: "ezren-1",
    name: "Ezren",
    profile: spellcasterProfile,
    document: {
      system: { actions: [] },
      itemTypes: {
        spell: [{
          id: "tk",
          name: "Telekinetic Projectile",
          slug: "telekinetic-projectile",
          system: {
            slug: "telekinetic-projectile",
            time: { value: "2" },
            traits: { value: ["attack", "cantrip"] },
            level: { value: 0 },
            range: { value: "30 feet" },
            damage: { "0": { formula: "2d6", type: "bludgeoning" } },
            location: { value: "entry-1" },
          },
        }, {
          id: "bf",
          name: "Breathe Fire",
          slug: "breathe-fire",
          system: {
            slug: "breathe-fire",
            time: { value: "2" },
            traits: { value: ["fire", "manipulate"] },
            level: { value: 1 },
            range: { value: "" },
            area: { type: "cone", value: 15 },
            defense: { save: { statistic: "reflex", basic: true } },
            damage: { "0": { formula: "2d6", type: "fire" } },
            location: { value: "entry-1" },
          },
        }],
        spellcastingEntry: [{
          id: "entry-1",
          system: { prepared: { value: "spontaneous" }, slots: { slot1: { value: 1 } } },
        }],
        feat: [{
          id: "mountain-stance",
          name: "Mountain Stance",
          type: "feat",
          system: {
            slug: "mountain-stance",
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["stance", "monk"] },
            description: { value: "<p>You enter the mountain stance. Your fist Strikes gain bonus damage.</p>" },
          },
        }],
        action: [],
        feature: [],
        consumable: [],
      },
      items: [],
    },
  },
  profile: spellcasterProfile,
  targets: [{ id: "foe", name: "Goblin", distance: 10, hpPercent: 1, conditions: [], saves: { reflex: 8 }, ac: 16 }],
  battlefield: {
    enemies: [{ id: "foe", name: "Goblin", distance: 10 }],
    allies: [],
    targets: [{ id: "foe", name: "Goblin", distance: 10 }],
  },
};
const spellcasterCandidates = buildCandidates(spellcasterPipelineContext).candidates;
const pipelineCantrip = spellcasterCandidates.find((candidate) => candidate.slug === "telekinetic-projectile");
assert.equal(pipelineCantrip.source, "spell-inferred");
assert.equal(pipelineCantrip.role, "damage");
const pipelineAreaSpell = spellcasterCandidates.find((candidate) => candidate.slug === "breathe-fire");
assert.equal(pipelineAreaSpell.source, "spell-inferred");
assert.equal(pipelineAreaSpell.role, "area-damage");
const pipelineStance = spellcasterCandidates.find((candidate) => candidate.slug === "mountain-stance");
assert.equal(pipelineStance.source, "system-inferred");
assert.equal(pipelineStance.role, "setup");
const spellcasterPlan = bestTurnPlan(spellcasterPipelineContext, spellcasterCandidates);
assert.ok(
  spellcasterPlan.steps.some((step) => ["telekinetic-projectile", "breathe-fire", "mountain-stance"].includes(step.slug)),
  `PC plan should use an inferred spell or feat, got ${spellcasterPlan.summary}`,
);

// Coverage-diagnostic tests removed alongside scripts/dev/coverage.js (commit b4be343). The
// classifier they exercised is still covered by the buildCandidates / scoreCandidate tests above.

const playerUnsafeReasonScore = scoreCandidate({
  isGM: false,
  profile: { hp: { percent: 1 }, speed: 25, reach: 5 },
  token: { center: { x: 0, y: 0 } },
  targets: [{ id: "goblin", name: "Goblin", distance: 30, hpPercent: 1, conditions: [] }],
  enemies: [{ id: "goblin", name: "Goblin", distance: 30, hpPercent: 1, conditions: [] }],
  allies: [],
}, {
  id: "burn",
  name: "Burn",
  slug: "burn",
  source: "spell-inferred",
  role: "damage",
  actionCost: 2,
  targetingProfile: { enemy: true, maxRange: 60 },
  damageProfile: { average: 10, type: "fire", types: ["fire"] },
  reasons: [
    "Goblin has fire weakness 5.",
    "Reflex DC 17 vs spell DC 21.",
    "Goblin resists fire 10.",
  ],
});
assert.ok(!playerUnsafeReasonScore.reasons.some((reason) => /weakness|resists|immune|spell DC|DC \d+/i.test(reason)));
assert.ok(!/weakness|resists|immune|spell DC|DC \d+/i.test(playerUnsafeReasonScore.reason));
assert.equal(playerUnsafeReasonScore.reason, "Burn can damage Goblin.");

const gmUnsafeReasonScore = scoreCandidate({
  isGM: true,
  profile: { hp: { percent: 1 }, speed: 25, reach: 5 },
  token: { center: { x: 0, y: 0 } },
  targets: [{ id: "goblin", name: "Goblin", distance: 30, hpPercent: 1, conditions: [] }],
  enemies: [{ id: "goblin", name: "Goblin", distance: 30, hpPercent: 1, conditions: [] }],
  allies: [],
}, {
  id: "burn",
  name: "Burn",
  slug: "burn",
  source: "spell-inferred",
  role: "damage",
  actionCost: 2,
  targetingProfile: { enemy: true, maxRange: 60 },
  damageProfile: { average: 10, type: "fire", types: ["fire"] },
  reasons: ["Goblin has fire weakness 5."],
});
assert.ok(gmUnsafeReasonScore.reasons.includes("Goblin has fire weakness 5."));

// Spell range guidance (range-overlay) — pure compute path. Drawing needs PIXI and is
// not exercised here.
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { enemy: true, maxRange: 60 } }),
  60,
  "spell targetingProfile.maxRange resolves to the range in feet",
);
assert.equal(
  spellRangeFeet({ source: "spell-curated", range: { max: 30 } }),
  30,
  "spell range.max resolves when no maxRange is present",
);
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { self: true } }),
  null,
  "self / emanation spells (no maxRange) draw no ring",
);
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { enemy: true } }),
  null,
  "an unlimited-range spell (no maxRange) draws no ring",
);
assert.equal(
  spellRangeFeet({ source: "strike", range: { max: 60 } }),
  null,
  "ranged strikes are not spells and draw no ring",
);
assert.equal(
  spellRangeFeet({ activityProfile: { spell: true }, action: { targetingProfile: { maxRange: 120 } } }),
  120,
  "spell range resolves from a nested step.action profile",
);

const rangeRing = computeRangeRing(
  { token: { center: { x: 100, y: 200 } } },
  { source: "spell-inferred", targetingProfile: { maxRange: 60 } },
  { scale: 2 },
);
assert.deepEqual(rangeRing.origin, { x: 100, y: 200 }, "ring origin is the caster token center");
assert.equal(rangeRing.radiusPx, 120, "ring radius is range feet × scale (60 × 2)");
assert.equal(
  computeRangeRing({ token: { center: { x: 0, y: 0 } } }, { source: "spell-inferred", targetingProfile: { self: true } }, { scale: 2 }),
  null,
  "no ring is computed for a spell with no max range",
);
assert.equal(
  computeRangeRing({ token: {} }, { source: "spell-inferred", targetingProfile: { maxRange: 60 } }, { scale: 2 }),
  null,
  "no ring is computed when the caster origin is unavailable",
);
assert.equal(rangeLabelText(60), "Range 60 ft", "range label rounds and labels the spell range");
assert.equal(rangeLabelText(12.4), "Range 12 ft", "range label rounds fractional feet");

// Reach Spell (rangeBonusFeet) extends the effective range used by the ring.
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { maxRange: 60 }, rangeBonusFeet: 30 }),
  90,
  "a +30 range bonus extends a 60 ft spell to 90 ft",
);
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { maxRange: 5 }, rangeBonusFeet: 30 }),
  30,
  "Reach Spell turns a touch (5 ft) spell into a 30 ft range",
);
assert.equal(
  spellRangeFeet({ source: "spell-inferred", targetingProfile: { self: true }, rangeBonusFeet: 30 }),
  null,
  "a range bonus does not give a self/no-range spell a ring",
);
assert.equal(
  computeRangeRing(
    { token: { center: { x: 0, y: 0 } } },
    { source: "spell-inferred", targetingProfile: { maxRange: 60 }, rangeBonusFeet: 30 },
    { scale: 2 },
  ).radiusPx,
  180,
  "the ring radius reflects the Reach Spell-extended range (90 ft × 2)",
);

// --- inheritPlannedTarget must regenerate reasons/score, not just splice the target (Task 3) ---
// Reproduces the live Verdurous Ooze bug: a standalone Grapple candidate (scored on its own,
// before planning, the way buildCandidates() always scores raw actions) prefers the wrong
// target (Lem) because that's the only enemy it can see in isolation. Inside the real plan
// (Pseudopod -> Grapple against Ezren), grabbedSetupTargetSourceStep (planner.js:813-822)
// correctly detects that Grapple applies "grabbed" (candidateAppliedConditions) after a
// strike-like step, and inheritPlannedTarget retargets it onto Ezren. The bug: the retargeted
// step kept the reasons/score computed against Lem instead of recomputing them against Ezren.
{
  const ezren = {
    id: "ezren",
    name: "Ezren",
    distance: 5,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    saves: { fortitude: 20, reflex: 14, will: 16 },
    ac: 22,
  };
  const lem = {
    id: "lem",
    name: "Lem",
    distance: 5,
    hpPercent: 1,
    conditions: { slugs: [], values: {} },
    saves: { fortitude: 19, reflex: 18, will: 15 },
    ac: 21,
  };
  const contextWithBothEnemies = {
    actor: { id: "verdurous-ooze", name: "Verdurous Ooze" },
    profile: {
      actorType: "npc",
      reach: 5,
      speed: 10,
      conditions: { slugs: [], values: {} },
      skills: { athletics: { mod: 15, rank: 4 } },
    },
    token: { center: { x: 0, y: 0 } },
    targets: [ezren, lem],
    battlefield: { targets: [ezren, lem], enemies: [ezren, lem], allies: [] },
  };

  // A strike-like candidate (isStrikeLikeCandidate: source === "strike") targeting Ezren --
  // grabbedSetupTargetSourceStep requires steps.at(-1) to be strike-like.
  const strikeStep = {
    id: "pseudopod",
    name: "Pseudopod",
    slug: "pseudopod",
    actionCost: 1,
    source: "strike",
    attack: true,
    score: 90,
    confidence: "high",
    preferredTarget: ezren,
    reason: "Attack Ezren.",
    reasons: ["Attack Ezren."],
  };

  // A candidate that applies "grabbed" (candidateAppliedConditions reads activityProfile.includesGrab
  // as an implicit "grabbed" source) and requires a previous strike (previousActionRequirements:
  // ["after-strike"], read by isGrabRider/previousActionSatisfied so it's only planned as a follow-up).
  // Its OWN preferredTarget is Lem -- the "wrong", standalone-scored target -- exactly like the live
  // Verdurous Ooze Grapple candidate scored in isolation before the plan tree considers chaining it
  // after Pseudopod.
  const rawGrappleCandidate = {
    id: "grapple",
    name: "Grapple",
    slug: "grapple",
    actionCost: 1,
    source: "system-inferred",
    role: "grab",
    skill: "athletics",
    confidence: "high",
    preferredTarget: lem,
    activityProfile: {
      includesGrab: true,
      appliesCondition: "grabbed",
      previousActionRequirements: ["after-strike"],
    },
  };
  // Score it standalone first (as buildCandidates() always does before candidates reach the
  // planner), in a context where Lem is the only visible enemy -- this produces the real,
  // wrong-target reasons/score ("Grapple can grab Lem.") that the bug used to leave stale.
  const grappleCandidate = scoreCandidate({
    ...contextWithBothEnemies,
    targets: [lem],
    battlefield: { targets: [lem], enemies: [lem], allies: [] },
  }, rawGrappleCandidate);
  assert.ok(
    grappleCandidate.reasons.some((reason) => reason.includes("Lem")),
    "sanity check: the standalone Grapple candidate's own reasons should describe Lem",
  );

  const plans = buildTurnPlans(contextWithBothEnemies, [strikeStep, grappleCandidate]);
  const planWithGrapple = plans.find((plan) => plan.steps.some((step) => step.slug === grappleCandidate.slug));
  assert.ok(planWithGrapple, "expected a plan chaining Pseudopod -> Grapple");
  const grappleStep = planWithGrapple.steps.find((step) => step.slug === grappleCandidate.slug);

  assert.equal(grappleStep.suggestedTarget?.name, "Ezren");
  assert.ok(
    grappleStep.reasons.some((reason) => reason.includes("Ezren")),
    "reasons must describe the actual inherited target, not be copied verbatim from the standalone (wrong-target) candidate",
  );
  assert.ok(
    !grappleStep.reasons.some((reason) => reason.includes("Lem")),
    "stale reasons naming the original standalone target must not survive the retarget",
  );
}

const suddenChargeShaped = classifySystemAction({
  name: "Sudden Charge",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "You Stride twice. If you end this movement within reach of at least one enemy, you can make a melee Strike against that enemy." },
    traits: { value: [] },
  },
}, { actionCost: 2, type: "action" });
assert.equal(suddenChargeShaped.role, "mobility-attack", "an ordinary Stride-then-single-Strike ability must still be classified as mobility-attack");

const driftersWakeShaped = classifySystemAction({
  name: "Whirling Charge",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "You Stride up to your Speed. Make up to three Strikes, each against a different target, at any point during this movement." },
    traits: { value: [] },
  },
}, { actionCost: 1, type: "action" });
assert.equal(driftersWakeShaped.role, "multiattack", "a Stride ability that ALSO makes multiple Strikes against different targets must not be swallowed by the plain mobility-attack guard");

const strideGenericMultiStrikeShaped = classifySystemAction({
  name: "Rolling Advance",
  system: {
    actionType: { value: "action" },
    actions: { value: 1 },
    category: "offensive",
    description: { value: "You Stride up to your Speed. Make up to three claw Strikes at any point during this movement." },
    traits: { value: [] },
  },
}, { actionCost: 1, type: "action" });
assert.equal(strideGenericMultiStrikeShaped.role, "mobility-attack", "a Stride ability with generic multi-strike language but no distinct-target phrasing is still classified as mobility-attack under the shipped (narrower) condition");

const doubleAttackAction = {
  name: "Double Attack",
  slug: "double-attack",
  system: {
    description: {
      value: "The creature makes two Strikes with two different arms or tentacles, each limb targeting a different creature. Double Attack counts as two attacks toward the creature's multiple attack penalty, but the penalty doesn't increase until after both attacks are made.",
    },
    traits: { value: [] },
    time: { value: "1" },
  },
};
const doubleAttackClassified = classifySystemAction(doubleAttackAction, { actionCost: 1, type: "action" });
assert.equal(doubleAttackClassified.role, "multiattack");
assert.equal(doubleAttackClassified.activityProfile.requiresDistinctTargets, true);
assert.equal(doubleAttackClassified.activityProfile.distinctStrikeCount, 2);
assert.deepEqual(doubleAttackClassified.activityProfile.includes, ["strike", "strike"]);
assert.equal(doubleAttackClassified.activityProfile.mapAttacks, 2, "the pre-existing MAP-count field must still be read from 'counts as two attacks' unchanged");

const bladestormAction = {
  name: "Bladestorm",
  slug: "bladestorm",
  system: {
    description: {
      value: "The marilith makes up to six longsword Strikes, each against a different target. These attacks count toward the marilith's multiple attack penalty, but the multiple attack penalty doesn't increase until after all the attacks.",
    },
    traits: { value: [] },
    time: { value: "1" },
  },
};
const bladestormClassified = classifySystemAction(bladestormAction, { actionCost: 1, type: "action" });
assert.equal(bladestormClassified.activityProfile.requiresDistinctTargets, true);
assert.equal(bladestormClassified.activityProfile.distinctStrikeCount, 6, "Bladestorm makes six Strikes, not two — the count must come from its own text, not a hardcoded default");
assert.equal(bladestormClassified.activityProfile.mapAttacks, undefined, "Bladestorm never says 'counts as N attacks' — mapAttacks must stay unset, distinctStrikeCount is a separate signal");

const buckingFrenzyAction = {
  name: "Bucking Frenzy",
  slug: "bucking-frenzy",
  system: {
    description: {
      value: "The war pig transforms any fear it feels into fury before kicking wildly. The war pig then makes hoof Strikes against up to three different foes within its reach.",
    },
    traits: { value: [] },
    time: { value: "1" },
  },
};
const buckingFrenzyClassified = classifySystemAction(buckingFrenzyAction, { actionCost: 1, type: "action" });
assert.equal(buckingFrenzyClassified.role, "multiattack", "'different foes' must be recognized, not just 'different targets'");
assert.equal(buckingFrenzyClassified.activityProfile.distinctStrikeCount, 3);

const genericMultiStrikeAction = {
  name: "Triple Snap",
  slug: "triple-snap",
  system: {
    description: {
      value: "The creature makes three Strikes. Triple Snap counts as three attacks toward the creature's multiple attack penalty.",
    },
    traits: { value: [] },
    time: { value: "1" },
  },
};
const genericMultiStrikeClassified = classifySystemAction(genericMultiStrikeAction, { actionCost: 1, type: "action" });
assert.equal(
  genericMultiStrikeClassified.activityProfile.requiresDistinctTargets,
  undefined,
  "an ordinary multi-strike with no different-creature requirement must not be flagged for distinct targets",
);
assert.deepEqual(
  genericMultiStrikeClassified.activityProfile.includes,
  ["strike"],
  "an ordinary multi-strike keeps the existing single 'strike' marker — only different-creature abilities repeat it",
);

const suddenChargeStillSafe = classifySystemAction({
  name: "Sudden Charge",
  system: {
    actionType: { value: "action" },
    actions: { value: 2 },
    category: "offensive",
    description: { value: "You Stride twice. If you end this movement within reach of at least one enemy, you can make a melee Strike against that enemy." },
    traits: { value: [] },
  },
}, { actionCost: 2, type: "action" });
assert.equal(suddenChargeStillSafe.role, "mobility-attack");
assert.equal(suddenChargeStillSafe.activityProfile.requiresDistinctTargets, undefined);

const doubleAttackCandidate = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  targetingProfile: { enemy: true },
  activityProfile: { includes: ["strike", "strike"], includesStrike: true, multiStrike: true, mapAttacks: 2, requiresDistinctTargets: true, distinctStrikeCount: 2 },
};
const twoEnemiesContext = {
  ...fighterContext,
  targets: [
    { ...fighterContext.targets[0], id: "enemy-a", name: "Ogre", distance: 5 },
    { ...fighterContext.targets[0], id: "enemy-b", name: "Goblin", distance: 5, hpPercent: 0.3 },
  ],
};
const twoEnemiesScored = scoreCandidate(twoEnemiesContext, doubleAttackCandidate);
assert.equal(twoEnemiesScored.activityProfile.distinctTargets.length, 2);
assert.notEqual(
  twoEnemiesScored.activityProfile.distinctTargets[0].name,
  twoEnemiesScored.activityProfile.distinctTargets[1].name,
  "with two enemies in reach, Double Attack's two attacks must resolve to two different creatures",
);

const oneEnemyContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], id: "enemy-a", name: "Ogre", distance: 5 }],
};
const oneEnemyScored = scoreCandidate(oneEnemyContext, doubleAttackCandidate);
assert.equal(oneEnemyScored.activityProfile.distinctTargets.length, 2);
assert.equal(
  oneEnemyScored.activityProfile.distinctTargets[0].name,
  oneEnemyScored.activityProfile.distinctTargets[1].name,
  "with only one enemy in reach, both of Double Attack's attacks fall back to that same creature",
);

const bladestormCandidate = {
  id: "marilith-bladestorm",
  name: "Bladestorm",
  slug: "bladestorm",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  targetingProfile: { enemy: true },
  activityProfile: { includes: Array(6).fill("strike"), includesStrike: true, multiStrike: true, requiresDistinctTargets: true, distinctStrikeCount: 6 },
};
const threeEnemiesContext = {
  ...fighterContext,
  targets: [
    { ...fighterContext.targets[0], id: "enemy-a", name: "Ogre", distance: 5 },
    { ...fighterContext.targets[0], id: "enemy-b", name: "Goblin", distance: 5, hpPercent: 0.3 },
    { ...fighterContext.targets[0], id: "enemy-c", name: "Kobold", distance: 5, hpPercent: 0.6 },
  ],
};
const bladestormScored = scoreCandidate(threeEnemiesContext, bladestormCandidate);
assert.equal(bladestormScored.activityProfile.distinctTargets.length, 6, "Bladestorm must produce 6 target slots even though only 3 enemies exist");
const distinctNamesInBladestorm = new Set(bladestormScored.activityProfile.distinctTargets.map((t) => t.name));
assert.equal(distinctNamesInBladestorm.size, 3, "with only 3 enemies in reach, Bladestorm's 6 slots must cycle through all 3, not repeat just the top pick 6 times");

const ordinaryStrikeCandidate = { id: "strike", name: "Strike", slug: "strike", actionCost: 1, source: "strike", role: "damage", activityProfile: { averageDamage: 10 } };
const ordinaryStrikeScored = scoreCandidate(twoEnemiesContext, ordinaryStrikeCandidate);
assert.equal(
  ordinaryStrikeScored.activityProfile?.distinctTargets,
  undefined,
  "an ordinary single-target action must not gain a distinctTargets list",
);

const distinctTargetA = { id: "enemy-a", name: "Ogre", distance: 5 };
const distinctTargetB = { id: "enemy-b", name: "Goblin", distance: 5 };
const doubleAttackForBuilder = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  activityProfile: {
    includes: ["strike", "strike"],
    includesStrike: true,
    multiStrike: true,
    mapAttacks: 2,
    requiresDistinctTargets: true,
    distinctStrikeCount: 2,
    distinctTargets: [distinctTargetA, distinctTargetB],
  },
};
const expandedAtoms = builderAtomicActionsForStep(doubleAttackForBuilder);
assert.equal(expandedAtoms.length, 2, "Double Attack must expand into 2 atomic Strike steps");
assert.equal(expandedAtoms[0].preferredTarget?.name, "Ogre");
assert.equal(expandedAtoms[1].preferredTarget?.name, "Goblin");
assert.equal(expandedAtoms[0].slug, "strike");
assert.equal(expandedAtoms[1].slug, "strike");

const bladestormForBuilder = {
  id: "marilith-bladestorm",
  name: "Bladestorm",
  slug: "bladestorm",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  activityProfile: {
    includes: Array(6).fill("strike"),
    includesStrike: true,
    multiStrike: true,
    requiresDistinctTargets: true,
    distinctStrikeCount: 6,
    distinctTargets: [distinctTargetA, distinctTargetB, distinctTargetA, distinctTargetB, distinctTargetA, distinctTargetB],
  },
};
const bladestormAtoms = builderAtomicActionsForStep(bladestormForBuilder);
assert.equal(bladestormAtoms.length, 6, "Bladestorm must expand into all 6 atomic Strike steps, not just 2");
assert.equal(bladestormAtoms[5].preferredTarget?.name, "Goblin");

const fallbackDoubleAttack = {
  ...doubleAttackForBuilder,
  activityProfile: { ...doubleAttackForBuilder.activityProfile, distinctTargets: undefined },
};
const fallbackAtoms = builderAtomicActionsForStep(fallbackDoubleAttack);
assert.equal(fallbackAtoms.length, 1, "with no distinctTargets computed, the action is not force-expanded into guesses");

const costFixTargetA = { id: "enemy-a", name: "Ogre", distance: 5 };
const costFixTargetB = { id: "enemy-b", name: "Goblin", distance: 5 };
const doubleAttackForCostFix = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  activityProfile: {
    includes: ["strike", "strike"],
    includesStrike: true,
    multiStrike: true,
    mapAttacks: 2,
    requiresDistinctTargets: true,
    distinctStrikeCount: 2,
    distinctTargets: [costFixTargetA, costFixTargetB],
  },
};
const costFixAtoms = builderAtomicActionsForStep(doubleAttackForCostFix);
assert.equal(costFixAtoms.length, 2);
assert.equal(costFixAtoms[0].actionCost, 1, "the first atom of a 1-action distinct-target ability must carry its real action cost");
assert.equal(costFixAtoms[0].cost, 1);
assert.equal(costFixAtoms[1].actionCost, 0, "every atom after the first must cost 0 so the draft's budget only counts the ability once");
assert.equal(costFixAtoms[1].cost, 0);

const bladestormForCostFix = {
  id: "marilith-bladestorm",
  name: "Bladestorm",
  slug: "bladestorm",
  actionCost: 1,
  source: "system-inferred",
  role: "multiattack",
  activityProfile: {
    includes: Array(6).fill("strike"),
    includesStrike: true,
    multiStrike: true,
    requiresDistinctTargets: true,
    distinctStrikeCount: 6,
    distinctTargets: [costFixTargetA, costFixTargetB, costFixTargetA, costFixTargetB, costFixTargetA, costFixTargetB],
  },
};
const bladestormCostFixAtoms = builderAtomicActionsForStep(bladestormForCostFix);
assert.equal(bladestormCostFixAtoms.length, 6);
assert.equal(bladestormCostFixAtoms[0].actionCost, 1, "Bladestorm is itself a 1-action ability despite making 6 Strikes");
assert.deepEqual(
  bladestormCostFixAtoms.slice(1).map((atom) => atom.actionCost),
  [0, 0, 0, 0, 0],
  "all 5 remaining Bladestorm atoms must cost 0",
);

const strideStrikeComposite = {
  id: "stride-strike-composite",
  name: "Stride -> Strike",
  slug: "stride-strike-composite",
  actionCost: 2,
  source: "generated-composite",
  role: "mobility-attack",
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1 },
};
const strideStrikeAtoms = builderAtomicActionsForStep(strideStrikeComposite);
assert.equal(strideStrikeAtoms.length, 2);
assert.equal(strideStrikeAtoms[1].actionCost, 1, "an ordinary (non-distinct-target) composite's Strike atom must keep its existing hardcoded cost of 1, unaffected by this fix");

const identityFixTargetA = { id: "enemy-a", name: "Ogre", distance: 5 };
const identityFixTargetB = { id: "enemy-b", name: "Goblin", distance: 5 };
const doubleAttackForIdentityFix = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  activityProfile: {
    includes: ["strike", "strike"],
    includesStrike: true,
    multiStrike: true,
    mapAttacks: 2,
    requiresDistinctTargets: true,
    distinctStrikeCount: 2,
    distinctTargets: [identityFixTargetA, identityFixTargetB],
  },
};
const identityFixAtoms = builderAtomicActionsForStep(doubleAttackForIdentityFix);
assert.equal(identityFixAtoms.length, 2);
assert.equal(identityFixAtoms[0].slug, "double-attack", "a distinct-target atom must carry the original ability's own slug, not the generic 'strike', so the panel resolves it back to the right ability instead of an unrelated real Strike candidate");
assert.equal(identityFixAtoms[1].slug, "double-attack");
assert.equal(identityFixAtoms[0].executable, "open-item", "executable must still be inherited unchanged from the original action, since it (not slug) is what execution actually dispatches on");
assert.equal(identityFixAtoms[0].activityProfile.includesStrike, true, "includesStrike must stay true regardless of the slug change, since readiness/movement checks read this field, not slug");

const strideStrikeCompositeForIdentityFix = {
  id: "stride-strike-composite",
  name: "Stride -> Strike",
  slug: "stride-strike-composite",
  actionCost: 2,
  source: "generated-composite",
  role: "mobility-attack",
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1 },
};
const strideStrikeIdentityAtoms = builderAtomicActionsForStep(strideStrikeCompositeForIdentityFix);
assert.equal(strideStrikeIdentityAtoms.length, 2);
assert.equal(strideStrikeIdentityAtoms[1].slug, "strike", "an ordinary (non-distinct-target) composite's Strike atom must keep the existing generic 'strike' slug, unaffected by this fix");

const weakStrikeActor = {
  system: {
    actions: [{
      slug: "claw",
      label: "Claw",
      name: "Claw",
      type: "strike",
      visible: true,
      ready: true,
      canAttack: true,
      item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "1d4", damageType: "slashing" } } } },
    }],
  },
};
const weakOnlyBest = bestReadyStrike(weakStrikeActor, {});
assert.equal(weakOnlyBest?.name, "Claw", "with only one real Strike available, that Strike is the best one");
assert.equal(weakOnlyBest?.executable, "strike", "the returned candidate must be a genuinely rollable Strike, not a description-only action");

const twoStrikeActor = {
  system: {
    actions: [
      {
        slug: "claw", label: "Claw", name: "Claw", type: "strike", visible: true, ready: true, canAttack: true,
        item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "1d4", damageType: "slashing" } } } },
      },
      {
        slug: "bite", label: "Bite", name: "Bite", type: "strike", visible: true, ready: true, canAttack: true,
        item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "2d10", damageType: "piercing" } } } },
      },
    ],
  },
};
const strongerOfTwo = bestReadyStrike(twoStrikeActor, {});
assert.equal(strongerOfTwo?.name, "Bite", "with two real Strikes available, the higher-average-damage one is picked");

const noStrikeActor = { system: { actions: [] } };
assert.equal(bestReadyStrike(noStrikeActor, {}), null, "an actor with no real Strikes returns null, not a thrown error");

const unarmedAndWeaponActor = {
  system: {
    actions: [
      {
        slug: "fist", label: "Fist", name: "Fist", type: "strike", visible: true, ready: true, canAttack: true,
        traits: ["unarmed"],
        item: { system: { traits: { value: ["unarmed", "agile", "finesse"] }, damageRolls: { a: { damage: "1d4", damageType: "bludgeoning" } } } },
      },
      {
        slug: "longsword", label: "Longsword", name: "Longsword", type: "strike", visible: true, ready: true, canAttack: true,
        item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "1d8+6", damageType: "slashing" } } } },
      },
    ],
  },
};
assert.equal(bestReadyStrike(unarmedAndWeaponActor, {})?.name, "Longsword", "with no filter, the highest-average-damage Strike wins regardless of weapon type");
assert.equal(bestReadyStrike(unarmedAndWeaponActor, {}, backingStrikeFilterByPreset("unarmed"))?.name, "Fist", "the 'unarmed' filter preset must restrict the pick to Strikes carrying the unarmed trait, even when a real weapon deals more damage");

const rangedAndMeleeActor = {
  system: {
    actions: [
      {
        slug: "shortsword", label: "Shortsword", name: "Shortsword", type: "strike", visible: true, ready: true, canAttack: true,
        item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "3d6", damageType: "piercing" } } } },
      },
      {
        slug: "shortbow", label: "Shortbow", name: "Shortbow", type: "strike", visible: true, ready: true, canAttack: true,
        reload: 0,
        item: { system: { range: { increment: 60 }, traits: { value: [] }, damageRolls: { a: { damage: "1d6", damageType: "piercing" } } } },
      },
    ],
  },
};
assert.equal(bestReadyStrike(rangedAndMeleeActor, {}, backingStrikeFilterByPreset("ranged-reload-zero"))?.name, "Shortbow", "the 'ranged-reload-zero' filter preset must restrict the pick to a genuine ranged weapon (raw item.system.range present) with no reload, even when a melee Strike deals more damage");
assert.equal(bestReadyStrike(rangedAndMeleeActor, {}, backingStrikeFilterByPreset("nonexistent-preset"))?.name, "Shortsword", "an unknown preset name must not throw or filter out everything -- it falls back to unfiltered (highest damage wins)");

const meleeItem = (damage, type, traits, range = null) => ({ type: "melee", system: { damageRolls: { r: { damage, damageType: type } }, range, traits: { value: traits } } });
const multiStrikeActorForOptions = {
  type: "npc",
  itemTypes: {},
  system: {
    traits: { size: { value: "med" } },
    actions: [
      { type: "strike", name: "Claw", label: "Claw", slug: "claw", item: meleeItem("1d6+4", "slashing", []), traits: [], weaponTraits: [], variants: [] },
      { type: "strike", name: "Bite", label: "Bite", slug: "bite", item: meleeItem("1d8+4", "piercing", []), traits: [], weaponTraits: [], variants: [] },
    ],
  },
};
const strikeOptions = actorStrikeOptions(multiStrikeActorForOptions, fighterContext);
assert.equal(strikeOptions.length, 2, "actorStrikeOptions should return every ready strike, not just the best one");
assert.deepEqual(strikeOptions.map((option) => option.id), ["strike-claw", "strike-bite"], "each strike option should carry a stable, weapon-specific id");
assert.equal(strikeOptions[0].name, "Claw");
assert.equal(strikeOptions[1].name, "Bite");

const backingStrikeActorDoc = {
  system: {
    actions: [{
      slug: "arm", label: "Arm", name: "Arm", type: "strike", visible: true, ready: true, canAttack: true,
      item: { system: { traits: { value: [] }, damageRolls: { a: { damage: "2d8", damageType: "bludgeoning" } } } },
    }],
  },
};
const doubleAttackForBackingStrike = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  targetingProfile: { enemy: true },
  activityProfile: { includes: ["strike", "strike"], includesStrike: true, multiStrike: true, mapAttacks: 2, requiresDistinctTargets: true, distinctStrikeCount: 2 },
};
const backingStrikeContext = {
  ...fighterContext,
  actor: { ...fighterContext.actor, document: backingStrikeActorDoc },
  targets: [
    { ...fighterContext.targets[0], id: "enemy-a", name: "Ogre", distance: 5 },
    { ...fighterContext.targets[0], id: "enemy-b", name: "Goblin", distance: 5, hpPercent: 0.3 },
  ],
};
const backingStrikeScored = scoreCandidate(backingStrikeContext, doubleAttackForBackingStrike);
assert.equal(backingStrikeScored.activityProfile.backingStrike?.name, "Arm", "a requiresDistinctTargets action must be given the actor's own real Strike as its backing strike");
assert.equal(backingStrikeScored.activityProfile.backingStrike?.executable, "strike");

const ordinaryCandidateForBackingStrike = { id: "strike", name: "Strike", slug: "strike", actionCost: 1, source: "strike", role: "damage", activityProfile: { averageDamage: 10 } };
const ordinaryScoredForBackingStrike = scoreCandidate(backingStrikeContext, ordinaryCandidateForBackingStrike);
assert.equal(ordinaryScoredForBackingStrike.activityProfile?.backingStrike, undefined, "an ordinary action must not gain a backingStrike");

const suddenChargeActorForBackingStrike = {
  type: "npc",
  itemTypes: {},
  system: {
    traits: { size: { value: "med" } },
    actions: [
      { type: "strike", name: "Longsword", label: "Longsword", slug: "longsword", item: meleeItem("1d8+4", "slashing", ["versatile-p"]), traits: [], weaponTraits: [], variants: [] },
    ],
  },
};
const suddenChargeForBackingStrike = {
  id: "sudden-charge",
  name: "Sudden Charge",
  slug: "sudden-charge",
  actionCost: 2,
  source: "system-inferred",
  executable: "open-item",
  role: "mobility-attack",
  activityProfile: { includes: ["stride", "stride", "strike"], strideCount: 2, includesStrike: true, requiresBackingStrike: true },
};
const suddenChargeBackingStrikeContext = { ...fighterContext, actor: { document: suddenChargeActorForBackingStrike } };
const suddenChargeScored = scoreCandidate(suddenChargeBackingStrikeContext, suddenChargeForBackingStrike);
assert.equal(suddenChargeScored.activityProfile.backingStrike?.name, "Longsword", "a requiresBackingStrike action should compute a backingStrike exactly like requiresDistinctTargets already does");

const ordinaryActionForBackingStrikeGate = { id: "strike", name: "Strike", slug: "strike", actionCost: 1, source: "strike", role: "damage", activityProfile: { averageDamage: 10 } };
const ordinaryBackingStrikeScored = scoreCandidate(suddenChargeBackingStrikeContext, ordinaryActionForBackingStrikeGate);
assert.equal(ordinaryBackingStrikeScored.activityProfile?.backingStrike, undefined, "an ordinary action must not gain a backingStrike");

const flyingKickForBackingStrike = {
  id: "flying-kick",
  name: "Flying Kick",
  slug: "flying-kick",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "mobility-attack",
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, requiresBackingStrike: true },
};
const flyingKickBackingStrikeContext = { ...fighterContext, actor: { document: suddenChargeActorForBackingStrike } };
const flyingKickScored = scoreCandidate(flyingKickBackingStrikeContext, flyingKickForBackingStrike);
assert.equal(flyingKickScored.activityProfile.backingStrike?.name, "Longsword", "Flying Kick's requiresBackingStrike tag must compute a backingStrike exactly like Sudden Charge's already does");

const flurryActorForBackingStrike = {
  type: "npc",
  itemTypes: {},
  system: {
    traits: { size: { value: "med" } },
    actions: [
      { type: "strike", name: "Fist", label: "Fist", slug: "fist", traits: [], weaponTraits: [], variants: [], item: meleeItem("1d6+4", "bludgeoning", ["unarmed", "agile"]) },
      { type: "strike", name: "Longsword", label: "Longsword", slug: "longsword", traits: [], weaponTraits: [], variants: [], item: meleeItem("1d8+4", "slashing", ["versatile-p"]) },
    ],
  },
};
const flurryOfBlowsForBackingStrike = {
  id: "flurry-of-blows",
  name: "Flurry of Blows",
  slug: "flurry-of-blows",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  activityProfile: { includes: ["strike", "strike"], includesStrike: true, multiStrike: true, requiresBackingStrike: true, backingStrikeFilter: "unarmed" },
};
const flurryBackingStrikeContext = { ...fighterContext, actor: { document: flurryActorForBackingStrike } };
const flurryScored = scoreCandidate(flurryBackingStrikeContext, flurryOfBlowsForBackingStrike);
assert.equal(flurryScored.activityProfile.backingStrike?.name, "Fist", "Flurry of Blows' backingStrikeFilter must restrict the borrowed weapon to an unarmed Strike, even though the Longsword deals more damage");

const twinTakedownActorForBackingStrike = {
  type: "npc",
  itemTypes: {},
  system: {
    traits: { size: { value: "med" } },
    actions: [
      {
        type: "strike", name: "Sickle", label: "Sickle", slug: "sickle-1", traits: [], weaponTraits: [], variants: [],
        item: { type: "weapon", name: "Sickle", system: { equipped: { carryType: "held", handsHeld: 1 }, traits: { value: [] }, damageRolls: { a: { damage: "1d4+4", damageType: "slashing" } } } },
      },
      {
        type: "strike", name: "Dagger", label: "Dagger", slug: "dagger-1", traits: [], weaponTraits: [], variants: [],
        item: { type: "weapon", name: "Dagger", system: { equipped: { carryType: "held", handsHeld: 1 }, traits: { value: [] }, damageRolls: { a: { damage: "1d4+2", damageType: "piercing" } } } },
      },
      {
        type: "strike", name: "Fist", label: "Fist", slug: "fist", traits: ["unarmed"], weaponTraits: [], variants: [],
        item: { type: "weapon", name: "Fist", system: { equipped: { carryType: "worn", handsHeld: 0 }, traits: { value: ["unarmed"] }, damageRolls: { a: { damage: "1d4", damageType: "bludgeoning" } } } },
      },
      {
        type: "strike", name: "Hand Crossbow", label: "Hand Crossbow", slug: "hand-crossbow", traits: [], weaponTraits: [], variants: [],
        item: { type: "weapon", name: "Hand Crossbow", system: { equipped: { carryType: "held", handsHeld: 1 }, range: { increment: 60 }, traits: { value: [] }, damageRolls: { a: { damage: "1d6", damageType: "piercing" } } } },
      },
    ],
  },
};
const twinTakedownBackingStrikes = heldMeleeBackingStrikes(twinTakedownActorForBackingStrike, {});
assert.equal(twinTakedownBackingStrikes.length, 2, "an actor with two held melee weapons, one worn unarmed strike, and one held RANGED weapon must return exactly the two held melee weapons");
assert.equal(twinTakedownBackingStrikes[0].name, "Sickle");
assert.equal(twinTakedownBackingStrikes[1].name, "Dagger");

const oneHeldMeleeWeaponActor = {
  type: "npc",
  itemTypes: {},
  system: { actions: [twinTakedownActorForBackingStrike.system.actions[0], twinTakedownActorForBackingStrike.system.actions[2]] },
};
assert.equal(heldMeleeBackingStrikes(oneHeldMeleeWeaponActor, {}).length, 1, "an actor with only one held melee weapon returns just that one, not padded or thrown");

assert.deepEqual(heldMeleeBackingStrikes({ system: { actions: [] } }, {}), [], "an actor with no strikes at all returns an empty array, not null or a thrown error");

const twinTakedownForBackingStrike = {
  id: "twin-takedown",
  name: "Twin Takedown",
  slug: "twin-takedown",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  activityProfile: { includes: ["strike", "strike"], includesStrike: true, multiStrike: true, requiresBackingStrike: true, requiresDualBackingStrike: true },
};
const twinTakedownBackingStrikeContext = { ...fighterContext, actor: { document: twinTakedownActorForBackingStrike } };
const twinTakedownScored = scoreCandidate(twinTakedownBackingStrikeContext, twinTakedownForBackingStrike);
assert.equal(twinTakedownScored.activityProfile.backingStrikes?.length, 2, "requiresDualBackingStrike must compute an array of the actor's two held melee weapons");
assert.equal(twinTakedownScored.activityProfile.backingStrikes[0]?.name, "Sickle");
assert.equal(twinTakedownScored.activityProfile.backingStrikes[1]?.name, "Dagger");

const ordinaryDualBackingScored = scoreCandidate(twinTakedownBackingStrikeContext, { id: "strike", name: "Strike", slug: "strike", actionCost: 1, source: "strike", role: "damage", activityProfile: { averageDamage: 10 } });
assert.equal(ordinaryDualBackingScored.activityProfile?.backingStrikes, undefined, "an ordinary action must not gain a backingStrikes array");

const backingStrikeTargetA = { id: "enemy-a", name: "Ogre", distance: 5 };
const backingStrikeTargetB = { id: "enemy-b", name: "Goblin", distance: 5 };
const armBackingStrike = {
  id: "strike-arm",
  name: "Arm",
  slug: "strike",
  executable: "strike",
  source: "strike",
  item: { name: "Arm", uuid: "Actor.fake.Item.arm" },
  attack: { value: 12 },
  damage: { value: "2d8+6" },
  damageProfile: { average: 15, type: "bludgeoning" },
  averageDamage: 15,
  critical: null,
  traits: ["reach"],
  weaponTraits: [],
  range: {},
  reload: 0,
  variants: [],
  strike: {},
};
const doubleAttackWithBackingStrike = {
  id: "kraken-double-attack",
  name: "Double Attack",
  slug: "double-attack",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  mapPenalty: 0,
  attackIndex: 1,
  activityProfile: {
    includes: ["strike", "strike"],
    includesStrike: true,
    multiStrike: true,
    mapAttacks: 2,
    requiresDistinctTargets: true,
    distinctStrikeCount: 2,
    distinctTargets: [backingStrikeTargetA, backingStrikeTargetB],
    backingStrike: armBackingStrike,
  },
};
const backingStrikeAtoms = builderAtomicActionsForStep(doubleAttackWithBackingStrike);
assert.equal(backingStrikeAtoms.length, 2);
assert.equal(backingStrikeAtoms[0].name, "Double Attack -> Arm", "the atom's name must show both the ability and the real weapon it rolls");
assert.equal(backingStrikeAtoms[1].name, "Double Attack -> Arm");
assert.equal(backingStrikeAtoms[0].executable, "strike", "the atom must be executable as a real Strike, not open-item");
assert.equal(backingStrikeAtoms[0].source, "strike");
assert.equal(backingStrikeAtoms[0].item?.name, "Arm");
assert.equal(backingStrikeAtoms[0].attack?.value, 12);
assert.equal(backingStrikeAtoms[0].averageDamage, 15);
assert.equal(backingStrikeAtoms[0].mapPenalty, 0, "mapPenalty must still be inherited from the original composite, unaffected by borrowing the backing strike's execution fields");
assert.equal(backingStrikeAtoms[0].attackIndex, 1, "attackIndex must still be inherited from the original composite");
assert.equal(backingStrikeAtoms[0].preferredTarget?.name, "Ogre", "the per-atom target override must still win over the backing strike's own preferredTarget");
assert.equal(backingStrikeAtoms[1].preferredTarget?.name, "Goblin");

const doubleAttackWithoutBackingStrike = {
  ...doubleAttackWithBackingStrike,
  activityProfile: { ...doubleAttackWithBackingStrike.activityProfile, backingStrike: undefined },
};
const noBackingStrikeAtoms = builderAtomicActionsForStep(doubleAttackWithoutBackingStrike);
assert.equal(noBackingStrikeAtoms[0].name, "Double Attack", "with no backing strike found, the atom falls back to the ability's own name, unchanged from before this task");
assert.equal(noBackingStrikeAtoms[0].executable, "open-item", "with no backing strike found, execution falls back to the ability's own (unrollable) executable, unchanged from before this task");

const sickleBackingStrike = {
  id: "strike-sickle", name: "Sickle", slug: "strike", executable: "strike", source: "strike",
  item: { name: "Sickle", uuid: "Actor.fake.Item.sickle" },
  attack: { value: 10 }, damage: { value: "1d4+4" }, damageProfile: { average: 6, type: "slashing" },
  averageDamage: 6, critical: null, traits: [], weaponTraits: [], range: {}, reload: 0, variants: [], strike: {},
};
const daggerBackingStrike = {
  id: "strike-dagger", name: "Dagger", slug: "strike", executable: "strike", source: "strike",
  item: { name: "Dagger", uuid: "Actor.fake.Item.dagger" },
  attack: { value: 10 }, damage: { value: "1d4+2" }, damageProfile: { average: 4, type: "piercing" },
  averageDamage: 4, critical: null, traits: [], weaponTraits: [], range: {}, reload: 0, variants: [], strike: {},
};
const twinTakedownAtomFixture = {
  id: "twin-takedown-composite",
  name: "Twin Takedown",
  slug: "twin-takedown",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "multiattack",
  attackIndex: 1,
  mapPenalty: 0,
  preferredTarget: { id: "enemy-a", name: "Ogre" },
  activityProfile: {
    includes: ["strike", "strike"],
    includesStrike: true,
    multiStrike: true,
    requiresBackingStrike: true,
    requiresDualBackingStrike: true,
    backingStrikes: [sickleBackingStrike, daggerBackingStrike],
  },
};
const twinTakedownAtoms = builderAtomicActionsForStep(twinTakedownAtomFixture);
assert.equal(twinTakedownAtoms.length, 2);
assert.equal(twinTakedownAtoms[0].name, "Twin Takedown -> Sickle", "the first atom must borrow the FIRST held weapon, not one single shared backingStrike");
assert.equal(twinTakedownAtoms[1].name, "Twin Takedown -> Dagger", "the second atom must borrow the SECOND held weapon, distinct from the first");
assert.equal(twinTakedownAtoms[0].executable, "strike");
assert.equal(twinTakedownAtoms[1].executable, "strike");
assert.equal(twinTakedownAtoms[0].item?.name, "Sickle");
assert.equal(twinTakedownAtoms[1].item?.name, "Dagger");
assert.equal(twinTakedownAtoms[0].actionCost, 1, "the first atom carries the ability's full action cost, unchanged from requiresBackingStrike's existing cost redistribution");
assert.equal(twinTakedownAtoms[1].actionCost, 0, "the second atom is free");
assert.equal(twinTakedownAtoms[0].groupId, twinTakedownAtoms[1].groupId, "both atoms must share one groupId so the panel nests them under one header");
assert.equal(twinTakedownAtoms[0].atomIndex, 0);
assert.equal(twinTakedownAtoms[1].atomIndex, 1);
assert.equal(twinTakedownAtoms[0].preferredTarget?.name, "Ogre", "with no distinct-target data (both strikes hit the same target), the composite's own preferredTarget carries to each atom");
assert.equal(twinTakedownAtoms[1].preferredTarget?.name, "Ogre");

const twinTakedownWithOnlyOneHeldWeapon = {
  ...twinTakedownAtomFixture,
  activityProfile: { ...twinTakedownAtomFixture.activityProfile, backingStrikes: [sickleBackingStrike] },
};
const partialDualBackingAtoms = builderAtomicActionsForStep(twinTakedownWithOnlyOneHeldWeapon);
assert.equal(partialDualBackingAtoms[0].name, "Twin Takedown -> Sickle");
assert.equal(partialDualBackingAtoms[1].name, "Twin Takedown", "with no second held weapon found, the second atom falls back to the ability's own name, unchanged from before this task");
assert.equal(partialDualBackingAtoms[1].executable, "open-item", "with no second held weapon found, the second atom falls back to the ability's own (unrollable) executable");

const twinFeintAtomFixture = {
  ...twinTakedownAtomFixture,
  id: "twin-feint-composite",
  name: "Twin Feint",
  slug: "twin-feint",
  actionCost: 2,
  activityProfile: {
    includes: ["strike", "strike", "setup"],
    includesStrike: true,
    multiStrike: true,
    requiresBackingStrike: true,
    requiresDualBackingStrike: true,
    backingStrikes: [sickleBackingStrike, daggerBackingStrike],
  },
};
const twinFeintAtoms = builderAtomicActionsForStep(twinFeintAtomFixture);
assert.equal(twinFeintAtoms.length, 2, "Twin Feint's third 'setup' part (the off-guard condition, deliberately not automated) must not produce a phantom third atom");
assert.equal(twinFeintAtoms[0].item?.name, "Sickle");
assert.equal(twinFeintAtoms[1].item?.name, "Dagger");
assert.equal(twinFeintAtoms[0].actionCost, 2, "Twin Feint's full 2-action cost must land on the first atom");
assert.equal(twinFeintAtoms[1].actionCost, 0);

const namedBackingStrikeForHelper = {
  name: "Tentacle",
  executable: "strike",
  source: "strike",
  item: { name: "Tentacle" },
  strike: { label: "Tentacle" },
  variants: [],
  attack: null,
  damage: null,
  damageProfile: { average: 12, type: "bludgeoning", types: ["bludgeoning"], entries: [] },
  averageDamage: 12,
  critical: null,
  traits: ["reach"],
  weaponTraits: [],
  range: null,
  reload: null,
};
const mergedWithBackingStrike = backingStrikeOverrideFields(namedBackingStrikeForHelper, "Double Attack");
assert.equal(mergedWithBackingStrike.name, "Double Attack -> Tentacle");
assert.equal(mergedWithBackingStrike.executable, "strike");
assert.equal(mergedWithBackingStrike.item.name, "Tentacle");
assert.equal(mergedWithBackingStrike.averageDamage, 12);

const mergedWithoutBackingStrike = backingStrikeOverrideFields(null, "Double Attack");
assert.deepEqual(mergedWithoutBackingStrike, { name: "Double Attack" }, "with no backing strike, only the leaf name passes through");

const strideStrikeCompositeForBackingStrike = {
  id: "stride-strike-composite",
  name: "Stride -> Strike",
  slug: "stride-strike-composite",
  actionCost: 2,
  source: "generated-composite",
  role: "mobility-attack",
  activityProfile: { includes: ["stride", "strike"], includesStrike: true, strideCount: 1 },
};
const strideStrikeBackingAtoms = builderAtomicActionsForStep(strideStrikeCompositeForBackingStrike);
assert.equal(strideStrikeBackingAtoms[1].name, "Strike", "an ordinary (non-distinct-target) composite's Strike atom name must be unaffected by this task");

const grabForManeuverFix = {
  id: "kraken-grab",
  name: "Grab",
  slug: "grab",
  actionCost: 1,
  source: "system-inferred",
  executable: "open-item",
  role: "grab",
  activityProfile: { includesGrab: true, appliesCondition: "grabbed", npcFamily: "grab-rider" },
  targetingProfile: { enemy: true, reach: true },
};
const grabManeuverContext = {
  ...fighterContext,
  targets: [{ ...fighterContext.targets[0], distance: 5 }],
};
const grabManeuverScored = scoreCandidate(grabManeuverContext, grabForManeuverFix);
assert.equal(grabManeuverScored.executable, "pf2e-action", "Grab must execute as a real system action, not open-item");
assert.equal(grabManeuverScored.slug, "grapple", "Grab must resolve to the real Grapple action by slug so the executor's pf2eActionBySlug lookup finds it");
assert.equal(grabManeuverScored.skill, "athletics", "the Grapple roll needs the athletics statistic");
assert.equal(grabManeuverScored.name, "Grab", "Grab's own display name must be preserved, not overwritten to 'Grapple'");
assert.equal(grabManeuverScored.role, "grab", "Grab's own role must be preserved for other classification/gating logic");
assert.notEqual(grabManeuverScored.attackTrait, true, "Grab must not gain Grapple's attackTrait -- Grab's own rule exempts it from the multiple attack penalty");
assert.equal(grabManeuverScored.activityProfile.backingManeuver?.slug, "grapple", "the matched catalog entry should be attached for transparency, mirroring backingStrike");

const ordinaryActionForManeuverFix = { id: "strike", name: "Strike", slug: "strike", actionCost: 1, source: "strike", role: "damage", activityProfile: { averageDamage: 10 } };
const ordinaryManeuverScored = scoreCandidate(grabManeuverContext, ordinaryActionForManeuverFix);
assert.equal(ordinaryManeuverScored.activityProfile?.backingManeuver, undefined, "an ordinary action must not gain a backingManeuver");

console.log("PF2e Combater self-test passed");
