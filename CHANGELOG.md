# Changelog

All notable changes to PF2e Combater are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- The **GM window now follows the selected token** — selecting a combatant's token shows its
  plan, and a turn change no longer forces the window to the next NPC. (Players still track
  their own combatant.)
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

- Action damage now lands **reliably** after its spell/strike chat card: the damage message is
  stamped just after the card so the chat log always orders the card first, even when the card's
  creation resolves a tick later.

### Dependencies

- **socketlib** is now required. It carries the player↔GM hand-offs (Retch adjudication and
  shared-plan sync); Foundry will offer to install it automatically when you enable the module.
