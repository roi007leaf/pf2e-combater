import { confirm, input, password } from '@inquirer/prompts';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fullCases, smokeCases, validateCases } from './cases.mjs';
import { assessCoverage } from './coverage.mjs';
import { sourceFingerprint } from './evidence.mjs';
import { loadLocalDefaults, promptAccount } from './local-defaults.mjs';
import { finishCleanup, readJournal, validateCredentials, writeJournal } from './lifecycle.mjs';
import { assertQaWorld, DEFAULT_QA_WORLD } from './world-guard.mjs';

const directory = path.resolve('artifacts/live');
const journalPath = path.join(directory, 'recovery.json');
const lockPath = path.join(directory, 'runner.lock');
const abort = new AbortController();
const expectedWorld = process.env.COMBATER_DISPOSABLE_WORLD ?? DEFAULT_QA_WORLD;
const report = {
  started: new Date().toISOString(),
  cases: [],
  startupErrors: [],
  cleanup: 'not-needed',
};
const credentials = [];
let browser;
let gm;
let player;
let journal;
let locked = false;
let collectingStartup = true;
let evidenceDirectory = directory;

process.once('SIGINT', () => abort.abort());
process.once('SIGTERM', () => abort.abort());

function checkAbort() {
  if (abort.signal.aborted) throw Error('Live suite cancelled');
}

function safeError(error) {
  let text = String(error?.stack ?? error?.message ?? error);
  for (const secret of credentials.filter(Boolean)) text = text.split(secret).join('[redacted]');
  return text;
}

async function rpc(page, method, data) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(
        async ({ method, data }) => {
          const api = await import('/modules/pf2e-combater/tests/live/world.js');
          return api[method](data);
        },
        { method, data },
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          void browser?.close().catch(() => {});
          reject(Error(`Foundry operation timed out: ${method}; run cleanup recovery`));
        }, 120000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function account(role, localDefaults) {
  const result = await promptAccount(
    role,
    localDefaults,
    process.env,
    { input, password, confirm },
    { signal: abort.signal },
  );
  credentials.push(result.password);
  if (role === 'gm' && !result.password) throw Error('GM account requires a password');
  return result;
}

async function login(context, url, credentialsForRole, isGM) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => {
    if (collectingStartup) report.startupErrors.push(safeError(error));
  });
  page.on('console', (message) => {
    if (collectingStartup && message.type() === 'error')
      report.startupErrors.push(safeError(message.text()));
  });
  await page.goto(`${url}/join`);
  const select = page.locator("select[name='userid']");
  await page.locator("select[name='userid'], input[name='username']").first().waitFor();
  assertQaWorld(await page.evaluate(() => globalThis.game?.world?.id), expectedWorld);
  if (await select.count()) {
    const options = await select.locator('option').evaluateAll((entries) =>
      entries.map((entry) => ({
        label: entry.textContent.trim(),
        value: entry.value,
      })),
    );
    const match = options.find(
      (entry) => entry.label.toLowerCase() === credentialsForRole.username.trim().toLowerCase(),
    );
    if (!match) throw Error(`Account not found for ${isGM ? 'GM' : 'player'} session`);
    await select.selectOption(match.value);
  } else {
    await page.locator("input[name='username']").fill(credentialsForRole.username);
  }
  await page.locator("input[name='password']").fill(credentialsForRole.password);
  await page.locator("button[name='join']").click();
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, null, {
    timeout: 90000,
  });
  const state = await rpc(page, 'preflight');
  assertQaWorld(state.world, expectedWorld);
  if (state.isGM !== isGM) throw Error(`Wrong account role: expected ${isGM ? 'GM' : 'player'}`);
  return { page, state };
}

async function viewBoth(fixture) {
  await Promise.all([
    rpc(gm.page, 'view', { fixture, role: 'gm' }),
    rpc(player.page, 'view', { fixture, role: 'player' }),
  ]);
}

async function restoreSessions(record) {
  const failures = [];
  for (const [session, saved] of [
    [gm, record.gm],
    [player, record.player],
  ]) {
    try {
      await rpc(session.page, 'restore', saved);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Could not restore every test session');
}

async function syncPause(record, paused) {
  await rpc(gm.page, 'setPause', { world: record.world, paused });
  await Promise.all(
    [gm, player].map((session) =>
      session.page.waitForFunction(
        ({ world, paused }) => game.world.id === world && game.paused === paused,
        { world: record.world, paused },
      ),
    ),
  );
}

async function recover(record) {
  if (
    record.world !== gm.state.world ||
    record.gm.user !== gm.state.user ||
    record.player.user !== player.state.user
  ) {
    throw Error('Recovery requires original world, GM, and player accounts');
  }
  report.cleanup = 'running';
  await finishCleanup({
    journal: journalPath,
    cleanup: () => rpc(gm.page, 'cleanup', record.runId),
    restore: async () => {
      await restoreSessions(record);
      if (typeof record.pauseState === 'boolean') await syncPause(record, record.pauseState);
    },
    verify: async () => {
      const remaining = await rpc(gm.page, 'leftovers', record.runId);
      if (Object.values(remaining).some((ids) => ids.length))
        throw Error('Test documents remain after cleanup');
    },
  });
  report.cleanup = 'complete';
}

async function saveReport() {
  report.functionalCoverage = assessCoverage(fullCases, report.cases);
  report.shippingReady =
    report.functionalCoverage.complete &&
    !report.error &&
    !report.startupErrors.length &&
    !report.environmentWarning &&
    !report.sourceChangedDuringRun &&
    report.cleanup === 'complete';
  if (locked) await writeJournal(path.join(directory, 'report.json'), report);
  if (locked && evidenceDirectory !== directory)
    await writeJournal(path.join(evidenceDirectory, 'report.json'), report);
}

async function acquireLock() {
  await mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0)
      throw Error('Invalid runner lock; inspect before removing it');
    try {
      process.kill(pid, 0);
      throw Error(`Live suite already running (PID ${pid})`);
    } catch (probe) {
      if (probe.code !== 'ESRCH') throw probe;
    }
    await unlink(lockPath);
    handle = await open(lockPath, 'wx');
  }
  await handle.writeFile(String(process.pid));
  await handle.close();
  locked = true;
}

async function runSpecial(testCase, fixture) {
  if (['intel-ledger-player-view', 'combat-tracker-intel'].includes(testCase.name)) {
    await rpc(gm.page, 'seedIntel', fixture);
  }
  if (testCase.name === 'player-access-live-cleanup') {
    await rpc(gm.page, 'setWorldSetting', { key: 'disableForPlayers', value: true });
    const actual = await rpc(player.page, 'inspectAccess');
    if (actual.panel || actual.tool)
      throw Error(`Player access remained visible: ${JSON.stringify(actual)}`);
    await rpc(gm.page, 'setWorldSetting', { key: 'disableForPlayers', value: false });
    return actual;
  }
  if (testCase.name === 'hide-autofill-from-player') {
    await rpc(gm.page, 'setWorldSetting', { key: 'hideAutoFillFromPlayers', value: true });
    const actual = await rpc(player.page, 'inspectAccess', { hiddenAutoFill: true });
    if (!actual.panel || actual.autoFill)
      throw Error(`Player Auto-fill visibility wrong: ${JSON.stringify(actual)}`);
    await rpc(gm.page, 'setWorldSetting', { key: 'hideAutoFillFromPlayers', value: false });
    return actual;
  }
  const page = testCase.session === 'player' ? player.page : gm.page;
  const result = await rpc(page, 'runFeature', { name: testCase.name, fixture });
  if (testCase.name === 'player-share-draft-socket') {
    const deadline = Date.now() + 5000;
    let shared;
    while (Date.now() < deadline) {
      shared = await rpc(gm.page, 'inspectSharedDraft', fixture);
      if (shared.value) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!shared?.value)
      throw Error('Player draft did not reach GM-owned actor flag through socketlib');
    result.gmSharedDraft = shared.value;
  }
  return result;
}

async function run() {
  validateCases(fullCases);
  if (process.argv.includes('--list')) {
    console.table(
      fullCases.map((testCase) => ({
        case: testCase.name,
        area: testCase.area,
        session: testCase.session,
        smoke: testCase.smoke,
      })),
    );
    return;
  }
  if (
    process.argv.includes('--release') &&
    (!process.argv.includes('--full') || process.env.COMBATER_LIVE_CASE)
  ) {
    throw Error('Shipping validation requires --full without case filter');
  }
  const allCases = process.argv.includes('--full') ? fullCases : smokeCases;
  const requested = process.env.COMBATER_LIVE_CASE?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown =
    requested?.filter((name) => !allCases.some((testCase) => testCase.name === name)) ?? [];
  if (unknown.length && !process.argv.includes('--cleanup-only'))
    throw Error(`Unknown live cases (or --full missing): ${unknown.join(', ')}`);
  const cases = requested
    ? allCases.filter((testCase) => requested.includes(testCase.name))
    : allCases;
  if (!cases.length && !process.argv.includes('--cleanup-only'))
    throw Error('No live cases matched COMBATER_LIVE_CASE');

  await acquireLock();
  const localDefaults = await loadLocalDefaults();
  const url = (
    process.env.COMBATER_FOUNDRY_URL ||
    (await input(
      {
        message: 'Foundry URL:',
        default: localDefaults.url || 'https://localhost:30000',
      },
      { signal: abort.signal },
    ))
  ).replace(/\/$/, '');
  const gmAccount = await account('gm', localDefaults);
  const playerAccount = await account('player', localDefaults);
  validateCredentials(gmAccount, playerAccount);
  browser = await chromium.launch({
    headless: process.argv.includes('--headless'),
    channel: process.env.COMBATER_BROWSER_CHANNEL || undefined,
  });
  const browserOptions = {
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: new URL(url).hostname === 'localhost',
  };
  gm = await login(await browser.newContext(browserOptions), url, gmAccount, true);
  console.log('GM session ready');
  player = await login(await browser.newContext(browserOptions), url, playerAccount, false);
  console.log('Player session ready');
  if (gm.state.world !== player.state.world) throw Error('Accounts joined different worlds');

  journal = { url, world: gm.state.world, runId: randomUUID(), gm: gm.state, player: player.state };
  const pending = await readJournal(journalPath);
  if (pending) {
    await recover(pending);
    journal = {
      ...journal,
      gm: await rpc(gm.page, 'preflight'),
      player: await rpc(player.page, 'preflight'),
    };
  }
  if (process.argv.includes('--cleanup-only')) return;
  collectingStartup = false;
  const checkoutVersion = JSON.parse(await readFile('module.json', 'utf8')).version;
  report.environment = {
    core: gm.state.core,
    system: gm.state.system,
    module: gm.state.module,
    checkoutVersion,
    modules: gm.state.modules,
  };
  report.sourceFingerprint = await sourceFingerprint();
  if (checkoutVersion !== gm.state.module) {
    report.environmentWarning =
      'Foundry module metadata differs from checkout. Restart Foundry before shipping verification.';
    if (process.argv.includes('--release')) throw Error(report.environmentWarning);
    console.warn(report.environmentWarning);
  }
  journal.pauseState = gm.state.paused;
  await writeJournal(journalPath, journal);
  await syncPause(journal, false);
  report.runId = journal.runId;
  evidenceDirectory = path.join(directory, journal.runId);
  await mkdir(evidenceDirectory, { recursive: true });

  const browserErrors = [];
  for (const session of [gm, player]) {
    session.page.on('pageerror', (error) => browserErrors.push(safeError(error)));
    session.page.on('console', (message) => {
      if (message.type() === 'error')
        browserErrors.push(`Console error: ${safeError(message.text())}`);
    });
  }

  for (const testCase of cases) {
    checkAbort();
    const result = {
      name: testCase.name,
      area: testCase.area,
      session: testCase.session,
      status: 'running',
      started: new Date().toISOString(),
    };
    report.cases.push(result);
    console.log(`RUN ${testCase.name}`);
    const firstError = browserErrors.length;
    let fixture;
    try {
      fixture = await rpc(gm.page, 'setup', { runId: journal.runId, playerId: player.state.user });
      await viewBoth(fixture);
      result.actual = await runSpecial(testCase, fixture);
      if (browserErrors.length > firstError)
        throw Error(`Browser exception: ${browserErrors.slice(firstError).join('; ')}`);
      const page = testCase.session === 'player' ? player.page : gm.page;
      await page.screenshot({ path: path.join(evidenceDirectory, `${testCase.name}.png`) });
      result.status = 'passed';
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      result.status = String(error.message).includes('Prerequisite:') ? 'blocked' : 'failed';
      result.error = safeError(error);
      console.error(`FAIL ${testCase.name}: ${result.error.slice(0, 1200)}`);
      for (const [role, session] of [
        ['gm', gm],
        ['player', player],
      ]) {
        try {
          await session.page.screenshot({
            path: path.join(evidenceDirectory, `${testCase.name}-failure-${role}.png`),
          });
        } catch {
          // Browser may have closed after a timeout.
        }
      }
    } finally {
      const failures = [];
      for (const operation of [
        () => restoreSessions(journal),
        () => rpc(gm.page, 'cleanup', journal.runId),
        async () => {
          const remaining = await rpc(gm.page, 'leftovers', journal.runId);
          if (Object.values(remaining).some((ids) => ids.length))
            throw Error('Test documents remain');
        },
      ]) {
        try {
          await operation();
        } catch (error) {
          failures.push(safeError(error));
        }
      }
      result.cleanup = failures.length ? 'failed' : 'complete';
      if (failures.length) {
        result.status = 'failed';
        result.cleanupError = failures;
        abort.abort();
      }
      result.finished = new Date().toISOString();
      await saveReport();
    }
  }

  await finishCleanup({
    journal: journalPath,
    cleanup: () => rpc(gm.page, 'cleanup', journal.runId),
    restore: async () => {
      await restoreSessions(journal);
      await syncPause(journal, journal.pauseState);
    },
    verify: async () => {
      const remaining = await rpc(gm.page, 'leftovers', journal.runId);
      if (Object.values(remaining).some((ids) => ids.length))
        throw Error('Test documents remain after final cleanup');
    },
  });
  report.cleanup = 'complete';
}

try {
  await run();
} catch (error) {
  report.error = safeError(error);
  console.error(report.error);
} finally {
  try {
    const pending = await readJournal(journalPath);
    if (locked && gm && player && pending && journal) await recover(pending);
  } catch (error) {
    report.cleanup = 'failed';
    report.cleanupError = safeError(error);
    console.error(report.cleanupError);
  }
  await browser?.close().catch(() => {});
  if (report.sourceFingerprint) {
    try {
      report.sourceChangedDuringRun = report.sourceFingerprint !== (await sourceFingerprint());
    } catch (error) {
      report.sourceChangedDuringRun = true;
      report.error = safeError(error);
    }
  }
  if (locked) await unlink(lockPath).catch(() => {});
  report.finished = new Date().toISOString();
  await saveReport();
}

const failed =
  report.error ||
  report.startupErrors.length ||
  report.sourceChangedDuringRun ||
  report.cleanup === 'failed' ||
  report.cases.some((testCase) => testCase.status !== 'passed');
console.log(
  `Live tests: ${report.cases.filter((testCase) => testCase.status === 'passed').length}/${report.cases.length} passed; cleanup: ${report.cleanup}`,
);
process.exitCode = failed ? 1 : 0;
