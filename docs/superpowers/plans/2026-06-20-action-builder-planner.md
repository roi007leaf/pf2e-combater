# Action Builder Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auto-plan-first panel with an encounter-scoped action builder where users compose their own turn from action-cost tabs, while the old planner remains as secondary Auto-fill/recommendation support.

**Architecture:** Add a small builder layer around existing candidates/scoring/planner code. Persist draft plans and favorites client-side, extend combat context selection beyond current turn, and update the panel/template/styles to render a plan tray plus action library tabs.

**Tech Stack:** Foundry VTT ApplicationV2 + Handlebars, PF2e actor/token data, browser `localStorage`, existing `buildCandidates`, `buildTurnPlans`, `movement-preview`, Jest self-test harness.

---

## File Map

- Create `scripts/state/action-favorites.js`: client-side favorite keys and read/write helpers.
- Create `scripts/state/draft-plans.js`: client-side draft plan keys, read/write/update helpers, stale-step marking.
- Create `scripts/engine/action-builder.js`: action tab grouping, recommendation grouping, budget availability, draft display model.
- Create `scripts/ui/destination-picker.js`: one-shot canvas destination pick mode for draft movement steps.
- Modify `scripts/constants.js`: add storage keys for favorites and draft plans.
- Modify `scripts/state/combat-context.js`: let caller request context for selected/explicit encounter combatant, not only active turn.
- Modify `scripts/ui/movement-preview.js`: support draft movement destinations and route drawing.
- Modify `scripts/ui/CombaterPanel.js`: switch from Plan/Alternatives/Debug UI model to builder model, wire add/remove/reorder/favorite/Auto-fill/destination controls.
- Modify `templates/combater-panel.hbs`: render action pool, draft tray, action tabs, GM debug foldout.
- Modify `styles/combater.css`: style action tray, tabs, disabled/crossed-out rows, favorite/recommended sections.
- Modify `scripts/main.js`: open/refresh encounter planner for selected/planned combatant; do not require current turn to show panel.
- Modify `scripts/engine/self-test.js`: add tests for storage keys, builder grouping, budget states, access gating, movement destination handling.

Because current worktree is already dirty, every implementation task must inspect path-specific diffs and commit only task files:

```bash
rtk git diff -- scripts/engine/action-builder.js scripts/state/draft-plans.js
rtk git commit --only scripts/engine/action-builder.js scripts/state/draft-plans.js scripts/engine/self-test.js -m "feat: add action builder model"
```

## Task 1: Encounter-Scoped Combat Context

**Files:**
- Modify: `scripts/state/combat-context.js`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add failing context-selection tests**

Append near existing combat-context tests in `scripts/engine/self-test.js`:

```js
const ownedActor = {
  id: "actor-owned",
  uuid: "Actor.actor-owned",
  name: "Owned Hero",
  img: "owned.webp",
  type: "character",
  system: { attributes: { hp: { value: 10, max: 10 } } },
  itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [] },
  items: [],
  testUserPermission: () => true,
};
const unownedActor = {
  ...ownedActor,
  id: "actor-unowned",
  uuid: "Actor.actor-unowned",
  name: "Unowned Hero",
  testUserPermission: () => false,
};
const selectedCombatant = {
  id: "combatant-owned",
  actor: ownedActor,
  name: "Owned Hero",
  tokenId: "token-owned",
  token: { object: { id: "token-owned", document: { id: "token-owned", x: 0, y: 0, width: 1, height: 1 }, actor: ownedActor } },
};
const unownedCombatant = {
  id: "combatant-unowned",
  actor: unownedActor,
  name: "Unowned Hero",
  tokenId: "token-unowned",
  token: { object: { id: "token-unowned", document: { id: "token-unowned", x: 5, y: 0, width: 1, height: 1 }, actor: unownedActor } },
};
globalThis.game = {
  user: { isGM: false },
  combat: {
    id: "combat-builder",
    round: 1,
    turn: 0,
    started: true,
    combatant: selectedCombatant,
    combatants: [selectedCombatant, unownedCombatant],
  },
};
globalThis.canvas = { grid: { size: 5 }, tokens: { placeables: [selectedCombatant.token.object, unownedCombatant.token.object] } };
const selectedContext = readCombatContext("test", { combatant: selectedCombatant });
assert.equal(selectedContext.combatant.id, "combatant-owned");
const blockedContext = readCombatContext("test", { combatant: unownedCombatant });
assert.equal(blockedContext, null);
globalThis.game.user.isGM = true;
const gmContext = readCombatContext("test", { combatant: unownedCombatant });
assert.equal(gmContext.combatant.id, "combatant-unowned");
```

- [ ] **Step 2: Run self-test and verify failure**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: FAIL because `readCombatContext` does not accept a combatant override.

- [ ] **Step 3: Update `readCombatContext` signature and selected combatant resolution**

In `scripts/state/combat-context.js`, change the export and first lines:

```js
function selectedEncounterCombatant(options = {}) {
  if (options.combatant) return options.combatant;
  const selectedToken = (globalThis.canvas?.tokens?.controlled ?? [])
    .find((token) => tokenInCombat(globalThis.game?.combat, token));
  if (!selectedToken) return globalThis.game?.combat?.combatant ?? null;
  const combatants = collectionValues(globalThis.game?.combat?.combatants);
  return combatants.find((combatant) => tokenMatchesCombatant(selectedToken, combatant))
    ?? globalThis.game?.combat?.combatant
    ?? null;
}

export function readCombatContext(refreshSource = "manual", options = {}) {
  const combat = options.combat ?? game?.combat ?? null;
  if (!combat?.started) return null;
  const combatant = selectedEncounterCombatant({ ...options, combat });
  const actor = combatant?.actor ?? null;
  if (!canReadActor(actor)) return null;
```

Replace later `game.combat` reads in returned `combat` object with local `combat`:

```js
combat: {
  id: combat.id,
  round: combat.round,
  turn: combat.turn,
  started: combat.started,
},
```

Replace `tokenInCombat(game?.combat, token)` and `movementActionsSpent(game?.combat)` calls with local `combat`.

- [ ] **Step 4: Run self-test and verify pass**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```bash
rtk git diff -- scripts/state/combat-context.js scripts/engine/self-test.js
rtk git add scripts/state/combat-context.js scripts/engine/self-test.js
rtk git commit --only scripts/state/combat-context.js scripts/engine/self-test.js -m "feat: support encounter combatant planning context"
```

## Task 2: Draft Plan and Favorites Storage

**Files:**
- Modify: `scripts/constants.js`
- Create: `scripts/state/action-favorites.js`
- Create: `scripts/state/draft-plans.js`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add failing storage tests**

Add imports in `scripts/engine/self-test.js`:

```js
import {
  favoriteKey,
  readActionFavorites,
  toggleActionFavorite,
} from "../state/action-favorites.js";
import {
  draftPlanKey,
  readDraftPlan,
  writeDraftPlan,
  upsertDraftStep,
  removeDraftStep,
} from "../state/draft-plans.js";
```

Append tests:

```js
const localStore = new Map();
globalThis.localStorage = {
  getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: (key) => localStore.delete(key),
};
const builderContext = {
  combat: { id: "combat-1", round: 2 },
  combatant: { id: "combatant-1" },
  actor: { uuid: "Actor.actor-1" },
};
assert.equal(favoriteKey(builderContext, "strike-longsword"), "user-1|Actor.actor-1|strike-longsword");
globalThis.game = { user: { id: "user-1" } };
assert.deepEqual(readActionFavorites(builderContext), new Set());
assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), true);
assert.deepEqual([...readActionFavorites(builderContext)], ["strike-longsword"]);
assert.equal(toggleActionFavorite(builderContext, "strike-longsword"), false);
assert.deepEqual([...readActionFavorites(builderContext)], []);

assert.equal(draftPlanKey(builderContext), "user-1|combat-1|2|combatant-1");
writeDraftPlan(builderContext, { steps: [] });
upsertDraftStep(builderContext, { instanceId: "step-1", actionKey: "stride", actionCost: 1 });
assert.equal(readDraftPlan(builderContext).steps[0].actionKey, "stride");
removeDraftStep(builderContext, "step-1");
assert.deepEqual(readDraftPlan(builderContext).steps, []);
```

- [ ] **Step 2: Run self-test and verify failure**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Extend storage keys**

Modify `scripts/constants.js`:

```js
export const STORAGE_KEYS = {
  panelState: `${MODULE_ID}.panelState`,
  actionFavorites: `${MODULE_ID}.actionFavorites`,
  draftPlans: `${MODULE_ID}.draftPlans`,
};
```

- [ ] **Step 4: Create favorites storage**

Create `scripts/state/action-favorites.js`:

```js
import { STORAGE_KEYS } from "../constants.js";

function userId() {
  return globalThis.game?.user?.id ?? "anonymous";
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Favorites are convenience state; panel works without storage.
  }
}

export function favoriteKey(context, actionKey) {
  return `${userId()}|${context?.actor?.uuid ?? context?.actor?.id ?? "actor"}|${actionKey}`;
}

function actorFavoritesKey(context) {
  return `${userId()}|${context?.actor?.uuid ?? context?.actor?.id ?? "actor"}`;
}

export function readActionFavorites(context) {
  const all = readJson(STORAGE_KEYS.actionFavorites, {});
  const values = all[actorFavoritesKey(context)];
  return new Set(Array.isArray(values) ? values : []);
}

export function writeActionFavorites(context, favorites) {
  const all = readJson(STORAGE_KEYS.actionFavorites, {});
  all[actorFavoritesKey(context)] = [...favorites].filter(Boolean);
  writeJson(STORAGE_KEYS.actionFavorites, all);
}

export function toggleActionFavorite(context, actionKey) {
  const favorites = readActionFavorites(context);
  if (favorites.has(actionKey)) {
    favorites.delete(actionKey);
    writeActionFavorites(context, favorites);
    return false;
  }
  favorites.add(actionKey);
  writeActionFavorites(context, favorites);
  return true;
}
```

- [ ] **Step 5: Create draft plan storage**

Create `scripts/state/draft-plans.js`:

```js
import { STORAGE_KEYS } from "../constants.js";

function userId() {
  return globalThis.game?.user?.id ?? "anonymous";
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Drafts are client convenience state; planner can still render.
  }
}

export function draftPlanKey(context) {
  return [
    userId(),
    context?.combat?.id ?? "no-combat",
    context?.combat?.round ?? 0,
    context?.combatant?.id ?? "no-combatant",
  ].join("|");
}

export function emptyDraftPlan() {
  return { steps: [], updatedAt: Date.now() };
}

export function readDraftPlan(context) {
  const all = readJson(STORAGE_KEYS.draftPlans, {});
  const draft = all[draftPlanKey(context)];
  return draft && Array.isArray(draft.steps) ? draft : emptyDraftPlan();
}

export function writeDraftPlan(context, draft) {
  const all = readJson(STORAGE_KEYS.draftPlans, {});
  all[draftPlanKey(context)] = {
    steps: Array.isArray(draft?.steps) ? draft.steps : [],
    updatedAt: Date.now(),
  };
  writeJson(STORAGE_KEYS.draftPlans, all);
}

export function upsertDraftStep(context, step) {
  const draft = readDraftPlan(context);
  const instanceId = step.instanceId ?? globalThis.foundry?.utils?.randomID?.() ?? `step-${Date.now()}`;
  const nextStep = { ...step, instanceId };
  const index = draft.steps.findIndex((entry) => entry.instanceId === instanceId);
  const steps = [...draft.steps];
  if (index >= 0) steps[index] = nextStep;
  else steps.push(nextStep);
  writeDraftPlan(context, { steps });
  return nextStep;
}

export function removeDraftStep(context, instanceId) {
  const draft = readDraftPlan(context);
  writeDraftPlan(context, {
    steps: draft.steps.filter((step) => step.instanceId !== instanceId),
  });
}

export function clearDraftPlan(context) {
  writeDraftPlan(context, emptyDraftPlan());
}
```

- [ ] **Step 6: Run self-test and verify pass**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS.

- [ ] **Step 7: Commit task**

Run:

```bash
rtk git diff -- scripts/constants.js scripts/state/action-favorites.js scripts/state/draft-plans.js scripts/engine/self-test.js
rtk git add scripts/constants.js scripts/state/action-favorites.js scripts/state/draft-plans.js scripts/engine/self-test.js
rtk git commit --only scripts/constants.js scripts/state/action-favorites.js scripts/state/draft-plans.js scripts/engine/self-test.js -m "feat: persist builder drafts and favorites"
```

## Task 3: Action Builder Engine

**Files:**
- Create: `scripts/engine/action-builder.js`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add failing builder tests**

Add import in `scripts/engine/self-test.js`:

```js
import {
  ACTION_BUILDER_TABS,
  actionBuilderKey,
  buildActionBuilderModel,
} from "./action-builder.js";
```

Append tests:

```js
const builderCandidates = [
  { id: "stride", slug: "stride", name: "Stride", actionCost: 1, score: 10, reason: "Move.", confidence: "medium" },
  { id: "fireball", slug: "fireball", name: "Fireball", actionCost: 2, score: 30, reason: "Blast.", confidence: "high" },
  { id: "shield", slug: "shield", name: "Shield", actionCost: 1, score: 20, reason: "Defend.", confidence: "medium" },
  { id: "wayfinder", slug: "wayfinder", name: "Wayfinder", actionCost: 0, score: 4, reason: "Free.", confidence: "low" },
  { id: "reactive-shield", slug: "reactive-shield", name: "Reactive Shield", actionCost: "reaction", score: 8, reason: "React.", confidence: "medium" },
];
const builderModel = buildActionBuilderModel({
  context: { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } },
  candidates: builderCandidates,
  plans: [{ id: "auto", steps: [builderCandidates[2], builderCandidates[1]], summary: "Shield -> Fireball" }],
  draft: { steps: [{ instanceId: "draft-1", actionKey: "fireball", actionCost: 2 }] },
  favorites: new Set(["shield"]),
});
assert.deepEqual(ACTION_BUILDER_TABS.map((tab) => tab.id), ["one", "two", "three", "free", "reaction"]);
assert.equal(actionBuilderKey(builderCandidates[0]), "stride");
assert.equal(builderModel.tabs.one.favorites[0].key, "shield");
assert.equal(builderModel.tabs.two.all[0].key, "fireball");
assert.equal(builderModel.tabs.two.all[0].disabled, true);
assert.equal(builderModel.tabs.two.all[0].disabledReason, "Not enough actions remaining.");
assert.equal(builderModel.tabs.free.all[0].key, "wayfinder");
assert.equal(builderModel.tabs.reaction.all[0].key, "reactive-shield");
assert.equal(builderModel.autoFill.summary, "Shield -> Fireball");
```

- [ ] **Step 2: Run self-test and verify failure**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: FAIL because `action-builder.js` does not exist.

- [ ] **Step 3: Create action builder module**

Create `scripts/engine/action-builder.js`:

```js
import { actionBudget } from "./planner.js";
import { confidenceLabel } from "./confidence.js";

export const ACTION_BUILDER_TABS = [
  { id: "one", label: "1 Action", cost: 1 },
  { id: "two", label: "2 Actions", cost: 2 },
  { id: "three", label: "3 Actions", cost: 3 },
  { id: "free", label: "Free", cost: 0 },
  { id: "reaction", label: "Reaction", cost: "reaction" },
];

const TAB_BY_COST = new Map(ACTION_BUILDER_TABS.map((tab) => [tab.cost, tab.id]));

export function actionBuilderKey(action) {
  return action?.id
    ?? action?.uuid
    ?? action?.item?.uuid
    ?? action?.slug
    ?? action?.name
    ?? "unknown-action";
}

function tabIdForAction(action) {
  const cost = action?.actionCost ?? 1;
  if (cost === "reaction") return "reaction";
  const numeric = Number(cost);
  if (numeric === 0) return "free";
  return TAB_BY_COST.get(Math.max(1, Math.min(3, numeric || 1))) ?? "one";
}

function draftUsage(draft) {
  return (draft?.steps ?? []).reduce((usage, step) => {
    if (step.actionCost === "reaction") usage.reaction += 1;
    else if (Number(step.actionCost) === 0) usage.free += 1;
    else usage.normal += Number(step.actionCost) || 1;
    return usage;
  }, { normal: 0, free: 0, reaction: 0 });
}

function actionCost(action) {
  return action?.actionCost ?? 1;
}

function disabledReasonFor(action, budget, usage) {
  const cost = actionCost(action);
  if (cost === "reaction") return usage.reaction >= 1 ? "Reaction already planned." : "";
  if (Number(cost) === 0) return "";
  const remaining = Math.max(0, budget.totalActions - usage.normal);
  return Number(cost) > remaining ? "Not enough actions remaining." : "";
}

function targetLabel(action) {
  const name = action?.suggestedTarget?.name ?? action?.preferredTarget?.name ?? "";
  return name ? `Target: ${name}` : "";
}

function decorateAction(action, { budget, usage, favorites }) {
  const key = actionBuilderKey(action);
  const disabledReason = disabledReasonFor(action, budget, usage);
  const confidence = action?.confidence ?? "low";
  return {
    ...action,
    key,
    tabId: tabIdForAction(action),
    cost: actionCost(action),
    favorite: favorites.has(key),
    disabled: Boolean(disabledReason) || action?.available === false,
    disabledReason: action?.available === false ? (action.reason ?? "Action unavailable.") : disabledReason,
    targetLabel: targetLabel(action),
    reason: action?.reason ?? action?.reasons?.[0] ?? "",
    confidenceLabel: confidenceLabel(confidence),
    confidenceClass: String(confidence),
  };
}

function emptyTab(tab) {
  return { ...tab, favorites: [], recommended: [], all: [] };
}

function topRecommended(actions) {
  return actions
    .filter((action) => !action.disabled)
    .toSorted((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0))
    .slice(0, 3);
}

function decorateDraftStep(step, actionsByKey) {
  const action = actionsByKey.get(step.actionKey);
  return {
    ...step,
    action,
    name: action?.name ?? step.name ?? "Unknown action",
    stale: !action,
    warning: !action
      ? "Action no longer available."
      : step.requiresDestination && !step.destination
        ? "Choose destination."
        : "",
  };
}

export function buildActionBuilderModel({ context, candidates, plans = [], draft, favorites = new Set() }) {
  const budget = actionBudget(context);
  const usage = draftUsage(draft);
  const actions = candidates.map((action) => decorateAction(action, { budget, usage, favorites }));
  const actionsByKey = new Map(actions.map((action) => [action.key, action]));
  const tabs = Object.fromEntries(ACTION_BUILDER_TABS.map((tab) => [tab.id, emptyTab(tab)]));

  for (const action of actions) {
    const tab = tabs[action.tabId] ?? tabs.one;
    tab.all.push(action);
    if (action.favorite) tab.favorites.push(action);
  }

  for (const tab of Object.values(tabs)) {
    tab.all.sort((left, right) => (Number(right.score) || 0) - (Number(left.score) || 0));
    tab.favorites.sort((left, right) => left.name.localeCompare(right.name));
    tab.recommended = topRecommended(tab.all);
  }

  return {
    context,
    budget,
    usage,
    remainingActions: Math.max(0, budget.totalActions - usage.normal),
    tabs,
    draft: {
      ...(draft ?? { steps: [] }),
      steps: (draft?.steps ?? []).map((step) => decorateDraftStep(step, actionsByKey)),
    },
    autoFill: plans[0] ?? null,
  };
}
```

- [ ] **Step 4: Run self-test and verify pass**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```bash
rtk git diff -- scripts/engine/action-builder.js scripts/engine/self-test.js
rtk git add scripts/engine/action-builder.js scripts/engine/self-test.js
rtk git commit --only scripts/engine/action-builder.js scripts/engine/self-test.js -m "feat: add action builder model"
```

## Task 4: Destination Picker and Explicit Movement Preview

**Files:**
- Create: `scripts/ui/destination-picker.js`
- Modify: `scripts/ui/movement-preview.js`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add failing explicit destination preview test**

Append to movement-preview tests in `scripts/engine/self-test.js`:

```js
const explicitMovementPreview = movementPreviewForStep({
  token: { id: "token-moving", center: { x: 0, y: 0 }, width: 1, height: 1 },
  actor: { profile: { speed: 25 } },
  battlefield: { targets: [] },
}, {
  slug: "stride",
  actionCost: 1,
  destination: { x: 10, y: 0 },
}, {
  gridSize: 5,
  pathBlocked: () => false,
  pointVisible: () => true,
});
assert.equal(explicitMovementPreview.enabled, true);
assert.equal(explicitMovementPreview.destinationCenter.x, 10);
assert.equal(explicitMovementPreview.stridePath.length, 1);
```

- [ ] **Step 2: Run self-test and verify failure**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: FAIL because `movementPreviewForStep` ignores `step.destination`.

- [ ] **Step 3: Add explicit destination support**

In `scripts/ui/movement-preview.js`, add near `movementPreviewForStep`:

```js
function explicitDestinationPath(context, step, origin, distanceFeet, footprint, gridSize, options = {}) {
  const destination = step?.destination;
  if (!destination) return null;
  const center = { x: numeric(destination.x, NaN), y: numeric(destination.y, NaN) };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  const route = directRouteToCenter(origin, center, distanceFeet, gridSize, options);
  if (!route) {
    return {
      enabled: true,
      slug: step.slug,
      origin,
      distanceFeet,
      footprint,
      illegal: true,
      destinationCenter: center,
      stridePath: [],
      reason: "Destination is no longer reachable.",
    };
  }
  return plannedStridePath(origin, center, route, footprint, gridSize, distanceFeet);
}
```

Then inside normal movement branch before reachable recommendations:

```js
const explicit = explicitDestinationPath(context, step, origin, distanceFeet, footprint, gridSize, movementOptions);
if (explicit) return explicit;
```

- [ ] **Step 4: Create destination picker module**

Create `scripts/ui/destination-picker.js`:

```js
let activePicker = null;

function canvasPosition(event) {
  const point = event?.data?.getLocalPosition?.(globalThis.canvas?.stage);
  if (point) return { x: point.x, y: point.y };
  const origin = globalThis.canvas?.app?.view?.getBoundingClientRect?.();
  if (!origin) return null;
  return { x: event.clientX - origin.left, y: event.clientY - origin.top };
}

function snapToGridCenter(position) {
  const grid = globalThis.canvas?.grid;
  const size = Number(grid?.size ?? 1) || 1;
  const snapped = typeof grid?.getSnappedPoint === "function"
    ? grid.getSnappedPoint(position, { mode: "center" })
    : {
      x: Math.floor(position.x / size) * size + size / 2,
      y: Math.floor(position.y / size) * size + size / 2,
    };
  return { x: Number(snapped.x), y: Number(snapped.y) };
}

export function cancelDestinationPicker() {
  if (!activePicker) return;
  const { layer, handler } = activePicker;
  layer?.off?.("pointerdown", handler);
  activePicker = null;
}

export function chooseDestination({ onChoose }) {
  cancelDestinationPicker();
  const layer = globalThis.canvas?.stage ?? globalThis.canvas?.app?.stage;
  if (!layer?.on) return false;
  const handler = (event) => {
    const position = canvasPosition(event);
    if (!position) return;
    const destination = snapToGridCenter(position);
    cancelDestinationPicker();
    onChoose?.(destination);
  };
  layer.on("pointerdown", handler);
  activePicker = { layer, handler };
  return true;
}
```

- [ ] **Step 5: Run self-test and verify pass**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS.

- [ ] **Step 6: Commit task**

Run:

```bash
rtk git diff -- scripts/ui/destination-picker.js scripts/ui/movement-preview.js scripts/engine/self-test.js
rtk git add scripts/ui/destination-picker.js scripts/ui/movement-preview.js scripts/engine/self-test.js
rtk git commit --only scripts/ui/destination-picker.js scripts/ui/movement-preview.js scripts/engine/self-test.js -m "feat: support planned movement destinations"
```

## Task 5: Builder Panel Wiring

**Files:**
- Modify: `scripts/ui/CombaterPanel.js`
- Modify: `templates/combater-panel.hbs`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add panel model smoke test**

In `scripts/engine/self-test.js`, add a model-level test through `buildActionBuilderModel` if importing `CombaterPanel` is too tied to Foundry UI:

```js
const selectedBuilder = buildActionBuilderModel({
  context: { combat: { id: "combat-ui", round: 1 }, combatant: { id: "c-ui" }, actor: { uuid: "Actor.ui" } },
  candidates: builderCandidates,
  plans: [],
  draft: { steps: [{ instanceId: "move-1", actionKey: "stride", actionCost: 1, requiresDestination: true }] },
  favorites: new Set(["shield"]),
});
assert.equal(selectedBuilder.draft.steps[0].warning, "Choose destination.");
assert.equal(selectedBuilder.remainingActions, 2);
```

- [ ] **Step 2: Run self-test and verify pass or existing failure**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS if Task 3 already covers model; any failure should point to missing draft warning behavior.

- [ ] **Step 3: Replace panel tabs/constants**

In `scripts/ui/CombaterPanel.js`, change imports:

```js
import { buildActionBuilderModel } from "../engine/action-builder.js";
import { readActionFavorites, toggleActionFavorite } from "../state/action-favorites.js";
import { clearDraftPlan, readDraftPlan, removeDraftStep, upsertDraftStep, writeDraftPlan } from "../state/draft-plans.js";
import { chooseDestination } from "./destination-picker.js";
```

Change constants:

```js
const DEFAULT_TAB = "one";
const TABS = new Set(["one", "two", "three", "free", "reaction"]);
```

- [ ] **Step 4: Build builder model in `_prepareContext`**

Replace plan context assembly in `_prepareContext` with:

```js
const { candidates, rejected, detected } = buildCandidates(context);
const plans = buildTurnPlans(context, candidates);
const draft = readDraftPlan(context);
const favorites = readActionFavorites(context);
const builder = buildActionBuilderModel({ context, candidates, plans, draft, favorites });

this._candidates = candidates;
this._rejected = rejected;
this._detected = detected;
this._plans = plans;
this._plan = builder.autoFill ?? bestTurnPlan(context, candidates);
this._builder = builder;
```

When no context exists, set `this._builder = null`.

- [ ] **Step 5: Return builder fields from `_viewContext`**

Add to returned object:

```js
builder: this._builder,
tabs: this._builder ? Object.values(this._builder.tabs).map((tab) => ({
  ...tab,
  active: tab.id === this.activeTab,
})) : [],
activeBuilderTab: this.activeTab,
hasManualDraft: Boolean(this._builder?.draft?.steps?.length),
```

Keep debug object GM-only.

- [ ] **Step 6: Add builder listeners**

Add to `_onRender`:

```js
for (const button of element.querySelectorAll("[data-add-action]")) {
  button.addEventListener("click", () => this._addAction(button.dataset.addAction));
}
for (const button of element.querySelectorAll("[data-remove-draft-step]")) {
  button.addEventListener("click", () => this._removeDraftStep(button.dataset.removeDraftStep));
}
for (const button of element.querySelectorAll("[data-favorite-action]")) {
  button.addEventListener("click", () => this._toggleFavorite(button.dataset.favoriteAction));
}
for (const button of element.querySelectorAll("[data-auto-fill]")) {
  button.addEventListener("click", () => this._autoFillDraft());
}
for (const button of element.querySelectorAll("[data-choose-destination]")) {
  button.addEventListener("click", () => this._chooseDestination(button.dataset.chooseDestination));
}
```

Add methods:

```js
_actionByKey(key) {
  for (const tab of Object.values(this._builder?.tabs ?? {})) {
    const action = tab.all.find((entry) => entry.key === key);
    if (action) return action;
  }
  return null;
}

_addAction(key) {
  const action = this._actionByKey(key);
  if (!action || action.disabled) return;
  upsertDraftStep(this._context, {
    actionKey: key,
    actionCost: action.actionCost ?? 1,
    itemUuid: action.item?.uuid,
    targetId: action.suggestedTarget?.id ?? action.suggestedTarget?.token?.id ?? null,
    requiresDestination: ["stride", "step", "stand-stride"].includes(action.slug),
    name: action.name,
  });
  this.render({ force: true });
}

_removeDraftStep(instanceId) {
  removeDraftStep(this._context, instanceId);
  this.render({ force: true });
}

_toggleFavorite(key) {
  toggleActionFavorite(this._context, key);
  this.render({ force: true });
}

_autoFillDraft() {
  if (!this._plan?.steps?.length) return;
  if (this._builder?.draft?.steps?.length) {
    const confirmed = globalThis.Dialog?.confirm
      ? globalThis.Dialog.confirm({
        title: "Replace draft plan?",
        content: "<p>Auto-fill will replace the current manual draft.</p>",
        yes: () => true,
        no: () => false,
        defaultYes: false,
      })
      : Promise.resolve(globalThis.window?.confirm?.("Replace current draft plan?") !== false);
    Promise.resolve(confirmed).then((ok) => {
      if (ok) this._writeAutoFillDraft();
    });
    return;
  }
  this._writeAutoFillDraft();
}

_writeAutoFillDraft() {
  writeDraftPlan(this._context, {
    steps: this._plan.steps.map((step) => ({
      instanceId: globalThis.foundry?.utils?.randomID?.() ?? `${step.id ?? step.slug}-${Date.now()}`,
      actionKey: step.id ?? step.slug ?? step.name,
      actionCost: step.actionCost ?? 1,
      itemUuid: step.item?.uuid,
      targetId: step.suggestedTarget?.id ?? step.suggestedTarget?.token?.id ?? null,
      requiresDestination: ["stride", "step", "stand-stride"].includes(step.slug),
      name: step.name,
    })),
  });
  this.render({ force: true });
}

_chooseDestination(instanceId) {
  chooseDestination({
    onChoose: (destination) => {
      const draft = readDraftPlan(this._context);
      const step = draft.steps.find((entry) => entry.instanceId === instanceId);
      if (!step) return;
      upsertDraftStep(this._context, { ...step, destination });
      this.render({ force: true });
    },
  });
}
```

- [ ] **Step 7: Replace template body**

In `templates/combater-panel.hbs`, replace old expanded nav/body with:

```hbs
{{#if expanded}}
  {{#if builder}}
    <section class="combater-plan-tray">
      <div class="combater-pool">
        <span>{{builder.remainingActions}} actions left</span>
        <span>{{builder.usage.reaction}}/1 reaction</span>
      </div>
      <button type="button" class="combater-autofill" data-auto-fill>Auto-fill</button>
      <div class="combater-draft-list">
        {{#each builder.draft.steps}}
          <article class="combater-draft-step {{#if warning}}has-warning{{/if}}" data-preview-step="{{@index}}">
            <button type="button" class="combater-draft-name" data-execute-step="{{@index}}">{{name}}</button>
            {{#if warning}}<span class="combater-warning">{{warning}}</span>{{/if}}
            {{#if requiresDestination}}<button type="button" data-choose-destination="{{instanceId}}">Choose destination</button>{{/if}}
            <button type="button" data-remove-draft-step="{{instanceId}}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>
          </article>
        {{else}}
          <p class="combater-empty">Build this turn from the action tabs.</p>
        {{/each}}
      </div>
    </section>

    <nav class="combater-tabs" aria-label="Action cost tabs">
      {{#each tabs}}
        <button type="button" data-tab="{{id}}" class="{{#if active}}active{{/if}}">{{label}}</button>
      {{/each}}
    </nav>

    <section class="combater-body">
      {{#each tabs}}
        {{#if active}}
          <div class="combater-action-tab">
            {{> actionSection title="Favorites" actions=favorites empty="No favorites in this tab."}}
            {{> actionSection title="Recommended" actions=recommended empty="No recommended actions in this tab."}}
            {{> actionSection title="All" actions=all empty="No actions in this tab."}}
          </div>
        {{/if}}
      {{/each}}
      {{#if showDebug}}
        <details class="combater-debug-foldout">
          <summary>Debug</summary>
          <div class="combater-debug">
            <details>
              <summary>Candidates ({{debug.candidates.length}})</summary>
              {{#each debug.candidates}}
                <div class="debug-row">
                  <span>{{name}}</span>
                  <code title="{{profile}}">{{source}}{{#if role}}/{{role}}{{/if}}</code>
                  <span>{{costLabel}}</span>
                  <span>{{#if skillCheckLabel}}{{skillCheckLabel}}{{else}}{{#if targetLabel}}{{targetLabel}}{{else}}{{score}}{{/if}}{{/if}}</span>
                </div>
              {{/each}}
            </details>
            <details>
              <summary>Rejected ({{debug.rejected.length}})</summary>
              {{#each debug.rejected}}
                <div class="debug-row">
                  <span>{{action.name}}</span>
                  <code>{{action.source}}</code>
                  <span>{{reason}}</span>
                </div>
              {{/each}}
            </details>
          </div>
        </details>
      {{/if}}
    </section>
  {{/if}}
{{/if}}
```

If partial registration is not present, inline the action section markup three times instead of using `{{> actionSection}}`:

```hbs
<section class="combater-action-section">
  <h3>Recommended</h3>
  {{#each recommended}}
    <article class="combater-action-row {{#if disabled}}is-disabled{{/if}}">
      <button type="button" class="combater-favorite" data-favorite-action="{{key}}" aria-label="Favorite">
        <i class="fa-solid fa-star"></i>
      </button>
      <button type="button" class="combater-action-name" data-execute-step="{{@index}}">{{name}}</button>
      {{#if targetLabel}}<span class="combater-target">{{targetLabel}}</span>{{/if}}
      <p>{{#if disabled}}{{disabledReason}}{{else}}{{reason}}{{/if}}</p>
      <button type="button" data-add-action="{{key}}" {{#if disabled}}disabled{{/if}}>Add</button>
    </article>
  {{else}}
    <p class="combater-empty">No recommended actions in this tab.</p>
  {{/each}}
</section>
```

- [ ] **Step 8: Run tests**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS.

- [ ] **Step 9: Commit task**

Run:

```bash
rtk git diff -- scripts/ui/CombaterPanel.js templates/combater-panel.hbs scripts/engine/self-test.js
rtk git add scripts/ui/CombaterPanel.js templates/combater-panel.hbs scripts/engine/self-test.js
rtk git commit --only scripts/ui/CombaterPanel.js templates/combater-panel.hbs scripts/engine/self-test.js -m "feat: replace panel with action builder"
```

## Task 6: Builder Styling and Polish

**Files:**
- Modify: `styles/combater.css`
- Modify: `templates/combater-panel.hbs`

- [ ] **Step 1: Add builder CSS**

Append to `styles/combater.css`:

```css
.pf2e-combater .combater-plan-tray {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--combater-line);
  padding: 10px;
  background: #181b20;
}

.pf2e-combater .combater-pool {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--combater-muted);
  font-size: 11px;
  font-weight: 700;
}

.pf2e-combater .combater-autofill {
  justify-self: start;
  border: 1px solid var(--combater-line);
  border-radius: 6px;
  padding: 4px 8px;
  background: var(--combater-surface);
  color: var(--combater-ink);
  cursor: pointer;
}

.pf2e-combater .combater-draft-list,
.pf2e-combater .combater-action-section {
  display: grid;
  gap: 6px;
}

.pf2e-combater .combater-draft-step,
.pf2e-combater .combater-action-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-width: 0;
  border: 1px solid var(--combater-line);
  border-radius: 6px;
  padding: 7px;
  background: var(--combater-surface-raised);
}

.pf2e-combater .combater-action-row.is-disabled {
  opacity: 0.55;
}

.pf2e-combater .combater-action-row.is-disabled .combater-action-name {
  text-decoration: line-through;
}

.pf2e-combater .combater-action-name,
.pf2e-combater .combater-draft-name,
.pf2e-combater .combater-favorite {
  border: 0;
  background: transparent;
  color: var(--combater-ink);
  cursor: pointer;
  text-align: left;
}

.pf2e-combater .combater-favorite {
  color: var(--combater-muted);
  text-align: center;
}

.pf2e-combater .combater-favorite.is-active {
  color: var(--combater-focus);
}

.pf2e-combater .combater-warning {
  color: #f0b35a;
  font-size: 11px;
  font-weight: 700;
}

.pf2e-combater .combater-action-section h3 {
  margin: 8px 0 2px;
  color: var(--combater-ink);
  font-size: 12px;
  font-weight: 800;
}

.pf2e-combater .combater-action-row p {
  grid-column: 2 / -1;
  margin: 0;
  color: var(--combater-muted);
  font-size: 11px;
  line-height: 1.3;
}
```

- [ ] **Step 2: Add active favorite class in template**

Update favorite icon button in `templates/combater-panel.hbs`:

```hbs
<button type="button" class="combater-favorite {{#if favorite}}is-active{{/if}}" data-favorite-action="{{key}}" aria-label="Favorite">
  <i class="fa-solid fa-star"></i>
</button>
```

- [ ] **Step 3: Run lint**

Run:

```bash
rtk npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit task**

Run:

```bash
rtk git diff -- styles/combater.css templates/combater-panel.hbs
rtk git add styles/combater.css templates/combater-panel.hbs
rtk git commit --only styles/combater.css templates/combater-panel.hbs -m "style: polish action builder panel"
```

## Task 7: Encounter Opening, Refresh, and Access Rules

**Files:**
- Modify: `scripts/main.js`
- Modify: `scripts/ui/CombaterPanel.js`
- Modify: `scripts/engine/self-test.js`

- [ ] **Step 1: Add access smoke tests**

Append to `scripts/engine/self-test.js`:

```js
globalThis.game = {
  user: { isGM: false },
  combat: {
    id: "combat-access",
    round: 1,
    turn: 0,
    started: true,
    combatant: selectedCombatant,
    combatants: [selectedCombatant, unownedCombatant],
  },
};
globalThis.canvas = {
  grid: { size: 5 },
  tokens: { controlled: [unownedCombatant.token.object], placeables: [selectedCombatant.token.object, unownedCombatant.token.object] },
};
assert.equal(readCombatContext("selected-token"), null);
globalThis.canvas.tokens.controlled = [selectedCombatant.token.object];
assert.equal(readCombatContext("selected-token").combatant.id, "combatant-owned");
```

- [ ] **Step 2: Run self-test**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
```

Expected: PASS after Task 1.

- [ ] **Step 3: Make panel opening encounter-scoped**

In `scripts/main.js`, rename `openCurrent` body to keep same exported panel API but use selected combatant context internally:

```js
async function openCurrent(source) {
  const { openPanelForCurrentCombatant } = await import("./ui/CombaterPanel.js");
  activePanel = await openPanelForCurrentCombatant(activePanel, source);
}
```

Keep keybinding behavior, but remove assumptions that panel is only useful on turn start. In `ready`, keep:

```js
if (!game.combat?.started) return;
await openCurrent("ready");
```

In `updateCombat`, keep refresh on turn/round changes so existing draft for next actor becomes visible:

```js
if (!("turn" in changed) && !("round" in changed)) return;
if (setting(SETTINGS.autoOpen)) await openCurrent("combat-turn");
else scheduleRefresh("combat-turn");
```

- [ ] **Step 4: Ensure `CombaterPanel` uses selected context each refresh**

In `scripts/ui/CombaterPanel.js`, call:

```js
const context = readCombatContext(this.refreshSource);
```

after Task 1 this already selects controlled encounter token. Add a panel method for future tracker integration:

```js
setCombatant(combatant) {
  this._selectedCombatant = combatant;
  return this.refresh("combatant-select");
}
```

and pass override:

```js
const context = readCombatContext(this.refreshSource, { combatant: this._selectedCombatant });
```

- [ ] **Step 5: Run tests and lint**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
rtk npm run lint
```

Expected: both PASS.

- [ ] **Step 6: Commit task**

Run:

```bash
rtk git diff -- scripts/main.js scripts/ui/CombaterPanel.js scripts/engine/self-test.js
rtk git add scripts/main.js scripts/ui/CombaterPanel.js scripts/engine/self-test.js
rtk git commit --only scripts/main.js scripts/ui/CombaterPanel.js scripts/engine/self-test.js -m "feat: show planner throughout encounters"
```

## Task 8: Manual Foundry Verification Pass

**Files:**
- Modify only if runtime defects are found in changed files from Tasks 1-7.

- [ ] **Step 1: Run automated suite**

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
rtk npm run lint
```

Expected: both PASS.

- [ ] **Step 2: Hard reload Foundry client**

Reload browser tab running Foundry. Foundry client JS hooks need hard reload after panel/template changes.

- [ ] **Step 3: Verify player-owned planning**

In Foundry as player:

- select owned encounter token before its turn
- open PF2e Combater
- confirm panel shows builder
- add `Stride`
- confirm draft step says `Choose destination`
- click `Choose destination`
- click reachable grid square
- hover Stride step
- confirm preview shows chosen square/path

- [ ] **Step 4: Verify player access privacy**

In Foundry as player:

- select unowned NPC token in encounter
- open PF2e Combater
- confirm no actionable planner appears for unowned token
- select owned token
- confirm visible enemy names can appear as suggested targets
- confirm AC/save/resistance/weakness values do not appear in action rows

- [ ] **Step 5: Verify GM NPC planning**

In Foundry as GM:

- open encounter
- select NPC after current player turn
- open PF2e Combater
- confirm builder appears
- confirm Auto-fill creates draft only after confirmation when manual draft exists
- confirm GM debug foldout appears only when debug setting is enabled

- [ ] **Step 6: Fix runtime defects with targeted tests**

For each defect, add a focused self-test when possible, patch the smallest file, rerun:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
rtk npm run lint
```

Expected: both PASS.

- [ ] **Step 7: Commit verification fixes**

If any fixes were needed, commit path-only:

```bash
rtk git diff -- scripts
rtk git add scripts/main.js scripts/ui/CombaterPanel.js scripts/ui/movement-preview.js scripts/ui/destination-picker.js scripts/engine/action-builder.js scripts/state/combat-context.js scripts/state/draft-plans.js scripts/state/action-favorites.js scripts/engine/self-test.js templates/combater-panel.hbs styles/combater.css
rtk git commit --only scripts/main.js scripts/ui/CombaterPanel.js scripts/ui/movement-preview.js scripts/ui/destination-picker.js scripts/engine/action-builder.js scripts/state/combat-context.js scripts/state/draft-plans.js scripts/state/action-favorites.js scripts/engine/self-test.js templates/combater-panel.hbs styles/combater.css -m "fix: stabilize action builder runtime behavior"
```

## Final Verification

Run:

```bash
rtk npm test -- --runTestsByPath scripts/engine/self-test.js
rtk npm run lint
rtk git status --short
```

Expected:

- self-test passes
- lint passes
- `git status --short` contains only pre-existing unrelated work or intentional final changes

## Spec Coverage Check

- Encounter-scoped panel: Tasks 1 and 7.
- Player owned-token access only: Tasks 1 and 7.
- GM can plan any combatant: Tasks 1, 7, 8.
- Action-cost tabs: Tasks 3, 5, 6.
- Favorites per user and actor: Task 2, surfaced in Tasks 3 and 5.
- Recommended actions per tab: Task 3, surfaced in Task 5.
- Auto-fill secondary: Tasks 3 and 5.
- Draft plan persistence: Task 2, surfaced in Task 5.
- Movement added before destination: Tasks 3, 4, 5.
- Hover preview for chosen movement: Task 4, surfaced in Task 5.
- Privacy rules: Tasks 1, 3, 7, 8.
- Tests: Tasks 1-8.
