// Contract check: a second Next or the seek must not land on the next song when the title
// lags the player (the video is already a person's song), and the dislike wait acts only
// when the song is plainly still the same one (an unreadable title means don't act).
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const { skipper } = load(['src/core/skipper.js']).HM;
const fails = [];
const J = v => JSON.stringify(v);

// The title stays 'A' (it lags) while the video changes length at videoChangesAt.
function rig({ videoChangesAt = Infinity, blankAt = Infinity, src = false, sameLength = false } = {}) {
  const clock = fakeClock();
  const calls = { next: 0, key: 0, seeks: [] };
  const page = {
    readSong: () => (clock.now() >= blankAt ? null : { title: 'A', artistLine: 'Band • Album' }),
    clickNext: () => { calls.next++; },
    pressNextKey: () => { calls.key++; },
    clickDislike: () => true,
    videoDuration: () => (clock.now() >= videoChangesAt && !sameLength ? 305 : 200),
    videoState: () => ({ time: 30 + clock.now() / 1000, paused: false }),
    seekTo: s => calls.seeks.push(s),
  };
  if (src) page.videoSrc = () => (clock.now() >= videoChangesAt ? 'blob:two' : 'blob:one');
  const s = skipper.createSkipper({ page, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  return { clock, calls, s };
}
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

t('video length changed before the 750 ms button: no second Next', () => {
  const { clock, calls, s } = rig({ videoChangesAt: 500 });
  s.skip({ dislikeFirst: false });
  clock.tick(1000);
  return calls.next === 0 || J(calls);
});
t('video length changed before the 1500 ms seek: no seek', () => {
  const { clock, calls, s } = rig({ videoChangesAt: 1000 });
  s.skip({ dislikeFirst: false });
  clock.tick(3000);
  return J(calls.seeks) === '[]' || J(calls);
});
t('video source changed with the same length: no button, no seek', () => {
  const { clock, calls, s } = rig({ videoChangesAt: 300, src: true, sameLength: true });
  s.skip({ dislikeFirst: false });
  clock.tick(3000);
  return (calls.next === 0 && J(calls.seeks) === '[]') || J(calls);
});
t('same video still playing: the button and the seek still work', () => {
  const { clock, calls, s } = rig();
  s.skip({ dislikeFirst: false });
  clock.tick(1000);
  if (calls.next !== 1) return `button ${calls.next}`;
  clock.tick(1000);
  return J(calls.seeks) === '[200]' || J(calls.seeks);
});
t('dislike wait: an unreadable title after the dislike means no Next', () => {
  const { clock, calls, s } = rig({ blankAt: 1000 });
  s.skip({ dislikeFirst: true });
  clock.tick(2500);
  return (calls.key === 0 && calls.next === 0) || J(calls);
});
t('dislike wait: the same readable song still gets its Next', () => {
  const { clock, calls, s } = rig();
  s.skip({ dislikeFirst: true });
  clock.tick(2100);
  return calls.key === 1 || J(calls);
});

if (fails.length) { for (const f of fails) console.log('FAIL', f); process.exit(1); }
console.log('contract-skipper-lag: pass');
