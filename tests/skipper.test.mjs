import { load } from './load.mjs';
import { fakeClock } from './fakes.mjs';

function makePage(opts = {}) {
  const calls = { clickNext: [], pressNextKey: [], clickDislike: [], videoDuration: [], seekTo: [] };
  let song = { title: 'Song', artistLine: 'Artist' };
  let duration = opts.duration || NaN;
  let nextMovesOn = opts.nextMovesOn !== false;
  let hasDislikeButton = opts.hasDislikeButton !== false;
  let dislikeMovesOn = opts.dislikeMovesOn || false;
  let moveAt = opts.moveAt || null;
  let moveClock = null;

  function readSong() {
    if (moveAt !== null && moveClock !== null && moveClock.now() >= moveAt) {
      song = { title: 'Next Song', artistLine: 'Different Artist' };
    }
    return song;
  }

  return {
    calls,
    readSong,
    clickNext: function() {
      calls.clickNext.push({ song });
      if (nextMovesOn) song = { title: 'Next', artistLine: 'Artist' };
      return true;
    },
    pressNextKey: function() {
      calls.pressNextKey.push({ song });
      if (nextMovesOn) song = { title: 'Next', artistLine: 'Artist' };
    },
    clickDislike: function() {
      calls.clickDislike.push({ song });
      if (!hasDislikeButton) return false;
      if (dislikeMovesOn) song = { title: 'Disliked', artistLine: 'Artist' };
      return true;
    },
    videoDuration: function() {
      calls.videoDuration.push({});
      if (moveAt !== null && moveClock !== null && moveClock.now() >= moveAt) {
        return opts.movedDuration || duration;
      }
      return duration;
    },
    seekTo: function(sec) {
      calls.seekTo.push(sec);
    },
    setSong(s) { song = s; },
    setDuration(d) { duration = d; },
    setNextMovesOn(v) { nextMovesOn = v; },
    setHasDislikeButton(v) { hasDislikeButton = v; },
    setMoveClock(c) { moveClock = c; },
    setMoveAt(at) { moveAt = at; }
  };
}

const ctx = load(['src/core/skipper.js']);

const cases = [
  ['Next moves on', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200 });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1500);
    return page.calls.clickNext.length === 1 && page.calls.seekTo.length === 0;
  }],

  ['Next ignored, duration 200', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1000);
    const noSeekYet = page.calls.seekTo.length === 0;
    clock.tick(2000);
    return noSeekYet && page.calls.seekTo.length === 1 && page.calls.seekTo[0] === 200;
  }],

  ['Next ignored, duration delayed', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: NaN, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1500);
    clock.tick(500);
    page.setDuration(180);
    clock.tick(3000);
    return page.calls.seekTo.length === 1 && page.calls.seekTo[0] === 180;
  }],

  ['Next ignored, never loads', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: NaN, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(10000);
    return page.calls.seekTo.length === 0 && clock.pending() === 0 && !skipper.busy();
  }],

  ['clickNext returns false', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200 });
    page.clickNext = () => { page.calls.clickNext.push({}); return false; };
    page.pressNextKey = () => {
      page.calls.pressNextKey.push({});
      page.setSong({ title: 'Next', artistLine: 'Artist' });
    };
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1500);
    return page.calls.clickNext.length === 1 && page.calls.pressNextKey.length === 1 && page.calls.seekTo.length === 0;
  }],

  ['clickNext returns true', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(3000);
    return page.calls.clickNext.length === 1 && page.calls.pressNextKey.length === 0;
  }],

  ['Song moves before seek', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    page.setSong({ title: 'New', artistLine: 'Artist' });
    clock.tick(1500);
    return page.calls.seekTo.length === 0 && !skipper.busy();
  }],

  ['dislikeFirst, dislike moves on', async () => {
    const clock = fakeClock();
    const page = makePage({ dislikeMovesOn: true, duration: 200 });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: true });
    clock.tick(3000);
    return page.calls.clickDislike.length === 1 && page.calls.clickNext.length === 0 && page.calls.seekTo.length === 0;
  }],

  ['dislikeFirst, song stays, Next moves', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200 });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: true });
    clock.tick(1900);
    if (page.calls.clickNext.length !== 0) return 'Next called too early (1900ms)';
    clock.tick(200);
    if (page.calls.clickNext.length !== 1) return 'Next not called by 2100ms';
    clock.tick(1000);
    if (page.calls.seekTo.length !== 0) return 'Seek should not happen';
    return true;
  }],

  ['dislikeFirst, nothing moves, duration 200', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: true });
    clock.tick(3400);
    if (page.calls.clickNext.length !== 1) return 'Next not called';
    if (page.calls.seekTo.length !== 0) return 'Seek too early';
    clock.tick(200);
    if (page.calls.seekTo.length !== 1 || page.calls.seekTo[0] !== 200) return 'Seek not correct';
    return true;
  }],

  ['no dislike button -> Next synchronous', async () => {
    let called = false;
    const clock = fakeClock();
    const page = makePage({ duration: 200, hasDislikeButton: false });
    page.clickNext = () => { called = true; return true; };
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: true });
    if (!called) return 'clickNext not called synchronously';
    clock.tick(500);
    return true;
  }],

  ['moveAt: song changes at 2500ms, no seek', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: NaN, nextMovesOn: false, movedDuration: 200 });
    page.setMoveClock(clock);
    page.setMoveAt(2500);
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1500);
    clock.tick(1000);
    return page.calls.seekTo.length === 0;
  }],

  ['seek exactly 1500 ms after Next', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    clock.tick(1499);
    if (page.calls.seekTo.length !== 0) return 'Seek too early (1499ms)';
    clock.tick(101);
    if (page.calls.seekTo.length !== 1 || page.calls.seekTo[0] !== 200) return 'Seek not correct by 1600ms';
    return true;
  }],

  ['Busy ignored', async () => {
    const clock = fakeClock();
    const page = makePage({ duration: 200, nextMovesOn: false });
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    skipper.skip({ dislikeFirst: false });
    clock.tick(3000);
    return page.calls.clickNext.length === 1 && page.calls.seekTo.length === 1;
  }],

  ['clickNext synchronous', async () => {
    let called = false;
    const clock = fakeClock();
    const page = makePage({ duration: 200 });
    page.clickNext = () => { called = true; return true; };
    const skipper = ctx.HM.skipper.createSkipper({ page, ...clock });
    skipper.skip({ dislikeFirst: false });
    return called;
  }],
];

import { run } from './load.mjs';
run(cases);
