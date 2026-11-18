// The evidence-weights experiment (Wai, 2026-11-18: "measure the weights on 40 labelled artists
// (20 AI, 20 small people), then you approve the numbers"). Claude fills in the checklist for each
// labelled artist, resumably; the report shows how often each sign was found for AI artists and
// for people, the weight that implies, the research's weight beside it, and what the scoring
// would decide for each artist. Nothing here publishes or changes live investigations.
import { CODES } from './checklist.mjs';

const resultsKey = (model) => `checklist.results.${model}`;

// sample: { ai: [{ name, spotifyId?, youtubeChannelId? }], people: [...] }
export async function runChecklist({ store, investigate, sample, model, log = () => {} }) {
  const results = store.getState(resultsKey(model)) || {};
  const all = [
    ...(sample.ai || []).map((a) => ({ ...a, truthAi: true })),
    ...(sample.people || []).map((a) => ({ ...a, truthAi: false })),
  ];
  let stopped = null;
  for (const a of all) {
    const prev = results[a.name];
    if (prev && !prev.failed) continue;
    if (prev && prev.failed >= 2) continue;
    const artist = { name: a.name, site: 'spotify', playing: false, songs: [] };
    if (a.spotifyId) artist.spotifyId = a.spotifyId;
    if (a.youtubeChannelId) artist.channelId = a.youtubeChannelId;
    let r;
    try { r = await investigate(artist, {}, { model, mode: 'checklist' }); } catch (e) { r = { ok: false, kind: 'error', detail: String(e) }; }
    if (!r || !r.ok || !r.checklist) {
      const kind = r && r.kind;
      if (kind === 'auth' || kind === 'limit' || kind === 'setup') { stopped = kind; break; }
      results[a.name] = { failed: ((prev && prev.failed) || 0) + 1, detail: String((r && r.detail) || '').slice(0, 200) };
    } else {
      results[a.name] = { truthAi: a.truthAi, ...r.checklist };
    }
    store.setState(resultsKey(model), results);
    log(`${Object.values(results).filter((x) => !x.failed).length} of ${all.length} done (${a.name})`);
  }
  const done = Object.values(results).filter((x) => !x.failed).length;
  return stopped ? { done, total: all.length, stopped } : { done, total: all.length };
}

// The weight a sign earns from the run: how much likelier it is found for AI artists than for
// people, as points (10*log10 of the ratio), with half a count added to each side so a sign seen
// on one side only still gets a finite number. n is small, so these are rough.
export function measuredPoints(foundAi, nAi, foundPeople, nPeople) {
  const pAi = (foundAi + 0.5) / (nAi + 1);
  const pPeople = (foundPeople + 0.5) / (nPeople + 1);
  return Math.round(10 * Math.log10(pAi / pPeople) * 10) / 10;
}

const found = (status) => status !== undefined && status !== 'not_found' && status !== 'unknown';

// results: the stored results; signsTable: score.mjs SIGNS; score: score.mjs scoreChecklist.
export function reportChecklist(results, { signsTable, score }) {
  const rows = Object.entries(results || {}).filter(([, r]) => r && !r.failed && r.signs);
  const ai = rows.filter(([, r]) => r.truthAi);
  const people = rows.filter(([, r]) => !r.truthAi);
  const lines = [`artists: ${ai.length} known AI, ${people.length} known people (${Object.values(results || {}).filter((r) => r && r.failed).length} failed)`, ''];

  lines.push('| Sign | Found, AI | Found, people | Unknown (all) | Measured points | Research points |');
  lines.push('|---|---|---|---|---|---|');
  for (const code of CODES) {
    const fa = ai.filter(([, r]) => found(r.signs[code])).length;
    const fp = people.filter(([, r]) => found(r.signs[code])).length;
    const unk = rows.filter(([, r]) => r.signs[code] === 'unknown').length;
    const research = signsTable && signsTable[code] ? JSON.stringify(signsTable[code].points) : '';
    lines.push(`| ${code} | ${fa}/${ai.length} | ${fp}/${people.length} | ${unk}/${rows.length} | ${measuredPoints(fa, ai.length, fp, people.length)} | ${research} |`);
  }

  lines.push('', '| Artist | Truth | Faceless | P(AI) | Verdict | Confidence |', '|---|---|---|---|---|---|');
  const decided = rows.map(([name, r]) => [name, r, score({ signs: r.signs, genres: r.genres, sources: r.sources })]);
  decided.sort((x, y) => y[2].probability - x[2].probability);
  for (const [name, r, s] of decided) {
    lines.push(`| ${name} | ${r.truthAi ? 'AI' : 'people'} | ${s.faceless ? 'yes' : 'no'} | ${(s.probability * 100).toFixed(1)}% | ${s.verdict} | ${s.confidence} |`);
  }

  const at = (t) => {
    const aiCaught = decided.filter(([, r, s]) => r.truthAi && s.verdict === 'ai' && s.confidence >= t).length;
    const peopleWrong = decided.filter(([, r, s]) => !r.truthAi && s.verdict === 'ai' && s.confidence >= t).length;
    return `at ${t}: ${aiCaught}/${ai.length} known AI caught, ${peopleWrong}/${people.length} known people called AI`;
  };
  lines.push('', at(60), at(95));
  return lines.join('\n');
}
