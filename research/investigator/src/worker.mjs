// The worker: one artist from the queue to a stored verdict. Cheap pass first, then one
// locked-down `claude -p`, then the decision rule (decide() is the final word), then the
// calibration mapping. Unsure means play: any failure leaves no verdict rather than a wrong one.
import { decide } from './answer.mjs';
import { applyMapping } from './calibrate.mjs';

const cut = (s, n = 300) => String(s ?? '').slice(0, n);

export function createWorker({ store, queue, cheapPass, investigate, shlabs, schedulePublish, mapping, now }) {
  const lastError = (msg) => {
    try { store.setState('queue.lastError', cut(msg)); } catch { /* nothing more to do */ }
  };

  // The stored record's IDs are the artist's own. An ID Claude found on the web fills a gap
  // only for a verdict that cannot cause a skip: a wrong ID on an `ai` verdict would put the
  // verdict on someone else.
  function withIds(artist, found, verdictWord) {
    const out = {};
    if (artist.spotifyId) out.spotifyId = artist.spotifyId;
    if (artist.channelId) out.channelId = artist.channelId;
    if (verdictWord !== 'ai' && found) {
      if (!out.spotifyId && found.spotifyId) out.spotifyId = found.spotifyId;
      if (!out.channelId && found.channelId) out.channelId = found.channelId;
    }
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
        // invalid (or any other failure): store nothing, do not retry today
        if (kind === 'invalid') store.bump(today); // Claude ran and used the subscription
        lastError(reason);
        queue.done(artist);
        return 'done';
      }

      const d = decide(res.answer);
      store.bump(today);
      const raw = d.confidence;
      const shown = d.verdict === 'ai' ? applyMapping(mapping, raw) : raw;
      const id = save(artist, res.answer, {
        verdict: d.verdict,
        confidence: shown,
        rawConfidence: raw,
        signals: d.signals,
        reasons: d.reasons,
        sources: d.sources,
      }, 'claude', today);
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
