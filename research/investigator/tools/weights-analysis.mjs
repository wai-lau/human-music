// Analyses for the evidence-weights experiment (Wai, 2026-11-19: "use a much bigger sample size to
// calibrate the weights, try different experiments"). Reads the stored checklist results and prints
// a markdown report: results per sample, cross-validated weights, a logistic fit, bootstrap ranges
// for each sign's weight, a guard ablation, a threshold sweep and, with --repeat, how often a second
// run of the same artist agrees with the first. Runs no model; reads only the stores.
// Usage: HM_DATA_DIR=<dir> node tools/weights-analysis.mjs [--sample <label>=<file.json>]... [--repeat <dir>]
import { readFileSync } from 'node:fs';
import { openStore } from '../src/store.mjs';
import * as score from '../src/score.mjs';
import { measuredPoints } from '../src/checklistrun.mjs';

const args = process.argv.slice(2);
const samples = []; let repeatDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sample') { const [label, file] = args[++i].split('='); samples.push([label, file]); }
  else if (args[i] === '--repeat') repeatDir = args[++i];
}
const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const found = (v) => v !== undefined && v !== 'not_found' && v !== 'unknown';
const pct = (a, b) => (b ? `${a} of ${b} (${(100 * a / b).toFixed(1)}%)` : '0 of 0');
const CODES = Object.keys(score.SIGNS).filter((c) => typeof score.SIGNS[c].points === 'number');
const ORIGINAL = Object.fromEntries(CODES.map((c) => [c, score.SIGNS[c].points]));

function load(dir) {
  const s = openStore(`${dir}/investigator.db`);
  const res = s.getState('checklist.results.opus') || {};
  return Object.entries(res).filter(([, r]) => r && r.signs).map(([name, r]) => ({ name, ...r }));
}
const rows = load(process.env.HM_DATA_DIR);
const sampleOf = new Map();
for (const [label, file] of samples) for (const a of JSON.parse(readFileSync(file, 'utf8')).artists || []) sampleOf.set(norm(a.name), label);
for (const r of rows) r.sample = sampleOf.get(norm(r.name)) || (r.truthAi ? 'AI, earlier' : 'people, earlier');

function withWeights(w, fn) {
  for (const c of CODES) score.SIGNS[c].points = w[c] ?? ORIGINAL[c];
  try { return fn(); } finally { for (const c of CODES) score.SIGNS[c].points = ORIGINAL[c]; }
}
const run = (r, o = {}) => score.scoreChecklist({ signs: r.signs, genres: o.noGenres ? [] : r.genres, sources: r.sources });
function tally(set, w, o) {
  return withWeights(w || {}, () => {
    const ai = set.filter((r) => r.truthAi), pe = set.filter((r) => !r.truthAi);
    const s = (r) => run(r, o);
    const at = (g, t) => g.filter((r) => { const x = s(r); return x.verdict === 'ai' && x.confidence >= t; }).length;
    return { nAi: ai.length, nPe: pe.length, ai60: at(ai, 60), ai95: at(ai, 95), pe60: at(pe, 60), pe95: at(pe, 95),
      peUnsure: pe.filter((r) => s(r).verdict === 'unsure').length };
  });
}
function fit(train, minFound = 5) {
  const ai = train.filter((r) => r.truthAi), pe = train.filter((r) => !r.truthAi), w = {};
  for (const c of CODES) {
    const fa = ai.filter((r) => found(r.signs[c])).length, fp = pe.filter((r) => found(r.signs[c])).length;
    if (fa + fp >= minFound) w[c] = Math.round(measuredPoints(fa, ai.length, fp, pe.length));
  }
  return w;
}
// mulberry32: a small seeded generator, so every run of the report gives the same numbers.
function rng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, seed) { const r = rng(seed); const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

const out = [];
out.push(`# Weights experiment: ${rows.length} artists (${rows.filter((r) => r.truthAi).length} known AI, ${rows.filter((r) => !r.truthAi).length} known people)\n`);

out.push('## Results per sample (weights in use)\n');
out.push('| Sample | Count | Called AI at 60+ | Called AI at 95+ | Unsure |');
out.push('|---|---|---|---|---|');
for (const label of [...new Set(rows.map((r) => r.sample))]) {
  const set = rows.filter((r) => r.sample === label), t = tally(set);
  const isAi = set[0].truthAi;
  out.push(`| ${label} | ${set.length} | ${isAi ? pct(t.ai60, t.nAi) : pct(t.pe60, t.nPe)} | ${isAi ? pct(t.ai95, t.nAi) : pct(t.pe95, t.nPe)} | ${isAi ? '' : t.peUnsure} |`);
}

out.push('\n## Cross-validated weights (5 folds: fit on four fifths, score the fifth)\n');
const folds = 5, sh = shuffle(rows, 20261119); let cv = { ai60: 0, ai95: 0, pe60: 0, pe95: 0, nAi: 0, nPe: 0 };
for (let k = 0; k < folds; k++) {
  const test = sh.filter((_, i) => i % folds === k), train = sh.filter((_, i) => i % folds !== k);
  const t = tally(test, fit(train));
  for (const key of Object.keys(cv)) cv[key] += t[key];
}
const inUse = tally(rows), fitAll = tally(rows, fit(rows));
out.push('| Weights | Known AI at 60+ | Known AI at 95+ | People called AI at 60+ |');
out.push('|---|---|---|---|');
out.push(`| In use (the 106-artist fit) | ${pct(inUse.ai60, inUse.nAi)} | ${pct(inUse.ai95, inUse.nAi)} | ${pct(inUse.pe60, inUse.nPe)} |`);
out.push(`| Refit on all ${rows.length} (scored on the same artists) | ${pct(fitAll.ai60, fitAll.nAi)} | ${pct(fitAll.ai95, fitAll.nAi)} | ${pct(fitAll.pe60, fitAll.nPe)} |`);
out.push(`| Refit, cross-validated (each artist scored by weights that never saw it) | ${pct(cv.ai60, cv.nAi)} | ${pct(cv.ai95, cv.nAi)} | ${pct(cv.pe60, cv.nPe)} |`);

out.push('\n## Each sign: weight in use, refit on all, and a 90% bootstrap range (200 resamples)\n');
const boots = Object.fromEntries(CODES.map((c) => [c, []]));
for (let b = 0; b < 200; b++) {
  const rand = rng(1000 + b);
  const rs = rows.map(() => rows[Math.floor(rand() * rows.length)]); // with replacement
  const w = fit(rs);
  for (const c of CODES) if (w[c] !== undefined) boots[c].push(w[c]);
}
const refit = fit(rows);
out.push('| Sign | Found, AI | Found, people | In use | Refit | 90% range |');
out.push('|---|---|---|---|---|---|');
const ai = rows.filter((r) => r.truthAi), pe = rows.filter((r) => !r.truthAi);
for (const c of CODES) {
  const fa = ai.filter((r) => found(r.signs[c])).length, fp = pe.filter((r) => found(r.signs[c])).length;
  const bs = boots[c].slice().sort((x, y) => x - y);
  const range = bs.length >= 20 ? `${bs[Math.floor(bs.length * 0.05)]} to ${bs[Math.floor(bs.length * 0.95)]}` : 'too rare';
  out.push(`| ${c} | ${fa}/${ai.length} | ${fp}/${pe.length} | ${ORIGINAL[c]} | ${refit[c] ?? 'too rare'} | ${range} |`);
}

out.push('\n## Logistic fit on the same signs (cross-validated), against the per-sign weights\n');
function logistic(train, iters = 400, lr = 0.1, l2 = 0.01) {
  const w = Object.fromEntries(CODES.map((c) => [c, 0])); let b = 0;
  for (let it = 0; it < iters; it++) {
    const g = Object.fromEntries(CODES.map((c) => [c, 0])); let gb = 0;
    for (const r of train) {
      let z = b; for (const c of CODES) if (found(r.signs[c])) z += w[c];
      const p = 1 / (1 + Math.exp(-z)), e = p - (r.truthAi ? 1 : 0);
      gb += e; for (const c of CODES) if (found(r.signs[c])) g[c] += e;
    }
    b -= lr * gb / train.length;
    for (const c of CODES) w[c] -= lr * (g[c] / train.length + l2 * w[c]);
  }
  return (r) => { let z = b; for (const c of CODES) if (found(r.signs[c])) z += w[c]; return 1 / (1 + Math.exp(-z)); };
}
let lg = { ai60: 0, ai95: 0, pe60: 0, pe95: 0 };
for (let k = 0; k < folds; k++) {
  const test = sh.filter((_, i) => i % folds === k), train = sh.filter((_, i) => i % folds !== k), p = logistic(train);
  for (const r of test) { const q = p(r); if (r.truthAi) { if (q >= 0.6) lg.ai60++; if (q >= 0.95) lg.ai95++; } else { if (q >= 0.6) lg.pe60++; if (q >= 0.95) lg.pe95++; } }
}
out.push('| Model (no caps or guards in the logistic one) | Known AI at 60+ | Known AI at 95+ | People at 60+ | People at 95+ |');
out.push('|---|---|---|---|---|');
out.push(`| Per-sign weights with caps and guards, cross-validated | ${pct(cv.ai60, cv.nAi)} | ${pct(cv.ai95, cv.nAi)} | ${pct(cv.pe60, cv.nPe)} | ${pct(cv.pe95, cv.nPe)} |`);
out.push(`| Logistic, cross-validated | ${pct(lg.ai60, ai.length)} | ${pct(lg.ai95, ai.length)} | ${pct(lg.pe60, pe.length)} | ${pct(lg.pe95, pe.length)} |`);

out.push('\n## Guards: what each one changes (weights in use)\n');
const noFaceless = tally(rows, null, { noGenres: true });
const uncapped = withWeights({}, () => ({ ai: ai.filter((r) => run(r).probability >= 0.95).length, pe: pe.filter((r) => run(r).probability >= 0.95).length }));
out.push('| Variant | Known AI at 60+ | Known AI at 95+ | People called AI at 60+ | People at 95+ |');
out.push('|---|---|---|---|---|');
out.push(`| As in use | ${pct(inUse.ai60, inUse.nAi)} | ${pct(inUse.ai95, inUse.nAi)} | ${pct(inUse.pe60, inUse.nPe)} | ${pct(inUse.pe95, inUse.nPe)} |`);
out.push(`| Without the faceless halving | ${pct(noFaceless.ai60, noFaceless.nAi)} | ${pct(noFaceless.ai95, noFaceless.nAi)} | ${pct(noFaceless.pe60, noFaceless.nPe)} | ${pct(noFaceless.pe95, noFaceless.nPe)} |`);
out.push(`| Without the 94 cap (probability 95%+) | | ${pct(uncapped.ai, ai.length)} | | ${pct(uncapped.pe, pe.length)} |`);

out.push('\n## Threshold sweep (weights in use): where Aggressive and Optimal could sit\n');
out.push('| Skip at | Known AI skipped | People skipped |');
out.push('|---|---|---|');
const scored = withWeights({}, () => rows.map((r) => [r.truthAi, run(r)]));
for (const t of [50, 60, 70, 80, 90, 94, 95, 97, 99]) {
  const a = scored.filter(([tr, x]) => tr && x.verdict === 'ai' && x.confidence >= t).length;
  const p = scored.filter(([tr, x]) => !tr && x.verdict === 'ai' && x.confidence >= t).length;
  out.push(`| ${t} | ${pct(a, ai.length)} | ${pct(p, pe.length)} |`);
}

if (repeatDir) {
  out.push('\n## Repeat runs: the same artist checked twice\n');
  const second = new Map(load(repeatDir).map((r) => [norm(r.name), r]));
  let pairs = 0, signAgree = 0, signTotal = 0, verdictSame = 0; const diffs = [];
  for (const r of rows) {
    const q = second.get(norm(r.name)); if (!q) continue; pairs++;
    for (const c of CODES) { signTotal++; if (found(r.signs[c]) === found(q.signs[c])) signAgree++; }
    const a = run(r), b = run(q);
    if (a.verdict === b.verdict) verdictSame++;
    diffs.push(Math.abs(a.confidence - b.confidence));
  }
  diffs.sort((x, y) => x - y);
  out.push(`- Artists checked twice: ${pairs}`);
  out.push(`- Signs found or not found the same way both times: ${pct(signAgree, signTotal)}`);
  out.push(`- Same verdict both times: ${pct(verdictSame, pairs)}`);
  out.push(`- Confidence difference: median ${diffs[Math.floor(diffs.length / 2)] ?? 0}, largest ${diffs[diffs.length - 1] ?? 0}`);
}
console.log(out.join('\n'));
