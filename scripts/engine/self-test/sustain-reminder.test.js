import assert from "node:assert/strict";
import { executeDraftStep } from "../action/executor.js";
import { readSustainedSpellEntries } from "../sustained-spells.js";

const saved = Object.fromEntries(["game", "canvas", "Hooks"].map((key) => [key, globalThis[key]]));
try {
  let reminderActive = true;
  let assistantActive = false;
  let pendingReminder;
  const effects = [];
  const spell = {
    id: "summon", uuid: "Actor.caster.Item.summon", type: "spell", name: "Summon Animal", slug: "summon-animal",
    system: { slug: "summon-animal", duration: { value: "1 minute", sustained: true } },
  };
  const actor = {
    id: "caster", uuid: "Actor.caster", system: {}, items: effects, itemTypes: { effect: effects },
    async createEmbeddedDocuments(_type, documents) {
      // Foundry document creation from async chat listeners can finish after cast returns.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const created = documents.map((data) => ({ ...data, id: `effect-${effects.length}`, uuid: `Actor.caster.Item.effect-${effects.length}` }));
      effects.push(...created);
      return created;
    },
  };
  const token = { actor };
  const message = { id: "cast-card", actor, token, flags: { pf2e: { origin: { type: "spell", uuid: spell.uuid } } } };
  actor.spellcasting = [{ id: "entry", async cast() {
    if (reminderActive && spell.system.duration.sustained && message.token) {
      pendingReminder = actor.createEmbeddedDocuments("Item", [{
        type: "effect", name: `Sustaining: ${spell.name}`,
        system: { slug: `sustaining-effect-${spell.system.slug}`, duration: { value: 1, unit: "minutes", sustained: true, expiry: "turn-start" } },
        flags: {},
      }]);
    }
    if (assistantActive && spell.slug === "summon-animal") {
      pendingReminder = actor.createEmbeddedDocuments("Item", [{
        type: "effect", name: "Summon Animal",
        system: { slug: "effect-summon-animal", duration: { value: 1, unit: "minutes", sustained: true } },
        flags: { core: { sourceId: "Compendium.pf2e.spells-srd.Item.4YnON9JHYqtLzccu" } },
      }]);
    }
    return message;
  } }];
  globalThis.game = { system: { id: "pf2e" }, user: { id: "player" }, modules: { get: (id) => ({ active: id === "pf2e-sustain-reminder" ? reminderActive : id === "pf2e-summons-assistant" && assistantActive }) } };
  globalThis.canvas = {};
  globalThis.Hooks = undefined;
  const action = {
    slug: spell.slug, name: spell.name, item: spell, rank: 1, castRank: 1, spellcastingEntryId: "entry",
    activityProfile: { spell: true, sustained: true, duration: "1 minute" },
  };
  const context = { actor: { document: actor } };
  const execute = () => executeDraftStep({ context, action, step: { action } });
  const result = await execute();
  await pendingReminder;
  assert.equal(result.status, "done");
  assert.equal(effects.length, 1, "async Sustain Reminder creation must not receive a second Combater effect");
  assert.equal(effects[0].name, "Sustaining: Summon Animal");
  assert.equal(readSustainedSpellEntries(context, [action], { steps: [] })[0]?.effectIds.length, 1, "external reminder must still support Combater Sustain planning");
  assert.equal(result.patch.execution.revert.ops.some((op) => op.kind === "effect"), false, "undo must not claim another module's reminder");

  effects.length = 0;
  reminderActive = false;
  await execute();
  assert.equal(effects.length, 1, "Combater retains sustained tracking without Sustain Reminder");
  assert.ok(effects[0].flags["pf2e-combater"].sustainedSpell);

  effects.length = 0;
  reminderActive = true;
  message.token = null;
  await execute();
  assert.equal(effects.length, 1, "tokenless casts retain Combater tracking when external reminder cannot run");

  effects.length = 0;
  message.token = token;
  spell.system.duration.sustained = false;
  await execute();
  assert.equal(effects.length, 1, "profile-only sustained spells retain tracking when native reminder ignores them");

  effects.length = 0;
  reminderActive = false;
  assistantActive = true;
  spell.system.duration.sustained = true;
  action.name = "Summon Animal (Rank 3)";
  action.castRank = 3;
  const summonResult = await execute();
  await pendingReminder;
  assert.equal(effects.length, 1, "Assistant-managed rank 3 summon must not add Combater's second effect without Sustain Reminder installed");
  assert.equal(effects[0].name, "Summon Animal");
  assert.equal(summonResult.patch.execution.revert.ops.some((op) => op.kind === "effect"), false);
  assert.equal(readSustainedSpellEntries(context, [action], { steps: [] })[0]?.effectIds.length, 1);

  effects.length = 0;
  assistantActive = false;
  await execute();
  assert.equal(effects.length, 1, "summons retain Combater tracking when Assistant is absent");
  assert.ok(effects[0].flags["pf2e-combater"].sustainedSpell);

  effects.length = 0;
  assistantActive = true;
  action.slug = spell.slug = "animated-assault";
  await execute();
  assert.equal(effects.length, 1, "active Assistant must not suppress unrelated sustained spells");
  assert.ok(effects[0].flags["pf2e-combater"].sustainedSpell);

  effects.length = 0;
  assistantActive = false;
  action.slug = spell.slug = "summon-animal";
  game.modules.get = () => undefined;
  await execute();
  assert.equal(effects.length, 1, "uninstalled Assistant must preserve Combater summon tracking");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Sustain Reminder integration regressions passed");
