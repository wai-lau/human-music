// The worker: one artist from the queue to a stored verdict. Cheap pass first, then one
// locked-down `claude -p`, then the decision rule (decide() is the final word), then the
// calibration mapping. Unsure means play: any failure leaves no verdict rather than a wrong one.
// Layered decision (Wai, 2026-11-18): cheap pass -> stored verdict -> AI list -> SH Labs -> Claude.
// SH Labs alone gives AI at 90: below Optimal's 94, so Optimal never skips on SH Labs alone;
// Aggressive (80) does. On 216 people from MusicBrainz, 2 scored 85+ on both songs (one a
// Taipei singer-songwriter the checklist rates unsure), so SH Labs alone must not reach Optimal
// (2026-11-20, interim until Wai's call; it was 94, equal to the new Optimal).
const SHLABS_AI_CONFIDENCE = 90;
import { decide, mayPass94 } from './answer.mjs';
import { applyMapping } from './calibrate.mjs';
import { scoreChecklist } from './score.mjs';
import { trackIdsFromEmbed } from './shlabsrun.mjs';

// Scored verdicts keep the old names of their strong signs too, so the published list's 95 rule
// (mayPass94) sees them.
const STRONG_NAMES = { S1: 'deezer_ai_label', S2: 'own_disclosure', S3: 'youtube_ai_label', S4: 'tracker_listing' };

const cut = (s, n = 300) => String(s ?? '').slice(0, n);

export function createWorker({ store, queue, cheapPass, investigate, shlabs, schedulePublish, mapping, now, fetchArt, lookArt, scoring = false, aiLists, fetchPage, shlabsDailyCap, isrcLinker }) {
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

      // AI list layer: a listing on a known AI blocklist settles the artist as AI at 100.
      if (aiLists) {
        try {
          const listing = await aiLists.match(artist);
          if (listing) {
            save(artist, null, {
              verdict: 'ai',
              confidence: 100,
              rawConfidence: 100,
              signals: ['S4', 'tracker_listing'],
              reasons: [`on ${listing.listName}`],
              sources: [listing.url],
            }, 'list', today);
            queue.done(artist);
            schedulePublish();
            return 'done';
          }
        } catch { /* list check failed; fall through */ }
      }

      // SH Labs layer: score the artist's top two tracks via Spotify's embed page.
      // Both scores 85+ -> AI at 94; both under 50 -> human at 95; otherwise fall through to Claude.
      if (shlabs && artist.spotifyId && fetchPage) {
        try {
          const cap = shlabsDailyCap !== undefined ? shlabsDailyCap : 190;
          const key = `shlabs.requests.${today}`;
          const used = typeof store.getState(key) === 'number' ? store.getState(key) : 0;
          if (used + 2 <= cap) {
            const html = await fetchPage(`https://open.spotify.com/embed/artist/${artist.spotifyId}`);
            const ids = trackIdsFromEmbed(html, 2);
            if (ids.length === 2) {
              const scores = await shlabs.scoreTracks(ids);
              store.setState(key, used + 2);
              if (scores.length === 2) {
                const p1 = scores[0].probability;
                const p2 = scores[1].probability;
                const keep = (id) => { try { store.putScores(id, scores); } catch { /* optional */ } };
                if (p1 >= 85 && p2 >= 85) {
                  keep(save(artist, null, {
                    verdict: 'ai',
                    confidence: SHLABS_AI_CONFIDENCE,
                    rawConfidence: Math.round(Math.min(p1, p2)),
                    signals: ['M3'],
                    reasons: [`${p1.toFixed(1)}% and ${p2.toFixed(1)}% on SH Labs`],
                    sources: ['https://shlabs.music'],
                  }, 'shlabs', today));
                  queue.done(artist);
                  schedulePublish();
                  return 'done';
                }
                if (p1 < 50 && p2 < 50) {
                  keep(save(artist, null, {
                    verdict: 'human',
                    confidence: 95,
                    rawConfidence: Math.round(Math.max(p1, p2)),
                    signals: ['P16'],
                    reasons: [`${p1.toFixed(1)}% and ${p2.toFixed(1)}% on SH Labs`],
                    sources: ['https://shlabs.music'],
                  }, 'shlabs', today));
                  queue.done(artist);
                  schedulePublish();
                  return 'done';
                }
              }
            }
          }
        } catch { /* SH Labs failed or limit; fall through to Claude */ }
      }

      // SH Labs via ISRCs: for YouTube Music artists (no spotifyId), link to Deezer ISRCs and score.
      if (shlabs && !artist.spotifyId && isrcLinker) {
        try {
          const cap = shlabsDailyCap !== undefined ? shlabsDailyCap : 190;
          const key = `shlabs.requests.${today}`;
          const used = typeof store.getState(key) === 'number' ? store.getState(key) : 0;
          if (used + 2 <= cap) {
            const isrcs = await isrcLinker.isrcsFor(artist);
            if (isrcs.length === 2) {
              const scores = await shlabs.scoreIsrcs(isrcs);
              store.setState(key, used + 2);
              if (scores.length === 2) {
                const keep = (id) => { try { store.putScores(id, scores); } catch { /* optional */ } };
                const p1 = scores[0].probability;
                const p2 = scores[1].probability;
                if (p1 >= 85 && p2 >= 85) {
                  keep(save(artist, null, {
                    verdict: 'ai',
                    confidence: SHLABS_AI_CONFIDENCE,
                    rawConfidence: Math.round(Math.min(p1, p2)),
                    signals: ['M3'],
                    reasons: [`${p1.toFixed(1)}% and ${p2.toFixed(1)}% on SH Labs`],
                    sources: ['https://shlabs.music'],
                  }, 'shlabs', today));
                  queue.done(artist);
                  schedulePublish();
                  return 'done';
                }
                if (p1 < 50 && p2 < 50) {
                  keep(save(artist, null, {
                    verdict: 'human',
                    confidence: 95,
                    rawConfidence: Math.round(Math.max(p1, p2)),
                    signals: ['P16'],
                    reasons: [`${p1.toFixed(1)}% and ${p2.toFixed(1)}% on SH Labs`],
                    sources: ['https://shlabs.music'],
                  }, 'shlabs', today));
                  queue.done(artist);
                  schedulePublish();
                  return 'done';
                }
              }
            }
          }
        } catch { /* ISRC link or SH Labs failed; fall through to Claude */ }
      }

      // Scoring (Wai, 2026-11-18): Claude fills in the evidence checklist and score.mjs decides.
      // Off until Wai approves the weights going live (HM_SCORING=on).
      const res = scoring ? await investigate(artist, {}, { mode: 'checklist' }) : await investigate(artist, {});
      if (!res || res.ok !== true || (scoring && !res.checklist)) {
        const kind = res && res.kind;
        const reason = `${kind || 'error'}: ${cut(res && res.detail)}`;
        // A login, usage-limit or setup problem stops everything: keep the artist and pause.
        if (kind === 'auth' || kind === 'limit' || kind === 'setup') {
          queue.pause(reason);
          queue.requeue(artist);
          return 'paused';
        }
        // Claude ran and used the subscription, whatever the answer: a timeout, a crash, the step
        // limit or a bad answer counts toward the day's cap, retries included (Wai, 2026-11-18:
        // "track in cap").
        store.bump(today);
        // A timeout or crash may pass: try again later, twice (review 2026-11-17).
        if (kind === 'error' && queue.retryLater(artist)) {
          lastError(`${reason} (will try again)`);
          return 'retry';
        }
        // invalid (or a failure that keeps happening): store nothing, do not retry today
        lastError(reason);
        queue.done(artist);
        return 'done';
      }

      if (scoring) {
        const signs = { ...res.checklist.signs };
        const cover = await lookAtCover(artist);
        if (cover && cover.look === 'ai') signs.W4 = 'found';
        const sources = res.checklist.sources.slice(0, 5);
        const s = scoreChecklist({ signs, genres: res.checklist.genres, sources });
        store.bump(today);
        const found = Object.keys(signs).filter((k) => signs[k] !== 'unknown' && signs[k] !== 'not_found');
        const id = save(artist, null, {
          verdict: s.verdict,
          // The score is already a probability with its own caps: no calibration mapping.
          confidence: s.confidence,
          rawConfidence: Math.round(s.probability * 100),
          signals: [...found, ...found.filter((k) => STRONG_NAMES[k]).map((k) => STRONG_NAMES[k])],
          reasons: res.checklist.summary ? [res.checklist.summary] : [],
          sources,
        }, 'claude-score', today);
        if (cover) { try { store.setState(`art:${id}`, cover); } catch { /* optional */ } }
        queue.done(artist);
        schedulePublish();
        await second(id, artist, {});
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
