# GM Tactic Personality - Design

## Goal

Add GM-only NPC tactic controls that influence the actual plans produced by Auto Fill and Shuffle. The feature is not cosmetic: selected tactics must change action scoring, target priority, and the generated draft segment that Shuffle replaces.

## Scope

This applies to NPC combatants controlled by the GM. PCs keep current behavior. The feature does not mutate PF2e actor data, action definitions, stats, conditions, or rules elements. It only adjusts this module's turn-planning preferences.

The module id and storage namespace remain `pf2e-combater`.

## User Experience

The Combater panel gets a compact GM-only tactic chip in the header when the active combatant is an NPC. The chip shows the resolved tactic, such as `Boss / Cautious` or `Artillery / Aggressive`.

Clicking the chip opens a small tactic editor:

- Actor default: saved as the usual behavior for this NPC.
- Token override: saved for this specific encounter token and wins over the actor default.
- Reset override: returns the token to the actor default.

This keeps the common workflow fast: the GM can set "Boss" on an actor once, then make one token in a specific fight more cautious or more aggressive without changing the source actor.

## Preset Model

Use two controls instead of one large dropdown.

Role presets:

- `Auto`: current behavior.
- `Boss`: prefers high-impact two- and three-action turns, preserves action economy, values reactions/triggers, pressures meaningful threats, avoids low-value movement.
- `Lieutenant`: coordinates with allies, pressures key targets, uses control/support more than a brute.
- `Minion`: simple pressure, cheap actions, flank/help/bodies-in-the-way behavior, fewer complex setups.
- `Brute`: damage, Athletics, grab/trip/shove follow-ups, direct pressure.
- `Skirmisher`: mobility, spacing, strike-and-move turns, avoids being pinned.
- `Artillery`: ranged pressure, spell/ability output, keeps distance, targets exposed high-value foes.
- `Controller`: debuffs, terrain, denial, target disruption.
- `Defender`: protects allies, blocks access, uses defensive actions, punishes threats near protected targets.
- `Support`: buffs, heals, commands allies/minions, enables stronger allies.

Temperament presets:

- `Auto`: current behavior.
- `Aggressive`: pushes damage and pressure.
- `Cautious`: values defense, cover, distance, recovery, and lower-risk plans.
- `Opportunist`: follows openings such as low-HP targets, flat-footed targets, triggers, MAP-friendly follow-ups.
- `Berserker`: strongly favors direct damage and engagement over survival.
- `Coward`: retreats, avoids strong enemies, protects self, uses disabling/escape options.

The final tactic is role plus temperament. Examples:

- `Boss / Aggressive`
- `Artillery / Cautious`
- `Minion / Opportunist`
- `Brute / Berserker`

## Custom Mode

Custom starts from any role plus temperament combination, then applies slider overrides.

Action sliders:

- Damage pressure.
- Survival/defense.
- Control/debuff.
- Mobility/positioning.
- Support/allies.
- Reaction/trigger value.

Target sliders:

- Finish wounded targets.
- Pressure casters/healers/controllers.
- Punish immediate threats.
- Avoid hard defenders.
- Prefer nearest reachable target.
- Prefer tactical objective target.

Sliders are bounded and converted into small score deltas. Custom cannot make illegal actions legal, cannot bypass PF2e action costs, and cannot reveal hidden enemy data to players.

## Data Flow

Create a focused tactic module at `scripts/rules/tactic-personality.js`, responsible for:

- Resolving actor default plus token override.
- Normalizing role/temperament/custom data.
- Returning action score adjustments.
- Returning target priority adjustments.
- Returning concise GM-facing reasons.

Scoring integration:

1. Existing class tactics and NPC family tactics still run.
2. Tactic personality adjustments run after current NPC tactic scoring.
3. Score deltas stay clamped, similar to existing class tactic bounds.
4. Reasons are sanitized through the existing recommendation safety path.

Targeting integration:

1. Existing aggro target roles remain the base.
2. Tactic personality changes target weights, not target legality.
3. Auto Fill and Shuffle both consume the same scoring path, so both must reflect tactics.
4. Generated fill steps keep existing shuffle metadata so later shuffles replace the tactic-generated segment, not locked manual steps.

## Storage

Use Foundry flags under the existing module namespace:

- Actor default: `flags.pf2e-combater.tacticPersonality`.
- Token override: `flags.pf2e-combater.tacticPersonalityOverride`.

Token override wins over actor default. Missing or invalid values resolve to `Auto / Auto` with no score changes.

## Refresh Behavior

Changing actor default or token override refreshes the active panel and invalidates generated recommendations for that combatant. If a draft has locked manual steps, Auto Fill and Shuffle still preserve those manual steps and regenerate only the fill segment using the new tactic.

## Error Handling

Invalid or stale flag data is ignored and treated as Auto. If the active token cannot be resolved, the panel hides the tactic chip. If flag writes fail, the UI keeps the previous resolved tactic and shows a normal Foundry warning.

## Testing

Add pure unit coverage for:

- Actor default resolution.
- Token override precedence.
- Invalid flag fallback to Auto.
- Preset normalization.
- Custom slider clamping.
- Boss role increasing high-impact action preference.
- Cautious temperament increasing defensive/survival preference.
- Aggressive temperament increasing damage pressure.
- Target sliders changing target priority.

Add integration coverage for:

- Auto Fill produces a different recommended order when tactic preferences differ.
- Shuffle uses the same tactic-adjusted scoring path as Auto Fill.
- Locked manual draft steps are preserved while generated fill steps are regenerated using the current tactic.
- GM-only UI chip appears for NPCs and not PCs.
- Player-visible recommendations do not expose hidden enemy data.

## Non-Goals

- No AI text generation or autonomous GM.
- No PF2e rule mutation.
- No direct actor stat changes.
- No player-facing tactic controls.
- No broad rewrite of scoring, aggro, or draft storage.
