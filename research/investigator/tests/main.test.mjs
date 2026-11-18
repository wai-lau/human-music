// The wiring: createApp driven with fakes, a real socket in a temp folder, fake timers.
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { createApp } from '../src/main.mjs';

const KEY = deriveKey('admin-secret');
const HASH = hashKey(KEY);
const TOKEN = 'oauth-token-AAAA1111BBBB2222';
const SHLABS = 'shlabs-key-CCCC3333DDDD4444';
const ARTISTS = ['Alpha Band', 'Beta Band', 'Gamma Band'];

class FakeTimers {
  constructor() { this.list = []; this.at = 0; this.n = 0; }
  setTimeout = (fn, ms) => { const t = { fn, due: this.at + ms, id: ++this.n }; this.list.push(t); return t; };
  clearTimeout = (t) => { this.list = this.list.filter((x) => x !== t); };
  async advance(ms) {
    const end = this.at + ms;
    for (;;) {
      const next = this.list.filter((t) => t.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      this.list = this.list.filter((t) => t !== next);
      this.at = Math.max(this.at, next.due);
      next.fn();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    }
    this.at = end;
  }
}

const item = (a) => ({ title: 'Song', artistLine: a, album: 'Al', artUrl: 'https://img.example/a.jpg' });

async function make(extraEnv = {}, extraDeps = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-'));
  const logs = [];
  const timers = new FakeTimers();
  const calls = { cheap: 0, publish: [] };
  const env = { HM_KEY_HASH: HASH, CLAUDE_CODE_OAUTH_TOKEN: TOKEN, SHLABS_API_KEY: SHLABS, HM_DATA_DIR: dir, HM_SOCKET: join(dir, 's.sock'), ...extraEnv };
  const deps = {
    log: (...a) => logs.push(a.join(' ')),
    timers,
    now: () => new Date('2026-11-16T12:00:00Z'),
    cheapPass: async () => { calls.cheap++; return { verdict: 'human', confidence: 90, signals: [], reasons: ['old releases'], sources: [] }; },
    investigate: async () => ({ ok: false, kind: 'invalid', detail: 'unused' }),
    publisher: { publish: async (json) => { calls.publish.push(json); return { ok: true, changed: true }; } },
    ...extraDeps,
  };
  const app = createApp(env, deps);
  const stop = async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, env, deps, dir, logs, timers, calls, stop };
}

function req(socketPath, method, path, { key, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (key) headers.Authorization = 'Bearer ' + key;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const r = http.request({ socketPath, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const queueThree = (app) => app.queue.enqueue(ARTISTS.map((a) => ({ name: a, site: 'ytm', songs: [], playing: false })));

await run([
  ['createApp refuses to start without HM_KEY_HASH', () => {
    for (const env of [{}, { HM_KEY_HASH: '' }, { HM_KEY_HASH: '   ' }]) {
      let msg = '';
      try { createApp({ ...env, HM_DATA_DIR: tmpdir() }, {}); } catch (e) { msg = e.message; }
      if (!/HM_KEY_HASH/.test(msg)) return 'no clear refusal for ' + JSON.stringify(env) + ': ' + msg;
    }
    return true;
  }],
  ['main.mjs without the hash exits 1 with a clear message and prints no secret', () => {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, '../src/main.mjs')], { env: { PATH: process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, encoding: 'utf8' });
    if (r.status !== 1) return 'exit ' + r.status;
    if (!/HM_KEY_HASH/.test(r.stderr)) return 'stderr: ' + r.stderr;
    return !(r.stdout + r.stderr).includes(TOKEN) || 'token printed';
  }],
  ['listens on the unix socket: /api/status with the key is 200, without it 401, mode 0660', async () => {
    const t = await make();
    try {
      await t.app.listen();
      const ok = await req(t.env.HM_SOCKET, 'GET', '/api/status', { key: KEY });
      const no = await req(t.env.HM_SOCKET, 'GET', '/api/status');
      const bad = await req(t.env.HM_SOCKET, 'GET', '/api/status', { key: 'wrong' });
      const mode = statSync(t.env.HM_SOCKET).mode & 0o777;
      if (ok.status !== 200 || JSON.parse(ok.text).cap !== 100) return 'with key: ' + ok.status + ' ' + ok.text;
      if (no.status !== 401 || bad.status !== 401 || no.text !== bad.text) return 'without key: ' + no.status + ' ' + bad.status;
      return mode === 0o660 || 'mode ' + mode.toString(8);
    } finally { await t.stop(); }
  }],
  ['a stale socket file is removed first', async () => {
    const t = await make();
    const old = net.createServer();
    try {
      await new Promise((r) => old.listen(t.env.HM_SOCKET, r)); // a socket file nobody will serve after we replace it
      await t.app.listen();
      const ok = await req(t.env.HM_SOCKET, 'GET', '/api/status', { key: KEY });
      return ok.status === 200 || 'status ' + ok.status;
    } finally { old.close(); await t.stop(); }
  }],
  ['HM_DAILY_CAP sets the cap; the default is 100', async () => {
    const a = await make({ HM_DAILY_CAP: '7' });
    const b = await make({ HM_DAILY_CAP: '' });
    try {
      return (a.app.queue.status().cap === 7 && b.app.queue.status().cap === 100) || 'caps ' + a.app.queue.status().cap + ' ' + b.app.queue.status().cap;
    } finally { await a.stop(); await b.stop(); }
  }],
  ['a kick runs exactly one worker step, and two kicks at once share it', async () => {
    const t = await make();
    try {
      queueThree(t.app);
      const p1 = t.app.kick();
      const p2 = t.app.kick();
      await Promise.all([p1, p2]);
      if (t.calls.cheap !== 1) return 'steps: ' + t.calls.cheap;
      return t.app.store.listPublishable().length === 1 || 'verdicts ' + t.app.store.listPublishable().length;
    } finally { await t.stop(); }
  }],
  ['after a finished artist the next step follows on a timer, one at a time, until idle', async () => {
    const t = await make();
    try {
      queueThree(t.app);
      await t.app.kick();
      await t.timers.advance(0);
      await t.timers.advance(0);
      await t.timers.advance(0);
      return (t.calls.cheap === 3 && t.app.queue.status().queued === 0) || 'steps ' + t.calls.cheap;
    } finally { await t.stop(); }
  }],
  ['a request over the socket kicks the worker', async () => {
    const t = await make();
    try {
      await t.app.listen();
      const r = await req(t.env.HM_SOCKET, 'POST', '/api/investigate', { key: KEY, body: JSON.stringify({ items: [item('Delta Band')] }) });
      await t.app.idle();
      return (r.status === 202 && t.calls.cheap === 1) || `${r.status} cheap ${t.calls.cheap}`;
    } finally { await t.stop(); }
  }],
  // Wai, 2026-11-17: "publish once a day".
  // The three artists are judged made by people (the cheap pass), so nothing of them is public
  // (Wai, 2026-11-18: only AI verdicts are published).
  ['publish is once a day, carries no made-by-people verdicts, and says calibrated: false', async () => {
    const t = await make();
    try {
      queueThree(t.app);
      await t.app.kick();
      await t.timers.advance(0);
      await t.timers.advance(0);
      await t.timers.advance(23 * 3600000);
      if (t.calls.publish.length !== 0) return 'published early: ' + t.calls.publish.length;
      await t.timers.advance(3600000);
      if (t.calls.publish.length !== 1) return 'publishes: ' + t.calls.publish.length;
      const list = JSON.parse(t.calls.publish[0]);
      if (list.artists.length !== 0 || list.calibrated !== false) return 'list: ' + t.calls.publish[0];
      await t.timers.advance(600000);
      return t.calls.publish.length === 1 || 'published again: ' + t.calls.publish.length;
    } finally { await t.stop(); }
  }],
  // Review 2026-11-17 (service, finding 7): the daily timer lived only in memory, so a service
  // restarted more often than daily never published. The due time is stored.
  ['a restart keeps the publish due time: published once, a day after the first verdict', async () => {
    const t = await make();
    const T0 = new Date('2026-11-16T12:00:00Z').getTime();
    let t2 = null;
    try {
      queueThree(t.app);
      await t.app.kick();
      await t.timers.advance(0);
      await t.timers.advance(0);
      await t.timers.advance(20 * 3600000);
      await t.app.close();
      if (t.calls.publish.length !== 0) return 'published before the restart: ' + t.calls.publish.length;
      const timers = new t.timers.constructor();
      const calls = [];
      const app2 = createApp(t.env, { ...t.deps, timers, now: () => new Date(T0 + 20 * 3600000),
        publisher: { publish: async (json) => { calls.push(json); return { ok: true, changed: true }; } } });
      t2 = app2;
      await app2.listen();
      await timers.advance(3 * 3600000);
      if (calls.length !== 0) return 'published early after the restart: ' + calls.length;
      await timers.advance(3600000);
      return calls.length === 1 || 'publishes after the restart: ' + calls.length;
    } finally { if (t2) await t2.close(); await t.stop(); }
  }],
  ['a failed push is retried after 10 minutes, then stops once it works', async () => {
    let fail = 2;
    const t = await make();
    t.app.setPublisher({ publish: async (json) => { t.calls.publish.push(json); return fail-- > 0 ? { ok: false, error: 'remote unreachable' } : { ok: true, changed: true }; } });
    try {
      queueThree(t.app);
      await t.app.kick();
      await t.timers.advance(24 * 3600000); // publishing is once a day (Wai, 2026-11-17)
      if (t.calls.publish.length !== 1) return 'first: ' + t.calls.publish.length;
      await t.timers.advance(599000);
      if (t.calls.publish.length !== 1) return 'retried early: ' + t.calls.publish.length;
      await t.timers.advance(1000);
      if (t.calls.publish.length !== 2) return 'second: ' + t.calls.publish.length;
      await t.timers.advance(600000);
      if (t.calls.publish.length !== 3) return 'third: ' + t.calls.publish.length;
      await t.timers.advance(3600000);
      return t.calls.publish.length === 3 || 'kept retrying: ' + t.calls.publish.length;
    } finally { await t.stop(); }
  }],
  ['a thrown publisher is caught and retried like a failed push', async () => {
    const t = await make();
    let n = 0;
    t.app.setPublisher({ publish: async () => { n++; throw new Error('boom'); } });
    try {
      queueThree(t.app);
      await t.app.kick();
      await t.timers.advance(24 * 3600000); // publishing is once a day (Wai, 2026-11-17)
      await t.timers.advance(600000);
      return n === 2 || 'attempts ' + n;
    } finally { await t.stop(); }
  }],
  ['no key, token, hash or SH Labs key appears in the logs or the answers', async () => {
    const t = await make();
    try {
      await t.app.listen();
      t.app.setPublisher({ publish: async () => ({ ok: false, error: 'remote unreachable' }) });
      const a = await req(t.env.HM_SOCKET, 'POST', '/api/investigate', { key: KEY, body: JSON.stringify({ items: [item('Epsilon Band')] }) });
      await req(t.env.HM_SOCKET, 'GET', '/api/status', { key: 'nope' });
      await t.app.idle();
      await t.timers.advance(60000);
      const st = await req(t.env.HM_SOCKET, 'GET', '/api/status', { key: KEY });
      const seen = t.logs.join('\n') + a.text + st.text;
      if (!t.logs.length) return 'nothing logged at all';
      for (const s of [KEY, HASH, TOKEN, SHLABS]) if (seen.includes(s)) return 'secret leaked: ' + s.slice(0, 8);
      return true;
    } finally { await t.stop(); }
  }],
  ['close removes the socket file', async () => {
    const t = await make();
    const sock = t.env.HM_SOCKET;
    await t.app.listen();
    const was = existsSync(sock);
    await t.app.close();
    const gone = !existsSync(sock);
    await t.stop();
    return (was && gone) || `was ${was} gone ${gone}`;
  }],
]);
