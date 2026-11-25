// Build the published verdict list: exactly the fields the extension's parseFilterList reads,
// plus `checked` (ignored by the extension). Reasons, sources, signals and SH Labs data stay home.

import { applyMapping } from './calibrate.mjs';
import { mayPass94 } from './answer.mjs';
import { normalizeName } from './names.mjs';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_ID = /^UC[\w-]{22}$/;
const WORDS = new Set(['ai', 'human', 'unsure']);

const clampInt = (n) => Math.max(0, Math.min(100, Math.round(n)));

export function buildList(verdicts, { now, calibrated, mapping } = {}) {
  const rows = [];
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    if (!v || v.source === 'calibration') continue;
    if (typeof v.name !== 'string' || v.name.trim() === '' || !WORDS.has(v.verdict)) continue;
    // Only AI verdicts are public (Wai, 2026-11-18): the others would be a dated record of
    // the people in her queues. They stay in the droplet's store, which skips them next time.
    if (v.verdict !== 'ai') continue;
    let confidence;
    if (v.verdict === 'ai') {
      const raw = Number.isFinite(v.rawConfidence) ? v.rawConfidence : v.confidence;
      // A scored verdict is already a probability with its own caps; the calibration mapping is
      // for Claude's own number only.
      // A list verdict is absolute (Wai, 2026-11-18: "treat the lists and YTM tags as absolute"),
      // and SH Labs' two-track verdict carries its own fixed confidence: neither goes through it.
      const own = v.model === 'claude-score' || v.model === 'list' || v.model === 'spotify-label' || v.model === 'shlabs';
      confidence = own ? clampInt(v.confidence) : applyMapping(mapping, raw);
      // A verdict that didn't meet the rule stays at 94 at most, whatever the fit says. Since
      // 2026-11-19 that is Optimal's threshold, so Optimal skips it (Wai's choice that day).
      if (v.model !== 'list' && v.model !== 'spotify-label' && !mayPass94(v)) confidence = Math.min(confidence, 94);
    } else {
      confidence = Number.isFinite(v.confidence) ? clampInt(v.confidence) : 0;
    }
    // A Spotify-labelled entry names the artist as labelName and carries titles, with no plain name: a
    // copy that doesn't know titles drops it instead of matching the name alone.
    const labelled = v.model === 'spotify-label' && Array.isArray(v.titles);
    const entry = { [labelled ? 'labelName' : 'name']: v.name, verdict: v.verdict, confidence, checked: typeof v.checked === 'string' ? v.checked : '' };
    if (typeof v.spotifyId === 'string' && SPOTIFY_ID.test(v.spotifyId)) entry.spotifyId = v.spotifyId;
    if (typeof v.channelId === 'string' && YOUTUBE_ID.test(v.channelId)) entry.channelId = v.channelId;
    if (labelled) entry.titles = v.titles.filter((t) => typeof t === 'string');
    rows.push([normalizeName(v.name), entry]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const list = {
    name: 'Human Music verdicts',
    updated: (now instanceof Date ? now : new Date()).toISOString(),
    calibrated: calibrated === true,
    artists: rows.map((r) => r[1]),
  };
  return JSON.stringify(list, null, 2) + '\n';
}
