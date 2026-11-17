// Contract check: Wai's investigator rules (2026-11-17), see the design section "The
// investigator's rules". Run from research/investigator: node tests/rules.test.mjs
import { checkAnswer, decide, SIGNALS } from '../src/answer.mjs';
import { SYSTEM_PROMPT } from '../src/claude.mjs';
const fails = [];
const J = (v) => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const ans = (o) => ({ verdict: 'ai', confidence: 98, signals: ['tracker_listing', 'deezer_ai_label'], reasons: ['r'], sources: ['https://a.test/1', 'https://b.test/2'], ...o });
const ok = (o) => { const c = checkAnswer(ans(o)); if (!c.ok) throw new Error('checkAnswer refused: ' + c.reason); return c.answer; };

t('answers may list contradicting sources (https only, at most 5)', () => {
  const good = checkAnswer(ans({ contradictions: ['https://c.test/x'] }));
  const http = checkAnswer(ans({ contradictions: ['http://c.test/x'] }));
  const many = checkAnswer(ans({ contradictions: ['https://c.test/1', 'https://c.test/2', 'https://c.test/3', 'https://c.test/4', 'https://c.test/5', 'https://c.test/6'] }));
  const notArr = checkAnswer(ans({ contradictions: 'https://c.test/x' }));
  return (good.ok && J(good.answer.contradictions) === J(['https://c.test/x']) && !http.ok && !many.ok && !notArr.ok) || J({ good: good.ok, http: http.ok, many: many.ok, notArr: notArr.ok });
});
t('a 95+ ai verdict needs sources on two different sites', () => {
  const one = decide(ok({ sources: ['https://a.test/1', 'https://a.test/2'] }));
  const two = decide(ok({}));
  return (one.verdict === 'ai' && one.confidence <= 94 && two.confidence === 98) || J({ one: one.confidence, two: two.confidence });
});
t('without a strong signal an ai verdict stays at 94 or below, even with two sites', () => {
  const d = decide(ok({ confidence: 100, signals: ['no_human_footprint', 'short_heavy_catalogue'] }));
  return (d.verdict === 'ai' && d.confidence <= 94) || J({ verdict: d.verdict, confidence: d.confidence });
});
t('the five-albums flag is called a flag, not a strong one (it is a weak signal)', () => !/strong flag/i.test(SYSTEM_PROMPT) || 'the prompt calls it a strong flag');
t('each contradicting source lowers the confidence by 20', () => {
  const c1 = decide(ok({ contradictions: ['https://c.test/x'] }));
  const c2 = decide(ok({ contradictions: ['https://c.test/x', 'https://d.test/y'] }));
  const h = decide(ok({ verdict: 'human', confidence: 90, signals: [], contradictions: ['https://c.test/x'] }));
  const floor = decide(ok({ confidence: 10, contradictions: ['https://c.test/1', 'https://c.test/2'] }));
  return (c1.confidence === 78 && c2.confidence === 58 && h.confidence === 70 && floor.confidence >= 0 && floor.confidence <= 10) || J({ c1: c1.confidence, c2: c2.confidence, h: h.confidence, floor: floor.confidence });
});
t('a release before 2020 found by Claude makes the verdict human', () => {
  if (!SIGNALS.includes('pre_2020_release')) return 'no pre_2020_release signal';
  const d = decide(ok({ signals: ['pre_2020_release', 'tracker_listing'] }));
  return d.verdict === 'human' || J(d);
});
t('the prompt asks for several sources, contradictions, the pre-2020 rule and the five-albums flag', () => {
  const p = SYSTEM_PROMPT;
  return (/several|multiple/i.test(p) && /independent/i.test(p) && /contradict/i.test(p) && /2020/.test(p) && /five albums|5 albums/i.test(p)) || 'prompt misses one';
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
