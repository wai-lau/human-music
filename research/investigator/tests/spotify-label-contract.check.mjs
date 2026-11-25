// Contract: Spotify's "AI Persona" label as the investigator's first layer (Wai, 2026-11-25: "auto
// add Spotify's AI labelled tracks to the Human Music Verdicts / add this as a layer in the
// investigator"). A logged-in copy of the extension reports a tagged artist with its Spotify
// artist ID and `spotifyAiLabel: true`; the server cannot see the tag itself.
//   intake.parseRequest: the boolean counts only on an item whose single credit has a Spotify ID.
//   queue.enqueue: a flagged artist is queued even with a verdict (unless that verdict is already
//     the label's), once a day; at the day's cap only flagged artists still run.
//   worker.runOne: first layer, before the cheap pass; saves ai / 100 / 100, signal M1, model
//     'spotify-label', source the artist's Spotify page; overrides an older human verdict.
//   The verdict is rechecked monthly like every other (queue.isKnown, store.listDue; changed
//   2026-11-25, recheck-all-contract.check.mjs) and publishes at 100.
// Run from research/investigator: node tests/spotify-label-contract.check.mjs
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { parseRequest } from '../src/intake.mjs';
import { artistKeys } from '../src/names.mjs';
import { buildList } from '../src/listjson.mjs';
import { CODES } from '../src/checklist.mjs';

const NOW = new Date('2026-11-25T12:00:00Z');
const LATER = new Date('2027-02-25T12:00:00Z');
const SP = 'S'.repeat(22);
const J = (v) => JSON.stringify(v);
const body = (items) => J({ items });
const item = (o = {}) => ({ title: 'T', artistLine: 'Tagged Act', credits: ['Tagged Act'], channelIds: [SP], album: '', artUrl: '', ...o });
const signs = () => Object.fromEntries(CODES.map((c) => [c, 'unknown']));
const art = (o = {}) => ({ name: 'Tagged Act', site: 'spotify', spotifyId: SP, songs: [], playing: false, spotifyAiLabel: true, ...o });
const human = { name: 'Tagged Act', spotifyId: SP, verdict: 'human', confidence: 95, rawConfidence: 95, signals: [], reasons: ['r'], sources: ['https://x.example/a'], model: 'claude-score', checked: '2026-11-24', source: 'live' };

function setup({ now = NOW, cap = 100, pre } = {}) {
  const store = openStore(':memory:');
  if (pre) store.putVerdict(pre);
  const queue = createQueue({ store, now: () => now, cap });
  const calls = { cheap: 0, lists: 0, shlabs: 0, claude: 0, pages: 0, fake: 0 };
  let published = 0;
  const w = createWorker({
    store, queue, now: () => now, mapping: null, scoring: true, schedulePublish() { published++; },
    cheapPass: async () => { calls.cheap++; return null; },
    aiLists: { match: async () => { calls.lists++; return null; } },
    fakeprintLayer: { scoreArtist: async () => { calls.fake++; return []; } },
    fetchPage: async () => { calls.pages++; return ''; },
    shlabs: { scoreTracks: async () => { calls.shlabs++; return []; } },
    investigate: async () => { calls.claude++; return { ok: true, checklist: { signs: signs(), genres: [], sources: [], summary: '' } }; },
  });
  return { store, queue, w, calls, published: () => published };
}
const verdictOf = (store) => store.findVerdict(artistKeys(art()));

await run([
  ['intake: the flag with a Spotify ID lands on the artist', () => {
    const r = parseRequest(body([item({ spotifyAiLabel: true })]));
    return (r.ok && r.artists[0].spotifyAiLabel === true && r.artists[0].spotifyId === SP) || J(r);
  }],
  ['intake: the flag without a Spotify ID is ignored, nothing rejected', () => {
    const r = parseRequest(body([item({ spotifyAiLabel: true, channelIds: [] })]));
    return (r.ok && r.artists.length === 1 && !r.artists[0].spotifyAiLabel) || J(r);
  }],
  ['intake: only the boolean true counts', () => {
    const r = parseRequest(body([item({ spotifyAiLabel: 'yes' }), item({ artistLine: 'B', credits: ['B'], channelIds: ['B'.repeat(22)], spotifyAiLabel: 1 })]));
    return (r.ok && r.artists.every((a) => !a.spotifyAiLabel)) || J(r);
  }],
  ['intake: an item without the flag is unchanged', () => {
    const r = parseRequest(body([item()]));
    return (r.ok && !('spotifyAiLabel' in r.artists[0])) || J(r);
  }],
  ['queue: a flagged artist with an older human verdict is queued', () => {
    const t = setup({ pre: human });
    const c = t.queue.enqueue([art()]);
    return (c.queued === 1 && c.known === 0) || J(c);
  }],
  ['queue: an unflagged artist with that verdict is still known', () => {
    const t = setup({ pre: human });
    const c = t.queue.enqueue([art({ spotifyAiLabel: undefined })]);
    return (c.queued === 0 && c.known === 1) || J(c);
  }],
  ['worker: the label is the first layer: ai/100/100, M1, spotify-label, over the human verdict, no other layer called', async () => {
    const t = setup({ pre: human });
    t.queue.enqueue([art()]);
    const r = await t.w.runOne();
    const v = verdictOf(t.store);
    const c = t.calls;
    const none = c.cheap + c.lists + c.fake + c.shlabs + c.pages + c.claude === 0;
    return (r === 'done' && none && v.verdict === 'ai' && v.confidence === 100 && v.rawConfidence === 100 && v.model === 'spotify-label'
      && J(v.signals) === J(['M1']) && J(v.sources) === J([`https://open.spotify.com/artist/${SP}`])
      && /AI Persona/.test(v.reasons[0]) && t.published() === 1 && t.queue.status().queued === 0) || J({ r, v, c });
  }],
  ['worker: an unflagged artist still goes through the other layers first', async () => {
    const t = setup();
    t.queue.enqueue([art({ spotifyAiLabel: undefined })]);
    await t.w.runOne();
    return t.calls.cheap === 1 || J(t.calls);
  }],
  ['the label verdict is due again a month later, like every verdict (it was exempt before 2026-11-25)', () => {
    const t = setup({ now: LATER, pre: { ...human, verdict: 'ai', confidence: 100, rawConfidence: 100, model: 'spotify-label', signals: ['M1'] } });
    const c = t.queue.enqueue([art({ spotifyAiLabel: undefined })]);
    return (c.known === 0 && c.queued === 1) || J(c);
  }],
  ['an already-labelled artist reported again is known, not requeued', () => {
    const t = setup({ pre: { ...human, verdict: 'ai', confidence: 100, rawConfidence: 100, model: 'spotify-label', signals: ['M1'] } });
    const c = t.queue.enqueue([art()]);
    return (c.known === 1 && c.queued === 0) || J(c);
  }],
  ['queue: a flagged artist is queued once a day', () => {
    const t = setup({ pre: human });
    const a = t.queue.enqueue([art()]);
    const b = t.queue.enqueue([art()]);
    return (a.queued === 1 && b.queued === 0) || J({ a, b });
  }],
  ['queue: the flag joins an artist already waiting without it', async () => {
    const t = setup();
    t.queue.enqueue([art({ spotifyAiLabel: undefined })]);
    t.queue.enqueue([art()]);
    await t.w.runOne();
    const v = verdictOf(t.store);
    return (v && v.model === 'spotify-label' && t.calls.cheap === 0) || J({ v, c: t.calls });
  }],
  ['cap: at the day\'s cap a flagged artist still runs and is not counted; others wait', async () => {
    const t = setup({ cap: 1 });
    t.store.bump('2026-11-25');
    t.queue.enqueue([art({ name: 'Other', spotifyId: 'O'.repeat(22), spotifyAiLabel: undefined }), art()]);
    const r = await t.w.runOne();
    const next = await t.w.runOne();
    return (r === 'done' && verdictOf(t.store).model === 'spotify-label' && next === 'idle' && t.store.count('2026-11-25') === 1) || J({ r, next });
  }],
  ['published at 100 with the Spotify ID', async () => {
    const t = setup();
    t.queue.enqueue([art()]); await t.w.runOne();
    const l = JSON.parse(buildList(t.store.listPublishable(), { now: NOW, calibrated: false, mapping: null }));
    const e = (l.artists || [])[0];
    return (e && e.confidence === 100 && e.spotifyId === SP) || J(l);
  }],
  ['listed as due a month later (it was exempt before 2026-11-25)', () => {
    const t = setup({ now: LATER, pre: { ...human, verdict: 'ai', model: 'spotify-label', checked: '2026-01-01' } });
    return t.store.listDue('2027-02-25', 10, 30).length === 1 || 'not listed as due';
  }],
]);
