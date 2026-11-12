// Contract check for Task 4 (skipper). Run from the repo root:
//   node tests/contract-skipper.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const { skipper } = load(['src/core/skipper.js']).HM;
const fails = [];
const J = v => JSON.stringify(v);

// opts: next/key/dislike = 'moves' | 'ignored'; nextReturns (default true); duration: number | (now) => number;
// movesAt: ms when the song changes by itself; throwOn: method name that throws
function rig(opts = {}) {
  const clock = fakeClock();
  const calls = { next: 0, key: 0, dislike: 0, seeks: [] };
  let song = { title: 'A', artistLine: 'Band • Album' };
  const moveOn = () => { song = { title: 'B', artistLine: 'Other • Album' }; };
  const maybeThrow = name => { if (opts.throwOn === name) throw new Error('boom'); };
  if (opts.movesAt) clock.setTimeout(moveOn, opts.movesAt);
  const page = {
    readSong: () => (opts.nullSong ? null : { ...song }),
    clickNext: () => { calls.next++; maybeThrow('clickNext'); if (opts.nextReturns === false) return false; if (opts.next === 'moves') moveOn(); return true; },
    pressNextKey: () => { calls.key++; maybeThrow('pressNextKey'); if (opts.key === 'moves') moveOn(); },
    clickDislike: () => { calls.dislike++; maybeThrow('clickDislike'); if (opts.dislike === 'moves') moveOn(); return opts.dislikeReturns !== false; },
    videoDuration: () => (typeof opts.duration === 'function' ? opts.duration(clock.now()) : opts.duration ?? 200),
    seekTo: s => calls.seeks.push(s),
  };
  const s = skipper.createSkipper({ page, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  return { clock, calls, s };
}
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

t('next moves on: one click, no seek, idle after', () => {
  const { clock, calls, s } = rig({ next: 'moves' });
  s.skip({ dislikeFirst: false });
  if (calls.next !== 1) return `next ${calls.next} right after skip()`;
  clock.tick(10000);
  return (calls.next === 1 && J(calls.seeks) === '[]' && !s.busy() && clock.pending() === 0) || J({ calls, busy: s.busy(), pending: clock.pending() });
});
t('next ignored: seek exactly at 1500 ms, once', () => {
  const { clock, calls, s } = rig({ next: 'ignored', duration: 200 });
  s.skip({ dislikeFirst: false });
  clock.tick(1000); if (J(calls.seeks) !== '[]') return `seeked by 1000: ${J(calls.seeks)}`;
  clock.tick(499); if (J(calls.seeks) !== '[]') return `seeked by 1499: ${J(calls.seeks)}`;
  clock.tick(101); if (J(calls.seeks) !== '[200]') return `not [200] by 1600: ${J(calls.seeks)}`;
  clock.tick(9000);
  return (J(calls.seeks) === '[200]' && clock.pending() === 0 && !s.busy()) || J({ seeks: calls.seeks, pending: clock.pending(), busy: s.busy() });
});
t('duration NaN until 2000 then 180', () => {
  const { clock, calls, s } = rig({ next: 'ignored', duration: now => (now < 2000 ? NaN : 180) });
  s.skip({ dislikeFirst: false });
  clock.tick(5000);
  return J(calls.seeks) === '[180]' || J(calls.seeks);
});
t('never loads: no seek, no timers after 10 s', () => {
  const { clock, calls, s } = rig({ next: 'ignored', duration: NaN });
  s.skip({ dislikeFirst: false });
  clock.tick(10000);
  return (J(calls.seeks) === '[]' && clock.pending() === 0 && !s.busy()) || J({ seeks: calls.seeks, pending: clock.pending() });
});
t('Infinity duration never seeks', () => {
  const { clock, calls, s } = rig({ next: 'ignored', duration: Infinity });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return J(calls.seeks) === '[]' || J(calls.seeks);
});
t('no Next button: j key, synchronously', () => {
  const { clock, calls, s } = rig({ nextReturns: false, key: 'moves' });
  s.skip({ dislikeFirst: false });
  if (calls.key !== 1) return `key ${calls.key} right after skip()`;
  clock.tick(10000);
  return (calls.key === 1 && J(calls.seeks) === '[]') || J(calls);
});
t('Next found: j key never pressed', () => {
  const { clock, calls, s } = rig({ next: 'ignored' });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return calls.key === 0 || `key ${calls.key}`;
});
t('new song after the seek was due is not seeked', () => {
  const { clock, calls, s } = rig({ next: 'ignored', duration: now => (now < 2500 ? NaN : 200), movesAt: 2500 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return J(calls.seeks) === '[]' || J(calls.seeks);
});
t('dislike moves on: no Next', () => {
  const { clock, calls, s } = rig({ dislike: 'moves' });
  s.skip({ dislikeFirst: true });
  if (calls.dislike !== 1) return `dislike ${calls.dislike} right after skip()`;
  clock.tick(10000);
  return (calls.next === 0 && J(calls.seeks) === '[]') || J(calls);
});
t('dislike stays: Next at 2000 ms', () => {
  const { clock, calls, s } = rig({ dislike: 'ignored', next: 'moves' });
  s.skip({ dislikeFirst: true });
  clock.tick(1900); if (calls.next !== 0) return `next ${calls.next} by 1900`;
  clock.tick(200); if (calls.next !== 1) return `next ${calls.next} by 2100`;
  clock.tick(8000);
  return (calls.next === 1 && J(calls.seeks) === '[]') || J(calls);
});
t('dislike, nothing moves: Next then seek at 3500', () => {
  const { clock, calls, s } = rig({ dislike: 'ignored', next: 'ignored', duration: 200 });
  s.skip({ dislikeFirst: true });
  clock.tick(3400); if (J(calls.seeks) !== '[]') return `seeked by 3400: ${J(calls.seeks)}`;
  clock.tick(200);
  return (calls.next === 1 && J(calls.seeks) === '[200]') || J(calls);
});
t('no dislike button: Next at once', () => {
  const { calls, s } = rig({ dislikeReturns: false, next: 'moves' });
  s.skip({ dislikeFirst: true });
  return calls.next === 1 || `next ${calls.next} right after skip()`;
});
t('second skip while busy ignored', () => {
  const { clock, calls, s } = rig({ next: 'ignored' });
  s.skip({ dislikeFirst: false });
  if (!s.busy()) return 'not busy after skip()';
  clock.tick(500); s.skip({ dislikeFirst: false }); s.skip({ dislikeFirst: true });
  clock.tick(10000);
  return (calls.next === 1 && calls.dislike === 0 && J(calls.seeks) === '[200]') || J(calls);
});
t('skip works again after the song changed', () => {
  const { clock, calls, s } = rig({ next: 'moves' });
  s.skip({ dislikeFirst: false }); clock.tick(300);
  s.skip({ dislikeFirst: false });
  return calls.next === 2 || `next ${calls.next}`;
});
t('clickNext throws: counts as false, j pressed, no throw', () => {
  const { clock, calls, s } = rig({ throwOn: 'clickNext', key: 'moves' });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return calls.key === 1 || `key ${calls.key}`;
});
t('null song means not changed', () => {
  const { clock, calls, s } = rig({ nullSong: true, next: 'ignored', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return (clock.pending() === 0 && !s.busy()) || J({ calls, pending: clock.pending() });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
