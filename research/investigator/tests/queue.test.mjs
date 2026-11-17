import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';

const art = (name, o = {}) => ({ name, site: 'ytm', songs: [{ title: 'S', album: '', artUrl: '' }], playing: false, ...o });
const verdict = (name, o = {}) => ({
  name, verdict: 'human', confidence: 80, rawConfidence: 80, signals: [], reasons: [], sources: [],
  model: 'm', checked: '2026-11-16', source: 'live', ...o,
});
const clock = (iso) => { const c = { t: new Date(iso), now: () => c.t }; return c; };
const names = (q, n) => { const out = []; for (let i = 0; i < n; i++) { const a = q.next(); out.push(a && a.name); } return out; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b) || JSON.stringify(a);

function setup(cap = 100, iso = '2026-11-16T12:00:00Z') {
  const store = openStore(':memory:');
  const c = clock(iso);
  const q = createQueue({ store, now: c.now, cap });
  return { store, c, q };
}

await run([
  ['the playing artist overtakes three waiting ones', () => {
    const { q } = setup();
    q.enqueue([art('W1'), art('W2'), art('W3')]);
    q.enqueue([art('P', { playing: true })]);
    return same(names(q, 5), ['P', 'W1', 'W2', 'W3', null]);
  }],
  ['otherwise first in, first out; counts are returned', () => {
    const { q } = setup();
    const r = q.enqueue([art('A'), art('B')]);
    return (r.queued === 2 && r.known === 0 && r.again === 0 && same(names(q, 2), ['A', 'B'])) || JSON.stringify(r);
  }],
  ['a known artist counts as known and is not queued', () => {
    const { q, store } = setup();
    store.putVerdict(verdict('Known Act'));
    const r = q.enqueue([art('Known Act'), art('New Act')]);
    return (r.queued === 1 && r.known === 1 && same(names(q, 2), ['New Act', null])) || JSON.stringify(r);
  }],
  ['known by ID matches too', () => {
    const { q, store } = setup();
    store.putVerdict(verdict('Old Name', { channelId: 'UCLeAbCdEfGhIjKlMnOpQrSt' }));
    const r = q.enqueue([art('New Name', { channelId: 'UCLeAbCdEfGhIjKlMnOpQrSt' })]);
    return r.known === 1 && r.queued === 0 || JSON.stringify(r);
  }],
  ['an unsure verdict 31 days old re-queues', () => {
    const { q, store } = setup(100, '2026-11-16T12:00:00Z');
    store.putVerdict(verdict('Old Unsure', { verdict: 'unsure', confidence: 30, checked: '2026-10-16' }));
    const r = q.enqueue([art('Old Unsure')]);
    return (r.queued === 1 && r.known === 0) || JSON.stringify(r);
  }],
  ['an unsure verdict 29 days old does not', () => {
    const { q, store } = setup(100, '2026-11-16T12:00:00Z');
    store.putVerdict(verdict('Fresh Unsure', { verdict: 'unsure', confidence: 30, checked: '2026-10-18' }));
    const r = q.enqueue([art('Fresh Unsure')]);
    return (r.queued === 0 && r.known === 1) || JSON.stringify(r);
  }],
  ['an old human or ai verdict never re-queues', () => {
    const { q, store } = setup();
    store.putVerdict(verdict('Old Human', { checked: '2020-01-01' }));
    store.putVerdict(verdict('Old Ai', { verdict: 'ai', confidence: 99, checked: '2020-01-01' }));
    const r = q.enqueue([art('Old Human'), art('Old Ai')]);
    return (r.queued === 0 && r.known === 2) || JSON.stringify(r);
  }],
  ['the same artist twice in a day is again', () => {
    const { q } = setup();
    q.enqueue([art('Twice')]);
    q.next();
    const r = q.enqueue([art('Twice')]);
    return (r.queued === 0 && r.again === 1) || JSON.stringify(r);
  }],
  ['repeated artists in one batch queue once', () => {
    const { q } = setup();
    const r = q.enqueue([art('Rep'), art('Rep'), art(' rep '), art('Other')]);
    return (r.queued === 2 && r.again === 2 && same(names(q, 3), ['Rep', 'Other', null])) || JSON.stringify(r);
  }],
  ['an artist already waiting in the queue is again', () => {
    const { q } = setup();
    q.enqueue([art('Wait')]);
    const r = q.enqueue([art('Wait')]);
    return (r.queued === 0 && r.again === 1 && q.status().queued === 1) || JSON.stringify(r);
  }],
  ['the next UTC day the same artist is accepted again', () => {
    const { q, c } = setup(100, '2026-11-16T23:59:00Z');
    q.enqueue([art('Daily')]);
    q.next();
    q.done('nm:daily');
    c.t = new Date('2026-11-17T00:01:00Z');
    const r = q.enqueue([art('Daily')]);
    return r.queued === 1 || JSON.stringify(r);
  }],
  ['the once-a-day record survives a new queue on the same store', () => {
    const { q, store, c } = setup();
    q.enqueue([art('Restart')]);
    q.next();
    const q2 = createQueue({ store, now: c.now, cap: 100 });
    const r = q2.enqueue([art('Restart')]);
    return (r.queued === 0 && r.again === 1) || JSON.stringify(r);
  }],
  ['after the cap next() is null and the queue is kept for tomorrow', () => {
    const { q, store, c } = setup(2, '2026-11-16T12:00:00Z');
    q.enqueue([art('A'), art('B'), art('C')]);
    store.bump('2026-11-16');
    if (q.next().name !== 'A') return 'first should be A';
    store.bump('2026-11-16');
    const blocked = q.next();
    const st = q.status();
    c.t = new Date('2026-11-17T00:05:00Z');
    const tomorrow = q.next();
    return (blocked === null && st.queued === 2 && st.today === 2 && st.cap === 2 && tomorrow && tomorrow.name === 'B') || JSON.stringify([blocked, st, tomorrow]);
  }],
  ['pause stops next() and status says why; resume restores', () => {
    const { q } = setup();
    q.enqueue([art('A')]);
    q.pause('login expired');
    const st = q.status();
    const blocked = q.next();
    q.resume();
    const after = q.next();
    return (blocked === null && st.paused === 'login expired' && st.lastError === 'login expired' && st.queued === 1 && q.status().paused === null && after && after.name === 'A') || JSON.stringify([blocked, st, after]);
  }],
  ['pause keeps accepting requests and loses nothing', () => {
    const { q } = setup();
    q.pause('usage limit');
    const r = q.enqueue([art('A'), art('B')]);
    q.resume();
    return (r.queued === 2 && same(names(q, 2), ['A', 'B'])) || JSON.stringify(r);
  }],
  ['requeue returns the artist first, even before a playing one', () => {
    const { q } = setup();
    q.enqueue([art('A'), art('B')]);
    const a = q.next();
    q.enqueue([art('P', { playing: true })]);
    q.requeue(a);
    return same(names(q, 3), ['A', 'P', 'B']);
  }],
  ['Claude down mid-run: take, requeue, pause, restart: nothing lost', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-queue-'));
    try {
      const path = join(dir, 'q.sqlite');
      const c = clock('2026-11-16T12:00:00Z');
      const s1 = openStore(path);
      const q1 = createQueue({ store: s1, now: c.now, cap: 100 });
      q1.enqueue([art('A'), art('B')]);
      const a = q1.next();
      q1.requeue(a);
      q1.pause('claude not logged in');
      s1.close();
      const s2 = openStore(path);
      const q2 = createQueue({ store: s2, now: c.now, cap: 100 });
      const st = q2.status();
      const blocked = q2.next();
      q2.resume();
      const got = names(q2, 3);
      s2.close();
      return (st.queued === 2 && st.paused === 'claude not logged in' && blocked === null && same(got, ['A', 'B', null]) === true) || JSON.stringify([st, blocked, got]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['a requeued artist is not blocked by the once-a-day record', () => {
    const { q } = setup();
    q.enqueue([art('A')]);
    const a = q.next();
    q.requeue(a);
    return q.status().queued === 1 && q.next().name === 'A';
  }],
  ['next returns the artist with its songs and flags', () => {
    const { q } = setup();
    q.enqueue([art('A', { playing: true, spotifyId: '2GRtAbCdEfGhIjKlMnOpQr' })]);
    const a = q.next();
    return (a.playing === true && a.spotifyId === '2GRtAbCdEfGhIjKlMnOpQr' && a.songs.length === 1) || JSON.stringify(a);
  }],
  ['take without done(), reopen the file: the same artist comes out first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-queue-'));
    try {
      const path = join(dir, 'q.sqlite');
      const c = clock('2026-11-16T12:00:00Z');
      const s1 = openStore(path);
      const q1 = createQueue({ store: s1, now: c.now, cap: 100 });
      q1.enqueue([art('A'), art('B'), art('P', { playing: true })]);
      const taken = q1.next();
      const mid = q1.status().queued;
      s1.close();
      const s2 = openStore(path);
      const q2 = createQueue({ store: s2, now: c.now, cap: 100 });
      const got = names(q2, 4);
      s2.close();
      return (taken.name === 'P' && mid === 2 && same(got, ['P', 'A', 'B', null]) === true) || JSON.stringify([taken, mid, got]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['done() removes it for good, also across a reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-queue-'));
    try {
      const path = join(dir, 'q.sqlite');
      const c = clock('2026-11-16T12:00:00Z');
      const s1 = openStore(path);
      const q1 = createQueue({ store: s1, now: c.now, cap: 100 });
      q1.enqueue([art('A'), art('B')]);
      const a = q1.next();
      q1.done('nm:a');
      const b = q1.next();
      s1.close();
      const s2 = openStore(path);
      const q2 = createQueue({ store: s2, now: c.now, cap: 100 });
      const got = names(q2, 2);
      s2.close();
      return (a.name === 'A' && b.name === 'B' && same(got, ['B', null]) === true) || JSON.stringify([a, b, got]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['done() on an unknown key is harmless', () => {
    const { q } = setup();
    q.enqueue([art('A')]);
    q.done('nm:nobody');
    return q.status().queued === 1;
  }],
  ['the once-a-day record does not block the artist returned after a crash', () => {
    const { q, store, c } = setup();
    q.enqueue([art('A')]);
    q.next();
    const q2 = createQueue({ store, now: c.now, cap: 100 });
    const again = q2.enqueue([art('A')]);
    const a = q2.next();
    return (again.again === 1 && a && a.name === 'A') || JSON.stringify([again, a]);
  }],
  ['an in-progress artist is not counted as waiting', () => {
    const { q } = setup();
    q.enqueue([art('A'), art('B')]);
    q.next();
    return q.status().queued === 1;
  }],
  ['status on an empty queue', () => {
    const { q } = setup(7);
    return same(q.status(), { queued: 0, today: 0, cap: 7, paused: null, lastError: null });
  }],
]);
