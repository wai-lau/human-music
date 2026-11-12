import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const EXT = join(fileURLToPath(import.meta.url), '..', '..', 'extension');

// Run each extension/<file> in one fresh context and return it; ctx.HM is the namespace.
export function load(files, globals = {}) {
  const ctx = createContext({ console, ...globals });
  for (const file of files) {
    const path = join(EXT, file);
    runInContext(readFileSync(path, 'utf8'), ctx, { filename: path });
  }
  return ctx;
}

// cases: [label, fn] where fn returns (or resolves) true, or a failure reason.
export async function run(cases) {
  let passed = 0;
  for (const [label, fn] of cases) {
    try {
      const result = await fn();
      if (result === true) {
        console.log(`PASS ${label}`);
        passed++;
      } else {
        console.log(`FAIL ${label}: ${result}`);
      }
    } catch (e) {
      console.log(`FAIL ${label}: ${e && e.stack || e}`);
    }
  }
  console.log(`${passed}/${cases.length} pass`);
  process.exit(passed === cases.length ? 0 : 1);
}
