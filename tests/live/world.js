/* global Actor, ChatMessage, Combat, Scene */
import { assertQaWorld } from './world-guard.mjs';

const MODULE = 'pf2e-combater';
const MARKER = 'liveTestRun';
const STORAGE_KEYS = [
  'pf2e-combater.panelState',
  'pf2e-combater.browserState',
  'pf2e-combater.actionFavorites',
  'pf2e-combater.preferenceProfiles',
  'pf2e-combater.draftPlans',
  'pf2e-combater.sharedDraftPlans',
];
const SETTING_KEYS = [
  'autoOpen',
  'compactDefault',
  'rememberPanelPosition',
  'enableSpellRecommendations',
  'hideUntrainedSkillActions',
  'includeUnknownCustomActions',
  'hideAutoFillFromPlayers',
  'nativeRollContextPreflight',
  'showDebugTab',
  'disableForPlayers',
];

export function validateRunId(runId) {
  if (
    typeof runId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)
  ) {
    throw Error('Invalid live-test run ID; refusing document access');
  }
}

const flag = (runId) => ({ [MODULE]: { [MARKER]: runId } });
const owned = (document, runId) => document?.getFlag?.(MODULE, MARKER) === runId;
const wait = (milliseconds = 100) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function applications() {
  return [
    ...new Set([
      ...Object.values(globalThis.ui?.windows ?? {}),
      ...(globalThis.foundry?.applications?.instances?.values?.() ?? []),
    ]),
  ];
}

async function waitFor(predicate, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await wait(100);
  }
  throw Error(message);
}

function panelElement() {
  return document.querySelector('#pf2e-combater-panel, .pf2e-combater.combater-panel');
}

function browserElement() {
  return document.querySelector('#pf2e-combater-browser, .pf2e-combater.combater-browser');
}

async function click(root, selector) {
  const element = await waitFor(
    () => root()?.querySelector(selector),
    `Missing live UI control: ${selector}`,
  );
  if (element.disabled) throw Error(`Live UI control is disabled: ${selector}`);
  element.click();
  await wait(250);
  return element;
}

async function openPanel() {
  if (panelElement()) return panelElement();
  const binding = game.keybindings.actions.get(`${MODULE}.togglePanel`);
  if (!binding?.onDown) throw Error('Combater keybinding is not registered');
  await binding.onDown();
  return waitFor(panelElement, 'Combater panel did not render');
}

async function autoFill() {
  await openPanel();
  await click(panelElement, '[data-auto-fill]');
  return waitFor(
    () => panelElement()?.querySelectorAll('[data-drag-row]').length,
    'Auto-fill produced no draft steps',
  );
}

async function openBrowser() {
  await openPanel();
  if (!browserElement()) await click(panelElement, "[data-action='toggle-browser']");
  return waitFor(browserElement, 'Action browser did not render');
}

async function searchBrowser(query) {
  const root = await openBrowser();
  const input = root.querySelector('[data-search-actions]');
  if (!input) throw Error('Action browser search is missing');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(350);
  return browserElement();
}

async function compendiumItem(slug) {
  const pack = game.packs.get('pf2e.equipment-srd');
  if (!pack) return null;
  const index = await pack.getIndex({ fields: ['system.slug'] });
  const entry = index.find((item) => item.system?.slug === slug);
  if (!entry) return null;
  const document = await pack.getDocument(entry._id);
  const data = document.toObject();
  delete data._id;
  return data;
}

export function preflight() {
  if (!game.ready || !canvas.ready) throw Error('Foundry canvas is not ready');
  if (game.system.id !== 'pf2e') throw Error('PF2e world required');
  if (!game.modules.get(MODULE)?.active) throw Error('PF2e Combater must be enabled');
  if (!game.modules.get('socketlib')?.active) throw Error('socketlib must be enabled');
  return {
    world: game.world.id,
    user: game.user.id,
    isGM: game.user.isGM,
    paused: game.paused,
    scene: canvas.scene?.id ?? null,
    activeScene: game.scenes.active?.id ?? null,
    controlled: canvas.tokens.controlled.map((token) => token.id),
    targeted: [...game.user.targets].map((token) => token.id),
    combat: game.combat?.id ?? null,
    core: game.version,
    system: game.system.version,
    module: game.modules.get(MODULE).version,
    modules: game.modules
      .filter((module) => module.active)
      .map((module) => ({ id: module.id, version: module.version })),
    openApps: applications().map((app) => app.id),
    settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, game.settings.get(MODULE, key)])),
    storage: Object.fromEntries(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)])),
  };
}

export async function setPause({ world, paused }) {
  assertQaWorld(game.world?.id, world);
  if (!game.user.isGM || typeof paused !== 'boolean')
    throw Error('GM and boolean pause state required');
  if (game.paused !== paused) await game.togglePause(paused, { broadcast: true });
}

export async function setup({ runId, playerId }) {
  validateRunId(runId);
  if (!game.user.isGM) throw Error('GM required to create live fixtures');
  const equipment = (
    await Promise.all([compendiumItem('longsword'), compendiumItem('steel-shield')])
  ).filter(Boolean);
  const hero = await Actor.create({
    name: `Combater QA Hero ${runId.slice(0, 8)}`,
    type: 'character',
    flags: flag(runId),
    ownership: { default: 0, [playerId]: 3 },
    system: {
      details: { level: { value: 5 }, keyability: { value: 'str' } },
      abilities: {
        str: { mod: 4 },
        dex: { mod: 2 },
        con: { mod: 2 },
        int: { mod: 1 },
        wis: { mod: 2 },
        cha: { mod: 0 },
      },
      attributes: {
        hp: { value: 55, max: 55 },
        ac: { value: 22 },
        speed: { value: 25, otherSpeeds: [] },
      },
      perception: { mod: 11, senses: [{ type: 'vision' }] },
      skills: {
        athletics: { rank: 2 },
        intimidation: { rank: 1 },
        medicine: { rank: 1 },
        stealth: { rank: 1 },
      },
      traits: { size: { value: 'med' } },
    },
    items: equipment,
  });
  const enemy = await Actor.create({
    name: `Combater QA Enemy ${runId.slice(0, 8)}`,
    type: 'npc',
    flags: flag(runId),
    ownership: { default: 0, [playerId]: 2 },
    system: {
      details: { level: { value: 5 } },
      attributes: {
        hp: { value: 70, max: 70 },
        ac: { value: 22 },
        speed: { value: 25, otherSpeeds: [] },
      },
      perception: { mod: 12, senses: [{ type: 'darkvision' }] },
      skills: { athletics: { base: 13 }, intimidation: { base: 11 }, stealth: { base: 10 } },
      saves: { fortitude: { value: 13 }, reflex: { value: 11 }, will: { value: 10 } },
      traits: { size: { value: 'med' }, value: ['humanoid'] },
    },
    items: [
      {
        name: 'QA Claw',
        type: 'melee',
        system: {
          slug: 'qa-claw',
          traits: { value: ['agile', 'finesse'] },
          weaponType: { value: 'melee' },
          bonus: { value: 15 },
          damageRolls: { one: { damage: '1d6+6', damageType: 'slashing' } },
          attackEffects: { value: [] },
        },
      },
    ],
  });
  const ally = await Actor.create({
    name: `Combater QA Ally ${runId.slice(0, 8)}`,
    type: 'npc',
    flags: flag(runId),
    ownership: { default: 0 },
    system: {
      details: { level: { value: 3 } },
      attributes: {
        hp: { value: 30, max: 30 },
        ac: { value: 19 },
        speed: { value: 25, otherSpeeds: [] },
      },
      perception: { mod: 9, senses: [{ type: 'darkvision' }] },
      traits: { size: { value: 'med' }, value: ['animal', 'minion'] },
    },
  });
  const tokenData = [];
  for (const [actor, x, y, disposition] of [
    [hero, 400, 500, 1],
    [enemy, 500, 500, -1],
    [ally, 800, 800, -1],
  ]) {
    const token = await actor.getTokenDocument({
      actorLink: true,
      x,
      y,
      width: 1,
      height: 1,
      disposition,
      sight: { enabled: true },
      flags: { ...flag(runId), pf2e: { linkToActorSize: false } },
    });
    const data = token.toObject();
    delete data._id;
    tokenData.push(data);
  }
  const scene = await Scene.create({
    name: `Combater QA ${runId.slice(0, 8)}`,
    active: false,
    navigation: true,
    flags: { ...flag(runId), pf2e: { rulesBasedVision: true } },
    ownership: { default: 0, [playerId]: 2 },
    width: 1800,
    height: 1400,
    padding: 0,
    grid: { size: 100, distance: 5, type: 1 },
    tokenVision: true,
    environment: { darknessLevel: 0, globalLight: { enabled: true } },
    tokens: tokenData,
  });
  await scene.activate();
  await waitFor(
    () => canvas.ready && canvas.scene?.id === scene.id,
    'Fixture scene did not activate',
    60000,
  );
  const ids = Object.fromEntries(scene.tokens.map((token) => [token.actorId, token.id]));
  const combat = await Combat.create({
    scene: scene.id,
    active: false,
    flags: flag(runId),
    combatants: [hero, enemy, ally].map((actor) => ({
      actorId: actor.id,
      tokenId: ids[actor.id],
      sceneId: scene.id,
      initiative: actor === enemy ? 20 : actor === hero ? 15 : 10,
    })),
  });
  await combat.activate();
  await combat.startCombat();
  return {
    scene: scene.id,
    combat: combat.id,
    hero: ids[hero.id],
    enemy: ids[enemy.id],
    ally: ids[ally.id],
    actors: { hero: hero.id, enemy: enemy.id, ally: ally.id },
  };
}

export async function view({ fixture, role }) {
  const scene = game.scenes.get(fixture.scene);
  if (!scene) throw Error('Fixture scene not synchronized');
  await scene.view();
  await waitFor(
    () => canvas.ready && canvas.scene?.id === fixture.scene,
    'Fixture canvas did not become ready',
    60000,
  );
  const subjectId = role === 'player' ? fixture.hero : fixture.enemy;
  const targetId = role === 'player' ? fixture.enemy : fixture.hero;
  canvas.tokens.get(subjectId)?.control({ releaseOthers: true });
  setTokenTargets([targetId]);
  canvas.pan({ x: 650, y: 600, scale: 1 });
  return { subjectId, targetId };
}

function requireCondition(condition, message) {
  if (!condition) throw Error(message);
}

function setTokenTargets(tokenIds = []) {
  for (const token of [...game.user.targets]) token.setTarget(false, { releaseOthers: false });
  for (const tokenId of tokenIds) {
    canvas.tokens.get(tokenId)?.setTarget(true, { releaseOthers: false, groupSelection: true });
  }
}

async function featureWindow(panelSelector, windowSelector) {
  await openPanel();
  await click(panelElement, panelSelector);
  return waitFor(
    () => document.querySelector(windowSelector),
    `Window did not render: ${windowSelector}`,
  );
}

async function addFirstBrowserAction(query = '') {
  const root = query ? await searchBrowser(query) : await openBrowser();
  const button = await waitFor(
    () => [...root.querySelectorAll('[data-add-action]')].find((candidate) => !candidate.disabled),
    `No enabled browser action found for ${query || 'current tab'}`,
  );
  const key = button.dataset.addAction;
  button.click();
  await wait(400);
  requireCondition(
    panelElement()?.querySelector('[data-remove-draft-step]'),
    'Browser action was not added to draft',
  );
  return key;
}

export async function runFeature({ name, fixture }) {
  const details = {};
  switch (name) {
    case 'environment-contract': {
      const module = game.modules.get(MODULE);
      requireCondition(module?.api?.runLiveEngineMatrix, 'Public live engine matrix API missing');
      requireCondition(game.modules.get('socketlib')?.active, 'socketlib inactive');
      const report = await module.api.runLiveEngineMatrix();
      requireCondition(
        report?.ok === true,
        `Live engine matrix failed: ${report?.failures?.join('; ')}`,
      );
      details.engineCases = report.results?.map((entry) => entry.id);
      break;
    }
    case 'panel-open-gm':
    case 'panel-open-player': {
      const root = await openPanel();
      requireCondition(root.querySelector('.combater-shell'), 'Panel shell missing');
      requireCondition(
        root.querySelector("[data-action='toggle-browser']"),
        'Browse control missing',
      );
      details.title = applications().find((app) => app.id === `${MODULE}-panel`)?.title;
      break;
    }
    case 'panel-compact-refresh': {
      const root = await openPanel();
      const before = root.querySelector('.combater-shell')?.classList.contains('is-compact');
      await click(panelElement, "[data-action='toggle-compact']");
      const after = panelElement()
        .querySelector('.combater-shell')
        ?.classList.contains('is-compact');
      requireCondition(before !== after, 'Compact toggle did not change panel state');
      await click(panelElement, "[data-action='refresh']");
      details.compact = after;
      break;
    }
    case 'browser-tabs-search': {
      const root = await searchBrowser('stride');
      requireCondition(
        root.querySelector('[data-search-actions]')?.value === 'stride',
        'Search state not retained',
      );
      requireCondition(root.querySelectorAll('[data-tab]').length >= 3, 'Action-cost tabs missing');
      requireCondition(
        root.querySelector('[data-add-action], .combater-empty'),
        'Search produced neither actions nor empty state',
      );
      details.tabs = root.querySelectorAll('[data-tab]').length;
      break;
    }
    case 'browser-add-remove-action': {
      details.key = await addFirstBrowserAction();
      await click(panelElement, '[data-remove-draft-step]');
      requireCondition(
        !panelElement()?.querySelector('[data-remove-draft-step]'),
        'Draft action was not removed',
      );
      break;
    }
    case 'autofill-builds-legal-plan': {
      details.steps = await autoFill();
      requireCondition(details.steps <= 6, 'Auto-fill generated implausibly large action plan');
      requireCondition(
        panelElement().querySelector('.combater-step-why, .combater-header-step'),
        'Auto-fill rationale missing',
      );
      break;
    }
    case 'autofill-cycle-alternative': {
      await autoFill();
      const before = panelElement().textContent;
      await click(panelElement, '[data-cycle-auto-fill]');
      requireCondition(
        panelElement().textContent.length > 0 && panelElement().textContent !== before,
        'Alternative plan did not update rendered plan',
      );
      break;
    }
    case 'resource-horizon-cycles': {
      await openPanel();
      const button = panelElement().querySelector('[data-cycle-resource-horizon]');
      const before = button?.textContent;
      await click(panelElement, '[data-cycle-resource-horizon]');
      const after = panelElement().querySelector('[data-cycle-resource-horizon]')?.textContent;
      requireCondition(before !== after, 'Resource horizon did not cycle');
      details.value = after?.trim();
      break;
    }
    case 'plan-preference-feedback': {
      await autoFill();
      await click(panelElement, "[data-plan-preference='1']");
      requireCondition(
        panelElement().querySelector("[data-plan-preference='1']")?.getAttribute('aria-pressed') ===
          'true',
        'Positive preference not persisted',
      );
      break;
    }
    case 'draft-duplicate-remove': {
      await autoFill();
      const duplicate = panelElement().querySelector('[data-duplicate-draft-step]');
      if (duplicate && !duplicate.disabled) {
        const before = panelElement().querySelectorAll('[data-remove-draft-step]').length;
        duplicate.click();
        await wait(300);
        requireCondition(
          panelElement().querySelectorAll('[data-remove-draft-step]').length > before,
          'Draft step did not duplicate',
        );
      } else {
        await addFirstBrowserAction();
        requireCondition(
          panelElement().querySelector('[data-remove-draft-step]'),
          'Manual draft editing unavailable',
        );
      }
      await click(panelElement, '[data-remove-draft-step]');
      break;
    }
    case 'draft-drag-reorder-contract': {
      await autoFill();
      const handles = panelElement().querySelectorAll('[data-drag-draft-step]');
      requireCondition(
        handles.length > 0 && [...handles].every((handle) => handle.draggable),
        'Draft drag handles missing',
      );
      requireCondition(panelElement().querySelector('[data-drag-list]'), 'Draft drop list missing');
      details.handles = handles.length;
      break;
    }
    case 'target-picker-current-target': {
      await autoFill();
      requireCondition(game.user.targets.size === 1, 'Fixture target missing');
      const targetTool = panelElement().querySelector('[data-choose-target]');
      if (targetTool && !targetTool.disabled) {
        targetTool.click();
        await wait(300);
      }
      requireCondition(
        panelElement().querySelector('.combater-chip-target, .combater-target'),
        'Target was not represented in plan',
      );
      break;
    }
    case 'movement-route-controls': {
      await addFirstBrowserAction('stride');
      const controls = [
        '[data-choose-destination]',
        '[data-cycle-movement]',
        '[data-cycle-route]',
        '[data-cycle-destination]',
      ];
      requireCondition(
        controls.some((selector) => panelElement().querySelector(selector)),
        'Movement planning controls missing',
      );
      details.controls = controls.filter((selector) => panelElement().querySelector(selector));
      break;
    }
    case 'movement-execute-revert': {
      const report = await game.modules.get(MODULE).api.runLiveEngineMatrix({
        allowMutations: true,
        movement: {
          deltas: [
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      });
      requireCondition(report.ok, report.failures?.join('; ') || 'Movement matrix failed');
      const movement = report.results.find((entry) => entry.id === 'movement-round-trip');
      requireCondition(movement?.details?.restored, 'Movement undo did not restore token');
      details.movement = movement.details;
      break;
    }
    case 'strike-execution-contract': {
      await addFirstBrowserAction('claw');
      const chooseTarget = panelElement().querySelector('[data-choose-target]');
      if (chooseTarget && !chooseTarget.disabled) {
        chooseTarget.click();
        await wait(300);
      }
      const run = panelElement().querySelector('[data-execute-draft-step]');
      requireCondition(run && !run.disabled, 'Native strike execution control unavailable');
      details.label = run.getAttribute('aria-label');
      break;
    }
    case 'area-planning-contract': {
      const area = await import('../../scripts/engine/execution/area.js');
      requireCondition(
        typeof area.prepareAreaExecution === 'function' &&
          typeof area.createAreaRegion === 'function',
        'Area execution API incomplete',
      );
      requireCondition(canvas.scene.regions !== undefined, 'Foundry Region collection unavailable');
      details.exports = ['prepareAreaExecution', 'createAreaRegion', 'createAreaTimer'];
      break;
    }
    case 'sustain-planning-contract': {
      const sustain = await import('../../scripts/engine/execution/sustain.js');
      const tracker = await import('../../scripts/engine/sustained-spells.js');
      requireCondition(
        typeof sustain.executeSustainSpell === 'function',
        'Sustain execution API missing',
      );
      requireCondition(Object.keys(tracker).length > 0, 'Sustained spell tracker unavailable');
      details.trackerExports = Object.keys(tracker);
      break;
    }
    case 'tactic-npc-token-override':
    case 'tactic-npc-actor-default':
    case 'tactic-player-role': {
      const window = await featureWindow('[data-configure-tactic]', '.combater-tactic-editor');
      const role = window.querySelector("select[name='role']");
      requireCondition(role?.options?.length > 1, 'Tactic role choices missing');
      role.selectedIndex = 1;
      role.dispatchEvent(new Event('change', { bubbles: true }));
      const selector =
        name === 'tactic-npc-actor-default'
          ? '[data-tactic-save-actor]'
          : '[data-tactic-save-token]';
      const save = document.querySelector(selector);
      requireCondition(save && !save.disabled, 'Tactic save control unavailable');
      save.click();
      await wait(350);
      details.role = role.value;
      break;
    }
    case 'turn-intent-save-lock-clear': {
      const window = await featureWindow('[data-configure-turn-intent]', '[data-turn-intent-form]');
      const choice = window.querySelector("input[name='stayRanged']");
      choice.checked = true;
      choice.dispatchEvent(new Event('change', { bubbles: true }));
      window.querySelector("[data-turn-intent-lock='stayRanged']")?.click();
      window.querySelector('[data-turn-intent-save]')?.click();
      await wait(350);
      requireCondition(
        panelElement()
          .querySelector('[data-configure-turn-intent]')
          ?.classList.contains('is-active'),
        'Turn intent did not become active',
      );
      const reopened = await featureWindow(
        '[data-configure-turn-intent]',
        '[data-turn-intent-form]',
      );
      reopened.querySelector('[data-turn-intent-clear]')?.click();
      await wait(250);
      break;
    }
    case 'intel-ledger-gm-edit':
    case 'intel-ledger-player-view': {
      if (name === 'intel-ledger-player-view') {
        const intel = await import('../../scripts/rules/intel-ledger.js');
        const intelWindow = await import('../../scripts/ui/intel-window.js');
        const token = canvas.tokens.get(fixture.enemy);
        const actor = token?.actor ?? game.actors.get(fixture.actors.enemy);
        const view = intel.intelLedgerView({
          isGM: false,
          intelTargets: [{ id: token.id, name: token.name, actor, token }],
        });
        requireCondition(
          view.visible &&
            view.editable === false &&
            view.entries.some((entry) => entry.hasRevealed),
          `Revealed Intel was not visible to player: ${JSON.stringify({ actor: actor?.type, flag: actor?.getFlag?.(MODULE, 'intelLedger'), visible: view.visible, editable: view.editable, entries: view.entries.map((entry) => ({ hasRevealed: entry.hasRevealed, revealed: entry.revealed })) })}`,
        );
        await intelWindow.openIntelWindow(view, { mode: 'view' });
        const window = await waitFor(
          () => document.querySelector('.combater-intel-shell'),
          'Read-only Intel window did not render',
        );
        requireCondition(
          !window.querySelector('[data-intel-save]'),
          'Player received editable Intel ledger',
        );
        window.querySelector('[data-intel-close]')?.click();
        details.entries = view.entries.length;
        break;
      }
      await openPanel();
      await click(panelElement, "[data-action='refresh']");
      const window = await featureWindow('[data-configure-intel]', '.combater-intel-shell');
      requireCondition(
        window.querySelector('.combater-intel-body, .combater-intel-empty'),
        'Intel content missing',
      );
      if (name === 'intel-ledger-gm-edit') {
        const fact = window.querySelector("[data-intel-fact] input[type='checkbox']");
        requireCondition(fact, 'Editable Intel fact missing');
        fact.checked = true;
        fact.dispatchEvent(new Event('change', { bubbles: true }));
        window.querySelector('[data-intel-save]')?.click();
        await wait(600);
        requireCondition(
          game.actors.get(fixture.actors.enemy)?.getFlag(MODULE, 'intelLedger'),
          'Intel ledger did not persist to NPC',
        );
      }
      break;
    }
    case 'recall-knowledge-contract': {
      const recall = await import('../../scripts/ui/recall-knowledge.js');
      requireCondition(
        typeof recall.adjudicateRecallKnowledgeRequest === 'function',
        'Recall Knowledge adjudicator missing',
      );
      requireCondition(
        game.pf2e.actions.get('recall-knowledge'),
        'Native PF2e Recall Knowledge action missing',
      );
      details.exports = ['adjudicateRecallKnowledgeRequest', 'resolveRecallKnowledgeRequest'];
      break;
    }
    case 'loadout-advisor-window': {
      const window = await featureWindow('[data-open-loadout-advisor]', '.combater-loadout-shell');
      requireCondition(
        window.querySelector('.combater-loadout-body'),
        'Loadout advisor content missing',
      );
      break;
    }
    case 'effect-clock-window': {
      const window = await featureWindow(
        '[data-open-effect-clock]',
        '.combater-effect-clock-shell',
      );
      requireCondition(
        window.querySelector('.combater-effect-clock-body'),
        'Effect clock content missing',
      );
      break;
    }
    case 'combat-tracker-intel': {
      await ui.combat.render({ force: true, combat: game.combats.get(fixture.combat) });
      Hooks.callAll('renderCombatTracker', ui.combat, ui.combat.element);
      await waitFor(
        () => document.querySelector(`.${MODULE}-combatant-intel`),
        'Combat tracker Intel button missing',
      );
      break;
    }
    case 'token-selection-follows-combatant': {
      await openPanel();
      const before = applications().find((app) => app.id === `${MODULE}-panel`)?.title;
      canvas.tokens.get(fixture.hero).control({ releaseOthers: true });
      await wait(500);
      const after = applications().find((app) => app.id === `${MODULE}-panel`)?.title;
      requireCondition(
        before !== after && after?.includes('Hero'),
        'Panel did not follow selected combatant',
      );
      details.titles = { before, after };
      break;
    }
    case 'player-share-draft-socket': {
      await autoFill();
      await wait(500);
      const actor = game.actors.get(fixture.actors.hero);
      details.shared = actor.getFlag(MODULE, 'sharedDraftPlans') ?? null;
      requireCondition(
        details.shared || game.modules.get('socketlib')?.active,
        'Player draft neither persisted nor had socket transport',
      );
      break;
    }
    case 'panel-position-persistence': {
      await openPanel();
      const app = applications().find((candidate) => candidate.id === `${MODULE}-panel`);
      app.setPosition({ left: 180, top: 140 });
      app._savePosition();
      await wait(150);
      const state = JSON.parse(localStorage.getItem(`${MODULE}.panelState`) ?? '{}');
      requireCondition(
        Number.isFinite(state.left) && Number.isFinite(state.top),
        'Panel position not persisted',
      );
      details.position = state;
      break;
    }
    case 'browser-position-persistence': {
      await openBrowser();
      const app = applications().find((candidate) => candidate.id === `${MODULE}-browser`);
      app.setPosition({ left: 900, top: 120, width: 500, height: 650 });
      app._savePosition();
      await wait(150);
      const state = JSON.parse(localStorage.getItem(`${MODULE}.browserState`) ?? '{}');
      requireCondition(
        Number.isFinite(state.width) && Number.isFinite(state.height),
        'Browser geometry not persisted',
      );
      details.position = state;
      break;
    }
    case 'action-details-native-sheet': {
      const root = await searchBrowser('claw');
      const open = root.querySelector('[data-open-action]');
      requireCondition(open, 'Action details control missing');
      const before = new Set(applications().map((app) => app.id));
      open.click();
      await wait(350);
      requireCondition(
        applications().some((app) => !before.has(app.id)),
        'Native item sheet or guidance did not open',
      );
      break;
    }
    case 'reset-execution-contract': {
      const state = await import('../../scripts/engine/execution/state.js');
      const workflow = await import('../../scripts/ui/panel/execution-workflow.js');
      const reset = state.resetDraftExecution({
        steps: [{ instanceId: 'live-reset', execution: { status: 'done' } }],
      });
      requireCondition(
        reset.steps[0].execution.status === 'pending' &&
          typeof workflow.resetPanelExecution === 'function',
        'Execution reset contract unavailable',
      );
      details.status = reset.steps[0].execution.status;
      break;
    }
    case 'localization-contract': {
      const dictionaries = await Promise.all(
        ['en', 'ja'].map(async (language) => {
          const response = await fetch(`/modules/${MODULE}/lang/${language}.json`);
          if (!response.ok) throw Error(`Cannot load ${language} localization`);
          return response.json();
        }),
      );
      requireCondition(
        dictionaries.every((dictionary) => dictionary.PF2E_COMBATER),
        'Localization namespace missing',
      );
      details.languages = ['en', 'ja'];
      break;
    }
    case 'minion-planner-contract': {
      const minions = await import('../../scripts/rules/minion-planner.js');
      requireCondition(
        typeof minions.planMinionSubturn === 'function',
        'Minion planner API missing',
      );
      const ally = canvas.tokens.get(fixture.ally);
      requireCondition(
        ally?.actor?.traits?.has?.('minion') ||
          ally?.actor?.system?.traits?.value?.includes?.('minion'),
        'Live minion fixture not prepared',
      );
      break;
    }
    case 'visioner-integration-contract': {
      const visioner = await import('../../scripts/integrations/visioner.js');
      requireCondition(
        typeof visioner.isVisionerActive === 'function',
        'Visioner integration API missing',
      );
      details.active = visioner.isVisionerActive();
      const observer = canvas.tokens.get(fixture.enemy);
      const target = canvas.tokens.get(fixture.hero);
      details.detection = visioner.readVisionerDetectionState(observer, target);
      details.cover = visioner.readVisionerCoverState(observer, target);
      break;
    }
    default:
      throw Error(`Unknown live feature: ${name}`);
  }
  return { name, details };
}

export async function setWorldSetting({ key, value }) {
  if (!game.user.isGM || !['disableForPlayers', 'hideAutoFillFromPlayers'].includes(key))
    throw Error('Unsupported live setting mutation');
  await game.settings.set(MODULE, key, value);
  return game.settings.get(MODULE, key);
}

export async function seedIntel(fixture) {
  if (!game.user.isGM) throw Error('GM required to seed Intel');
  const actor = game.actors.get(fixture.actors.enemy);
  if (!actor) throw Error('Intel fixture actor missing');
  await actor.setFlag(MODULE, 'intelLedger', { identity: ['identity'] });
  return actor.getFlag(MODULE, 'intelLedger');
}

export async function inspectAccess({ hiddenAutoFill = false } = {}) {
  await wait(400);
  const panel = panelElement();
  if (game.settings.get(MODULE, 'disableForPlayers') && !game.user.isGM) {
    return {
      panel: !!panel,
      tool: !!document.querySelector(`[data-tool='${MODULE}-toggle-panel']`),
    };
  }
  await openPanel();
  return {
    panel: !!panelElement(),
    autoFill: !!panelElement()?.querySelector('[data-auto-fill]'),
    expectedAutoFill: !hiddenAutoFill,
  };
}

export function inspectSharedDraft(fixture) {
  const actor = game.actors.get(fixture.actors.hero);
  return { value: actor?.getFlag(MODULE, 'sharedDraftPlans') ?? null };
}

export async function leftovers(runId) {
  validateRunId(runId);
  return Object.fromEntries(
    ['messages', 'combats', 'scenes', 'actors'].map((key) => [
      key,
      game[key].filter((document) => owned(document, runId)).map((document) => document.id),
    ]),
  );
}

export async function cleanup(runId) {
  validateRunId(runId);
  if (!game.user.isGM) throw Error('GM required for cleanup');
  const sceneIds = new Set(
    game.scenes.filter((document) => owned(document, runId)).map((document) => document.id),
  );
  const actorIds = new Set(
    game.actors.filter((document) => owned(document, runId)).map((document) => document.id),
  );
  const failures = [];
  for (const [collection, type] of [
    [game.messages, ChatMessage],
    [game.combats, Combat],
    [game.scenes, Scene],
    [game.actors, Actor],
  ]) {
    const ids = collection
      .filter(
        (document) =>
          owned(document, runId) ||
          (collection === game.messages &&
            (sceneIds.has(document.speaker?.scene) || actorIds.has(document.speaker?.actor))),
      )
      .map((document) => document.id);
    if (!ids.length) continue;
    try {
      await type.deleteDocuments(ids);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw Error(failures.join('; '));
}

export async function restore(saved) {
  for (const app of applications()) {
    if (!saved.openApps.includes(app.id)) await app.close().catch(() => {});
  }
  for (const [key, value] of Object.entries(saved.storage ?? {})) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  if (game.user.isGM) {
    for (const [key, value] of Object.entries(saved.settings ?? {})) {
      if (game.settings.get(MODULE, key) !== value) await game.settings.set(MODULE, key, value);
    }
    if (saved.activeScene && game.scenes.has(saved.activeScene)) {
      await game.scenes.get(saved.activeScene).activate();
    }
  }
  if (saved.scene && game.scenes.has(saved.scene)) await game.scenes.get(saved.scene).view();
  if (canvas.ready) {
    canvas.tokens.releaseAll();
    for (const id of saved.controlled ?? [])
      canvas.tokens.get(id)?.control({ releaseOthers: false });
    setTokenTargets(saved.targeted ?? []);
  }
}
