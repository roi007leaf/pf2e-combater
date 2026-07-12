# GM Tactic Personality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GM-only NPC tactic personalities that affect Auto Fill and Shuffle scoring/targeting.

**Architecture:** Add one focused tactic module that owns flag resolution, preset normalization, action scoring deltas, target priority deltas, and UI option data. Wire it into existing scoring and aggro seams so Auto Fill and Shuffle both consume the same adjusted candidate scores. Expose a compact GM-only panel chip and DialogV2 editor that writes actor default or token override flags.

**Tech Stack:** FoundryVTT v14 ApplicationV2/DialogV2, PF2e system data, ES modules, Handlebars, module flags, existing self-test harness.

---

### Task 1: Tactic Rules Module

**Files:**
- Create: `scripts/rules/tactic-personality.js`
- Test: `scripts/engine/self-test/runtime.test.js`

- [ ] Write failing runtime tests for flag precedence, invalid fallback, preset score changes, and target priority changes.
- [ ] Run `rtk node scripts/engine/self-test.js` and verify the new imports/functions fail because the module is missing.
- [ ] Implement `TACTIC_ROLES`, `TACTIC_TEMPERAMENTS`, `TACTIC_ACTION_SLIDERS`, `TACTIC_TARGET_SLIDERS`, `resolveTacticPersonality`, `tacticPersonalityAdjustment`, `tacticPersonalityTargetAdjustment`, and `tacticPersonalityView`.
- [ ] Run `rtk node scripts/engine/self-test.js` and verify the tactic module tests pass.

### Task 2: Scoring and Targeting Integration

**Files:**
- Modify: `scripts/engine/scoring.js`
- Modify: `scripts/rules/aggro.js`
- Test: `scripts/engine/self-test/runtime.test.js`
- Test: `scripts/engine/self-test/source-architecture.test.js`

- [ ] Write failing tests proving Boss favors high-impact multi-action options, Cautious favors defense, Aggressive favors damage, and custom target sliders change best target selection.
- [ ] Run self-test and verify failure before wiring production code.
- [ ] Import `tacticPersonalityAdjustment` in scoring and apply it after `npcTacticAdjustment`.
- [ ] Import `tacticPersonalityTargetAdjustment` in aggro and add it to `aggroTargetValue`.
- [ ] Add source-architecture assertions that scoring and aggro depend on `tactic-personality.js`.
- [ ] Run self-test and verify scoring/target tests pass.

### Task 3: Panel UI and Flag Writes

**Files:**
- Modify: `scripts/ui/panel/context-workflow.js`
- Modify: `scripts/ui/panel/event-bindings.js`
- Modify: `scripts/ui/CombaterPanel.js`
- Modify: `templates/combater-panel.hbs`
- Modify: `styles/combater.css`
- Modify: `lang/en.json`
- Test: `scripts/engine/self-test/source-architecture.test.js`

- [ ] Write failing source tests proving `data-configure-tactic`, `tacticPersonality`, actor flag write, token flag write, and token override reset exist.
- [ ] Run self-test and verify failure before UI code.
- [ ] Add tactic view data to `viewPanelContext`.
- [ ] Render a GM-only NPC tactic chip in the header.
- [ ] Bind chip click to `panel._configureTacticPersonality()`.
- [ ] Implement DialogV2 tactic editor in `CombaterPanel.js` with actor default, token override, reset override, role/temperament/custom sliders, and refresh on save.
- [ ] Add compact styles and localization strings.
- [ ] Run self-test and verify UI source tests pass.

### Task 4: Refresh and Verification

**Files:**
- Modify: `scripts/main.js`
- Test: `scripts/engine/self-test/source-architecture.test.js`

- [ ] Write failing source test proving token flag updates under `flags.pf2e-combater.tacticPersonalityOverride` refresh panel.
- [ ] Run self-test and verify failure.
- [ ] Update `updateToken` hook to schedule refresh for tactic override flag changes without requiring geometry changes.
- [ ] Run `rtk node scripts/engine/self-test.js`.
- [ ] Run `rtk npx eslint scripts/rules/tactic-personality.js scripts/rules/aggro.js scripts/engine/scoring.js scripts/ui/CombaterPanel.js scripts/ui/panel/context-workflow.js scripts/ui/panel/event-bindings.js`.
- [ ] Run `rtk git diff --check`.
