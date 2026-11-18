// Contract for src/score.mjs, evidence scoring (Wai, 2026-11-18: scoring with the faceless guard;
// her earlier ask: "each thing that is being researched should assign some percentage of the
// certainty"). Numbers and rules come from research/calibration/signals-research.md: section 3
// (the signs and their points), section 4 (groups, caps, guards) and section 5 (worked examples,
// used as the cases below). Run: node tests/score-contract.test.mjs (from research/investigator).
//
// Interface:
//   SIGNS: { <code>: { group, points } } for every scored sign. group is 'A'..'F' or 'people'.
//     points is a number, or for a sign with levels an object { <level>: number }.
//   isFaceless(genres: string[]): boolean
//   scoreChecklist({ signs, genres, sources }, { prior = 0.1 } = {}) ->
//     { score, probability, verdict, confidence, faceless, groups: { A, B, C, D, E, F, people } }
//   signs: { <code>: 'found' | 'not_found' | 'unknown' | <level name> }. Anything else, and any
//   code not in SIGNS, counts as unknown (0 points).
import { run } from './harness.mjs';
import { SIGNS, isFaceless, scoreChecklist } from '../src/score.mjs';

const J = (v) => JSON.stringify(v);
const near = (a, b, d = 0.002) => Math.abs(a - b) <= d;
const TWO_SITES = ['https://www.deezer.com/en/artist/1', 'https://zoundhub.com/artist/x'];
const ONE_SITE = ['https://zoundhub.com/artist/x'];
const score = (signs, o = {}) => scoreChecklist({ signs, genres: o.genres || ['pop'], sources: o.sources || ONE_SITE }, o.opts || {});

await run([
  ['the sign table: every research sign with its group and points', () => {
    const want = {
      S1: ['A', 20], S2: ['A', 20], S3: ['A', { found: 15, from_label: 20 }], M1: ['A', { self_disclosed: 13, likely: 10 }],
      S4: ['B', 15], M2: ['B', 9], M3: ['B', 10],
      M4: ['C', 14], M5: ['C', 10], W1: ['C', 3], W2: ['C', 3], W7: ['C', 2],
      M6: ['D', 9], M7: ['D', 7], M8: ['D', 6], W3: ['D', 4], W5: ['D', 2], W8: ['D', 1],
      W4: ['E', 4], M9: ['E', 7], W6: ['F', 3],
      P2: ['people', { hard_date: -11, streaming_date: -8 }], P3: ['people', -15], P4: ['people', -5], P5: ['people', -8],
      P6: ['people', -10], P7: ['people', -13], P8: ['people', -6], P9: ['people', -8], P10: ['people', -8], P11: ['people', -6],
      P12: ['people', -15], P13: ['people', -5], P14: ['people', -8], P15: ['people', -1], P16: ['people', -7],
    };
    const bad = Object.entries(want).filter(([k, [g, p]]) => !SIGNS[k] || SIGNS[k].group !== g || J(SIGNS[k].points) !== J(p)).map(([k]) => k);
    const extra = Object.keys(SIGNS).filter((k) => !(k in want));
    return (bad.length === 0 && extra.length === 0) || J({ bad, extra });
  }],
  ['the prior alone: 10% is -9.54 points', () => {
    const r = score({});
    return (near(r.score, -9.542, 0.01) && near(r.probability, 0.1) && r.verdict === 'unsure') || J(r);
  }],
  // Section 5, Forrest Rose: 46 albums in 12 months, started 2024, nine genres; nobody found, no
  // bio, own-name label. +15.5 points, 97.3% raw, held to 94 without a strong sign.
  ['Forrest Rose: catalogue and footprint, capped at 94 without a strong sign', () => {
    const r = score({ M4: 'found', W1: 'found', W2: 'found', M6: 'found', W5: 'found', W8: 'found' });
    return (r.groups.C === 15 && r.groups.D === 10 && near(r.probability, 0.9724, 0.003) && r.verdict === 'ai' && r.confidence === 94) || J(r);
  }],
  ['Forrest Rose plus a Deezer AI tag, sources on two sites: past 95', () => {
    const r = score({ S1: 'found', M4: 'found', W1: 'found', W2: 'found', M6: 'found', W5: 'found', W8: 'found' }, { sources: TWO_SITES });
    return (r.groups.A === 20 && r.probability > 0.999 && r.verdict === 'ai' && r.confidence >= 95) || J(r);
  }],
  ['a strong sign with sources on one site only stays at 94', () => {
    const r = score({ S1: 'found', M4: 'found', W1: 'found', W2: 'found', M6: 'found', W5: 'found', W8: 'found' }, { sources: ONE_SITE });
    return (r.verdict === 'ai' && r.confidence === 94) || J(r);
  }],
  // Section 5, a small real indie band: first release 2022 (streaming date), human pace, a label
  // with a roster, shows confirmed by venues. -43.5 points, about 0.004%.
  ['a small real indie band is made by people', () => {
    const r = score({ P2: 'streaming_date', P13: 'found', P8: 'found', P3: 'found' });
    return (r.groups.people === -34 && r.probability < 0.0001 && r.verdict === 'human' && r.confidence >= 99) || J(r);
  }],
  // Section 5, the hard case: a faceless lofi producer who is a person. Groups C and D halved
  // (after their caps): +8.25 points, 87% raw; guard 6 (no sign from A or B) keeps it under 60.
  ['a faceless lofi person: C and D halved, no hard sign, so unsure and it plays', () => {
    const r = score({ M5: 'found', W1: 'found', M6: 'found', W5: 'found', W4: 'found', W6: 'found' }, { genres: ['lo-fi hip hop'] });
    return (r.faceless === true && r.groups.C === 5.75 && r.groups.D === 5 && near(r.probability, 0.8688, 0.003) && r.verdict === 'unsure' && r.confidence < 60) || J(r);
  }],
  ['the same faceless profile with a Deezer AI tag is still caught', () => {
    const r = score({ S1: 'found', M5: 'found', W1: 'found', M6: 'found', W5: 'found', W4: 'found', W6: 'found' }, { genres: ['ambient'], sources: TWO_SITES });
    return (r.probability > 0.998 && r.verdict === 'ai' && r.confidence >= 95) || J(r);
  }],
  ['outside faceless genres the same profile is not halved (capped at 94)', () => {
    const r = score({ M5: 'found', W1: 'found', M6: 'found', W5: 'found', W4: 'found', W6: 'found' }, { genres: ['country'] });
    return (r.faceless === false && r.groups.C === 11.5 && r.groups.D === 10 && r.verdict === 'ai' && r.confidence === 94) || J(r);
  }],
  ['faceless genres by name', () => {
    const yes = [['lofi'], ['Lo-Fi Beats'], ['chillhop'], ['dark ambient'], ['sleep music'], ['meditation'], ['study beats'], ['café jazz'], ['cafe jazz'], ['bossa nova'], ['playlist piano']];
    const no = [['indie rock'], ['jazz'], ['hip hop'], [], ['piano']];
    return (yes.every((g) => isFaceless(g) === true) && no.every((g) => isFaceless(g) === false)) || J({ yes: yes.map(isFaceless), no: no.map(isFaceless) });
  }],
  // Section 4: within an AI-side group, the largest points plus half the second, the rest dropped,
  // then the group's cap. People signs add up with no cap.
  ['groups: largest plus half the second, rest dropped, then the cap', () => {
    const a = score({ S1: 'found', S2: 'found' });       // 20 + 10 = 30 (cap 30)
    const c = score({ M4: 'found', M5: 'found', W1: 'found' }); // 14 + 5 = 19, capped 15
    const d = score({ M6: 'found', M7: 'found', M8: 'found' }); // 9 + 3.5 = 12.5, capped 10
    const p = score({ P3: 'found', P12: 'found', P7: 'found' }); // -43, no cap
    return (a.groups.A === 30 && c.groups.C === 15 && d.groups.D === 10 && p.groups.people === -43) || J([a.groups, c.groups, d.groups, p.groups]);
  }],
  ['levels: a YouTube Music label from the distributor counts 20, a plain one 15; a persona badge 13 or 10', () => {
    const a = score({ S3: 'from_label' }); const b = score({ S3: 'found' });
    const c = score({ M1: 'self_disclosed' }); const d = score({ M1: 'likely' });
    return (a.groups.A === 20 && b.groups.A === 15 && c.groups.A === 13 && d.groups.A === 10) || J([a.groups.A, b.groups.A, c.groups.A, d.groups.A]);
  }],
  ['lists add at most 3 when the Deezer tag is already counted (they relay it)', () => {
    const r = score({ S1: 'found', S4: 'found' });
    const s = score({ S4: 'found' });
    return (r.groups.B === 3 && s.groups.B === 15) || J([r.groups, s.groups]);
  }],
  ['unknown, not found and anything unrecognised score 0', () => {
    const r = score({ S1: 'unknown', S2: 'not_found', M4: 'yes', ZZ9: 'found', P3: 'maybe' });
    return (Object.values(r.groups).every((v) => v === 0) && near(r.probability, 0.1)) || J(r.groups);
  }],
  // Guard 4: art never decides. Group E can't be the only AI-side group above 0.
  ['art alone counts nothing', () => {
    const r = score({ W4: 'found', M9: 'found' });
    const s = score({ W4: 'found', W6: 'found' });
    return (r.groups.E === 0 && near(r.probability, 0.1) && s.groups.E === 4) || J([r.groups, s.groups]);
  }],
  // Guard 5: strong people evidence (any one people sign of -10 or stronger) caps an AI verdict
  // at 94, unless the artist says the music is AI-generated (S2).
  ['strong people evidence caps at 94 unless the artist discloses AI', () => {
    const signs = { S1: 'found', S4: 'found', M4: 'found', W1: 'found', M6: 'found', P6: 'found' };
    const r = score(signs, { sources: TWO_SITES });
    const s = score({ ...signs, S2: 'found' }, { sources: TWO_SITES });
    return (r.probability > 0.95 && r.verdict === 'ai' && r.confidence === 94 && s.confidence >= 95) || J([r, s]);
  }],
  ['verdicts: ai at 60% or more, human at 5% or less, unsure between; confidence is the chance of the verdict', () => {
    const ai = score({ M4: 'found' });                         // -9.54 + 14 = 4.46: 73.6%
    const human = score({ P6: 'found', P8: 'found' });        // -25.54: 0.28%
    const unsure = score({ W1: 'found', W5: 'found' });       // -9.54 + 3 + 2 = -4.54: 26%
    return (ai.verdict === 'ai' && ai.confidence === 74 && human.verdict === 'human' && human.confidence === 100 && unsure.verdict === 'unsure' && unsure.confidence === 26) || J([ai, human, unsure].map((r) => [r.verdict, r.confidence, r.probability]));
  }],
  ['a different prior moves the start', () => {
    const r = score({}, { opts: { prior: 0.4 } });
    return near(r.probability, 0.4) || J(r);
  }],
  ['a status that names an object property is not a level', () => {
    const r = score({ S3: 'constructor', P2: 'toString', M1: '__proto__' });
    return (r.groups.A === 0 && r.groups.people === 0 && Number.isFinite(r.score)) || JSON.stringify(r.groups);
  }],
  ['bad input never throws and counts nothing', () => {
    const rs = [scoreChecklist(null), scoreChecklist({}), scoreChecklist({ signs: 'x', genres: 5, sources: null })];
    return rs.every((r) => near(r.probability, 0.1) && r.verdict === 'unsure') || J(rs);
  }],
]);
