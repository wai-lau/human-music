// Contract: audio fingerprints from Wai's own copy (Wai, 2026-11-23: "A" — only her dev copy sends
// fingerprints of songs it plays and AI songs it skips, to train the audio model; no audio is sent).
//
// POST /api/fingerprint, behind the same key check as every route (checked before the body is read).
//   Body: { title: string 1-300, artistLine: string 1-300, label: 'ai' | 'played',
//           seconds: number 5-60, print: array of exactly 510 finite numbers, each 0 <= x <= 1 }
//   Extra fields are ignored. Anything else: 400 { error } and nothing stored.
//   Stored: 202 { stored: 1 }. At most 500 stored per UTC day (createServer gains an optional
//   now: () => Date, default () => new Date()); past that 429 { error } and nothing stored.
// store.mjs gains a player_prints table and:
//   putPlayerPrint({ at: ISO string, title, artistLine, label, seconds, print }) -> id
//   listPlayerPrints() -> [{ id, at, title, artistLine, label, seconds, print: number[] }] oldest first
//   countPlayerPrints(dayPrefix 'YYYY-MM-DD') -> number stored with at starting with it
// cli.mjs gains `export-prints`: one JSON object per line on stdout (listPlayerPrints order), nothing else.
// Run from research/investigator: node tests/player-prints-contract.check.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { parseRequest } from '../src/intake.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createServer } from '../src/server.mjs';

const KEY = deriveKey('admin-secret');
const NOW = new Date('2026-11-23T12:00:00Z');
const auth = (k = KEY) => ({ Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' });
const print = (v = 0.5) => Array.from({ length: 510 }, (_, i) => (i === 0 ? 1 : v));
const good = (o = {}) => ({ title: 'Song', artistLine: 'Some Act', label: 'ai', seconds: 12, print: print(), ...o });

async function withServer(fn, store = openStore(':memory:')) {
  const queue = createQueue({ store, now: () => NOW, cap: 100 });
  const server = createServer({ keyHash: hashKey(KEY), queue, store, intake: { parseRequest }, allowedOrigin: 'chrome-extension://x', kick() {}, now: () => NOW });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (b, h = auth()) => fetch(url + '/api/fingerprint', { method: 'POST', headers: h, body: typeof b === 'string' ? b : JSON.stringify(b) });
  try { return await fn({ post, store }); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); store.close(); }
}

await run([
  ['a good fingerprint is stored with its fields; 202 { stored: 1 }', () => withServer(async ({ post, store }) => {
    const r = await post(good({ extra: 'ignored' }));
    const body = await r.json();
    const rows = store.listPlayerPrints();
    const ok = r.status === 202 && body.stored === 1 && rows.length === 1 && rows[0].title === 'Song' && rows[0].artistLine === 'Some Act'
      && rows[0].label === 'ai' && rows[0].seconds === 12 && rows[0].print.length === 510 && rows[0].print[1] === 0.5 && rows[0].at.startsWith('2026-11-23');
    return ok || JSON.stringify({ status: r.status, body, rows: rows.map((x) => ({ ...x, print: x.print.length })) });
  })],
  ['a wrong key gets 401 and stores nothing', () => withServer(async ({ post, store }) => {
    const r = await post(good(), auth('nope'));
    return (r.status === 401 && store.listPlayerPrints().length === 0) || String(r.status);
  })],
  ['bad bodies get 400 and store nothing', () => withServer(async ({ post, store }) => {
    const bad = [
      'not json', good({ label: 'human' }), good({ label: undefined }), good({ title: '' }), good({ artistLine: 'x'.repeat(301) }),
      good({ seconds: 2 }), good({ seconds: 61 }), good({ seconds: '12' }), good({ print: print().slice(1) }), good({ print: [...print(), 0] }),
      good({ print: print(1.5) }), good({ print: print(-0.1) }), good({ print: Array(510).fill('0.5') }), good({ print: 'x' }),
    ];
    const got = [];
    for (const b of bad) got.push((await post(b)).status);
    return (got.every((s) => s === 400) && store.listPlayerPrints().length === 0) || JSON.stringify(got);
  })],
  ['the 501st on one UTC day gets 429; 500 are kept', () => withServer(async ({ post, store }) => {
    for (let i = 0; i < 500; i++) store.putPlayerPrint({ at: '2026-11-23T0' + (i % 10) + ':00:00Z', title: 'S' + i, artistLine: 'A', label: 'played', seconds: 30, print: print() });
    store.putPlayerPrint({ at: '2026-11-22T23:00:00Z', title: 'old', artistLine: 'A', label: 'played', seconds: 30, print: print() });
    const r = await post(good());
    return (r.status === 429 && store.countPlayerPrints('2026-11-23') === 500 && store.listPlayerPrints().length === 501) || String(r.status);
  })],
  ['cli export-prints writes one JSON line per stored print, oldest first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-pp-'));
    try {
      const path = join(dir, 'investigator.db');
      const s = openStore(path);
      s.putPlayerPrint({ at: '2026-11-23T01:00:00Z', title: 'First', artistLine: 'A', label: 'played', seconds: 30, print: print() });
      s.putPlayerPrint({ at: '2026-11-23T02:00:00Z', title: 'Second', artistLine: 'B', label: 'ai', seconds: 12, print: print() });
      s.close();
      const r = spawnSync(process.execPath, ['src/cli.mjs', 'export-prints'], { env: { ...process.env, HM_DATA_DIR: dir, HM_DB_PATH: path }, encoding: 'utf8' });
      const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      return (r.status === 0 && lines.length === 2 && lines[0].title === 'First' && lines[1].label === 'ai' && lines[1].print.length === 510) || JSON.stringify({ status: r.status, out: r.stdout.slice(0, 200), err: r.stderr.slice(0, 300) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
]);
