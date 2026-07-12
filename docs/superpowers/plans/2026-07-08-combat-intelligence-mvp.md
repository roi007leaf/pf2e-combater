# Combat Intelligence MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add terrain-aware route scoring, a GM Recall Knowledge intel ledger, and a minion subturn preview for Command an Animal.

**Architecture:** Keep the implementation in focused rules modules. Terrain scoring reuses the existing route cost engine. Intel ledger gates existing defense scoring and exposes only actor-saved learned categories to players in later combats. Minion planning attaches a compact two-action subturn summary to Command actions.

**Tech Stack:** FoundryVTT v14 ApplicationV2/DialogV2, PF2e actor/token data, ES modules, existing self-test harness.

---

### Task 1: Terrain Route Cost Preservation

**Files:**
- Modify: `scripts/readers/action/reach.js`
- Modify: `scripts/engine/scoring/activity-tactics.js`
- Test: `scripts/engine/self-test/runtime.test.js`

- [ ] Preserve `cost` and `route` from `engineReachableMovementCenters`.
- [ ] Keep `compareTacticalCenters` cost-aware by passing those fields through.
- [ ] Add a scoring reason/penalty when a positional move spends most of its route budget.
- [ ] Run `rtk npm test`.

### Task 2: Recall Knowledge Intel Ledger

**Files:**
- Create: `scripts/rules/intel-ledger.js`
- Modify: `scripts/engine/scoring/facts.js`
- Modify: `scripts/ui/CombaterPanel.js`
- Modify: `scripts/ui/panel/context-workflow.js`
- Modify: `scripts/ui/panel/event-bindings.js`
- Modify: `templates/combater-panel.hbs`
- Modify: `styles/combater.css`
- Modify: `lang/en.json`
- Test: `scripts/engine/self-test/runtime.test.js`
- Test: `scripts/engine/self-test/source-architecture.test.js`

- [ ] Add ledger categories and flag normalization.
- [ ] Gate save/trait/weakness/resistance/immunity scoring by known categories.
- [ ] Store learned categories on the target actor and copy only known categories into player combat context.
- [ ] Add GM-only Intel button and DialogV2 editor.
- [ ] Show players a read-only Intel dialog with the exact revealed facts on current NPCs.
- [ ] Refresh plans after ledger writes.
- [ ] Run `rtk npm test`.

### Task 3: Minion Subturn Planner

**Files:**
- Create: `scripts/rules/minion-planner.js`
- Modify: `scripts/engine/scoring/tactics.js`
- Modify: `scripts/engine/scoring.js`
- Modify: `scripts/ui/panel/view-model.js`
- Modify: `templates/combater-panel.hbs`
- Modify: `styles/combater.css`
- Modify: `lang/en.json`
- Test: `scripts/engine/self-test/runtime.test.js`
- Test: `scripts/engine/self-test/source-architecture.test.js`

- [ ] Build a simple two-action minion plan from detected minion strikes and enemy distance.
- [ ] Attach the plan to `Command an Animal` action scoring.
- [ ] Render the minion plan as a detail chip under the draft step.
- [ ] Run `rtk npm test`.

### Task 4: Final Verification

**Files:**
- All changed files.

- [ ] Run `rtk npm test`.
- [ ] Run `rtk npm run lint`.
- [ ] Run `rtk npm run build`.
- [ ] Run `rtk git diff --check`.
- [ ] Confirm no commit is created.
