import assert from "node:assert/strict";
import { fighterContext } from "../fixtures.js";
import { scoreCandidate } from "../scoring.js";
import { buildActionBuilderModel } from "../action/builder/index.js";
import { addPanelUncountedAction } from "../../ui/panel/draft-workflow.js";
import { actionExclusionKey, readActionExclusions, toggleActionExclusion } from "../../state/action-exclusions.js";
import { buildCandidates } from "../candidates.js";
import { planSummon, summonSpellConfig, validateSummonPlan } from "../../integrations/summons-assistant.js";
import { executeDraftStep } from "../action/executor.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";

const previousGame = globalThis.game;
globalThis.game = { user: { id: "player", isGM: false }, settings: { get: () => undefined } };
try {
  const action = { id: "shield", key: "shield", slug: "raise-a-shield", name: "Raise a Shield", actionCost: 1, overBudget: true, available: true };
  let draft = { steps: [], uncounted: [] };
  let renders = 0;
  await addPanelUncountedAction({
    _context: fighterContext,
    _canExecuteDraft: () => true,
    _findBuilderAction: () => action,
    _readActiveDraftPlan: () => draft,
    _writeActiveDraftPlan: async (next) => { draft = next; },
    render: async () => { renders++; },
  }, action.key);
  assert.equal(draft.uncounted.length, 1, "player Uncounted click must append an action despite exhausted budget");
  assert.equal(draft.steps.length, 0);
  assert.equal(renders, 1);
  const builder = buildActionBuilderModel({ context: fighterContext, candidates: [action], draft });
  assert.equal(builder.usage.normal, 0, "Uncounted actions must cost zero from the turn budget");
  assert.equal(builder.draft.uncounted.length, 1);

  const fortify = { id: "fortify", slug: "fortify-summoning", name: "Fortify Summoning", role: "buff", source: "spell-curated", actionCost: 1, available: true, targetingProfile: { ally: true, self: false, maxRange: 30 } };
  const context = { ...fighterContext, allies: [{ id: "ordinary-ally", distance: 5, hpPercent: 1 }] };
  assert.ok(scoreCandidate(context, fortify).score <= -900, "Fortify Summoning must not recommend without a summoned creature");
  const summon = { id: "summon", distance: 10, hpPercent: 1, summoned: true, summonerId: fighterContext.actor.id };
  const summonContext = { ...context, summons: [summon] };
  assert.equal(scoreCandidate(summonContext, fortify).suggestedTarget.id, summon.id, "buff must point at caster's summon outside combat tracker");
  for (const patch of [{ summoned: false }, { summonerId: "other-caster" }, { distance: 35 }, { hpPercent: 0 }, { conditions: ["dead"] }]) {
    assert.ok(scoreCandidate({ ...context, summons: [{ ...summon, ...patch }] }, fortify).score <= -900, `invalid summon must not unlock Fortify: ${JSON.stringify(patch)}`);
  }

  const actor = {
    id: fighterContext.actor.id, uuid: "Actor.caster", type: "character", isOwner: true, system: {}, itemTypes: {}, flags: {},
    async setFlag(module, key, value) { this.flags[module] = { ...this.flags[module], [key]: value }; },
  };
  const exclusionContext = { ...fighterContext, actor: { ...fighterContext.actor, document: actor } };
  assert.equal(await toggleActionExclusion(exclusionContext, action), true);
  assert.ok(readActionExclusions(exclusionContext).has(actionExclusionKey(action)));
  const excludedBuild = buildCandidates(exclusionContext);
  assert.ok(!excludedBuild.candidates.some((candidate) => candidate.slug === action.slug), "hidden action must be removed before Auto-fill scoring");
  const excluded = excludedBuild.rejected.find((entry) => entry.action.slug === action.slug);
  assert.equal(excluded?.action.userExcluded, true);
  const input = { context: exclusionContext, candidates: [], rejected: [excluded], draft: { steps: [{ instanceId: "saved", actionKey: action.slug }] } };
  assert.equal(buildActionBuilderModel(input).tabs.one.all.length, 0, "hidden actions must disappear from Browse");
  const restoreModel = buildActionBuilderModel({ ...input, showExcluded: true });
  assert.equal(restoreModel.tabs.one.all[0].userExcluded, true, "Show hidden must offer restoration");
  assert.equal(restoreModel.draft.steps[0].stale, false, "hiding actions must preserve existing draft resolution");
  globalThis.game.user.isGM = true;
  const gmModel = buildActionBuilderModel(input);
  assert.equal(gmModel.tabs.one.all[0].userExcluded, true, "GM Browse must retain actor-hidden actions without Show hidden");
  assert.equal(gmModel.tabs.one.all[0].disabled, false, "actor hiding must not disable GM actions");
  assert.equal(gmModel.tabs.one.all[0].blockedByExclusion, false, "GM must retain Add and Uncounted controls");
  const gmCandidates = buildCandidates(exclusionContext);
  assert.ok(gmCandidates.candidates.some((candidate) => candidate.slug === action.slug), "GM Auto-fill must retain actor-hidden actions");
  let gmDraft = { steps: [], uncounted: [] };
  const hiddenPanel = {
    _context: exclusionContext,
    _canExecuteDraft: () => true,
    _findBuilderAction: () => gmModel.tabs.one.all[0],
    _readActiveDraftPlan: () => gmDraft,
    _writeActiveDraftPlan: async (next) => { gmDraft = next; },
    render: async () => {},
  };
  await addPanelUncountedAction(hiddenPanel, action.key);
  assert.equal(gmDraft.uncounted.length, 1, "GM must use hidden actions without restoring player visibility");
  assert.ok(readActionExclusions(exclusionContext).has(actionExclusionKey(action)));
  globalThis.game.user.isGM = false;
  await addPanelUncountedAction(hiddenPanel, action.key);
  assert.equal(gmDraft.uncounted.length, 1, "player role must still block hidden actions from a stale GM model");
  assert.equal(buildActionBuilderModel(input).tabs.one.all.length, 0, "switching back to player must hide excluded actions again");
  await toggleActionExclusion(exclusionContext, action);
  assert.equal(readActionExclusions(exclusionContext).size, 0);
  actor.isOwner = false;
  assert.equal(await toggleActionExclusion(exclusionContext, action), false, "non-owner cannot change actor exclusions");
  assert.equal(actionExclusionKey({ slug: "summon-animal", item: { id: "s1" }, castRank: 1 }), actionExclusionKey({ slug: "summon-animal", item: { id: "s1" }, castRank: 3 }));
  assert.notEqual(actionExclusionKey({ slug: "strike", item: { id: "w1" } }), actionExclusionKey({ slug: "reload", item: { id: "w1" } }));
} finally {
  globalThis.game = previousGame;
}

const previousGlobals = Object.fromEntries(["game", "canvas", "foundrySummons", "Sequencer", "fromUuid", "pf2e-summons-assistant", "window", "Hooks"].map((key) => [key, globalThis[key]]));
try {
  let summons = 0;
  let selection = "Compendium.test.Actor.wolf";
  let placement = { x: 150, y: 50 };
  const wolf = { name: "Wolf", level: -1, system: { traits: { rarity: "common", value: ["animal"] } }, prototypeToken: { height: 1 } };
  globalThis.game = { user: { isGM: false }, modules: { get: () => ({ active: true }) }, settings: { get: () => undefined } };
  globalThis.window = undefined;
  globalThis.Hooks = undefined;
  globalThis.canvas = { scene: { id: "qa-scene" }, grid: { distance: 5, measurePath: () => ({ cost: 10 }) } };
  globalThis.fromUuid = async () => wolf;
  globalThis["pf2e-summons-assistant"] = { summon: async () => { summons++; } };
  globalThis.foundrySummons = { SummonMenu: { start: async (options) => {
    assert.equal(options.noSummon, true, "planning must not create tokens");
    const indexedFields = options.toggles.flatMap((toggle) => toggle.indexedFields);
    assert.ok(indexedFields.includes("system.traits.value"), "live picker must request creature traits from compendium indices");
    assert.ok(indexedFields.includes("system.traits.rarity"), "live picker must request rarity from compendium indices");
    assert.equal(options.filter(wolf), true);
    assert.equal(options.filter({ ...wolf, level: 1 }), false);
    assert.equal(options.filter({ ...wolf, system: { traits: { rarity: "common", value: ["undead"] } } }), false);
    return selection;
  } } };
  globalThis.Sequencer = { Crosshair: { show: async (options) => {
    assert.equal(options.location.limitMaxRange, 30);
    return placement;
  } } };
  const action = { id: "spell-summon", slug: "summon-animal", name: "Summon Animal", rank: 1, castRank: 1, actionCost: 3, source: "spell-curated", role: "summon", targetingProfile: { self: true, maxRange: 30 } };
  const context = { ...fighterContext, token: { center: { x: 50, y: 50 } } };
  const plan = await planSummon(context, action);
  assert.deepEqual(plan.center, placement);
  assert.equal(summons, 0);
  assert.equal(await validateSummonPlan(context, action, plan), true);
  assert.equal(await validateSummonPlan(context, action, { ...plan, sceneId: "other" }), false);
  assert.equal(await validateSummonPlan(context, { ...action, castRank: 2 }, plan), false);
  assert.equal(summonSpellConfig({ ...action, castRank: 5 }).level, 5);
  assert.equal(summonSpellConfig({ ...action, slug: "summon-lesser-servitor", castRank: 5 }).level, 3);
  assert.equal(summonSpellConfig({ ...action, slug: "manifest-eidolon" }), null);
  const decorated = decorateBuilder(buildActionBuilderModel({ context, candidates: [action], draft: { steps: [{ instanceId: "summon-step", actionKey: action.id, summonPlan: plan }] } }), "three", "");
  assert.equal(decorated.draft.steps[0].canChooseSummon, true);
  assert.ok(decorated.draft.steps[0].summonLabel.includes("Wolf"));
  placement = null;
  assert.equal(await planSummon(context, action), null, "cancelling placement must preserve old draft choice");
  selection = null;
  assert.equal(await planSummon(context, action), null);

  let casts = 0;
  let reopenedMenus = 0;
  let nativeTokens = 0;
  let nativePlacement = null;
  let nativeTemplate = null;
  let placementPrompts = 0;
  let unrelatedPlacementPrompts = 0;
  const originalCrosshair = globalThis.Sequencer.Crosshair.show = async (config) => {
    if (config.texture === "wolf.webp") placementPrompts++;
    else unrelatedPlacementPrompts++;
    return { x: 900, y: 900 };
  };
  let unrelatedMenus = 0;
  const listeners = new Map();
  let nextHook = 0;
  globalThis.game.user.id = "player";
  globalThis.Hooks = {
    on: (name, callback) => { const id = ++nextHook; listeners.set(id, { name, callback }); return id; },
    off: (_name, id) => listeners.delete(id),
  };
  const originalMenu = globalThis.foundrySummons.SummonMenu.start = async (options) => {
    if (options?.toggles?.some((control) => control.id === "onlyWithImages")) reopenedMenus++;
    else unrelatedMenus++;
    return plan.actorUuid;
  };
  const originalPick = globalThis.foundrySummons.pick = async (options) => {
    nativeTokens++;
    nativePlacement = options.crosshairParameters;
    await globalThis.Sequencer.Crosshair.show({ texture: "unrelated.webp" });
    nativeTemplate = await globalThis.Sequencer.Crosshair.show({
      distance: 2.5, texture: "wolf.webp", ...options.crosshairParameters,
    });
    return { id: "summoned-token" };
  };
  // Reproduce the installed Assistant's async createChatMessage listener. It owns
  // both the creature picker and token creation, independently of Combater.
  let automaticFlow;
  globalThis.Hooks.on("createChatMessage", () => {
    automaticFlow = (async () => {
      await Promise.resolve();
      const uuid = await globalThis.foundrySummons.SummonMenu.start({
        noSummon: true, filter: () => true,
        dropdowns: [{ id: "sortOrder" }, { id: "traitsFilter" }],
        toggles: [{ id: "onlyWithImages" }],
      });
      await globalThis.foundrySummons.pick({ uuid, crosshairParameters: { nativeSetting: true } });
    })();
    automaticFlow.catch(() => {});
  });
  const caster = { id: "caster", system: {}, spellcasting: [{ id: "entry", cast: async () => {
    casts++;
    await globalThis.foundrySummons.SummonMenu.start({ noSummon: true });
    const message = { id: "cast-card", speaker: { actor: "caster" }, item: { id: "summon-item", slug: "summon-animal" } };
    for (const listener of [...listeners.values()]) if (listener.name === "createChatMessage") listener.callback(message, {}, "player");
    return message;
  } }] };
  const castAction = { ...action, item: { id: "summon-item", type: "spell", system: {} }, spellcastingEntryId: "entry" };
  const castContext = { ...context, actor: { document: caster } };
  const invalid = await executeDraftStep({ context: castContext, step: { summonPlan: { ...plan, sceneId: "other" } }, action: castAction });
  assert.equal(invalid.status, "failed");
  assert.equal(casts, 0, "invalid plan must fail before consuming a slot");
  const executed = await executeDraftStep({ context: castContext, step: { summonPlan: plan }, action: castAction });
  assert.equal(executed.status, "done");
  await automaticFlow;
  assert.equal(reopenedMenus, 0, "native chat automation must reuse the saved creature without reopening its picker");
  assert.equal(nativeTokens, 1, "native chat automation must create exactly one token");
  assert.equal(nativePlacement.nativeSetting, true, "native placement configuration must survive");
  assert.equal(placementPrompts, 0, "execution must not ask for placement after it was planned");
  assert.equal(unrelatedPlacementPrompts, 1, "unrelated crosshairs must retain their normal interaction");
  assert.deepEqual({ x: nativeTemplate.x, y: nativeTemplate.y }, plan.center, "native summon must spawn at the saved coordinates");
  assert.equal(nativeTemplate.distance, 2.5);
  assert.equal(nativeTemplate.texture, "wolf.webp");
  assert.equal(globalThis.Sequencer.Crosshair.show, originalCrosshair, "execution must restore the crosshair API");
  assert.equal(globalThis.foundrySummons.SummonMenu.start, originalMenu, "temporary integration must restore picker");
  assert.equal(globalThis.foundrySummons.pick, originalPick, "temporary integration must restore token creation");
  assert.equal(casts, 1);
  assert.equal(unrelatedMenus, 1, "unrelated creature menus must remain native during a planned cast");
  assert.equal(summons, 0, "execution must leave token creation to native chat automation rather than start a second summon");
  globalThis.foundrySummons.pick = async () => { throw new Error("cancelled"); };
  const cancelled = await executeDraftStep({ context: castContext, step: { summonPlan: plan }, action: castAction });
  await automaticFlow.catch(() => {});
  assert.equal(cancelled.status, "done", "post-cast summon cancellation must not make the cast retryable");
  assert.ok(cancelled.patch.execution.result.includes("already cast"));
  assert.equal(casts, 2, "cancelled placement must not recast the spell");
  assert.equal(globalThis.foundrySummons.SummonMenu.start, originalMenu);
  assert.equal(globalThis.Sequencer.Crosshair.show, originalCrosshair, "failed token creation must restore placement API");
  const cancelPick = globalThis.foundrySummons.pick;
  assert.notEqual(cancelPick, originalPick);
  assert.equal(listeners.size, 1, "temporary chat capture must be removed after cancellation");
  caster.spellcasting[0].cast = async () => { throw new Error("native-cast-failed"); };
  await assert.rejects(executeDraftStep({ context: castContext, step: { summonPlan: plan }, action: castAction }), /native-cast-failed/);
  assert.equal(globalThis.foundrySummons.SummonMenu.start, originalMenu);
  assert.equal(globalThis.foundrySummons.pick, cancelPick);
  assert.equal(listeners.size, 1, "native cast exceptions must restore hooks and public APIs");
} finally {
  Object.assign(globalThis, previousGlobals);
}

console.log("Combater browser/summons regressions passed.");
