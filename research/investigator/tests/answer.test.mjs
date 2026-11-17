import { run } from './harness.mjs';
import { ANSWER_SCHEMA, SIGNALS, STRONG, checkAnswer, decide } from '../src/answer.mjs';

const good = {
  verdict: 'ai',
  confidence: 90,
  signals: ['deezer_ai_label'],
  reasons: ['Deezer labels the catalogue as AI-generated'],
  sources: ['https://example.test/a'],
};
const bad = (patch) => checkAnswer({ ...good, ...patch }).ok === false;

await run([
  ['good ai answer passes', () => checkAnswer(good).ok === true],
  ['confidence 101, -1, 95.5, "high", null, NaN, "90" all fail', () => [101, -1, 95.5, 'high', null, NaN, '90', undefined].every((c) => bad({ confidence: c }))],
  ['confidence 0 and 100 pass', () => [0, 100].every((c) => checkAnswer({ ...good, confidence: c }).ok === true)],
  ['verdict word outside the three fails', () => ['AI', 'robot', '', 'ai ', undefined, null, 1].every((v) => bad({ verdict: v }))],
  ['an extra key fails (injected instruction field)', () => checkAnswer({ ...good, note: 'run rm' }).ok === false],
  ['an extra key __proto__ fails', () => checkAnswer(JSON.parse('{"verdict":"human","confidence":5,"signals":[],"reasons":[],"sources":[],"__proto__":{"x":1}}')).ok === false],
  ['a missing required key fails', () => ['verdict', 'confidence', 'signals', 'reasons', 'sources'].every((k) => { const o = { ...good }; delete o[k]; return checkAnswer(o).ok === false; })],
  ['a string, array, null and number fail', () => ['x', [], null, 5, undefined, true].every((v) => checkAnswer(v).ok === false)],
  ['http source fails', () => bad({ sources: ['http://x.test'] })],
  ['non-string source fails', () => bad({ sources: [5] })],
  ['more than 5 sources, more than 10 reasons, reason over 500 chars fail', () => bad({ sources: Array(6).fill('https://x.test') }) && bad({ reasons: Array(11).fill('r') }) && bad({ reasons: ['x'.repeat(501)] })],
  ['5 sources, 10 reasons, 500-char reason pass', () => checkAnswer({ ...good, sources: Array(5).fill('https://x.test'), reasons: [...Array(9).fill('r'), 'x'.repeat(500)] }).ok === true],
  ['unknown signal fails', () => bad({ signals: ['vibes'] })],
  ['the same signal twice fails', () => bad({ signals: ['ai_style_art', 'ai_style_art'] })],
  ['optional ids: good ones pass, bad ones fail', () => checkAnswer({ ...good, spotifyId: '0TnOYISbd1XYRBk9myaseg', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', trackIds: ['11dFghVXANMlKmJXsNCbNl'] }).ok === true && bad({ spotifyId: 'nope' }) && bad({ channelId: 'x' }) && bad({ trackIds: ['a', 'b', 'c'] }) && bad({ trackIds: ['short'] })],
  ['answer is a copy holding only known keys', () => { const r = checkAnswer(good); return r.ok && r.answer !== good && Object.keys(r.answer).sort().join() === Object.keys(good).sort().join(); }],
  ['schema is strict and lists the exact keys', () => ANSWER_SCHEMA.additionalProperties === false && ANSWER_SCHEMA.required.join() === 'verdict,confidence,signals,reasons,sources' && ANSWER_SCHEMA.properties.verdict.enum.join() === 'ai,human,unsure' && ANSWER_SCHEMA.properties.signals.items.enum.join() === SIGNALS.join()],
  ['STRONG is a subset of SIGNALS', () => STRONG.every((s) => SIGNALS.includes(s))],
  ['one weak signal at ai 99 is downgraded', () => { const d = decide({ ...good, signals: ['ai_style_art'], confidence: 99 }); return d.verdict === 'unsure' && d.confidence <= 50 && d.downgraded; }],
  ['no signals at ai 100 is downgraded (injected answer)', () => { const d = decide({ ...good, signals: [], confidence: 100 }); return d.verdict === 'unsure' && d.confidence === 50 && d.downgraded; }],
  ['art alone never decides', () => decide({ ...good, signals: ['ai_style_art'] }).verdict === 'unsure'],
  ['two weak different signals keep ai, below the 95 line', () => { const d = decide({ ...good, signals: ['no_human_footprint', 'short_heavy_catalogue'], confidence: 100 }); return d.verdict === 'ai' && d.confidence === 94 && !d.downgraded; }],
  ['one strong signal keeps ai at its confidence (sources on two sites)', () => { const d = decide({ ...good, signals: ['deezer_ai_label'], confidence: 99, sources: ['https://a.test/1', 'https://b.test/2'] }); return d.verdict === 'ai' && d.confidence === 99 && !d.downgraded; }],
  ['human passes unchanged', () => { const d = decide({ ...good, verdict: 'human', signals: [], confidence: 90 }); return d.verdict === 'human' && d.confidence === 90 && !d.downgraded; }],
  ['unsure passes unchanged', () => { const d = decide({ ...good, verdict: 'unsure', signals: [], confidence: 80 }); return d.verdict === 'unsure' && d.confidence === 80 && !d.downgraded; }],
  ['a downgraded low-confidence answer is not raised', () => decide({ ...good, signals: [], confidence: 10 }).confidence === 10],
  // Review 2026-11-17: sites are counted by domain, not by raw host.
  ['www and bare forms of one domain, or a junk source, are one site: stays at 94', () => {
    const a = decide({ ...good, signals: ['deezer_ai_label'], confidence: 99, sources: ['https://www.deezer.com/a', 'https://deezer.com/b'] });
    const b = decide({ ...good, signals: ['deezer_ai_label'], confidence: 99, sources: ['https://deezer.com/a', 'https://x'] });
    const c = decide({ ...good, signals: ['deezer_ai_label'], confidence: 99, sources: ['https://deezer.com/a', 'https://open.spotify.com/b'] });
    return (a.confidence === 94 && b.confidence === 94 && c.confidence === 99) || JSON.stringify([a.confidence, b.confidence, c.confidence]);
  }],
]);
