// Known song titles of Spotify-labelled artists (Wai, 2026-11-25). A published label verdict carries
// them, so a copy on YouTube Music hides the artist's name only beside one of these songs, and a
// namesake with other songs plays. Titles come from the artist's public embed page and from the
// dev copy's reports; they merge and stay (at most 50 per artist, the first ones kept).

const MAX_TITLES = 50;
const MAX_LEN = 200;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const NEXT_DATA = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
// Control characters are stripped on purpose.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function cleanTitle(t) {
  return typeof t === 'string' ? t.replace(CONTROL, '').trim().slice(0, MAX_LEN) : '';
}

// Song titles from an embed page's __NEXT_DATA__ (props.pageProps.state.data.entity.trackList[].title).
export function titlesFromEmbed(html) {
  try {
    const m = NEXT_DATA.exec(String(html || ''));
    if (!m) return [];
    const list = JSON.parse(m[1]).props.pageProps.state.data.entity.trackList;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
      const t = cleanTitle(item && item.title);
      if (t && !out.includes(t)) out.push(t);
      if (out.length >= MAX_TITLES) break;
    }
    return out;
  } catch {
    return [];
  }
}

function table(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS spotify_titles (
    spotify_id TEXT NOT NULL,
    title TEXT NOT NULL,
    PRIMARY KEY (spotify_id, title)
  )`);
}

export function getTitles(store, spotifyId) {
  if (typeof spotifyId !== 'string' || !SPOTIFY_ID.test(spotifyId)) return [];
  table(store);
  return store.db.prepare('SELECT title FROM spotify_titles WHERE spotify_id = ? ORDER BY rowid').all(spotifyId).map((r) => r.title);
}

export function addTitles(store, spotifyId, titles) {
  if (typeof spotifyId !== 'string' || !SPOTIFY_ID.test(spotifyId) || !Array.isArray(titles)) return;
  table(store);
  const have = getTitles(store, spotifyId);
  const ins = store.db.prepare('INSERT OR IGNORE INTO spotify_titles (spotify_id, title) VALUES (?, ?)');
  for (const raw of titles) {
    if (have.length >= MAX_TITLES) break;
    const t = cleanTitle(raw);
    if (!t || have.includes(t)) continue;
    ins.run(spotifyId, t);
    have.push(t);
  }
}

// Attach the known titles to the label verdicts about to be published.
export function withTitles(store, verdicts) {
  return verdicts.map((v) => (v && v.model === 'spotify-label'
    ? { ...v, titles: getTitles(store, v.spotifyId) }
    : v));
}

// Store the titles on the embed page, then those the dev copy sent; any failure leaves what is known.
export async function collectTitles({ store, fetchPage, artist }) {
  if (!artist.spotifyId) return;
  if (typeof fetchPage === 'function') {
    try {
      addTitles(store, artist.spotifyId, titlesFromEmbed(await fetchPage(`https://open.spotify.com/embed/artist/${artist.spotifyId}`)));
    } catch { /* the verdict is saved anyway */ }
  }
  try { addTitles(store, artist.spotifyId, artist.songTitles || []); } catch { /* keep going */ }
}
