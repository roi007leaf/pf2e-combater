import { readFile } from 'node:fs/promises';
import { fullCases } from './cases.mjs';
import { assessMatrix, sourceFingerprint } from './evidence.mjs';

const files = process.argv.slice(2);
if (!files.length)
  throw Error(
    'Provide report.json paths from each local Foundry environment. No world is started or modified.',
  );
const reports = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
const result = assessMatrix(fullCases, reports, await sourceFingerprint());
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.complete ? 0 : 1;
