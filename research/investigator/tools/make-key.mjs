// One-time key setup, run by the owner on the droplet.
//   grep '^API_KEY=' <exec-fn env file> | cut -d= -f2- | node tools/make-key.mjs /path/to/env [--force]
// The admin key comes on standard input, so it never lands in shell history (API_KEY in the
// environment also works, for a shell that keeps no history).
// Prints the derived key once and writes only its hash as HM_KEY_HASH.
// The admin key and the derived key are never written to any file.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deriveKey, hashKey } from '../src/keys.mjs';

export function makeKey({ apiKey, envFile, readFile, writeFile, overwrite = false }) {
  if (typeof apiKey !== 'string' || apiKey === '') throw new Error('apiKey is empty');
  const derived = deriveKey(apiKey);
  const lines = readFile(envFile).split('\n').filter((l) => l !== '');
  const isHash = (l) => l.startsWith('HM_KEY_HASH=');
  if (lines.some(isHash) && !overwrite) {
    throw new Error('HM_KEY_HASH already exists in ' + envFile + '; pass --force to replace it');
  }
  const entry = 'HM_KEY_HASH=' + hashKey(derived);
  const at = lines.findIndex(isHash);
  const out = lines.filter((l, i) => !isHash(l) || i === at).map((l) => (isHash(l) ? entry : l));
  if (at === -1) out.push(entry);
  writeFile(envFile, out.join('\n') + '\n');
  return { derived };
}

function cli(argv, env, stdinText) {
  const force = argv.includes('--force');
  const [envFile] = argv.filter((a) => a !== '--force');
  if (!envFile) { console.error('usage: node tools/make-key.mjs /path/to/env [--force]'); return 1; }
  const apiKey = env.API_KEY || (stdinText || '').trim();
  if (!apiKey) { console.error('No admin key: pipe it on standard input (see the top of this file).'); return 1; }
  const readFile = (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
  try {
    const { derived } = makeKey({ apiKey, envFile, readFile, writeFile: (p, t) => writeFileSync(p, t, { mode: 0o640 }), overwrite: force });
    console.log(derived);
    console.error('Wrote HM_KEY_HASH to ' + envFile + '. The key above is shown once; paste it into your developer copy.');
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Standard input is read only when it is piped (never waits on a terminal).
  const stdinText = !process.env.API_KEY && !process.stdin.isTTY ? readFileSync(0, 'utf8') : '';
  process.exit(cli(process.argv.slice(2), process.env, stdinText));
}
