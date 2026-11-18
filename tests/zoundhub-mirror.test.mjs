// The Zoundhub mirror script (scripts/zoundhub-mirror.mjs): Wai, 2026-11-18, "1A".
import { run, load } from './load.mjs';
import { buildMirror, loadLists } from '../scripts/zoundhub-mirror.mjs';

const J = (v) => JSON.stringify(v);
const NOW = new Date('2026-11-18T06:23:00Z');
const id = (i) => String(i).padStart(22, 'A');
const zh = (n, extra = []) => ({ reference_year: 2026, total: n, artists: [
  ...Array.from({ length: n }, (_, i) => ({ id: id(i), name: `Act ${i}`, rating: 5, deezer: true, debut: '2025' })),
  ...extra,
] });

run([
  ['a good file becomes a list the extension reads, with its credit and date', () => {
    const r = buildMirror(zh(1200), null, NOW);
    const parsed = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js']).HM.lists.parseFilterList(JSON.parse(J(r.list)));
    return (r.ok && r.list.name === 'Zoundhub' && r.list.source === 'https://zoundhub.com' && /not a verified classification/.test(r.list.note)
      && r.list.updated === NOW.toISOString() && r.list.artists.length === 1200 && parsed && parsed.artists.length === 1200) || J({ ok: r.ok, reason: r.reason });
  }],
  ['only the clear flags are kept, and a shared name is ID-only (the extension\'s own rules)', () => {
    const extra = [{ id: id(5000), name: 'Low One', rating: 2, deezer: false, debut: '2024' }, { id: id(5001), name: 'Act 3', rating: 1, deezer: false, debut: '2024' }];
    const r = buildMirror(zh(1100, extra), null, NOW);
    const a3 = r.list.artists.find((a) => a.name === 'Act 3');
    return (r.ok && r.list.artists.length === 1100 && a3.idOnly === true && !r.list.artists.some((a) => a.name === 'Low One')) || J(a3);
  }],
  ['too few artists: not published', () => {
    const r = buildMirror(zh(999), null, NOW);
    return (r.ok === false && /fewer than 1000/.test(r.reason)) || J(r);
  }],
  ['a drop of more than a third from the previous list: not published', () => {
    const previous = { artists: Array.from({ length: 3000 }, (_, i) => ({ name: `Act ${i}` })) };
    const bad = buildMirror(zh(1999), previous, NOW);
    const ok = buildMirror(zh(2001), previous, NOW);
    return (bad.ok === false && /down from 3000/.test(bad.reason) && ok.ok === true) || J({ bad, ok: ok.ok });
  }],
  ['not Zoundhub data: not published', () => {
    const rs = [buildMirror({ artists: [] }, null, NOW), buildMirror(null, null, NOW), buildMirror([1], null, NOW)];
    return rs.every((r) => r.ok === false) || J(rs);
  }],
  ['the script loads the extension\'s own list code', () => typeof loadLists().fromZoundhub === 'function'],
]);
