import { runInContext } from 'vm';
import { load, run } from './load.mjs';
import { fakeClock, fakeStorage } from './fakes.mjs';

run([
  ['load returns a context synchronously, with ctx.HM', () => {
    const ctx = load(['src/core/text.js']);
    if (typeof ctx.then === 'function') return 'load returned a Promise';
    return typeof ctx.HM === 'object' || 'ctx.HM not set';
  }],
  ['load passes globals and console', () => {
    const ctx = load(['src/core/text.js'], { marker: 7 });
    return runInContext('typeof console.log === "function" && marker === 7', ctx) || 'missing';
  }],

  ['clock runs timeouts in time order', () => {
    const c = fakeClock(); const calls = [];
    c.setTimeout(() => calls.push('b'), 100);
    c.setTimeout(() => calls.push('a'), 50);
    c.tick(150);
    return calls.join() === 'a,b' || calls.join();
  }],
  ['clock equal times run in creation order', () => {
    const c = fakeClock(); const calls = [];
    c.setTimeout(() => calls.push(1), 10);
    c.setTimeout(() => calls.push(2), 10);
    c.tick(10);
    return calls.join() === '1,2' || calls.join();
  }],
  ['clock clearTimeout', () => {
    const c = fakeClock(); let hit = false;
    c.clearTimeout(c.setTimeout(() => { hit = true; }, 100));
    c.tick(200);
    return !hit || 'fired after clear';
  }],
  ['clock setInterval repeats until cleared', () => {
    const c = fakeClock(); let n = 0;
    const id = c.setInterval(() => n++, 100);
    c.tick(350);
    c.clearInterval(id);
    c.tick(500);
    return n === 3 || `n=${n}`;
  }],
  ['clock now() is the fire time inside a callback', () => {
    const c = fakeClock(); const seen = [];
    c.setTimeout(() => {
      seen.push(c.now());
      c.setTimeout(() => seen.push(c.now()), 50);
    }, 100);
    c.tick(500);
    return (seen.join() === '100,150' && c.now() === 500) || `${seen.join()} end ${c.now()}`;
  }],
  ['clock pending() back to 0', () => {
    const c = fakeClock();
    c.setTimeout(() => {}, 100);
    if (c.pending() !== 1) return `pending ${c.pending()}`;
    c.tick(150);
    return c.pending() === 0 || `pending ${c.pending()}`;
  }],
  ['clock zero interval does not loop forever', () => {
    const c = fakeClock(); let n = 0;
    c.setInterval(() => n++, 0);
    c.tick(5);
    return n === 5 || `n=${n}`;
  }],

  ['storage get string, array, null', async () => {
    const s = fakeStorage({ a: 1, b: 2 });
    const one = await s.get('a'); const two = await s.get(['a', 'b']); const all = await s.get(null);
    return (JSON.stringify([one, two, all]) === '[{"a":1},{"a":1,"b":2},{"a":1,"b":2}]') || JSON.stringify([one, two, all]);
  }],
  ['storage get omits missing keys', async () => {
    const r = await fakeStorage({}).get(['missing']);
    return JSON.stringify(r) === '{}' || JSON.stringify(r);
  }],
  ['storage values are copies', async () => {
    const s = fakeStorage({ u: { artists: ['A'] } });
    (await s.get('u')).u.artists.push('B');
    return (await s.get('u')).u.artists.length === 1 || 'storage mutated through get';
  }],
  ['storage set fires onChanged once with old and new values', async () => {
    const s = fakeStorage({ k: 'old' }); const fired = [];
    s.onChanged.addListener((changes, area) => fired.push([changes, area]));
    await s.set({ k: 'new' });
    return (fired.length === 1 && fired[0][1] === 'local' &&
      fired[0][0].k.oldValue === 'old' && fired[0][0].k.newValue === 'new') || JSON.stringify(fired);
  }],
]);
