import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fullCases, smokeCases, validateCases } from './cases.mjs';
import { assessCoverage, requiredAreas } from './coverage.mjs';
import { assessMatrix } from './evidence.mjs';
import { finishCleanup, readJournal, validateCredentials, writeJournal } from './lifecycle.mjs';

test('catalog is unique and covers every declared feature family', () => {
  assert.doesNotThrow(() => validateCases(fullCases));
  assert.ok(smokeCases.length >= 8);
  const coverage = assessCoverage(
    fullCases,
    fullCases.map(({ name }) => ({ name, status: 'passed' })),
  );
  assert.equal(coverage.complete, true);
  assert.deepEqual(
    coverage.details.map((entry) => entry.area),
    requiredAreas,
  );
});

test('credentials require separate GM and player accounts', () => {
  assert.doesNotThrow(() =>
    validateCredentials({ username: 'GM', password: 'x' }, { username: 'Player', password: 'y' }),
  );
  assert.throws(
    () => validateCredentials({ username: 'GM', password: 'x' }, { username: 'gm', password: 'y' }),
    /separate/,
  );
  assert.doesNotThrow(() =>
    validateCredentials(
      { username: 'GM', password: 'x' },
      { username: 'Player', password: '', allowBlankPassword: true },
    ),
  );
});

test('shipping matrix accepts only matching, clean, complete evidence', () => {
  const clean = {
    sourceFingerprint: 'source',
    cleanup: 'complete',
    startupErrors: [],
    environment: { core: '14.364' },
    cases: fullCases.map(({ name }) => ({ name, status: 'passed' })),
  };
  assert.equal(assessMatrix(fullCases, [clean], 'source').complete, true);
  assert.equal(
    assessMatrix(fullCases, [{ ...clean, sourceFingerprint: 'stale' }], 'source').complete,
    false,
  );
});

test('recovery journal survives failed cleanup and deletes only after full success', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'combater-journal-'));
  const file = path.join(directory, 'recovery.json');
  try {
    await writeJournal(file, { runId: 'test' });
    await assert.rejects(
      finishCleanup({
        cleanup: async () => {
          throw Error('no');
        },
        restore: async () => {},
        verify: async () => {},
        journal: file,
      }),
      AggregateError,
    );
    assert.deepEqual(await readJournal(file), { runId: 'test' });
    await finishCleanup({
      cleanup: async () => {},
      restore: async () => {},
      verify: async () => {},
      journal: file,
    });
    assert.equal(await readJournal(file), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
