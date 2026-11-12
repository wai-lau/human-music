import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const EXT = join(fileURLToPath(import.meta.url), '..', '..', 'extension');

export async function load(files, globals = {}) {
  const ctx = createContext({
    global: null,
    self: null,
    window: null,
    document: null,
    setTimeout: null,
    clearTimeout: null,
    setInterval: null,
    clearInterval: null,
    ...globals
  });

  for (const file of files) {
    const path = join(EXT, file);
    const code = readFileSync(path, 'utf8');
    runInContext(`global = self; ${code}`, ctx);
  }

  return ctx;
}

export async function run(cases) {
  let passed = 0;
  let failed = 0;
  for (const [label, fn] of cases) {
    try {
      const result = await fn();
      if (result === true) {
        console.log(`PASS ${label}`);
        passed++;
      } else {
        console.log(`FAIL ${label}: ${result}`);
        failed++;
      }
    } catch (e) {
      console.log(`FAIL ${label}: ${e.message}`);
      failed++;
    }
  }
  console.log(`${passed}/${cases.length} pass`);
  if (failed > 0) process.exit(1);
}