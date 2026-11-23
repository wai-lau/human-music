// Contract: audio fingerprints from Wai's own copy (Wai, 2026-11-23: "A" — only her dev copy sends
// fingerprints of songs it plays and AI songs it skips; store copies never do; no audio leaves).
//
// extension/src/core/fingerprint.js (IIFE, sets HM.fingerprint): fakeprint(samples) -> Float32Array,
//   the same algorithm as research/investigator/src/fakeprint.mjs (read its comments; port it, no
//   imports): mono 44100 Hz in, 510 values out for 10 s or more. Listed in the manifest's YouTube
//   Music content_scripts before src/content.js.
// content.js: createApp gains an optional fingerprints option
//   { enabled: () => boolean, capture: (seconds, { mute }) => Promise<Float32Array | null>, send: (item) => void }
//   item = { title, artistLine, label: 'ai' | 'played', seconds, print: plain array of 510 numbers }.
//   With it enabled:
//   - A song that would be auto-skipped: capture(12, { mute: true }) first, then skip once it settles
//     (resolves, rejects or 20 s pass on the app's timers, whichever is first). Samples of 5 s or more
//     (44100 * 5) are sent with label 'ai' and seconds 12. If the playing song changed meanwhile:
//     no skip and nothing sent. The skip is logged as today.
//   - A playing song with no match (it plays on): capture(30, { mute: false }); if the same song is
//     still playing when it resolves, send label 'played', seconds 30.
//   - One capture at a time: while one runs, a song to skip is skipped at once, uncaptured.
//   Absent, or enabled() false: exactly today's behaviour (skip at once, no capture).
//   content.js wires it (real copy) as: enabled = the worker answered dev-mode true; capture =
//   HM.capture.record (written by the lead, not part of this task; call it only if it exists);
//   send = chrome.runtime.sendMessage({ type: 'hm-fingerprint', item }).
// background.js: createInvestigator(...).sendFingerprint(item) -> Promise<{ sent: 0 | 1 }>: POST
//   <base>/api/fingerprint, the same token, headers and fetch options as send() (Authorization Bearer,
//   JSON, redirect 'error', credentials 'omit', a timeout signal); no token or a non-https base: no
//   fetch, { sent: 0 }; a failed fetch or a status of 400+: { sent: 0 }, never throws. The worker's
//   onMessage handles { type: 'hm-fingerprint', item } only when isDev(): sendFingerprint(item).
// Run from the repo root: node tests/wip-contract-player-prints.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const golden = JSON.parse(readFileSync(process.cwd() + '/research/investigator/tests/fixtures/fakeprint-golden.json', 'utf8'));
function signal() {
  const N = golden.samples, SR = golden.sampleRate, x = new Float32Array(N);
  let s = golden.seed >>> 0;
  for (let n = 0; n < N; n++) {
    s ^= (s << 13) >>> 0; s >>>= 0; s ^= s >>> 17; s ^= (s << 5) >>> 0; s >>>= 0;
    const u = s / 2 ** 32;
    x[n] = 0.3 * Math.sin(2 * Math.PI * 440 * n / SR) + 0.1 * Math.sin(2 * Math.PI * 9000 * n / SR) + 0.05 * Math.sin(2 * Math.PI * 12345 * n / SR) + 0.02 * (u * 2 - 1);
  }
  return x;
}

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/core/fingerprint.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const LISTED = { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating on Echoes', channelIds: [] };
const OTHER = { title: 'Next One', artistLine: 'Somebody Else • X', channelIds: [] };
const UNKNOWN = { title: 'Fresh', artistLine: 'Brand New Act • Debut', channelIds: [] };

function fakeSite(box) {
  const calls = { next: 0 };
  const site = {
    readSong: () => box.song, readQueue: () => [], clickNext: () => { calls.next++; }, pressNextKey: () => { calls.next++; },
    clickDislike: () => false, videoDuration: () => NaN, videoState: () => ({ paused: false }), seekTo: () => {},
    removeQueueRow: async () => false, mountPlayerButtons: () => null,
    readPageItems: () => [], hideItem: () => {}, unhideAll: () => {}, readListRows: () => [], markRow: () => {}, unmarkRow: () => {},
  };
  return { site, calls };
}

// capture: 'ok' resolves with the golden signal (10 s), 'short' with 1 s, 'reject', 'hang' never settles.
async function start({ song, capture = 'ok', enabled = true, hook = true }) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const { HM } = ctx;
  const storage = fakeStorage({
    'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.settings': { ...HM.settings.DEFAULTS, autoSkip: true, autoDislike: false, investigate: false },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const box = { song };
  const { site, calls } = fakeSite(box);
  const captures = [], sent = [];
  let release = null;
  const fingerprints = {
    enabled: () => enabled,
    capture: (seconds, opts) => {
      captures.push({ seconds, mute: opts && opts.mute });
      if (capture === 'ok') return new Promise(r => { release = () => r(signal()); });
      if (capture === 'short') return Promise.resolve(new Float32Array(44100));
      if (capture === 'reject') return Promise.reject(new Error('no audio'));
      return new Promise(() => {});
    },
    send: item => sent.push(item),
  };
  const app = HM.createApp({ doc: makeDocument(), storage, timers: clock, now: () => 1_700_000_000_000 + clock.now(), site, ...(hook ? { fingerprints } : {}) });
  await app.start(); await settle(clock, 60);
  return { HM, app, clock, box, calls, captures, sent, release: () => release && release() };
}

await t('fakeprint() matches the Python reference on the golden signal (within 0.002)', async () => {
  const { HM } = load(['src/core/fingerprint.js']);
  const fp = HM.fingerprint.fakeprint(signal());
  if (fp.length !== golden.fakeprint.length) return `length ${fp.length}`;
  let worst = 0; golden.fakeprint.forEach((v, i) => { worst = Math.max(worst, Math.abs(fp[i] - v)); });
  return worst < 0.002 || `largest difference ${worst}`;
});
await t('manifest lists src/core/fingerprint.js before src/content.js for YouTube Music', async () => {
  const m = JSON.parse(readFileSync(process.cwd() + '/extension/manifest.json', 'utf8'));
  const js = m.content_scripts.find(c => c.matches.some(u => u.includes('music.youtube.com'))).js;
  return (js.indexOf('src/core/fingerprint.js') >= 0 && js.indexOf('src/core/fingerprint.js') < js.indexOf('src/content.js')) || J(js);
});
await t('a song to skip: captured muted for 12 s, then skipped, then sent as ai', async () => {
  const r = await start({ song: LISTED });
  const before = r.calls.next;
  r.release(); await settle(r.clock, 100); await settle(r.clock, 1000);
  const item = r.sent[0] || {};
  return (J(r.captures) === J([{ seconds: 12, mute: true }]) && before === 0 && r.calls.next >= 1 && r.sent.length === 1
    && item.label === 'ai' && item.seconds === 12 && item.title === LISTED.title && item.artistLine === LISTED.artistLine
    && Array.isArray(item.print) && item.print.length === 510 && Math.abs(item.print[0] - golden.fakeprint[0]) < 0.002) || J({ captures: r.captures, before, next: r.calls.next, sent: r.sent.length, item: { ...item, print: item.print && item.print.length } });
});
await t('capture fails or is short: skipped anyway, nothing sent', async () => {
  const a = await start({ song: LISTED, capture: 'reject' }); await settle(a.clock, 1000);
  const b = await start({ song: LISTED, capture: 'short' }); await settle(b.clock, 1000);
  return (a.calls.next >= 1 && a.sent.length === 0 && b.calls.next >= 1 && b.sent.length === 0) || J({ a: [a.calls.next, a.sent.length], b: [b.calls.next, b.sent.length] });
});
await t('capture never settles: skipped after 20 s, nothing sent', async () => {
  const r = await start({ song: LISTED, capture: 'hang' });
  await settle(r.clock, 19000); const early = r.calls.next;
  await settle(r.clock, 1500); await settle(r.clock, 1000);
  return (early === 0 && r.calls.next >= 1 && r.sent.length === 0) || J({ early, next: r.calls.next });
});
await t('the song changes during capture: no skip, nothing sent', async () => {
  const r = await start({ song: LISTED });
  r.box.song = OTHER; r.release(); await settle(r.clock, 100); await settle(r.clock, 1000);
  return (r.calls.next === 0 && r.sent.length === 0) || J({ next: r.calls.next, sent: r.sent.length });
});
await t('without the option, or enabled() false: skipped at once, no capture', async () => {
  const a = await start({ song: LISTED, hook: false });
  const b = await start({ song: LISTED, enabled: false });
  return (a.calls.next >= 1 && b.calls.next >= 1 && b.captures.length === 0) || J({ a: a.calls.next, b: b.calls.next, caps: b.captures });
});
await t('a song that plays on: captured unmuted for 30 s, sent as played', async () => {
  const r = await start({ song: UNKNOWN });
  r.release(); await settle(r.clock, 100);
  const item = r.sent[0] || {};
  return (J(r.captures) === J([{ seconds: 30, mute: false }]) && r.calls.next === 0 && r.sent.length === 1 && item.label === 'played' && item.seconds === 30 && item.title === 'Fresh') || J({ captures: r.captures, sent: r.sent.map(i => i.label) });
});
await t('a played capture whose song changed is not sent', async () => {
  const r = await start({ song: UNKNOWN });
  r.box.song = OTHER; r.release(); await settle(r.clock, 100);
  return r.sent.length === 0 || J(r.sent.map(i => i.title));
});
await t('a song to skip while a played capture runs: skipped at once, no second capture', async () => {
  const r = await start({ song: UNKNOWN });
  r.box.song = LISTED; await r.app.checkPlaying?.(); await settle(r.clock, 1000);
  return (r.captures.length === 1 && r.calls.next >= 1) || J({ captures: r.captures, next: r.calls.next });
});

// The worker side.
let wctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), wctx); };
wctx = load([], { importScripts, setTimeout, clearTimeout, AbortController, AbortSignal });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), wctx);
const W = wctx.HM;
const secretsWith = (token) => { const m = new Map(token ? [['investigator-token', token]] : []); return W.createSecrets({ get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } }); };
const ITEM = { title: 'S', artistLine: 'A', label: 'ai', seconds: 12, print: Array(510).fill(0.5) };
function rig({ token = 't0k', status = 202, base, fetchThrows = false } = {}) {
  const calls = [];
  const storage = fakeStorage({ 'hm.investigator': base ? { base } : {} });
  const fetch = async (url, init = {}) => { calls.push({ url, init }); if (fetchThrows) throw new Error('offline'); return { ok: status < 400, status, headers: { get: () => null }, text: async () => '{}', json: async () => ({}) }; };
  return { inv: W.createInvestigator({ storage, secrets: secretsWith(token), fetch, now: () => 1_700_000_000_000 }), calls };
}
await t('sendFingerprint posts the item with the token to <base>/api/fingerprint, safely', async () => {
  const r = rig();
  const res = await r.inv.sendFingerprint(ITEM);
  const c = r.calls[0] || { init: {} };
  const h = c.init.headers || {};
  return (res.sent === 1 && r.calls.length === 1 && c.url === 'https://wai-lau.net/human-music/api/fingerprint' && c.init.method === 'POST'
    && h.Authorization === 'Bearer t0k' && /json/.test(h['Content-Type'] || '') && c.init.redirect === 'error' && c.init.credentials === 'omit'
    && J(JSON.parse(c.init.body)) === J(ITEM) && !!c.init.signal) || J({ res, url: c.url, init: { ...c.init, body: undefined, signal: !!c.init.signal } });
});
await t('sendFingerprint: no token, http base, failed fetch or 4xx: { sent: 0 }, no throw', async () => {
  const a = rig({ token: '' }), b = rig({ base: 'http://x.example' }), c = rig({ fetchThrows: true }), d = rig({ status: 429 });
  const res = [await a.inv.sendFingerprint(ITEM), await b.inv.sendFingerprint(ITEM), await c.inv.sendFingerprint(ITEM), await d.inv.sendFingerprint(ITEM)];
  return (J(res.map(x => x.sent)) === J([0, 0, 0, 0]) && a.calls.length === 0 && b.calls.length === 0) || J({ res, a: a.calls.length, b: b.calls.length });
});
await t('the worker routes hm-fingerprint to sendFingerprint only in a dev copy', async () => {
  const src = readFileSync(process.cwd() + '/extension/src/background.js', 'utf8');
  const i = src.indexOf("'hm-fingerprint'");
  const near = i >= 0 ? src.slice(i, i + 400) : '';
  return (i >= 0 && /sendFingerprint/.test(near) && /waitDev|isDev/.test(near)) || 'no dev-gated hm-fingerprint route';
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
