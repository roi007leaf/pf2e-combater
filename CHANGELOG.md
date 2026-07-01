# Changelog

All notable changes to PF2e Combater are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  show a *free* Reload step that doesn't draw from the action budget. A 1-action **Drop Prone**
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
  slot) was flagged as a failed cast. Castability is now checked from the actual resource *before*
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
