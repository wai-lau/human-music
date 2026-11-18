// The evidence-weights experiment runner and report (src/checklistrun.mjs).
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { CODES } from '../src/checklist.mjs';
import { runChecklist, reportChecklist, measuredPoints } from '../src/checklistrun.mjs';

const J = (v) => JSON.stringify(v);
const blank = () => Object.fromEntries(CODES.map((c) => [c, 'unknown']));
const SAMPLE = { ai: [{ name: 'Bot', spotifyId: 'B'.repeat(22) }], people: [{ name: 'Band' }] };
const ok = (signs) => ({ ok: true, checklist: { signs, genres: ['pop'], sources: ['https://a.example/x'], summary: 's' } });

await run([
  ['runs every artist once in checklist mode and keeps the checklist with the truth', async () => {
    const store = openStore(':memory:');
    const calls = [];
    const investigate = async (a, ev, o) => { calls.push([a.name, o.mode, o.model, a.spotifyId]); return ok({ ...blank(), M4: a.name === 'Bot' ? 'found' : 'not_found' }); };
    const r1 = await runChecklist({ store, investigate, sample: SAMPLE, model: 'opus' });
    const r2 = await runChecklist({ store, investigate, sample: SAMPLE, model: 'opus' });
    const res = store.getState('checklist.results.opus');
    return (r1.done === 2 && r2.done === 2 && calls.length === 2 && J(calls[0]) === J(['Bot', 'checklist', 'opus', 'B'.repeat(22)])
      && res.Bot.truthAi === true && res.Bot.signs.M4 === 'found' && res.Band.truthAi === false) || J({ r1, r2, calls, res });
  }],
  ['a failure is tried once more on the next run, then left; a usage limit stops the run', async () => {
    const store = openStore(':memory:');
    let n = 0;
    const flaky = async () => { n++; return { ok: false, kind: 'invalid', detail: 'bad' }; };
    await runChecklist({ store, investigate: flaky, sample: SAMPLE, model: 'opus' });
    await runChecklist({ store, investigate: flaky, sample: SAMPLE, model: 'opus' });
    await runChecklist({ store, investigate: flaky, sample: SAMPLE, model: 'opus' });
    const s2 = openStore(':memory:');
    const lim = await runChecklist({ store: s2, investigate: async () => ({ ok: false, kind: 'limit' }), sample: SAMPLE, model: 'opus' });
    return (n === 4 && lim.stopped === 'limit' && lim.done === 0) || J({ n, lim });
  }],
  ['measured points: 10*log10 of the found rates, half a count added to each side', () => {
    const a = measuredPoints(10, 20, 1, 20); // (10.5/21)/(1.5/21) = 7: 8.5
    const b = measuredPoints(0, 20, 0, 20);  // equal: 0
    const c = measuredPoints(0, 20, 10, 20); // 1/21 over 10.5/21: -13.2
    return (a === 8.5 && b === 0 && c === -13.2) || J([a, b, c]);
  }],
  ['the report: a row per sign, a row per artist by P(AI), and the catch and error counts', () => {
    const results = {
      Bot: { truthAi: true, signs: { ...blank(), M4: 'found' }, genres: ['pop'], sources: [] },
      Band: { truthAi: false, signs: { ...blank(), P3: 'found' }, genres: ['rock'], sources: [] },
      Gone: { failed: 2 },
    };
    const score = ({ signs }) => (signs.M4 === 'found'
      ? { probability: 0.74, verdict: 'ai', confidence: 74, faceless: false }
      : { probability: 0.003, verdict: 'human', confidence: 100, faceless: false });
    const text = reportChecklist(results, { signsTable: { M4: { group: 'C', points: 14 } }, score });
    return (text.includes('1 known AI, 1 known people (1 failed)') && text.includes('| M4 | 1/1 | 0/1 | 1/2 | 4.8 | 14 |')
      && text.indexOf('| Bot |') < text.indexOf('| Band |') && text.includes('at 60: 1/1 known AI caught, 0/1 known people called AI')
      && text.includes('at 95: 0/1 known AI caught')) || text;
  }],
]);
