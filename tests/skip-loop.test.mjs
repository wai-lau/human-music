// The skip-loop breaker: a queue of only listed songs on repeat (or a radio full of them)
// would skip forever. After 6 skips within 20 s auto-skip rests for 60 s and one line goes to
// the log's Errors section; afterwards it works again. The player here moves to the next
// listed song as soon as Next is pressed.
import { run, load } from './load.mjs';
import { makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock, readLog } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const J = v => JSON.stringify(v);

function loopSite() {
  let n = 0;
  const calls = { next: 0 };
  const song = () => ({ title: `Made Song ${n}`, artistLine: 'The Velvet Sundown • Floating on Echoes', channelIds: [] });
  return {
    calls,
    site: {
      readSong: () => song(), readQueue: () => [],
      clickNext: () => {}, pressNextKey: () => { calls.next++; n++; },
      clickDislike: () => false, videoDuration: () => NaN, videoState: () => null, seekTo: () => {},
      removeQueueRow: async () => false, mountPlayerButtons: () => null,
      readPageItems: () => [], hideItem: () => {}, unhideAll: () => {},
    },
  };
}

async function start(site) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const doc = makeDocument();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now(), site });
  await app.start(); await settle(clock, 60);
  return { app, clock, log: () => readLog(storage) };
}

run([
  ['six skips in a row, then it rests and logs one skip-loop error', async () => {
    const f = loopSite();
    const { app, clock, log } = await start(f.site);
    for (let i = 0; i < 30; i++) { await settle(clock, 500); app.checkPlaying(); }
    await app.flush();
    const loops = (await log()).filter(e => e.event === 'skip-loop');
    return (f.calls.next === 6 && loops.length === 1) || J({ next: f.calls.next, events: (await log()).map(e => e.event) });
  }],
  ['the line is in the Errors section with neutral wording', async () => {
    const f = loopSite();
    const { app, clock, log } = await start(f.site);
    for (let i = 0; i < 30; i++) { await settle(clock, 500); app.checkPlaying(); }
    await app.flush();
    const e = (await log()).find(x => x.event === 'skip-loop');
    const ctx = load(['src/core/log.js']);
    return (e && ctx.HM.log.section('skip-loop') === 'errors' && !/slop|fake|garbage/i.test(ctx.HM.log.describe(e) + ctx.HM.log.action('skip-loop') + e.title)) || J(e);
  }],
  ['skipping works again once the minute is over', async () => {
    const f = loopSite();
    const { app, clock } = await start(f.site);
    for (let i = 0; i < 30; i++) { await settle(clock, 500); app.checkPlaying(); }
    const resting = f.calls.next;
    for (let i = 0; i < 20; i++) { await settle(clock, 5000); app.checkPlaying(); }
    await app.flush();
    return (resting === 6 && f.calls.next > 6) || J({ resting, after: f.calls.next });
  }],
]);
