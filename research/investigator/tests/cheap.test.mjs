import { run } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { cheapPass } from '../src/cheap.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const SEARCH = fx('musicbrainz-search');
const SP = '4Z8W4fKeB5YxbusRsdQVPb';
const UA = 'HumanMusicInvestigator/0.1 (+https://github.com/wai-lau/human-music)';

// A fake MusicBrainz: search and lookup, logging every request.
function fake(lookup, { status = 200, raw } = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    const body = String(url).includes('/artist/?') ? SEARCH : lookup;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (raw !== undefined) throw new SyntaxError('bad'); return body; },
      text: async () => raw ?? JSON.stringify(body),
    };
  };
  f.calls = calls;
  return f;
}
const sleeper = () => {
  const waits = [];
  const s = async (ms) => { waits.push(ms); };
  s.waits = waits;
  return s;
};
const artist = (extra = {}) => ({ name: 'Test Band', site: 'ytm', songs: [{ title: 'Something Else', album: '', artUrl: '' }], playing: false, ...extra });

run([
  ['ID tie plus a 2012 release gives human', async () => {
    const r = await cheapPass(artist({ spotifyId: SP }), { fetch: fake(fx('musicbrainz-lookup-old')), sleep: sleeper() });
    if (!r) return 'null';
    if (r.verdict !== 'human' || r.confidence !== 90) return JSON.stringify(r);
    if (r.signals.length !== 0 || !r.reasons.length || !r.sources.length) return JSON.stringify(r);
    return r.spotifyId === SP || `spotifyId ${r.spotifyId}`;
  }],
  ['YouTube channel ID tie gives human', async () => {
    const r = await cheapPass(artist({ channelId: 'UCq19-LqvG35A-30oyAiPiqA' }), { fetch: fake(fx('musicbrainz-lookup-old')), sleep: sleeper() });
    return (r && r.verdict === 'human') || 'not human';
  }],
  ['title tie plus 2018 gives human', async () => {
    const a = artist({ songs: [{ title: '  OLD  song ', album: '', artUrl: '' }] });
    const r = await cheapPass(a, { fetch: fake(fx('musicbrainz-lookup-title')), sleep: sleeper() });
    return (r && r.verdict === 'human') || 'not human';
  }],
  ['name only gives null', async () => {
    const r = await cheapPass(artist(), { fetch: fake(fx('musicbrainz-lookup-old')), sleep: sleeper() });
    return r === null || JSON.stringify(r);
  }],
  ['a 2021 release only gives null', async () => {
    const a = artist({ spotifyId: SP, songs: [{ title: 'Only Song', album: '', artUrl: '' }] });
    const r = await cheapPass(a, { fetch: fake(fx('musicbrainz-lookup-new')), sleep: sleeper() });
    return r === null || JSON.stringify(r);
  }],
  ['a 503 gives null', async () => {
    const r = await cheapPass(artist({ spotifyId: SP }), { fetch: fake({}, { status: 503 }), sleep: sleeper() });
    return r === null || JSON.stringify(r);
  }],
  ['bad JSON gives null', async () => {
    const r = await cheapPass(artist({ spotifyId: SP }), { fetch: fake({}, { raw: 'not json' }), sleep: sleeper() });
    return r === null || JSON.stringify(r);
  }],
  ['a network error gives null', async () => {
    const r = await cheapPass(artist({ spotifyId: SP }), { fetch: async () => { throw new Error('down'); }, sleep: sleeper() });
    return r === null || JSON.stringify(r);
  }],
  ['sleep waited at least 1000 ms between two requests', async () => {
    const f = fake(fx('musicbrainz-lookup-old'));
    const s = sleeper();
    await cheapPass(artist({ spotifyId: SP }), { fetch: f, sleep: s, now: () => 5000 });
    if (f.calls.length < 2) return `only ${f.calls.length} requests`;
    const total = s.waits.reduce((a, b) => a + b, 0);
    return total >= 1000 || `waited ${total}`;
  }],
  ['User-Agent is the fixed generic string, no personal detail', async () => {
    const f = fake(fx('musicbrainz-lookup-old'));
    await cheapPass(artist({ spotifyId: SP }), { fetch: f, sleep: sleeper() });
    const ua = f.calls.map((c) => c.headers['User-Agent']);
    if (!ua.length || ua.some((u) => u !== UA)) return JSON.stringify(ua);
    return !/@/.test(ua[0]) || 'has an email';
  }],
  ['requests use fmt=json and the documented URL shapes', async () => {
    const f = fake(fx('musicbrainz-lookup-old'));
    await cheapPass(artist({ spotifyId: SP }), { fetch: f, sleep: sleeper() });
    const [s, l] = f.calls.map((c) => c.url);
    if (!s.startsWith('https://musicbrainz.org/ws/2/artist/?query=') || !s.includes('fmt=json')) return s;
    return (l.startsWith('https://musicbrainz.org/ws/2/artist/11111111-') && l.includes('inc=url-rels+release-groups') && l.includes('fmt=json')) || l;
  }],
]);
