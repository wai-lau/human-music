// Contract: an earlier publish due time takes effect without a restart. Twice (2026-11-18 and
// 2026-11-20) the list had to go out early: setting 'publish.stale' and an earlier
// 'publish.dueAt' did nothing, because the service set its publish timer at start (or after a
// verdict) and never looked at the stored due time again; a restart was the only way.
// Wanted: at each slow tick (every 5 minutes), when 'publish.stale' is set and the stored
// 'publish.dueAt' is earlier than the pending timer's time, the timer is replaced by one for
// the stored time (now, if it is already past). Nothing else changes: the daily rhythm, the
// 10-minute retry after a failed push, and a stored due time that is later than the pending
// timer (it is ignored; the earlier one stands).
// Run from research/investigator: node tests/publish-now-contract.check.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { deriveKey, hashKey } from '../src/keys.mjs';
import { createApp } from '../src/main.mjs';

const HASH = hashKey(deriveKey('admin-secret'));
const T0 = new Date('2026-11-20T12:00:00Z').getTime();
const MIN = 60000, HOUR = 3600000;

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

async function make() {
  const dir = mkdtempSync(join(tmpdir(), 'hm-pub-'));
  const timers = new FakeTimers();
  const published = [];
  const env = { HM_KEY_HASH: HASH, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-AAAA1111BBBB2222', HM_DATA_DIR: dir, HM_SOCKET: join(dir, 's.sock') };
  const deps = {
    log: () => {},
    timers,
    now: () => new Date(T0 + timers.at),
    cheapPass: async () => ({ verdict: 'human', confidence: 90, signals: [], reasons: ['old releases'], sources: [] }),
    investigate: async () => ({ ok: false, kind: 'invalid', detail: 'unused' }),
    publisher: { publish: async (json) => { published.push(json); return { ok: true, changed: true }; } },
  };
  const app = createApp(env, deps);
  await app.listen();
  const stop = async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, timers, published, stop };
}
const verdictToday = async (t) => {
  t.app.queue.enqueue([{ name: 'Alpha Band', site: 'ytm', songs: [], playing: false }]);
  await t.app.kick(); await t.timers.advance(0); await t.timers.advance(0);
};

await run([
  ['an earlier stored due time (with publish.stale) publishes at the next slow tick, no restart', async () => {
    const t = await make();
    try {
      await verdictToday(t); // a timer for a day from now
      await t.timers.advance(HOUR);
      if (t.published.length !== 0) return 'published before asked: ' + t.published.length;
      t.app.store.setState('publish.stale', true);
      t.app.store.setState('publish.dueAt', new Date(T0 + t.timers.at).toISOString());
      await t.timers.advance(6 * MIN);
      return t.published.length === 1 || 'publishes after asking: ' + t.published.length;
    } finally { await t.stop(); }
  }],
  ['without publish.stale an earlier stored due time changes nothing (the daily rhythm holds)', async () => {
    const t = await make();
    try {
      await verdictToday(t);
      await t.timers.advance(HOUR);
      t.app.store.setState('publish.dueAt', new Date(T0 + t.timers.at).toISOString());
      await t.timers.advance(10 * MIN);
      return t.published.length === 0 || 'published without stale: ' + t.published.length;
    } finally { await t.stop(); }
  }],
  ['a later stored due time never pushes the pending publish back', async () => {
    const t = await make();
    try {
      await verdictToday(t); // due in 24 hours
      t.app.store.setState('publish.stale', true);
      t.app.store.setState('publish.dueAt', new Date(T0 + t.timers.at + 48 * HOUR).toISOString());
      await t.timers.advance(24 * HOUR + 6 * MIN);
      return t.published.length === 1 || 'publishes by the original time: ' + t.published.length;
    } finally { await t.stop(); }
  }],
  ['after the early publish, the next one is a day later, not sooner', async () => {
    const t = await make();
    try {
      await verdictToday(t);
      t.app.store.setState('publish.stale', true);
      t.app.store.setState('publish.dueAt', new Date(T0 + t.timers.at).toISOString());
      await t.timers.advance(6 * MIN);
      if (t.published.length !== 1) return 'early publish: ' + t.published.length;
      await verdictToday(t);
      await t.timers.advance(20 * HOUR);
      return t.published.length === 1 || 'published again within a day: ' + t.published.length;
    } finally { await t.stop(); }
  }],
]);
