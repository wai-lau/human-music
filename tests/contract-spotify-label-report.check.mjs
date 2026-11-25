// Contract: the dev copy reports Spotify's "AI Persona" artists to the investigator (Wai,
// 2026-11-25: "auto add Spotify's AI labelled tracks to the Human Music Verdicts / add this as a
// layer in the investigator"). Run from the repo root: node tests/contract-spotify-label-report.check.mjs
//   content.js: a song, queue row or page item with aiTagged + aiTaggedIds (names and the Spotify
//     artist IDs from the artist links) reports each tagged artist with an ID as its own item
//     { credits: [name], channelIds: [id], spotifyAiLabel: true }, once per artist per page, even
//     though the label list already knows the artist (the unknown-only filter does not apply).
//     Without the investigate setting (every store copy) nothing is reported. No ID: nothing.
//   background.js createInvestigator.send: such an item is sent once a day, apart from the same
//     artist's ordinary report; the body carries spotifyAiLabel.
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

const ID1 = 'a'.repeat(22), ID2 = 'b'.repeat(22);
const TAGGED = { title: 'Dust', artistLine: 'Label Act', credits: ['Label Act'], channelIds: [ID1], aiTagged: ['Label Act'], aiTaggedIds: [ID1] };
const NOID = { title: 'Dust', artistLine: 'Idless Act', credits: ['Idless Act'], channelIds: [], aiTagged: ['Idless Act'], aiTaggedIds: [''] };
const ROW = { title: 'Next', artistLine: 'Row Act, Plain', credits: ['Row Act', 'Plain'], channelIds: [ID2], aiTagged: ['Row Act'], aiTaggedIds: [ID2], selected: false };

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];

async function start({ song, queue = [], investigate = true }) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const { HM } = ctx;
  const site = {
    readSong: () => song, readQueue: () => queue, clickNext() {}, pressNextKey() {}, clickDislike: () => false, videoDuration: () => NaN,
    videoState: () => null, seekTo() {}, removeQueueRow: async () => false, mountPlayerButtons: () => null,
    readPageItems: () => [], hideItem() {}, unhideAll() {}, readListRows: () => [], markRow() {}, unmarkRow() {},
  };
  const storage = fakeStorage({
    // The label list is on, so the artists are "known" to the extension.
    'hm.filterLists': [{ ...HM.lists.SPOTIFY_AI_LABEL, lastRefresh: 1 }],
    'hm.settings': { ...HM.settings.DEFAULTS, investigate, mode: 'lists', modeChosen: true },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const batches = [];
  const app = HM.createApp({ doc: makeDocument(), storage, timers: clock, now: () => 1_700_000_000_000 + clock.now(), site, onUnknown: items => batches.push(structuredClone(items)) });
  await app.start(); await settle(clock, 60);
  return { app, clock, items: () => batches.flat() };
}

await t('the playing tagged artist is reported with its ID and the flag', async () => {
  const r = await start({ song: TAGGED });
  const i = r.items().find(x => x.spotifyAiLabel) || {};
  return (r.items().length === 1 && i.spotifyAiLabel === true && J(i.credits) === J(['Label Act']) && J(i.channelIds) === J([ID1]) && i.site === 'spotify') || J(r.items());
});
await t('reported once, however many passes', async () => {
  const r = await start({ song: TAGGED });
  for (let k = 0; k < 3; k++) { await r.app.runLookahead(); await settle(r.clock, 1000); }
  return r.items().length === 1 || J(r.items());
});
await t('a tagged queue row in the window is reported, only its tagged artist', async () => {
  const r = await start({ song: { title: 'Now', artistLine: 'Someone', credits: ['Someone'], channelIds: [] }, queue: [{ title: 'Now', artistLine: 'Someone', credits: ['Someone'], channelIds: [], selected: true }, ROW] });
  await r.app.runLookahead(); await settle(r.clock, 1000);
  const labelled = r.items().filter(x => x.spotifyAiLabel);
  return (labelled.length === 1 && J(labelled[0].credits) === J(['Row Act']) && J(labelled[0].channelIds) === J([ID2])) || J(r.items());
});
await t('a tagged artist without an ID is not reported as labelled', async () => {
  const r = await start({ song: NOID });
  return r.items().filter(x => x.spotifyAiLabel).length === 0 || J(r.items());
});
await t('a store copy (investigate off) reports nothing', async () => {
  const r = await start({ song: TAGGED, queue: [{ ...TAGGED, selected: true }, ROW], investigate: false });
  await r.app.runLookahead(); await settle(r.clock, 1000);
  return r.items().length === 0 || J(r.items());
});

// --- the worker's sender -----------------------------------------------------------------
let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController, AbortSignal });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const NOON = new Date(2026, 10, 25, 12, 0, 0).getTime();
const mem = new Map([['investigator-token', 'tok']]);
const secrets = HM.createSecrets({ get: async k => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, remove: async k => { mem.delete(k); } });
function rig() {
  const calls = [];
  let clock = NOON;
  const inv = HM.createInvestigator({ storage: fakeStorage({ 'hm.investigator': {} }), secrets, fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 202 }; }, now: () => clock });
  return { inv, calls, day: () => { clock += 86400000; } };
}
const plain = { site: 'spotify', title: 'T', artistLine: 'Label Act', credits: ['Label Act'], album: '', artUrl: '', channelIds: [ID1] };
const label = { ...plain, spotifyAiLabel: true };

await t('send: the flag travels in the body', async () => {
  const r = rig(); const res = await r.inv.send([label]);
  return (res.sent === 1 && r.calls[0].items[0].spotifyAiLabel === true) || J({ res, calls: r.calls });
});
await t('send: a label report goes even after the same artist\'s ordinary report today', async () => {
  const r = rig(); await r.inv.send([plain]); const res = await r.inv.send([label]);
  return (res.sent === 1 && r.calls.length === 2) || J({ res, n: r.calls.length });
});
await t('send: a label report is sent once a day, and again the next day', async () => {
  const r = rig(); await r.inv.send([label]); const again = await r.inv.send([label]);
  r.day(); const next = await r.inv.send([label]);
  return (again.sent === 0 && next.sent === 1) || J({ again, next });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
