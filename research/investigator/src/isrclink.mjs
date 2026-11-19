// Link a YouTube Music artist to SH Labs via ISRCs. MusicBrainz by exact channel ID is tried
// first; if that gives exactly one artist with a Deezer link, use it. Otherwise, search Deezer
// by the artist's song titles. The linked IDs are never stored (worker.mjs withIds).
import { normalizeName } from './names.mjs';

const UA = 'human-music-investigator/0.1 (https://github.com/wai-lau/human-music)';
const MB_URLS = 'https://musicbrainz.org/ws/2/url';
const MB_ARTISTS = 'https://musicbrainz.org/ws/2/artist';
const DZ_SEARCH = 'https://api.deezer.com/search';
const DZ_ARTIST = 'https://api.deezer.com/artist';
const DZ_TRACK = 'https://api.deezer.com/track';
const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;

function requestOpts(headers = {}) {
  return { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000), headers };
}

export function createIsrcLinker({ fetch }) {
  async function get(url, headers = {}) {
    try {
      const res = await fetch(url, requestOpts(headers));
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function musicbrainzLink(channelId) {
    const urlEnc = encodeURIComponent(`https://www.youtube.com/channel/${channelId}`);
    const urlData = await get(`${MB_URLS}?resource=${urlEnc}&inc=artist-rels&fmt=json`, { 'User-Agent': UA });
    if (!urlData || !Array.isArray(urlData.relations)) return null;
    if (urlData.relations.length !== 1) return null;
    const artistId = urlData.relations[0].artist && urlData.relations[0].artist.id;
    if (!artistId) return null;
    const artistData = await get(`${MB_ARTISTS}/${artistId}?inc=url-rels&fmt=json`, { 'User-Agent': UA });
    if (!artistData || !Array.isArray(artistData.relations)) return null;
    for (const rel of artistData.relations) {
      const resource = rel.url && rel.url.resource;
      if (typeof resource === 'string') {
        const m = resource.match(/^(?:https?:\/\/)?(?:www\.|)(deezer\.com)\/(?:[a-z]{2}\/)?artist\/(\d+)/i);
        if (m) return Number(m[2]);
      }
    }
    return null;
  }

  async function deezerLinkByName(artist) {
    const normArtist = normalizeName(artist.name);
    const titles = (Array.isArray(artist.songs) ? artist.songs : []).slice(0, 3);
    for (const song of titles) {
      const title = song && typeof song.title === 'string' ? song.title : '';
      if (!title) continue;
      const normTitle = normalizeName(title);
      const data = await get(`${DZ_SEARCH}?q=${encodeURIComponent(artist.name)}+${encodeURIComponent(title)}`);
      if (!data || !Array.isArray(data.data)) continue;
      const ids = new Set();
      let hasMatch = false;
      for (const track of data.data) {
        const tName = typeof track.title === 'string' ? track.title : '';
        const aName = track.artist && typeof track.artist.name === 'string' ? track.artist.name : '';
        if (normalizeName(tName) === normTitle && normalizeName(aName) === normArtist) {
          hasMatch = true;
          if (typeof track.artist.id === 'number') ids.add(track.artist.id);
        }
      }
      if (!hasMatch) continue;
      if (ids.size === 1) {
        return ids.values().next().value;
      }
      if (ids.size > 1) {
        return null;
      }
    }
    return null;
  }

  async function deezerTopIsrcs(artistId) {
    const top = await get(`${DZ_ARTIST}/${artistId}/top?limit=2`);
    if (!top || !Array.isArray(top.data) || top.data.length < 2) return [];
    const isrcs = [];
    for (const item of top.data) {
      const trackId = typeof item.id === 'number' ? item.id : null;
      if (!trackId) continue;
      const track = await get(`${DZ_TRACK}/${trackId}`);
      if (!track) continue;
      const isrc = typeof track.isrc === 'string' ? track.isrc : '';
      if (ISRC_RE.test(isrc)) {
        isrcs.push(isrc);
        if (isrcs.length === 2) return isrcs;
      }
    }
    return isrcs;
  }

  return {
    async isrcsFor(artist) {
      let artistId = null;
      if (artist && typeof artist.channelId === 'string' && artist.channelId) {
        artistId = await musicbrainzLink(artist.channelId);
      }
      if (artistId === null && artist && typeof artist.name === 'string' && artist.name) {
        artistId = await deezerLinkByName(artist);
      }
      if (artistId === null) return [];
      const isrcs = await deezerTopIsrcs(artistId);
      return isrcs.length === 2 ? isrcs : [];
    },
  };
}
