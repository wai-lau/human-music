// Errors reach the log (Wai, 2026-11-15: a log section for "errors"): a skip that doesn't
// take and a queue row that can't be removed. Uses a fake site, so only content.js is tested.
import { run, load } from './load.mjs';
import { makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const J = v => JSON.stringify(v);
const LISTED = { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating on Echoes', channelIds: [] };
const PERSON = { title: 'Real Song', artistLine: 'Real Person • Album', channelIds: [] };

function fakeSite({ song, queue = [], removes = true }) {
  const calls = { next: 0, remove: 0 };
  return {
    calls,
    site: {
      readSong: () => song, readQueue: () => queue, clickNext: () => { calls.next++; }, pressNextKey: () => { calls.next++; },
      clickDislike: () => false, videoDuration: () => NaN, videoState: () => null, seekTo: () => {},
      removeQueueRow: async () => { calls.remove++; return removes; }, mountPlayerButtons: () => null,
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
  return { app, clock, storage, log: () => storage.data['hm.log'] || [] };
}

run([
  ['a skip that doesn’t take (same song 10 s later) is logged once as skip-failed', async () => {
    const f = fakeSite({ song: LISTED });
    const { app, clock, log } = await start(f.site);
    for (let i = 0; i < 12; i++) await settle(clock, 1000);
    await app.flush();
    const events = log().map(e => e.event);
    const failed = log().find(e => e.event === 'skip-failed');
    return (events.filter(e => e === 'skip-failed').length === 1 && events.includes('skipped') && failed.title === 'Dust on the Wind' && failed.listName === 'Soul Over AI')
      || J(events);
  }],
  ['a skip that works logs no error', async () => {
    const f = fakeSite({ song: LISTED });
    f.site.pressNextKey = () => { f.site.readSong = () => PERSON; };
    const { app, clock, log } = await start(f.site);
    for (let i = 0; i < 12; i++) await settle(clock, 1000);
    await app.flush();
    return !log().some(e => e.event === 'skip-failed') || J(log().map(e => e.event));
  }],
  ['a row that can’t be removed is tried at most twice, 10 s apart, not on every check', async () => {
    const queue = [{ ...PERSON, selected: true }, { title: 'Let it Burn', artistLine: 'The Velvet Sundown • Dust and Silence', selected: false }];
    const f = fakeSite({ song: PERSON, queue, removes: false });
    const { app, clock } = await start(f.site);
    const first = f.calls.remove;
    for (let i = 0; i < 5; i++) await app.runLookahead(); // checks in quick succession
    const quick = f.calls.remove;
    await settle(clock, 11000);
    for (let i = 0; i < 5; i++) await app.runLookahead();
    const later = f.calls.remove;
    await settle(clock, 60000);
    for (let i = 0; i < 5; i++) await app.runLookahead();
    return (first === 1 && quick === 1 && later === 2 && f.calls.remove === 2) || J({ first, quick, later, end: f.calls.remove });
  }],
  ['a queue row that can’t be removed is logged as remove-failed, once a day', async () => {
    const queue = [{ ...PERSON, selected: true }, { title: 'Let it Burn', artistLine: 'The Velvet Sundown • Dust and Silence', selected: false }];
    const f = fakeSite({ song: PERSON, queue, removes: false });
    const { app, log } = await start(f.site);
    await app.runLookahead(); await app.runLookahead();
    await app.flush();
    const failed = log().filter(e => e.event === 'remove-failed');
    return (failed.length === 1 && failed[0].title === 'Let it Burn' && f.calls.remove >= 1) || J(log().map(e => e.event));
  }],
]);
