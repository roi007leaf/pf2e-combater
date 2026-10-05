import assert from 'node:assert/strict';
import { readBestiaryKnowledge, withBestiaryKnowledge } from '../../integrations/bestiary.js';
import { readCombatContext } from '../../state/combat-context.js';
import { normalizeIntelLedger } from '../../rules/intel-ledger.js';
import { damageAdjustment, saveScoreDelta, targetTraitSlugs } from '../scoring/facts.js';
import { nativeRollContextPreflight } from '../scoring/roll-preflight.js';
import { buildTurnPlans } from '../planner.js';
import { scoreCandidate } from '../scoring.js';

const previousGame = globalThis.game;
const previousCanvas = globalThis.canvas;
try {
  const actor = (id, type) => ({
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    isOwner: true,
    items: [],
    itemTypes: { condition: [] },
    system: {
      attributes: {
        hp: { value: 10, max: 10 },
        ac: { value: 41 },
        weaknesses: [{ type: 'cold', value: 90 }],
        resistances: [{ type: 'fire', value: 80 }],
        immunities: [{ type: 'mental' }],
      },
      saves: { fortitude: { dc: 39 }, reflex: { dc: 38 }, will: { dc: 37 } },
      perception: { dc: 36, mod: 26 },
      traits: { value: ['undead', 'fiend'] },
      skills: {},
      abilities: {},
    },
  });
  const pc = actor('pc', 'character');
  const npc = actor('npc', 'npc');
  const token = (actor, disposition, x) => ({
    id: `token-${actor.id}`,
    name: actor.name,
    actor,
    x,
    y: 0,
    document: {
      id: `token-${actor.id}`,
      uuid: `Scene.test.Token.${actor.id}`,
      actor,
      baseActor: actor,
      disposition,
      x,
      y: 0,
      width: 1,
      height: 1,
      texture: {},
    },
  });
  const pcToken = token(pc, 1, 0);
  const npcToken = token(npc, -1, 5);
  const combatant = (token) => ({
    id: `combatant-${token.id}`,
    actor: token.actor,
    tokenId: token.id,
    token: { id: token.id, object: token },
  });
  const selected = combatant(pcToken);
  const module = { active: true, api: { version: 1, getKnowledge: () => null } };
  globalThis.game = {
    user: { isGM: false, targets: new Set([npcToken]) },
    combat: {
      id: 'bestiary-test',
      started: true,
      round: 1,
      turn: 0,
      combatant: selected,
      combatants: [selected, combatant(npcToken)],
    },
    modules: new Map([['pf2e-bestiary-tracking', module]]),
  };
  globalThis.canvas = {
    grid: { size: 1, measurePath: ([a, b]) => Math.abs(a.x - b.x) },
    tokens: { placeables: [pcToken, npcToken] },
  };
  const readTarget = () => readCombatContext('bestiary-test').battlefield.targets[0];
  const hidden = readTarget();
  assert.equal(hidden.ac, null);
  assert.deepEqual(hidden.saves, {});
  assert.deepEqual(hidden.traits, []);
  assert.equal(hidden.weaknesses, null);
  const knowledge = {
    version: 1,
    scope: 'party',
    name: { display: 'Reported creature' },
    ac: { value: 18 },
    saves: { fortitude: { value: -1 }, reflex: { display: 'High' } },
    perception: { value: 4 },
    traits: ['animal'],
    weaknesses: [{ type: 'fire', value: 7, exceptions: [] }],
    resistances: [{ type: 'cold', exceptions: [] }],
    immunities: [{ empty: true }],
    actions: [{ name: 'Reactive Strike' }],
  };
  let queried;
  module.api.getKnowledge = (token) => {
    queried = token;
    return token.actor.type === 'npc' ? knowledge : null;
  };
  const known = readTarget();
  assert.equal(queried, npcToken);
  assert.equal(known.actor.document, undefined);
  assert.equal(known.ac, 18);
  assert.deepEqual(known.saves, { fortitude: 9 });
  assert.equal(known.perceptionDC, 14);
  assert.deepEqual([...targetTraitSlugs({ isGM: false }, known)], ['animal']);
  assert.equal(known.identityName, 'Reported creature');
  assert.equal(known.reactiveStrikeKnown, true);
  assert.equal(known.resistances[0].value, undefined);
  assert.deepEqual(known.intelLedger.immunities, ['__none']);
  assert.deepEqual(npc.flags, undefined);
  const blast = (type) => ({
    id: `${type}-blast`,
    name: `${type} blast`,
    slug: `${type}-blast`,
    source: 'system-inferred',
    role: 'damage',
    actionCost: 3,
    confidence: 'high',
    activityProfile: { damageTypes: [type], averageDamage: 7 },
    targetingProfile: { enemy: true, maxRange: 60 },
  });
  const fire = blast('fire');
  const cold = blast('cold');
  assert.equal(damageAdjustment({ isGM: false }, fire, hidden), null);
  assert.equal(damageAdjustment({ isGM: false }, fire, known).weakness, 7);
  assert.equal(damageAdjustment({ isGM: false }, cold, known), null);
  assert.ok(
    saveScoreDelta({ isGM: false }, { saveProfile: { stat: 'fortitude', dc: 20 } }, known, {}),
  );
  assert.equal(
    saveScoreDelta({ isGM: false }, { saveProfile: { stat: 'reflex', dc: 20 } }, known, {}),
    null,
  );
  const context = readCombatContext('bestiary-test');
  const scored = [cold, fire].map((action) => scoreCandidate(context, action));
  const plans = buildTurnPlans(context, scored);
  assert.equal(
    plans[0].steps[0].id,
    fire.id,
    'Autofill should favor revealed fire weakness over hidden cold weakness',
  );
  const strike = {
    id: 'strike',
    name: 'Strike',
    slug: 'strike',
    source: 'strike',
    role: 'damage',
    attackModifier: 10,
    actionCost: 1,
    targetingProfile: { enemy: true },
  };
  assert.equal(nativeRollContextPreflight(context, strike, { target: known }).dc, 18);
  assert.equal(nativeRollContextPreflight(context, strike, { target: hidden }).dc, null);

  npc.flags = { 'pf2e-combater': { intelLedger: { saves: ['will'], weaknesses: true } } };
  const combined = readTarget();
  assert.deepEqual(combined.saves, { fortitude: 9, will: 37 });
  assert.deepEqual(combined.intelLedger.saves, ['will', 'fortitude']);
  assert.equal(combined.weaknesses.find((entry) => entry.type === 'cold').value, 90);
  assert.ok(combined.weaknesses.some((entry) => entry.type === 'fire'));
  assert.deepEqual(npc.flags['pf2e-combater'].intelLedger, { saves: ['will'], weaknesses: true });
  npc.flags['pf2e-combater'].intelLedger.saves = ['fortitude'];
  assert.equal(
    readTarget().saves.fortitude,
    39,
    'Independent Combater Intel takes precedence for same fact',
  );
  delete npc.flags;

  knowledge.ac = { display: 'Custom armor' };
  knowledge.perception = { display: 'Very alert' };
  knowledge.saves = {};
  knowledge.traits = [];
  knowledge.weaknesses = [];
  const rehidden = readTarget();
  assert.equal(rehidden.ac, null);
  assert.equal(rehidden.perceptionDC, null);
  assert.deepEqual(rehidden.saves, {});
  assert.deepEqual(rehidden.traits, []);
  assert.equal(rehidden.weaknesses, null);
  module.active = false;
  assert.deepEqual(readTarget(), hidden);
  module.active = true;
  module.api.getKnowledge = () => {
    throw new Error('Unavailable bestiary');
  };
  assert.deepEqual(readTarget(), hidden);
  module.api.version = 2;
  assert.equal(readBestiaryKnowledge(npcToken), null);
  module.api = {};
  assert.equal(readBestiaryKnowledge(npcToken), null);
  globalThis.game.modules.clear();
  assert.equal(readBestiaryKnowledge(npcToken), null);
  globalThis.game.user.isGM = true;
  const gmTarget = readTarget();
  assert.equal(gmTarget.ac, 41);
  assert.equal(gmTarget.saves.fortitude, 39);
  assert.ok(gmTarget.actor.document);
  assert.equal(withBestiaryKnowledge(hidden, null), hidden);
  const pcTarget = { ...hidden, actor: { type: 'character' } };
  assert.equal(withBestiaryKnowledge(pcTarget, knowledge), pcTarget);
  assert.deepEqual(hidden.intelLedger, normalizeIntelLedger({}));
} finally {
  globalThis.game = previousGame;
  globalThis.canvas = previousCanvas;
}

console.log('Bestiary integration regressions passed');
