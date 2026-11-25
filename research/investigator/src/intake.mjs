// Validate a request body and split it into artists. Everything in the body is data:
// text is cut and cleaned, never interpreted.
import { artistKeys } from './names.mjs';

const MAX_BYTES = 65536;
const MAX_ITEMS = 20;
const MAX_FIELD = 300;
// Control characters are stripped from every incoming field on purpose.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_ID = /^UC[\w-]{22}$/;

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL, '').slice(0, MAX_FIELD).trim();
}

export function parseRequest(bodyText) {
  if (typeof bodyText !== 'string') return { ok: false, status: 400, reason: 'body must be text' };
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_BYTES) return { ok: false, status: 413, reason: 'body too large' };
  let data;
  try { data = JSON.parse(bodyText); } catch { return { ok: false, status: 400, reason: 'not JSON' }; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return { ok: false, status: 400, reason: 'no items array' };
  }
  if (data.items.length > MAX_ITEMS) return { ok: false, status: 413, reason: 'too many items' };

  const artists = [];
  const byKey = new Map(); // artist key -> Artist

  for (const it of data.items) {
    if (!it || typeof it !== 'object') continue;
    if (typeof it.title !== 'string' || typeof it.artistLine !== 'string') continue;

    const album = clean(it.album);
    let artUrl = clean(it.artUrl);
    if (!artUrl.startsWith('https://')) artUrl = '';
    const song = { title: clean(it.title), album, artUrl };
    const playing = album !== '' || artUrl !== '';
    const site = clean(it.site);

    let names = Array.isArray(it.credits) ? it.credits.map(clean).filter(Boolean) : [];
    if (names.length === 0) {
      const lead = clean(it.artistLine.split(' • ')[0]);
      if (lead) names = [lead];
    }
    if (names.length === 0) continue;

    // IDs belong to a credit only when the pairing is unambiguous.
    let ids = {};
    if (names.length === 1 && Array.isArray(it.channelIds) && it.channelIds.length === 1) {
      const id = clean(it.channelIds[0]);
      if (YOUTUBE_ID.test(id)) ids = { channelId: id };
      else if (SPOTIFY_ID.test(id)) ids = { spotifyId: id };
    }

    for (const name of names) {
      const keys = artistKeys({ name, ...ids });
      let artist = keys.map(k => byKey.get(k)).find(Boolean);
      if (!artist) {
        artist = { name, site, songs: [], playing: false };
        artists.push(artist);
      }
      artist.songs.push({ ...song });
      if (playing) artist.playing = true;
      if (ids.spotifyId && !artist.spotifyId) artist.spotifyId = ids.spotifyId;
      // Spotify's own "AI Persona" label, as read by a logged-in copy; counts only with the ID.
      if (it.spotifyAiLabel === true && ids.spotifyId) artist.spotifyAiLabel = true;
      if (ids.channelId && !artist.channelId) artist.channelId = ids.channelId;
      for (const k of artistKeys(artist)) byKey.set(k, artist);
      for (const k of keys) byKey.set(k, artist);
    }
  }
  return { ok: true, artists };
}

