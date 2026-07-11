import assert from "node:assert/strict";
import {
  isRecallKnowledgeMatrixMessage,
  recallKnowledgeDegreeFromTotal,
  recallKnowledgeDieResultFromMessage,
  recallKnowledgeHasDubiousKnowledge,
  recallKnowledgeOutcomeFromMessage,
  recallKnowledgeRollFlavor,
  recallKnowledgeRollRows,
  rollRecallKnowledge,
} from "../execution/recall-knowledge.js";
import {
  adjudicateRecallKnowledgeRequest,
  openRecallKnowledgeIntelWindow,
  recallKnowledgeCalculatedOutcomes,
  recallKnowledgeChatRowDecorations,
  resetRecallKnowledgeAttemptsForTarget,
  resolveRecallKnowledgeRequest,
} from "../../ui/recall-knowledge.js";
import { canUseIntelFact, intelLedgerView, normalizeIntelFalseInformation } from "../../rules/intel-ledger.js";
import {
  RECALL_KNOWLEDGE_QUESTIONS,
  nextRecallKnowledgeAttempts,
  normalizeRecallKnowledgeOutcome,
  recallKnowledgeAttemptState,
  recallKnowledgeDcMatrix,
  recallKnowledgeDcOptions,
  recallKnowledgeSkillOptions,
  recordRecallKnowledgeAttempt,
  resetRecallKnowledgeAttempt,
} from "../../rules/recall-knowledge.js";

function statistic(label, modifier, rank) {
  return {
    label,
    mod: modifier,
    rank,
    withRollOptions(options) {
      return {
        label,
        rank,
        check: {
          mod: modifier,
          breakdown: `${label} ${modifier >= 0 ? "+" : ""}${modifier}; ${options.extraRollOptions.join(",")}`,
        },
      };
    },
  };
}

function persistLikeFoundryFlag(value) {
  const persisted = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    const parts = key.split(".");
    let cursor = persisted;
    for (const part of parts.slice(0, -1)) {
      cursor[part] = cursor[part] && typeof cursor[part] === "object" ? cursor[part] : {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = entry;
  }
  return persisted;
}

function mergeLikeFoundryFlag(current, value) {
  const merged = structuredClone(current ?? {});
  const source = persistLikeFoundryFlag(value);
  const merge = (target, next) => {
    for (const [key, entry] of Object.entries(next ?? {})) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        target[key] = target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
          ? target[key]
          : {};
        merge(target[key], entry);
      } else {
        target[key] = entry;
      }
    }
    return target;
  };
  return merge(merged, source);
}

let storedAttempts = {};
const actor = {
  id: "recaller",
  uuid: "Actor.recaller",
  system: {},
  itemTypes: {
    lore: [{ name: "Undead Lore", slug: "undead-lore" }],
  },
  getStatistic(slug) {
    if (slug === "arcana") return statistic("Arcana", 8, 1);
    if (slug === "religion") return statistic("Religion", 9, 1);
    if (slug === "undead-lore") return statistic("Undead Lore", 11, 1);
    return null;
  },
  getFlag() {
    return storedAttempts;
  },
  async setFlag(_moduleId, _flag, value) {
    storedAttempts = value;
    return value;
  },
};
const target = {
  id: "target",
  uuid: "Actor.target",
  identificationDCs: {
    skills: ["religion"],
    standard: { dc: 20, progression: [20, 22, 25] },
    lore: [
      { dc: 18, progression: [18, 20, 23] },
      { dc: 15, progression: [15, 18, 20] },
    ],
  },
};

const skills = recallKnowledgeSkillOptions(actor);
assert.deepEqual(
  skills.map((entry) => entry.slug),
  ["arcana", "religion", "undead-lore"],
  "player skill list should come only from their actor and include Lore",
);
assert.deepEqual(
  RECALL_KNOWLEDGE_QUESTIONS.map((entry) => entry.id),
  ["notable", "defenses", "weaknesses", "protections"],
  "basic identity should be automatic, not a mutually exclusive Recall Knowledge question",
);

const applicable = recallKnowledgeDcOptions(actor, target, { slug: "religion", kind: "standard" });
assert.equal(applicable.allowed, true);
assert.equal(applicable.applicable, true);
assert.equal(applicable.attempt, 1);
assert.equal(applicable.choices[0].dc, 20);

const discretionary = recallKnowledgeDcOptions(actor, target, { slug: "arcana", kind: "standard" });
assert.equal(discretionary.choices[0].id, "gm-discretion");
assert.equal(discretionary.choices[0].dc, 20);

const lore = recallKnowledgeDcOptions(actor, target, { slug: "undead-lore", kind: "lore" });
assert.deepEqual(lore.choices.map((choice) => choice.dc), [18, 15]);

const matrix = recallKnowledgeDcMatrix(actor, target);
assert.equal(matrix.allowed, true);
assert.equal(matrix.attempt, 1);
assert.deepEqual(matrix.skills, ["religion"]);
assert.equal(matrix.standardDc, 20);
assert.equal(matrix.broadLoreDc, 18);
assert.equal(matrix.specificLoreDc, 15);

let persistedAttemptFlag = {};
const persistenceActor = {
  getFlag() { return persistedAttemptFlag; },
  async setFlag(_moduleId, _flag, value) { persistedAttemptFlag = mergeLikeFoundryFlag(persistedAttemptFlag, value); },
  async unsetFlag() { persistedAttemptFlag = {}; },
};
const persistenceTarget = { uuid: "Scene.scene1.Token.token1.Actor.wraith1" };
persistedAttemptFlag = persistLikeFoundryFlag({
  [persistenceTarget.uuid]: {
    attempts: 1,
    blocked: false,
    lastOutcome: "success",
    lastSkill: "religion",
    lastQuestion: "weaknesses",
  },
});
assert.equal(recallKnowledgeAttemptState(persistenceActor, persistenceTarget).attempts, 1, "legacy nested attempt flag should remain readable");
await recordRecallKnowledgeAttempt(persistenceActor, persistenceTarget, { outcome: "success" });
assert.equal(recallKnowledgeAttemptState(persistenceActor, persistenceTarget).attempts, 2, "legacy nested attempt flag should migrate to safe key");
assert.equal(Object.hasOwn(persistedAttemptFlag, "Scene"), false, "migration should remove malformed nested UUID root");

persistedAttemptFlag = {};
await recordRecallKnowledgeAttempt(persistenceActor, persistenceTarget, { outcome: "success" });
await recordRecallKnowledgeAttempt(persistenceActor, persistenceTarget, { outcome: "success" });
assert.equal(
  recallKnowledgeAttemptState(persistenceActor, persistenceTarget).attempts,
  2,
  "Foundry-persisted dotted target UUID keys must retain Recall Knowledge attempt progression",
);
assert.equal(await resetRecallKnowledgeAttempt(persistenceActor, persistenceTarget), true);
assert.equal(recallKnowledgeAttemptState(persistenceActor, persistenceTarget).attempts, 0);
assert.equal(recallKnowledgeAttemptState(persistenceActor, persistenceTarget).blocked, false);
assert.deepEqual(persistedAttemptFlag, {});
assert.equal(await resetRecallKnowledgeAttempt(persistenceActor, persistenceTarget), false, "reset should skip untracked actor-target pairs");

const previousResetGame = globalThis.game;
try {
  let syntheticAttempts = {};
  const syntheticRecaller = {
    uuid: "Scene.scene1.Token.hero1.Actor.hero1",
    getFlag() { return syntheticAttempts; },
    async setFlag(_moduleId, _flag, value) { syntheticAttempts = value; },
  };
  await recordRecallKnowledgeAttempt(syntheticRecaller, persistenceTarget, { outcome: "failure" });
  assert.equal(recallKnowledgeAttemptState(syntheticRecaller, persistenceTarget).blocked, true);
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: [{ uuid: "Actor.hero1", getFlag: () => undefined }],
    combat: { combatants: [{ actor: syntheticRecaller }] },
    i18n: { localize: (key) => key },
  };
  assert.equal(
    await resetRecallKnowledgeAttemptsForTarget(persistenceTarget, { confirm: false }),
    1,
    "GM reset must include synthetic actors participating in active combat",
  );
  assert.equal(recallKnowledgeAttemptState(syntheticRecaller, persistenceTarget).blocked, false);
} finally {
  globalThis.game = previousResetGame;
}

await recordRecallKnowledgeAttempt(actor, target, {
  outcome: "success",
  skill: "religion",
  question: "weaknesses",
});
assert.equal(recallKnowledgeAttemptState(actor, target).attempts, 1);
assert.equal(recallKnowledgeDcOptions(actor, target, "religion").choices[0].dc, 22);

await recordRecallKnowledgeAttempt(actor, target, { outcome: "failure", skill: "religion" });
assert.equal(recallKnowledgeAttemptState(actor, target).blocked, true);
assert.equal(recallKnowledgeDcOptions(actor, target, "religion").allowed, false);

const unchanged = nextRecallKnowledgeAttempts(storedAttempts, target, { outcome: "not-a-result" });
assert.deepEqual(unchanged, storedAttempts, "invalid outcomes must not alter attempt state");
assert.equal(normalizeRecallKnowledgeOutcome("Critical Success"), "criticalsuccess");
assert.equal(recallKnowledgeDegreeFromTotal(30, 20, 10), "criticalsuccess");
assert.equal(recallKnowledgeDegreeFromTotal(20, 20, 10), "success");
assert.equal(recallKnowledgeDegreeFromTotal(19, 20, 10), "failure");
assert.equal(recallKnowledgeDegreeFromTotal(10, 20, 10), "criticalfailure");
assert.equal(recallKnowledgeDegreeFromTotal(19, 20, 20), "success", "natural 20 raises degree");
assert.equal(recallKnowledgeDegreeFromTotal(20, 20, 1), "failure", "natural 1 lowers degree");
const convergedOutcomes = recallKnowledgeCalculatedOutcomes([
  { kind: "standard", slug: "religion", label: "Religion", total: 10 },
  { kind: "lore", slug: "esoteric-lore", label: "Esoteric Lore", total: 12 },
], {
  skills: ["religion"],
  standardDc: 28,
  broadLoreDc: 26,
  specificLoreDc: 24,
}, 1);
assert.deepEqual(convergedOutcomes.map((entry) => entry.outcome), ["criticalfailure"]);
assert.equal(convergedOutcomes[0].sources.length, 3, "all applicable checks should support the highlighted outcome");

const hudMessage = {
  flavor: `<div class="pf2e-hud-rk pf2e-hud-colors">
    <div class="rk-skills">
      <span class="name rank 1">Religion</span>
      <u class="success">15</u>
      <span class="success 0" data-tooltip="PF2E.Check.Result.Degree.Check.criticalFailure"></span>
    </div>
    <div class="rk-lores-rolls">
      <span class="name">Esoteric</span><span class="rank 1">Trained</span><span>+11</span><u class="success">17</u>
      <span class="name">Farming</span><span class="rank 1">Trained</span><span>+8</span><u class="success">14</u>
    </div>
  </div>`,
  content: "",
  rolls: [{ total: 6 }],
};
assert.equal(
  recallKnowledgeOutcomeFromMessage(hudMessage, { skill: "religion", dc: 26 }),
  "criticalfailure",
  "PF2e HUD multi-skill card should resolve selected standard-skill total",
);
assert.equal(
  recallKnowledgeOutcomeFromMessage(hudMessage, { skill: "esoteric-lore", skillLabel: "Esoteric Lore", dc: 21 }),
  "failure",
  "PF2e HUD card should match Lore labels with or without the Lore suffix",
);

const coreMessage = {
  flavor: `<h4 class="action"><strong>Recall Knowledge</strong></h4><ul class="notes">
    <li class="roll-note"><strong>Dubious Knowledge</strong> When you fail, learn one correct and one erroneous answer.</li>
  </ul>`,
  content: "16",
  rolls: [{ options: { degreeOfSuccess: 1 } }],
};
assert.equal(recallKnowledgeOutcomeFromMessage(coreMessage), "failure");
assert.equal(recallKnowledgeHasDubiousKnowledge(coreMessage), true);
assert.equal(
  recallKnowledgeOutcomeFromMessage({ content: "25", flavor: "Recall Knowledge", rolls: [{ total: 25, dice: [{ results: [{ result: 20 }] }] }] }, { dc: 26 }),
  "success",
  "core-message total fallback should apply natural-20 degree increase",
);
assert.equal(
  recallKnowledgeOutcomeFromMessage({ content: "36", flavor: "Recall Knowledge", rolls: [{ total: 36, dice: [{ results: [{ result: 1 }] }] }] }, { dc: 26 }),
  "success",
  "core-message total fallback should apply natural-1 degree reduction",
);

const previousGame = globalThis.game;
const previousFromUuid = globalThis.fromUuid;
const previousRoll = globalThis.Roll;
const previousChatMessage = globalThis.ChatMessage;
const previousGetDocumentClass = globalThis.getDocumentClass;
const previousFoundry = globalThis.foundry;
try {
  let rollEvaluations = 0;
  let createdData = null;
  let createdMessage = null;
  class FakeRoll {
    constructor(formula) {
      assert.equal(formula, "1d20");
      this.formula = formula;
      this.total = 13;
      this.dice = [{ total: 13, results: [{ result: 13 }] }];
    }

    async evaluate(options) {
      rollEvaluations += 1;
      assert.deepEqual(options, { allowInteractive: false });
      return this;
    }
  }
  class FakeChatMessage {
    static getWhisperRecipients() {
      return [{ id: "gm" }];
    }

    static getSpeaker({ actor: speakerActor }) {
      return { actor: speakerActor.id };
    }

    static async create(data) {
      createdData = data;
      createdMessage = {
        id: "rk-message",
        documentName: "ChatMessage",
        author: { id: "player" },
        ...data,
      };
      return createdMessage;
    }
  }
  globalThis.Roll = FakeRoll;
  globalThis.ChatMessage = FakeChatMessage;
  globalThis.getDocumentClass = () => FakeChatMessage;
  globalThis.game = {
    user: { id: "player", isGM: false },
    i18n: { localize: (key) => key },
  };
  const result = await rollRecallKnowledge({
    actor,
    target,
    question: "weaknesses",
  });
  assert.equal(result.status, "done");
  assert.equal(Object.hasOwn(result, "outcome"), false);
  assert.equal(result.dieResult, 13);
  assert.equal(result.messageId, "rk-message");
  assert.equal(rollEvaluations, 1, "initiating client should roll exactly one d20");
  assert.deepEqual(result.rows.map((row) => [row.slug, row.total]), [
    ["arcana", 21],
    ["religion", 22],
    ["undead-lore", 24],
  ]);
  assert.equal(createdData.blind, true);
  assert.deepEqual(createdData.whisper, ["gm"]);
  assert.equal(createdData.rolls.length, 1);
  assert.equal(createdData.flags["pf2e-combater"].recallKnowledgeRoll, true);
  assert.match(createdData.flavor, /pf2e-combater-rk-roll/);
  assert.match(createdData.flavor, /Weaknesses/i);
  assert.match(createdData.flavor, /Undead Lore/);
  assert.equal(recallKnowledgeDieResultFromMessage(createdMessage), 13);
  assert.equal(isRecallKnowledgeMatrixMessage(createdMessage), true);
  assert.equal(result.patch.execution.revert.ops[0].messageId, "rk-message");
  assert.match(result.patch.execution.revert.manualWarnings[0], /manually/i);

  let remoteAttempts = {};
  let requesterOwnsActor = true;
  let dialogCalls = 0;
  let outcomeDialog = null;
  const remoteTargetFlags = {};
  const remoteActor = {
    id: "remote-recaller",
    uuid: "Actor.remote-recaller",
    system: {},
    itemTypes: { lore: [{ name: "Undead Lore", slug: "undead-lore" }] },
    getStatistic(slug) {
      if (slug === "arcana") return statistic("Arcana", 8, 1);
      if (slug === "religion") return statistic("Religion", 9, 1);
      if (slug === "undead-lore") return statistic("Undead Lore", 11, 1);
      return null;
    },
    testUserPermission() { return requesterOwnsActor; },
    getFlag() { return remoteAttempts; },
    async setFlag(_moduleId, _flag, value) { remoteAttempts = value; },
  };
  const remoteTarget = {
    id: "remote-target",
    uuid: "Actor.remote-target",
    name: "Hidden Undead",
    type: "npc",
    system: { traits: { value: ["undead"] } },
    identificationDCs: {
      skills: ["religion"],
      standard: { dc: 26, progression: [26, 28] },
      lore: [{ dc: 24, progression: [24, 26] }, { dc: 21, progression: [21, 23] }],
    },
    getFlag(_moduleId, flag) { return remoteTargetFlags[flag]; },
    async setFlag(_moduleId, flag, value) { remoteTargetFlags[flag] = value; },
  };
  const remoteMessage = {
    id: "rk-remote-message",
    documentName: "ChatMessage",
    author: { id: "player" },
    speaker: { actor: remoteActor.id },
    flavor: '<div class="pf2e-combater-rk-roll"></div>',
    flags: { "pf2e-combater": { recallKnowledgeRoll: true } },
    rolls: [{ total: 12, dice: [{ total: 12, results: [{ result: 12 }] }] }],
    async update() { throw new Error("GM-only chat colors must not update ChatMessage data"); },
  };
  globalThis.fromUuid = async (uuid) => ({
    [remoteActor.uuid]: remoteActor,
    [remoteTarget.uuid]: remoteTarget,
  })[uuid] ?? null;
  globalThis.foundry = {
    applications: {
      api: {
        DialogV2: {
          async wait(options) {
            dialogCalls += 1;
            outcomeDialog = options;
            return "failure";
          },
        },
      },
    },
  };
  globalThis.game = {
    user: { id: "gm", isGM: true },
    actors: [remoteActor],
    users: { get: (id) => ({ id, isGM: id === "gm" }) },
    messages: { get: (id) => (id === remoteMessage.id ? remoteMessage : null) },
    i18n: { localize: (key) => key },
  };
  const payload = {
    actorUuid: remoteActor.uuid,
    actorName: "Remote Hero",
    targetActorUuid: remoteTarget.uuid,
    targetName: "Hidden Undead",
    question: "weaknesses",
    messageId: remoteMessage.id,
  };
  const remoteResult = await resolveRecallKnowledgeRequest.call(
    { socketdata: { userId: "player" } },
    payload,
  );
  assert.equal(remoteResult.completed, true);
  assert.equal(dialogCalls, 1);
  assert.match(outcomeDialog.content, /Standard DC/);
  assert.match(outcomeDialog.content, />26</);
  assert.match(outcomeDialog.content, /Religion/);
  assert.match(outcomeDialog.content, /Undead Lore/);
  assert.match(outcomeDialog.content, /class="rank-1">Trained</, "GM outcome table should carry proficiency-rank colors");
  assert.match(outcomeDialog.content, /d20: <strong>12/);
  assert.match(outcomeDialog.content, /rk-degree-failure/, "applicable standard row should show failure color");
  assert.match(outcomeDialog.content, /rk-broad-failure/, "Lore row should color broad-DC result");
  assert.match(outcomeDialog.content, /rk-specific-success/, "Lore row should color specific-DC result");
  assert.match(outcomeDialog.content, /Broad Lore DC 24: Failure/);
  assert.match(outcomeDialog.content, /Specific Lore DC 21: Success/);
  assert.match(outcomeDialog.content, /Calculated roll outcomes/);
  assert.match(outcomeDialog.content, /Depends on skill and Lore applicability/);
  const chatDecorations = recallKnowledgeChatRowDecorations(
    recallKnowledgeRollRows(remoteActor, 12, { target: remoteTarget }),
    { skills: ["religion"], standardDc: 26, broadLoreDc: 24, specificLoreDc: 21 },
    12,
  );
  assert.deepEqual(chatDecorations.find((entry) => entry.slug === "arcana").classes, []);
  assert.ok(chatDecorations.find((entry) => entry.slug === "religion").classes.includes("rk-degree-failure"));
  assert.ok(chatDecorations.find((entry) => entry.slug === "undead-lore").classes.includes("rk-broad-failure"));
  assert.ok(chatDecorations.find((entry) => entry.slug === "undead-lore").classes.includes("rk-specific-success"));
  assert.equal(chatDecorations.find((entry) => entry.slug === "undead-lore").tooltip, "Broad: Failure; Specific: Success");
  assert.deepEqual(
    outcomeDialog.buttons.slice(0, 4).map((button) => button.action),
    ["criticalsuccess", "success", "failure", "criticalfailure"],
  );
  const outcomeButtons = new Map(outcomeDialog.buttons.map((button) => [button.action, button]));
  assert.match(outcomeButtons.get("success").class, /rk-calculated-outcome/);
  assert.match(outcomeButtons.get("failure").class, /rk-calculated-outcome/);
  assert.equal(outcomeButtons.get("success").icon, "fa-solid fa-dice-d20");
  assert.equal(outcomeButtons.get("criticalsuccess").class, undefined);
  assert.equal(outcomeButtons.get("criticalfailure").class, undefined);
  assert.equal(recallKnowledgeAttemptState(remoteActor, remoteTarget).blocked, true);
  assert.equal(Object.hasOwn(remoteResult, "dc"), false, "GM socket result must not return the hidden DC");
  assert.equal(Object.hasOwn(remoteResult, "outcome"), false, "GM socket result must not return the secret outcome");
  assert.doesNotMatch(JSON.stringify(remoteResult), /"(?:dc|outcome)"\s*:/i);

  let openedIntel = 0;
  remoteAttempts = {};
  const successResult = await adjudicateRecallKnowledgeRequest(
    { ...payload, outcome: "success" },
    { openIntel: async (selectedTarget) => {
      openedIntel += 1;
      assert.equal(selectedTarget, remoteTarget);
      return true;
    } },
  );
  assert.equal(successResult.completed, true);
  assert.equal(openedIntel, 1, "success should open target Intel window");

  remoteAttempts = {};
  await adjudicateRecallKnowledgeRequest(
    { ...payload, outcome: "criticalsuccess" },
    { openIntel: async () => { openedIntel += 1; return true; } },
  );
  assert.equal(openedIntel, 2, "critical success should open target Intel window");

  remoteAttempts = {};
  let criticalFailureIntelOptions = null;
  const criticalFailureResult = await adjudicateRecallKnowledgeRequest(
    { ...payload, outcome: "criticalfailure", attempt: 2 },
    {
      openIntel: async (selectedTarget, options) => {
        assert.equal(selectedTarget, remoteTarget);
        criticalFailureIntelOptions = options;
        return true;
      },
    },
  );
  assert.equal(criticalFailureResult.completed, true);
  assert.equal(Object.hasOwn(criticalFailureResult, "falseInformationDelivered"), false);
  assert.equal(criticalFailureIntelOptions.preselectIdentity, false);
  assert.deepEqual(criticalFailureIntelOptions.falseInformationContext, {
    actorUuid: remoteActor.uuid,
    actorName: "Remote Hero",
    category: "weaknesses",
    question: "weaknesses",
    attempt: 2,
  });
  assert.equal(recallKnowledgeAttemptState(remoteActor, remoteTarget).blocked, true);

  let openedView = null;
  let openedOptions = null;
  const intelOpened = await openRecallKnowledgeIntelWindow(remoteTarget, {
    openWindow: async (view, options) => {
      openedView = view;
      openedOptions = options;
      assert.equal(typeof options.onResetAttempts, "function", "GM Intel window should expose attempt reset control");
      await options.onSave([{
        actor: remoteTarget,
        value: { ...view.entries[0].values, traits: ["undead"] },
        revealMode: "band",
        falseInformation: view.entries[0].falseInformation ?? [],
      }]);
    },
  });
  assert.equal(intelOpened, true);
  assert.equal(openedView.entries.length, 1);
  assert.equal(openedView.entries[0].actor, remoteTarget, "Intel window should contain only recalled target");
  assert.deepEqual(openedView.entries[0].values.identity, ["identity"], "successful Recall Knowledge should preselect basic identity");
  assert.deepEqual(openedView.entries[0].available.identity, ["Hidden Undead (Undead)"]);
  assert.equal(openedOptions.mode, "edit");
  assert.deepEqual(remoteTargetFlags.intelLedger.identity, ["identity"]);
  assert.deepEqual(remoteTargetFlags.intelLedger.traits, ["undead"]);
  assert.equal(remoteTargetFlags.intelRevealMode, "band");

  const falseIntelOpened = await openRecallKnowledgeIntelWindow(remoteTarget, {
    preselectIdentity: false,
    falseInformationContext: {
      actorUuid: remoteActor.uuid,
      actorName: "Remote Hero",
      category: "weaknesses",
      question: "weaknesses",
      attempt: 2,
    },
    openWindow: async (view, options) => {
      const record = view.entries[0].falseInformation.at(-1);
      assert.equal(record.category, "weaknesses");
      assert.equal(record.text, "");
      await options.onSave([{
        actor: remoteTarget,
        value: view.entries[0].values,
        revealMode: view.entries[0].revealMode,
        falseInformation: [{ ...record, factId: "fire", factLabel: "Fire", value: 10 }],
      }]);
    },
  });
  assert.equal(falseIntelOpened, true);
  assert.equal(remoteTargetFlags.intelFalseInformation[0].category, "weaknesses");
  assert.equal(remoteTargetFlags.intelFalseInformation[0].sourceActorName, "Remote Hero");
  assert.equal(remoteTargetFlags.intelFalseInformation[0].label, "Fire 10");
  const playerIntelView = intelLedgerView({
    isGM: false,
    intelTargets: [{ actor: remoteTarget, name: remoteTarget.name }],
  });
  assert.deepEqual(playerIntelView.entries[0].revealed.weaknesses, ["Fire 10"]);
  assert.equal(Object.hasOwn(playerIntelView.entries[0], "falseInformation"), true, "GM player-perspective preview should retain false Intel markers");
  assert.equal(playerIntelView.entries[0].values.weaknesses, false);
  assert.equal(
    canUseIntelFact({}, { actor: remoteTarget }, "weaknesses", "radiant-damage"),
    false,
    "false category information must never unlock planner Intel facts",
  );
  globalThis.game.user.isGM = false;
  const actualPlayerIntelView = intelLedgerView({
    isGM: false,
    intelTargets: [{ actor: remoteTarget, name: remoteTarget.name }],
  });
  assert.equal(Object.hasOwn(actualPlayerIntelView.entries[0], "falseInformation"), false, "actual players must not receive false Intel markers");
  assert.match(actualPlayerIntelView.entries[0].revealed.weaknesses[0], /^Fire: (Low|Mid|High)$/, "player false numeric Intel should respect Bands only mode");
  globalThis.game.user.isGM = true;
  assert.deepEqual(
    normalizeIntelFalseInformation([
      { category: "traits", factId: "dragon", factLabel: "Dragon" },
      { category: "saves", factId: "reflex", factLabel: "Reflex", value: 18, label: "Reflex" },
      { category: "immunities", factId: "poison", factLabel: "Poison" },
    ]).map((record) => record.label),
    ["Dragon", "Reflex DC 18", "Poison"],
    "false facts should rebuild structured PF2e labels when numeric values change",
  );

  requesterOwnsActor = false;
  remoteAttempts = {};
  const denied = await resolveRecallKnowledgeRequest.call(
    { socketdata: { userId: "player" } },
    payload,
  );
  assert.equal(denied.completed, false);
  assert.match(denied.reason, /does not own/i);
  assert.equal(dialogCalls, 1, "unauthorized socket request must be rejected before GM adjudication");
  assert.equal(rollEvaluations, 1, "GM adjudication must not roll another d20");
} finally {
  globalThis.game = previousGame;
  globalThis.fromUuid = previousFromUuid;
  globalThis.Roll = previousRoll;
  globalThis.ChatMessage = previousChatMessage;
  globalThis.getDocumentClass = previousGetDocumentClass;
  globalThis.foundry = previousFoundry;
}

console.log("PF2e Combater Recall Knowledge test passed");
