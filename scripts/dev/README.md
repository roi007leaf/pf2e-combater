# Dev tools

Local-only runners. None of them ship with the module or run in CI.

## Auto-fill quality sweep (`npm run planner:sweep`)

`scripts/dev/quality-sweep/` runs every PF2e iconic (highest-level build, animal companions
skipped) through 11 combat situations (adjacent foe, 15/40/80 ft, a cluster, a dying ally, low HP,
prone, a frightened/prone target, a hidden target) under Auto and each player tactic that fits its
class — about 1,000 scenarios — through the live `buildCandidates()` → `buildTurnPlans()` pipeline,
then judges the top 3 plans of each automatically.

```bash
npm run planner:sweep
npm run planner:sweep -- Harsk "enemy-40ft" skirmisher
npm run planner:sweep -- --show role-mismatch
npm run planner:sweep -- --refresh
```

- Positional args are regexes for iconic name, situation and tactic (`*` = any).
- `--show <judge>` prints every scenario that judge flagged, with its top 3 plans.
- `--refresh` re-extracts the iconics (needed after a PF2e update only if the version is unchanged).

**Needs the local PF2e install.** Iconics are read from `../../systems/pf2e/packs/iconics` with
`classic-level` and cached per system version in `scripts/dev/quality-sweep/.cache/` (gitignored,
never commit it: it is Paizo data). Full per-scenario results go to `.cache/results.json`.

**Exit code.** Non-zero when a gated judge fires on a top-1 plan: crash, planning over 300 ms,
orphan Draw, thrown weapon twice without a Draw, two flourishes, attack out of reach, over budget.
The other judges (`role-mismatch`, `orphan-setup`, `map-swap`, `wasted-actions`, ...) are heuristics
to eyeball; their counts are printed but don't fail the run.

Files: `iconics.mjs` (pack extract + cache), `harness.mjs` (actor docs and combat contexts),
`judges.mjs` (judges and the gated list), `run.mjs` (matrix, summary, exit code).
