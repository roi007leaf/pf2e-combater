export const requiredAreas = [
  'startup',
  'panel',
  'access',
  'browser',
  'draft',
  'planner',
  'learning',
  'targeting',
  'movement',
  'execution',
  'areas',
  'spells',
  'tactics',
  'intent',
  'intel',
  'recall-knowledge',
  'loadout',
  'effects',
  'combat-tracker',
  'multiplayer',
  'persistence',
  'native-pf2e',
  'localization',
  'minions',
  'integrations',
  'combat-options',
];

export function assessCoverage(catalog, results = []) {
  const latest = new Map(results.map((result) => [result.name, result]));
  const details = requiredAreas.map((area) => {
    const cases = catalog.filter((testCase) => testCase.area === area);
    return {
      area,
      required: cases.map((testCase) => testCase.name),
      passed: cases
        .filter((testCase) => latest.get(testCase.name)?.status === 'passed')
        .map((testCase) => testCase.name),
      unrun: cases
        .filter((testCase) => !latest.has(testCase.name))
        .map((testCase) => testCase.name),
      failed: cases
        .filter(
          (testCase) => latest.has(testCase.name) && latest.get(testCase.name)?.status !== 'passed',
        )
        .map((testCase) => testCase.name),
    };
  });
  return {
    complete: details.every(
      (entry) => entry.required.length && !entry.unrun.length && !entry.failed.length,
    ),
    details,
  };
}
