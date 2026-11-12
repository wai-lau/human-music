// The skipper moves on exactly one song: YouTube Music's 'j' shortcut first, the Next
// button only if the same song is plainly still playing 750 ms later, a seek to the end
// at 1500 ms, giving up at 10 s. (tests/contract-skipper.check.mjs covers the full contract.)
import { load, run } from './load.mjs';
import { fakeClock } from './fakes.mjs';

const { skipper } = load(['src/core/skipper.js']).HM;

function makePage(clock, { keyMoves = false, nextMoves = false, dislikeMoves = false, playing = false, duration = 200 } = {}) {
  let song = { title: 'AI Song', artistLine: 'Listed Band • Album' };
  const calls = { key: 0, next: 0, dislike: 0, seeks: [] };
  const move = () => { song = { title: 'Next Song', artistLine: 'Some Person • Album' }; };
  return {
    calls,
    readSong: () => ({ ...song }),
    pressNextKey: () => { calls.key++; if (keyMoves) move(); },
    clickNext: () => { calls.next++; if (nextMoves) move(); return true; },
    clickDislike: () => { calls.dislike++; if (dislikeMoves) move(); return true; },
    videoDuration: () => duration,
    videoState: () => ({ time: playing ? clock.now() / 1000 : 0, paused: !playing }),
    seekTo: s => calls.seeks.push(s),
  };
}
const make = opts => {
  const clock = fakeClock();
  const page = makePage(clock, opts);
  const s = skipper.createSkipper({ page, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval });
  return { clock, page, s };
};

run([
  ['key moves on: no button, no seek', () => {
    const { clock, page, s } = make({ keyMoves: true, playing: true });
    s.skip({ dislikeFirst: false });
    const sync = page.calls.key === 1;
    clock.tick(10000);
    return sync && page.calls.next === 0 && page.calls.seeks.length === 0 && !s.busy() && clock.pending() === 0;
  }],
  ['key ignored, song still playing: button at 750 ms', () => {
    const { clock, page, s } = make({ nextMoves: true, playing: true });
    s.skip({ dislikeFirst: false });
    clock.tick(700);
    const none = page.calls.next === 0;
    clock.tick(100);
    return none && page.calls.next === 1 && (clock.tick(9000), page.calls.seeks.length === 0);
  }],
  ['key ignored, player stopped: no button, seek to the end at 1500 ms', () => {
    const { clock, page, s } = make({ playing: false });
    s.skip({ dislikeFirst: false });
    clock.tick(1400);
    const early = page.calls.seeks.length === 0;
    clock.tick(8600);
    return early && page.calls.next === 0 && JSON.stringify(page.calls.seeks) === '[200]' && clock.pending() === 0;
  }],
  ['dislike first; it moves on: no Next', () => {
    const { clock, page, s } = make({ dislikeMoves: true });
    s.skip({ dislikeFirst: true });
    clock.tick(10000);
    return page.calls.dislike === 1 && page.calls.key === 0 && page.calls.next === 0;
  }],
  ['dislike first; song stays: key at 2000 ms', () => {
    const { clock, page, s } = make({ keyMoves: true });
    s.skip({ dislikeFirst: true });
    clock.tick(1900);
    const none = page.calls.key === 0;
    clock.tick(200);
    return none && page.calls.key === 1;
  }],
  ['a second skip while busy is ignored', () => {
    const { clock, page, s } = make({});
    s.skip({ dislikeFirst: false });
    clock.tick(300);
    s.skip({ dislikeFirst: false });
    clock.tick(10000);
    return page.calls.key === 1 && page.calls.seeks.length === 1;
  }],
]);
