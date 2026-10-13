import assert from "node:assert/strict";
import { upcomingTurnsView, registerUpcomingTurnHooks, panToUpcomingCombatant } from "../../ui/panel/upcoming-turns.js";
import { turnControlsView } from "../../ui/panel/turn-controls.js";
import { registerSettings, SETTINGS } from "../../settings.js";

const previous = { game: globalThis.game, Hooks: globalThis.Hooks, canvas: globalThis.canvas, ui: globalThis.ui };
const gm = { isGM: true };
const player = { isGM: false };
const creature = (id) => ({ id, name: id.toUpperCase(), img: `${id}-token.webp`, actor: { id, img: `${id}-actor.webp` }, visible: true });
const combat = { id: "encounter", started: true, turn: 0, round: 4, settings: { skipDefeated: true }, turns: ["a", "b", "c", "d"].map(creature) };
const ids = (view) => view.entries.map((entry) => entry.id);

try {
  globalThis.game = { combat, user: player, pf2e: { settings: { tokens: { nameVisibility: true } } } };
  let view = upcomingTurnsView();
  assert.deepEqual(ids(view), ["b", "c"]);
  assert.equal(view.entries[0].img, "b-token.webp", "preview uses the encounter token image");
  assert.equal(view.entries[0].next, true);
  assert.equal(view.entries[1].next, false);
  assert.ok(view.entries.every((entry) => entry.round === 4 && !entry.nextRound));

  combat.turn = 2;
  view = upcomingTurnsView();
  assert.deepEqual(ids(view), ["d", "a"]);
  assert.equal(view.entries[1].round, 5);
  assert.equal(view.entries[1].roundLabel, "Round 5");
  assert.equal(view.entries[1].nextRound, true);

  combat.turn = 0;
  combat.turns[1].isDefeated = true;
  assert.deepEqual(ids(upcomingTurnsView()), ["c", "d"], "skips defeated according to native combat settings");
  combat.settings.skipDefeated = false;
  assert.deepEqual(ids(upcomingTurnsView()), ["b", "c"]);
  combat.settings.skipDefeated = true;
  combat.turns[1].isDefeated = false;

  combat.turns[1].hidden = true;
  combat.turns[2].visible = false;
  assert.deepEqual(ids(upcomingTurnsView()), ["d", "a"], "hidden creatures never enter the player view model");
  assert.deepEqual(ids(upcomingTurnsView(combat, gm)), ["b", "c"], "GM retains full initiative preview");
  combat.turns[1].hidden = false;
  combat.turns[2].visible = true;
  combat.turns[1].playersCanSeeName = false;
  assert.equal(upcomingTurnsView().entries[0].name, "Unknown creature");
  assert.ok(!upcomingTurnsView().entries[0].tooltip.includes("B ·"), "tooltip also masks the name");
  assert.equal(upcomingTurnsView(combat, gm).entries[0].name, "B");
  game.pf2e.settings.tokens.nameVisibility = false;
  assert.equal(upcomingTurnsView().entries[0].name, "B");

  combat.turns[1].img = "";
  assert.equal(upcomingTurnsView().entries[0].img, "b-actor.webp");
  combat.turns[1].actor = null;
  assert.equal(upcomingTurnsView().entries[0].img, "icons/svg/mystery-man.svg");

  combat.turns = [creature("a"), creature("b")];
  assert.deepEqual(ids(upcomingTurnsView()), ["b", "a"], "two creatures include the current actor's next-round turn");
  combat.turns = [creature("a")];
  assert.deepEqual(ids(upcomingTurnsView()), ["a"], "single-creature encounters do not duplicate portraits");
  combat.turns[0].isDefeated = true;
  assert.equal(upcomingTurnsView().visible, false);
  combat.turns = [];
  assert.equal(upcomingTurnsView().visible, false);
  combat.turns = [creature("a"), creature("b")];
  combat.turn = null;
  assert.deepEqual(ids(upcomingTurnsView()), ["a", "b"]);
  combat.started = false;
  assert.equal(upcomingTurnsView().visible, false);
  assert.equal(upcomingTurnsView(null).visible, false);

  const handlers = new Map();
  const refreshes = [];
  globalThis.Hooks = { on: (event, fn) => handlers.set(event, fn) };
  registerUpcomingTurnHooks((reason) => refreshes.push(reason));
  for (const event of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
    handlers.get(event)({ parent: combat });
    handlers.get(event)({ parent: { id: "unrelated-combat" } });
  }
  assert.equal(refreshes.length, 3, "initiative changes refresh only the active encounter");
  handlers.get("updateActor")(combat.turns[0].actor, { img: "new.webp" });
  handlers.get("updateActor")(combat.turns[0].actor, { system: { hp: 20 } });
  handlers.get("updateActor")({ id: "unrelated-actor" }, { name: "Other" });
  combat.turns[0].token = { id: "token-a" };
  handlers.get("updateToken")({ id: "token-a" }, { texture: { src: "new.webp" } });
  handlers.get("updateSetting")({ key: "core.combatTrackerConfig" });
  handlers.get("updateSetting")({ key: "pf2e.metagame_tokenSetsNameVisibility" });
  assert.equal(refreshes.length, 7, "portrait, name visibility, and skip-defeated changes refresh the preview");

  const registered = new Map();
  let showNavigation = true;
  game.settings = {
    get: (_module, key) => key === SETTINGS.showTurnNavigation ? showNavigation : undefined,
    register: (_module, key, data) => registered.set(key, data),
  };
  Hooks.callAll = (event) => handlers.get(event)?.();
  registerSettings();
  const navigationSetting = registered.get(SETTINGS.showTurnNavigation);
  assert.equal(navigationSetting.scope, "client");
  assert.equal(navigationSetting.default, true);
  navigationSetting.onChange();
  assert.equal(refreshes.at(-1), "turn-navigation-setting", "setting updates the open panel immediately");
  combat.started = true;
  combat.turn = 0;
  combat.turns = ["a", "b", "c"].map((id, index) => ({
    ...creature(id), sceneId: "scene",
    token: { object: { visible: true, center: { x: 100 + index * 50, y: 200 } } },
  }));
  combat.combatant = combat.turns[0];
  const context = { combat, combatant: combat.combatant };
  assert.equal(turnControlsView(context, combat, gm).controlsCurrent, true);
  showNavigation = false;
  assert.deepEqual(upcomingTurnsView(combat, player), { visible: false, entries: [] });
  assert.deepEqual(upcomingTurnsView(combat, gm), { visible: false, entries: [] });
  assert.deepEqual(turnControlsView(context, combat, player), { visible: false });
  assert.deepEqual(turnControlsView(context, combat, gm), { visible: false });
  showNavigation = true;
  assert.equal(upcomingTurnsView().visible, true);

  const pans = [];
  const warnings = [];
  globalThis.canvas = { ready: true, scene: { id: "scene" }, animatePan: async (position) => pans.push(position) };
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  assert.equal(await panToUpcomingCombatant("b", combat.id), true);
  assert.equal(await panToUpcomingCombatant("c", combat.id), true);
  assert.deepEqual(pans, [{ x: 150, y: 200, duration: 350 }, { x: 200, y: 200, duration: 350 }], "both upcoming tokens pan without changing zoom or selection");
  assert.equal(await panToUpcomingCombatant("b", "old-encounter"), false);
  assert.equal(await panToUpcomingCombatant("a", combat.id), false, "stale preview cannot pan to an unrelated combatant");
  combat.turns[1].hidden = true;
  assert.equal(await panToUpcomingCombatant("b", combat.id), false, "players cannot pan to hidden combatants");
  game.user = gm;
  assert.equal(await panToUpcomingCombatant("b", combat.id), true, "GM can pan to a hidden combatant visible to the GM");
  game.user = player;
  combat.turns[1].hidden = false;
  combat.turns[1].token.object.visible = false;
  assert.equal(await panToUpcomingCombatant("b", combat.id), false, "a listed combatant can still be outside token vision");
  game.user = gm;
  assert.equal(await panToUpcomingCombatant("b", combat.id), true, "the GM can pan to a token outside their current vision");
  game.user = player;
  combat.turns[1].token.object.visible = true;
  const unlinked = { ...combat.turns[1] };
  combat.turns[1] = { ...unlinked, sceneId: undefined, tokenId: "token-b", token: undefined };
  globalThis.canvas.tokens = { get: (id) => (id === "token-b" ? { visible: true, center: { x: 150, y: 200 } } : null) };
  assert.equal(await panToUpcomingCombatant("b", combat.id), true, "a token on the canvas pans even when the combatant lacks scene references");
  combat.turns[1] = unlinked;
  delete globalThis.canvas.tokens;
  combat.turns[1].sceneId = "other-scene";
  assert.equal(await panToUpcomingCombatant("b", combat.id), false);
  combat.turns[1].sceneId = "scene";
  canvas.ready = false;
  assert.equal(await panToUpcomingCombatant("b", combat.id), false);
  canvas.ready = true;
  combat.turns[1].token.object = null;
  assert.equal(await panToUpcomingCombatant("b", combat.id), false);
  showNavigation = false;
  assert.equal(await panToUpcomingCombatant("c", combat.id), false);
  assert.equal(pans.length, 5, "unavailable and hidden navigation never moves the camera");
  assert.equal(warnings.length, 4);
} finally {
  globalThis.game = previous.game;
  globalThis.Hooks = previous.Hooks;
  globalThis.canvas = previous.canvas;
  globalThis.ui = previous.ui;
}
console.log("Upcoming turn preview tests passed.");
