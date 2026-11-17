// The owner's commands against a temp database: the printed text and what lands in the store.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { runCli } from '../src/cli.mjs';
import { dbPath } from '../src/main.mjs';
import { openStore } from '../src/store.mjs';
import { buildList } from '../src/listjson.mjs';

const now = () => new Date('2026-11-16T12:00:00Z');
const verdict = (name, o = {}) => ({
  name, verdict: 'ai', confidence: 80, rawConfidence: 90, signals: ['deezer_ai_label'], reasons: ['why'], sources: ['https://s.example'],
  model: 'claude', checked: '2026-11-16', source: 'live', ...o,
});

function setup(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-cli-'));
  if (seed) { const s = openStore(dbPath(dir)); seed(s); s.close(); }
  const lines = [];
  const call = async (...argv) => {
    const code = await runCli(argv, { HM_DATA_DIR: dir, HM_DAILY_CAP: '' }, { out: (l) => lines.push(l), now });
    return { code, text: lines.splice(0).join('\n') };
  };
  const peek = (fn) => { const s = openStore(dbPath(dir)); try { return fn(s); } finally { s.close(); } };
  return { dir, call, peek, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const goodSamples = () => [
  ...Array.from({ length: 30 }, (_, i) => ({ raw: 90, truthAi: true, name: 'ai' + i })),
  ...Array.from({ length: 10 }, (_, i) => ({ raw: 40, truthAi: false, name: 'person' + i })),
];

await run([
  ['status prints queue, today against the cap, pause, last error and calibration', async () => {
    const t = setup((s) => { s.bump('2026-11-16'); s.setState('queue.lastError', 'limit: hit'); s.setState('queue.paused', 'limit: hit'); });
    try {
      const r = await t.call('status');
      const want = ['queued: 0', 'today: 1 of 100', 'paused: limit: hit', 'last error: limit: hit', 'calibrated: no'];
      return (r.code === 0 && want.every((w) => r.text.includes(w))) || r.code + ' ' + r.text;
    } finally { t.done(); }
  }],
  ['status on a fresh database says not paused, no error', async () => {
    const t = setup();
    try {
      const r = await t.call('status');
      return (r.text.includes('paused: no') && r.text.includes('last error: none')) || r.text;
    } finally { t.done(); }
  }],
  ['recheck puts a known artist back in the queue, deletes nothing', async () => {
    const t = setup((s) => s.putVerdict(verdict('Alpha Band', { spotifyId: 'a'.repeat(22) })));
    try {
      const r = await t.call('recheck', 'sp:' + 'a'.repeat(22));
      const kept = t.peek((s) => s.listPublishable().length);
      const st = await t.call('status');
      return (r.code === 0 && r.text.includes('Alpha Band') && kept === 1 && st.text.includes('queued: 1')) || r.code + ' ' + r.text + ' | ' + st.text;
    } finally { t.done(); }
  }],
  ['recheck of an unknown key, a malformed one or none fails with a message', async () => {
    const t = setup();
    try {
      const a = await t.call('recheck', 'sp:' + 'b'.repeat(22));
      const b = await t.call('recheck', 'nonsense');
      const c = await t.call('recheck');
      return (a.code === 1 && /no such artist/.test(a.text) && b.code === 1 && c.code === 1) || JSON.stringify([a, b, c]);
    } finally { t.done(); }
  }],
  ['calibrate prints the report from stored samples and stores the fit, not the mapping', async () => {
    const t = setup((s) => s.setState('calibration.samples', goodSamples()));
    try {
      const r = await t.call('calibrate');
      const got = t.peek((s) => ({ fit: s.getState('calibration.fit'), map: s.getState('calibration.mapping'), cal: s.getState('calibrated') }));
      const ok = r.text.includes('n known AI: 30') && r.text.includes('n known people: 10') && r.text.includes('wrong at 95: 0.0%') && /accept-calibration/.test(r.text);
      return (r.code === 0 && ok && got.fit && got.fit.ok === true && got.map === null && got.cal === null) || r.text + JSON.stringify(got);
    } finally { t.done(); }
  }],
  ['calibrate with no samples says so and is not ready', async () => {
    const t = setup();
    try {
      const r = await t.call('calibrate');
      return (r.code === 0 && /no calibration samples/.test(r.text) && /not ready/.test(r.text)) || r.text;
    } finally { t.done(); }
  }],
  ['accept-calibration refuses with no fit, and with a fit that is not ok', async () => {
    const t = setup((s) => s.setState('calibration.samples', [{ raw: 90, truthAi: true }]));
    try {
      const a = await t.call('accept-calibration');
      await t.call('calibrate');
      const b = await t.call('accept-calibration');
      const st = t.peek((s) => [s.getState('calibration.mapping'), s.getState('calibrated')]);
      return (a.code === 1 && b.code === 1 && st[0] === null && st[1] === null) || JSON.stringify([a, b, st]);
    } finally { t.done(); }
  }],
  ['accept-calibration stores the mapping, sets calibrated: true, and buildList then publishes it', async () => {
    const t = setup((s) => { s.setState('calibration.samples', goodSamples()); s.putVerdict(verdict('Alpha Band', { rawConfidence: 90, confidence: 60, signals: ['deezer_ai_label'], sources: ['https://www.deezer.com/a/1', 'https://open.spotify.com/a/2'] })); });
    try {
      await t.call('calibrate');
      const r = await t.call('accept-calibration');
      const got = t.peek((s) => ({
        map: s.getState('calibration.mapping'), cal: s.getState('calibrated'), stale: s.getState('publish.stale'),
        list: JSON.parse(buildList(s.listPublishable(), { now: now(), calibrated: s.getState('calibrated') === true, mapping: s.getState('calibration.mapping') })),
      }));
      return (r.code === 0 && got.map && got.map.ok === true && got.cal === true && got.stale === true && got.list.calibrated === true && got.list.artists[0].confidence === 95) || r.text + JSON.stringify(got);
    } finally { t.done(); }
  }],
  ['no command, or an unknown one, prints usage and exits 1', async () => {
    const t = setup();
    try {
      const a = await t.call();
      const b = await t.call('frobnicate');
      return (a.code === 1 && b.code === 1 && /usage/i.test(a.text) && /usage/i.test(b.text)) || JSON.stringify([a, b]);
    } finally { t.done(); }
  }],
  ['output carries no secret from the environment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-cli-'));
    const lines = [];
    try {
      const env = { HM_DATA_DIR: dir, HM_KEY_HASH: 'f'.repeat(64), CLAUDE_CODE_OAUTH_TOKEN: 'tok-secret-1', SHLABS_API_KEY: 'shl-secret-2' };
      await runCli(['status'], env, { out: (l) => lines.push(l), now });
      return !/f{64}|tok-secret-1|shl-secret-2/.test(lines.join('\n')) || 'leaked';
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['calibrate-run investigates the sample with the chosen model, keeps the seed, and resumes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-cli-cal-'));
    try {
      const soa = join(dir, 'soa.json'); const people = join(dir, 'people.json');
      writeFileSync(soa, JSON.stringify({ artists: Array.from({ length: 60 }, (_, i) => ({ name: 'AI ' + i })) }));
      writeFileSync(people, JSON.stringify({ artists: Array.from({ length: 5 }, (_, i) => ({ name: 'P ' + i, firstRelease: 2021 })) }));
      const calls = [];
      let budget = 20;
      const investigate = async (a, e, o) => { calls.push([a.name, o.model]); if (budget-- <= 0) return { ok: false, kind: 'limit', detail: 'x' }; return { ok: true, answer: { verdict: a.name.startsWith('AI') ? 'ai' : 'human', confidence: 97, signals: ['deezer_ai_label'], reasons: ['r'], sources: ['https://a.test/1', 'https://b.test/2'] } }; };
      const lines = []; const out = (l) => lines.push(l);
      const env = { HM_DATA_DIR: dir };
      const args = ['calibrate-run', '--seed', '9', '--soul-over-ai', soa, '--people', people];
      const c1 = await runCli(args, env, { out, investigate });
      budget = 1000;
      const c2 = await runCli([...args, '--model', 'opus'], env, { out, investigate });
      const names = calls.map((c) => c[0]);
      const repeats = names.length - new Set(names).size;
      return (c1 === 2 && c2 === 0 && calls.every((c) => c[1] === 'opus') && repeats === 1 && lines.some((l) => /seed 9/.test(l)) && lines.some((l) => /55 of 55 done/.test(l))) || JSON.stringify({ c1, c2, calls: calls.length, repeats, lines });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],

]);
