# Changelog

## [1.2.1]

### Fixed

- **NPC reloadable weapons now keep their loaded state between plans.** Combater keys each attack
  to its PF2e linked weapon, treats untracked weapons as initially loaded, marks them unloaded after
  a successful Strike, and makes Browse and Auto-fill offer Reload only when it is needed. Reload
  and Strike state changes participate in conflict-safe Undo, while PC weapons retain PF2e's native
  ammunition handling.

## [1.2.0]

### Added

- **Area Placement 2.0 now offers up to three ranked tactical placements.** Bursts search legal grid
  centers within casting range, while cones and lines sweep their possible directions. Placement
  scoring respects walls, creature footprints, friendly fire, visible targets, and disclosed PF2e
  defenses and damage adjustments. An `AOE 1/3` control cycles the offered locations directly on the
  plan row, while manual placement remains available.
- **Movement steps now offer up to three recommended landing locations.** Recommendations use the
  selected tactical route goal and include any required corner waypoints. The destination control
  cycles forward on click and backward on right-click without reopening the canvas picker.
- **Turn Intent controls now constrain Auto-fill and Shuffle for the current turn.** Players can lock
  selected targets, require a specific action, forbid ranked spell slots, stay at range, end in cover,
  or preserve their final action. Intent is displayed in the panel header and resets automatically
  when the combatant, round, or turn changes.
- **Loadout Advisor now recommends battlefield-aware equipment swaps.** It compares currently held
  weapons and shields with drawable gear using target distance, known defenses and damage responses,
  expected weapon damage, reload, occupied hands, nearby threats, and current HP. Each recommendation
  explains its fit score on hover and can add the exact legal Swap Items choice to the plan.
- **Effect Clock now collects PF2e timing events in one turn-aware view.** Finite and encounter-long
  effects are grouped by urgency using PF2e's native remaining duration, while persistent damage and
  Frightened expose their normal turn-end events. The header reports urgent events, effect names open
  their native sheets, and player views omit hidden effect information.

### Changed

- **Sustained spells and Effect Clock now have separate responsibilities.** The existing Sustained
  spells section remains the single place to see active sustained casts and add Sustain a Spell,
  while Effect Clock focuses on timed effects, conditions, and turn-boundary reminders. Sustained
  spell names are now clickable and open their native PF2e spell sheets.
- **Interactive panel planning now avoids repeated exhaustive searches.** Auto-fill alternatives and
  remaining-budget continuations are cached for the current target, intent, resource horizon, and
  projected plan state. Interactive refreshes skip Browse-only coverage backfills and redundant
  projected searches, while Browse still retains exhaustive legal-action coverage.

### Fixed

- **Non-area sustained spells now create a native PF2e tracking effect when successfully cast.**
  Summons such as Phantasmal Minion retain their exact spell identity, appear in the Sustained spells
  section on later turns, avoid duplicate trackers when an area already created one, and remove the
  created effect through Safe Undo.
- **Auto-fill, Shuffle, Remove, target, route, and equipment controls no longer stall on duplicate
  planner work.** Local draft writes suppress their own actor-update echo, panel-only renders reuse
  prepared candidates and plans, and gap filling recalculates only when its real tactical inputs
  change.
- **A single recommended area placement no longer hides the AOE control.** Rows with one valid
  recommendation show `AOE 1/1`, allowing the preferred placement to be restored after manual edits.
- **Effect Clock no longer repeats valued condition names.** Frightened now displays once as, for
  example, `Frightened 1` instead of `Frightened 1 1`.

## [1.1.11]

### Added

- **Planner quality now has a deterministic scenario lab.** Martial turns, condition setup/payoff,
  low-confidence quarantine, shared resources, wide candidate pools, and alternative diversity run
  through the real planner and report coverage, completeness, search cost, and exact failures in
  human-readable or JSON form.
- **Auto-fill now has Conserve, Normal, and Burst resource horizons.** The selected mode changes how
  plans value cantrips, focus points, ranked spell slots, consumables, innate uses, and limited
  encounter/daily abilities using remaining uses and current encounter pressure. Normal preserves
  the existing tactical scores.
- **Strides now offer tactical route goals.** Cycle each movement step between Approach, Shortest,
  Safest, Seek Cover, Flank, and Escape. Route previews score exposure across the full path while
  Foundry and PF2e remain responsible for final measurement and movement execution.
- **Installed-version compatibility now has its own smoke test.** The test checks the local Foundry
  v14 and PF2e runtime contracts used for movement, actions, spells, slots, and item macros before a
  release.
- **Authenticated engine checks now have a safe live runner.** It verifies the loaded PF2e action and
  socketlib GM round trip, while a GM-only opt-in check measures and executes multi-waypoint movement,
  observes movement hooks, history, and regions, then restores the token through recorded Undo.

### Changed

- **Safest, Seek Cover, and Escape routes now measure exposure by movement segment.** Long,
  diagonal, and difficult-terrain segments under melee threat or open enemy lines count
  proportionally, while compressed and detailed representations of the same route produce the same
  score.
- **Movement now uses Foundry v14's native movement transaction from preview through Undo.** A route
  is measured by PF2e, executed once with a stable movement ID, recorded in Foundry's movement
  history, and reverted through that same native history instead of rebuilding token movement.
- **Auto-fill planning is safer and more varied.** Normalized action facts prevent uncertain actions
  from being automated unless an exact rule explicitly trusts them. Planner search now removes
  equivalent states, fills incomplete turns, explores useful tail actions, and preserves tactically
  different alternatives instead of returning near-duplicate plans.
- **Every action source now passes through ActionFacts v2 before planning or scoring.** One immutable
  representation normalizes attack/check/save resolution, critical-failure risk, targets, range,
  areas, conditions, movement, duration, action/resource cost, sequencing, classification confidence,
  and Auto-fill safety. Requirements, native preflight, scoring, resource policy, and planner rules no
  longer reinterpret those raw classifier fields independently.
- **Auto-fill now carries one projected turn state through search and manual gap filling.** Position,
  MAP, Strike count, actor and target conditions, shield state, effect durations, and shared
  resources advance together. Search pruning compares that full state instead of treating plans
  with different tactical consequences as equivalent.
- **Displayed PF2e odds and Auto-fill scoring now share the same native Roll Context result.** Only
  disclosed results influence ranking, approximate revealed information receives reduced weight, and
  the adjustment stays bounded so tactical value remains primary. Ranking now values all four PF2e
  degrees, including critical hits, basic-save damage, stronger critical failures on save effects,
  risky skill-action critical failures, and incapacitation's native one-degree shift.
- **Foundry/PF2e integration now passes through one runtime adapter.** Version-sensitive movement,
  action, spell, slot, and item-macro access is centralized and contract-tested against Foundry
  14.361-14.364 and PF2e 8.3.0.

### Fixed

- **Auto-fill no longer spends the same last resource multiple times in one simulated turn.** Planner
  search now reserves shared spontaneous/flexible spell slots, focus points, prepared copies,
  consumable stacks/uses, innate uses, and frequency-limited abilities. Manual draft steps reserve
  first when Auto-fill completes the remaining action budget. Flexible prepared entries now also
  read PF2e's shared slot values instead of looking for fixed prepared copies.
- **Gap filling no longer resets combat state after a manually planned action.** Existing draft
  Strikes seed MAP and the per-turn Strike cap, while the last action and projected target conditions
  remain available to legal immediate follow-ups before Auto-fill searches the remaining actions.
- **Enemy conditions no longer leak onto the acting creature during draft projection.** Trip,
  Grapple, Demoralize, and other targeted effects update their selected target; self effects such as
  Drop Prone, Stand, Escape, Raise a Shield, and Shield remain on the actor.
- **Undo no longer overwrites newer movement or resource changes.** Before restoring movement,
  item uses, frequencies, or spell slots, Combater verifies that current state still matches what it
  produced. Conflicts preserve the newer state and leave a recovery warning on the plan step.

## [1.1.10]

### Changed

- **Action builder and tactical scoring code are now organized into smaller, focused modules.** The
  action builder is split into dedicated modules for tab/draft assembly, area/destination
  projection, and composite-action atomization instead of one large file, and the retch decision
  dialog now lives alongside the module's other GM dialog helpers. Per-role, per-slug, and
  per-class tactical scoring now dispatch through lookup tables instead of long sequential checks.
  These are internal reorganizations verified to produce identical Auto-fill and Browse behavior.

## [1.1.9]

### Added

- **Swap Items is now available in Browse as a single Interact action.** When the actor has both a
  held physical item and a worn weapon, shield, piece of equipment, or consumable, the player can
  choose which item to put away and which one to draw. The swap updates both items atomically,
  restores the original item if drawing fails, and supports Undo without entering Auto-fill.

### Changed

- **Class and subclass tactic definitions are now easier to keep consistent.** Repeated tactical
  profiles now expand from shared templates for Animist apparitions, Barbarian instincts, Druid
  orders, Exemplar epithets, Oracle mysteries, Psychic minds, Sorcerer bloodlines, Summoner
  eidolons, Witch patrons, and Wizard schools while preserving their existing tactical weights.
  Specialization labels across Alchemist, Barbarian, Bard, Cleric, Druid, Inventor, Investigator,
  Kineticist, Ranger, Rogue, Swashbuckler, and Thaumaturge were also normalized to cleaner,
  consistently capitalized names.
- **Auto-fill performs less repeated tactical work.** Best-target ranking now calculates each
  target's defense and offensive value once per sort, and automatic NPC tactic-personality
  inference is reused throughout the same planning context instead of rescanning the actor's kit
  for every action/target combination.
- **Boss-role Auto-fill now stays focused on the boss's own combat kit.** Generated Boss plans
  exclude skill actions such as Demoralize, Recall Knowledge, Seek, Feint, and Athletics maneuvers,
  favoring owned boss actions, spells, and normal attacks instead. Skill actions remain available
  in Browse for deliberate manual selection.
- **Shared planning behavior now comes from common helpers and constants.** Hard-rejection scores,
  Multiple Attack Penalty values, slug and numeric normalization, minion-step naming, and movement
  option handling were consolidated so scoring, execution, movement, and minion-plan UI paths use
  the same rules. Normal-plan and uncounted-action insertion now share the same composite-action
  atomization path while retaining their separate permissions and action-budget behavior.
- **Project documentation now describes the current planner in depth.** The README was expanded
  with current Auto-fill and Shuffle behavior, spell items, composites, favorites, uncounted
  actions, Recall Knowledge and misinformation, preference learning, roll-context previews, Best
  target, execution/undo, player/GM workflows, tactic weighting, settings, and worked examples.
- **Package metadata now matches the project.** The npm package declares the GPL-3.0 license and a
  concise PF2e Combater description, with its development dependency list normalized.

### Fixed

- **Battle Medicine and Bon Mot now choose only legal tactical targets.** Battle Medicine explicitly
  targets the actor or an ally, while Bon Mot targets enemies and enforces its 30-foot range when
  Auto-fill and Best target select a recipient.
- **Auto-fill no longer double-counts several tactical bonuses.** Sudden Charge uses the shared
  move-and-Strike scoring path once; debuffs no longer receive a second unconditional target bonus;
  and buffs or stealth defenses no longer reapply recipient value and already-active penalties that
  were already included by recipient scoring. This prevents those options from crowding out better
  plans for inflated reasons.
- **Undo warnings remain visible on the reset plan step.** If an executed effect needs manual
  cleanup or a revert operation fails, the warning is stored on the pending step after Undo instead
  of disappearing when the notification closes; the step can still be executed again.
- **Player-facing Best target explanations no longer include GM-only aggro reasons.** Aggro role
  details are now added only when the resolved aggro profile is explicitly GM-only, keeping player
  explanations limited to information they are allowed to use.
- **Movement-region coordinate handling is more defensive.** Missing or malformed region points
  are normalized before geometry checks instead of propagating invalid numeric values into movement
  cost calculations.
- **Reload 1 weapons can no longer fire consecutive shots without reloading.** PF2e generated Strike
  placeholders now defer to the backing weapon's real reload value, so pistols and similar weapons
  plan and display repeated attacks as Strike, Reload, Strike.
- **Move-and-Strike activities now account for their own movement before adding separate Strides.**
  Boar Charge is preserved as two intrinsic Strides followed by its tusk Strike instead of appearing
  as one Stride or being replaced by standalone movement. Rush and similar activities can gain one
  preceding Stride when their built-in movement alone cannot reach, while keeping correct action
  costs and grouped rows.
- **Twin Takedown now requires two distinct held melee weapons.** Worn unarmed attacks, ranged
  weapons, and missing second weapons no longer satisfy its requirement, and an unavailable Twin
  Takedown cannot leave misleading indented fallback actions in the plan.
- **Free-hand combat maneuvers now respect what the actor is holding.** Disarm, Trip, Grapple,
  Reposition, and Shove are unavailable when both hands are occupied, including by a two-handed
  weapon. Valid PF2e alternatives still work, such as a held weapon with the matching maneuver trait
  or Reposition against an already grabbed or restrained target.
- **High-risk attack-trait skill actions are now attempted before later attacks.** Disarm, Trip,
  Grapple, Reposition, and Shove are ordered ahead of ordinary follow-up Strikes so their major
  critical-failure consequences are not made worse by an unnecessary Multiple Attack Penalty.
- **Tiny creatures now correctly use 0-foot melee reach.** Explicit zero reach is preserved through
  actor and Strike reading, scoring, movement planning, previews, and execution; a Tiny attacker can
  route into and share its target's square instead of being treated as if it had 5-foot reach.
- **NPC shields now enable Raise a Shield planning.** Held PF2e shield data is recognized for NPCs,
  allowing Auto-fill to spend a suitable remaining action on Raise a Shield while broken or
  destroyed shields remain ineligible.
- **Hazards and loot no longer open or appear in Combater.** Active turns, controlled tokens,
  player-owned combatant lookup, panel opening, planning contexts, and target pools consistently
  skip non-plannable actor types.
- **GMs can now open Combater outside an active encounter.** Selecting a plannable scene token and
  using the token toolbar or keybind opens a full exploration planning context with zero spent
  actions and other scene tokens available as tactical targets. Switching controlled tokens updates
  the open panel, while players remain limited to active encounters.
- **NPC two-action save abilities now retain their real targeting and remain usable by Auto-fill.**
  Foundry's `@Check[type:will|dc:...]` syntax is recognized, recharge dice are no longer mistaken for
  attack damage, and single area templates are preserved. Self-centered emanations such as Funereal
  Dirge now automatically create the correct actor-centered template without a target or manual
  template button.

## [1.1.8]

### Fixed

- **Single-target save spells now auto-target like Strikes.** If a save cantrip or spell row has a
  selected target, execution now applies that token as the active Foundry target before PF2e casts
  the spell, so the spell card/roll uses the same target shown by the Combater plan.
- **Explicit PC Healer role keeps healing options visible even when everyone is healthy.** The
  normal Auto-fill guard still hides healing when nobody needs it, but a player who deliberately
  chooses Healer now treats healthy-party healing as low-priority preference content instead of a
  hard rejection. Hard gates such as missing Medicine training still apply.

## [1.1.7]

### Fixed

- **Player Combater windows now follow the currently selected owned token.** The live selected token
  now wins over stale panel combatant state, and copied/alternate owned tokens can resolve to the
  matching unique combatant by actor identity when their token IDs differ. Switching between owned
  characters now updates the player-side Combater window on refresh instead of staying on the
  previous actor or falling back to the active tracker combatant.
- **Players can now steer Auto-fill with focused tactical roles.** The tactic chip is available for
  character actors too, with PC-facing roles for Melee Striker, Ranged Striker, Spell Damage,
  Healer, Buffer, Debuffer, Defender, Support, and Skirmisher. Each role now changes final plan
  ordering, not just individual action scores: melee roles can promote Stride-into-melee plans over
  higher raw-score bow plans, spell damage prefers offensive spells over weapon attacks, and support
  roles stay separated between healing, buffing, debuffing, defense, and general support. Player
  sheets no longer show NPC-only roles such as Boss, Lieutenant, Minion, Brute, Artillery, or
  Controller, and they also hide/ignore NPC temperament and custom sliders. NPCs keep the full NPC
  tactic list with temperament controls.
- **Reload 0 weapons no longer add a fake free Reload action.** Bows and other reload-0 ammunition
  weapons reload as part of firing, so the action list stays focused on real choices instead of
  showing a confusing zero-action Reload row.
- **Player-side plans no longer enter GM-only readonly Player plan mode.** Local player drafts strip
  leaked shared-plan metadata on read/write, preventing missing execution controls after the plan is
  mirrored to the GM.
- **Thumbs-down plan ratings now move that exact plan to the end of the Auto-fill queue.** The
  learned preference still contributes its capped scoring adjustment, but an explicitly disliked
  visible plan is no longer kept near the front just because its tactical score is high.
- **Force Barrage and other targeted player actions show their target button on player clients.**
  Player local drafts stay editable/executable, so required target choices remain available before
  pressing play.
- **Compact player plans now keep required choice buttons visible.** Target, destination, and area
  pickers no longer disappear in compact mode while the action is still waiting for that choice.
- **Basic movement stays visible in Browse even when it has no tactical target or path.** Step and
  Stride can still be added manually unless a condition such as grabbed, restrained, or immobilized
  blocks movement.
- **Movement pathfinding now distinguishes allies from enemies.** BFS routes can pass through
  ally-occupied squares, but enemy-occupied squares still block traversal and occupied landing
  squares remain invalid.
- **Auto-fill no longer stacks duplicate holds on the same target.** Grapple and NPC Grab-style
  actions that would apply grabbed/restrained to the same creature now conflict, so generated plans
  do not spend extra actions trying to hold a target already held earlier in the same plan.
- **Grab-required follow-ups now stay after the Grab setup.** Activities such as Worry that require
  a grabbed creature are dependency-ordered after the planned Grab/Grapple effect that satisfies
  their requirement.
- **Single-target spells now respect wall-blocked line of effect when choosing targets.** Direct
  spells such as Force Barrage no longer treat an in-range enemy behind a wall as a valid target;
  movement or another legal line must open the shot first. Area effects keep their separate area
  targeting behavior.
- **Spellshape actions now follow PF2e sequencing.** Reach Spell, Conceal Spell, and other
  Spellshape actions must be immediately followed by the non-Spellshape spell they modify; they can
  no longer appear after a spell, at the end of a plan, standalone, or chained into another
  Spellshape action.
- **Quick Alchemy Why text now stays Alchemist-specific.** Quick Alchemy no longer inherits Wizard
  arcane-school or arcane-thesis spellcasting reasons from multiclass/archetype actors, and its
  setup explanation now describes creating a short-lived alchemical tool instead of stronger
  follow-up attacks.
- **Auto-fill plan cycling now collapses duplicate visible plans.** Plans with the same ordered
  actions, target, rank, MAP, destination, and area placement no longer appear again later in the
  numbered queue just because they came from a different generated source or search path.
- **Thumbs-down demotion now follows regenerated versions of the same visible plan.** If Auto-fill
  rebuilds a disliked plan with different internal candidate IDs, the same action sequence still
  moves to the end of the queue instead of reappearing near the front.
- **Auto-fill and Shuffle no longer re-resolve player tactics for every generated plan.** Plan-level
  role scoring now caches the resolved tactic once per planning pass, avoiding the FPS drop that
  could happen after player role weighting was added.
- **Battle Medicine no longer appears in Auto-fill when nobody needs healing.** Healing actions now
  require a badly injured, dying, or bleeding self/ally target before they can enter generated plans,
  instead of showing a contradictory "No ally is badly injured" reason while still being selected.
- **Battle Medicine execution now uses the right roll path.** If PF2e Workbench's "Treat Wounds and
  Battle Medicine" macro exists, Battle Medicine executes that macro; otherwise it falls back to
  PF2e's Treat Wounds action because PF2e has no native Battle Medicine action API.
- **Reloading weapons now show repeated shots as separate actions.** A second firearm/crossbow shot
  now renders and persists as Strike, Reload, Strike instead of showing the follow-up shot as a
  misleading 2-action attack row.
- **Stances no longer repeat in generated plans.** Stance actions are blocked when the actor already
  has an active stance effect, and Auto-fill will not place a second stance action later in the same
  plan even if it came from a different generated action source.

## [1.1.6]

### Added

- **Critical Recall Knowledge failures can now deliver structured false information through the NPC
  Intel editor.** Every Intel category has a GM-only false-information section using PF2e creature
  traits, damage and condition types, named saves, Perception, and numeric DC/amount fields. False
  records can be prepared before play, edited or deleted, and retain their source actor/question/
  attempt metadata. Prepared records remain GM-only until a Critical Failure opens the matching
  category, where the GM chooses which misinformation to reveal; saving ordinary Intel never exposes
  dormant false facts. Revealed misinformation appears with warning styling to GMs but as ordinary
  truth to players, with no false marker. False records remain separate from learned facts so
  Auto-fill, Best target, and planner scoring never treat them as real knowledge. Numeric
  misinformation follows the selected reveal style: Exact mode shows its entered DC or amount,
  while Bands only converts it to Low, Mid, or High.

### Changed

- **Best target tooltips now explain why that combatant ranked first.** They use compact bullet
  lists and cite applicable revealed weaknesses, saves, traits, success chances, immediate threats,
  and finisher priorities. Player explanations use only revealed Recall Knowledge; when no revealed
  fact affects ranking, the tooltip says so instead of implying hidden Intel was used.
- **Native Roll-Context Preflight tooltips now use compact bullet lists**, clearly separating the
  resolved check, modifier breakdown, approximate-Intel warning, and informational-only notice.
- **Aggro priority explanations now show ordered roles as an arrow chain** (`healer -> caster ->
  main-attacker`) instead of an ambiguous comma-separated list.
- **The curated PF2e spell review now covers 386 entries.** Expanded overrides distinguish combat
  roles, rank-specific variants, Browse-only utility, context-gated remedies, movement, protection,
  healing, save damage, transformations, summons, and other complex tactical cases more accurately.

### Fixed

- **Combater plan windows are scrollable again when an expanded plan exceeds the viewport.** Short
  plans still size naturally; long and composite plans keep every action and rating control reachable.
- **GMs can create and edit a disconnected player's shared combat plan.** The plan remains attributed
  to that player and persists for their return, while connected-player plans stay read-only to avoid
  competing edits.
- **Best target ranking now compares PF2e skill actions against the correct known defense.** Grapple,
  Reposition, and Shove use Fortitude; Trip and Tumble Through use Reflex; Feint and Create a
  Diversion use Perception. Target-dependent setup actions are ranked instead of taking the first
  valid enemy.
- **Hunt Prey now respects PF2e's native Token Mark state and retargeting rules.** Already-hunted prey
  is never offered redundantly, retargeting is strongly deprioritized while living prey remains, and
  normal priority returns after that prey dies or is destroyed.
- **Why explanations remove semantic duplicates.** Native preflight replaces repeated skill-vs-DC
  lines, while specific Stride-and-Strike explanations replace equivalent generic movement text.
- **Shift-click Best target works for nested spell recommendations such as Force Barrage.** Nested
  target metadata is now resolved instead of producing a false “No Best target” warning.
- **Sure Strike is now ordered before movement and the attack it improves.** This preserves its
  next-attack benefit and avoids suggesting a concentrate action only after entering melee reach.
- **Reload is included only when the same weapon is fired later in the plan.** An unused bow or
  firearm can no longer consume an action in an unrelated unarmed or spell routine.
- **Five-foot approaches to melee Strikes and Flurry-style activities now use Step instead of
  Stride** when Step is legal, avoiding unnecessary movement-triggered reactions. Explicit
  abilities that require Stride and movement longer than 5 feet remain unchanged.

## [1.1.5]

### Added

- **Deterministic Preference Learning lets each user teach Auto-fill which complete turn plans they
  prefer.** Use the thumbs-up or thumbs-down buttons under the visible plan to rate that exact
  ordered sequence; pressing the active button again removes the rating. Future Auto-fill and
  Shuffle rankings receive a capped, predictable adjustment for similar actions, roles, action
  costs, resource use, plan length, and ordering. Feedback is stored locally per user and actor, so
  it changes recommendations without changing actor data, PF2e rules, or another user's choices.
- **Native Roll-Context Preflight shows what PF2e's live check context says before an action is
  rolled.** GMs always see supported previews, regardless of settings. A GM-controlled world
  setting only controls whether players see them and is disabled by default. Supported action
  details show a distinct violet PF2e chip with Hit, Success, target-failure chance, or the named
  check modifier, using the actor's contextual PF2e modifiers and only target information that user
  is allowed to know. For GMs, the preview can use the creature's actual defenses. For players, an
  exactly revealed save or Perception fact produces a chance calculated against the revealed value;
  a Low/Mid/High reveal instead uses that band's level-scaled representative DC, producing an
  estimate whose tooltip is explicitly marked as approximate. If the required defense is still
  unrevealed, the chip stops at the named modifier and shows no target DC or success chance.
  Revealed identity and trait facts can supply matching PF2e roll-context traits, while unrevealed
  traits stay excluded. The plain-language tooltip shows the check and modifier breakdown.
  Preflight remains informational only: it audits the recommendation but does not change its score
  or expose hidden enemy data.
- **Action cards now identify the scored Best target.** A dedicated chip names the combatant used by
  recommendation scoring and Native Roll-Context Preflight. Normal target-button clicks still use
  the current Foundry target, while Shift-click commits the scored Best target directly. Self-only
  and targetless actions omit the chip and target control. When an existing draft already contains
  movement, Best target is evaluated from the projected position where the appended action will
  occur, not the token's current square.
- **Recall Knowledge now uses one player-rolled secret d20 and a GM adjudication workflow.** The
  player chooses what they want to learn, then their client rolls once; that same die is combined
  with every standard skill and Lore modifier and sent only to the GM. The GM sees applicable
  skills, standard/broad/specific Lore DCs, and color-coded PF2e degrees of success in both the GM's
  dialog and blind chat card (including natural 20/1 adjustments), then chooses the final result
  instead of making a second roll. Success or critical success opens the recalled target's full
  Intel editor with basic identity and creature category already selected, while the player's
  chosen focus guides the additional facts. The GM can adjust learned facts and reveal style before
  saving; failures preserve failed-attempt and Dubious Knowledge handling without exposing hidden
  DCs or the secret outcome to the player client.
- **Recall Knowledge follow-up attempts now progress per recalling actor and NPC.** Attempt numbers
  persist correctly, and later checks use PF2e's system-provided increasing standard, broad Lore,
  and specific Lore DC progressions. A failed check makes further attempts against that creature
  fruitless. GMs can use Reset RK Attempts in the NPC Intel editor to restore first-attempt DCs and
  remove failure blocks for every actor that has tried to identify that NPC.

### Changed

- **Curated spell-review overrides now capture 102 reviewed PF2e spell entries.** Reviewed roles and
  combat-use policies distinguish buffs, defenses, debuffs, transformations, summons, healing,
  exploration utility, Browse-only choices, and context-only choices. Rank-specific handling keeps
  low-rank utility forms out of Auto-fill while allowing their later battle-form versions where
  appropriate, and condition-aware remedies can enter Auto-fill only when their supported context
  is present.
- **The GM Recall Knowledge editor now uses two independent, full-width category stacks without
  blank grid gaps.** Its global Reveal all control handles every fact, and each category's title icon
  toggles all chips in that category on or off.
- **Recall Knowledge result tables now inherit PF2e's degree-of-success and proficiency colors.**
  Applicable standard skills and broad/specific Lore DCs carry their calculated outcome colors in
  both GM adjudication and blind chat, while Untrained through Legendary labels use the matching
  PF2e rank colors.
- **The GM Recall Knowledge adjudicator now highlights outcomes calculated from the secret roll.**
  A summary names the matching skill and DC for each result, and matching degree buttons receive a
  prominent PF2e-colored outline and d20 icon. When standard and Lore applicability produce
  different results, every matching button is highlighted instead of guessing which check the GM
  will use; the GM can still choose any final degree.

### Fixed

- **Native preflight now treats Athletics maneuvers as skill checks instead of AC attacks.** Trip,
  Disarm, and Tumble Through preview against Reflex DC; Grapple, Shove, and Reposition preview
  against Fortitude DC. Their PF2e `attack` trait still supplies roll options without changing the
  defense used by the check.
- **Demoralize's 30-foot limit now reaches target scoring and the action UI.** The generic action's
  PF2e range is propagated into targeting metadata, so Best target and preflight exclude creatures
  beyond 30 feet from the action's current or projected origin, and the UI can show its real range.
- **Drop Prone is always treated as self-only and targetless.** Stale enemy recommendation metadata
  can no longer add a Best target chip or target-selection control to the action.
- **Reset RK Attempts now fully clears tracked progress and stale failure blocks.** Resetting removes
  both current and legacy per-target attempt keys instead of allowing Foundry's nested flag merge to
  preserve deleted history, so the next check reliably returns to attempt 1.
- **PF2e's pure-blue Success color is now readable in the dark Recall Knowledge adjudication
  dialog.** The dialog derives a muted dark surface and lighter blue text/borders from the system
  color, improving contrast without replacing PF2e's outcome palette or changing light chat cards.

## [1.1.4]

### Added

- **Recall Knowledge Intel is now tracked on NPC actors and survives future combats.** GMs can mark
  individual discovered facts such as traits, Fortitude/Reflex/Will saves, Perception, weaknesses,
  resistances, and immunities. Revealed data is saved to the actor so the same NPC keeps its known
  facts when it appears again.
- **Players can open a styled Known Intel window for enemy combatants.** Player-facing Intel follows
  the combat tracker/token display name, so hidden NPC actor names stay hidden until Foundry itself
  reveals them. The window refreshes while open when names or revealed facts change.
- **GMs can reveal either exact values or level-scaled bands.** Exact mode shows real DCs and
  amounts; banded mode shows Low, Mid, or High to players while GMs still see the actual numbers in
  the editor.
- **Auto-fill and Shuffle now respect player knowledge.** GM planning can use full NPC defenses,
  while player-side scoring only uses Recall Knowledge facts the GM has revealed, so hidden saves,
  weaknesses, resistances, immunities, and Perception no longer leak into player recommendations.
- **Command an Animal now supports companion/familiar subturn planning.** The action shows nested
  minion steps in the Combater panel and follows PF2e's Minion trait: one command action grants the
  minion its two-action turn.
- **Shift-click Auto-fill can now replace the current plan with a complete recalculated plan.** This
  gives players a fast way to discard a partial/manual draft and rebuild the whole turn from the
  current battlefield state.

### Changed

- **Companion detection now works for canvas-only animal, construct, and undead companions.** These
  companions do not need to be in the combat tracker and do not need PF2e's `minion` trait to feed
  Command an Animal substeps; eidolons remain excluded because they use the shared-action rules.
- **Command an Animal substeps now use full execution controls.** Movement substeps get a destination
  picker, executed minion substeps get their own revert button, and familiar Attack Roll substeps
  track their executed state independently of the parent command row.
- **Minion Stride substeps now show and use the companion or familiar's own movement modes.** The
  panel reads live PF2e movement data such as land, fly, swim, and climb speeds; the movement button
  can cycle modes when more than one mode is available, and destination picking, hover preview, and
  execution all use the selected mode.
- **Intel and tactic UI layout was tightened.** Long tactic labels wrap instead of widening the
  header, player NPC Intel avoids duplicate text, and GM/player Intel windows use purpose-built
  controls instead of generic dialogs.

### Fixed

- **Self-buff spells such as Agile Feet no longer get enemy targets just because their text mentions
  an offensive or movement action.** These spells now score and display as caster-focused buffs
  instead of pointing at the selected enemy.
- **The Combater panel now scrolls internally when the planned turn grows taller than the window.**
  The actor header and toolbar stay fixed while the plan list scrolls, so nested composite and
  companion turns no longer run off the bottom of the window.
- **Minion movement buttons now update reliably even for older drafts that only stored Walk.** The
  click handler refreshes from the live companion/familiar actor before cycling, so pressing Walk can
  switch to Fly or another available movement mode instead of doing nothing.

## [1.1.3]

### Added

- **NPCs can now have GM Tactic Personality profiles that steer generated turns.** A GM-only
  tactic chip appears in the Combater panel for NPC turns. GMs can choose a role preset such as
  Boss, Lieutenant, Minion, Brute, Skirmisher, Artillery, Controller, Defender, or Support, then
  combine it with a temperament such as Aggressive, Cautious, Opportunist, Berserker, or Coward.
  These profiles bias recommendations without changing PF2e stats, actions, traits, or legality.
- **The Auto role and Auto temperament now infer how an NPC should behave from its sheet and combat
  context.** Ranged strikes and combat spells lean Artillery, healing and ally buffs lean Support,
  heavy melee and grab tools lean Brute, shield/guard tools lean Defender, level gaps can imply
  Boss or Minion, and low HP or aggressive melee pressure can infer temperament. Explicit presets
  still override the inferred result.
- **Tactic profiles support actor defaults, token overrides, and an optional Custom layer.** Saving
  an actor default gives every token of that NPC the same baseline behavior, while saving a token
  override lets a single battlefield copy act differently. Custom action and target sliders stay
  hidden until Customize is enabled, and preset-only profiles now stay preset-only instead of
  silently applying slider values.

### Changed

- **Auto-fill and Shuffle now apply NPC tactic personality weights when ranking plans and choosing
  targets.** Bosses lean toward high-impact turns and valuable reactions, aggressive creatures
  press damage, cautious creatures value defense, and custom target priorities can push behaviors
  such as finishing wounded enemies, pressuring casters/healers/controllers, punishing immediate
  threats, avoiding hard defenders, preferring nearest reachable enemies, or favoring objective
  targets.
- **Long inferred tactic labels now wrap to two lines and the toolbar stacks below the actor
  identity** so "Auto: Artillery / Aggressive" and similar combinations no longer force the
  Combater header wide enough to hide actor status elements.

## [1.1.2]

### Fixed

- **A generic melee maneuver (Grapple, Trip, Disarm, Shove, Reposition) drafted after a preceding
  move could wrongly show "No enemy in reach" even when it genuinely reached the enemy it was
  committed to.** These maneuvers check reach against the user's current target reticle rather than
  their own committed enemy, so a step aimed at one enemy (e.g. Calder, correctly in reach after a
  Stride) was validated against whichever enemy happened to be reticle-targeted at the time (e.g.
  Ezren, out of reach) instead. The step's own committed target is now re-checked directly, the same
  fix already applied to Strike steps.
- **Auto-fill could pair a move-and-strike combo (e.g. "Stride -> Tentacle") with a second,
  independent Strike or maneuver (Grapple, Trip, Disarm, Shove, Reposition) that could no longer
  reach its target once the Stride landed.** This included a DIFFERENT enemy that was only in range
  before the move, and also the SAME enemy when the extra action's own reach is shorter than the one
  the move was sized for (e.g. a 5-ft Grapple paired with a Stride that only closed to a 10-ft
  Tentacle's reach). The check now applies regardless of which action is added to the plan first.
  Plan-building now recognizes this conflict and looks for a workable alternative (such as a repeat
  attack on the same enemy the move already reaches) instead of drafting an action doomed to miss.
- **A Strike step could silently show as ready (or wrongly flagged "No target in range") against
  the wrong enemy once the board changed after it was drafted** — e.g. an earlier Stride in the
  same turn executes and repositions the actor, and a different enemy happens to be conveniently in
  range now. The step's own already-committed target is now re-checked directly, so its
  available/in-range status always reflects the enemy it's actually labeled for and will attack.
- **A "Stride into reach and Strike" combo (e.g. "Stride -> Tentacle") could land on a square that
  looked in reach but wasn't, leaving the Strike unable to connect.** The attack-square search used
  an approximate reach-distance formula that disagrees with Foundry's real diagonal-movement rule
  for a diagonal approach; it now checks the same real distance the game itself uses, so the
  destination it picks is always genuinely within the Strike's reach.

## [1.1.1]

### Summary

- **Auto-fill is now safer around partial plans, shuffle, selected targets, and spell utilities.**
  Manual steps stay locked when filling the rest of the turn, generated fill steps can still be
  reshuffled after deletes, and Browse-only/context-only spells no longer leak into generated plans.
- **Spell catalog work is now split between runtime tactics and audit data.** Runtime catalogue
  entries add Combater-specific tactical meaning on top of PF2e system spells, such as whether a
  spell is safe for Auto-fill, Browse-only, context-only, or never-Auto-fill. The dev audit scans
  every local system spell into full Markdown and JSON buckets so future recataloguing can target
  weak utility, context-only, and curated override gaps directly.

### Added

- **A spell catalog audit can now scan the local PF2e system spell pack and bucket spells by combat
  use.** `scripts/dev/run-spell-catalog-audit.mjs` writes `docs/spell-catalog-audit.md` and JSON.
  This report is not runtime behavior; it is the recataloguing map for finding weak utility,
  context-only, low-confidence, and missing curated override gaps. The Markdown report lists every
  spell in each bucket instead of truncating rows behind "... more" placeholders.

### Fixed

- **Pressing Auto-fill with already-selected steps keeps those steps locked in place and fills only
  the remaining action budget.** The selected target still steers the appended recommendations.
- **The Auto-fill shuffle button stays available after refilling a deleted step.** Generated fill
  steps are tracked separately so later Auto-fill/shuffle presses can replace that generated tail
  instead of treating the turn as fully locked manual content.
- **Auto-fill no longer spends actions on object-only utility spells like Mage Hand.** These spells
  remain manually selectable in Browse, but exploration utility and low-confidence utility fillers no
  longer enter shuffle/Auto-fill plans.
- **Auto-fill and shuffle now honor runtime spell-catalog combat-use metadata.** Runtime catalogue
  entries can override generic spell heuristics for tactical planning, so Browse-only, context-only,
  or never-Auto-fill spells are filtered from generated plans even if they have a high score.

## [1.1.0]

### Added

- **Auto-fill now uses the combat targets you already selected before pressing the button.** If the
  selected token is one of the acting combatant's current combat targets, Auto-fill rebuilds the
  plan from that live selection instead of using the panel's previous fallback target.
- **A project architecture context document was added** so future refactors can preserve the module's
  domain language, boundaries, and release intent instead of rediscovering them from scratch.
- **Self-test coverage is now split into modules.** The old monolithic runner now loads a dedicated
  source-architecture assertion suite and a runtime behavior suite, keeping the same `npm test`
  command while making the tests easier to navigate.

### Changed

- **The engine was split into focused action, execution, planner, scoring, and revert modules.**
  Action budget, action text parsing, action requirements, builder projection, execution state,
  target handling, chat/revert envelopes, native PF2e item use, damage rolling, movement execution,
  conditions, equipment, Strike/System Action/Sustain/Teleport execution, and spell-slot/resource
  revert logic now live behind smaller module boundaries instead of the old executor/revert
  monoliths.
- **The planner and scorer were decomposed by responsibility.** Planner rules, projections, and
  conflict checks now live under `scripts/engine/planner/`; scoring facts, gates, targets, buffs,
  skills, spells, role tactics, activity tactics, and shared tactic helpers now live under
  `scripts/engine/scoring/`.
- **Action reading was reorganized into reader families.** Generic actions, item actions, weapon
  actions, elemental blasts, defensive/recovery actions, action reach, shared action-reader helpers,
  and positional tactics now each have their own module, with positional stride, retreat, flank,
  kite, and tactic helper files separated under `scripts/readers/positional/`.
- **Panel UI behavior was moved out of `CombaterPanel` into workflow modules.** Context preparation,
  draft mutation/Auto-fill, destination/target/area picking, execution/revert controls, render event
  binding, and display view-model shaping now live under `scripts/ui/panel/`, while action
  categories, action details, and action preview live under `scripts/ui/action/`.
- **Shared Foundry, canvas, token, target, actor, area, and movement helpers now have explicit
  modules.** The refactor consolidates collection/system-value unwrapping, token geometry, canvas
  geometry, area region math, target pools, actor context access, movement routes, and movement-cost
  handling so execution, preview, planning, and readers use the same primitives.
- **Files with a common prefix were gathered into matching folders.** The `action-*`, `area-*`,
  `spell-*`, UI action, reader action, and positional tactic families now use folder structure
  instead of flat `x-*` filenames.

### Fixed

- **Auto-fill no longer has to rely on stale panel target state when a valid combat target is
  selected immediately before filling.** The draft workflow now refreshes combat context, rebuilds
  candidates, and regenerates Auto-fill plans at button press time before writing the draft.
- **Cycling Auto-fill alternatives now refreshes area template placement against the live selected
  target.** A stale cycled plan can no longer keep an old cone aimed at another enemy, such as
  Expel Infestation staying on Celdar after Ezren was targeted.
- **Fill-gap Auto-fill now remaps stale shuffled plans through the selected-target candidate
  search too.** Manual draft actions no longer make the remaining-budget fill fall back to an
  unfocused plan when a target is selected.
- **NPC area actions using PF2e's shorthand template embeds now auto-place and preview correctly.**
  Actions like Expel Infestation (`@Template[cone|distance:30]`) are parsed as cones instead of
  falling back to a generic area/burst that still required manual placement.
- **Projected movement and reach calculations now share token-footprint and route helpers instead
  of duplicating geometry math** across action builder, movement preview, destination picker,
  combat context, and execution paths.

## [1.0.12]

### Added

- **Stride/Crawl destination previews now show a translucent ghost of the actor's own token art**,
  sized to match how it actually renders (including Dynamic Token Rings and any manual Image Scale),
  instead of only a colored box.
- **A live preview now follows the cursor while picking a destination**, showing the ghost and
  remaining-range readout before you even click — including mid-waypoint-path — without interrupting
  or redrawing the reachable-area grid underneath it.

### Fixed

- **Hovering toward a destination could show it as reachable (green) even when it wasn't**, once at
  least one waypoint was already placed — the preview measured straight-line range from the starting
  square instead of the actual route through the waypoint, so clicking that same square then correctly
  warned "beyond movement range." Both the highlighted grid and the specific hovered square now account
  for the full routed path.
- **Drop Prone's scoring assumed the old, pre-remaster rule** that ranged attacks against a prone
  target take a penalty and melee attacks gain a bonus. Prone actually grants a flat Off-Guard penalty
  against every attacker alike, so it's now scored as a pure downside on its own, with the real
  defensive payoff (Take Cover's ranged bonus) scored separately when actually taken.
- **"Stand, Stride into reach, and Strike" could incorrectly ask the player to pick a target** — its
  internal enemy-direction marker (used only to choose which way to Stride) was mistaken for an attack
  target.

## [1.0.11]

### Added

- **A GM can now disable PF2e Combater for players entirely** via a new "Disable PF2e Combater for
  players" world setting. Toggling it immediately hides the panel and toolbar button from every
  connected player — and closes an already-open panel — with no reload needed; the GM's own access
  is never affected.
- **Wands, scrolls, and spell gems with a stored spell now show up as real, castable spell actions**,
  pulling the same curated damage/targeting data known spells use, instead of only appearing as a
  generic, undifferentiated "use item." Casting one goes through the item's own charge/quantity
  consumption (matching the sheet's own "Use" button) and picks whichever spellcasting entry can
  actually cast it.

### Fixed

- **Selecting a hazard or loot token switched the panel to it**, even though neither can take a
  turn. Clicking one now leaves the panel showing whatever combatant it already had.
- **Grapple, Shove, Trip, Disarm, and other non-Strike attack actions never applied their Multiple
  Attack Penalty to the actual roll**, even though the planner had already calculated it — the
  system only tracks MAP automatically for weapon Strikes, so these needed it passed in explicitly.
  The roll now carries the real, already-computed penalty.
- **A token's footprint for the movement-preview overlay and its destination-occupancy check could
  balloon on some Foundry setups** — the same root cause as the 1.0.3/1.0.4 fixes, recurring in this
  file's own footprint math: it preferred the live placeable's rendered pixel width/height over its
  document's grid-unit size. For a non-Medium actor this could read a distant, unrelated creature as
  blocking every nearby square.
- **Clicking a destination inside the highlighted reachable area could still be rejected as
  "beyond movement range."** The overlay is driven by a real pathfinding search that can route
  around difficult terrain, but picking a destination checked cost along a straight line only — so a
  square only reachable via a cheaper detour around terrain showed as reachable, then got refused.
  Picking a destination now reuses the same routed cost the overlay already found.
- **Browse listed every spell a prepared caster knew, not just the ones actually prepared for the
  day.** The 1.0.9 fix that kept rejected/unavailable actions visible in Browse was too broad and
  surfaced every rejected action, not just the ones worth explaining — so a wizard's whole
  spellbook showed up looking addable. Browse now only shows a rejected action when the rejection
  is itself useful (blocked movement, Elemental Blast); unprepared spells and other routine
  unavailability stay hidden again.

## [1.0.9]

### Fixed

- **A move-and-strike composite (e.g. a monster's Rush) could show its Strike atom with a "free
  action" glyph and no indentation.** Auto-fill dropped the composite's mandatory Stride atom
  whenever it "didn't improve position," which silently lost the whole ability's action cost and
  orphaned the Strike atom from its group. The Stride atom is now kept even when it's a zero-distance
  no-op, so the composite renders as a group header carrying the real action-cost glyph with its
  Stride and Strike nested underneath.
- Indented actions inside a group no longer show their own action-cost glyph — the group header
  already carries the composite's real cost, so repeating it per atom looked like each step was free.
- **Move-and-strike composites (Rush, Sudden Charge, and the like) never appeared in Browse**, even
  when perfectly usable, because a manual "+" add had no way to split them into their Stride/Strike
  parts. Adding one now atomizes it the same way Auto-fill does, so nothing the planner can use is
  ever hidden from the list — including rejected/unavailable actions, which now show with their real
  reason in red instead of vanishing.
- **Take Cover was suggested just for standing near any wall**, even one behind the actor or
  bounding an unrelated room with no enemy it actually blocked. It's now only offered after Drop
  Prone, which is the only case this module can reliably call real tactical cover.

## [1.0.10]

### Fixed

- **Auto-fill would suggest Drop Prone on round 1 even with an enemy standing right next to the
  actor.** Scoring never checked whether the current threat was adjacent melee (where prone is a
  pure downside — no attack-roll penalty applies to an adjacent attacker, but the prone actor still
  eats flat-footed and its own worse attacks) versus a ranged-only threat (where prone is the
  actual defensive upgrade it was designed for). Drop Prone now scores accordingly for each case.
- **Auto-fill would use Drain Bonded Item (or similar "you already cast this today" resource
  recovery) on round 1 with a fully rested caster**, even though nothing had been cast yet to
  recover — it was treated as always available. It now checks the actor's real spellcasting data
  (a prepared slot's expended flag, or a spontaneous slot below its max) and is only offered once
  something has genuinely already been cast.
- **The main panel's action list could grow taller than the screen and get silently clipped**, with
  no way to see the rest. The plan body (draft sequence, sustained spells, and uncounted actions)
  now scrolls on its own while the header stays pinned, and the window is capped to the viewport
  height.
- **Clicking Auto-fill after manually picking some actions wiped out those picks** and replaced the
  whole draft with a fresh recommended turn. Auto-fill now leaves manual steps alone and only fills
  the remaining action budget around them (cycling through Auto-fill alternates does the same once
  manual steps are present).

## [1.0.8]

### Fixed

- Socket was turned off in module json

## [1.0.7]

### Fixed

- **A self-centered ally-buff emanation (e.g. the bard's Courageous Anthem) incorrectly asked you to
  pick a target.** It auto-affects every ally in its own area, the same way an enemy-affecting
  emanation like Dirge of Doom already worked, but the buff-spell classifier didn't check for that
  case — any ally-buff spell was treated as needing a manually-picked target, area or not. It now
  resolves the same auto-centered area marker Dirge of Doom uses and never prompts for a target.
- **Executing a feat or action with no special handling (e.g. the alchemist's Quick Alchemy) just
  posted its description to chat**, instead of doing what the sheet's own "Use" button does —
  spending Frequency, opening an embedded crafting ability's formula picker, applying a self-effect.
  It now routes through the same system entry point real hotbar "Use" macros call, so abilities like
  Quick Alchemy actually open their crafting prompt instead of silently no-opping.
- **Placing an emanation-shaped area (e.g. the bard's Courageous Anthem, Dirge of Doom) failed
  outright** with an "Area template preview failed" error — "emanation" isn't a real Foundry region
  shape, unlike burst/cone/line, so the game engine rejected it. It now resolves to a correctly-sized
  circle, and on Foundry 14.353+ uses the engine's own token-attachment API so the region genuinely
  follows the caster if they move, instead of staying behind as a snapshot.
- **A self-centered emanation still forced you to press "Place template"** even though there was
  never a real choice to make — it's always centered on the caster. Manually adding one from the
  browser now pre-fills its placement the same way Auto-fill already did, the placement button no
  longer shows for it at all, and execution auto-resolves the placement on its own even for older
  drafts added before this fix.
- **Not every emanation is centered on the caster, and this module had assumed they all were** —
  Circle of Protection and Ymeri's Mark are both "Range touch" spells whose emanation radiates from
  whoever you touch, not from the caster or a fixed point. These now correctly ask you to pick a
  target instead, and anchor (and, on Foundry 14.353+, attach) the area to that target once chosen.
- **Auto-fill could sequence Lingering Composition after the composition cantrip it's meant to
  extend**, where it does nothing — its own rules text is forward-looking ("if your next action is
  to cast a cantrip composition with a duration of 1 round..."). It's now sequenced immediately
  before any cantrip composition (detected by the actual "composition" trait, so this covers Dirge
  of Doom and Rallying Anthem too, not just the previously-curated Courageous/Vigorous Anthem), the
  same way Quickened Casting is sequenced before the spell it discounts.

## [1.0.6]

### Added

- **Plan steps can now be reordered by drag-and-drop** instead of clicking up/down buttons. Each
  step gets a drag handle; dropping it onto another step swaps their positions (a grouped composite
  ability, e.g. Double Attack, always moves and receives drops as one block, never split apart).
  Works in both the counted-steps list and the uncounted-actions list, independently.
- **The action browser's search box now searches every action-cost tab at once**, not just the
  currently active one. Matches from other tabs show a small tab tag so you can tell where each
  result comes from; the tab strip is inert while a search is active (clear the search to go back to
  browsing by tab) and picking a result works in place without switching tabs.

## [1.0.5]

### Added

- **The panel can now be collapsed into a compact mode** via a new toggle button in the header, next
  to Browse/Refresh. Compact mode keeps the actor identity, action-pool count, and each step's
  Play/Remove controls visible while hiding secondary editing tools (target/destination/area
  pickers, MAP/movement/weapon cycles, reorder, revert) and the sustained-spells/uncounted-actions
  cards, so a finished plan takes up less screen space — handy on smaller/laptop screens once you're
  done planning and are just clicking through to execute.
- **Plan steps can now be duplicated with one click.** Each step's tool cluster gains a duplicate
  button that clones it (including its target, weapon, MAP, and other overrides) and inserts the
  copy right after the original — a quick way to add another instance of the same action (e.g. a
  second longsword Strike) without reopening the action browser. Works for any step type, not just
  Strikes; not shown on the individual atoms of a grouped composite ability (e.g. Double Attack),
  since those must stay paired.
- **Quickened Casting now actually reduces the next spell's action cost.** Previously it was
  recognized as a setup action but had no mechanical effect. Casting an arcane spontaneous spell
  immediately after Quickened Casting in the draft now costs 1 fewer action (minimum 1) — both in
  the plan builder and in Auto-fill, which also now sequences Quickened Casting directly before the
  spell it discounts instead of placing it arbitrarily.
- **A ranged Strike now shows its range as a visible label** (e.g. "Range increment 60 ft") next to
  its target, instead of only on hover over a small crosshair icon. **A Strike's "Additional Attack
  Effects" (Grab, Knockdown, etc., when checked on for that specific attack) now show as chips**
  alongside its real PF2e traits — previously only the formal traits were shown, so an attack with no
  traits of its own (common for many NPC Strikes) looked like it carried no information at all.

### Fixed

- **Auto-fill offered "Reload" for a firearm/crossbow that was already loaded.** Any held weapon
  with a reload value got a Reload step unconditionally, regardless of whether it currently had a
  round chambered. It now checks for an actual loaded round (the same embedded-ammo state the PF2e
  sheet shows) before offering to reload it.
- **Executing "Reload" from the panel didn't actually reload the weapon** — it only posted a
  reminder message, so the weapon still showed empty on the sheet afterward. It now attaches a
  compatible round from inventory to the weapon (the same mechanism the sheet's own reload button
  uses), consuming it from your ammo stack; reverting the step detaches it again. Falls back to the
  reminder only when there's no compatible ammo on hand to load automatically.
- **Executing a Frequency-limited feat or action (e.g. "3/day") from the panel never actually spent
  its use**, so the same ability kept showing as available no matter how many times it was played.
  The panel's fallback execution path was posting the ability's chat card directly instead of going
  through PF2e's own use-and-spend flow. It now spends one use itself when nothing else already did,
  and reverting a step restores it.
- **Grab (and similar "grapple after a Strike" abilities) could target a creature the actor never
  attacked.** After a multi-target attack like a Kraken's Double Attack, the follow-up grapple was
  inheriting a generic "best target" guess instead of one of the creatures actually struck that
  turn, so it could latch onto an untouched bystander instead. It now always targets one of the
  creatures the preceding attack actually hit.
- **Auto-fill's "Stride into reach and Strike/multi-attack" combos left the Stride's destination
  blank**, always requiring a manual pick at execution even though a legal square had already been
  found while building the suggestion. Splitting the combo into its separate Stride and Strike steps
  discarded that pre-validated square; it's now carried onto the last Stride before the attack (an
  earlier Stride in a 2-Stride approach, or a retreat Stride after the attack, still has no fixed
  square and stays manual). Separately, when a Stride still had to fall back to guessing a
  destination toward a plain Strike's target, that target was often only a sanitized display
  reference with no position attached, silently defeating the fallback — it now resolves the live
  token on the canvas instead.

## [1.0.4]

### Added

- **Multi-attack feats and abilities (Flurry of Blows, Twin Takedown, Twin Feint, Hunted Shot, and
  any matching uncurated ability) now get a "Stride into reach" combo option**, the same treatment a
  single Strike already had. Previously one of these was only ever suggested while already adjacent
  to an enemy — out of reach, it scored far too low to compete with unrelated single-action options,
  so Auto-fill would recommend something else entirely instead of closing the distance first.

### Fixed

- **A token's footprint for reach and occupancy checks was inflated on some Foundry setups**, using
  the live placeable's rendered pixel width/height instead of its document's grid-unit size — the
  same root cause as the "collision-free movement path" fix in 1.0.3, recurring in the candidate
  scoring engine's own reach calculations this time. The inflated footprint made every reachable
  square look occupied by another creature, silently preventing any move-then-attack combo from ever
  being suggested for the affected actor.
- **A "Stride, then multi-attack" combo was scored as if no enemy were in reach**, checking the
  actor's position before the Stride instead of after it. It always lost out to a lower-value
  single-Strike combo that got the correct after-the-move reach check, so Auto-fill would suggest one
  weaker attack instead of a feat granting two.
- **"Raise a Shield" no longer shows a "No shield equipped" reason when a shield is actually
  equipped** and the action is available.
- **A "Stride, then multi-attack" combo no longer merges the Stride's cost into the attack's own
  group.** It now shows as a standalone 1-action Stride followed by the multi-attack ability as its
  own 1-action group with its Strikes nested underneath — matching how a bare Flurry of Blows (or
  similar) already displays — instead of a single "Stride" header covering all of it with an
  inflated combined cost.

## [1.0.3]

### Added

- **Command an Animal now recognizes non-familiar companions.** Auto-fill previously only detected
  a bonded familiar (via the system's Master link); it now also recognizes animal, construct, and
  undead companions through trait and ownership signals, so Command an Animal correctly shows as
  available for those actors too.
- **Area and template spells now auto-place, like targets and Stride destinations already did.**
  When Auto-fill already knows where a burst, cone, or line will land best (the same placement
  behind reasons like "can hit 4 enemies near X"), that placement is filled in automatically instead
  of always prompting "Choose area at execution." Falls back to manual placement whenever there's no
  good spot to suggest, or for area shapes this doesn't cover yet (cube/square, ring).
- **A monster's multi-strike abilities (e.g. a Kraken's Double Attack) now roll as real attacks and
  show as a grouped step.** Previously these showed as a single generic, non-rollable strike; each
  attack now resolves to one of the creature's actual weapons, and the plan groups them under one
  shared header with independently movable and removable children.
- **The GM can pick which weapon backs each attack of a multi-strike ability.** A new control on
  each grouped strike cycles through the creature's other ready Strikes (e.g. Arm, Tentacle, Beak)
  instead of always defaulting to its hardest-hitting one.
- **Draft steps now show each action's PF2e traits.** Small trait chips (agile, finesse, reach,
  magical, etc.) appear next to the target, for a quick glance without opening the step.
- **Move-and-strike abilities (Sudden Charge, Flying Kick, and similar) now roll a real attack.**
  Previously these showed as a single step with descriptive text only; the Stride(s) and Strike now
  show as a grouped step, the same way a monster's multi-strike ability already does, with the
  Strike resolving to one of the actor's real weapons.
- **Twin Takedown, Twin Feint, Flurry of Blows, and Hunted Shot now roll real attacks.** Twin
  Takedown and Twin Feint each borrow the actor's two actually-held weapons, one Strike per weapon;
  Flurry of Blows and Hunted Shot borrow a single weapon restricted to the right class (unarmed, or a
  drawn ranged weapon with no reload). All four correctly escalate the multiple attack penalty
  between their own two strikes, matching their real rules text — unlike a monster's Double Attack,
  which shares one penalty tier across both strikes instead.
- **Uncurated abilities with matching rules text now get the same real-attack treatment
  automatically**, without needing to be specifically added to the module. Auto-fill recognizes an
  ability's own requirements wording (e.g. "wielding two melee weapons, each in a different hand," or
  "make two unarmed Strikes") and applies whichever borrowed-weapon and multiple-attack-penalty
  behavior it calls for.
- **Auto-fill now pre-fills a target and destination for every actor, not just GM-run monsters.**
  Any drafted step Auto-fill already has a good answer for — who to hit, where to Stride — is filled
  in immediately instead of prompting "Choose target/destination at execution," regardless of whether
  a player or the GM is using it. A GM who doesn't want this for players can already turn Auto-fill
  off for them entirely.
- **Clicking "Set destination" again while already picking a Stride/Step destination now cancels
  it**, instead of tearing down the in-progress pick and immediately starting an identical one.

### Fixed

- **Players clicking Shuffle no longer get stuck resetting to the first plan.** A background sync
  echo was mistaken for a real change and reset the pinned plan on every click.
- **A Stride's move-range highlight now shows the actor's real Speed.** It previously capped at
  roughly a 3-square radius no matter how fast the actor actually was, making a normal 20-foot Speed
  look like only 10 feet on the map.
- **Draft steps no longer occasionally resolve to the wrong action after Auto-fill.** A Stride could
  intermittently pick up another action's leftover state (e.g. showing a false "Actor is Prone"
  warning, or losing its grouping under Sudden Charge) when re-matched against the current action
  list.
- **Auto-fill no longer suggests dropping a weapon for no reason.** Releasing a held weapon was being
  scored as a mildly attractive free action whenever nothing else filled that slot, even though
  leaving a weapon on the ground has no benefit; it's still available to pick manually if it's ever
  actually wanted.

- **Auto-fill no longer scores unreachable spells and abilities as usable.** When no enemy was
  actually within an action's range, it could still be recommended at full value and displayed as
  though the caster were targeting itself — several such actions had become the engine's top-ranked
  recommendation. Range is now checked consistently for spells the same way it already was for
  other actions.
- **"Raise a Shield" is no longer misapplied to unrelated actions** that merely mention it as an
  option, such as an ability that grants an ally an extra action usable on several different things.
- **Follow-up actions that retarget mid-plan now show the correct reasons and difficulty class** for
  their actual target — a Grapple chained after a Strike no longer displays leftover text describing
  whichever enemy the action originally preferred before the retarget.
- **Attacks against a hidden target now account for the required flat check**, instead of being
  scored as if they reliably connect.
- **Multi-Stride follow-up attacks on the GM side no longer lose movement.** A composite plan like
  Stride, Stride, Strike previously collapsed to a single Stride, sending the attack short of its
  target.
- **Weapon-channeled attack spells are recognized as real damage options** instead of being scored
  as generic utility — Hand of the Apprentice and similar spells now show up when they're the best
  play.
- **Drop Prone is scored on its own merits** instead of sharing one flat bonus with unrelated
  reaction-based defenses, and is discounted for actors with a ranged weapon equipped, since going
  prone also penalizes their own ranged attacks.
- **Poison-category consumables no longer describe themselves as an instant "force a save" attack.**
  They now correctly describe setting up a stronger follow-up Strike, matching how applying poison
  actually works.
- **Opening item details for Stand, Crawl, Drop Prone, and Retch** now links to the correct
  condition item instead of failing to resolve.
- **Feint now correctly displays the enemy being feinted**, instead of the actor performing it. The
  actual scoring and decision-making were never affected — only what was shown as the target.
- **Auto-fill no longer plans a Stride onto a square another creature already occupies.** A
  multi-Stride follow-up attack could land directly on top of its own target or an unrelated
  creature; destinations now skip occupied squares in both the scoring engine and the interactive
  movement preview, without blocking legitimate movement through an ally's or enemy's space.
- **Step and Stride no longer falsely report "No collision-free movement path" when the
  destination is actually open.** The occupancy check above computed a token's own footprint from
  the live placeable's width/height instead of its document's grid-unit size — on some Foundry
  setups the placeable's own value is pixel-space, inflating the footprint far past the token's
  real size and making it read as blocked by any other creature on the map, however far away.
- **A monster's multi-strike ability no longer double-counts its action cost** against the actor's
  remaining actions.
- **A multi-strike ability's own attacks no longer escalate the multiple attack penalty against each
  other.** Both attacks now correctly share one MAP tier, while MAP still advances normally for
  whatever comes after the ability.
- **Grab now rolls a real Athletics check against the target** instead of only posting descriptive
  text with nothing to click.
- **Reverting a step that used up a potion, scroll, wand, or other consumable now restores it.** Its
  quantity is put back, or the item itself is recreated if it was fully consumed, instead of the
  consumed item simply staying gone.
- **Multi-strike abilities that require different targets now actually target different
  creatures.** A Kraken's Double Attack ("each limb targeting a different creature"), a Marilith's
  Bladestorm, and other abilities shaped like them previously resolved every strike against the
  same single target. Auto-fill now recognizes "different creature/enemy/foe" phrasing (not just
  "different target(s)"), reads each ability's real strike count from its own text instead of
  assuming two, and splits it into one Strike per distinct target when enough enemies are in
  range — falling back to repeating the best target when fewer are available.
- **Those same multi-strike abilities no longer double-count their action cost.** Splitting a
  1-action ability like Double Attack into two separate per-target Strikes had it charging 2 of
  the turn's 3 actions instead of 1; only the first Strike now carries the ability's real cost,
  with the rest correctly free.
- **Hovering a Strike or other attack action now highlights its target on the canvas**, matching
  the highlight ranged spells already showed. Self-targeted actions like Drop Prone and Raise a
  Shield never highlight anything, even if a token could technically be resolved for them.
- **The target highlight no longer balloons into a scene-covering rectangle for non-Medium
  creatures.** It computed a token's footprint from the placeable's own width/height instead of
  its document's grid-based size, which on some Foundry setups is a pixel value rather than a
  grid-unit count — for a Large-or-bigger target this produced a rectangle thousands of pixels
  across instead of a normal token-sized box.
- **Hovering an individual attack inside a grouped multi-target ability (e.g. Arm or Tentacle under
  a Kraken's Double Attack) now highlights its own target**, matching the highlight a plain Strike
  already gets. Each split-off attack's resolved target was missing the internal marker that flags
  it as an enemy, so the highlight silently never appeared even though the correct target already
  showed in the step's own label.
- **Auto-fill's alternate-plan cycle no longer permanently excludes viable actions ranked outside
  the top dozen or so.** The planner narrows its candidate pool and caps how many plan combinations
  it searches for performance; an actor with many legal actions (several spells, cantrips, item
  actions, etc.) could have some genuinely useful ones structurally unable to ever appear in any
  generated plan, no matter how many alternatives were cycled through. Every currently available
  action is now guaranteed to show up in at least one alternative plan.

## [1.0.2]

### Added

- **Action coverage reports.** Added generated PF2e system-item coverage reports for actions,
  spells, feats, and features so classifier gaps can be audited against real system data.
- **Expanded Auto-fill documentation.** The README now explains source buckets, scoring weights,
  GM-only target picking, action scoring examples, and the limits of automatic tactical planning.

### Changed

- **Aggro and target scoring are smarter.** GM NPC planning now weighs enemy roles more accurately,
  including healer/controller/main-attacker signals, spell effectiveness, and main-defender status
  based on creature level, High AC benchmarks, and relative AC inside the current fight.
- **Connected-player plan mirroring is stricter.** The GM read-only player-plan view now only applies
  while a non-GM owner is actually online; if that player disconnects, the GM can Auto-fill, edit,
  and execute that character's plan for the session.
- **Shared player plans survive socket gaps.** Player draft updates are mirrored to the owned actor
  flag, so the GM can still see the newest player plan, clear stale shared plans, and execute the
  shared draft on the player's behalf when needed.
- **Prone affects attack scoring.** Attack-roll actions are now penalized while the actor is prone,
  so Auto-fill prefers standing or legal prone follow-ups when those are better choices.
- **Release packaging includes localization files.** The module archive workflow now includes the
  bundled language files.

### Fixed

- **Draft controls use the correct revert button class.** Revert controls on completed draft steps
  are wired to the expected UI class again.
- **Auto-fill now respects action prerequisites and planned conditions.** The planner no longer
  recommends payoff actions like Arcane Slam unless the target is actually grabbed or a valid setup
  action is planned first.
- **NPC Grab is preferred over generic Grapple when appropriate.** Creature abilities that use the
  monster's Grab rider now chain from a real melee Strike on the same target, while ranged Strikes
  and stale trigger events no longer unlock impossible Grab chains.
- **Ranged follow-up turns fill remaining actions better.** After moving into range for a ranged
  Strike, Auto-fill can spend the last action on another Strike at the correct MAP, and far targets
  with no selected token get closing Strides instead of defensive filler.
- **Prone and cover follow-ups stay legal.** Drop Prone can be followed by Take Cover when prone
  enables it, but replacement Auto-fill no longer leaks stale prone state into a new draft or pairs
  Stand with Crawl / prone-only Take Cover.

## [1.0.1]

### Fixed

- Release workflow

## [1.0.0]

### Added

- **Teleport spells place a destination.** Teleportation spells (e.g. Translocate) now prompt for a
  destination like a Stride — pick the space (bounded by the **spell's range**, not movement speed),
  and executing casts the spell (spending its slot/focus) and moves the token there **instantly, with
  no movement animation**. Reverting the step undoes the teleport along with the chat card and spent
  slot.
- **Strikes apply the multiple attack penalty.** A strike now rolls the PF2e variant matching its
  position in the turn — full bonus for the first attack, MAP −5/−4 for the second, MAP −10/−8 for
  the third and beyond — instead of always rolling at full bonus. The penalty is derived from the
  plan order (manual or auto-filled, plan steps then uncounted).
- **Per-strike MAP control.** Each strike has a MAP button that cycles its penalty
  (auto → MAP 0 → −5 → −10 → auto), letting you pin a level for abilities that keep MAP flat across
  consecutive attacks. A pinned level overrides the position-derived default for that strike.
- **Per-Stride movement type.** When the acting creature has more than one Speed, a Stride shows a
  movement-type button that cycles through its available speeds (walk → fly → burrow → swim →
  climb). The chosen speed sizes the reachable range when picking a destination and is the movement
  the token uses when the step executes; creatures with only a land Speed see no extra control.
- **Vertical movement for fly & burrow.** When Striding on a fly or burrow Speed, hold **Shift** and
  scroll while picking a destination to raise or lower the elevation of the waypoint you're placing
  (plain scroll still zooms the canvas). Shift-click a waypoint, scroll to set its height, then place
  the next waypoint (or double-click to finalize) to lock it in — each waypoint keeps its own height,
  so a path can climb, level off, then dive. Every leg's vertical distance counts against Speed (so
  the reachable area shrinks as you climb), the elevation is shown on the waypoint, the token follows
  those heights on execute, and reverting unwinds them.
- **"Hide Auto-fill from players" setting (GM).** A world toggle that removes the Auto-fill button
  for every player so they plan their own turns instead of taking the generic recommendation; the
  GM keeps Auto-fill. Enforced in the executor too, not just hidden in the UI.
- **Localization (i18n) support.** All panel text, dialogs, notifications, generated action
  names, and tactical reasons are localized under the `PF2E_COMBATER` namespace with a bundled
  English language file; PF2e proper nouns (traits, saves, conditions, basic action names) reuse
  the system's own translations. Adding a new language is now just a matter of dropping in a
  translated lang file.
- **GM-adjudicated Retch.** When a player executes Retch, the GM sets the effect's Fortitude
  save DC, the player rolls the save against it, and the GM rules on the result (no reduction /
  reduce sickened / reduce by 2, pre-selected from the rolled degree). The exchange runs over
  **socketlib** (now a required dependency); the player's step shows a **Waiting for the GM…**
  indicator while pending and falls back to a local prompt when no GM is connected.
- **Revert executed steps.** Undo a completed draft step's real game-state effect, not just
  its status: movement returns the token to where it started, Stand re-applies prone, a
  successful Retch restores sickened, and area actions delete the template they placed.
  Chat messages and consumed spell slots are cleaned up on a best-effort basis, with a
  warning when an effect (e.g. a condition applied to a target) must be undone by hand.
  Each completed step gets a revert button, and **Reset** reverts every executed step in
  reverse order.
- **Auto-expiring area templates.** Placing a lingering area (e.g. Darkness, clouds, walls)
  now creates a linked PF2e effect on the caster as a visible countdown and removes the
  template automatically when its duration ends — in encounter or exploration. Sustained
  areas gain a max-duration cap, dismissing the effect early clears the template, and
  reverting the step removes both.
- **Uncounted actions.** A manually-managed list below the plan for real, executable
  actions (e.g. Sudden Charge's "Stride, Stride, Strike") that run alongside the plan but stay
  off the action-economy budget, the planner's scoring, and slot tracking. Add to it with the
  "Add to: Plan / Uncounted" toggle; each chip executes and reverts like a plan step, and
  the header Reset reverts both lists together.
- **Weapon and position manipulate actions.** Each sheathed weapon gets a 1-action **Draw**,
  each held weapon a free-action **Release** (drop to the ground), and reloadable weapons a
  **Reload** action costing the weapon's reload value — reload-0 ammunition weapons (e.g. bows)
  show a _free_ Reload step that doesn't draw from the action budget. A 1-action **Drop Prone**
  is offered when the actor isn't already prone (and lacks its own Drop Prone). Draw and Release
  update the weapon's carry state and can be reverted.

### Changed

- **Clearer execution status in the draft panel.** Completed steps show a **Done** badge
  (failed steps show **Failed**) and dim once finished; per-step controls switch to
  revert + remove after execution; an **X/Y done** progress counter sits beside the
  execution controls; and the raw destination pixel coordinates are no longer displayed.
- Haste and other extra-action buffs now read **"grants quickened"** instead of naming a
  specific ally.
- Action rows and draft chips now show the **item image** beside each action name (spells,
  strikes, feats, items), with a generic PF2e action icon for image-less actions.
- Action-cost is now drawn with the **PF2e action-cost icons** (1/2/3 actions, reaction,
  free) instead of plain diamonds.
- The **window now follows the selected token** for both the GM and players — selecting a
  combatant's token shows its plan, and a turn change refreshes the open window in place instead
  of jumping to the active combatant. (Players can only control tokens they own, so this never
  exposes a plan they aren't allowed to see; with nothing selected it falls back to their own
  combatant.)
- A combatant's **execution plan now persists through its whole turn** and is cleared only
  after the turn ends, instead of resetting at the start of each round.
- **Action damage now rolls after the chat card.** A spell's or strike's own chat message
  posts first, then its damage message lands beneath it instead of racing ahead.
- **Sustaining a spell re-posts its card to chat.** Executing a Sustain step posts the
  spell's chat card again so you can re-use its data (re-apply effects, re-roll damage); the
  re-posted message is removed when the step is reverted.
- **Sustained-spell cleanup only prompts from the next turn.** A spell cast this turn is no
  longer offered for end-of-turn cleanup — you can't sustain it until your next turn, so the
  prompt waits until then.

### Removed

- The standalone **Sustain a Spell** action no longer appears in the action tabs; the
  dedicated sustained-spells section on the panel handles sustaining.

### Fixed

- **Teleport destination picking now shows an overlay, and revert works.** Picking a teleport
  destination (e.g. Translocate) drew nothing — the preview only handled stride-type movement — so
  there was no indication of range and no marker for the chosen space. Teleports now show a **range
  ring** at the spell's actual range plus a destination marker. (The ring replaces a per-square grid
  that was capped at the nearest ~48 squares, which made a long range like 120 ft look far shorter.)
  Spell ranges given as a bare number are read correctly too. Revert also captures the take-off
  position **before** the spell is cast, so even a teleport that repositions the token itself can be
  undone back to where it started.
- **Executing a Stride no longer lags.** Validating the move at execution reused the hover-preview
  code, which flood-fills the entire remaining reachable area (a BFS with per-cell wall-collision
  checks) and runs an A* path search — work only the on-canvas overlay needs. Execution now does a
  cheap legality check (path/range + visibility) and lets Foundry's move API arbitrate collisions,
  so the token moves immediately on click. The canvas overlay (stride path/range) is also cleared the
  instant the step runs, rather than lingering through the move animation and the re-render after it.
- **Executed steps keep their name when the action stops being available.** A draft step stored
  only its action key and re-resolved the name each render; after drawing a weapon (which removes
  the now-pointless Draw action) the step had nothing to resolve and showed its raw key (e.g.
  `draw-weapon-Kf9Fu…`). Steps now persist a display name so they stay readable after execution.
- **No more false "Spell could not be cast (no slot available)" warning.** Cast success was read
  from `entry.cast()`'s return value, but current PF2e resolves it to `undefined` even on a
  successful cast — so every spell (cantrips and focus spells included, neither of which uses a
  slot) was flagged as a failed cast. Castability is now checked from the actual resource _before_
  casting — a focus point (`resources.focus.value`), a remaining spell slot, or none for a
  cantrip — and a cast is only treated as failed when that resource is genuinely empty.
- Action damage now lands **reliably** after its spell/strike chat card: the damage message is
  stamped just after the card so the chat log always orders the card first, even when the card's
  creation resolves a tick later.
- **GM "player plan" view now keys off ownership, not the character type.** A combatant was treated
  as a player's plan whenever its actor was a `character`, so GM-run character NPCs/allies were
  wrongly made read-only. It now counts only actors a non-GM user actually owns.

### Dependencies

- **socketlib** is now required. It carries the player↔GM hand-offs (Retch adjudication and
  shared-plan sync); Foundry will offer to install it automatically when you enable the module.
