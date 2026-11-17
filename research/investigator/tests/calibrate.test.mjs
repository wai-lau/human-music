import { run } from './harness.mjs';
import { fitMapping, applyMapping, report } from '../src/calibrate.mjs';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const good = range(70, 100).map((raw) => ({ raw, truthAi: true, name: 'a' + raw }));

run([
  ['clean 90+ gives a cut at or below 90 and ok', () => {
    const m = fitMapping([...good, ...range(40, 69).map((raw) => ({ raw, truthAi: raw % 3 !== 0 }))]);
    if (!m.ok) return 'not ok';
    const r95 = m.points[2][0];
    return r95 <= 90 || `cut ${r95}`;
  }],
  ['points are the four-point map', () => {
    const m = fitMapping(good);
    return (m.points.length === 4 && m.points[0][0] === 0 && m.points[3][0] === 100 && m.points[3][1] === 100 && m.points[2][1] === 95) || JSON.stringify(m.points);
  }],
  ['1 wrong in 4 everywhere gives not ok', () => {
    const s = range(60, 100).flatMap((raw) => [1, 2, 3, 4].map((k) => ({ raw, truthAi: k !== 1 })));
    const m = fitMapping(s);
    return (m.ok === false && m.wrongAt95 === null) || JSON.stringify(m);
  }],
  ['fewer than 20 samples gives not ok', () => fitMapping(good.slice(0, 19)).ok === false],
  ['exactly 20 clean samples is ok', () => fitMapping(good.slice(0, 20)).ok === true],
  ['one wrong in 20 passes, two in 20 fails', () => {
    const base = range(81, 100).map((raw) => ({ raw, truthAi: true }));
    const one = fitMapping([...base, { raw: 95, truthAi: false }]);
    const two = fitMapping([...base.slice(0, 18), { raw: 95, truthAi: false }, { raw: 96, truthAi: false }, { raw: 99, truthAi: true }, { raw: 100, truthAi: true }]);
    return (one.ok === true && two.ok === false) || `${one.ok} ${two.ok}`;
  }],
  ['the cut is the lowest qualifying raw', () => {
    const s = [...range(0, 49).map(() => ({ raw: 50, truthAi: false })), ...range(1, 40).map(() => ({ raw: 80, truthAi: true }))];
    const m = fitMapping(s);
    return (m.ok && m.points[2][0] === 80) || JSON.stringify(m);
  }],
  ['wrongAt60 is the wrong rate of raw 60 and above', () => {
    const s = [...good, { raw: 65, truthAi: false }];
    const m = fitMapping(s);
    const expect = 1 / (good.filter((x) => x.raw >= 60).length + 1);
    return Math.abs(m.wrongAt60 - expect) < 1e-9 || m.wrongAt60;
  }],
  ['applyMapping is monotone, integer, within 0-100, 100 is 100', () => {
    const m = fitMapping([...good, ...range(40, 69).map((raw) => ({ raw, truthAi: false }))]);
    let prev = -1;
    for (let r = 0; r <= 100; r++) {
      const v = applyMapping(m, r);
      if (!Number.isInteger(v) || v < 0 || v > 100 || v < prev) return `bad at ${r}: ${v}`;
      prev = v;
    }
    return applyMapping(m, 100) === 100 || 'top';
  }],
  ['a not-ok mapping never reaches 95, and neither does no mapping', () => {
    const bad = fitMapping(good.slice(0, 5));
    return (applyMapping(bad, 100) <= 94 && applyMapping(null, 100) <= 94 && applyMapping(null, 30) === 30) || 'reaches 95';
  }],
  ['the cut raw maps to 95', () => {
    const m = fitMapping(good);
    return applyMapping(m, m.points[2][0]) === 95 || applyMapping(m, m.points[2][0]);
  }],
  ['report names a known person called AI', () => {
    const s = [...good, { raw: 62, truthAi: false, name: 'Real Person' }];
    const text = report(s, fitMapping(s));
    return (text.includes('Real Person') && /known people/i.test(text) && /known AI/i.test(text)) || text;
  }],
]);
