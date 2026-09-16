import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { accountDefaults, loadLocalDefaults } from './local-defaults.mjs';

test('loads validated local defaults and protects saved password across account changes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'combater-live-'));
  const file = path.join(directory, 'live.json');
  try {
    await writeFile(file, JSON.stringify({ gm: { username: 'GM', password: 'secret' } }));
    const local = await loadLocalDefaults(file);
    assert.equal(accountDefaults('gm', local, {}).password, 'secret');
    assert.equal(accountDefaults('gm', local, { COMBATER_GM_USER: 'Other' }).password, undefined);
    await writeFile(file, '[]');
    await assert.rejects(loadLocalDefaults(file), /Invalid local live-test defaults/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
