// SH Labs second opinion: for comparison only. Scores stay on the droplet and
// never enter the published list. The service is optional: a missing key, an
// HTTP error, a 429 or bad JSON gives fewer or no scores, never a failure.
//
// API (https://shlabs.music/docs):
//   POST https://shlabs.music/api/v1/detect, header X-API-Key, JSON body with
//   exactly one of spotifyTrackId | isrc | audioUrl.
//   200 -> { result: { probability_ai_generated, prediction, most_likely_ai_type, ... }, audio_source, usage }
//   400 bad input, never retry; 429 wait out the window; 503 back off.
//   Free ("Verified") plan: 10 requests a minute.
// The key is only ever put in the X-API-Key header: never logged, never in a message.

const URL_DETECT = 'https://shlabs.music/api/v1/detect';
const TRACK_ID = /^[A-Za-z0-9]{22}$/;
const MAX_PER_CALL = 2;
const PER_WINDOW = 10;
const WINDOW_MS = 60000;
const BACKOFF_503_MS = 5000;

export function createShLabs({ fetch, key, sleep, now = Date.now }) {
  const stamps = []; // start times of recent requests

  async function pace() {
    const t = now();
    while (stamps.length && t - stamps[0] >= WINDOW_MS) stamps.shift();
    if (stamps.length >= PER_WINDOW) {
      await sleep(Math.max(0, stamps[0] + WINDOW_MS - t));
      stamps.shift();
    }
    stamps.push(now());
  }

  async function post(trackId) {
    await pace();
    return fetch(URL_DETECT, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotifyTrackId: trackId }),
    });
  }

  async function scoreTracks(trackIds) {
    if (typeof key !== 'string' || !key.trim()) return [];
    const ids = (Array.isArray(trackIds) ? trackIds : [])
      .filter((id) => typeof id === 'string' && TRACK_ID.test(id))
      .slice(0, MAX_PER_CALL);
    const out = [];
    for (const trackId of ids) {
      try {
        let res = await post(trackId);
        if (res && res.status === 503) {
          await sleep(BACKOFF_503_MS);
          res = await post(trackId);
        }
        if (!res) break;
        if (res.status === 400) continue; // this track is unusable; the next may be fine
        if (!res.ok) break; // 401, 429, 503, 500: stop, score nothing more now
        const body = await res.json();
        const r = body && body.result;
        const p = r && r.probability_ai_generated;
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) continue;
        out.push({
          trackId,
          probability: p,
          label: typeof r.prediction === 'string' ? r.prediction : '',
          generator: typeof r.most_likely_ai_type === 'string' ? r.most_likely_ai_type : null,
          at: new Date(now()).toISOString(),
        });
      } catch {
        break; // bad JSON or a network error: drop the message, it could echo request details
      }
    }
    return out;
  }

  return { scoreTracks };
}
