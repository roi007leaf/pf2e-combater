# Changelog

All notable changes to PF2e Combater are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
