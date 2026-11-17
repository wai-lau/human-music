// The cheap pass: a release before 2020 that a MusicBrainz page ties to this
// artist settles them as people without a deep investigation. Anything less
// (no match, no tie, a 503, bad JSON, a network error) returns null, so the
// artist falls through to the deep investigation. Unsure means investigate.
//
// API shapes (https://musicbrainz.org/doc/MusicBrainz_API):
//   search  GET /ws/2/artist/?query=...&limit=N&fmt=json  -> { artists: [{ id, name, score }] }
//   lookup  GET /ws/2/artist/<mbid>?inc=url-rels+release-groups&fmt=json
//           -> { relations: [{ url: { resource } }], 'release-groups': [{ title, 'first-release-date' }] }
// At most one request a second; a meaningful User-Agent is required.
import { normalizeName } from './names.mjs';

const BASE = 'https://musicbrainz.org/ws/2/artist/';
const USER_AGENT = 'HumanMusicInvestigator/0.1 (+https://github.com/wai-lau/human-music)';
const GAP_MS = 1000;
const MAX_CANDIDATES = 3;
const CUTOFF_YEAR = 2020;

const norm = (s) => (typeof s === 'string' ? normalizeName(s) : ''); // the service's one name rule (names.mjs)

// One limiter per fetch function, so two calls sharing a fetch share the pace.
const lastAt = new WeakMap();

async function get(url, { fetch, sleep, now }) {
  const last = lastAt.get(fetch);
  if (last !== undefined) {
    const wait = GAP_MS - (now() - last);
    await sleep(wait > 0 ? wait : 0);
  }
  lastAt.set(fetch, now());
  // A hung MusicBrainz request would stall the whole queue: give up after 10 seconds.
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!res || !res.ok) return null;
  return res.json();
}

// 'first-release-date' is YYYY, YYYY-MM or YYYY-MM-DD.
const yearOf = (d) => {
  const m = /^(\d{4})(?:-|$)/.exec(String(d ?? ''));
  return m ? Number(m[1]) : null;
};

function idsFrom(relations) {
  const out = { spotify: [], channel: [] };
  for (const r of Array.isArray(relations) ? relations : []) {
    const res = r && r.url && typeof r.url.resource === 'string' ? r.url.resource : '';
    let m = /^https?:\/\/open\.spotify\.com\/artist\/([A-Za-z0-9]{22})(?:[/?#]|$)/.exec(res);
    if (m) out.spotify.push(m[1]);
    m = /^https?:\/\/(?:www\.|music\.)?youtube\.com\/channel\/(UC[\w-]{22})(?:[/?#]|$)/.exec(res);
    if (m) out.channel.push(m[1]);
  }
  return out;
}

export async function cheapPass(artist, { fetch, sleep, now = Date.now } = {}) {
  try {
    const ctx = { fetch, sleep, now };
    const name = norm(artist && artist.name);
    if (!name) return null;
    const q = encodeURIComponent(`artist:"${String(artist.name).replace(/["\\]/g, ' ')}"`);
    const found = await get(`${BASE}?query=${q}&limit=5&fmt=json`, ctx);
    const candidates = (found && Array.isArray(found.artists) ? found.artists : [])
      .filter((a) => a && typeof a.id === 'string' && norm(a.name) === name)
      .slice(0, MAX_CANDIDATES);
    const titles = new Set((artist.songs || []).map((s) => norm(s && s.title)).filter(Boolean));

    for (const c of candidates) {
      const doc = await get(`${BASE}${encodeURIComponent(c.id)}?inc=url-rels+release-groups&fmt=json`, ctx);
      if (!doc || !Array.isArray(doc['release-groups'])) continue;
      const ids = idsFrom(doc.relations);
      const idTie = (artist.spotifyId && ids.spotify.includes(artist.spotifyId))
        || (artist.channelId && ids.channel.includes(artist.channelId));
      for (const rg of doc['release-groups']) {
        const y = yearOf(rg && rg['first-release-date']);
        if (y === null || y >= CUTOFF_YEAR) continue;
        if (!idTie && !titles.has(norm(rg.title))) continue;
        const out = {
          verdict: 'human',
          confidence: 90,
          signals: [],
          reasons: [`MusicBrainz lists "${rg.title}" by this artist, first released ${rg['first-release-date']}, tied by ${idTie ? 'the same streaming ID' : 'a song title'}.`],
          sources: [`https://musicbrainz.org/artist/${c.id}`],
        };
        if (ids.spotify[0]) out.spotifyId = ids.spotify[0];
        if (ids.channel[0]) out.channelId = ids.channel[0];
        return out;
      }
    }
    return null;
  } catch {
    return null;
  }
}
