import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODULE_ID } from "../../constants.js";
import { registerSettings, migrateVisionerCombatSettings, SETTINGS } from "../../settings.js";
import { applyCombatStartCharacterActions } from "../../combat-start-character-actions.js";
import { registerFlankingSizeRuleWrapper } from "../../flanking/flanking-size-rule.js";

const saved = { game: globalThis.game, canvas: globalThis.canvas, CONFIG: globalThis.CONFIG, fromUuid: globalThis.fromUuid };
const values = new Map();
const registered = new Map();
const legacy = new Map([
  [SETTINGS.flankingSizeRule, "anySquare"],
  [SETTINGS.raisePcShieldsWhenDefending, true],
  [SETTINGS.enrageBarbariansAtCombatStart, true],
]);
let shieldCalls = 0;
let rageCalls = 0;
const settings = {
  register(module, key, config) {
    registered.set(`${module}.${key}`, config);
    values.set(`${module}.${key}`, config.default);
  },
  get(module, key) {
    if (module === "pf2e-visioner") return legacy.get(key);
    if (module === "pf2e-avoid-notice") return false;
    return values.get(`${module}.${key}`);
  },
  async set(module, key, value) {
    if (module === "pf2e-visioner") legacy.set(key, value);
    else values.set(`${module}.${key}`, value);
  },
};
const rect = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
const target = { mechanicalBounds: rect(100, 200, 100, 100) };
const ally = { mechanicalBounds: rect(0, 0, 200, 200) };

try {
  globalThis.game = {
    user: { isActiveGM: true }, settings,
    modules: { get: (id) => ({ active: id === "pf2e-visioner" }) },
    pf2e: { actions: { async raiseAShield({ actors }) {
      shieldCalls++;
      actors[0].itemTypes.effect.push({ slug: "raise-a-shield", system: { duration: { value: 1 } }, async update(change) {
        this.system.duration.value = change["system.duration.value"];
      } });
    } } },
  };
  globalThis.canvas = { grid: { size: 100, isGridless: false } };
  globalThis.fromUuid = async () => ({ uuid: "Compendium.test.Item.rage-effect", slug: "effect-rage", isOfType: () => true, toObject: () => ({ system: {} }) });
  registerSettings();
  assert.equal(registered.get(`${MODULE_ID}.${SETTINGS.flankingSizeRule}`).scope, "world");
  assert.equal(registered.get(`${MODULE_ID}.${SETTINGS.raisePcShieldsWhenDefending}`).default, false);
  assert.equal(registered.get(`${MODULE_ID}.${SETTINGS.enrageBarbariansAtCombatStart}`).default, false);
  await settings.set(MODULE_ID, SETTINGS.autoOpen, false);
  await migrateVisionerCombatSettings();
  assert.equal(settings.get(MODULE_ID, SETTINGS.flankingSizeRule), "anySquare");
  assert.equal(settings.get(MODULE_ID, SETTINGS.raisePcShieldsWhenDefending), true);
  assert.equal(settings.get(MODULE_ID, SETTINGS.enrageBarbariansAtCombatStart), true);
  for (const [key, value] of legacy) assert.equal(value, key === SETTINGS.flankingSizeRule ? "raw" : false);
  assert.equal(settings.get(MODULE_ID, "visionerCombatSettingsMigrated"), true);

  const effects = [];
  const defend = { id: "defend", slug: "defend" };
  const actor = {
    type: "character", name: "PC", uuid: "Actor.pc", heldShield: { isBroken: false, isDestroyed: false },
    system: { exploration: [defend.id] }, items: new Map([[defend.id, defend]]),
    itemTypes: {
      effect: effects, feat: [{ slug: "quick-tempered" }],
      action: [{ slug: "rage", uuid: "Actor.pc.Item.rage", system: { selfEffect: { uuid: "Compendium.test.Item.rage-effect" } } }],
    },
    async createEmbeddedDocuments(_type, documents) {
      rageCalls++;
      effects.push({ slug: "effect-rage", sourceId: "Compendium.test.Item.rage-effect", ...documents[0] });
    },
  };
  const token = { document: { uuid: "Scene.test.Token.pc" } };
  const combat = { combatants: [{ actor, token: { object: token } }] };
  await applyCombatStartCharacterActions(combat);
  await applyCombatStartCharacterActions(combat);
  assert.equal(shieldCalls, 1, "Defend shield runs once with panel auto-open disabled");
  assert.equal(rageCalls, 1, "Quick-Tempered Rage runs once with panel auto-open disabled");
  assert.equal(effects.find((effect) => effect.slug === "raise-a-shield").system.duration.value, 0);

  const moduleLookup = game.modules.get;
  const settingLookup = settings.get;
  game.modules.get = (id) => ({ active: id === "pf2e-avoid-notice" });
  settings.get = (module, key) => module === "pf2e-avoid-notice" ? true : settingLookup(module, key);
  actor.itemTypes.effect = [];
  await applyCombatStartCharacterActions(combat);
  assert.equal(shieldCalls, 1, "Avoid Notice owns shield automation when enabled");
  assert.equal(rageCalls, 1, "Avoid Notice owns Rage automation when enabled");
  game.modules.get = moduleLookup;
  settings.get = settingLookup;

  class Token {
    onOppositeSides() { return false; }
  }
  globalThis.CONFIG = { Token: { objectClass: Token } };
  assert.equal(registerFlankingSizeRuleWrapper(null), true);
  assert.equal(registerFlankingSizeRuleWrapper(null), true);
  const flanker = { mechanicalBounds: rect(200, 300, 100, 100) };
  assert.equal(new Token().onOppositeSides(flanker, ally, target), true);
  await settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "lineThrough");
  assert.equal(new Token().onOppositeSides(flanker, ally, target), true);
  await settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "oppositeArcs");
  assert.equal(new Token().onOppositeSides(flanker, ally, target), true);
  await settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "anyCorner");
  assert.equal(new Token().onOppositeSides(
    { mechanicalBounds: rect(200, 200, 100, 100) },
    { mechanicalBounds: rect(100, 100, 100, 100) }, target,
  ), true);
  await settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "anySquare");
  globalThis.canvas.grid.isGridless = true;
  assert.equal(new Token().onOppositeSides(flanker, ally, target), false);
  globalThis.canvas.grid.isGridless = false;
  await settings.set(MODULE_ID, SETTINGS.flankingSizeRule, "raw");
  assert.equal(new Token().onOppositeSides(flanker, ally, target), false);

  const main = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
  assert.ok(main.includes('Hooks.on("combatStart", (combat) => {'));
  assert.ok(main.indexOf('Hooks.on("combatStart"') < main.indexOf('if (!setting(SETTINGS.autoOpen) && !activePanel) return;'));
  console.log("PF2e Combater standalone combat automation test passed");
} finally {
  for (const [key, value] of Object.entries(saved)) globalThis[key] = value;
}
