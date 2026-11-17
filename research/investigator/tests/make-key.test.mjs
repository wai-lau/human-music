// The one-time key setup tool, run on fake files.
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { makeKey } from '../tools/make-key.mjs';

const apiKey = 'admin-secret-xyz';
const derived = deriveKey(apiKey);
const line = 'HM_KEY_HASH=' + hashKey(derived);

function fake(initial) {
  const f = { text: initial, writes: [] };
  f.readFile = () => f.text;
  f.writeFile = (path, text) => { f.writes.push([path, text]); f.text = text; };
  return f;
}

await run([
  ['an empty file gains exactly the hash line', () => {
    const f = fake('');
    makeKey({ apiKey, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile });
    return f.writes.length === 1 && f.writes[0][0] === '/e' && f.text.split('\n').filter(Boolean).join('|') === line || 'got ' + JSON.stringify(f.text);
  }],
  ['other lines are kept and an old hash is replaced', () => {
    const f = fake('A=1\nHM_KEY_HASH=old\nB=2\n');
    makeKey({ apiKey, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile, overwrite: true });
    const lines = f.text.split('\n').filter(Boolean);
    return lines.join('|') === ['A=1', line, 'B=2'].join('|') || 'got ' + JSON.stringify(f.text);
  }],
  ['an existing hash is refused unless told to overwrite, and nothing is written', () => {
    const f = fake('A=1\nHM_KEY_HASH=old\n');
    try { makeKey({ apiKey, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile }); } catch { return f.writes.length === 0 && f.text.includes('HM_KEY_HASH=old'); }
    return 'did not throw';
  }],
  ['the written text contains neither the admin key nor the derived key', () => {
    const f = fake('A=1\n');
    makeKey({ apiKey, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile });
    return !f.text.includes(apiKey) && !f.text.includes(derived);
  }],
  ['an empty apiKey throws and writes nothing', () => {
    const f = fake('');
    for (const bad of ['', undefined]) {
      try { makeKey({ apiKey: bad, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile }); return 'did not throw'; } catch { /* expected */ }
    }
    return f.writes.length === 0;
  }],
  ['the returned derived key equals deriveKey(apiKey)', () => {
    const f = fake('');
    return makeKey({ apiKey, envFile: '/e', readFile: f.readFile, writeFile: f.writeFile }).derived === derived;
  }],
]);
