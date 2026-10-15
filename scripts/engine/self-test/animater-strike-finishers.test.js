import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildActionBuilderModel } from "../action/builder/index.js";
import { decorateBuilder } from "../../ui/panel/view-model.js";
import { chooseStepFinisher } from "../../ui/panel/plan-layout.js";
import { finisherOptions, strikeFinisherTarget } from "../../integrations/animater.js";

// Synthetic PF2e strikes (Fist, the basic unarmed attack, rule-element strikes) have no Item
// document: fromUuidSync finds nothing (or, for a rule-element strike, its feat). Combater then
// hands Animater a strike descriptor { actor, name, slug } instead.
const owners = new Set(["player-1", "player-3"]);
const actor = { uuid: "Actor.a1", testUserPermission: (user, level) => level === "OWNER" && owners.has(user.id) };
const feat = { uuid: "Actor.a1.Item.feat1", type: "feat", name: "Animal Instinct", actor };
const fist = { uuid: "Actor.a1.Item.xxxxxxFISTxxxxxx", id: "xxxxxxFISTxxxxxx", type: "weapon", name: "Fist", slug: "fist", actor };
const jaws = { uuid: "Actor.a1.Item.feat1", id: "feat1", type: "weapon", name: "Jaws", slug: "jaws", actor };
const choices = [{ id: "launch", name: "Launch", description: "", on: "criticalOrKill" }];
const seen = [];
const setCalls = [];
const picks = new Map([["fist", "launch"]]);
const finishers = {
  choices: (item, user) => {
    seen.push(item);
    const strike = !item?.uuid && item?.actor && (item.name || item.slug);
    return strike && ["fist", "jaws"].includes(item.slug) && (user ?? globalThis.game.user).id.startsWith("player") ? choices : [];
  },
  getChoice: (item) => picks.get(item?.slug) ?? null,
  setChoice: async (item, id) => { setCalls.push(item); picks.set(item.slug, id); },
};
const previous = { game: globalThis.game, fromUuidSync: globalThis.fromUuidSync };
const setGame = ({ isGM = false } = {}) => {
  globalThis.game = {
    user: { id: isGM ? "gm-1" : "player-1", isGM },
    users: [{ id: "gm-1", isGM: true }, { id: "player-1", isGM: false }, { id: "player-3", isGM: false }],
    settings: { get: () => undefined },
    modules: new Map([["animater", { active: true, api: { finishers } }]]),
  };
};
globalThis.fromUuidSync = (uuid) => (uuid === "Actor.a1" ? actor : uuid === feat.uuid ? feat : null);

const context = { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } };
const strikeCandidate = (item) => ({
  id: `strike-${item.slug}`, key: `strike-${item.slug}`, slug: "strike", name: item.name,
  source: "strike", executable: "strike", actionCost: 1, available: true, item,
});
const stepFor = (candidate) => decorateBuilder(buildActionBuilderModel({
  context,
  candidates: [candidate],
  plans: [],
  draft: { steps: [{ instanceId: "s1", actionKey: candidate.key, name: candidate.name, actionCost: 1 }] },
  favorites: new Set(),
}), "one").draft.steps[0];

try {
  setGame();
  // The descriptor: the strike's actor, name and slug.
  const target = strikeFinisherTarget({ source: "strike", item: { uuid: "x", name: "Fist", slug: "fist" } }, { actor });
  assert.deepEqual({ ...target, actor: target.actor.uuid }, { actor: "Actor.a1", name: "Fist", slug: "fist" });
  assert.equal(strikeFinisherTarget({ source: "action", item: { name: "Shove" } }, { actor }), null, "only strikes");
  assert.equal(strikeFinisherTarget({ source: "strike", item: {} }, { actor }), null, "a strike needs a name or slug");

  // A Fist step shows the pill and its pick.
  const step = stepFor(strikeCandidate(fist));
  assert.equal(step.canChooseFinisher, true, "a Fist step offers finishers");
  assert.equal(step.finisherLabel, "Launch");
  assert.equal(step.finisherItemUuid, "", "no item to resolve");
  assert.equal(step.finisherActorUuid, "Actor.a1");
  assert.equal(step.finisherStrikeName, "Fist");
  assert.equal(step.finisherStrikeSlug, "fist");
  assert.ok(seen.some((item) => item.actor === actor && item.name === "Fist" && item.slug === "fist"), "Animater got the descriptor");

  // A rule-element strike whose id is its feat's: the feat is not the strike.
  const jawsStep = stepFor(strikeCandidate(jaws));
  assert.equal(jawsStep.canChooseFinisher, true, "Jaws offers finishers, not the feat's");
  assert.equal(jawsStep.finisherStrikeName, "Jaws");

  // The GM sees the union over the players who own the actor.
  setGame({ isGM: true });
  assert.deepEqual(finisherOptions({ actor, name: "Fist", slug: "fist" }).map((choice) => choice.id), ["launch"]);
  assert.equal(stepFor(strikeCandidate(fist)).canChooseFinisher, true, "the GM picks on a player's Fist step");
  owners.clear();
  assert.equal(stepFor(strikeCandidate(fist)).canChooseFinisher, false, "no picker on an NPC's Fist");
  owners.add("player-1").add("player-3");
  setGame();

  // A non-strike step whose item does not resolve still shows nothing.
  const shove = { id: "shove", key: "shove", slug: "shove", name: "Shove", source: "action", actionCost: 1, available: true, item: { uuid: "Actor.a1.Item.gone", name: "Shove" } };
  assert.equal(stepFor(shove).canChooseFinisher, false);

  // Choosing from the menu sends the descriptor.
  let renders = 0;
  const panel = { render: async () => { renders++; } };
  await chooseStepFinisher(panel, "", "", { actorUuid: "Actor.a1", name: "Fist", slug: "fist" });
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].actor, actor);
  assert.equal(setCalls[0].name, "Fist");
  assert.equal(setCalls[0].slug, "fist");
  assert.equal(renders, 0);
  await chooseStepFinisher(panel, "", "launch", { actorUuid: "Actor.gone", name: "Fist", slug: "fist" });
  assert.equal(setCalls.length, 1, "an unresolved actor is not sent");
  assert.equal(renders, 1);

  const template = readFileSync(new URL("../../../templates/combater-panel.hbs", import.meta.url), "utf8");
  assert.match(template, /data-finisher-actor="{{finisherActorUuid}}" data-finisher-strike-name="{{finisherStrikeName}}" data-finisher-strike-slug="{{finisherStrikeSlug}}"/);
} finally {
  globalThis.game = previous.game;
  globalThis.fromUuidSync = previous.fromUuidSync;
}

console.log("Animater strike finisher tests passed.");
