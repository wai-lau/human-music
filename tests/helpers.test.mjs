import { load, run } from './load.mjs';
import { fakeClock, fakeStorage } from './fakes.mjs';

const cases = [];

// load test
cases.push(['load sets ctx.HM', async () => {
  const ctx = await load(['src/core/text.js']);
  if (ctx.HM === undefined) return 'ctx.HM not defined';
  return true;
}]);

// fakeClock tests
cases.push(['clock setTimeout order', () => {
  const clock = fakeClock();
  let calls = [];
  clock.setTimeout(() => calls.push('first'), 100);
  clock.setTimeout(() => calls.push('second'), 50);
  clock.tick(150);
  if (calls.join(',') !== 'second,first') return `wrong order: ${calls.join(',')}`;
  return true;
}]);

cases.push(['clock clearTimeout', () => {
  const clock = fakeClock();
  let called = false;
  const id = clock.setTimeout(() => called = true, 100);
  clock.clearTimeout(id);
  clock.tick(200);
  if (called) return 'timeout fired after clear';
  return true;
}]);

cases.push(['clock setInterval repeats', () => {
  const clock = fakeClock();
  let count = 0;
  const id = clock.setInterval(() => count++, 100);
  clock.tick(350);
  clock.clearInterval(id);
  if (count !== 3) return `expected 3 calls, got ${count}`;
  return true;
}]);

cases.push(['clock pending returns to 0', () => {
  const clock = fakeClock();
  const id = clock.setTimeout(() => {}, 100);
  if (clock.pending() !== 1) return `expected 1 pending, got ${clock.pending()}`;
  clock.tick(150);
  if (clock.pending() !== 0) return `expected 0 pending, got ${clock.pending()}`;
  return true;
}]);

// fakeStorage tests
cases.push(['storage get string', async () => {
  const store = fakeStorage({ key1: 'val1', key2: 'val2' });
  const result = await store.get('key1');
  if (result.key1 !== 'val1') return 'wrong value';
  return true;
}]);

cases.push(['storage get array', async () => {
  const store = fakeStorage({ key1: 'val1', key2: 'val2' });
  const result = await store.get(['key1', 'key2']);
  if (result.key1 !== 'val1' || result.key2 !== 'val2') return 'wrong values';
  return true;
}]);

cases.push(['storage get null returns all', async () => {
  const store = fakeStorage({ key1: 'val1', key2: 'val2' });
  const result = await store.get(null);
  if (result.key1 !== 'val1' || result.key2 !== 'val2') return 'wrong values';
  return true;
}]);

cases.push(['storage set fires onChanged', async () => {
  const store = fakeStorage({ key: 'old' });
  let fired = false;
  let oldValue = null;
  store.addListener((changes, area) => {
    if (changes.key && changes.key.newValue === 'new' && changes.key.oldValue === 'old') {
      fired = true;
      oldValue = changes.key.oldValue;
    }
  });
  await store.set({ key: 'new' });
  if (!fired) return 'onChanged not fired';
  return true;
}]);

run(cases);