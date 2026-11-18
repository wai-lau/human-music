// Confidence calibration: turn Claude's raw confidence on `ai` verdicts into a number that
// means something, using answers known from outside. The extension's Optimal mode needs 95,
// so 95 is only reachable when the data shows at most 1 wrong in 20 at that raw level and above.
// Without a usable fit nothing is published at 95 or more (unsure means play).

const MIN_SAMPLES = 20;
const MAX_WRONG_RATE = 1 / 20;
const NOT_READY_CAP = 94;
const AT_60 = 60;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rateOf = (rows) => (rows.length ? rows.filter((s) => !s.truthAi).length / rows.length : null);

// samples: ai verdicts only, { raw, truthAi, name? }.
export function fitMapping(samples) {
  const rows = (Array.isArray(samples) ? samples : []).filter((s) => s && Number.isFinite(s.raw));
  const identity = [[0, 0], [100, 100]];
  const base = { n: rows.length, wrongAt60: rateOf(rows.filter((s) => s.raw >= AT_60)) };

  let cut = null;
  for (const r of [...new Set(rows.map((s) => s.raw))].sort((a, b) => a - b)) {
    const above = rows.filter((s) => s.raw >= r);
    if (above.length < MIN_SAMPLES) break; // higher cuts only have fewer samples
    if (above.filter((s) => !s.truthAi).length / above.length <= MAX_WRONG_RATE) { cut = r; break; }
  }
  if (cut === null) return { ok: false, points: identity, wrongAt95: null, ...base };

  const r60 = clamp(Math.min(AT_60, cut - 1), 0, 100);
  return {
    ok: true,
    points: [[0, 0], [r60, 60], [cut, 95], [100, 100]],
    wrongAt95: rateOf(rows.filter((s) => s.raw >= cut)),
    ...base,
  };
}

// Piecewise linear over the points; at a repeated x the last point wins (a step).
// A missing or not-ok mapping caps at 94: nothing reaches Optimal without a fit.
export function applyMapping(mapping, raw) {
  const x = clamp(Number.isFinite(raw) ? raw : 0, 0, 100);
  if (!mapping || !mapping.ok || !Array.isArray(mapping.points) || mapping.points.length < 2) {
    return Math.min(Math.round(x), NOT_READY_CAP);
  }
  const pts = mapping.points;
  let i = 0;
  for (let k = 0; k < pts.length; k++) if (pts[k][0] <= x) i = k;
  let y = pts[i][1];
  if (pts[i][0] < x && i + 1 < pts.length) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    y = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return clamp(Math.round(y), 0, 100);
}

const pct = (r) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

export function report(samples, mapping) {
  const rows = Array.isArray(samples) ? samples : [];
  const ai = rows.filter((s) => s.truthAi).length;
  const people = rows.filter((s) => !s.truthAi);
  const lines = [
    // These count the fit's samples: the artists called AI (review 2026-11-17: the bare
    // "n known AI" read as the run's sample size).
    `called AI, known AI: ${ai}`,
    `called AI, known people: ${people.length}`,
    `wrong at 95: ${mapping && mapping.ok ? pct(mapping.wrongAt95) : 'not ready (no cut reaches 1 wrong in 20 with 20 samples)'}`,
    `wrong at 60: ${pct(mapping ? mapping.wrongAt60 : null)}`,
    'disagreements (known people called AI):',
  ];
  if (people.length === 0) lines.push('  none');
  for (const s of people) lines.push(`  ${s.name || '(no name)'}: raw ${s.raw}`);
  return lines.join('\n');
}
