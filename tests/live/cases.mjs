const live = (name, area, session = 'gm', smoke = false, options = {}) => ({
  name,
  area,
  session,
  smoke,
  ...options,
});

// Each case crosses real Foundry documents, PF2e actor preparation, module hooks,
// ApplicationV2 rendering, and browser DOM. Algorithm matrices remain in the
// fast self-test; these cases certify user-visible integration seams.
export const fullCases = [
  live('environment-contract', 'startup', 'gm', true),
  live('panel-open-gm', 'panel', 'gm', true),
  live('panel-open-player', 'access', 'player', true),
  live('panel-compact-refresh', 'panel', 'gm', true),
  live('browser-tabs-search', 'browser', 'gm', true),
  live('browser-add-remove-action', 'draft', 'gm', true),
  live('autofill-builds-legal-plan', 'planner', 'gm', true),
  live('autofill-cycle-alternative', 'planner', 'gm'),
  live('resource-horizon-cycles', 'planner', 'gm'),
  live('plan-preference-feedback', 'learning', 'gm'),
  live('draft-duplicate-remove', 'draft', 'gm'),
  live('draft-drag-reorder-contract', 'draft', 'gm'),
  live('target-picker-current-target', 'targeting', 'gm'),
  live('movement-route-controls', 'movement', 'gm'),
  live('movement-execute-revert', 'execution', 'gm', true, { mutatesToken: true }),
  live('strike-execution-contract', 'execution', 'gm'),
  live('area-planning-contract', 'areas', 'gm'),
  live('sustain-planning-contract', 'spells', 'gm'),
  live('tactic-npc-token-override', 'tactics', 'gm'),
  live('tactic-npc-actor-default', 'tactics', 'gm'),
  live('tactic-player-role', 'tactics', 'player'),
  live('turn-intent-save-lock-clear', 'intent', 'player'),
  live('intel-ledger-gm-edit', 'intel', 'gm'),
  live('intel-ledger-player-view', 'intel', 'player'),
  live('recall-knowledge-contract', 'recall-knowledge', 'player'),
  live('loadout-advisor-window', 'loadout', 'gm'),
  live('effect-clock-window', 'effects', 'gm'),
  live('combat-tracker-intel', 'combat-tracker', 'player'),
  live('token-selection-follows-combatant', 'panel', 'gm'),
  live('player-share-draft-socket', 'multiplayer', 'player'),
  live('player-access-live-cleanup', 'access', 'gm'),
  live('hide-autofill-from-player', 'access', 'gm'),
  live('panel-position-persistence', 'persistence', 'gm'),
  live('browser-position-persistence', 'persistence', 'gm'),
  live('action-details-native-sheet', 'native-pf2e', 'gm'),
  live('reset-execution-contract', 'execution', 'gm'),
  live('localization-contract', 'localization', 'gm'),
  live('minion-planner-contract', 'minions', 'gm'),
  live('visioner-integration-contract', 'integrations', 'gm'),
];

export const smokeCases = fullCases.filter((testCase) => testCase.smoke);

export function validateCases(cases) {
  const names = new Set();
  for (const testCase of cases) {
    if (!testCase.name || names.has(testCase.name))
      throw Error(`Invalid or duplicate live case: ${testCase.name}`);
    if (!testCase.area || !['gm', 'player'].includes(testCase.session))
      throw Error(`Invalid live case metadata: ${testCase.name}`);
    names.add(testCase.name);
  }
}
