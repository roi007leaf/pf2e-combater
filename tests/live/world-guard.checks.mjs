import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaWorld, DEFAULT_QA_WORLD } from './world-guard.mjs';

test('accepts only configured disposable world', () => {
  assert.doesNotThrow(() => assertQaWorld(DEFAULT_QA_WORLD));
  assert.throws(() => assertQaWorld('campaign'), /Wrong Foundry world/);
  assert.throws(() => assertQaWorld('visioner-qa', ''), /must not be blank/);
});
