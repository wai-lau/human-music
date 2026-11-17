import { run } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { createShLabs } from '../src/shlabs.mjs';

const GOOD = JSON.parse(readFileSync(new URL('./fixtures/shlabs-detect-response.json', import.meta.url), 'utf8'));
const KEY = 'sk_test_SECRETKEY123';
const T1 = '2JUDGXTQYGQZrVVUgq40Ke';
const T2 = '4Z8W4fKeB5YxbusRsdQVPb';
const tid = (i) => `trackIdNumber${String(i).padStart(9, '0')}`; // 22 chars

function fake({ status = 200, body = GOOD, bad = false } = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (bad) throw new SyntaxError(`bad json, key ${KEY}`); return body; },
    };
  };
  f.calls = calls;
  return f;
}
const sleeper = () => {
  const waits = [];
  const s = async (ms) => { waits.push(ms); };
  s.waits = waits;
  return s;
};
const make = (f, s, ...k) => createShLabs({ fetch: f, key: k.length ? k[0] : KEY, sleep: s, now: () => 1_700_000_000_000 });

run([
  ['a good response maps to the record', async () => {
    const f = fake();
    const out = await make(f, sleeper()).scoreTracks([T1]);
    if (out.length !== 1) return JSON.stringify(out);
    const r = out[0];
    if (r.trackId !== T1 || r.probability !== 97.4 || r.label !== 'Pure AI Generated' || r.generator !== 'Suno') return JSON.stringify(r);
    if (Number.isNaN(Date.parse(r.at))) return `at ${r.at}`;
    const c = f.calls[0];
    if (c.url !== 'https://shlabs.music/api/v1/detect' || c.opts.method !== 'POST') return c.url;
    if (c.opts.headers['X-API-Key'] !== KEY) return 'no key header';
    return JSON.parse(c.opts.body).spotifyTrackId === T1 || c.opts.body;
  }],
  ['a missing generator is null', async () => {
    const body = { result: { probability_ai_generated: 3, prediction: 'Human Made' } };
    const out = await make(fake({ body }), sleeper()).scoreTracks([T1]);
    return (out.length === 1 && out[0].generator === null) || JSON.stringify(out);
  }],
  ['with no key, fetch is never called', async () => {
    const f = fake();
    for (const k of [undefined, '', '   ']) {
      const out = await make(f, sleeper(), k).scoreTracks([T1]);
      if (out.length !== 0) return 'scored without a key';
    }
    return f.calls.length === 0 || `${f.calls.length} calls`;
  }],
  ['at most two tracks per call, one request each', async () => {
    const f = fake();
    const out = await make(f, sleeper()).scoreTracks([T1, T2, tid(3)]);
    return (out.length === 2 && f.calls.length === 2) || `${out.length} scores, ${f.calls.length} calls`;
  }],
  ['11 requests in a minute make sleep wait', async () => {
    const f = fake();
    const s = sleeper();
    const sh = make(f, s);
    for (let i = 0; i < 5; i++) await sh.scoreTracks([tid(i * 2), tid(i * 2 + 1)]);
    if (s.waits.length !== 0) return `waited early: ${s.waits}`;
    const out = await sh.scoreTracks([tid(10)]);
    if (out.length !== 1) return 'the 11th was dropped, not delayed';
    return (s.waits.length === 1 && s.waits[0] > 0 && s.waits[0] <= 60000) || JSON.stringify(s.waits);
  }],
  ['a 429 returns []', async () => {
    const out = await make(fake({ status: 429, body: { error: 'rate' } }), sleeper()).scoreTracks([T1, T2]);
    return out.length === 0 || JSON.stringify(out);
  }],
  ['a 400 skips that track without retry', async () => {
    const f = fake({ status: 400, body: { error: 'bad' } });
    const out = await make(f, sleeper()).scoreTracks([T1, T2]);
    return (out.length === 0 && f.calls.length === 2) || `${out.length} scores, ${f.calls.length} calls`;
  }],
  ['a 503 backs off once and retries', async () => {
    const f = fake({ status: 503, body: {} });
    const s = sleeper();
    const out = await make(f, s).scoreTracks([T1]);
    return (out.length === 0 && f.calls.length === 2 && s.waits.length === 1) || `${f.calls.length} calls, waits ${s.waits}`;
  }],
  ['bad JSON returns [] and nothing leaks the key', async () => {
    const out = await make(fake({ bad: true }), sleeper()).scoreTracks([T1]);
    return (Array.isArray(out) && out.length === 0 && !JSON.stringify(out).includes(KEY)) || JSON.stringify(out);
  }],
  ['a thrown fetch error does not escape or carry the key', async () => {
    const f = async () => { throw new Error(`connect failed with ${KEY}`); };
    try {
      const out = await make(f, sleeper()).scoreTracks([T1]);
      return out.length === 0 || JSON.stringify(out);
    } catch (e) {
      return `threw: ${String(e.message).includes(KEY) ? 'message has the key' : 'escaped'}`;
    }
  }],
  ['probability outside 0-100 is dropped', async () => {
    for (const p of [-1, 100.5, 'high', null, NaN]) {
      const body = { result: { probability_ai_generated: p, prediction: 'x' } };
      const out = await make(fake({ body }), sleeper()).scoreTracks([T1]);
      if (out.length !== 0) return `kept ${p}`;
    }
    return true;
  }],
  ['track IDs not matching 22 alphanumerics are skipped', async () => {
    const f = fake();
    const out = await make(f, sleeper()).scoreTracks(['short', `${T1}x`, 'bad id with spaces!!!!', 42, null, '../etc/passwd']);
    return (out.length === 0 && f.calls.length === 0) || `${out.length} scores, ${f.calls.length} calls`;
  }],
]);
