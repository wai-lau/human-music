// Contract: SH Labs' own percentage counts (Wai, 2026-11-20: "SH Labs API returns a percentage, we
// should take their confidence into account / like if they are highly confident we don't need to
// make another check", then "A"). For both SH Labs paths in src/worker.mjs (Spotify track IDs with
// shlabs.scoreTracks, and ISRCs with shlabs.scoreIsrcs), the songs are scored ONE AT A TIME:
//   1. Score the first song. Under 8: made by people, confidence 95, model 'shlabs', signals ['P16'];
//      the second song is never scored, and the day's request count goes up by 1.
//   2. Otherwise score the second song (count +2 in all):
//      both 95 or more: AI, confidence 95, model 'shlabs', signals ['M3']   (Optimal, 94, skips)
//      both 85 or more: AI, confidence 90, model 'shlabs', signals ['M3']   (Aggressive only)
//      both under 50:   made by people, confidence 95, model 'shlabs', signals ['P16']
//      anything else, or fewer than two scores: on to Claude, as today.
// Measured on 259 known AI and 231 people (research/calibration/weights-628.md): first song under 8
// was 4 AI and 101 people; both 95+ was 75 AI and 0 people; both 85+ was 205 AI and 2 people.
// The layer still needs room for two requests under the day's cap before it starts.
// Run from research/investigator: node tests/shlabs-graded-contract.check.mjs
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { artistKeys } from '../src/names.mjs';
import { CODES } from '../src/checklist.mjs';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY = '2026-11-20';
const SP = 'S'.repeat(22), T1 = 'A'.repeat(22), T2 = 'B'.repeat(22);
const ISRC1 = 'QZABC2400001', ISRC2 = 'QZABC2400002';
const J = (v) => JSON.stringify(v);
const embed = `"spotify:track:${T1}" "spotify:track:${T2}"`;
const signs = () => Object.fromEntries(CODES.map((c) => [c, 'unknown']));

// probs: SH Labs' answer per song, in order. Each scoring call is recorded with the ids it got.
function setup(probs, { path = 'spotify' } = {}) {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => NOW, cap: 100 });
  const calls = { scored: [], claude: 0 };
  const answer = (ids) => ids.map((id) => {
    const i = calls.scored.flat().length; calls.scored.push([id]);
    const p = probs[i];
    return p === undefined ? null : { trackId: id, probability: p, label: '', generator: null, audioSource: 'preview', at: NOW.toISOString() };
  }).filter(Boolean);
  const w = createWorker({
    store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {},
    cheapPass: async () => null, aiLists: { match: async () => null },
    fetchPage: async () => embed,
    isrcLinker: { isrcsFor: async () => [ISRC1, ISRC2] },
    shlabs: { scoreTracks: async (ids) => answer(ids), scoreIsrcs: async (ids) => answer(ids) },
    investigate: async () => { calls.claude++; return { ok: true, checklist: { signs: signs(), genres: [], sources: [], summary: '' } }; },
  });
  const artist = path === 'spotify'
    ? { name: 'Some Act', site: 'spotify', spotifyId: SP, songs: [{ title: 'S', album: '', artUrl: '' }], playing: true }
    : { name: 'Some Act', site: 'ytm', channelId: 'UC' + 'c'.repeat(22), songs: [{ title: 'S', album: '', artUrl: '' }], playing: true };
  return { store, queue, w, calls, artist };
}
async function go(probs, o) {
  const t = setup(probs, o);
  t.queue.enqueue([t.artist]); await t.w.runOne();
  const v = t.store.findVerdict(artistKeys(t.artist));
  return { v, calls: t.calls, used: t.store.getState(`shlabs.requests.${DAY}`) };
}
const each = ['spotify', 'isrc'];

await run([
  ...each.map((path) => [`${path}: a first song under 8 settles made by people at 95 with one request`, async () => {
    const r = await go([4.2, 99], { path });
    return (r.v && r.v.verdict === 'human' && r.v.confidence === 95 && r.v.model === 'shlabs' && r.calls.scored.length === 1 && r.used === 1 && r.calls.claude === 0) || J(r);
  }]),
  ...each.map((path) => [`${path}: both songs 95 or more is AI at 95 (two requests, one at a time)`, async () => {
    const r = await go([96.4, 95.1], { path });
    return (r.v && r.v.verdict === 'ai' && r.v.confidence === 95 && r.v.model === 'shlabs' && r.calls.scored.length === 2 && r.calls.scored.every((c) => c.length === 1) && r.used === 2 && r.calls.claude === 0) || J(r);
  }]),
  ...each.map((path) => [`${path}: both 85 or more, not both 95: AI at 90`, async () => {
    const r = await go([96.4, 88.0], { path });
    return (r.v && r.v.verdict === 'ai' && r.v.confidence === 90 && r.calls.claude === 0) || J(r);
  }]),
  ['a first song of exactly 8 is not a shortcut: the second song is scored', async () => {
    const r = await go([8, 9]);
    return (r.calls.scored.length === 2 && r.v && r.v.verdict === 'human' && r.v.confidence === 95) || J(r);
  }],
  ['both under 50 (first not under 8) is made by people at 95', async () => {
    const r = await go([30, 12]);
    return (r.v && r.v.verdict === 'human' && r.v.confidence === 95 && r.calls.scored.length === 2) || J(r);
  }],
  ['mixed scores go to Claude', async () => {
    const r = await go([96, 30]);
    return (r.calls.claude === 1 && (!r.v || r.v.model !== 'shlabs')) || J(r);
  }],
  ['a missing second score goes to Claude', async () => {
    const r = await go([96]);
    return (r.calls.claude === 1 && r.calls.scored.length === 2) || J(r);
  }],
]);
