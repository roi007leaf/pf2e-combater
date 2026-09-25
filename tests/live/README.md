# Local automated Foundry tests

Live tests use same safety/configuration model as PF2e Visioner: visible Playwright Chromium, separate GM and player browser contexts, disposable-world guard, source fingerprint, per-case screenshots, JSON report, atomic runner lock, and write-ahead recovery journal.

Tests run only against a running Foundry 14 / PF2e world with source checkout of PF2e Combater and socketlib enabled. Runner never starts Foundry, switches worlds, touches campaign documents, runs in GitHub Actions, or enters release ZIP.

## First run

1. Use shared disposable world with ID `visioner-qa`. Enable PF2e Combater and socketlib.
2. Create password-protected GM plus separate player account. Player may have confirmed blank password.
3. Run `npm ci`, then `npx playwright install chromium` once.
4. Launch `combater-qa`, close other sessions using test accounts, then run `npm run test:live:full`.
5. Require every case to pass and `cleanup: complete` in `artifacts/live/report.json`.

```powershell
npm run test:live                 # smoke suite
npm run test:live:full            # all 40 feature scenarios
npm run test:live:list            # catalog and feature areas
npm run test:live:harness         # runner safety tests; Foundry not required
npm run test:live:cleanup         # recover interrupted run
npm run test:live:matrix -- artifacts/live/report.json
```

Use `COMBATER_LIVE_CASE=case-one,case-two` with `test:live:full` for focused cases. `--headless` is optional. `COMBATER_BROWSER_CHANNEL=chrome` selects installed Chrome.

## Local defaults and environment

Optional defaults live outside repo at `~/.config/pf2e-combater/live.json` (`C:\Users\<user>\.config\pf2e-combater\live.json` on Windows). If absent, runner reads existing PF2e Visioner defaults from `~/.config/pf2e-visioner/live.json`, so same URL/accounts work without duplicating secrets:

```json
{
  "url": "https://localhost:30000",
  "gm": { "username": "QA GM", "password": "..." },
  "player": { "username": "QA Player", "password": "", "allowBlankPassword": true }
}
```

Environment overrides: `COMBATER_FOUNDRY_URL`, `COMBATER_GM_USER`, `COMBATER_GM_PASSWORD`, `COMBATER_PLAYER_USER`, `COMBATER_PLAYER_PASSWORD`, `COMBATER_PLAYER_ALLOW_BLANK=1`, `COMBATER_DISPOSABLE_WORLD`, `COMBATER_BROWSER_CHANNEL`, and `COMBATER_LIVE_CASE`.

Credentials never enter reports, screenshots, recovery journal, or source fingerprint. Error text redacts supplied passwords.

## Coverage boundary

Live catalog covers every shipped user-feature family: startup/runtime contract, GM/player panel access, compact/refresh, action browser/search/add, Auto-fill/alternatives/resource horizon/preference learning, draft editing/reorder, target/movement controls, live movement undo, native strike contract, area/sustain execution seams, NPC/PC tactics, Turn Intent, Intel/Recall Knowledge, Loadout, Effect Clock, combat tracker, token-follow, player draft socket sync, player access transitions, persisted window geometry, native sheets, reset, localization, minions, and optional Visioner integration.

Fast deterministic self-tests remain authoritative for combinatorial scoring, all class catalogs, spell classification, PF2e rule matrices, and failure injection. Live suite validates real Foundry/PF2e/browser integration rather than repeating those pure matrices. The `standalone-combat-options` case checks flanking, Defend shield, and Quick-Tempered Rage with panel auto-open disabled.
