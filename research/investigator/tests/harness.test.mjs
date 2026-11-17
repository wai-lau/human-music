// The harness itself: run on throwaway case files in a temp folder.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './harness.mjs';

const harness = pathToFileURL(join(import.meta.dirname, 'harness.mjs')).href;
function runCases(body) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-harness-'));
  try {
    const f = join(dir, 'cases.mjs');
    writeFileSync(f, `import { run } from ${JSON.stringify(harness)};\nawait run([${body}]);\n`);
    const r = spawnSync(process.execPath, [f], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

await run([
  ['all passing prints 2/2 pass and exits 0', () => {
    const r = runCases(`['a', () => true], ['b', async () => true]`);
    return (r.code === 0 && r.out.trim() === '2/2 pass') || JSON.stringify(r);
  }],
  ['a failing string is printed, 1/2 pass, exit 1', () => {
    const r = runCases(`['a', () => true], ['b', () => 'wanted 3, got 4']`);
    return (r.code === 1 && r.out.includes('FAIL b: wanted 3, got 4') && r.out.trim().endsWith('1/2 pass')) || JSON.stringify(r);
  }],
  ['a throwing case counts as failed', () => {
    const r = runCases(`['a', () => { throw new Error('boom'); }]`);
    return (r.code === 1 && r.out.includes('FAIL a: threw') && r.out.includes('boom') && r.out.trim().endsWith('0/1 pass')) || JSON.stringify(r);
  }],
]);
