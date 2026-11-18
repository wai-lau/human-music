// The SH Labs accuracy experiment (src/shlabsrun.mjs).
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { trackIdsFromEmbed, runShLabs, shlabsReadings, reportShLabs } from '../src/shlabsrun.mjs';
import { measuredPoints } from '../src/checklistrun.mjs';

const J = (v) => JSON.stringify(v);
const T = (c) => c.repeat(22);
const page = (...ids) => `<html>${ids.map((i) => `"uri":"spotify:track:${i}"`).join(' ')} "spotify:track:${ids[0]}"</html>`;

await run([
  ['track IDs: the first n distinct ones, in page order', () =>
    J(trackIdsFromEmbed(page(T('a'), T('a'), T('b'), T('c')), 2)) === J([T('a'), T('b')]) && J(trackIdsFromEmbed('nothing')) === '[]'],
  ['each labelled artist with a Spotify ID gets its top tracks scored once, resumably', async () => {
    const store = openStore(':memory:');
    const pages = []; const scored = [];
    const fetchPage = async (u) => { pages.push(u); return page(T('x'), T('y'), T('z')); };
    const shlabs = { scoreTracks: async (ids) => { scored.push(ids); return ids.map((id) => ({ trackId: id, probability: 91, label: 'Pure AI Generated' })); } };
    const sample = { ai: [{ name: 'Bot', spotifyId: T('B') }], people: [{ name: 'Band', spotifyId: T('P') }, { name: 'No Id' }] };
    const r1 = await runShLabs({ store, fetchPage, shlabs, sample });
    const r2 = await runShLabs({ store, fetchPage, shlabs, sample });
    const res = store.getState('shlabs.results');
    return (r1.done === 2 && r1.requests === 4 && r2.requests === 0 && pages.length === 2 && pages[0].endsWith(`/embed/artist/${T('B')}`)
      && J(scored[0]) === J([T('x'), T('y')]) && res.Bot.truthAi === true && res.Bot.tracks[0].probability === 91 && !('No Id' in res)) || J({ r1, r2, res });
  }],
  ['the request cap stops the run before going over', async () => {
    const store = openStore(':memory:');
    const shlabs = { scoreTracks: async (ids) => ids.map((id) => ({ trackId: id, probability: 10 })) };
    const sample = { ai: [1, 2, 3].map((i) => ({ name: `A${i}`, spotifyId: T(String(i)) })), people: [] };
    const r = await runShLabs({ store, fetchPage: async () => page(T('x'), T('y')), shlabs, sample, maxRequests: 5 });
    return (r.requests === 4 && r.stopped === 'request cap' && r.done === 2) || J(r);
  }],
  ['three empty answers in a row stop the run (out of quota)', async () => {
    const store = openStore(':memory:');
    const sample = { ai: [1, 2, 3, 4].map((i) => ({ name: `A${i}`, spotifyId: T(String(i)) })), people: [] };
    const r = await runShLabs({ store, fetchPage: async () => page(T('x')), shlabs: { scoreTracks: async () => [] }, sample });
    return (r.stopped && /quota/.test(r.stopped) && r.done === 0) || J(r);
  }],
  ['readings: 85+ and under 50, on one and on two tracks', () => {
    const r = (ps) => shlabsReadings({ tracks: ps.map((p) => ({ probability: p })) });
    return J(r([90, 88])) === J({ high2: true, high1: true, low2: false, low1: false }) && J(r([90, 10])) === J({ high2: false, high1: true, low2: false, low1: true })
      && J(r([3, 12])) === J({ high2: false, high1: false, low2: true, low1: true }) && r([]) === null;
  }],
  ['the report counts each reading for AI and for people', () => {
    const text = reportShLabs({ Bot: { truthAi: true, tracks: [{ probability: 95 }, { probability: 90, label: 'Pure AI Generated' }] }, Band: { truthAi: false, tracks: [{ probability: 4 }, { probability: 2 }] } }, measuredPoints);
    return (text.includes('| 85+ on two tracks (M3) | 1/1 | 0/1 | 4.8 |') && text.includes('| under 50 on two tracks (P16) | 0/1 | 1/1 | -4.8 |') && text.includes('| Bot | AI | 95, 90 (Pure AI Generated) |')) || text;
  }],
]);
