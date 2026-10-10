import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCombatContext } from "../../state/combat-context.js";

const saved = { game: globalThis.game, canvas: globalThis.canvas };
const actor = (id, type = "character", owned = true) => ({
  id, uuid: `Actor.${id}`, name: id, type, isOwner: owned,
  testUserPermission: () => owned,
  system: { attributes: { hp: { value: 10, max: 10 } }, traits: { value: id === "eidolon" ? ["eidolon"] : [] } },
  items: [], itemTypes: { action: [], feat: [], feature: [], consumable: [], spell: [] },
});
const token = (actor) => ({
  id: actor.id, actor,
  document: { id: actor.id, uuid: `Scene.test.Token.${actor.id}`, actor, disposition: 1, x: 0, y: 0, width: 1, height: 1 },
});

try {
  const master = token(actor("master"));
  const eidolon = token(actor("eidolon"));
  const summon = token(actor("summon", "npc"));
  const foreign = token(actor("foreign", "npc", false));
  const combatant = { id: "master-turn", actor: master.actor, tokenId: master.id, token: { object: master } };
  globalThis.game = {
    user: { id: "player", isGM: false, targets: new Set() },
    combat: { id: "combat", started: true, round: 1, turn: 0, combatant, combatants: [combatant] },
  };
  globalThis.canvas = { scene: { id: "test" }, grid: { size: 1 }, tokens: { controlled: [], placeables: [master, eidolon, summon, foreign] } };

  // Invoke the real canvas selection hook, then read the context on its deferred refresh.
  const source = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
  const hookSource = source.match(/Hooks\.on\("controlToken", \(token, controlled\) => \{([\s\S]*?)\n\}\);/)[1];
  let refreshes = 0;
  const panel = { _context: { token: { id: master.id } }, selectCombatant(value) { this.selected = value; } };
  const hook = new Function("activePanel", "isNonPlannableActorToken", "combatantForSelectedToken", "actorOwnedByUser", "scheduleRefresh", "token", "controlled", hookSource);
  const select = (selected) => {
    canvas.tokens.controlled = [selected];
    hook(panel, (entry) => ["hazard", "loot"].includes(entry.actor.type), () => null,
      (entry) => entry.isOwner, () => { refreshes++; }, selected, true);
    return readCombatContext("token-control", { combatant });
  };
  for (const selected of [eidolon, summon]) {
    const before = refreshes;
    const context = select(selected);
    assert.equal(refreshes, before + 1, "owned token outside tracker must schedule panel refresh");
    assert.equal(context.actor.id, selected.actor.id, "selected minion must override stale master context");
    assert.equal(context.token.id, selected.id);
    assert.equal(context.combat.id, "combat");
    assert.equal(context.isGM, false);
  }
  const beforeForeign = refreshes;
  assert.equal(select(foreign), null, "unowned selected actor must not expose a planning context");
  assert.equal(refreshes, beforeForeign, "unowned selection must not switch the panel");
  for (const type of ["hazard", "loot"]) {
    const before = refreshes;
    select(token(actor(type, type)));
    assert.equal(refreshes, before, "non-plannable selection must not switch the panel");
  }
  game.combat = null;
  assert.equal(select(eidolon).actor.id, "eidolon", "owned player tokens support planning outside combat");
  assert.equal(readCombatContext().combat.started, false);
  assert.equal(readCombatContext().actionsSpent.normal, 0);
  game.user.isGM = true;
  assert.equal(select(foreign).actor.id, "foreign", "GM retains selection access to all plannable actors");
} finally {
  Object.assign(globalThis, saved);
}
console.log("Player token selection tests passed");
