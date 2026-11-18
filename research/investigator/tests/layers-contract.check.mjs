// Contract for the layered investigator (Wai, 2026-11-18: "investigator should search in layers,
// each layer should pass or fail / pre-2020 / previously searched / ai list / shlabs (only go to
// Claude 'manual' investigator if API hit limits)"). Order, each layer settling the artist and
// stopping the rest:
//   1. a release before 2020 (the cheap pass): made by people;
//   2. a stored verdict (the queue already skips those);
//   3. an AI list (Zoundhub, Soul Over AI, Cevval): AI at 100, model 'list';
//   4. SH Labs on the artist's top two songs (from Spotify's embed page): both 85 or more = AI
//      (confidence 94, model 'shlabs'); both under 50 = made by people (confidence 95);
//   5. Claude's checklist research, ONLY when SH Labs can't answer: no Spotify ID or no songs on
//      its page, scores that disagree or fewer than two, an empty answer (limit or error), or the
//      day's SH Labs requests used up (shlabsDailyCap, default 190).
// Interface: createWorker({ ..., aiLists, fetchPage, shlabs, shlabsDailyCap }) where
//   aiLists.match(artist) -> Promise<{ listName, url } | null>
//   fetchPage(url) -> Promise<html>   (https://open.spotify.com/embed/artist/<spotifyId>)
//   shlabs.scoreTracks(ids) -> Promise<[{ trackId, probability, ... }]>
// SH Labs requests per day are counted in the store's state as 'shlabs.requests.<YYYY-MM-DD>'.
// Run from research/investigator: node tests/layers-contract.check.mjs
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { artistKeys } from '../src/names.mjs';
import { CODES } from '../src/checklist.mjs';

const NOW = new Date('2026-11-18T12:00:00Z');
const DAY = '2026-11-18';
const SP = 'S'.repeat(22);
const T1 = 'A'.repeat(22);
const T2 = 'B'.repeat(22);
const J = (v) => JSON.stringify(v);
const art = (name, o = {}) => ({ name, site: 'spotify', spotifyId: SP, songs: [{ title: 'S', album: '', artUrl: '' }], playing: false, ...o });
const embed = `"spotify:track:${T1}" "spotify:track:${T2}"`;
const signs = () => Object.fromEntries(CODES.map((c) => [c, 'unknown']));

function setup(o = {}) {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => NOW, cap: 100 });
  const calls = { cheap: 0, lists: 0, pages: 0, shlabs: 0, claude: 0 };
  const w = createWorker({
    store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {},
    cheapPass: async () => { calls.cheap++; return o.cheap ? o.cheap() : null; },
    aiLists: { match: async () => { calls.lists++; return o.list ? o.list() : null; } },
    fetchPage: async () => { calls.pages++; if (o.page === 'throw') throw new Error('blocked'); return o.page !== undefined ? o.page : embed; },
    shlabs: { scoreTracks: async (ids) => { calls.shlabs++; return o.scores ? o.scores(ids) : []; } },
    shlabsDailyCap: o.cap,
    investigate: async () => { calls.claude++; const s = signs(); s.M4 = 'found'; return { ok: true, checklist: { signs: s, genres: ['pop'], sources: ['https://x.example/a'], summary: 's' } }; },
  });
  return { store, queue, w, calls };
}
const verdictOf = (store, a) => store.findVerdict(artistKeys(a));
const scoresOf = (ps) => (ids) => ids.map((id, i) => ({ trackId: id, probability: ps[i], label: '', generator: null, audioSource: 'full', at: NOW.toISOString() }));

await run([
  ['1: a release before 2020 settles it; nothing else runs', async () => {
    const t = setup({ cheap: () => ({ verdict: 'human', confidence: 99, signals: ['pre_2020_release'], reasons: ['2014 album'], sources: [] }) });
    t.queue.enqueue([art('Old Band')]); await t.w.runOne();
    const v = verdictOf(t.store, art('Old Band'));
    return (v.verdict === 'human' && J(t.calls) === J({ cheap: 1, lists: 0, pages: 0, shlabs: 0, claude: 0 })) || J({ v, calls: t.calls });
  }],
  ['3: an AI list settles it: AI at 100, model list; SH Labs and Claude never run', async () => {
    const t = setup({ list: () => ({ listName: 'Zoundhub', url: 'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/zoundhub.json' }) });
    t.queue.enqueue([art('Listed')]); await t.w.runOne();
    const v = verdictOf(t.store, art('Listed'));
    return (v.verdict === 'ai' && v.confidence === 100 && v.model === 'list' && v.reasons.join(' ').includes('Zoundhub') && t.calls.shlabs === 0 && t.calls.claude === 0) || J({ v, calls: t.calls });
  }],
  ['4: both songs 85 or more: AI at 94 from SH Labs; Claude never runs; scores kept', async () => {
    const t = setup({ scores: scoresOf([96.1, 91.4]) });
    t.queue.enqueue([art('Loud Bot')]); await t.w.runOne();
    const v = verdictOf(t.store, art('Loud Bot'));
    return (v.verdict === 'ai' && v.confidence === 94 && v.model === 'shlabs' && t.calls.claude === 0 && t.calls.pages === 1) || J({ v, calls: t.calls });
  }],
  ['4: both songs under 50: made by people at 95 from SH Labs; Claude never runs', async () => {
    const t = setup({ scores: scoresOf([3.2, 11.0]) });
    t.queue.enqueue([art('Real Band')]); await t.w.runOne();
    const v = verdictOf(t.store, art('Real Band'));
    return (v.verdict === 'human' && v.confidence === 95 && v.model === 'shlabs' && t.calls.claude === 0) || J({ v, calls: t.calls });
  }],
  ['5: scores that disagree go to Claude', async () => {
    const t = setup({ scores: scoresOf([96, 20]) });
    t.queue.enqueue([art('Mixed')]); await t.w.runOne();
    const v = verdictOf(t.store, art('Mixed'));
    return (t.calls.claude === 1 && v && v.model === 'claude-score') || J({ v, calls: t.calls });
  }],
  ['5: one score only goes to Claude', async () => {
    const t = setup({ scores: (ids) => scoresOf([97])(ids.slice(0, 1)) });
    t.queue.enqueue([art('One')]); await t.w.runOne();
    return t.calls.claude === 1 || J(t.calls);
  }],
  ['5: an empty SH Labs answer (its limit, or an error) goes to Claude', async () => {
    const t = setup({ scores: () => [] });
    t.queue.enqueue([art('Limit')]); await t.w.runOne();
    return (t.calls.shlabs === 1 && t.calls.claude === 1) || J(t.calls);
  }],
  ['5: no Spotify ID: no page, no SH Labs, straight to Claude', async () => {
    const t = setup({ scores: scoresOf([99, 99]) });
    t.queue.enqueue([art('YTM Only', { site: 'ytm', spotifyId: undefined, channelId: 'UC' + 'c'.repeat(22) })]); await t.w.runOne();
    return (t.calls.pages === 0 && t.calls.shlabs === 0 && t.calls.claude === 1) || J(t.calls);
  }],
  ['5: no songs on the page, or the page fails: Claude', async () => {
    const a = setup({ page: 'nothing here' }); a.queue.enqueue([art('Empty')]); await a.w.runOne();
    const b = setup({ page: 'throw' }); b.queue.enqueue([art('Blocked')]); await b.w.runOne();
    return (a.calls.shlabs === 0 && a.calls.claude === 1 && b.calls.shlabs === 0 && b.calls.claude === 1) || J([a.calls, b.calls]);
  }],
  ['5: the day\'s SH Labs requests used up: SH Labs is not called, Claude runs', async () => {
    const t = setup({ cap: 4, scores: scoresOf([99, 99]) });
    t.store.setState(`shlabs.requests.${DAY}`, 4);
    t.queue.enqueue([art('Late')]); await t.w.runOne();
    return (t.calls.shlabs === 0 && t.calls.claude === 1) || J(t.calls);
  }],
  ['SH Labs requests are counted per day (two per artist scored)', async () => {
    const t = setup({ scores: scoresOf([99, 98]) });
    t.queue.enqueue([art('Count A'), art('Count B', { spotifyId: 'Q'.repeat(22) })]); await t.w.runOne(); await t.w.runOne();
    return t.store.getState(`shlabs.requests.${DAY}`) === 4 || J(t.store.getState(`shlabs.requests.${DAY}`));
  }],
  ['the SH Labs layer never runs without a client (no key): Claude decides', async () => {
    const t = setup({});
    t.queue.enqueue([art('No Key')]);
    const w2 = createWorker({ store: t.store, queue: t.queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {}, cheapPass: async () => null, aiLists: { match: async () => null }, fetchPage: async () => embed, shlabs: null,
      investigate: async () => { t.calls.claude++; return { ok: true, checklist: { signs: signs(), genres: [], sources: [], summary: '' } }; } });
    await w2.runOne();
    return t.calls.claude === 1 || J(t.calls);
  }],
]);
