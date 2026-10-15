import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildActionBuilderModel } from "../action/builder/index.js";
import { decorateBuilder, decoratePlanLayout } from "../../ui/panel/view-model.js";
import { chooseStepFinisher } from "../../ui/panel/plan-layout.js";
import { animaterFinishers, chooseFinisher, currentFinisher, finisherOptions } from "../../integrations/animater.js";

const SWORD = "Actor.a1.Item.sword";
const owners = new Set(["player-1", "player-3"]);
const actor = { uuid: "Actor.a1", testUserPermission: (user, level) => level === "OWNER" && owners.has(user.id) };
const sword = { uuid: SWORD, name: "Longsword", actor };
const choices = [
  { id: "launch", name: "Launch", description: "", on: "criticalOrKill" },
  { id: "slam", name: "Wall Slam", description: "", on: "kill" },
];
let picked = "launch";
const setCalls = [];
const finishers = {
  // Like Animater: with no user argument, the current user's finishers.
  choices: (item, user) => (item?.uuid === SWORD && (user ?? globalThis.game.user).id.startsWith("player") ? choices : []),
  getChoice: () => picked,
  setChoice: async (item, id) => {
    setCalls.push([item?.uuid, id]);
    if (id === "forbidden") throw new Error("Not yours to pick.");
    picked = id;
  },
};

const previous = { game: globalThis.game, ui: globalThis.ui, fromUuidSync: globalThis.fromUuidSync };
const warnings = [];
const setGame = ({ active = true, api = { finishers }, isGM = false } = {}) => {
  globalThis.game = {
    user: { id: isGM ? "gm-1" : "player-1", isGM },
    users: [{ id: "gm-1", isGM: true }, { id: "player-1", isGM: false }, { id: "player-2", isGM: false }, { id: "player-3", isGM: false }],
    settings: { get: () => undefined },
    modules: new Map([["animater", { active, api }]]),
  };
};
globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
globalThis.fromUuidSync = (uuid) => (uuid === SWORD ? sword : null);

const context = { combat: { id: "combat-1", round: 1 }, combatant: { id: "c1" }, actor: { uuid: "Actor.a1" } };
const strike = {
  id: "strike-longsword", key: "strike-longsword", slug: "strike-longsword", name: "Longsword",
  source: "strike", executable: "strike", actionCost: 1, available: true, item: { uuid: SWORD, name: "Longsword" },
};
const stride = { id: "stride", key: "stride", slug: "stride", name: "Stride", actionCost: 1, available: true };
const draftStep = (draft = {}) => decorateBuilder(buildActionBuilderModel({
  context,
  candidates: [strike, stride],
  plans: [],
  draft: { steps: [{ instanceId: "s1", actionKey: strike.key, name: "Longsword", actionCost: 1 }], ...draft },
  favorites: new Set(),
}), "one").draft.steps[0];

try {
  setGame();
  assert.equal(animaterFinishers(), finishers, "the API is found when Animater is active");
  assert.deepEqual(finisherOptions(sword), choices);
  assert.equal(currentFinisher(sword), "launch");

  // (a) A strike step whose item resolves offers its finishers.
  const step = draftStep();
  assert.equal(step.canChooseFinisher, true, "a strike with finisher choices can pick one");
  assert.deepEqual(step.finisherOptions, [
    { id: "", name: "None", active: false },
    { id: "launch", name: "Launch", active: true },
    { id: "slam", name: "Wall Slam", active: false },
  ]);
  assert.equal(step.finisherLabel, "Launch");
  assert.equal(step.finisherPillText, "Finisher animation: Launch", "the pill is not confused with PF2e's finisher trait");
  assert.equal(step.finisherItemUuid, SWORD);
  assert.equal(step.finisherAria, "Choose this action's finisher animation (current: Launch)");

  // A stale pick (not among the choices) shows None.
  picked = "deleted-finisher";
  const stale = draftStep();
  assert.equal(stale.finisherLabel, "None");
  assert.equal(stale.finisherOptions[0].active, true);
  assert.ok(stale.finisherOptions.slice(1).every((option) => !option.active));
  picked = null;
  assert.equal(draftStep().finisherLabel, "None");
  picked = "launch";

  // (b) No control without Animater, the API, choices, an item, or edit rights.
  setGame({ active: false });
  assert.equal(animaterFinishers(), null);
  assert.equal(draftStep().canChooseFinisher, false, "inactive Animater shows no control");
  setGame({ api: {} });
  assert.equal(draftStep().canChooseFinisher, false, "missing API shows no control");
  setGame({ api: null });
  assert.equal(draftStep().canChooseFinisher, false, "no API object shows no control");
  setGame({ api: { finishers: { ...finishers, choices: () => [] } } });
  assert.equal(draftStep().canChooseFinisher, false, "no choices shows no control");
  setGame({ api: { finishers: { ...finishers, choices: () => { throw new Error("boom"); } } } });
  assert.equal(draftStep().canChooseFinisher, false, "a throwing API shows no control");
  setGame();
  const strideStep = decorateBuilder(buildActionBuilderModel({
    context, candidates: [stride], plans: [], favorites: new Set(),
    draft: { steps: [{ instanceId: "m1", actionKey: "stride", name: "Stride", actionCost: 1 }] },
  }), "one").draft.steps[0];
  assert.equal(strideStep.canChooseFinisher, false, "a step without an item shows no control");
  assert.equal(draftStep({ readonly: true }).canChooseFinisher, false, "a player's readonly plan shows no control");
  setGame({ isGM: true });
  assert.equal(draftStep({ readonly: true, shared: true }).canChooseFinisher, true, "the GM can pick on a player's plan");
  assert.deepEqual(finisherOptions(sword).map((choice) => choice.id), ["launch", "slam"],
    "the GM sees the finishers of the players who own the actor, without duplicates");
  setGame({ isGM: true, api: { finishers: { ...finishers, choices: (item, user) => (user ? [] : choices) } } });
  assert.deepEqual(finisherOptions(sword), [], "the GM gets no fallback to their own finishers: picks only play for owning players");
  // An item no player owns (an NPC's): picks never play there, so no picker, for the GM or anyone.
  owners.clear();
  setGame({ isGM: true });
  assert.deepEqual(finisherOptions(sword), [], "the GM sees no picker on an item with no player owners");
  assert.equal(draftStep().canChooseFinisher, false, "no picker on an NPC's item");
  setGame();
  assert.deepEqual(finisherOptions(sword), [], "nor does anyone else");
  owners.add("player-1").add("player-3");
  setGame();

  // (c) The ⋯ drawer opens for a finisher alone.
  const layout = decoratePlanLayout([{
    instanceId: "f1", name: "Longsword", actionCost: 1, canShowExecuteStep: true, canChooseFinisher: true,
  }]);
  assert.equal(layout.steps[0].hasMoreTools, true, "a finisher alone fills the drawer");
  assert.equal(decoratePlanLayout([{ instanceId: "f2", name: "Longsword", actionCost: 1 }]).steps[0].hasMoreTools, false);

  // (d) Templates are not rendered headless; check the markup instead.
  const template = readFileSync(new URL("../../../templates/combater-panel.hbs", import.meta.url), "utf8");
  const drawer = template.slice(template.indexOf('<span class="combater-step-more-tools">'));
  const finisherMarkup = drawer.slice(0, drawer.search(/<\/span>\r?\n\s*{{\/if}}/));
  assert.match(finisherMarkup, /{{#if canChooseFinisher}}/);
  assert.match(finisherMarkup, /class="combater-finisher-toggle"[^>]*data-finisher-menu-toggle[^>]*aria-haspopup="true"[^>]*aria-expanded="false"[^>]*aria-label="{{finisherAria}}"/);
  assert.match(finisherMarkup, /class="combater-finisher-menu" data-finisher-menu popover="auto" role="group"/);
  assert.match(finisherMarkup, /{{#each finisherOptions}}[\s\S]*data-finisher-choice="{{id}}"[\s\S]*{{\/each}}/);
  assert.match(finisherMarkup, /data-finisher-item="{{finisherItemUuid}}"/);
  assert.match(finisherMarkup, /<span>{{finisherPillText}}<\/span>/, "the pill shows the full label");
  assert.match(finisherMarkup, /aria-label="{{localize "PF2E_COMBATER\.Panel\.FinisherAria"}}"/);
  const en = JSON.parse(readFileSync(new URL("../../../lang/en.json", import.meta.url), "utf8")).PF2E_COMBATER.Panel;
  assert.equal(en.FinisherLabel, "Finisher animation: {name}");
  assert.equal(en.FinisherAria, "Choose this action's finisher animation");
  assert.equal(en.FinisherAriaCurrent, "Choose this action's finisher animation (current: {name})");
  assert.equal(en.Finisher, undefined, "the bare \"Finisher\" label is gone");

  // (e) A successful pick leaves the redraw to the hook; a refusal warns and re-renders.
  let renders = 0;
  const panel = { render: async (options) => { renders++; assert.deepEqual(options, { force: true }); } };
  await chooseStepFinisher(panel, SWORD, "slam");
  assert.deepEqual(setCalls.at(-1), [SWORD, "slam"]);
  assert.equal(renders, 0, "a successful pick does not re-render itself");
  await chooseStepFinisher(panel, SWORD, "");
  assert.deepEqual(setCalls.at(-1), [SWORD, null], "None clears the pick");
  assert.equal(renders, 0);
  await chooseStepFinisher(panel, SWORD, "forbidden");
  assert.deepEqual(warnings, ["Not yours to pick."], "a refused pick warns");
  assert.equal(renders, 1, "a refusal re-renders");
  const before = setCalls.length;
  await chooseStepFinisher(panel, "Actor.a1.Item.gone", "slam");
  assert.equal(setCalls.length, before, "an unresolved item is not sent to Animater");
  setGame({ active: false });
  await chooseFinisher(sword, "slam");
  assert.equal(setCalls.length, before, "nothing is sent without Animater");
} finally {
  globalThis.game = previous.game;
  globalThis.ui = previous.ui;
  globalThis.fromUuidSync = previous.fromUuidSync;
}

console.log("Animater finisher tests passed.");
