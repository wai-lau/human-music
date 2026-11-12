import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const EXT = join(fileURLToPath(import.meta.url), '..', '..', 'extension');

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const files = walk(EXT);
const textFiles = files.filter(f => {
  const ext = f.substring(f.lastIndexOf('.'));
  return ['.js', '.html', '.css', '.json', '.md'].includes(ext);
});

const forbidden = /\b(slop|fake|garbage)\b|fight ai/i;

let passed = 0;
let failed = 0;
for (const f of textFiles) {
  try {
    const content = readFileSync(f, 'utf8');
    if (forbidden.test(content)) {
      console.log(`FAIL ${f}: found forbidden wording`);
      failed++;
    } else {
      console.log(`PASS ${f}`);
      passed++;
    }
  } catch (e) {
    console.log(`FAIL ${f}: ${e.message}`);
    failed++;
  }
}
console.log(`${passed}/${textFiles.length} pass`);
if (failed > 0) process.exit(1);