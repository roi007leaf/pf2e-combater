# Changelog

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

- **Curated spell-review overrides now capture 87 reviewed PF2e spell entries.** Reviewed roles and
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
