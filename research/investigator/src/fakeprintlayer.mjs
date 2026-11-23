// Our own audio detector layer. Fetches two Deezer previews of the artist, computes each
// song's fakeprint and scores it with our small model. Both songs at 0.8 or more is an AI
// verdict at 90.
import { fakeprint, probability } from './fakeprint.mjs';

export function createFakeprintLayer({ fetch, decode, model, linker }) {
  const requestOpts = () => ({
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(15000),
  });

  async function get(url) {
    try {
      const res = await fetch(url, requestOpts());
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function fetchPreview(url) {
    try {
      const res = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  }

  async function getPreviews(deezerId, artistName) {
    const top = await get(`https://api.deezer.com/artist/${deezerId}/top?limit=10`);
    const urls = [];
    if (top && Array.isArray(top.data)) {
      for (const item of top.data) {
        if (item && typeof item.preview === 'string' && item.preview) {
          urls.push(item.preview);
          if (urls.length >= 2) break;
        }
      }
    }
    if (urls.length >= 2) return urls.slice(0, 2);
    // Try search if the top list doesn't give two previews
    const q = `https://api.deezer.com/search?q=${encodeURIComponent(artistName)}&limit=25`;
    const search = await get(q);
    if (search && Array.isArray(search.data)) {
      for (const item of search.data) {
        const artist = item && typeof item.artist === 'object' ? item.artist : null;
        // Only this exact artist's songs: a result without an artist, or with another, is skipped.
        if (!artist || artist.id !== deezerId) continue;
        if (item && typeof item.preview === 'string' && item.preview) {
          if (!urls.includes(item.preview)) urls.push(item.preview);
          if (urls.length >= 2) break;
        }
      }
    }
    return urls.slice(0, 2);
  }

  async function scoreArtist(artist) {
    try {
      const deezerId = await linker.deezerArtistFor(artist);
      if (deezerId === null || deezerId === undefined) return [];
      const previews = await getPreviews(deezerId, artist.name);
      if (previews.length < 2) return [];
      const results = [];
      for (let i = 0; i < 2; i++) {
        const bytes = await fetchPreview(previews[i]);
        if (bytes === null) return [];
        const samples = await decode(bytes);
        if (samples.length < 16384) return [];
        const fp = fakeprint(samples);
        const prob = probability(fp, model);
        results.push(prob);
      }
      return results;
    } catch {
      return [];
    }
  }

  return { scoreArtist };
}