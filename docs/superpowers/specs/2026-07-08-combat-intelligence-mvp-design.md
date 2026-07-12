# Combat Intelligence MVP - Design

## Goal

Implement feature picks 2, 3, and 4 from the Foundry v14/PF2e Combater scan as one focused MVP:

1. Region + Terrain-Aware Route Scorer.
2. Recall Knowledge Intel Ledger.
3. Minion / Companion Subturn Planner.

## Scope

This pass improves Auto-fill, Shuffle, and draft visibility without changing PF2e rules elements or action definitions. It adds module-owned scoring context plus actor-saved Recall Knowledge metadata.

## Terrain-Aware Route Scorer

The module already has Foundry v14 Region movement-cost parsing in `scripts/rules/movement-cost.js` and route search in `scripts/engine/movement-route.js`. The missing value is that positional readers drop routed `cost` when they convert reachable centers into tactical centers, so Flank, Skirmish, and Stride-then-Strike choices cannot prefer cheaper terrain routes.

This feature preserves route cost and route metadata on reachable centers, lets existing `compareTacticalCenters` prefer lower-cost attack squares, and adds a small scoring note when a move-and-attack route spends most of the movement budget. Region legality remains in the existing movement route layer.

## Recall Knowledge Intel Ledger

Current GM scoring can use visible target resistances, weaknesses, immunities, and save DCs as soon as the GM can read them. That is useful but can metagame player-facing recommendations.

The ledger stores GM-marked learned facts on the target actor under `flags.pf2e-combater.intelLedger`. Categories are `traits`, `saves`, `weaknesses`, `resistances`, and `immunities`. Damage and save scoring only use a category after the GM marks it learned. Because the flag lives on the actor, the same NPC keeps learned facts in later combats; player contexts receive only the categories marked known, not the full actor document.

The GM UI is a compact `Intel` header button that opens a dialog for current enemies. It writes actor flags and refreshes Auto-fill/Shuffle plans. Players see the same header button only when at least one current enemy has revealed intel; their dialog is read-only and lists the exact traits, save DCs, weaknesses, resistances, or immunities the GM revealed.

## Minion / Companion Subturn Planner

`combat-context.js` already detects commandable minions through PF2e familiar/minion ownership signals. This MVP adds a simple planner for `Command an Animal`: choose the best detected minion, estimate a two-action turn from its Strikes and enemy distances, then attach a readable subturn summary to the Command action.

The minion plan is intentionally small: `Strike + Strike` when already in range, otherwise `Stride + Strike` when a target can be reached. It does not recursively invoke the full turn planner.

## Testing

Tests cover:

- Intel ledger normalization and defense gating.
- Command action scoring receiving a minion plan and visible label.
- Reachable movement centers preserving route cost so tactical center comparisons can use terrain.
- UI/source wiring for the GM Intel button and minion detail chip.
