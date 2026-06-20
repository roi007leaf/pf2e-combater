# PF2e Combater Action Builder Planner Design

Date: 2026-06-20

## Goal

Change PF2e Combater from an auto-plan panel into an encounter-scoped turn builder. The module should help players and GMs see legal actions, suggested targets, and tactical hints, but the user chooses the actual plan.

The existing recommender remains useful, but it becomes secondary: it provides favorites ordering, recommended action chips, and an optional Auto-fill button.

## Product Direction

The planner is visible whenever an encounter exists, not only when the combatant's turn is active.

Players can plan only for encounter tokens they own. GMs can plan for any combatant and should have a quick way to plan upcoming NPCs after the current player combatant.

The default actor selection priority is:

1. Selected token in the encounter.
2. Combatant selected through combat tracker or panel selector.
3. Current combatant fallback.

## Panel Layout

The panel header shows:

- combatant portrait and name
- action pool state
- secondary Auto-fill button
- refresh and collapse controls

The main plan tray shows the user's draft turn:

- selected actions in order
- action-cost markers
- incomplete warnings, such as Choose destination
- remove and reorder controls
- click action name to open its item, spell, feat, or action sheet
- hover a planned movement action to preview its chosen path, when a destination exists

The old Plan, Alternatives, and Debug tabs are replaced by action-cost tabs:

- 1 Action
- 2 Actions
- 3 Actions
- Free
- Reaction

Each tab contains:

- Favorites
- Recommended
- All

Each action row shows:

- action glyph/cost
- action name
- optional source or type indicator
- recommended visible target, if any
- short reason
- favorite toggle
- add button

Unavailable rows stay visible but crossed out with a reason. Budget overflow, missing prerequisites, invalid target state, and movement restrictions should all explain why an action cannot be added.

GM debug data moves out of the normal player flow into a compact GM-only debug button or foldout.

## Action Builder Model

Add an action-builder layer between the existing engine and the UI.

Inputs:

- current combat context
- candidates from `buildCandidates`
- ranking data from scoring and planner code
- saved favorites for current user and actor
- current draft plan, if any

Outputs:

- actions grouped by cost tab
- favorites per tab
- up to three recommended actions per tab
- disabled and crossed-out state
- draft plan display model
- Auto-fill plan proposal

The existing planner no longer drives the main screen. It is used for:

- Auto-fill
- ranking recommended action chips
- target hints
- fallback when no draft exists

## Draft Plan State

Draft plans are client-side in v1.

Draft plan key:

`user id + encounter id + round + combatant id`

Each draft step stores:

- stable action key
- source item UUID, when available
- selected target token/combatant id, when chosen or suggested
- chosen movement destination, when relevant
- route summary, when available
- cached display label only as fallback; live labels are rebuilt from current action data

Refresh behavior:

- preserve draft steps when matching actions still exist
- mark stale steps instead of silently deleting them when possible
- clear draft when encounter, round, or combatant changes
- if an action becomes unavailable, keep it in the plan tray with a warning until user removes or replaces it

Favorites are stored per:

`user id + actor UUID + action key`

This supports character-specific preferences like Ezren spell choices or Nakpik crossbow routines.

## Movement Picking

Movement actions are added to the draft first. Adding movement does not immediately force canvas selection.

Incomplete movement step flow:

1. User adds Stride, Step, or other movement action.
2. Plan tray shows warning: Choose destination.
3. User clicks Choose destination.
4. Canvas enters destination-pick mode.
5. User clicks reachable grid square.
6. Step stores destination and route summary.
7. Hovering the planned movement step previews the chosen route.

Revalidation:

- if destination remains legal, keep it
- if path, speed, walls, conditions, or token position make it illegal, mark warning and keep step
- if player visibility changes, do not reveal hidden path or enemy info; show a generic unavailable warning

Movement preview should reuse existing `movement-preview` behavior where possible, but it must support explicit destinations from draft steps.

## Action Budget

The builder tracks separate pools:

- normal actions
- free actions
- reaction

Rows that exceed the remaining pool are crossed out and cannot be added.

The action pool must account for:

- normal three-action turns
- quickened extra actions, with restrictions where known
- slowed or stunned action loss
- existing movement during the round, where the module can detect it
- free actions and reactions as separate lanes

Auto-fill replaces the current draft only after confirmation when manual choices exist.

## Privacy Rules

Player-facing labels and reasons must not expose hidden information.

Player view may show:

- visible token names
- visible action names
- generic tactical hints
- known/public conditions

Player view must not expose:

- enemy AC
- saves
- resistances
- weaknesses
- immunities
- hidden traits
- hidden spell details
- invisible, undetected, or otherwise unknown target data

GM view can use full information for NPC planning.

Targeting rules still apply:

- non-area target actions skip undetected targets
- area/emanation logic can suggest area actions without naming hidden targets
- recommendations must not imply unseen enemies exist

## Access Rules

Players:

- can open planner for owned encounter tokens only
- can save favorites for owned actors
- can keep draft plans client-side

GMs:

- can plan any combatant
- can use full-intelligence NPC planning
- can inspect debug details
- can use upcoming NPC selector

## UI Interaction Details

Click action row add button:

- adds action if budget and prerequisites allow it
- if target is required and only one valid target exists, preselect suggested target
- if target needs user choice, add step with target warning

Click action name:

- opens item, spell, feat, or action detail sheet
- falls back to guidance chat/card only if no sheet exists

Drag and drop:

- supported for action row to plan tray
- reorder steps inside plan tray
- not required for first implementation if click-add and reorder controls ship first

Favorites:

- star icon per action row
- favorites appear at top of matching cost tab
- favorites still respect current availability and privacy rules

Recommended:

- up to three actions per tab
- use existing scoring
- show as suggestions only
- never auto-add except through Auto-fill

## Implementation Boundaries

New modules should keep the UI refactor contained:

- `scripts/engine/action-builder.js` for grouping, recommendations, availability, and draft display shaping
- `scripts/state/draft-plans.js` for client-side draft persistence
- `scripts/state/action-favorites.js` for favorite persistence
- `scripts/ui/destination-picker.js` for canvas destination selection
- current `CombaterPanel` and template updated to render builder UI

Existing modules should be reused:

- `buildCandidates`
- scoring rules
- safety/privacy filtering
- planner for Auto-fill only
- movement preview drawing
- sheet opening/guidance helpers

Avoid rewriting classifier/scoring logic as part of the UI pivot unless needed for builder correctness.

## Testing

Add or update tests for:

- action grouping by cost tab
- recommended actions capped per tab
- favorites sorted before all actions
- favorites keyed by user and actor
- budget overflow crossing out actions
- Auto-fill secondary behavior and manual draft confirmation
- draft preservation across refresh
- stale action warning
- owned-token access gating
- encounter-scoped planner availability
- movement step without destination
- destination pick stores draft metadata
- movement destination revalidation
- player privacy filtering
- GM full-info NPC planning still available

Manual Foundry checks:

- player owned token can plan before its turn
- player cannot plan unowned NPC/PC
- GM can plan upcoming NPCs
- Stride can be added, then destination chosen later
- hover over movement step previews chosen destination
- Auto-fill does not silently overwrite manual draft

## Out Of Scope For First Pass

- shared multi-user draft syncing
- automatic execution or rolling
- world-level favorite sharing
- full drag-and-drop parity if click-add and reorder controls are complete
- rewriting recommender heuristics beyond what builder needs

## Acceptance Criteria

- Encounter planner is available before and during a combatant turn.
- User builds a plan from cost-grouped action tabs.
- Auto-fill exists as secondary helper, not default decision maker.
- Manual draft plan survives refresh where possible.
- Favorites work per player and actor.
- Movement actions can be added before choosing destination.
- Player view does not expose GM-only or hidden target data.
- Existing recommendation intelligence remains available as hints and Auto-fill.
