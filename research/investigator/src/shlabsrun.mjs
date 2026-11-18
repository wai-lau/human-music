// SH Labs accuracy experiment (Wai, 2026-11-18: "run some experiments on sh labs API to see how
// accurate it is / weight it relative to its accuracy, same with all indicators"). For each
// labelled artist (known AI, known people), the top tracks from Spotify's public embed page are
// scored by SH Labs; the report shows how often each SH Labs reading comes up for AI artists and
// for people, so it can be weighed like every other sign. Resumable; never more than maxRequests
// SH Labs calls per run (the free plan: Wai's stated use is at most about 200 a day).

const TRACK_URI = /spotify:track:([A-Za-z0-9]{22})/g;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

// The first n distinct track IDs on an artist's embed page (its top tracks, in page order).
export function trackIdsFromEmbed(html, n = 2) {
  const out = [];
  for (const m of String(html || '').matchAll(TRACK_URI)) {
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= n) break;
  }
  return out;
}

// sample: { ai: [{ name, spotifyId }], people: [...] }; fetchPage(url) -> html text;
// shlabs.scoreTracks(ids) -> [{ trackId, probability, label, generator, audioSource, at }].
export async function runShLabs({ store, fetchPage, shlabs, sample, perArtist = 2, maxRequests = 190, log = () => {} }) {
  const key = 'shlabs.results';
  const results = store.getState(key) || {};
  const all = [
    ...(sample.ai || []).map((a) => ({ ...a, truthAi: true })),
    ...(sample.people || []).map((a) => ({ ...a, truthAi: false })),
  ].filter((a) => a && typeof a.spotifyId === 'string' && SPOTIFY_ID.test(a.spotifyId));
  let requests = 0;
  let emptyInARow = 0;
  let stopped = null;
  for (const a of all) {
    const prev = results[a.name];
    if (prev && !prev.failed) continue;
    if (prev && prev.failed >= 2) continue;
    let ids;
    try { ids = trackIdsFromEmbed(await fetchPage(`https://open.spotify.com/embed/artist/${a.spotifyId}`), perArtist); } catch { ids = []; }
    if (!ids.length) {
      results[a.name] = { truthAi: a.truthAi, tracks: [], note: 'no tracks on the embed page' };
      store.setState(key, results);
      continue;
    }
    if (requests + ids.length > maxRequests) { stopped = 'request cap'; break; }
    let scores;
    try { scores = await shlabs.scoreTracks(ids); } catch { scores = []; }
    requests += ids.length;
    if (!Array.isArray(scores) || scores.length === 0) {
      results[a.name] = { failed: ((prev && prev.failed) || 0) + 1 };
      emptyInARow += 1;
      store.setState(key, results);
      if (emptyInARow >= 3) { stopped = 'no answers (out of quota, or SH Labs is down)'; break; }
      continue;
    }
    emptyInARow = 0;
    results[a.name] = { truthAi: a.truthAi, tracks: scores.map((s) => ({ trackId: s.trackId, probability: s.probability, label: s.label, generator: s.generator, audioSource: s.audioSource })) };
    store.setState(key, results);
    log(`${a.name}: ${scores.map((s) => s.probability).join(', ')}`);
  }
  const done = Object.values(results).filter((r) => r && !r.failed).length;
  return stopped ? { done, requests, stopped } : { done, requests };
}

// The readings the research names (M3: 85 or more on two tracks; P16: under 50 on two tracks),
// plus the same on one track, as found/not found per artist.
export function shlabsReadings(r) {
  const ps = (r && Array.isArray(r.tracks) ? r.tracks : []).map((t) => t.probability).filter((p) => Number.isFinite(p));
  if (ps.length === 0) return null;
  return {
    high2: ps.length >= 2 && ps.filter((p) => p >= 85).length >= 2,
    high1: ps.some((p) => p >= 85),
    low2: ps.length >= 2 && ps.filter((p) => p < 50).length >= 2,
    low1: ps.some((p) => p < 50),
  };
}

export function reportShLabs(results, points) {
  const rows = Object.entries(results || {}).filter(([, r]) => r && !r.failed && shlabsReadings(r));
  const ai = rows.filter(([, r]) => r.truthAi);
  const people = rows.filter(([, r]) => !r.truthAi);
  const lines = [`scored: ${ai.length} known AI, ${people.length} known people`, '', '| Reading | Found, AI | Found, people | Measured points |', '|---|---|---|---|'];
  const NAMES = { high2: '85+ on two tracks (M3)', high1: '85+ on one track', low2: 'under 50 on two tracks (P16)', low1: 'under 50 on one track' };
  for (const k of ['high2', 'high1', 'low2', 'low1']) {
    const fa = ai.filter(([, r]) => shlabsReadings(r)[k]).length;
    const fp = people.filter(([, r]) => shlabsReadings(r)[k]).length;
    lines.push(`| ${NAMES[k]} | ${fa}/${ai.length} | ${fp}/${people.length} | ${points(fa, ai.length, fp, people.length)} |`);
  }
  lines.push('', '| Artist | Truth | SH Labs per track |', '|---|---|---|');
  for (const [name, r] of rows) lines.push(`| ${name} | ${r.truthAi ? 'AI' : 'people'} | ${r.tracks.map((t) => `${t.probability}${t.label ? ` (${t.label})` : ''}`).join(', ')} |`);
  return lines.join('\n');
}
