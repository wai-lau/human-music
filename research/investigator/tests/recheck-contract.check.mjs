// Contract: monthly rechecks of the investigator's passes (Wai, 2026-11-20: "i want monthly
// rechecks on passes as they expire / And changes get pushed up to the list").
// A pass is a verdict that lets the song play: 'human' or 'unsure'. When one of the
// investigator's own passes (any model but 'list') is 30 days old or more, the service queues it
// again by itself, without waiting for a copy of the extension to send the artist. AI verdicts are
// not rechecked this way (they come back when the artist is next sent), and list verdicts never
// expire. A recheck that turns a pass into AI replaces the verdict, so the artist goes onto the
// published list at the next publish.
// Interface:
//   store.listDuePasses(day, limit) -> verdicts ('human' or 'unsure', model not 'list', checked on or
//     before day minus 30 days), oldest checked first, at most limit; each carries name and, when
//     stored, spotifyId and channelId.
//   src/main.mjs: at each slow tick, at most once per UTC day (state 'recheck.day' = YYYY-MM-DD),
//     queue.enqueue up to 20 due passes as { name, site: 'recheck', songs: [], playing: false,
//     spotifyId?, channelId? }.
// Run from research/investigator: node tests/recheck-contract.check.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { createApp } from '../src/main.mjs';
import { openStore } from '../src/store.mjs';
import { CODES } from '../src/checklist.mjs';

const HASH = hashKey(deriveKey('admin-secret'));
const T0 = new Date('2026-11-20T12:00:00Z').getTime();
const MIN = 60000, HOUR = 3600000;
const J = (v) => JSON.stringify(v);
const SP = 'S'.repeat(22);

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
const v = (name, o = {}) => ({ name, verdict: 'human', confidence: 95, rawConfidence: 95, signals: [], reasons: ['r'], sources: ['https://x.example/a'], model: 'claude-score', checked: '2026-11-20', source: 'live', ...o });

async function make({ verdicts = [], aiFor = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-recheck-'));
  const timers = new FakeTimers();
  const investigated = [];
  const pre = openStore(join(dir, 'investigator.db'));
  for (const x of verdicts) pre.putVerdict(x);
  pre.close();
  const signs = (ai) => { const s = Object.fromEntries(CODES.map((c) => [c, 'unknown'])); if (ai) { s.S2 = 'found'; s.M4 = 'found'; } return s; };
  const deps = {
    log: () => {}, timers, now: () => new Date(T0 + timers.at),
    cheapPass: async () => null,
    investigate: async (artist) => { investigated.push(artist.name); return { ok: true, checklist: { signs: signs(aiFor.includes(artist.name)), genres: ['pop'], sources: ['https://x.example/a', 'https://y.example/b'], summary: 's' } }; },
    publisher: { publish: async () => ({ ok: true, changed: true }) },
  };
  const env = { HM_KEY_HASH: HASH, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-AAAA1111BBBB2222', HM_DATA_DIR: dir, HM_SOCKET: join(dir, 's.sock') };
  const app = createApp(env, deps);
  await app.listen();
  const stop = async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, timers, investigated, stop };
}

await run([
  ['store.listDuePasses: old investigator passes only, oldest first, with their IDs', async () => {
    const s = openStore(':memory:');
    s.putVerdict(v('Old Human', { checked: '2026-10-01', spotifyId: SP }));
    s.putVerdict(v('Older Unsure', { verdict: 'unsure', confidence: 40, checked: '2026-09-15' }));
    s.putVerdict(v('Fresh Human', { checked: '2026-11-01' }));
    s.putVerdict(v('Old Ai', { verdict: 'ai', checked: '2026-09-01' }));
    s.putVerdict(v('Old List Pass', { model: 'list', checked: '2026-09-01' }));
    const due = s.listDuePasses('2026-11-20', 20);
    return (J(due.map((x) => x.name)) === J(['Older Unsure', 'Old Human']) && due[1].spotifyId === SP) || J(due.map((x) => [x.name, x.spotifyId]));
  }],
  ['the service queues due passes by itself at the next slow tick, and checks them again', async () => {
    const t = await make({ verdicts: [v('Old Human', { checked: '2026-10-01' }), v('Fresh Human'), v('Old Ai', { verdict: 'ai', checked: '2026-09-01' })] });
    try {
      await t.timers.advance(6 * MIN);
      await t.app.idle(); await t.timers.advance(MIN); await t.app.idle();
      return J(t.investigated) === J(['Old Human']) || J(t.investigated);
    } finally { await t.stop(); }
  }],
  ['at most once a day, and at most 20 a day', async () => {
    const many = Array.from({ length: 25 }, (_, i) => v(`Old ${String(i).padStart(2, '0')}`, { checked: '2026-10-01' }));
    const t = await make({ verdicts: many });
    try {
      for (let i = 0; i < 6; i++) { await t.timers.advance(5 * MIN); await t.app.idle(); }
      return t.investigated.length === 20 || 'investigated ' + t.investigated.length;
    } finally { await t.stop(); }
  }],
  ['a recheck that finds AI replaces the pass, so it is published', async () => {
    const t = await make({ verdicts: [v('Turned Ai', { checked: '2026-10-01' })], aiFor: ['Turned Ai'] });
    try {
      await t.timers.advance(6 * MIN);
      await t.app.idle(); await t.timers.advance(MIN); await t.app.idle();
      const pub = t.app.store.listPublishable().map((x) => [x.name, x.verdict]);
      return J(pub) === J([['Turned Ai', 'ai']]) || J(pub);
    } finally { await t.stop(); }
  }],
]);
