import assert from 'node:assert/strict';
import {
  nextResourceHorizon,
  normalizeResourceHorizon,
  resourceHorizonAdjustment,
  resourceHorizonView,
  withResourceHorizon,
} from '../../rules/resource-horizon.js';
import { activatePanelRenderBindings } from '../../ui/panel/event-bindings.js';

function context(mode, { enemies = 2, round = 1, hpPercent = 1, allyHpPercent = 1 } = {}) {
  return {
    resourceHorizon: mode,
    combat: { round },
    actor: { profile: { hp: { percent: hpPercent } } },
    battlefield: {
      enemies: Array.from({ length: enemies }, (_value, index) => ({ id: `enemy-${index}` })),
      allies: [{ id: 'ally', hpPercent: allyHpPercent }],
    },
  };
}

const slot = {
  source: 'spell-curated',
  rank: 4,
  castRank: 4,
  spellResource: { type: 'spontaneous', rank: 4, remaining: 3, max: 3 },
};
const lastSlot = {
  ...slot,
  spellResource: { ...slot.spellResource, remaining: 1 },
};
const cantrip = {
  source: 'spell-curated',
  isCantrip: true,
  spellResource: { type: 'cantrip' },
};
const consumable = {
  type: 'consumable',
  item: { type: 'consumable', system: { quantity: 1, uses: { value: 1, max: 1 } } },
};

assert.equal(normalizeResourceHorizon('BURST'), 'burst');
assert.equal(normalizeResourceHorizon('unknown'), 'normal');
assert.equal(nextResourceHorizon('normal'), 'burst');
assert.equal(nextResourceHorizon('normal', -1), 'conserve');

const baseContext = { combat: { round: 1 } };
const burstContext = withResourceHorizon(baseContext, 'burst');
assert.notEqual(
  burstContext,
  baseContext,
  'injecting planner policy must not mutate the native combat context',
);
assert.equal(baseContext.resourceHorizon, undefined);
assert.equal(burstContext.resourceHorizon, 'burst');

assert.deepEqual(resourceHorizonAdjustment(context('normal'), slot), {
  scoreDelta: 0,
  reasons: [],
});
assert.ok(resourceHorizonAdjustment(context('conserve'), cantrip).scoreDelta > 0);
assert.ok(resourceHorizonAdjustment(context('burst'), cantrip).scoreDelta < 0);

const conservedSlot = resourceHorizonAdjustment(context('conserve'), slot);
const conservedLastSlot = resourceHorizonAdjustment(context('conserve'), lastSlot);
assert.ok(conservedSlot.scoreDelta < 0);
assert.ok(
  conservedLastSlot.scoreDelta < conservedSlot.scoreDelta,
  'the last slot should be protected more strongly',
);
assert.match(conservedLastSlot.reasons[0], /ranked spell slot/i);
const unknownFocusPool = resourceHorizonAdjustment(context('conserve'), {
  isFocusSpell: true,
  spellResource: { type: 'focus', remaining: null, max: null },
});
const lastFocusPoint = resourceHorizonAdjustment(context('conserve'), {
  isFocusSpell: true,
  spellResource: { type: 'focus', remaining: 1, max: 1 },
});
assert.ok(
  unknownFocusPool.scoreDelta > lastFocusPoint.scoreDelta,
  'missing pool counts must not be interpreted as zero remaining',
);

const lowPressureBurst = resourceHorizonAdjustment(context('burst', { enemies: 1 }), slot);
const highPressureBurst = resourceHorizonAdjustment(
  context('burst', {
    enemies: 4,
    round: 4,
    hpPercent: 0.25,
    allyHpPercent: 0.2,
  }),
  slot,
);
assert.ok(lowPressureBurst.scoreDelta > 0);
assert.ok(
  highPressureBurst.scoreDelta > lowPressureBurst.scoreDelta,
  'Burst should spend more freely as encounter pressure rises',
);

assert.ok(resourceHorizonAdjustment(context('conserve'), consumable).scoreDelta < 0);
assert.ok(resourceHorizonAdjustment(context('burst'), consumable).scoreDelta > 0);
const scrollSpell = {
  source: 'spell-curated',
  rank: 4,
  consumableItem: { id: 'scroll', type: 'consumable', system: { quantity: 1 } },
  spellResource: { type: 'item', remaining: 1, max: 1 },
};
assert.match(
  resourceHorizonAdjustment(context('conserve'), scrollSpell).reasons[0],
  /consumable/i,
  'stored-spell items must be valued as consumables rather than ranked slots',
);

const daily = {
  item: { type: 'feat', system: { frequency: { value: 1, max: 1, per: 'day' } } },
};
const encounter = {
  item: { type: 'feat', system: { frequency: { value: 1, max: 1, per: 'PT10M' } } },
};
const perRound = {
  item: { type: 'feat', system: { frequency: { value: 1, max: 1, per: 'round' } } },
};
assert.ok(resourceHorizonAdjustment(context('conserve'), daily).scoreDelta < 0);
assert.ok(
  resourceHorizonAdjustment(context('conserve'), encounter).scoreDelta >
    resourceHorizonAdjustment(context('conserve'), daily).scoreDelta,
  'an encounter-recovering ability should be protected less than a daily use',
);
assert.equal(resourceHorizonAdjustment(context('burst'), perRound).scoreDelta, 0);

const ordinaryWeapon = { item: { type: 'weapon', system: { quantity: 1 } } };
assert.equal(
  resourceHorizonAdjustment(context('conserve'), ordinaryWeapon).scoreDelta,
  0,
  'ordinary physical-item quantity must not be mistaken for a consumable resource',
);

assert.equal(resourceHorizonView('conserve').isConserve, true);
assert.equal(resourceHorizonView('burst').isBurst, true);
assert.equal(resourceHorizonView('normal').label, 'Normal');

const horizonListeners = {};
const horizonButton = {
  addEventListener(type, listener) {
    horizonListeners[type] = listener;
  },
};
const cycleDirections = [];
activatePanelRenderBindings(
  {
    _activateDrag() {},
    _activateActionListScrollPerformance() {},
    _cycleResourceHorizon(direction) {
      cycleDirections.push(direction);
    },
  },
  {
    querySelector(selector) {
      return selector === '[data-cycle-resource-horizon]' ? horizonButton : null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    contains() {
      return false;
    },
  },
);
horizonListeners.click();
let preventedContextMenu = false;
horizonListeners.contextmenu({
  preventDefault: () => {
    preventedContextMenu = true;
  },
});
assert.deepEqual(cycleDirections, [undefined, -1]);
assert.equal(
  preventedContextMenu,
  true,
  'right-click should reverse-cycle without opening the browser menu',
);

console.log('PF2e Combater resource horizon test passed');
