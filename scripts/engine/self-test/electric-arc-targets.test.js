import assert from "node:assert/strict";
import { readSpellActions } from "../../readers/spell-reader.js";
import { choosePanelTarget } from "../../ui/panel/picker-workflow.js";
import { executeDraftStep } from "../action/executor.js";

const saved = Object.fromEntries(["game", "canvas", "Hooks"].map((key) => [key, globalThis[key]]));
try {
  const spell = {
    id: "arc", uuid: "Actor.caster.Item.arc", type: "spell", slug: "electric-arc", name: "Electric Arc",
    system: { slug: "electric-arc", location: { value: "arcane" }, level: { value: 1 }, time: { value: "2" },
      traits: { value: ["cantrip", "electricity"] }, range: { value: "30 feet" }, target: { value: "1 or 2 creatures" },
      defense: { save: { statistic: "reflex", basic: true } }, damage: { 0: { formula: "2d4", type: "electricity" } } },
  };
  let castTargets;
  const entry = { id: "arcane", system: { prepared: { value: "spontaneous" } }, async cast() {
    castTargets = [...game.user.targets].map((token) => token.id);
    return { id: "arc-card" };
  } };
  const actor = { id: "caster", type: "character", system: {}, itemTypes: { spell: [spell], spellcastingEntry: [entry] }, spellcasting: [entry] };
  const tokens = ["first", "second", "third"].map((id) => ({ id, name: id, setTarget(selected) { if (selected) game.user.targets.add(this); } }));
  globalThis.game = { user: { id: "player", targets: new Set(tokens.slice(0, 2)) } };
  globalThis.canvas = { tokens: { placeables: tokens, get: (id) => tokens.find((token) => token.id === id), setTargets() { game.user.targets.clear(); } } };
  globalThis.Hooks = undefined;
  const context = { actor: { document: actor }, battlefield: { enemies: tokens.map((token) => ({ ...token, distance: 10 })), allies: [] } };
  const action = readSpellActions(context).find((action) => action.slug === "electric-arc");
  assert.equal(action.targetingProfile.maxTargets, 2);
  let step = { instanceId: "arc-step", action };
  const panel = {
    _context: context, _canExecuteDraft: () => true, _findDraftStep: () => step, _findActiveStep: () => step,
    async _persistActiveDraftStep(next) { step = next; }, async render() {},
  };
  await choosePanelTarget(panel, step.instanceId);
  assert.deepEqual(step.targetTokenIds, ["first", "second"], "panel must store both selected Electric Arc targets");
  const result = await executeDraftStep({ context, step, action });
  assert.deepEqual(castTargets, ["first", "second"], "native Electric Arc cast must retain both planned targets");
  assert.deepEqual(result.patch.targetTokenIds, ["first", "second"]);
  const single = await executeDraftStep({ context, step: { ...step, targetTokenIds: ["second"] }, action });
  assert.equal(single.status, "done", "Electric Arc allows a single target");
  assert.deepEqual(castTargets, ["second"]);
  const tooMany = await executeDraftStep({ context, step: { ...step, targetTokenIds: tokens.map((token) => token.id) }, action });
  assert.equal(tooMany.status, "needs-choice", "Electric Arc must not cast on more than two targets");
  assert.deepEqual(castTargets, ["second"], "invalid target count must not cast again");
  const missing = await executeDraftStep({ context, step: { ...step, targetTokenIds: ["first", "deleted"] }, action });
  assert.equal(missing.status, "needs-choice", "missing planned targets must request a new selection");
  await executeDraftStep({ context, step, action: { ...action, targetingProfile: { ...action.targetingProfile, maxTargets: 1 } } });
  assert.deepEqual(castTargets, ["first"], "single-target spells retain their existing target behavior");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Electric Arc target regressions passed");
