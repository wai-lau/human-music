// Contract: every verdict is rechecked monthly (Wai, 2026-11-25: "everything should expire after 1
// month (adjustable) / but they should expire on, i.e. they are searched again after 1 month,
// remove if proven human, else just leave on the list if inconclusive or no bandwidth to
// investigate"). Replaces the exemption for list and Spotify-label verdicts and the AI exclusion
// of recheck-contract.check.mjs.
// Interface:
//   store.listDue(day, limit, days = 30) -> verdicts of any verdict word and any model (source
//     'live') whose checked date is days or more before day, and whose last recheck attempt
//     (verdict.recheckTried, 'YYYY-MM-DD', absent when none) is absent or at least
//     min(7, days) days before day. Oldest first; at most limit; a fair mix: about half AI and
//     half passes (human, unsure), the other side filling in when one runs short.
//   store.recheckStats(day, days = 30) -> { due, attempted, refreshed }: verdicts due now; verdicts
//     tried within the retry window whose old verdict was kept; verdicts a recheck replaced or
//     renewed in the last days days.
//   Nothing is dropped for age: listPublishable still returns an old verdict.
//   Worker: an artist taken from the queue that already has a verdict gets recheckTried = today.
//     A result of 'unsure' never overwrites a stored 'ai' or 'human' verdict (checked and the rest
//     stay as they were, still published). A human or ai result replaces it, with a fresh date.
//   main.mjs: the slow tick queues store.listDue (batch of 5) when the queue is empty and the
//     day's cap has room. HM_RECHECK_DAYS sets the age.
//   cli: `recheck-status` prints due, attempted-inconclusive and refreshed counts.
// Run from research/investigator: node tests/recheck-all-contract.check.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { createApp } from '../src/main.mjs';
import { openStore } from '../src/store.mjs';
import { CODES } from '../src/checklist.mjs';
import { runCli } from '../src/cli.mjs';

const HASH = hashKey(deriveKey('admin-secret'));
const T0 = new Date('2026-11-20T12:00:00Z').getTime();
const MIN = 60000;
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

async function make({ verdicts = [], aiFor = [], humanFor = [], failFor = [], env: extraEnv = {}, live = [], used = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-recheck-all-'));
  const timers = new FakeTimers();
  const investigated = [];
  const pre = openStore(join(dir, 'investigator.db'));
  for (const x of verdicts) pre.putVerdict(x);
  for (let i = 0; i < used; i++) pre.bump('2026-11-20');
  pre.close();
  const signs = (ai, human) => { const s = Object.fromEntries(CODES.map((c) => [c, 'unknown'])); if (ai) { s.S2 = 'found'; s.M4 = 'found'; } if (human) s.P5 = 'found'; return s; };
  const deps = {
    log: () => {}, timers, now: () => new Date(T0 + timers.at),
    cheapPass: async () => null,
    investigate: async (artist) => {
      investigated.push(artist.name);
      if (failFor.includes(artist.name)) return { ok: false, kind: 'invalid', detail: 'bad answer' };
      return { ok: true, checklist: { signs: signs(aiFor.includes(artist.name), humanFor.includes(artist.name)), genres: ['pop'], sources: ['https://x.example/a', 'https://y.example/b'], summary: 's' } };
    },
    publisher: { publish: async () => ({ ok: true, changed: true }) },
  };
  const env = { HM_KEY_HASH: HASH, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-AAAA1111BBBB2222', HM_DATA_DIR: dir, HM_SOCKET: join(dir, 's.sock'), ...extraEnv };
  const app = createApp(env, deps);
  if (live.length) app.queue.enqueue(live.map((name) => ({ name, site: 'ytm', songs: [], playing: false })));
  await app.listen();
  const stop = async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, timers, investigated, stop };
}

const settle = async (t) => { await t.timers.advance(6 * MIN); await t.app.idle(); await t.timers.advance(MIN); await t.app.idle(); };

await run([
  ['listDue: a 31-day-old list verdict and Spotify-label verdict are due; a 29-day-old one is not', async () => {
    const s = openStore(':memory:');
    s.putVerdict(v('Old List', { verdict: 'ai', model: 'list', confidence: 100, checked: '2026-10-20' }));
    s.putVerdict(v('Old Label', { verdict: 'ai', model: 'spotify-label', confidence: 100, spotifyId: SP, checked: '2026-10-20' }));
    s.putVerdict(v('Young List', { verdict: 'ai', model: 'list', confidence: 100, checked: '2026-10-22' }));
    const due = s.listDue('2026-11-20', 20).map((x) => x.name).sort();
    return J(due) === J(['Old Label', 'Old List']) || J(due);
  }],
  ['an old AI verdict stays on the published list while it is due', async () => {
    const t = await make({ verdicts: [v('Old Ai', { verdict: 'ai', checked: '2026-09-01' })], env: { HM_DAILY_CAP: '1' }, used: 1 });
    try {
      await t.timers.advance(20 * MIN); await t.app.idle();
      const due = t.app.store.listDue('2026-11-20', 5).map((x) => x.name);
      const pub = t.app.store.listPublishable().map((x) => x.name);
      return (J(due) === J(['Old Ai']) && J(pub) === J(['Old Ai']) && t.investigated.length === 0) || J({ due, pub, inv: t.investigated });
    } finally { await t.stop(); }
  }],
  ['a recheck that finds the artist human replaces the AI verdict, which leaves the published list', async () => {
    const t = await make({ verdicts: [v('Proven Human', { verdict: 'ai', checked: '2026-10-01' })], humanFor: ['Proven Human'] });
    try {
      await settle(t);
      const x = t.app.store.findVerdict(['nm:proven human']);
      const st = t.app.store.recheckStats('2026-11-20', 30);
      return (J(t.investigated) === J(['Proven Human']) && t.app.store.listPublishable().filter((p) => p.verdict === 'ai').length === 0 && x.verdict === 'human' && x.checked === '2026-11-20' && st.refreshed === 1 && st.due === 0) || J({ inv: t.investigated, x, st });
    } finally { await t.stop(); }
  }],
  ['a recheck that finds AI again keeps it, with a fresh date', async () => {
    const t = await make({ verdicts: [v('Still Ai', { verdict: 'ai', model: 'list', confidence: 100, checked: '2026-10-01' })], aiFor: ['Still Ai'] });
    try {
      await settle(t);
      const x = t.app.store.listPublishable()[0];
      return (x && x.verdict === 'ai' && x.checked === '2026-11-20') || J(x);
    } finally { await t.stop(); }
  }],
  ['a recheck that is unsure keeps the old AI verdict published and sets a retry date', async () => {
    const t = await make({ verdicts: [v('Unclear', { verdict: 'ai', confidence: 97, checked: '2026-10-01' })] });
    try {
      await settle(t);
      const x = t.app.store.listPublishable();
      const kept = x.length === 1 && x[0].verdict === 'ai' && x[0].confidence === 97 && x[0].checked === '2026-10-01' && x[0].recheckTried === '2026-11-20';
      const s = t.app.store;
      const early = s.listDue('2026-11-26', 5).length, later = s.listDue('2026-11-27', 5).length;
      const st = s.recheckStats('2026-11-20', 30);
      return (J(t.investigated) === J(['Unclear']) && kept && early === 0 && later === 1 && st.attempted === 1 && st.due === 0) || J({ inv: t.investigated, x, early, later, st });
    } finally { await t.stop(); }
  }],
  ['an unsure recheck of a made-by-people verdict keeps it too', async () => {
    const t = await make({ verdicts: [v('Quiet Human', { checked: '2026-10-01' })] });
    try {
      await settle(t);
      const x = t.app.store.findVerdict(['nm:quiet human']);
      return (x.verdict === 'human' && x.checked === '2026-10-01' && x.recheckTried === '2026-11-20') || J(x);
    } finally { await t.stop(); }
  }],
  ['a failed Claude run keeps the verdict and counts as an attempt', async () => {
    const t = await make({ verdicts: [v('Fails', { verdict: 'ai', checked: '2026-10-01' })], failFor: ['Fails'] });
    try {
      await settle(t);
      const x = t.app.store.findVerdict(['nm:fails']);
      return (x.verdict === 'ai' && x.checked === '2026-10-01' && x.recheckTried === '2026-11-20' && t.app.store.listPublishable().length === 1) || J(x);
    } finally { await t.stop(); }
  }],
  ['no recheck runs while the live queue has artists', async () => {
    const t = await make({ verdicts: [v('Old Ai', { verdict: 'ai', checked: '2026-09-01' })], live: ['Live A'] });
    try {
      await t.timers.advance(6 * MIN); await t.app.idle();
      return (!t.investigated.includes('Old Ai') && t.investigated.includes('Live A')) || J(t.investigated);
    } finally { await t.stop(); }
  }],
  ['no recheck runs once the day\'s cap is used', async () => {
    const t = await make({ verdicts: [v('Old Ai', { verdict: 'ai', checked: '2026-09-01' }), v('Old Human', { checked: '2026-09-01' })], env: { HM_DAILY_CAP: '2' }, used: 2 });
    try {
      for (let i = 0; i < 4; i++) { await t.timers.advance(5 * MIN); await t.app.idle(); }
      return t.investigated.length === 0 || J(t.investigated);
    } finally { await t.stop(); }
  }],
  ['a batch of 5 mixes AI and made-by-people verdicts, oldest first within each', async () => {
    const s = openStore(':memory:');
    for (let i = 0; i < 8; i++) s.putVerdict(v(`Ai ${i}`, { verdict: 'ai', checked: `2026-09-0${i + 1}` }));
    for (let i = 0; i < 8; i++) s.putVerdict(v(`Hu ${i}`, { checked: `2026-09-1${i}` }));
    const due = s.listDue('2026-11-20', 5).map((x) => x.name);
    const ai = due.filter((n) => n.startsWith('Ai ')), hu = due.filter((n) => n.startsWith('Hu '));
    return (due.length === 5 && ai.length >= 2 && hu.length >= 2 && ai[0] === 'Ai 0' && hu[0] === 'Hu 0') || J(due);
  }],
  ['the other side fills the batch when one runs short', async () => {
    const s = openStore(':memory:');
    s.putVerdict(v('Ai 0', { verdict: 'ai', checked: '2026-09-01' }));
    for (let i = 0; i < 8; i++) s.putVerdict(v(`Hu ${i}`, { checked: `2026-09-1${i}` }));
    return s.listDue('2026-11-20', 5).length === 5 || 'short batch';
  }],
  ['HM_RECHECK_DAYS sets the window for every kind of verdict', async () => {
    const t = await make({ verdicts: [v('Eight List', { verdict: 'ai', model: 'list', confidence: 100, checked: '2026-11-12' }), v('Six List', { verdict: 'ai', model: 'list', confidence: 100, checked: '2026-11-14' })], env: { HM_RECHECK_DAYS: '7' } });
    try {
      await settle(t);
      return J(t.investigated) === J(['Eight List']) || J(t.investigated);
    } finally { await t.stop(); }
  }],
  ['recheck-status prints due, attempted and refreshed counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hm-recheck-cli-'));
    try {
      const s = openStore(join(dir, 'investigator.db'));
      s.putVerdict(v('Due One', { verdict: 'ai', model: 'list', checked: '2026-09-01' }));
      s.putVerdict(v('Due Two', { checked: '2026-09-01' }));
      s.close();
      const lines = [];
      const code = await runCli(['recheck-status'], { HM_DATA_DIR: dir }, { out: (l) => lines.push(l), now: () => new Date(T0) });
      const text = lines.join('\n');
      return (code === 0 && /due: 2/.test(text) && /attempted, inconclusive: 0/.test(text) && /refreshed in the last \d+ days: 0/.test(text)) || text;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
]);
