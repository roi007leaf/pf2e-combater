# PF2e Combater Context

PF2e Combater plans Pathfinder 2e turns in Foundry VTT by reading actor options, battlefield state, and canvas geometry. This context names project concepts that should stay stable across code, docs, tests, and architecture work.

## Language

**Movement route**:
Plain-data description of where a token can move, what path it takes, what it costs, and whether that destination is legal under PF2e movement, elevation, collision, visibility, and token-footprint rules. It never mutates tokens; execution applies movement and owns revert data.
_Avoid_: movement preview result, destination picker data, route helper, PIXI marker, placement shape

**Token movement action**:
PF2e movement mode passed to Foundry token movement and movement-cost logic, such as `walk`, `crawl`, `fly`, or `burrow`. A Step keeps its 5-foot action budget, but uses `walk` as the token movement action.
_Avoid_: action slug, movement distance, step budget

**Token placement**:
Scene rectangle derived from a token center and grid footprint. Placement math uses token document width/height in grid units, not rendered texture dimensions.
_Avoid_: token art size, PIXI bounds, marker rectangle

**Canvas geometry**:
Plain-data math and lookup for Foundry canvas points, grid metrics, feet-to-pixel conversion, live token lookup by id/uuid, wall segments, doors, collision checks, token placement reach, and line/perimeter probing. It answers whether a path, attack line, or threat line is blocked; UI modules decide how to draw that answer and reader modules decide how to cache it.
_Avoid_: preview collision, reader wall helper, battlefield line helper, local gridSize helper, local distancePixels helper, local canvasTokenById helper

**Action requirement**:
Plain-data decision about whether a planned step needs a destination, target, or area marker before it can execute. It is shared by the panel, builder, scorer, and executor; execution performs the action but does not own these choice rules.
_Avoid_: builder destination rule, executor target rule, panel choice rule

**Execution target**:
Foundry target selection for executing a draft step. It resolves manual stored targets, ignores stale plan-phase recommendation targets, reads the current user's canvas targets, and applies token targets before PF2e actions or area effects roll.
_Avoid_: executor target helper, panel target helper, local setTarget helper, planned target writeback

**Execution movement**:
Applying a chosen movement destination or teleport destination to the live Foundry token. It validates the destination through Movement route, writes token movement through Foundry movement/update APIs, and returns revert data for movement undo.
_Avoid_: executor movement helper, movement preview execution, destination picker execution, local token waypoint helper

**Movement revert**:
Undo handling for movement ops produced by Execution movement and Teleport execution. It owns live token lookup, elevation-aware position restore, and reverse waypoint replay so multi-waypoint movement unwinds along its captured path.
_Avoid_: action-revert movement helper, local token rewind, direct executor token lookup

**Teleport execution**:
Spell-based instant repositioning for teleport actions such as Translocate. It owns destination choice validation, pre-cast origin capture, native item casting, immediate token placement, damage follow-up, and combined chat/slot/movement undo data.
_Avoid_: executor teleport helper, inline teleport spell cast, local teleport undo builder

**Execution result**:
Plain-data patch and revert-envelope shape produced by a completed or failed execution branch. It records execution status, result/error text, and undo ops without knowing which action produced them.
_Avoid_: local executionPatch helper, local revert envelope helper, branch-specific patch shape

**Document revert**:
Undo handling for Foundry documents created during execution. It owns chat message deletion, Region deletion, linked area timer effect deletion, and idempotent skip checks when another cleanup path already removed the document.
_Avoid_: action-revert chat delete helper, local region cleanup, local timer effect cleanup

**Execution state**:
Plain-data draft execution workflow state. It owns action fallback merge, readiness checks for destination/target/area choices, next pending step selection, and resetting execution progress without dropping planned choices.
_Avoid_: executor readiness helper, panel pending-step helper, revert draft reset helper

**Chat revert execution**:
Plain-data undo envelope shaping for chat-producing execution branches. It owns ChatMessage id extraction, consumable/frequency revert ops, spell-slot fallback ops, and manual-warning text for effects that cannot be auto-undone.
_Avoid_: executor chat revert helper, local chat message id parser, branch-specific manual warning builder

**Equipment execution**:
Foundry item carry/ammo execution for draw, drop, sheathe, and reload draft steps. It changes PF2e item carry state, attaches compatible ammunition through system APIs when available, posts reload reminders when not, and returns revert data for item-state undo.
_Avoid_: executor weapon helper, local reload helper, carry-state patch, ammo attach helper

**Item resource revert**:
Undo handling for item resource ops produced by equipment and native item execution. It owns carry-type restore, consumable quantity/use restore or recreation, frequency value restore, and reload subitem detachment.
_Avoid_: action-revert carry helper, local consumable restore helper, local reload detach helper

**Execution guidance**:
Chat or notification reminder posted when an execution branch needs user or GM follow-up instead of fully resolving through a Foundry API. It owns safe reminder rendering; action-specific branches decide when guidance is needed.
_Avoid_: local guidance chat helper, branch-specific reminder renderer, inline reminder HTML

**Condition execution**:
Foundry/PF2e condition mutation used by execution and revert flows. It owns Stand, Drop Prone, Retch save/result handling, and condition undo helpers so executor branches and revert ops do not each learn actor condition APIs.
_Avoid_: executor prone helper, local Retch adjudication helper, revert condition helper

**Native item execution**:
PF2e item, spell, consumable, and feat dispatch through native Foundry/PF2e document APIs. It owns default native action execution, spellcasting-entry lookup, slot revert capture, consumable/frequency revert data, item macro/use/consume/cast/toMessage fallback order, open/guidance fallback when no native action runs, failed-cast result shaping, and damage follow-up after a posted card.
_Avoid_: executor item-use helper, local spell-slot snapshot, local consumable undo helper, local failed-cast branch, action-revert spellcasting lookup

**Spell slot revert**:
Undo handling for spell slot expenditure recorded by Native item execution. It owns spellcasting-entry lookup, prepared spell identity matching, prepared expended-state restore, slot-pool restore, and manual warnings when the slot cannot be restored automatically.
_Avoid_: action-revert spellcasting lookup, local prepared-slot matcher, local slot-pool restore

**Damage execution**:
Automatic PF2e damage rolling after an executed item/spell/card posts its primary chat message. It owns DamageRoll construction, parsed or inline `@Damage` formula fallback, PF2e/Toolbelt damage context flags, multi-action damage counts, and chat ordering so damage messages sort after the source card.
_Avoid_: executor damage helper, local DamageRoll wrapper, inline damage-message flags, local chat flush helper

**System action execution**:
PF2e system action API dispatch for generic actions such as Grapple, Trip, Create a Diversion, Raise a Shield, and Take Cover. It owns target choice/application, slug-to-action lookup, legacy camelCase action fallback, variant choice/defaulting, target actor forwarding, skill/DC/trait options, non-strike MAP penalties, result patching, and chat revert data.
_Avoid_: executor pf2e action lookup, local action variant helper, local system-action target wrapper, local system-action MAP option

**Strike execution**:
PF2e Strike dispatch for attack steps. It owns target selection, MAP variant choice, PF2e Strike roll invocation, failed Strike API reporting, and chat revert data for the posted attack card.
_Avoid_: executor strike helper, local MAP variant helper, local strike roll wrapper

**Area execution**:
Execution-time setup for area actions after target selection. It owns explicit and auto-resolved area markers, token-attached emanation creation, Region fallback creation, timer effect creation, area timer flags, in-area token targeting, and the policy for whether an area template persists after execution.
_Avoid_: executor region placement, local area marker auto-resolution, local area timer helper, local in-area targeting, local template persistence policy

**Area region**:
Plain-data Foundry Region shape and hit-testing model for an area marker. It converts PF2e area shape/range/width plus a chosen marker into region data and token-in-area results; area picking chooses the marker and execution creates the region.
_Avoid_: executor region helper, picker shape clamp, panel area target helper

**Scored area placement**:
Plain-data placement choice for area actions during scoring. It estimates which enemies/allies a burst, emanation, cone, or line can affect, avoids blocked cast lines, and returns placement center/aim points for draft area markers; scoring owns the score deltas/reasons that use that result.
_Avoid_: scoring area helper, local cone placement math, inline burst target picking, area score placement

**Scoring tactics**:
Tactical scoring orchestrator for a candidate action after hard gates and target choice. It owns suggested-target display refs, generic action slug scoring, Strike scoring, condition/recovery slug scoring, area hit metadata aggregation, and spellcaster fallback preference; Scoring role tactics owns curated role blocks, Scoring activity tactics owns activity-profile tactic scoring, and scoring orchestrates class/NPC/spell adjustments, skill reliability, hidden-target discount, backing action metadata, and final sanitation.
_Avoid_: scoring profileSpeed helper, local strikeDamageScore helper, inline suggestedTargetFor in scoring.js, inline curated role score block, inline area-damage role block, inline buff role block, inline activity-profile tactic block

**Scoring role tactics**:
Curated role score composition for recognized actions. It owns healing, damage, weapon-draw, debuff, setup, mobility, drain, self-healing, resource recovery, transformation, area damage, save damage, grab, control, reaction attack, defense, buff, stealth-defense, summon, and utility role score/reason blocks plus role-owned area placement metadata.
_Avoid_: scoring-tactics area-damage block, scoring-tactics buff block, scoring-tactics defense block, scoring-tactics role utility penalty, inline curated role score branch

**Scoring activity tactics**:
Activity-profile score composition for movement-plus-action tactical candidates. It owns Sudden Charge reach scoring, move-and-strike threat exposure, flank setup, GM-only skirmish preference, stride-through save/damage reach, focused strike, and multi-strike reach scoring.
_Avoid_: scoring-tactics sudden-charge block, scoring-tactics move-and-strike block, scoring-tactics flank/skirmish block, scoring-tactics multiStrike block, duplicated attackCenter helper

**Scoring tactic helpers**:
Shared helpers for Scoring tactics and Scoring role tactics. It owns base scores, default reasons, stand detection, self/ally emergency lookup, profile reach/speed math, movement reach math, corpse lookup, plural choice, and curated-action detection.
_Avoid_: local profileReach helper, local baseScore helper, local defaultReason helper, local isCurated helper, duplicated dyingAlly lookup

**Scoring facts**:
PF2e fact extraction used by scoring: action traits, range predicates, damage averages/types, target defenses, save odds, HP percentages, conditions/effects, spellcasting capability, and GM-only defense visibility. It owns reusable scoring-side facts; scoring owns final score composition and reasons.
_Avoid_: scoring actionTraitSlugs helper, local damageAverage helper, local save odds helper, local hasCondition helper, local target-defense parser, duplicated range predicate

**Scoring buffs**:
Buff and support-action recipient valuation used by scoring. It owns active buff keys, quickened-grant detection, martial/spellcaster recipient classification, duplicate-buff penalties, and best self/ally recipient choice; scoring consumes its selected recipient and score signals.
_Avoid_: scoring activeBuffKeys helper, local bestBuffRecipient helper, local class recipient set, local quickened buff detection, duplicated already-has-buff check

**Scoring gates**:
Hard rejection decisions used by scoring before positive score composition. It owns impossible/no-target action results, redundant Channel Elements and range-buff checks, target-mark rejection messages, and out-of-range Strike rejection; scoring consumes either a blocked result or continues composing score.
_Avoid_: scoring no-target return block, local kineticAuraActive helper, local Channel Elements gate, duplicated no-spell-needs-range check, inline blocked action result

**Scoring skills**:
Skill-action reliability used by scoring. It owns trained-skill setting enforcement, actor skill entry parsing, target DC skill odds, and actor-side Athletics reliability penalties; scoring consumes the resulting requirement or score deltas.
_Avoid_: scoring skillEntry helper, local skill DC slug switch, local trained-skill requirement, duplicated Athletics reliability penalty

**Scoring spells**:
Spell-action valuation used by scoring. It owns cantrip/focus/ranked spell resource adjustments, sustained/lasting spell value, terrain-control spell value, range-buff setup detection, and reach-spell need checks; scoring consumes its score deltas and setup gate.
_Avoid_: scoring spellTacticalAdjustment helper, local rangeBuffIsNeeded helper, duplicated Reach Spell target reach check, inline spell resource penalty

**Scoring targets**:
Target selection used by scoring. It owns attackable enemy pooling, target affectability checks, best target selection, distinct multi-target selection, and kineticist Extract Element target compatibility; scoring consumes its selected target(s) and keeps final score/reason composition.
_Avoid_: scoring target pool helper, local bestTargetForAction helper, local kineticist element profile, duplicated Extract Element compatibility check

**Backing strike**:
Real Strike option borrowed by a composite action such as Sudden Charge, Flurry of Blows, Hunted Shot, or Twin Takedown. It selects from already-read Strike options and may apply weapon-class presets; it does not read actor actions itself and does not execute the Strike.
_Avoid_: scorer strike reader, borrowed weapon helper, composite strike patch

**Sustained spell**:
Active spell effect/template that may need a Sustain a Spell step or end-of-turn cleanup. It combines read spell actions, active effects/templates, draft sustain state, and cleanup prompts; it is turn-planning workflow, not class tactic or PF2e rule scoring.
_Avoid_: sustained-spells rule file, sustain UI helper, cleanup prompt helper

**Sustained spell execution**:
Execution-time handling for a chosen Sustain a Spell step. It owns stored spell UUID lookup, actor spell slug fallback, chat-card re-posting, fallback guidance when no spell document can be posted, and chat revert data for the sustain step.
_Avoid_: executor sustain helper, local sustained spell lookup, inline sustain reminder

**Foundry data**:
Small Adapter for Foundry/PF2e document shapes: Collections, Maps, iterable embedded collections, `contents`/`placeables` arrays, token/entity stable identity keys, actor typed item collections with fallback `actor.items` de-duplication, and system data objects that wrap primitives in `.value`. It prevents reader, engine, rule, state, and UI Modules from each re-learning Foundry container quirks.
_Avoid_: local collectionValues helper, local systemValue helper, local targetKey/entityKey helper, local actorItems helper, PF2e data unwrap helper

**Action text**:
Plain-text parsing for action names, slugs, and PF2e action-count phrases. It is shared by action reading, spell reading, scoring, action budget, execution, sustained spell cleanup, and dev coverage; it does not read actors, classify actions, or score tactics.
_Avoid_: action-reader slug helper, spell-reader text parser, local action-count text parser, scorer slug helper, executor slug helper

**Action builder projection**:
Pure builder-side projection for drafted destinations and computed area markers. It owns area-marker shaping from scored placement, draft destination origin projection, projected target distances, draft condition changes, and projected Raise a Shield/Shield spell combat state; the action builder only decorates tabs and draft rows.
_Avoid_: action-builder computeAreaMarker helper, local projectContextForDraftDestination helper, local draft condition projection, local area marker projection, duplicated projected target distance math

**Planner rules**:
Turn-planning prerequisite and target-link rules used before DFS plan enumeration accepts a step. It owns attack action facts, current attack range, previous-action requirements, target identity/condition matching, target inheritance, NPC grab-rider validation, and target-condition plan score bonuses; Planner projections owns projected sibling generation and projected movement scoring, Planner conflicts owns pair-legality checks, while planner owns candidate pool selection, DFS enumeration, and final plan ordering.
_Avoid_: planner previous-action helper, planner targetForCandidate helper, planner currentAttackRange helper, planner targetConditionChainBonus helper, local attack fact helper

**Planner conflicts**:
Turn-planning pair-legality rules for DFS plan enumeration. It owns basic movement repeatability, repeated Stride allowances, stand/crawl/prone-cover exclusivity, prone-plus-attack and prone-plus-movement conflicts, move-and-strike plus generic movement conflicts, retreat-before-melee conflicts, Lingering Composition plain-cantrip exclusion, already-in-range movement waste checks, and Sudden Charge/Tumble Through pairing rules.
_Avoid_: planner hasPlanConflict helper, planner reachesCurrentTarget helper, planner targetNeedsRepeatedStride helper, local prone movement conflict helper, inline melee-after-retreat conflict

**Planner projections**:
Turn-planning candidate expansion and projected-position scoring. It owns follow-up Strike candidate synthesis after move-and-strike actions, Take Cover after Drop Prone synthesis, Quickened Casting spell discount siblings, Lingering Composition extension siblings, projected follow-up reach checks, projected Volley penalties, and prone/move-and-strike facts used by those projections.
_Avoid_: planner projected Strike helper, planner Quickened Casting sibling helper, planner Lingering Composition sibling helper, planner projectedVolleyPenalty helper, planner projectedFollowUpSatisfied helper

**Item action reader**:
Reader-side interpretation of PF2e item action costs and item usability. It owns item `actionCost` getters, `system.actionType/actions`, Activate text fallback, consumable held-draw surcharge, item availability gates, activatable item type filtering, and impulse/overflow item trait profiles; action reading composes those facts into generated combat actions.
_Avoid_: action-reader activation parser, local item availability helper, local consumable draw surcharge, local item trait profile, local activatable item type set

**Weapon action reader**:
Reader-side synthesis of weapon utility actions. It owns weapon collection fallback, drawability/held checks, draw-to-Strike target choice, Draw, Sheathe, Release, Reload, reload-0 handling, and loaded-ammo suppression; action reading only decides where these actions sit in the full action list.
_Avoid_: action-reader weapon range helper, local draw weapon helper, local reload action helper, local held weapon helper, inline draw-to-Strike target choice

**Action reader helpers**:
Small shared reader-side helpers for profile extraction, condition checks, movement blocking, movement range/reach, and de-duplicated attackable target lists. They are reusable facts for action readers; they do not synthesize combat actions.
_Avoid_: action-reader contextProfile helper, local movementBlockingCondition helper, local hasCondition helper, local uniqueTargets helper, duplicated prone movement gate

**Positional tactic reader**:
Reader-side orchestrator for movement-position tactics. It composes the positional stride reader, positional retreat reader, positional flank reader, and positional kite reader, then returns inferred mobility actions to action reading.
_Avoid_: action-reader stride-strike helper, inline flank plan, local skirmish/kite plan, local ranged retreat action builder, positional tactic family implementation in the orchestrator

**Positional tactic helpers**:
Shared reader-side facts for positional tactic families. It owns Strike melee reach, ranged Strike reach/classification, and average-damage extraction used to compare ranged finishers with melee options.
_Avoid_: duplicated isRangedStrike helper, duplicated strikeMeleeReach helper, local positional average-damage helper

**Positional stride reader**:
Reader-side synthesis of Stride -> Strike and Stride -> multiattack tactics. It owns stand-before-move handling, one/two Stride reach plans, backing-strike multiattack wrapping, attack centers, and move-prefix action shaping.
_Avoid_: positional tactic orchestrator stride plan helper, local stride-multiattack plan, duplicated Stand -> Stride -> Strike builder

**Positional retreat reader**:
Reader-side synthesis of ranged retreat and return-to-cover skirmish tactics. It owns Stride Away -> ranged Strike, Visioner cover-state checks, return-to-origin cover skirmish plans, threat reach avoidance, and retreat attack-center selection.
_Avoid_: positional tactic orchestrator ranged retreat helper, local Visioner cover skirmish plan, duplicated retreat-square sorting

**Positional flank reader**:
Reader-side synthesis of flank setup movement. It owns large-target flank geometry, ally threat checks, valid flank square selection, flank destination prefill, and off-guard setup metadata.
_Avoid_: positional tactic orchestrator flank plan, local flanksTarget helper, inline large-target flank rectangle math

**Positional kite reader**:
Reader-side synthesis of skirmish/kite tactics for fragile or ranged-primary actors. It owns action-budget checks, ranged spell/Strike finisher selection, melee opener inclusion, threat-reach retreat square selection, and kite action shaping.
_Avoid_: positional tactic orchestrator skirmishKitePlan helper, local ranged finisher selection, local low-HP kite heuristic

**Elemental blast reader**:
Reader-side synthesis of kineticist Elemental Blast actions. It owns kineticist blast flag discovery, element configs, selected damage types, action-cost variants, blast labels, melee/ranged blast candidates, and coarse average damage estimates; action reading only inserts returned blast actions and asks whether the PF2e item action should be suppressed.
_Avoid_: action-reader elementalBlastConfigs helper, action-reader selectedElementalDamageType helper, local elemental blast label helper, inline kineticist blast candidate builder

**Defense action reader**:
Reader-side defense and recovery gating for generated/item actions. It owns Shield Block availability, Shield spell reaction synthesis, raised-shield and Shield spell effect detection, and spell-resource recovery availability; action reading only asks for those gates while building candidate rows.
_Avoid_: action-reader shieldEffectEntries helper, action-reader shieldSpellDefenseActive helper, action-reader hasExpendedSpellResource helper, inline Shield spell block reaction builder

**Generic action reader**:
Reader-side synthesis and gating for PF2e generic catalog actions. It owns generic action row construction, GM/player hiding for player-facing actions, exploration/combat relevance filtering, movement-blocking gates, target/range/free-hand/object/terrain/cover gates, Seek target visibility checks, Demoralize immunity checks, and Tumble Through opportunity checks; action reading only asks for catalog actions, movement availability, and generic item-action availability.
_Avoid_: action-reader isGenericAvailable helper, action-reader readMovementAvailability helper, local Seek gate, local Tumble Through gate, local object/cover/terrain gate, inline exploration-action combat filtering

**Action reach**:
Reader-side reach and movement geometry used to decide whether a Strike or move-and-strike tactic can actually reach a target this turn. It owns cached wall collision, per-build reachable-square caches, attack perimeter checks, return-to-origin checks, and threat-distance helpers; action reading decides what PF2e action to synthesize from those answers.
_Avoid_: action-reader collision cache, local reachable squares helper, stride-strike BFS, local attack path helper, inline threat reach math

**Panel view model**:
Plain-data display shape for the Combater panel and browser. It owns action cost glyphs, item images, range and target labels, draft step execution badges, MAP grouping, sustained-spell rows, action search sections, and merged search results; panel classes own events, persistence, pickers, and execution.
_Avoid_: panel decoration helper, local template data helper, inline action display fields, browser row formatter

**Panel draft helpers**:
UI-side draft helper logic for Auto-fill atom preparation, projected draft action lookup, draft step ids, and movement guards before rows enter the Combater panel draft. It owns draft helper calculations; Panel draft workflow owns draft mutations and Auto-fill assembly, and the panel class owns user events, picker/execution wrappers, and rendering.
_Avoid_: CombaterPanel draft lookup helper, local projectedDraftStepActions helper, local auto-fill movement guard, local draftStepId helper, inline projected action matching

**Panel draft workflow**:
UI-side draft mutation workflow for the Combater panel. It owns active draft read/write, manual add/uncounted/sustain actions, remove/duplicate/reorder, MAP/movement/weapon cycling, favorite changes, Auto-fill and fill-gap assembly, action-key rematching, and player-plan sync to the GM; the panel class owns event wiring, state fields, picker/execution wrappers, and rendering.
_Avoid_: CombaterPanel add action implementation, CombaterPanel auto-fill assembly, CombaterPanel syncDraftToGM body, local draft mutation socket sync, inline favorite reorder handler

**Panel picker workflow**:
UI-side choice workflow for draft destination, target, and area selection. It owns canvas destination picker setup, hover/waypoint preview restore, Foundry target capture, area template choice/removal, range overlay handling, and auto-targeting tokens inside placed areas; the panel class owns event wiring, draft persistence primitives, and rendering.
_Avoid_: CombaterPanel destination picker implementation, local currentTargetSelection in panel, local chooseAreaMarker wiring, inline area token hit-testing, duplicated waypoint preview restore

**Panel execution workflow**:
UI-side draft execution workflow for selected draft steps. It owns Sustain a Spell choice, execution readiness gating, action executor invocation, Retch GM/socket adjudication, execution result persistence, per-step revert, and full execution reset; the panel class owns event wiring, draft persistence primitives, and rendering.
_Avoid_: CombaterPanel executeDraftStep implementation, local Retch GM prompt flow, local revertDraftExecution call, inline execution result patch persistence

**Panel event bindings**:
UI-side render listener setup for the Combater panel. It owns DOM selector binding for plan-side buttons, draft drag reorder wiring, Auto-fill cycling context menu, execution/picker button events, action preview hover events, and position-save pointer events; the panel class owns render lifecycle, state, and workflow wrappers.
_Avoid_: CombaterPanel render selector loops, inline draft drag listeners, inline auto-fill cycle contextmenu handler, inline preview hover bindings

**Panel context workflow**:
UI-side combat-context and render-context preparation for the Combater panel. It owns selected combatant context reads, shared player draft mirror/read-only decisions, active-player ownership checks, projected planning contexts, builder model construction, sustained spell/movement/weapon option attachment, Auto-fill display context, and debug render context shaping; the panel class owns lifecycle and workflow wrappers.
_Avoid_: CombaterPanel _prepareContext body, CombaterPanel _viewContext body, inline player-owner detection, inline shared-draft mirror decision, local builder model decoration

**Target pool**:
Plain-data view of the current target, enemy, and ally lists from a combat context. It handles the module's fallback shapes (`context.targets`, `context.enemies`, `context.allies`, `context.battlefield.targets`, `context.battlefield.enemies`, `context.battlefield.allies`), display-safe target references, self references, detection state, attack eligibility, and small range queries over those lists.
_Avoid_: local contextTargets helper, spell-reader range helper, action-reader enemy pool helper, scorer ally fallback helper, local targetRef helper, local actorTarget helper, local canAttackTarget helper, local detectionState helper

**Actor context**:
Small Adapter that extracts a real Foundry Actor document from the different context shapes the module passes around (`context.actor.document`, combatant actor, actor object, or actor itself). It keeps readers, scoring, execution, and cleanup from each guessing the actor shape.
_Avoid_: local contextActor helper, local actorDocument helper, actor document fallback chain
