import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function sourceFingerprint(root = '.') {
  const hash = createHash('sha256');
  async function walk(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        hash.update(file);
        hash.update(await readFile(path.join(root, file)));
      }
    }
  }
  for (const directory of ['scripts', 'styles', 'templates', 'lang', 'tests/live'])
    await walk(directory);
  hash.update(await readFile(path.join(root, 'module.json')));
  return hash.digest('hex');
}

export const profiles = [{ name: 'foundry14-pf2e', core: 14 }];

export function assessMatrix(catalog, reports, fingerprint) {
  const accepted = reports.filter(
    (report) =>
      report.sourceFingerprint === fingerprint &&
      report.cleanup === 'complete' &&
      !report.error &&
      !report.environmentWarning &&
      !report.sourceChangedDuringRun &&
      !report.startupErrors?.length,
  );
  const details = profiles.map((profile) => {
    const matches = accepted.filter(
      (report) => Number(report.environment?.core?.split('.')[0]) === profile.core,
    );
    const latest = new Map();
    for (const report of [...matches].sort((a, b) =>
      String(a.finished).localeCompare(String(b.finished)),
    )) {
      for (const result of report.cases ?? []) latest.set(result.name, result);
    }
    const required = catalog.filter(
      (testCase) => !testCase.environment?.core || testCase.environment.core === profile.core,
    );
    return {
      profile: profile.name,
      required: required.length,
      passed: required
        .filter((testCase) => latest.get(testCase.name)?.status === 'passed')
        .map((testCase) => testCase.name),
      unrun: required
        .filter((testCase) => !latest.has(testCase.name))
        .map((testCase) => testCase.name),
      failed: required
        .filter(
          (testCase) => latest.has(testCase.name) && latest.get(testCase.name)?.status !== 'passed',
        )
        .map((testCase) => testCase.name),
    };
  });
  return {
    complete: details.every((profile) => !profile.unrun.length && !profile.failed.length),
    rejectedReports: reports.length - accepted.length,
    details,
  };
}
