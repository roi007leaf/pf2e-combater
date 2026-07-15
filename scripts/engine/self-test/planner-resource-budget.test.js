import assert from 'node:assert/strict';
import { fighterContext } from '../fixtures.js';
import { buildTurnPlans } from '../planner.js';
import { readSpellActions } from '../../readers/spell-reader.js';

function candidate(id, score, resourceFields = {}) {
  return {
    id,
    name: id,
    slug: id,
    source: 'system-inferred',
    role: 'buff',
    actionCost: 1,
    score,
    confidence: 'high',
    ...resourceFields,
  };
}

const fillers = [
  candidate('filler-one', 30),
  candidate('filler-two', 29),
  candidate('filler-three', 28),
];

function plansUseAtMost(plans, ids, maximum, message) {
  const wanted = new Set(ids);
  assert.equal(
    plans.every((plan) => plan.steps.filter((step) => wanted.has(step.id)).length <= maximum),
    true,
    message,
  );
}

const spontaneous = (id, score, { remaining = 1, rank = 3, entry = 'arcane-entry' } = {}) =>
  candidate(id, score, {
    source: 'spell-curated',
    rank,
    castRank: rank,
    spellcastingEntryId: entry,
    spellResource: { type: 'spontaneous', rank, remaining, max: 3 },
  });

const oneSlotSpells = [
  spontaneous('fireball', 100),
  spontaneous('haste', 99),
  spontaneous('slow', 98),
];
const oneSlotPlans = buildTurnPlans(fighterContext, [...oneSlotSpells, ...fillers]);
plansUseAtMost(
  oneSlotPlans,
  oneSlotSpells.map((spell) => spell.id),
  1,
  'different spontaneous spells must share their entry-and-rank slot pool',
);
assert.equal(
  oneSlotPlans[0].totalCost,
  3,
  'resource rejection should still let planner fill the turn',
);
const reservedSlotPlans = buildTurnPlans(fighterContext, [...oneSlotSpells, ...fillers], {
  reservedSteps: [{ action: spontaneous('manual-slot-spell', 110) }],
});
plansUseAtMost(
  reservedSlotPlans,
  oneSlotSpells.map((spell) => spell.id),
  0,
  'manual draft steps must reserve their resource before gap-fill search',
);
const afterExecutedSlotPlans = buildTurnPlans(fighterContext, [...oneSlotSpells, ...fillers], {
  reservedSteps: [
    {
      action: spontaneous('executed-slot-spell', 110),
      execution: { status: 'done' },
    },
  ],
});
assert.ok(
  afterExecutedSlotPlans.some((plan) =>
    plan.steps.some((step) => oneSlotSpells.some((spell) => spell.id === step.id)),
  ),
  'executed draft steps are already reflected in live remaining counts and must not reserve twice',
);

const twoSlotSpells = [
  spontaneous('lightning-bolt', 100, { remaining: 2 }),
  spontaneous('wall-of-wind', 99, { remaining: 2 }),
  spontaneous('fear-three', 98, { remaining: 2 }),
];
const twoSlotPlans = buildTurnPlans(fighterContext, [...twoSlotSpells, ...fillers]);
plansUseAtMost(
  twoSlotPlans,
  twoSlotSpells.map((spell) => spell.id),
  2,
  'two remaining slots must cap pool spend at two',
);
assert.ok(
  twoSlotPlans.some(
    (plan) =>
      plan.steps.filter((step) => twoSlotSpells.some((spell) => spell.id === step.id)).length === 2,
  ),
  'planner should use both remaining slots when their actions are best',
);

const separateSlotPools = [
  spontaneous('rank-three', 100, { rank: 3 }),
  spontaneous('rank-four', 99, { rank: 4 }),
  spontaneous('other-entry', 98, { rank: 3, entry: 'occult-entry' }),
];
const separateSlotPlans = buildTurnPlans(fighterContext, [...separateSlotPools, ...fillers]);
assert.ok(
  separateSlotPlans.some((plan) =>
    separateSlotPools.every((spell) => plan.steps.some((step) => step.id === spell.id)),
  ),
  'different ranks and spellcasting entries must remain independent pools',
);

function flexibleSpell(id, name) {
  return {
    id,
    name,
    slug: id,
    system: {
      slug: id,
      level: { value: 3 },
      location: { value: 'flexible-entry' },
      time: { value: '2' },
      traits: { value: ['concentrate', 'manipulate'] },
      range: { value: '30 feet' },
    },
  };
}

function flexibleSpellContext(remaining) {
  const target = { id: 'flex-target', name: 'Target', distance: 20 };
  return {
    actor: {
      document: {
        itemTypes: {
          spell: [flexibleSpell('haste', 'Haste'), flexibleSpell('slow', 'Slow')],
          spellcastingEntry: [
            {
              id: 'flexible-entry',
              isFlexible: true,
              system: {
                prepared: { value: 'prepared', flexible: true },
                slots: { slot3: { value: remaining, max: 2, prepared: [] } },
              },
            },
          ],
        },
      },
    },
    targets: [target],
    enemies: [target],
    battlefield: { targets: [target], enemies: [target], allies: [] },
  };
}

const flexibleActions = readSpellActions(flexibleSpellContext(1));
assert.equal(flexibleActions.length >= 2, true);
assert.equal(
  flexibleActions.every((action) => action.available),
  true,
);
assert.equal(
  flexibleActions.every((action) => action.spellResource?.type === 'flexible'),
  true,
);
assert.equal(
  flexibleActions.every((action) => action.spellResource?.remaining === 1),
  true,
);
const flexibleCandidates = flexibleActions.slice(0, 2).map((action, index) => ({
  ...action,
  id: `flexible-${index}`,
  actionCost: 1,
  score: 100 - index,
  confidence: 'high',
}));
const flexiblePlans = buildTurnPlans(fighterContext, [...flexibleCandidates, ...fillers]);
plansUseAtMost(
  flexiblePlans,
  flexibleCandidates.map((action) => action.id),
  1,
  'flexible prepared spells must share their native entry-and-rank slot pool',
);
assert.equal(
  readSpellActions(flexibleSpellContext(0)).every((action) => action.available === false),
  true,
  'flexible prepared spells must become unavailable when their shared slot rank is empty',
);

const focusSpells = [
  candidate('focus-blast', 100, {
    source: 'spell-curated',
    isFocusSpell: true,
    spellResource: { type: 'focus', remaining: 1, max: 3 },
  }),
  candidate('focus-ward', 99, {
    source: 'spell-curated',
    isFocusSpell: true,
    spellResource: { type: 'focus', remaining: 1, max: 3 },
  }),
];
const focusPlans = buildTurnPlans(fighterContext, [...focusSpells, ...fillers]);
plansUseAtMost(
  focusPlans,
  focusSpells.map((spell) => spell.id),
  1,
  'all focus spells must share the focus pool',
);

const sharedConsumable = {
  id: 'shared-elixir',
  type: 'consumable',
  system: { quantity: 1, uses: { value: 1, max: 1 } },
};
const consumableActions = [
  candidate('drink-elixir', 100, { item: sharedConsumable }),
  candidate('activate-elixir', 99, { item: sharedConsumable }),
];
const consumablePlans = buildTurnPlans(fighterContext, [...consumableActions, ...fillers]);
plansUseAtMost(
  consumablePlans,
  consumableActions.map((action) => action.id),
  1,
  'derived actions from one consumable must share quantity and uses',
);
const emptyConsumableAction = candidate('empty-consumable', 120, {
  item: {
    id: 'empty-consumable-item',
    type: 'consumable',
    system: { quantity: 0, uses: { value: 1, max: 1 } },
  },
});
assert.equal(
  buildTurnPlans(fighterContext, [emptyConsumableAction, ...fillers]).some((plan) =>
    plan.steps.some((step) => step.id === emptyConsumableAction.id),
  ),
  false,
  'zero quantity must remain zero even when stale item uses still show one',
);
const stackedConsumable = {
  id: 'stacked-elixir',
  type: 'consumable',
  system: { quantity: 2, uses: { value: 1, max: 1 } },
};
const stackedConsumableActions = [
  candidate('stacked-use-one', 100, { item: stackedConsumable }),
  candidate('stacked-use-two', 99, { item: stackedConsumable }),
];
const stackedConsumablePlans = buildTurnPlans(fighterContext, [
  ...stackedConsumableActions,
  ...fillers,
]);
assert.ok(
  stackedConsumablePlans.some((plan) =>
    stackedConsumableActions.every((action) => plan.steps.some((step) => step.id === action.id)),
  ),
  'two items in a consumable stack should allow two simulated uses',
);

const sharedScroll = {
  id: 'shared-scroll',
  type: 'consumable',
  system: { quantity: 1, uses: { value: 1, max: 1 } },
};
const scrollSpellActions = [
  candidate('scroll-spell-one', 100, {
    source: 'spell-curated',
    rank: 4,
    consumableItem: sharedScroll,
    spellResource: { type: 'item', remaining: 1, max: 1 },
  }),
  candidate('scroll-spell-two', 99, {
    source: 'spell-curated',
    rank: 4,
    consumableItem: sharedScroll,
    spellResource: { type: 'item', remaining: 1, max: 1 },
  }),
];
const scrollSpellPlans = buildTurnPlans(fighterContext, [...scrollSpellActions, ...fillers]);
plansUseAtMost(
  scrollSpellPlans,
  scrollSpellActions.map((action) => action.id),
  1,
  'stored-spell items must spend item uses, not an unrelated ranked slot pool',
);

const sharedFrequencyItem = {
  id: 'shared-frequency',
  type: 'feat',
  system: { frequency: { value: 1, max: 1, per: 'day' } },
};
const frequencyActions = [
  candidate('frequency-mode-one', 100, { item: sharedFrequencyItem }),
  candidate('frequency-mode-two', 99, { item: sharedFrequencyItem }),
];
const frequencyPlans = buildTurnPlans(fighterContext, [...frequencyActions, ...fillers]);
plansUseAtMost(
  frequencyPlans,
  frequencyActions.map((action) => action.id),
  1,
  'derived actions from one frequency-limited item must share remaining uses',
);

const preparedSpells = [
  candidate('prepared-fear', 100, {
    source: 'spell-curated',
    item: { id: 'prepared-fear-item', type: 'spell' },
    spellcastingEntryId: 'prepared-entry',
    spellResource: { type: 'prepared', rank: 3, preparedAvailable: 1, preparedTotal: 1 },
  }),
  candidate('prepared-haste', 99, {
    source: 'spell-curated',
    item: { id: 'prepared-haste-item', type: 'spell' },
    spellcastingEntryId: 'prepared-entry',
    spellResource: { type: 'prepared', rank: 3, preparedAvailable: 1, preparedTotal: 1 },
  }),
];
const preparedPlans = buildTurnPlans(fighterContext, [...preparedSpells, ...fillers]);
assert.ok(
  preparedPlans.some((plan) =>
    preparedSpells.every((spell) => plan.steps.some((step) => step.id === spell.id)),
  ),
  'different prepared spells at one rank own separate prepared copies',
);

console.log('PF2e Combater planner resource budget test passed');
