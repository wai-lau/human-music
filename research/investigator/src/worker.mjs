// The worker: one artist from the queue to a stored verdict. Cheap pass first, then one
// locked-down `claude -p`, then the decision rule (decide() is the final word), then the
// calibration mapping. Unsure means play: any failure leaves no verdict rather than a wrong one.
import { decide, mayPass94 } from './answer.mjs';
import { applyMapping } from './calibrate.mjs';

const cut = (s, n = 300) => String(s ?? '').slice(0, n);

export function createWorker({ store, queue, cheapPass, investigate, shlabs, schedulePublish, mapping, now, fetchArt, lookArt }) {
  const lastError = (msg) => {
    try { store.setState('queue.lastError', cut(msg)); } catch { /* nothing more to do */ }
  };

  // The stored record's IDs are only the artist's own, from the page. An ID Claude found on the
  // web is never stored (review 2026-11-17): a stored ID becomes a lasting key, so a planted one
  // could later sit on an `ai` verdict (blocking someone else by ID) or merge two artists.
  function withIds(artist, found, verdictWord) {
    const out = {};
    if (artist.spotifyId) out.spotifyId = artist.spotifyId;
    if (artist.channelId) out.channelId = artist.channelId;
    return out;
  }

  function save(artist, found, v, model, today) {
    return store.putVerdict({
      name: artist.name,
      ...withIds(artist, found, v.verdict),
      verdict: v.verdict,
      confidence: v.confidence,
      rawConfidence: v.rawConfidence,
      signals: v.signals,
      reasons: v.reasons,
      sources: v.sources,
      model,
      checked: today,
      source: 'live',
    });
  }

  // Up to two tracks for the second opinion. A failure here never touches the verdict.
  async function second(artistId, artist, answer) {
    try {
      if (!shlabs) return;
      const ids = (answer && answer.trackIds) || artist.trackIds || [];
      if (!ids.length) return;
      const scores = await shlabs.scoreTracks(ids.slice(0, 2));
      if (Array.isArray(scores) && scores.length) store.putScores(artistId, scores);
    } catch { /* optional: fewer or no scores */ }
  }

  // The cover, if the playing song has one: service-side fetch, then a tool-less look in its own
  // Claude call. Any failure means no look; the research call never sees the image or the result.
  async function lookAtCover(artist) {
    try {
      if (!fetchArt || !lookArt) return null;
      const songs = Array.isArray(artist.songs) ? artist.songs : [];
      const url = songs.map((x) => x && x.artUrl).find((u) => typeof u === 'string' && u);
      if (!url) return null;
      const img = await fetchArt(url);
      if (!img || img.ok !== true) return null;
      const r = await lookArt(img);
      if (!r || r.ok !== true || !['ai', 'not_ai', 'unclear'].includes(r.look)) return null;
      return { url, look: r.look };
    } catch {
      return null;
    }
  }

  async function runOne() {
    let artist = null;
    try {
      artist = queue.next();
      if (!artist) return 'idle';
      const today = now().toISOString().slice(0, 10);

      let cheap = null;
      try { cheap = await cheapPass(artist); } catch { cheap = null; }
      if (cheap && cheap.verdict === 'human') {
        save(artist, cheap, {
          verdict: 'human',
          confidence: cheap.confidence,
          rawConfidence: cheap.confidence,
          signals: cheap.signals || [],
          reasons: cheap.reasons || [],
          sources: cheap.sources || [],
        }, 'musicbrainz', today);
        queue.done(artist);
        schedulePublish();
        return 'done';
      }

      const res = await investigate(artist, {});
      if (!res || res.ok !== true) {
        const kind = res && res.kind;
        const reason = `${kind || 'error'}: ${cut(res && res.detail)}`;
        if (kind === 'auth' || kind === 'limit') {
          queue.pause(reason);
          queue.requeue(artist);
          return 'paused';
        }
        // A timeout or crash may pass: try again later, twice (review 2026-11-17).
        if (kind === 'error' && queue.retryLater(artist)) {
          lastError(`${reason} (will try again)`);
          return 'retry';
        }
        // invalid (or a failure that keeps happening): store nothing, do not retry today
        if (kind === 'invalid') store.bump(today); // Claude ran and used the subscription
        lastError(reason);
        queue.done(artist);
        return 'done';
      }

      // Only an `ai` look adds the weak signal, once; decide() never lets it stand alone.
      const cover = await lookAtCover(artist);
      const answer = cover && cover.look === 'ai' && !res.answer.signals.includes('ai_style_art')
        ? { ...res.answer, signals: [...res.answer.signals, 'ai_style_art'] }
        : res.answer;
      const d = decide(answer);
      store.bump(today);
      const raw = d.confidence;
      // A verdict that didn't meet the rule stays under Optimal, whatever the fit says.
      const shown = d.verdict === 'ai' ? (mayPass94(d) ? applyMapping(mapping, raw) : Math.min(applyMapping(mapping, raw), 94)) : raw;
      const id = save(artist, res.answer, {
        verdict: d.verdict,
        confidence: shown,
        rawConfidence: raw,
        signals: d.signals,
        reasons: d.reasons,
        sources: d.sources,
      }, 'claude', today);
      // The look and the cover address stay on the droplet, apart from the published list.
      if (cover) { try { store.setState(`art:${id}`, cover); } catch { /* optional */ } }
      queue.done(artist);
      schedulePublish();
      await second(id, artist, res.answer);
      return 'done';
    } catch (e) {
      lastError(`worker: ${(e && e.message) || e}`);
      // Nothing is stored on this path, or the verdict is already stored: either way the
      // artist leaves the queue so one bad artist cannot block the rest.
      try { if (artist) queue.done(artist); } catch { /* the queue is unreachable */ }
      return 'done';
    }
  }

  return { runOne };
}
