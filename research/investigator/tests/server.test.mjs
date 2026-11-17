// The public gate: key check, body limit, CORS, routes. Real fetch on port 0.
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { parseRequest } from '../src/intake.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createServer } from '../src/server.mjs';

const KEY = deriveKey('admin-secret');
const HASH = hashKey(KEY);
const ORIGIN = 'chrome-extension://abcdefghijklmnop';
const auth = (k = KEY) => ({ Authorization: 'Bearer ' + k });
const item = (artist) => ({ title: 'Song', artistLine: artist, album: 'Al', artUrl: 'https://img.example/a.jpg' });
const body = (...names) => JSON.stringify({ items: names.map(item) });
const verdict = (name, o = {}) => ({
  name, verdict: 'human', confidence: 80, rawConfidence: 80, signals: [], reasons: ['why'], sources: ['https://s.example'],
  model: 'm', checked: '2026-11-16', source: 'live', ...o,
});

async function start() {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => new Date('2026-11-16T12:00:00Z'), cap: 100 });
  const state = { kicks: 0 };
  const server = createServer({
    keyHash: HASH, queue, store, intake: { parseRequest }, allowedOrigin: ORIGIN, kick: () => { state.kicks++; },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((r) => { server.closeAllConnections(); server.close(r); store.close(); });
  return { url, store, queue, state, stop };
}

async function withServer(fn) {
  const s = await start();
  try { return await fn(s); } finally { await s.stop(); }
}

const post = (s, path, b, headers = auth()) => fetch(s.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: b });
const text = async (r) => r.status + ' ' + await r.text();

await run([
  ['missing, wrong, empty, malformed, shorter, longer and non-ASCII keys: same 401 and body', () => withServer(async (s) => {
    const heads = [
      {}, auth('wrong'), { Authorization: 'Bearer ' }, { Authorization: 'Bearer' }, { Authorization: KEY },
      { Authorization: 'bearer ' + KEY }, auth(KEY.slice(1)), auth(KEY + 'a'), auth('é'.repeat(5000)),
      { Authorization: 'Bearer ' + HASH },
    ];
    const seen = new Set();
    for (const h of heads) {
      for (const [m, p] of [['POST', '/api/investigate'], ['GET', '/api/status'], ['POST', '/api/recheck'], ['GET', '/verdicts/nm:x'], ['GET', '/nothing']]) {
        const r = await fetch(s.url + p, { method: m, headers: h, body: m === 'POST' ? body('A') : undefined });
        seen.add(await text(r));
      }
    }
    if (seen.size !== 1) return 'answers differ: ' + [...seen].join(' | ');
    const [only] = seen;
    return only.startsWith('401 ') ? true : only;
  })],
  ['a wrong key queues nothing and does not kick', () => withServer(async (s) => {
    await post(s, '/api/investigate', body('A'), auth('nope'));
    return s.queue.status().queued === 0 && s.state.kicks === 0 || 'queued or kicked';
  })],
  ['right key: 202 with counts, kick called once', () => withServer(async (s) => {
    const r = await post(s, '/api/investigate', body('A', 'B'));
    const j = await r.json();
    return r.status === 202 && j.queued === 2 && j.known === 0 && j.again === 0 && s.state.kicks === 1 || r.status + JSON.stringify(j) + s.state.kicks;
  })],
  ['the same artist again is counted as again', () => withServer(async (s) => {
    await post(s, '/api/investigate', body('A'));
    const j = await (await post(s, '/api/investigate', body('A'))).json();
    return j.again === 1 && j.queued === 0 || JSON.stringify(j);
  })],
  ['100 KB body: 413, nothing queued', () => withServer(async (s) => {
    const big = JSON.stringify({ items: [{ title: 'x'.repeat(100000), artistLine: 'A' }] });
    const r = await post(s, '/api/investigate', big);
    return r.status === 413 && s.queue.status().queued === 0 && s.state.kicks === 0 || r.status;
  })],
  ['a 3 MB streamed body is cut off: 413 or a closed socket, nothing queued', () => withServer(async (s) => {
    let n = 0;
    const r = await fetch(s.url + '/api/investigate', {
      method: 'POST', headers: auth(), duplex: 'half',
      body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65536).fill(97)); if (++n > 48) c.close(); } }),
    }).catch(() => ({ status: 'closed' }));
    return (r.status === 413 || r.status === 'closed') && s.queue.status().queued === 0 || r.status;
  })],
  ['21 items: 413', () => withServer(async (s) => {
    const r = await post(s, '/api/investigate', body(...Array.from({ length: 21 }, (_, i) => 'Artist ' + i)));
    return r.status === 413 && s.queue.status().queued === 0 || r.status;
  })],
  ['bad JSON: 400', () => withServer(async (s) => (await post(s, '/api/investigate', '{nope')).status === 400 || 'not 400')],
  ['status shows paused and the reason', () => withServer(async (s) => {
    s.queue.pause('claude logged out');
    const j = await (await fetch(s.url + '/api/status', { headers: auth() })).json();
    return j.paused === 'claude logged out' && j.lastError === 'claude logged out' && j.cap === 100 || JSON.stringify(j);
  })],
  ['preflight: allowed origin gets CORS headers, no key needed', () => withServer(async (s) => {
    const r = await fetch(s.url + '/api/investigate', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    const h = r.headers;
    return r.status === 204 && h.get('access-control-allow-origin') === ORIGIN
      && h.get('access-control-allow-headers') === 'Authorization, Content-Type'
      && h.get('access-control-allow-methods') === 'POST, GET' || r.status + [...h].join();
  })],
  ['preflight from another origin gets no CORS headers', () => withServer(async (s) => {
    for (const o of ['https://evil.example', undefined]) {
      const r = await fetch(s.url + '/api/investigate', { method: 'OPTIONS', headers: o ? { Origin: o } : {} });
      if ([...r.headers.keys()].some((k) => k.startsWith('access-control'))) return 'CORS header for ' + o;
    }
    return true;
  })],
  ['real responses: CORS only for the allowed origin', () => withServer(async (s) => {
    const ok = await fetch(s.url + '/api/status', { headers: { ...auth(), Origin: ORIGIN } });
    const bad = await fetch(s.url + '/api/status', { headers: { ...auth(), Origin: 'https://evil.example' } });
    const denied = await fetch(s.url + '/api/status', { headers: { Origin: ORIGIN } });
    return ok.headers.get('access-control-allow-origin') === ORIGIN
      && denied.status === 401 && denied.headers.get('access-control-allow-origin') === ORIGIN
      && ![...bad.headers.keys()].some((k) => k.startsWith('access-control')) || 'CORS wrong';
  })],
  ['GET /verdicts.json is 401 without a key and 404 with one', () => withServer(async (s) => {
    const a = await fetch(s.url + '/verdicts.json');
    const b = await fetch(s.url + '/verdicts.json', { headers: auth() });
    return a.status === 401 && b.status === 404 || a.status + ' ' + b.status;
  })],
  ['/verdicts/<key>: full record with scores behind the key, 404 for unknown', () => withServer(async (s) => {
    const id = s.store.putVerdict(verdict('Zed'));
    s.store.putScores(id, [{ trackId: 't1', probability: 0.2, label: 'human', generator: null, at: '2026-11-16' }]);
    const r = await fetch(s.url + '/verdicts/' + encodeURIComponent('nm:zed'), { headers: auth() });
    const j = await r.json();
    const miss = await fetch(s.url + '/verdicts/' + encodeURIComponent('nm:nobody'), { headers: auth() });
    return r.status === 200 && j.reasons[0] === 'why' && j.scores.length === 1 && miss.status === 404 || JSON.stringify(j);
  })],
  ['recheck: marks for re-queue, deletes nothing; unknown key 404; bad body 400', () => withServer(async (s) => {
    s.store.putVerdict(verdict('Zed', { verdict: 'unsure', confidence: 0, rawConfidence: 0 }));
    const r = await post(s, '/api/recheck', JSON.stringify({ key: 'nm:zed' }));
    const miss = await post(s, '/api/recheck', JSON.stringify({ key: 'nm:nobody' }));
    const bad = await post(s, '/api/recheck', '[]');
    return r.status === 202 && s.queue.status().queued === 1 && s.store.findVerdict(['nm:zed']) && s.state.kicks === 1
      && miss.status === 404 && bad.status === 400 || [r.status, miss.status, bad.status].join();
  })],
  ['unknown route with a key is 404', () => withServer(async (s) => (await fetch(s.url + '/x', { headers: auth() })).status === 404 || 'not 404')],
  ['the key and its hash never appear in responses or logs', () => withServer(async (s) => {
    const logs = [];
    const orig = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) { orig[m] = console[m]; console[m] = (...a) => logs.push(a.join(' ')); }
    const outs = [];
    try {
      for (const h of [auth(), {}, auth('wrong')]) {
        for (const p of ['/api/status', '/verdicts/nm:x', '/x']) outs.push(await text(await fetch(s.url + p, { headers: h })));
      }
      outs.push(await text(await post(s, '/api/investigate', '{nope')));
      outs.push(await text(await post(s, '/api/investigate', 'x'.repeat(100000))));
    } finally { for (const m of Object.keys(orig)) console[m] = orig[m]; }
    const all = outs.join('\n') + logs.join('\n');
    return !all.includes(KEY) && !all.includes(HASH) || 'leaked';
  })],
]);
