// Contract check for the skipper. Run from the repo root:
//   node tests/contract-skipper.check.mjs   (tests/contracts.test.mjs runs them all)
// Next is YouTube Music's shortcut key first (Wai, 2026-11-12: "Use shortcut keys when
// possible"); the button only if the same song is plainly still playing 750 ms later;
// the seek to the end at 1500 ms; give up at 10 s.
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const { skipper } = load(['src/core/skipper.js']).HM;
const fails = [];
const J = v => JSON.stringify(v);

// opts: key / next / dislike = 'moves' | 'ignored'; nextReturns (default true); dislikeReturns;
// duration: number | (now) => number; movesAt: ms when the song changes by itself;
// throwOn: method name that throws; video: 'playing' | 'paused' | 'stalled' | 'none' (no videoState)
function rig(opts = {}) {
  const clock = fakeClock();
  const calls = { next: 0, key: 0, dislike: 0, seeks: [] };
  let song = { title: 'A', artistLine: 'Band • Album' };
  let blank = false; // key 'blanks': the player shows no song for a while after the key press
  const moveOn = () => { song = { title: 'B', artistLine: 'Other • Album' }; };
  const maybeThrow = name => { if (opts.throwOn === name) throw new Error('boom'); };
  if (opts.movesAt) clock.setTimeout(moveOn, opts.movesAt);
  const video = opts.video || 'paused';
  const page = {
    readSong: () => (opts.nullSong || blank ? null : { ...song }),
    clickNext: () => { calls.next++; maybeThrow('clickNext'); if (opts.nextReturns === false) return false; if (opts.next === 'moves') moveOn(); return true; },
    pressNextKey: () => { calls.key++; maybeThrow('pressNextKey'); if (opts.key === 'moves') moveOn(); if (opts.key === 'blanks') blank = true; },
    clickDislike: () => { calls.dislike++; maybeThrow('clickDislike'); if (opts.dislike === 'moves') moveOn(); return opts.dislikeReturns !== false; },
    videoDuration: () => (typeof opts.duration === 'function' ? opts.duration(clock.now()) : opts.duration ?? 200),
    seekTo: s => calls.seeks.push(s),
  };
  if (video !== 'none') {
    page.videoState = () => ({ time: video === 'playing' ? 30 + clock.now() / 1000 : 30, paused: video === 'paused' });
  }
  const s = skipper.createSkipper({ page, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  return { clock, calls, s };
}
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

t('key moves on: one key press, no button, no seek, idle after', () => {
  const { clock, calls, s } = rig({ key: 'moves', video: 'playing' });
  s.skip({ dislikeFirst: false });
  if (calls.key !== 1) return `key ${calls.key} right after skip()`;
  clock.tick(10000);
  return (calls.key === 1 && calls.next === 0 && J(calls.seeks) === '[]' && !s.busy() && clock.pending() === 0) || J({ calls, busy: s.busy(), pending: clock.pending() });
});
t('key ignored while the song plays on: button at 750 ms', () => {
  const { clock, calls, s } = rig({ key: 'ignored', next: 'moves', video: 'playing' });
  s.skip({ dislikeFirst: false });
  clock.tick(700); if (calls.next !== 0) return `button by 700: ${calls.next}`;
  clock.tick(100); if (calls.next !== 1) return `button by 800: ${calls.next}`;
  clock.tick(9200);
  return (calls.next === 1 && calls.key === 1 && J(calls.seeks) === '[]') || J(calls);
});
t('player stopped after the key: no button, seek at 1500 ms', () => {
  const { clock, calls, s } = rig({ key: 'ignored', video: 'paused', duration: 200 });
  s.skip({ dislikeFirst: false });
  clock.tick(1499); if (J(calls.seeks) !== '[]') return `seeked by 1499: ${J(calls.seeks)}`;
  clock.tick(101);
  clock.tick(9000);
  return (calls.next === 0 && J(calls.seeks) === '[200]' && clock.pending() === 0 && !s.busy()) || J(calls);
});
t('video not moving (stalled): no button', () => {
  const { clock, calls, s } = rig({ key: 'ignored', video: 'stalled' });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return calls.next === 0 || `button ${calls.next}`;
});
t('page cannot tell video state: no button, seek still runs', () => {
  const { clock, calls, s } = rig({ key: 'ignored', video: 'none', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return (calls.next === 0 && J(calls.seeks) === '[200]') || J(calls);
});
t('button and key both ignored while playing: one button, then seek once', () => {
  const { clock, calls, s } = rig({ key: 'ignored', next: 'ignored', video: 'playing', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return (calls.key === 1 && calls.next === 1 && J(calls.seeks) === '[200]') || J(calls);
});
t('duration NaN until 2000 then 180', () => {
  const { clock, calls, s } = rig({ key: 'ignored', duration: now => (now < 2000 ? NaN : 180) });
  s.skip({ dislikeFirst: false });
  clock.tick(5000);
  return J(calls.seeks) === '[180]' || J(calls.seeks);
});
t('never loads: no seek, no timers after 10 s', () => {
  const { clock, calls, s } = rig({ key: 'ignored', duration: NaN });
  s.skip({ dislikeFirst: false });
  clock.tick(10000);
  return (J(calls.seeks) === '[]' && clock.pending() === 0 && !s.busy()) || J({ seeks: calls.seeks, pending: clock.pending() });
});
t('Infinity duration never seeks', () => {
  const { clock, calls, s } = rig({ key: 'ignored', duration: Infinity });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return J(calls.seeks) === '[]' || J(calls.seeks);
});
t('new song after the seek was due is not seeked', () => {
  const { clock, calls, s } = rig({ key: 'ignored', duration: now => (now < 2500 ? NaN : 200), movesAt: 2500 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return J(calls.seeks) === '[]' || J(calls.seeks);
});
t('dislike moves on: no Next at all', () => {
  const { clock, calls, s } = rig({ dislike: 'moves' });
  s.skip({ dislikeFirst: true });
  if (calls.dislike !== 1) return `dislike ${calls.dislike} right after skip()`;
  clock.tick(10000);
  return (calls.key === 0 && calls.next === 0 && J(calls.seeks) === '[]') || J(calls);
});
t('dislike stays: key at 2000 ms', () => {
  const { clock, calls, s } = rig({ dislike: 'ignored', key: 'moves' });
  s.skip({ dislikeFirst: true });
  clock.tick(1900); if (calls.key !== 0) return `key ${calls.key} by 1900`;
  clock.tick(200); if (calls.key !== 1) return `key ${calls.key} by 2100`;
  clock.tick(8000);
  return (calls.key === 1 && calls.next === 0 && J(calls.seeks) === '[]') || J(calls);
});
t('dislike, nothing moves, player stopped: key at 2000, seek at 3500', () => {
  const { clock, calls, s } = rig({ dislike: 'ignored', key: 'ignored', video: 'paused', duration: 200 });
  s.skip({ dislikeFirst: true });
  clock.tick(3400); if (J(calls.seeks) !== '[]') return `seeked by 3400: ${J(calls.seeks)}`;
  clock.tick(200);
  return (calls.key === 1 && calls.next === 0 && J(calls.seeks) === '[200]') || J(calls);
});
t('no dislike button: key at once', () => {
  const { calls, s } = rig({ dislikeReturns: false, key: 'moves' });
  s.skip({ dislikeFirst: true });
  return calls.key === 1 || `key ${calls.key} right after skip()`;
});
t('second skip while busy ignored', () => {
  const { clock, calls, s } = rig({ key: 'ignored', video: 'paused' });
  s.skip({ dislikeFirst: false });
  if (!s.busy()) return 'not busy after skip()';
  clock.tick(500); s.skip({ dislikeFirst: false }); s.skip({ dislikeFirst: true });
  clock.tick(10000);
  return (calls.key === 1 && calls.dislike === 0 && J(calls.seeks) === '[200]') || J(calls);
});
t('skip works again after the song changed', () => {
  const { clock, calls, s } = rig({ key: 'moves' });
  s.skip({ dislikeFirst: false }); clock.tick(300);
  s.skip({ dislikeFirst: false });
  return calls.key === 2 || `key ${calls.key}`;
});
t('pressNextKey throws: no throw, seek still runs', () => {
  const { clock, calls, s } = rig({ throwOn: 'pressNextKey', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return J(calls.seeks) === '[200]' || J(calls);
});
t('null song means not changed', () => {
  const { clock, calls, s } = rig({ nullSong: true, key: 'ignored', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return (clock.pending() === 0 && !s.busy()) || J({ calls, pending: clock.pending() });
});
// Review 2026-11-17 (page side, finding 5): between songs the player can show no title while
// the next (a person's) song already plays. An unreadable song is not "the same song": no
// second Next and no seek to the end of whatever is playing.
t('the player shows no song after the key press: no second Next, no seek', () => {
  const { clock, calls, s } = rig({ key: 'blanks', video: 'playing', duration: 200 });
  s.skip({ dislikeFirst: false }); clock.tick(10000);
  return (calls.key === 1 && calls.next === 0 && J(calls.seeks) === '[]' && clock.pending() === 0) || J({ calls, pending: clock.pending() });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
