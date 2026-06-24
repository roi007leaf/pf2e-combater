# Unconditional Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Unconditional actions" list to the combater panel — a second, manually-managed list of real, executable actions that runs alongside the plan but is excluded from the action-economy budget, planner scoring, and slot tracking.

**Architecture:** Store unconditional actions in a separate `draft.unconditional` array on the same per-combatant draft. Every budget/scoring/slot path reads `draft.steps`, so a separate array is off-budget with no exclusion checks. Reuse the existing step shape, the `decorateDraftStep` UI decorator, and `executeDraftStep`/`revertDraftStep` so each chip gets full targeting/movement/roll/revert. A toggle routes the action-library `+` to either list. The header Reset reverts both lists in reverse execution order.

**Tech Stack:** Foundry VTT v12, PF2e system, ApplicationV2 + Handlebars. Plain ES modules (no TypeScript). Single-file assert-based self-test.

## Global Constraints

- Validation gates (run from repo root `c:/Users/User/AppData/Local/FoundryVTT/Data/modules/pf2e-combater`): `npx eslint scripts/` must report no errors, and `node scripts/engine/self-test.js` must print `PF2e Combater self-test passed`. Ignore jest/prettier.
- Tests live in the single file `scripts/engine/self-test.js`, appended as top-level `assert` statements (Node's `node:assert/strict` is already imported there). There is no per-file test runner; "run the test" always means running the whole self-test.
- Plain JavaScript only. No new dependencies.
- The draft step shape is shared by both lists: `{ instanceId, actionKey, actionCost, requiresDestination?, destination?, targetTokenIds?, targetLabel?, areaMarker?, sustainedSpell?, execution? }`. `execution` is `{ status: "pending"|"done"|"failed", completedAt?, result?, error?, revert? }`.
- The working UI label is exactly `Unconditional actions`; the toggle labels are exactly `Plan` and `Unconditional`.
- Off-budget is the core invariant: nothing in `draft.unconditional` may affect `remainingTotalActions`, `remainingNormalActions`, `usage`, planner scoring, or slot reservation.

---

### Task 1: Persist `unconditional` and generalize draft-step list helpers

**Files:**
- Modify: `scripts/state/draft-plans.js`
- Test: `scripts/engine/self-test.js` (append near the existing `draftPlanKey`/`clearDraftPlan` tests, ~line 2018-2080)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `emptyDraftPlan(): { steps: [], unconditional: [], updatedAt: number }`
  - `readDraftPlan(context)` / `writeDraftPlan(context, draft)` round-trip an `unconditional` array.
  - `upsertDraftStep(context, step, listKey = "steps")`
  - `removeDraftStep(context, instanceId, listKey = "steps")`
  - `moveDraftStep(context, instanceId, direction, listKey = "steps"): boolean`
  - `draftListForInstance(draft, instanceId): "steps" | "unconditional"` (exported)
  - `hasSharedDraftPlan` / `shouldDisplaySharedDraft` treat an unconditional-only draft as a real shared plan.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/engine/self-test.js` (the file already imports the draft-plans module — confirm the names below are in its import block near the top; `draftListForInstance` is new and must be added to that import). Use a fresh in-memory localStorage stub so the test is isolated:

```js
// --- Unconditional actions: draft storage (Task 1) ---
{
  const previousStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
  const previousGame = globalThis.game;
  globalThis.game = { user: { id: "user-1", name: "Player One" } };
  const ctx = { combat: { id: "combat-uc" }, combatant: { id: "combatant-uc" } };
  try {
    // Default plan has both lists.
    assert.deepEqual(emptyDraftPlan().unconditional, [], "emptyDraftPlan should include an unconditional list");

    // upsert routes to the requested list and does not touch the other.
    upsertDraftStep(ctx, { instanceId: "p1", actionKey: "stride", actionCost: 1 }, "steps");
    upsertDraftStep(ctx, { instanceId: "u1", actionKey: "stride", actionCost: 1 }, "unconditional");
    upsertDraftStep(ctx, { instanceId: "u2", actionKey: "strike", actionCost: 1 }, "unconditional");
    let draft = readDraftPlan(ctx);
    assert.deepEqual(draft.steps.map((s) => s.instanceId), ["p1"], "plan list should hold only plan steps");
    assert.deepEqual(draft.unconditional.map((s) => s.instanceId), ["u1", "u2"], "unconditional list should hold its own steps");

    // draftListForInstance resolves which list owns an instanceId.
    assert.equal(draftListForInstance(draft, "p1"), "steps");
    assert.equal(draftListForInstance(draft, "u2"), "unconditional");
    assert.equal(draftListForInstance(draft, "missing"), "steps", "unknown ids default to the plan list");

    // move and remove operate on the chosen list.
    assert.equal(moveDraftStep(ctx, "u2", -1, "unconditional"), true);
    draft = readDraftPlan(ctx);
    assert.deepEqual(draft.unconditional.map((s) => s.instanceId), ["u2", "u1"], "move should reorder within the unconditional list");
    removeDraftStep(ctx, "u1", "unconditional");
    draft = readDraftPlan(ctx);
    assert.deepEqual(draft.unconditional.map((s) => s.instanceId), ["u2"], "remove should drop only the targeted unconditional step");
    assert.deepEqual(draft.steps.map((s) => s.instanceId), ["p1"], "removing an unconditional step must not affect the plan");

    // A draft with only unconditional entries still counts as a real shared plan.
    assert.equal(hasSharedDraftPlan({ steps: [], unconditional: [{ instanceId: "u" }] }), true,
      "an unconditional-only draft should be shareable");
    assert.equal(shouldDisplaySharedDraft({ steps: [], unconditional: [] }, { steps: [], unconditional: [{ instanceId: "u" }], updatedAt: 5 }), true,
      "a shared draft with unconditional entries should display over an empty local draft");
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.game = previousGame;
  }
}
```

Add `draftListForInstance` to the existing `draft-plans.js` import block in `self-test.js` (alongside `readDraftPlan`, `writeDraftPlan`, etc.).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — `draftListForInstance` is not exported (ReferenceError / import error), or the `unconditional` assertions throw.

- [ ] **Step 3: Implement the storage changes**

In `scripts/state/draft-plans.js`:

Replace `emptyDraftPlan`:

```js
export function emptyDraftPlan() {
  return { steps: [], unconditional: [], updatedAt: Date.now() };
}
```

Replace `readDraftPlan`:

```js
export function readDraftPlan(context) {
  const drafts = readStoredDrafts();
  const draft = drafts[draftPlanKey(context)];
  if (!draft || !Array.isArray(draft.steps)) return emptyDraftPlan();
  return {
    ...draft,
    steps: [...draft.steps],
    unconditional: Array.isArray(draft.unconditional) ? [...draft.unconditional] : [],
    updatedAt: Number.isFinite(Number(draft.updatedAt)) ? Number(draft.updatedAt) : Date.now(),
  };
}
```

Replace `writeDraftPlan`:

```js
export function writeDraftPlan(context, draft) {
  const drafts = readStoredDrafts();
  drafts[draftPlanKey(context)] = {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    unconditional: Array.isArray(draft?.unconditional) ? [...draft.unconditional] : [],
    updatedAt: Date.now(),
  };
  writeStoredDrafts(drafts);
}
```

Replace `normalizeSharedDraft`:

```js
function normalizeSharedDraft(draft) {
  return {
    ...draft,
    steps: Array.isArray(draft?.steps) ? [...draft.steps] : [],
    unconditional: Array.isArray(draft?.unconditional) ? [...draft.unconditional] : [],
    updatedAt: Number.isFinite(Number(draft?.updatedAt)) ? Number(draft.updatedAt) : Date.now(),
    userId: draft?.userId ?? null,
    userName: draft?.userName ?? "",
  };
}
```

Replace the `hasSteps` helper and the two consumers:

```js
function hasSteps(draft) {
  return Array.isArray(draft?.steps) && draft.steps.length > 0;
}

function hasUnconditional(draft) {
  return Array.isArray(draft?.unconditional) && draft.unconditional.length > 0;
}

function hasAnyEntries(draft) {
  return hasSteps(draft) || hasUnconditional(draft);
}

export function hasSharedDraftPlan(draft) {
  return hasAnyEntries(draft)
    || Boolean(draft?.userId)
    || Boolean(String(draft?.userName ?? "").trim())
    || draft?.type === "shareDraft";
}

export function shouldDisplaySharedDraft(localDraft, sharedDraft) {
  if (!hasSharedDraftPlan(sharedDraft)) return false;
  if (!hasAnyEntries(localDraft)) return true;
  if (localDraft?.source === "shared") return true;

  const localUpdatedAt = Number(localDraft?.updatedAt);
  const sharedUpdatedAt = Number(sharedDraft?.updatedAt);
  if (!Number.isFinite(sharedUpdatedAt)) return false;
  if (!Number.isFinite(localUpdatedAt)) return true;
  return sharedUpdatedAt > localUpdatedAt;
}
```

Replace `upsertDraftStep`, `removeDraftStep`, `moveDraftStep` with list-key-aware versions and add `draftListForInstance`:

```js
export function upsertDraftStep(context, step, listKey = "steps") {
  const draft = readDraftPlan(context);
  const normalizedStep = {
    ...step,
    instanceId: step?.instanceId ?? draftStepId(),
  };
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  const stepIndex = list.findIndex((entry) => entry.instanceId === normalizedStep.instanceId);
  const nextList = [...list];
  if (stepIndex >= 0) nextList[stepIndex] = normalizedStep;
  else nextList.push(normalizedStep);
  writeDraftPlan(context, { ...draft, [listKey]: nextList });
  return normalizedStep;
}

export function removeDraftStep(context, instanceId, listKey = "steps") {
  const draft = readDraftPlan(context);
  const list = Array.isArray(draft[listKey]) ? draft[listKey] : [];
  writeDraftPlan(context, {
    ...draft,
    [listKey]: list.filter((step) => step.instanceId !== instanceId),
  });
}

export function moveDraftStep(context, instanceId, direction, listKey = "steps") {
  const draft = readDraftPlan(context);
  const steps = Array.isArray(draft[listKey]) ? [...draft[listKey]] : [];
  const index = steps.findIndex((step) => step.instanceId === instanceId);
  const offset = Math.sign(Number(direction) || 0);
  const nextIndex = index + offset;
  if (index < 0 || offset === 0 || nextIndex < 0 || nextIndex >= steps.length) return false;

  [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
  writeDraftPlan(context, { ...draft, [listKey]: steps });
  return true;
}

// Which draft list owns this instanceId. Plan steps are the default for unknown ids so a
// brand-new plan step still routes correctly.
export function draftListForInstance(draft, instanceId) {
  const unconditional = Array.isArray(draft?.unconditional) ? draft.unconditional : [];
  return unconditional.some((step) => step?.instanceId === instanceId) ? "unconditional" : "steps";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add scripts/state/draft-plans.js scripts/engine/self-test.js
git commit -m "feat: store unconditional actions as a separate draft list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Reset and revert both lists together

**Files:**
- Modify: `scripts/engine/action-executor.js` (`resetDraftExecution`, ~line 233)
- Modify: `scripts/engine/action-revert.js` (`revertDraftExecution`, ~line 393)
- Test: `scripts/engine/self-test.js` (append after the existing revert-all test, ~line 1900)

**Interfaces:**
- Consumes: `revertDraftStep` (unchanged), draft shape from Task 1.
- Produces:
  - `resetDraftExecution(draft)` resets `execution.status` to `pending` for both `steps` and `unconditional` (only adds an `unconditional` key when the input had one).
  - `revertDraftExecution({ context, draft, contextForStep })` reverts every `done` step across both lists in reverse execution order (by `execution.completedAt` desc, ties broken by reverse list position so plan-only behavior is unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/engine/self-test.js`:

```js
// --- Unconditional actions: unified reset/revert (Task 2) ---
{
  const reverted = [];
  const ctx = {};
  const draft = {
    steps: [
      { instanceId: "p1", execution: { status: "done", completedAt: 100, revert: { ops: [{ kind: "marker", id: "p1" }] } } },
    ],
    unconditional: [
      { instanceId: "u1", execution: { status: "done", completedAt: 300, revert: { ops: [{ kind: "marker", id: "u1" }] } } },
      { instanceId: "u2", execution: { status: "done", completedAt: 200, revert: { ops: [{ kind: "marker", id: "u2" }] } } },
    ],
  };
  // resetDraftExecution clears both lists.
  const reset = resetDraftExecution(draft);
  assert.ok(reset.steps.every((s) => s.execution.status === "pending"), "reset should clear plan step status");
  assert.ok(reset.unconditional.every((s) => s.execution.status === "pending"), "reset should clear unconditional status");

  // revertDraftExecution reverts newest-first across both lists.
  const result = await revertDraftExecution({
    context: ctx,
    draft,
    contextForStep: (step) => { reverted.push(step.instanceId); return ctx; },
  });
  assert.deepEqual(reverted, ["u1", "u2", "p1"], "revert order should be newest completedAt first across both lists");
  assert.ok(result.draft.unconditional.every((s) => s.execution.status === "pending"), "returned draft should reset unconditional");
}
```

(Note: `contextForStep` is called once per reverted step, so pushing inside it records revert order. `revertDraftStep` tolerates the `marker` op kind — unknown kinds return `undefined` from `applyRevertOp` and are ignored.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — `reverted` equals `["u1","p1"]`-ish order missing unconditional, or `result.draft.unconditional` is undefined (current `revertDraftExecution` only walks `draft.steps`).

- [ ] **Step 3: Implement reset + revert**

In `scripts/engine/action-executor.js`, replace `resetDraftExecution`:

```js
export function resetDraftExecution(draft) {
  const resetList = (list) => (Array.isArray(list) ? list : []).map((step) => ({
    ...step,
    execution: { status: "pending" },
  }));
  return {
    ...(draft ?? {}),
    steps: resetList(draft?.steps),
    ...(Array.isArray(draft?.unconditional) ? { unconditional: resetList(draft.unconditional) } : {}),
  };
}
```

In `scripts/engine/action-revert.js`, replace `revertDraftExecution`:

```js
// Revert every completed step across the plan and unconditional lists in reverse execution
// order, then return the status-reset draft. Ordering is by execution.completedAt (newest
// first); ties fall back to reverse list position so plan-only drafts behave exactly as before.
// `contextForStep` lets callers resolve a per-step context (multi-combatant drafts).
export async function revertDraftExecution({ context, draft, contextForStep } = {}) {
  const steps = Array.isArray(draft?.steps) ? draft.steps : [];
  const unconditional = Array.isArray(draft?.unconditional) ? draft.unconditional : [];
  const warnings = [];
  const executed = [...steps, ...unconditional]
    .map((step, index) => ({ step, index, at: Number(step?.execution?.completedAt) || 0 }))
    .filter((entry) => entry.step?.execution?.status === "done")
    .sort((left, right) => (right.at - left.at) || (right.index - left.index));
  for (const { step } of executed) {
    const stepContext = contextForStep?.(step) ?? context;
    const result = await revertDraftStep({ context: stepContext, step });
    warnings.push(...(result.warnings ?? []));
  }
  return { draft: resetDraftExecution(draft), warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed` (the existing plan-only revert-all test at ~line 1883 must still pass — its two steps have equal/near-equal `completedAt`, and the reverse-index tiebreaker preserves the original `["sickened","prone"]` order).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add scripts/engine/action-executor.js scripts/engine/action-revert.js scripts/engine/self-test.js
git commit -m "feat: reset and revert unconditional actions with the plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Resolve `draft.unconditional` in the builder model

**Files:**
- Modify: `scripts/engine/action-builder.js` (`buildActionBuilderModel` return, ~line 1020-1024)
- Test: `scripts/engine/self-test.js` (append near the existing `buildActionBuilderModel` tests, e.g. after the draft test at ~line 2271)

**Interfaces:**
- Consumes: `resolveDraftSteps(draft, actionByKey, uniqueBaseKeys, draftStepActions)` (existing, file-local), the draft shape from Task 1.
- Produces: `buildActionBuilderModel(...).draft.unconditional` — an array of resolved (data-decorated) unconditional steps, parallel to `.draft.steps`. The action budget (`remainingTotalActions`, `usage`) is computed only from `draft.steps` and is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `scripts/engine/self-test.js` (reuse the existing `builderContext`/`builderCandidates` fixtures already defined for builder tests; if unsure of their names, build a minimal context inline as other builder tests do):

```js
// --- Unconditional actions: builder model resolves the list (Task 3) ---
{
  const ucModel = buildActionBuilderModel({
    context: { profile: { actions: 3 } },
    candidates: [],
    plans: [],
    draft: {
      steps: [{ instanceId: "p1", actionKey: "stride", actionCost: 1 }],
      unconditional: [
        { instanceId: "u1", actionKey: "stride", actionCost: 1 },
        { instanceId: "u2", actionKey: "strike", actionCost: 1 },
      ],
    },
  });
  assert.deepEqual(ucModel.draft.unconditional.map((s) => s.instanceId), ["u1", "u2"],
    "builder model should resolve the unconditional list parallel to steps");
  assert.equal(ucModel.draft.steps.length, 1, "plan steps should be unchanged");
  // Off-budget: a 2-action unconditional list must not change remaining actions.
  const baseModel = buildActionBuilderModel({
    context: { profile: { actions: 3 } },
    candidates: [],
    plans: [],
    draft: { steps: [{ instanceId: "p1", actionKey: "stride", actionCost: 1 }] },
  });
  assert.equal(ucModel.remainingTotalActions, baseModel.remainingTotalActions,
    "unconditional steps must not consume the action budget");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — `ucModel.draft.unconditional` is `undefined`.

- [ ] **Step 3: Implement the model field**

In `scripts/engine/action-builder.js`, in the `buildActionBuilderModel` return object, update the `draft` block (currently lines ~1020-1024):

```js
    draft: {
      ...(draft ?? {}),
      steps: draftSteps,
      unconditional: resolveDraftSteps({ steps: draft?.unconditional ?? [] }, actionByKey, uniqueBaseKeys, draftStepActions),
      warnings: draftSteps.filter((step) => step.warning).map((step) => step.warning),
    },
```

(`resolveDraftSteps` reads `draft.steps`, so wrapping the unconditional array as `{ steps: ... }` reuses the same resolver. `actionByKey`, `uniqueBaseKeys`, and `draftStepActions` are already in scope where `draftSteps` is computed — confirm by reading the lines just above the return; `draftSteps` is produced by `resolveDraftSteps(draft, actionByKey, uniqueBaseKeys, draftStepActions)`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add scripts/engine/action-builder.js scripts/engine/self-test.js
git commit -m "feat: resolve the unconditional draft list in the builder model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Decorate the unconditional list + add-target view state

**Files:**
- Modify: `scripts/ui/CombaterPanel.js` (`decorateBuilder`, ~line 596-656)
- Test: `scripts/engine/self-test.js` (append after Task 3's test; `decorateBuilder` is module-private, so test through `buildActionBuilderModel` + a small exported wrapper OR via source-shape assertions — see note)

**Interfaces:**
- Consumes: `buildActionBuilderModel(...).draft.unconditional` (Task 3), the file-local `decorateDraftStep(step, index, opts)` UI decorator, `executionStatus`, `nextPendingExecutionStep`.
- Produces: a decorated builder with:
  - `builder.unconditional = { hasEntries: boolean, entries: DecoratedStep[] }`
  - `builder.addTarget` (`"plan"` | `"unconditional"`) and `builder.addTargets` (`[{ id, label, active }]`)
  - `builder.canManageUnconditional` (boolean — editable, or GM running a player plan)
  - `builder.execution` counters fold in unconditional `done`/`failed` steps (so the header Reset and the `X/Y done` counter cover both lists).

**Note on testing:** `decorateBuilder` is not exported. Do **not** add behavioral assertions that import it. Instead cover this task with source-shape assertions on `CombaterPanel.js` (matching the existing convention used for panel internals, e.g. the `panelSource.includes(...)` tests near line 200-240). The behavioral guarantees (resolution + off-budget) are already covered by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/engine/self-test.js` (the file already reads `CombaterPanel.js` into `panelSource` for other assertions — reuse that variable):

```js
// --- Unconditional actions: panel decoration + add-target (Task 4) ---
assert.ok(/unconditional:\s*\{\s*\n?\s*hasEntries/.test(panelSource) || panelSource.includes("unconditional: {"),
  "decorateBuilder should expose a builder.unconditional view-model");
assert.ok(panelSource.includes("addTargets"), "decorateBuilder should expose add-target options");
assert.ok(panelSource.includes("canManageUnconditional"), "decorateBuilder should expose canManageUnconditional");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — none of those strings exist yet.

- [ ] **Step 3: Implement the decoration**

In `scripts/ui/CombaterPanel.js`, change the `decorateBuilder` signature to accept `addTarget`:

```js
function decorateBuilder(builder, activeTab, searchQuery = "", { sustainedSpells = [], addTarget = "plan" } = {}) {
```

Inside `decorateBuilder`, after `const sustainedEntries = decoratedSustainedSpells(...)` (~line 620), add:

```js
  const rawUnconditional = builder.draft?.unconditional ?? [];
  const unconditionalReorderLocked = rawUnconditional.some((step) => executionStatus(step) !== "pending");
  const rawUnconditionalSteps = rawUnconditional.map((step, index) => decorateDraftStep(step, index, {
    readonly: draftReadonly,
    gmExecute: gmCanRunPlayerPlan,
    total: rawUnconditional.length,
    reorderLocked: unconditionalReorderLocked,
  }));
  const currentUnconditionalStep = nextPendingExecutionStep({ steps: rawUnconditionalSteps });
  const unconditionalEntries = rawUnconditionalSteps.map((step) => ({
    ...step,
    isCurrentExecution: step.instanceId === currentUnconditionalStep?.instanceId,
  }));
  const canManageUnconditional = draftReadonly !== true || gmCanRunPlayerPlan;
  const allExecutable = [...draftSteps, ...unconditionalEntries];
  const executedAll = allExecutable.filter((step) => step.executionStatus === "done").length;
  const canResetAll = allExecutable.some((step) => step.executionStatus === "done" || step.executionStatus === "failed");
```

Then replace the existing `executedCount` / `canResetExecution` definitions (lines ~617-618) so the header reflects both lists. Delete:

```js
  const executedCount = draftSteps.filter((step) => step.executionStatus === "done").length;
  const canResetExecution = draftSteps.some((step) => step.executionStatus === "done" || step.executionStatus === "failed");
```

and use `executedAll` / `canResetAll` in the `execution` block below.

In the returned object, add the new fields and update `execution`:

```js
    sustainedSpells: {
      hasEntries: sustainedEntries.length > 0,
      entries: sustainedEntries,
    },
    unconditional: {
      hasEntries: unconditionalEntries.length > 0,
      entries: unconditionalEntries,
    },
    addTarget: addTarget === "unconditional" ? "unconditional" : "plan",
    addTargets: [
      { id: "plan", label: "Plan", active: addTarget !== "unconditional" },
      { id: "unconditional", label: "Unconditional", active: addTarget === "unconditional" },
    ],
    canManageUnconditional,
    execution: {
      hasSteps: allExecutable.length > 0,
      canReset: (draftReadonly !== true || gmCanRunPlayerPlan) && canResetAll,
      progressLabel: executedAll > 0 ? `${executedAll}/${allExecutable.length} done` : "",
      hasStatus: ((draftReadonly !== true || gmCanRunPlayerPlan) && canResetAll) || executedAll > 0,
      current: currentExecutionStep ?? null,
      currentInstanceId: currentExecutionStep?.instanceId ?? "",
    },
```

(Leave the `draft:` block and `currentExecutionStep` for the plan strip as-is.)

Finally, update the `_prepareContext` call to `decorateBuilder` (~line 877) to pass the panel's add-target state:

```js
    this._builder = decorateBuilder(builderModel, this.activeTab, this.searchQuery, {
      sustainedSpells,
      addTarget: this._addTarget,
    });
```

(`this._addTarget` is initialized in Task 6; until then it is `undefined`, which falls back to `"plan"`. That is fine — Task 6 adds the field. If implementing strictly in order, the `undefined` default keeps this task working.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add scripts/ui/CombaterPanel.js scripts/engine/self-test.js
git commit -m "feat: decorate the unconditional list and add-target state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Template — add-target toggle + unconditional card

**Files:**
- Modify: `templates/combater-panel.hbs` (add toggle in the tabs/search area ~line 222-235; add the card after the sustained-spells `</section>` ~line 220)
- Test: `scripts/engine/self-test.js` (append; the file reads the template into `panelTemplateSource` for other assertions — reuse it)

**Interfaces:**
- Consumes: `builder.addTargets`, `builder.canManageUnconditional`, `builder.unconditional.entries` (Task 4). Each unconditional entry has the same fields as a decorated draft step (`instanceId`, `name`, `costClass`, `actionGlyphIcon`, `img`, `targetLabel`, `areaLabel`, `warning`, `executionStatus`, `isExecutionDone`, `isExecutionFailed`, `canShowExecuteStep`, `canExecuteStep`, `executionBlocked`, `executeTooltip`, `canRevertStep`, `canMoveStepUp`, `canMoveStepDown`, `requiresDestination`, `requiresTarget`, `requiresArea`, `hasAreaMarker`).
- Produces: DOM with `data-add-target`, the `combater-unconditional` card, and per-chip controls reusing the **same** `data-*` attributes as plan-step chips (`data-execute-draft-step`, `data-revert-draft-step`, `data-remove-draft-step`, `data-move-draft-step`/`data-move-direction`, `data-choose-target`, `data-choose-destination`, `data-choose-area`, `data-remove-area`, `data-open-draft-step`, `data-preview-draft-step`).

- [ ] **Step 1: Write the failing tests**

Append to `scripts/engine/self-test.js`:

```js
// --- Unconditional actions: template (Task 5) ---
assert.ok(panelTemplateSource.includes("data-add-target"), "template should render the add-target toggle");
assert.ok(panelTemplateSource.includes("builder.unconditional.hasEntries"), "template should gate the unconditional card");
assert.ok(panelTemplateSource.includes("combater-unconditional"), "template should render an unconditional card");
assert.ok(/data-add-target[\s\S]*Unconditional/.test(panelTemplateSource), "toggle should offer an Unconditional option");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — those strings are absent.

- [ ] **Step 3: Implement the template**

In `templates/combater-panel.hbs`, immediately **after** the sustained-spells `{{/if}}` block (after line ~220, before the `<nav class="combater-tabs">`), add the unconditional card:

```hbs
      {{#if builder.unconditional.hasEntries}}
        <section class="combater-unconditional-panel">
          <article class="combater-alt combater-builder-card combater-unconditional">
            <div class="combater-alt-head">
              <span class="combater-alt-title"><strong>Unconditional actions</strong></span>
            </div>
            <div class="combater-alt-details">
              {{#each builder.unconditional.entries}}
                <div class="combater-alt-step combater-unconditional-row status-{{executionStatus}} {{#if isCurrentExecution}}is-current{{/if}}" data-preview-draft-step="{{instanceId}}">
                  <span class="combater-step-cost {{costClass}}" data-tooltip="{{costLabel}}">
                    <img class="combater-cost-glyph" src="{{actionGlyphIcon}}" alt="{{costLabel}}">
                  </span>
                  <div class="combater-alt-step-body">
                    <h4>
                      <button type="button" class="combater-alt-promote" data-open-draft-step="{{instanceId}}" data-tooltip="{{name}}: {{reason}}">
                        {{#if img}}<img class="combater-action-img" src="{{img}}" alt="">{{/if}}
                        <span>{{name}}</span>
                      </button>
                      {{#if isExecutionDone}}<span class="combater-exec-badge is-done"><i class="fa-solid fa-check"></i> Done</span>{{/if}}
                      {{#if isExecutionFailed}}<span class="combater-exec-badge is-failed" data-tooltip="{{executionTooltip}}"><i class="fa-solid fa-triangle-exclamation"></i> Failed</span>{{/if}}
                    </h4>
                    {{#if hasStepDetails}}
                      <span class="combater-target">
                        {{#if targetLabel}}{{targetLabel}}{{/if}}{{#if areaLabel}} {{areaLabel}}{{/if}}{{#if warning}} - {{warning}}{{/if}}
                      </span>
                    {{/if}}
                  </div>
                  <div class="combater-unconditional-tools">
                    {{#if requiresTarget}}
                      <button type="button" class="combater-chip-tool" data-choose-target="{{instanceId}}" data-tooltip="Choose target" aria-label="Choose target for {{name}}"><i class="fa-solid fa-crosshairs"></i></button>
                    {{/if}}
                    {{#if requiresDestination}}
                      <button type="button" class="combater-chip-tool" data-choose-destination="{{instanceId}}" data-tooltip="Choose destination" aria-label="Choose destination for {{name}}"><i class="fa-solid fa-location-dot"></i></button>
                    {{/if}}
                    {{#if requiresArea}}
                      <button type="button" class="combater-chip-tool" data-choose-area="{{instanceId}}" data-tooltip="Place template" aria-label="Place template for {{name}}"><i class="fa-solid fa-draw-polygon"></i></button>
                    {{/if}}
                    {{#if hasAreaMarker}}
                      <button type="button" class="combater-chip-tool" data-remove-area="{{instanceId}}" data-tooltip="Remove template" aria-label="Remove template"><i class="fa-solid fa-eraser"></i></button>
                    {{/if}}
                    {{#if canMoveStepUp}}
                      <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="-1" data-tooltip="Move up" aria-label="Move {{name}} up"><i class="fa-solid fa-arrow-up"></i></button>
                    {{/if}}
                    {{#if canMoveStepDown}}
                      <button type="button" class="combater-chip-tool combater-step-move" data-move-draft-step="{{instanceId}}" data-move-direction="1" data-tooltip="Move down" aria-label="Move {{name}} down"><i class="fa-solid fa-arrow-down"></i></button>
                    {{/if}}
                    {{#if canShowExecuteStep}}
                      <button type="button" class="combater-chip-tool combater-step-run is-execute {{#if executionBlocked}}is-disabled{{/if}}" data-execute-draft-step="{{instanceId}}" data-tooltip="{{executeTooltip}}" aria-label="{{executeTooltip}}" {{#if executionBlocked}}disabled{{/if}}><i class="fa-solid fa-play"></i></button>
                    {{/if}}
                    {{#if canRevertStep}}
                      <button type="button" class="combater-chip-tool" data-revert-draft-step="{{instanceId}}" data-tooltip="Revert" aria-label="Revert {{name}}"><i class="fa-solid fa-rotate-left"></i></button>
                    {{/if}}
                    {{#unless readonly}}
                      <button type="button" class="combater-chip-tool danger" data-remove-draft-step="{{instanceId}}" data-tooltip="Remove" aria-label="Remove {{name}}"><i class="fa-solid fa-xmark"></i></button>
                    {{/unless}}
                  </div>
                </div>
              {{/each}}
            </div>
          </article>
        </section>
      {{/if}}
```

Then add the add-target toggle just inside the `<section class="combater-body">` block, above the tab content. Locate the `<div class="combater-search">` (line ~232) and insert **before** the `{{#each builder.tabsList}}` loop (or directly above the search input), the toggle:

```hbs
              {{#if builder.canManageUnconditional}}
                <div class="combater-add-target" role="group" aria-label="Add actions to">
                  <span class="combater-add-target-label">Add to</span>
                  {{#each builder.addTargets}}
                    <button type="button" class="combater-add-target-btn {{#if active}}active{{/if}}" data-add-target="{{id}}">{{label}}</button>
                  {{/each}}
                </div>
              {{/if}}
```

(If the cleanest insertion point inside the existing `{{#each builder.tabsList}}{{#if active}}` block is awkward, place the toggle just above `<nav class="combater-tabs">` at line ~222 instead — it only needs `builder.addTargets`, which is available there too.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add templates/combater-panel.hbs scripts/engine/self-test.js
git commit -m "feat: render the unconditional actions card and add-target toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Panel handlers — route adds, execute/revert/move/remove across both lists

**Files:**
- Modify: `scripts/ui/CombaterPanel.js` (constructor ~764-790; listener wiring ~942-1015; handlers ~1110-1296, 1395-1506, 1745-1868; import block ~24-45)
- Test: `scripts/engine/self-test.js` (append; reuse `panelSource`)

**Interfaces:**
- Consumes: `draftListForInstance` (Task 1, import from `../state/draft-plans.js`); `upsertDraftStep`/`removeDraftStep`/`moveDraftStep` (now list-key aware, Task 1); `builder.unconditional.entries` (Task 4); `this._addTarget`.
- Produces: panel behavior — the `+` routes by `this._addTarget`; execute/target/destination/area/revert/remove/move resolve a step from whichever list owns it and persist back to that list; the header Reset (`_resetExecution`) reverts both lists; auto-fill preserves the unconditional list.

**Note on testing:** Panel methods are not unit-instantiable here; cover with `panelSource` source-shape assertions (existing convention). The list-routing *logic* itself is the pure `draftListForInstance`, already behaviorally tested in Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/engine/self-test.js`:

```js
// --- Unconditional actions: panel handlers (Task 6) ---
assert.ok(panelSource.includes("draftListForInstance"), "panel should resolve a step's list before persisting");
assert.ok(panelSource.includes("_addUnconditionalAction"), "panel should have an unconditional add handler");
assert.ok(panelSource.includes("data-add-target"), "panel should wire the add-target toggle");
assert.ok(panelSource.includes("_setAddTarget"), "panel should have an add-target setter");
assert.ok(panelSource.includes("this._addTarget"), "panel should track the active add target");
assert.ok(panelSource.includes("_findActiveStep"), "panel should look up steps across both lists");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/engine/self-test.js`
Expected: FAIL — those identifiers are absent.

- [ ] **Step 3: Implement the handlers**

In the `draft-plans.js` import block (~line 24-45), add `draftListForInstance`.

In the constructor (after `this._gmExecuteMode = false;`, ~line 781) add:

```js
    this._addTarget = "plan";
```

Add a `_findActiveStep` helper and an add-target setter (place them near `_findDraftStep`, ~line 1136):

```js
  _findActiveStep(instanceId) {
    const draft = this._readActiveDraftPlan();
    return (draft.steps ?? []).find((entry) => entry.instanceId === instanceId)
      ?? (draft.unconditional ?? []).find((entry) => entry.instanceId === instanceId)
      ?? null;
  }

  async _setAddTarget(target) {
    this._addTarget = target === "unconditional" ? "unconditional" : "plan";
    await this.render({ force: true });
  }
```

Update `_findDraftStep` (~line 1136) to search both decorated lists:

```js
  _findDraftStep(instanceId) {
    return this._builder?.draft?.steps?.find((step) => step.instanceId === instanceId)
      ?? this._builder?.unconditional?.entries?.find((step) => step.instanceId === instanceId)
      ?? null;
  }
```

Make `_persistActiveDraftStep` list-aware (~line 1162):

```js
  async _persistActiveDraftStep(step, listKey) {
    const targetList = listKey ?? draftListForInstance(this._readActiveDraftPlan(), step.instanceId);
    if (this._gmExecuteMode === true) {
      const draft = readSharedDraftPlan(this._context);
      const list = [...(draft[targetList] ?? [])];
      const index = list.findIndex((entry) => entry.instanceId === step.instanceId);
      if (index >= 0) list[index] = step;
      else list.push(step);
      await this._writeActiveSharedDraft({ ...draft, [targetList]: list });
      return;
    }
    upsertDraftStep(this._context, step, targetList);
    await this._syncDraftToGM();
  }
```

Branch `_addAction` (~line 1191) to route by add target, and add `_addUnconditionalAction`:

```js
  async _addAction(actionKey) {
    if (this._addTarget === "unconditional") return this._addUnconditionalAction(actionKey);
    if (!this._canEditDraft()) return;
    const action = this._findBuilderAction(actionKey);
    if (!this._context || !action) return;

    upsertDraftStep(this._context, {
      actionKey: action.key,
      actionCost: action.actionCost ?? action.cost,
      requiresDestination: requiresDestinationForAction(action),
    });
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _addUnconditionalAction(actionKey) {
    if (!this._canExecuteDraft()) return;
    const action = this._findBuilderAction(actionKey);
    if (!this._context || !action) return;
    await this._persistActiveDraftStep({
      instanceId: draftStepId(),
      actionKey: action.key,
      actionCost: action.actionCost ?? action.cost,
      requiresDestination: requiresDestinationForAction(action),
    }, "unconditional");
    clearActionPreview();
    await this.render({ force: true });
  }
```

Make remove/move list-aware (~line 1233, 1242):

```js
  async _removeDraftStep(instanceId) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    removeDraftStep(this._context, instanceId, draftListForInstance(this._readActiveDraftPlan(), instanceId));
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }

  async _moveDraftStep(instanceId, direction) {
    if (!this._canEditDraft()) return;
    if (!this._context || !instanceId) return;
    const listKey = draftListForInstance(readDraftPlan(this._context), instanceId);
    const draft = readDraftPlan(this._context);
    if ((draft[listKey] ?? []).some((step) => executionStatus(step) !== "pending")) {
      globalThis.ui?.notifications?.warn?.("Revert executed steps before reordering.");
      return;
    }
    if (!moveDraftStep(this._context, instanceId, direction, listKey)) return;
    await this._syncDraftToGM();
    clearActionPreview();
    await this.render({ force: true });
  }
```

Replace the four execution-handler step lookups that read `this._readActiveDraftPlan().steps.find(...)` with `this._findActiveStep(instanceId)`:
- in `_chooseDestination` `onChoose` (~line 1423): `const current = this._findActiveStep(instanceId) ?? step;`
- in `_chooseTarget` (~line 1453): `const current = this._findActiveStep(instanceId) ?? step;`
- in `_removeAreaTemplate` (~line 1464): `const current = this._findActiveStep(instanceId);`
- in `_applyExecutionResult` (~line 1837): `const current = this._findActiveStep(step.instanceId) ?? step;`
- in `_revertDraftStep` (~line 1846): `const current = this._findActiveStep(instanceId);`
- in `_chooseSustainedSpellForStep` (~line 1749): `const current = this._findActiveStep(step.instanceId) ?? step;`

Wire the toggle listener. In the listener-binding method (~line 942, alongside the `[data-add-action]` loop) add:

```js
    for (const button of element.querySelectorAll("[data-add-target]")) {
      button.addEventListener("click", () => this._setAddTarget(button.dataset.addTarget));
    }
```

Preserve the unconditional list in auto-fill (`_autoFillDraft`, ~line 1292): replace `writeDraftPlan(this._context, { steps });` with:

```js
    writeDraftPlan(this._context, { ...readDraftPlan(this._context), steps });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 5: Lint and commit**

```bash
npx eslint scripts/
git add scripts/ui/CombaterPanel.js scripts/engine/self-test.js
git commit -m "feat: route unconditional adds and execute both lists in the panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Styles, changelog, and final verification

**Files:**
- Modify: `styles/combater.css` (toggle + card styling)
- Modify: `CHANGELOG.md`
- Test: `scripts/engine/self-test.js` (no new test; final full run)

**Interfaces:**
- Consumes: the `combater-add-target`, `combater-add-target-btn`, `combater-unconditional`, `combater-unconditional-row`, `combater-unconditional-tools` classes from Task 5.
- Produces: visible, aligned styling consistent with the sustained-spells card and plan-step chips.

- [ ] **Step 1: Add styles**

Append to `styles/combater.css` (match the existing `.combater-sustained-*` and `.combater-alt-step` patterns already in the file — reuse their spacing/colors):

```css
.combater-add-target {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0 0 0.4rem;
}

.combater-add-target-label {
  font-size: 0.75rem;
  opacity: 0.75;
}

.combater-add-target-btn {
  padding: 0.1rem 0.5rem;
  border-radius: 0.4rem;
  font-size: 0.75rem;
  line-height: 1.4;
}

.combater-add-target-btn.active {
  background: var(--color-warm-2, #7a5);
  color: #fff;
}

.combater-unconditional-tools {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  margin-left: auto;
}
```

- [ ] **Step 2: Update the changelog**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, append:

```markdown
- **Unconditional actions.** A manually-managed list below the plan for real, executable
  actions (e.g. Sudden Charge's "Stride, Stride, Strike") that run alongside the plan but stay
  off the action-economy budget, the planner's scoring, and slot tracking. Add to it with the
  "Add to: Plan / Unconditional" toggle; each chip executes and reverts like a plan step, and
  the header Reset reverts both lists together.
```

- [ ] **Step 3: Run the full gates**

Run: `npx eslint scripts/`
Expected: `No issues found` (exit 0)

Run: `node scripts/engine/self-test.js`
Expected: `PF2e Combater self-test passed`

- [ ] **Step 4: Manual smoke test (Foundry, optional but recommended)**

In a live Foundry session: open the panel on a combatant, flip the toggle to **Unconditional**, add Stride + Stride + Strike, execute each (movement picker + strike roll fire), confirm the plan's action budget is unchanged, then press the header **Reset** and confirm both the plan and unconditional chips revert.

- [ ] **Step 5: Commit**

```bash
git add styles/combater.css CHANGELOG.md
git commit -m "feat: style unconditional actions and document the feature

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Data model (`draft.unconditional`, same step shape) → Task 1, Task 3.
- Off-budget (budget/scoring/slot untouched) → Task 1 (separate array) + Task 3 test asserting `remainingTotalActions` unchanged.
- Add via library + toggle → Task 4 (state), Task 5 (toggle UI), Task 6 (routing).
- Real execution via `executeDraftStep`, per-chip Execute + Revert → Task 5 (controls), Task 6 (handlers reuse existing execute path).
- Unified reset (both lists, reverse execution order) → Task 2 + Task 4 (counter folding) + Task 6 (`_resetExecution` already passes the whole draft).
- Shared/GM-runnable → Task 1 (`hasSharedDraftPlan`/`shouldDisplaySharedDraft`), Task 6 (`_persistActiveDraftStep` shared branch, `canManageUnconditional`/`_canExecuteDraft` gating).
- Cleared at turn end → no code change; `clearDraftPlan` deletes the whole key (covered by the existing turn-end path). Auto-fill preserves the list → Task 6.
- Not in plan strip → unconditional renders only in its own card (Task 5); `headerSteps` still reads `builder.draft.steps` only.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows real assertions. ✔

**3. Type consistency:** `listKey` defaults to `"steps"` everywhere; `draftListForInstance` returns `"steps"|"unconditional"`; `_persistActiveDraftStep(step, listKey)`, `upsertDraftStep(context, step, listKey)`, `removeDraftStep(context, instanceId, listKey)`, `moveDraftStep(context, instanceId, direction, listKey)` agree across tasks. `builder.unconditional.{hasEntries,entries}` and `builder.addTargets[{id,label,active}]` are produced in Task 4 and consumed in Task 5. ✔
