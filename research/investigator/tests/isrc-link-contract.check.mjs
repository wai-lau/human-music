// Contract: YouTube Music artists reach SH Labs through ISRCs (Wai, 2026-11-19, "3A" then "1A":
// song.link's public API is gone, so Deezer, with MusicBrainz by exact channel ID tried first).
// The link is used only to fetch songs for SH Labs and is NEVER stored: the saved verdict keeps
// only the IDs from the page (worker.mjs withIds).
//
// New file src/isrclink.mjs:
//   createIsrcLinker({ fetch }) -> { isrcsFor(artist) -> Promise<string[]> }   (0 or 2 ISRCs, never throws)
//   1. artist.channelId: MusicBrainz url lookup
//        GET https://musicbrainz.org/ws/2/url?resource=https://www.youtube.com/channel/<id>&inc=artist-rels&fmt=json
//      exactly one related artist -> GET https://musicbrainz.org/ws/2/artist/<mbid>?inc=url-rels&fmt=json
//      -> a relation url https://www.deezer.com/artist/<n> (www.deezer.com or deezer.com, any /xx/ locale) gives the Deezer artist.
//      MusicBrainz requests send the header User-Agent: human-music-investigator/0.1 (https://github.com/wai-lau/human-music)
//   2. Otherwise, for each of the artist's song titles (at most 3, in order): GET https://api.deezer.com/search?q=<name> <title>
//      Keep results whose title AND artist.name both equal the artist's (normalizeName from names.mjs on both sides).
//      One distinct Deezer artist id among them -> that artist. More than one -> give up ([]) at once. None -> next title.
//   3. GET https://api.deezer.com/artist/<id>/top?limit=2, then GET https://api.deezer.com/track/<trackId> for each:
//      its `isrc`, kept only if it matches /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/. Fewer than 2 valid ISRCs -> [].
//   Every request: redirect 'error', credentials 'omit', a 15 s timeout. Any failure -> [].
// src/shlabs.mjs: scoreIsrcs(isrcs) like scoreTracks, but posts { isrc } (not spotifyTrackId), invalid ISRCs dropped,
//   and each result's trackId is 'isrc:<code>'.
// src/worker.mjs SH Labs layer: when the artist has no spotifyId and an isrcLinker is given, two ISRCs from
//   isrcLinker.isrcsFor(artist) are scored with shlabs.scoreIsrcs; the same rules, request count and cap as the
//   Spotify path follow (both 85+ AI 94, both under 50 made by people 95, else Claude). No linker or [] -> Claude.
// src/main.mjs: wires createIsrcLinker({ fetch }) as isrcLinker.
// Run from research/investigator: node tests/isrc-link-contract.check.mjs
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { artistKeys } from '../src/names.mjs';
import { CODES } from '../src/checklist.mjs';

const J = (v) => JSON.stringify(v);
const NOW = new Date('2026-11-19T12:00:00Z');
const DAY = '2026-11-19';
const CH = 'UC' + 'c'.repeat(22);
const ISRC1 = 'QZABC2400001', ISRC2 = 'QZABC2400002';
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

// A fake network: routes by URL; records every call (url and options).
function net(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [test, reply] of routes) if (test(String(url))) return typeof reply === 'function' ? reply(String(url)) : ok(reply);
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, calls };
}
const has = (s) => (u) => u.includes(s);
const dzTrack = (id, title, artistId, artistName) => ({ id, title, artist: { id: artistId, name: artistName } });
const deezerTop = (artistId) => [
  [has(`api.deezer.com/artist/${artistId}/top`), { data: [{ id: 501 }, { id: 502 }] }],
  [has('api.deezer.com/track/501'), { id: 501, isrc: ISRC1 }],
  [has('api.deezer.com/track/502'), { id: 502, isrc: ISRC2 }],
];
const art = (o = {}) => ({ name: 'Velvet Echo', site: 'ytm', songs: [{ title: 'Midnight Rain', album: '', artUrl: '' }], playing: true, ...o });
const linker = async (n) => (await import('../src/isrclink.mjs')).createIsrcLinker({ fetch: n.fetch });

await run([
  ['Deezer: the exact title and name pick one artist; its top two ISRCs come back', async () => {
    const n = net([[has('api.deezer.com/search'), { data: [dzTrack(1, 'Midnight Rain', 111, 'Velvet Echo'), dzTrack(2, 'Midnight Rain (Remix)', 222, 'Other Act'), dzTrack(3, 'Midnight Rain', 333, 'Velvet Echoes')] }], ...deezerTop(111)]);
    const got = await (await linker(n)).isrcsFor(art());
    return J(got) === J([ISRC1, ISRC2]) || J({ got, calls: n.calls.map((c) => c.url) });
  }],
  ['case and spacing are ignored in the tie', async () => {
    const n = net([[has('api.deezer.com/search'), { data: [dzTrack(1, 'midnight  rain', 111, 'VELVET echo')] }], ...deezerTop(111)]);
    return J(await (await linker(n)).isrcsFor(art())) === J([ISRC1, ISRC2]) || 'no match';
  }],
  ['two Deezer artists with the same name and title: give up, nothing more is fetched', async () => {
    const n = net([[has('api.deezer.com/search'), { data: [dzTrack(1, 'Midnight Rain', 111, 'Velvet Echo'), dzTrack(2, 'Midnight Rain', 444, 'Velvet Echo')] }], ...deezerTop(111)]);
    const got = await (await linker(n)).isrcsFor(art());
    return (J(got) === '[]' && !n.calls.some((c) => c.url.includes('/top'))) || J({ got, calls: n.calls.map((c) => c.url) });
  }],
  ['the name matches but no title does: []', async () => {
    const n = net([[has('api.deezer.com/search'), { data: [dzTrack(1, 'Another Song', 111, 'Velvet Echo')] }], ...deezerTop(111)]);
    return J(await (await linker(n)).isrcsFor(art())) === '[]' || 'linked without a title tie';
  }],
  ['MusicBrainz by exact channel ID first: its Deezer link is used and Deezer search is never called', async () => {
    const n = net([
      [has('musicbrainz.org/ws/2/url'), { relations: [{ artist: { id: 'mb-1' } }] }],
      [has('musicbrainz.org/ws/2/artist/mb-1'), { relations: [{ url: { resource: 'https://www.deezer.com/en/artist/777' } }] }],
      ...deezerTop(777),
    ]);
    const got = await (await linker(n)).isrcsFor(art({ channelId: CH }));
    const mb = n.calls.find((c) => c.url.includes('musicbrainz.org/ws/2/url'));
    const ua = mb && mb.opts.headers && (mb.opts.headers['User-Agent'] || mb.opts.headers['user-agent']);
    return (J(got) === J([ISRC1, ISRC2]) && !n.calls.some((c) => c.url.includes('/search')) && mb.url.includes(encodeURIComponent(`https://www.youtube.com/channel/${CH}`)) && /github\.com\/wai-lau\/human-music/.test(ua || ''))
      || J({ got, ua, calls: n.calls.map((c) => c.url) });
  }],
  ['MusicBrainz knows two artists for the channel: it is not used; Deezer search decides', async () => {
    const n = net([
      [has('musicbrainz.org/ws/2/url'), { relations: [{ artist: { id: 'mb-1' } }, { artist: { id: 'mb-2' } }] }],
      [has('api.deezer.com/search'), { data: [dzTrack(1, 'Midnight Rain', 111, 'Velvet Echo')] }], ...deezerTop(111),
    ]);
    const got = await (await linker(n)).isrcsFor(art({ channelId: CH }));
    return (J(got) === J([ISRC1, ISRC2]) && !n.calls.some((c) => c.url.includes('/artist/mb-'))) || J({ got, calls: n.calls.map((c) => c.url) });
  }],
  ['an invalid ISRC or only one track: []', async () => {
    const n = net([[has('api.deezer.com/search'), { data: [dzTrack(1, 'Midnight Rain', 111, 'Velvet Echo')] }],
      [has('api.deezer.com/artist/111/top'), { data: [{ id: 501 }, { id: 502 }] }],
      [has('api.deezer.com/track/501'), { id: 501, isrc: ISRC1 }], [has('api.deezer.com/track/502'), { id: 502, isrc: 'not-an-isrc' }]]);
    return J(await (await linker(n)).isrcsFor(art())) === '[]' || 'kept a bad ISRC';
  }],
  ['a network failure gives [] and never throws; requests forbid redirects and send no credentials', async () => {
    const n = { calls: [], fetch: async (u, o) => { n.calls.push({ url: u, opts: o }); throw new Error('down'); } };
    const got = await (await linker(n)).isrcsFor(art());
    const o = n.calls[0] && n.calls[0].opts;
    return (J(got) === '[]' && o && o.redirect === 'error' && o.credentials === 'omit' && o.signal instanceof AbortSignal) || J({ got, o });
  }],
  ['shlabs.scoreIsrcs posts { isrc }, drops invalid ones, and marks results isrc:<code>', async () => {
    const { createShLabs } = await import('../src/shlabs.mjs');
    const bodies = [];
    const fetch = async (u, o) => { bodies.push(JSON.parse(o.body)); return ok({ result: { probability_ai_generated: 97.5, prediction: 'ai' }, audio_source: 'full' }); };
    const sh = createShLabs({ fetch, key: 'k', sleep: async () => {}, now: () => NOW.getTime() });
    const out = await sh.scoreIsrcs([ISRC1, 'bad', ISRC2]);
    return (J(bodies) === J([{ isrc: ISRC1 }, { isrc: ISRC2 }]) && J(out.map((r) => r.trackId)) === J([`isrc:${ISRC1}`, `isrc:${ISRC2}`]) && out[0].probability === 97.5) || J({ bodies, out });
  }],
  ['worker: a YouTube Music artist with two ISRCs at 85+ is AI at 90 from SH Labs; nothing linked is stored', async () => {
    const store = openStore(':memory:');
    const queue = createQueue({ store, now: () => NOW, cap: 100 });
    let claude = 0;
    const sc = (codes) => codes.map((c, i) => ({ trackId: `isrc:${c}`, probability: [96.1, 91.4][i], label: '', generator: null, audioSource: 'full', at: NOW.toISOString() }));
    const w = createWorker({ store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {},
      cheapPass: async () => null, aiLists: { match: async () => null }, fetchPage: async () => '',
      isrcLinker: { isrcsFor: async () => [ISRC1, ISRC2] },
      shlabs: { scoreTracks: async () => [], scoreIsrcs: async (codes) => sc(codes) },
      investigate: async () => { claude++; return { ok: true, checklist: { signs: Object.fromEntries(CODES.map((c) => [c, 'unknown'])), genres: [], sources: [], summary: '' } }; } });
    const a = art({ channelId: CH });
    queue.enqueue([a]); await w.runOne();
    const v = store.findVerdict(artistKeys(a));
    const keys = Object.keys(v || {});
    return (v && v.verdict === 'ai' && v.confidence === 90 && v.model === 'shlabs' && claude === 0 && v.channelId === CH && !keys.includes('spotifyId') && !J(v).includes('777') && store.getState(`shlabs.requests.${DAY}`) === 2)
      || J({ v, claude, n: store.getState(`shlabs.requests.${DAY}`) });
  }],
  ['worker: no link ([]) means Claude decides', async () => {
    const store = openStore(':memory:');
    const queue = createQueue({ store, now: () => NOW, cap: 100 });
    let claude = 0, scored = 0;
    const w = createWorker({ store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {},
      cheapPass: async () => null, aiLists: { match: async () => null }, fetchPage: async () => '',
      isrcLinker: { isrcsFor: async () => [] },
      shlabs: { scoreTracks: async () => [], scoreIsrcs: async () => { scored++; return []; } },
      investigate: async () => { claude++; return { ok: true, checklist: { signs: Object.fromEntries(CODES.map((c) => [c, 'unknown'])), genres: [], sources: [], summary: '' } }; } });
    queue.enqueue([art()]); await w.runOne();
    return (claude === 1 && scored === 0) || J({ claude, scored });
  }],
]);
