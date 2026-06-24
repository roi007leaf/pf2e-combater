# Auto-Expiring Area Templates — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Problem

Persistent area templates (Regions) are placed for lingering spells — those that are
`sustained` or have a `lastingDuration` (see `areaTemplatePersists` in
`action-executor.js`). Once placed they never go away on their own: a fixed-duration area
like Ezren's **Darkness** (1 minute) stays on the canvas until someone deletes it manually
or reverts the step. We want such templates to remove themselves when their duration ends,
with a visible countdown the player can see.

The existing `promptUnsustainedSpellCleanup` (`rules/sustained-spells.js`) already removes a
**sustained** spell's effect + template when the caster *stops* sustaining. So the gaps are:

1. **Fixed-duration areas** — no tracking today.
2. **Sustained areas** — need a **max-duration cap** so they cannot linger forever even
   when sustained every round.

## Approach

**One mechanism: a linked PF2e timer Effect + region-flag expiry + a GM-side sweep.**

### 1. On execution (persistent-area branch in `executeDraftStep`)

In addition to creating the region:

- **Parse the spell duration** (`activityProfile.duration`, e.g. `"1 minute"`) into a PF2e
  effect duration `{ value, unit, sustained, expiry }`.
  - Fixed spells: parsed value + unit (`round(s)`→`rounds`, `minute(s)`→`minutes`,
    `hour(s)`→`hours`, `day(s)`→`days`).
  - Sustained spells: a **cap** — default `1 minute`, or the value from
    `"sustained up to X"` — with `sustained: true`.
  - `unlimited` / `until …` / unparseable → **no timer**; the region is left to
    manual/revert/sustained-cleanup removal.
- **Create a linked timer Effect** on the caster's actor (spell name + spell image,
  the parsed duration, token icon shown), flagged
  `flags["pf2e-combater"].areaRegion = { regionId, sceneId }`. This is the visible
  countdown badge on the token.
- **Stamp the region flags** `flags["pf2e-combater"].areaTimer =
  { effectUuid, casterActorUuid, expiresWorldTime, expiresRound }` as a fallback the GM
  sweep can use if the effect is lost.
- The revert `region` op gains `effectUuid` so reverting the step deletes the effect too.

### 2. GM-side expiry sweep (new hooks, GM-only)

On `updateWorldTime` and `updateCombat` (round change), scan the active scene's regions
that carry an `areaTimer` flag. A region is **expired** when:

- its linked effect resolves and reports expired (`effect.isExpired`, with a fallback to
  the stored expiry if that getter is unavailable); **or**
- the effect is gone and `game.time.worldTime >= expiresWorldTime`; **or**
- combat is active and `combat.round > expiresRound`.

Expired → delete the region, and delete the linked effect if it still exists.

### 3. Effect dismissed early

Extend the existing `deleteItem` hook: when a deleted item is a timer effect carrying an
`areaRegion` flag, delete its linked region. Runs on the GM client; if the deleting user is
not the GM, route the deletion through the existing module socket.

### 4. Sustained areas

`promptUnsustainedSpellCleanup` continues to handle "stopped sustaining" (it removes the
effect + template). The capped timer effect — matched by spell name, so the existing
cleanup also sees it — adds the max-duration fallback so a continuously-sustained area still
dies at the cap. No duplicate logic is introduced.

## Components

### New module: `scripts/engine/area-duration.js` (pure, testable)

- `parseSpellDuration(durationString, { sustained })` → `{ value, unit, sustained, expiry } | null`
  (null when there is no auto-expiry).
- `buildAreaTimerEffectData({ action, regionId, sceneId, worldTime, initiative })` →
  PF2e Effect item data with the duration, start, token icon, and `areaRegion` flag.
- `areaTimerExpired(effect, regionFlag, { worldTime, round })` → boolean (encapsulates the
  three expiry checks above).
- `expiredAreaRegionsForScene(scene, { worldTime, round })` → array of region ids to delete.

### Wiring

- `action-executor.js` — in the `areaTemplatePersists` branch: build + create the timer
  effect, stamp the region `areaTimer` flag, include `effectUuid` in the `region` revert op.
- `action-revert.js` — `revertRegion` also deletes the linked effect (via `effectUuid`).
- `main.js` — register the GM-side `updateWorldTime` / `updateCombat` sweep; extend the
  `deleteItem` hook for the effect-dismissed-early path; socket fallback for non-GM
  deletions.

## Reliability / error handling

- The **region-flag expiry is the backbone**: it works even if effect creation fails (no
  actor, no permission) or the world's PF2e auto-remove-expired-effects setting is off. The
  effect is the visible timer + early-dismiss handle, not the sole source of truth.
- Both `expiresWorldTime` and `expiresRound` are stored, because not every table advances
  `worldTime` on a round change.
- Removal runs on the **GM client** (single authority, avoids races). With no GM connected,
  cleanup waits until a GM joins — documented, acceptable for GM-run combat.
- Effect creation failure still creates the region (timer-less); it will expire by the
  stored `expiresWorldTime` / `expiresRound`.

## Testing (`scripts/engine/self-test.js`, mocked)

- `parseSpellDuration`: rounds / minutes / hours, `sustained` (cap), `sustained up to X`,
  `unlimited` / `until …` / empty → null.
- `buildAreaTimerEffectData`: correct duration/start/flags/name/img shape.
- `areaTimerExpired` / `expiredAreaRegionsForScene`: expiry by world-time, by round, and
  "not yet expired" cases; effect-present vs effect-gone fallback.
- `action-revert` region revert deletes the linked effect when `effectUuid` is present.
- Execution of a persistent fixed-duration area creates both the region and a linked timer
  effect with the `areaRegion` flag; a sustained area gets a capped duration.

## Out of scope

- Detecting "stopped sustaining" early — already handled by `promptUnsustainedSpellCleanup`.
- Non-area duration effects / buffs on the caster (this is only about placed templates).
- MeasuredTemplate-based areas (the module places Regions; the sustained cleanup already
  also covers MeasuredTemplates by id, but new timers are created for Regions).
