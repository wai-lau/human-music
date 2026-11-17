// Contract check: the calibration run (service plan Task 16). It draws a fixed sample (50 Soul
// Over AI artists, up to 50 known people who started 2020 or later), runs each through Claude
// one at a time, resumes where it stopped, and keeps the results apart from the published list.
// Run from research/investigator: node tests/calibrun-contract.test.mjs
import { pickSample, runCalibration, fitSamples } from '../src/calibrun.mjs';
import { openStore } from '../src/store.mjs';
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const soa = { artists: Array.from({ length: 300 }, (_, i) => ({ name: `AI Act ${i}`, ...(i % 2 ? { spotifyId: 'A'.repeat(21) + String(i % 10) } : {}) })) };
const people = { artists: Array.from({ length: 70 }, (_, i) => ({ name: `Person ${i}`, firstRelease: i < 60 ? 2020 + (i % 5) : 2015 })) };

await t('the sample is 50 and 50, people only from 2020 on, and the seed reproduces it', () => {
  const a = pickSample({ soa, people, seed: 42 });
  const b = pickSample({ soa, people, seed: 42 });
  const c = pickSample({ soa, people, seed: 7 });
  const okPeople = a.people.every((p) => Number(p.name.split(' ')[1]) < 60);
  return (a.ai.length === 50 && a.people.length === 50 && a.seed === 42 && okPeople && J(a) === J(b) && J(a.ai) !== J(c.ai)) || J({ ai: a.ai.length, people: a.people.length, okPeople, same: J(a) === J(b) });
});
await t('fewer people than 50 gives all of them', () => {
  const s = pickSample({ soa, people: { artists: people.artists.slice(0, 10) }, seed: 1 });
  return s.people.length === 10 || s.people.length;
});

const fakeInvestigate = (verdictFor) => {
  const calls = [];
  const fn = async (artist, evidence, opts) => {
    calls.push({ name: artist.name, model: opts && opts.model, spotifyId: artist.spotifyId });
    const v = verdictFor(artist.name);
    if (v === 'limit') return { ok: false, kind: 'limit', detail: 'usage limit' };
    if (v === 'invalid') return { ok: false, kind: 'invalid', detail: 'bad' };
    return { ok: true, answer: { verdict: v, confidence: v === 'ai' ? 97 : 80, signals: v === 'ai' ? ['deezer_ai_label'] : [], reasons: ['r'], sources: ['https://a.test/1', 'https://b.test/2'] } };
  };
  fn.calls = calls;
  return fn;
};
const decide = (a) => ({ ...a });

await t('every artist runs once per model, with its model and IDs; results are stored by model', async () => {
  const store = openStore(':memory:');
  const sample = pickSample({ soa, people, seed: 3 });
  const inv = fakeInvestigate((n) => (n.startsWith('AI') ? 'ai' : 'human'));
  const r = await runCalibration({ store, investigate: inv, decide, sample, model: 'sonnet' });
  const res = store.getState('calibration.results.sonnet') || {};
  const withId = inv.calls.find((c) => c.spotifyId);
  return (r.done === 100 && inv.calls.length === 100 && inv.calls.every((c) => c.model === 'sonnet') && Object.keys(res).length === 100 && !!withId && store.listPublishable().length === 0) || J({ r, calls: inv.calls.length, stored: Object.keys(res).length });
});
await t('a usage limit stops the run and keeps what it has; the next run resumes without repeats', async () => {
  const store = openStore(':memory:');
  const sample = pickSample({ soa, people, seed: 5 });
  let budget = 30;
  const first = fakeInvestigate(() => (budget-- > 0 ? 'ai' : 'limit'));
  const r1 = await runCalibration({ store, investigate: first, decide, sample, model: 'opus' });
  const second = fakeInvestigate(() => 'human');
  const r2 = await runCalibration({ store, investigate: second, decide, sample, model: 'opus' });
  const firstNames = new Set(first.calls.slice(0, 30).map((c) => c.name));
  const repeated = second.calls.filter((c) => firstNames.has(c.name)).length;
  return (r1.stopped === 'limit' && r1.done === 30 && repeated === 0 && r2.done === 100 && Object.keys(store.getState('calibration.results.opus')).length === 100) || J({ r1, r2, repeated });
});
await t('an invalid answer is recorded as failed and retried once on the next run, then left', async () => {
  const store = openStore(':memory:');
  const sample = { seed: 1, ai: [{ name: 'AI Act 1' }], people: [] };
  const bad = fakeInvestigate(() => 'invalid');
  await runCalibration({ store, investigate: bad, decide, sample, model: 'opus' });
  await runCalibration({ store, investigate: bad, decide, sample, model: 'opus' });
  await runCalibration({ store, investigate: bad, decide, sample, model: 'opus' });
  return bad.calls.length === 2 || 'calls ' + bad.calls.length;
});
await t('fitSamples gives the AI verdicts as fit samples with the truth attached', async () => {
  const store = openStore(':memory:');
  const sample = { seed: 1, ai: [{ name: 'AI Act 1' }, { name: 'AI Act 2' }], people: [{ name: 'Person 1' }, { name: 'Person 2' }] };
  const inv = fakeInvestigate((n) => (n === 'AI Act 2' ? 'unsure' : n === 'Person 2' ? 'ai' : n.startsWith('AI') ? 'ai' : 'human'));
  await runCalibration({ store, investigate: inv, decide, sample, model: 'opus' });
  const s = fitSamples(store.getState('calibration.results.opus')).sort((x, y) => x.name.localeCompare(y.name));
  return J(s) === J([{ raw: 97, truthAi: true, name: 'AI Act 1' }, { raw: 97, truthAi: false, name: 'Person 2' }]) || J(s);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
