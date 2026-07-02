# Hover Target Highlight for Enemy-Targeting Actions — Design

**Goal:** Hovering an action or Strike row in the panel (either the recommendation list or a drafted step) that resolves to an enemy target highlights that enemy's token on the canvas, the same green outline already used for ranged spells. Confirmed live: hovering "Energy Beam" (an attack action showing `→ Ezren`) draws nothing on canvas today.

**Root cause:** [`showActionPreview`](../../../scripts/ui/action-preview.js) only draws a target highlight for ranged spells (`isRangedSpell` branch). Strikes and general actions fall through to a bare `return null`. This was deliberately added in commit `7db967a` after the previous behavior — highlighting for *any* action — hit a bug: [`plannedTargetTokens`](../../../scripts/ui/action-preview.js)'s last-resort fallback (`target ?? values[0]`) picked a **random enemy** for self-targeted actions (e.g. Drop Prone) whose resolved target (`actorTarget(context)`, a self-reference) didn't match any canvas token via the earlier tiers. Rather than fix that one bad fallback, the whole non-spell highlight path was disabled.

**Existing signal to reuse:** [`scoring.js`](../../../scripts/engine/scoring.js)'s `suggestedTarget` field is always a typed ref — `{ type: "enemy" | "ally" | "self", id, uuid, name }` — produced by `targetRef(...)`/`actorTarget(...)`. Strikes and offensive actions resolve to `type: "enemy"`; self-buffs resolve to `type: "self"`; heals resolve to `type: "ally"`. This field is already the established "who does this actually target" signal elsewhere in the codebase (e.g. `rawTargetName` in `CombaterPanel.js` reads `step.suggestedTarget.name` directly for the `→ Name` label shown in the screenshot above).

## Scope

Only actions whose `suggestedTarget.type === "enemy"` get a hover highlight. This was chosen explicitly over two broader alternatives:
- Any resolved target (enemy/ally/self) — would highlight the acting creature's own token for self-buffs like Drop Prone.
- Strikes only — would leave Energy Beam, Trip, Feint, Demoralize, and other enemy-targeting non-Strike actions unhighlighted.

Enemy-only means self-buffs, ally-heals, and self-centered emanations never highlight anything — the exact category that caused the original bug — fixed by construction (the gate excludes them) rather than by disabling the feature.

## Mechanics

Add a new helper in `action-preview.js`, `enemyTargetTokens(context, step)`:
1. Read `suggestedTarget` from both `step.suggestedTarget` and `step.action.suggestedTarget` (draft steps nest the scored action under `.action`; recommendation-list steps carry it at the top level — the existing `directTargets` array in `plannedTargetTokens` already checks both shapes for the same reason).
2. If neither has `type === "enemy"`, return `[]` immediately — no highlight.
3. Otherwise resolve an actual canvas token: first from `targetTokenIds` (explicit draft/auto-fill pick), then from the direct target refs (`suggestedTarget`, `preferredTarget`, `target`, checked on both the step and `step.action`).
4. **No blind fallback.** Unlike `plannedTargetTokens`, this helper never falls back to `targetingProfile.preferredTargetId/Name` matching or `values[0]`. If the gate passes but no canvas token can be resolved (e.g. a stale/removed token), it returns `[]` and nothing is drawn — never a guess.

In `showActionPreview`, the final branch (currently: non-ranged-spell → `clearRangeOverlay(); return null;`) is extended to call `enemyTargetTokens(context, step)` first. If it returns tokens, draw the highlight via the existing `drawTargetPreview` (same green outline as spells) and return `{ type: "target", tokens }`; otherwise fall through to the existing "draw nothing" behavior unchanged.

The ranged-spell branch and `plannedTargetTokens` itself are untouched — this adds a new, stricter path alongside the existing one rather than modifying spell behavior.

## Non-goals

- Not touching the ranged-spell highlight path or its existing (looser) fallback behavior.
- Not adding any highlight for ally/self-typed targets, even when a real token could be resolved for them.
- Not changing any template/CSS — the hover wiring (`data-preview-step` / `data-preview-draft-step`) already fires for every action row, including Strikes; this is a pure logic change in `action-preview.js`.

## Testing

`self-test.js` (~line 7718-7730) currently asserts a Strike hover draws **no** overlay — that assertion is inverted by this change and must be updated:
- A Strike/attack step with `suggestedTarget: { type: "enemy", id: "target-token", name: "..." }` and matching `targetTokenIds: ["target-token"]` must now draw the target box (`type: "target"`).
- A self-targeted step with `suggestedTarget: { type: "self", ... }` (e.g. Drop Prone) must still draw nothing — the regression guard for the original bug.
- A step with no `suggestedTarget` at all (legacy/ambiguous shape) must still draw nothing — proves the gate requires an explicit `"enemy"` type, not just the presence of `targetTokenIds`.

Validate with `npx eslint scripts/ui/action-preview.js scripts/engine/self-test.js` and `node scripts/engine/self-test.js` (must still complete/halt at the same point as before this change — no new failures introduced).
