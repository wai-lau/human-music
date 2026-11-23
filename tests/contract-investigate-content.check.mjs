// Contract check for the investigator plan, Task 4 (the content script reports unknown artists
// and follows the mode). Uses a fake site, so only content.js is tested. Run from the repo root:
//   node tests/contract-investigate-content.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

const UNKNOWN = { title: 'Fresh', artistLine: 'Brand New Act • Debut', channelIds: [] };
const LISTED = { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating on Echoes', channelIds: [] };
const PERSON = { title: 'Real Song', artistLine: 'Real Person • Album', channelIds: [] }; // on Never skip: known
const ROW = { title: 'Row Song', artistLine: 'Row Act • Row Album', channelIds: [] };

// A row element the mark pass can mark and unmark.
const fakeEl = () => { const a = new Set(); return { a, hasAttribute: n => a.has(n), setAttribute: n => a.add(n), removeAttribute: n => a.delete(n) }; };

function fakeSite({ song, queue = [], rows = [], art }) {
  const calls = { next: 0 };
  const site = {
    readSong: () => song, readQueue: () => queue, clickNext: () => { calls.next++; }, pressNextKey: () => { calls.next++; },
    clickDislike: () => false, videoDuration: () => NaN, videoState: () => null, seekTo: () => {},
    removeQueueRow: async () => false, mountPlayerButtons: () => null,
    readPageItems: () => [], hideItem: () => {}, unhideAll: () => {},
    readListRows: () => rows, markRow: el => el.setAttribute('data-hm-marked'), unmarkRow: el => el.removeAttribute('data-hm-marked'),
  };
  if (art) site.readArt = () => art;
  return { site, calls };
}

async function start({ site, investigate = true, mode = 'lists', modeChosen = true, lookahead }) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const { HM } = ctx;
  const storage = fakeStorage({
    'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI, lastRefresh: 1 }, { ...HM.lists.HM_VERDICTS, lastRefresh: 1, calibrated: true }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.list.hm-verdicts': { artists: [{ name: 'Verdict Act', verdict: 'ai', confidence: 97 }, { name: 'Low Act', verdict: 'ai', confidence: 40 }], calibrated: true },
    'hm.settings': { ...HM.settings.DEFAULTS, investigate, mode, modeChosen, ...(lookahead === undefined ? {} : { lookahead }) },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: ['Real Person'] },
  });
  const clock = fakeClock();
  const doc = makeDocument();
  const batches = [];
  const app = HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now(), site, onUnknown: items => batches.push(structuredClone(items)) });
  await app.start(); await settle(clock, 60);
  const reported = () => batches.flat().flatMap(i => i.credits);
  return { HM, app, clock, storage, batches, reported };
}

await t('reports the unknown playing artist', async () => {
  const r = await start({ site: fakeSite({ song: UNKNOWN }).site });
  return J(r.reported()) === J(['Brand New Act']) || J(r.batches);
});
await t('a reported item carries title, artist line, credits, album, art and IDs', async () => {
  const r = await start({ site: fakeSite({ song: UNKNOWN, art: 'https://lh3.googleusercontent.com/x' }).site });
  const i = (r.batches.flat()[0]) || {};
  return (i.title === 'Fresh' && i.artistLine === 'Brand New Act • Debut' && J(i.credits) === J(['Brand New Act']) && i.album === 'Debut'
    && i.artUrl === 'https://lh3.googleusercontent.com/x' && Array.isArray(i.channelIds)) || J(i);
});
await t('no art reader: artUrl is empty', async () => {
  const r = await start({ site: fakeSite({ song: UNKNOWN }).site });
  const i = (r.batches.flat()[0]) || {};
  return i.artUrl === '' || J(i);
});
await t('unknown queue rows are reported once, however many passes', async () => {
  const queue = [{ ...PERSON, selected: true }, { ...ROW, selected: false }, { ...ROW, selected: false }];
  const r = await start({ site: fakeSite({ song: PERSON, queue }).site });
  for (let k = 0; k < 3; k++) { await r.app.runLookahead(); await settle(r.clock, 1000); }
  return J(r.reported()) === J(['Row Act']) || J(r.batches);
});
await t('known artists are not reported (listed, Never skip, any verdict at any confidence)', async () => {
  const queue = [{ ...PERSON, selected: true }, { title: 'Low', artistLine: 'Low Act • X', selected: false }, { ...LISTED, selected: false }];
  const r1 = await start({ site: fakeSite({ song: LISTED }).site });
  const r2 = await start({ site: fakeSite({ song: PERSON, queue }).site });
  await r2.app.runLookahead(); await settle(r2.clock, 1000);
  return (r1.reported().length === 0 && r2.reported().length === 0) || J({ r1: r1.batches, r2: r2.batches });
});
await t('nothing is reported without the investigate setting', async () => {
  const queue = [{ ...UNKNOWN, selected: true }, { ...ROW, selected: false }];
  const r = await start({ site: fakeSite({ song: UNKNOWN, queue }).site, investigate: false });
  await r.app.runLookahead(); await settle(r.clock, 1000);
  return r.batches.length === 0 || J(r.batches);
});
await t('a verdict at 97 blocks in Optimal; switching to List-only unmarks its row', async () => {
  const el = fakeEl();
  const rows = [{ el, title: 'V', credits: ['Verdict Act'], channelIds: [] }];
  const r = await start({ site: fakeSite({ song: PERSON, rows }).site, mode: 'optimal' });
  await settle(r.clock, 1000);
  const before = el.hasAttribute('data-hm-marked');
  await r.storage.set({ 'hm.settings': { ...r.storage.data['hm.settings'], mode: 'lists' } });
  await settle(r.clock, 1000); await settle(r.clock, 1000);
  const after = el.hasAttribute('data-hm-marked');
  return (before === true && after === false) || J({ before, after });
});
await t('a verdict at 40 does not block in Optimal; it does in Aggressive only at 60 or more', async () => {
  const el = fakeEl();
  const rows = [{ el, title: 'L', credits: ['Low Act'], channelIds: [] }];
  const r = await start({ site: fakeSite({ song: PERSON, rows }).site, mode: 'aggressive' });
  await settle(r.clock, 1000);
  return el.hasAttribute('data-hm-marked') === false || 'marked at 40 in Aggressive';
});await t('a queue row never carries the playing song\'s cover', async () => {
  const queue = [{ ...PERSON, selected: true }, { ...ROW, selected: false }];
  const r = await start({ site: fakeSite({ song: PERSON, queue, art: 'https://lh3.googleusercontent.com/playing' }).site });
  await r.app.runLookahead(); await settle(r.clock, 1000);
  const item = r.batches.flat().find(i => J(i.credits) === J(['Row Act'])) || {};
  return item.artUrl === '' || J(item);
});
await t('only queue rows in the lookahead window are reported', async () => {
  const queue = [{ ...PERSON, selected: true }, ...['One', 'Two', 'Three', 'Four', 'Five'].map(n => ({ title: n, artistLine: n + ' Act • X', selected: false }))];
  const r = await start({ site: fakeSite({ song: PERSON, queue }).site, lookahead: 3 }); // a window of 3 (the default is 10)
  for (let k = 0; k < 2; k++) { await r.app.runLookahead(); await settle(r.clock, 1000); }
  return J(r.reported().sort()) === J(['One Act', 'Three Act', 'Two Act']) || J(r.reported());
});
await t('calibration comes from the verdict list\'s meta (an unchosen mode turns Optimal on)', async () => {
  const el = fakeEl();
  const rows = [{ el, title: 'V', credits: ['Verdict Act'], channelIds: [] }];
  const r = await start({ site: fakeSite({ song: PERSON, rows }).site, mode: 'lists', modeChosen: false });
  await r.storage.set({ 'hm.list.hm-verdicts': { artists: r.storage.data['hm.list.hm-verdicts'].artists } }); // list data without the flag
  await settle(r.clock, 1000); await settle(r.clock, 1000);
  return el.hasAttribute('data-hm-marked') === true || 'not marked: the meta says calibrated';
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
