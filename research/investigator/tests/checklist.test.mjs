// The evidence checklist Claude fills in (src/checklist.mjs).
import { run } from './harness.mjs';
import { CHECKLIST, CODES, CHECKLIST_SCHEMA, checklistPromptLines, checkChecklist } from '../src/checklist.mjs';

const J = (v) => JSON.stringify(v);
// Every sign of the research's section 3 that Claude can check; M3, P16 (SH Labs), W4 (the cover
// look) and P1 (before 2020) are the service's own.
const WANT = ['S1', 'S2', 'S3', 'M1', 'S4', 'M2', 'M4', 'M5', 'W1', 'W2', 'W7', 'M6', 'M7', 'M8', 'W3', 'W5', 'W8', 'M9', 'W6',
  'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15'];
const full = (over = {}) => ({
  signs: Object.fromEntries(CODES.map((c) => [c, { status: 'unknown', source: '' }])),
  genres: ['indie rock'],
  summary: 'A band from Leeds.',
  ...over,
});

await run([
  ['the checklist has every sign Claude can check, and nothing else', () =>
    (J([...CODES].sort()) === J([...WANT].sort())) || J({ extra: CODES.filter((c) => !WANT.includes(c)), missing: WANT.filter((c) => !CODES.includes(c)) })],
  ['the schema requires every sign, with the statuses that sign allows', () => {
    const s = CHECKLIST_SCHEMA.properties.signs;
    const enumOf = (c) => s.properties[c].properties.status.enum;
    return (J(s.required) === J(CODES) && J(enumOf('S3')) === J(['found', 'from_label', 'not_found', 'unknown'])
      && J(enumOf('P2')) === J(['hard_date', 'streaming_date', 'not_found', 'unknown']) && J(enumOf('M6')) === J(['found', 'not_found', 'unknown'])
      && CHECKLIST_SCHEMA.additionalProperties === false) || J(s.required);
  }],
  ['the prompt names every sign once', () => {
    const lines = checklistPromptLines();
    return CODES.every((c) => lines.filter((l) => l.startsWith(`${c}: `)).length === 1) || 'a sign is missing or repeated';
  }],
  ['a full answer passes; found signs carry their https page, deduplicated', () => {
    const a = full();
    a.signs.S1 = { status: 'found', source: 'https://zoundhub.com/artist/x' };
    a.signs.S4 = { status: 'found', source: 'https://zoundhub.com/artist/x' };
    a.signs.P2 = { status: 'streaming_date', source: 'https://open.spotify.com/album/y' };
    a.signs.P3 = { status: 'not_found', source: '' };
    const r = checkChecklist(a);
    return (r.ok && r.checklist.signs.S1 === 'found' && r.checklist.signs.P2 === 'streaming_date' && r.checklist.signs.P3 === 'not_found'
      && J(r.checklist.sources) === J(['https://zoundhub.com/artist/x', 'https://open.spotify.com/album/y']) && J(r.checklist.genres) === J(['indie rock'])) || J(r);
  }],
  // The first experiment run (2026-11-18) lost found signs whose source held a link plus a note
  // ("https://... (album list)"): the first https link in the text is the source.
  ['a source with a note around its link keeps the sign; the link is taken out cleanly', () => {
    const a = full();
    a.signs.M4 = { status: 'found', source: 'Deezer album list: https://www.deezer.com/en/artist/1/albums (94 albums).' };
    a.signs.S1 = { status: 'found', source: '<https://zoundhub.com/artist/x>, relays the flag' };
    const r = checkChecklist(a);
    return (r.ok && r.checklist.signs.M4 === 'found' && r.checklist.signs.S1 === 'found'
      && J(r.checklist.sources) === J(['https://zoundhub.com/artist/x', 'https://www.deezer.com/en/artist/1/albums'])) || J(r);
  }],
  ['the raw answer per sign is kept for audit, cut short', () => {
    const a = full();
    a.signs.M6 = { status: 'found', source: 'x'.repeat(400) };
    const r = checkChecklist(a);
    return (r.ok && r.checklist.raw.M6.status === 'found' && r.checklist.raw.M6.source.length === 200 && r.checklist.signs.M6 === 'unknown') || J(r.checklist && r.checklist.raw && r.checklist.raw.M6);
  }],
  ['a found sign with no https page counts as unknown', () => {
    const a = full();
    a.signs.M6 = { status: 'found', source: 'I searched everywhere' };
    a.signs.S2 = { status: 'found', source: 'http://example.com/bio' };
    const r = checkChecklist(a);
    return (r.ok && r.checklist.signs.M6 === 'unknown' && r.checklist.signs.S2 === 'unknown' && r.checklist.sources.length === 0) || J(r);
  }],
  ['a missing sign, a bad status or a status from another sign fails', () => {
    const a = full(); delete a.signs.P7;
    const b = full(); b.signs.S1 = { status: 'maybe', source: '' };
    const c = full(); c.signs.S1 = { status: 'from_label', source: 'https://x.example/' };
    const rs = [checkChecklist(a), checkChecklist(b), checkChecklist(c), checkChecklist(null), checkChecklist({ signs: [] })];
    return rs.every((r) => r.ok === false) || J(rs);
  }],
  ['genres are trimmed, at most 6; the summary is cut to 600 characters', () => {
    const r = checkChecklist(full({ genres: [' lofi ', '', 5, 'a', 'b', 'c', 'd', 'e', 'f'], summary: 'x'.repeat(900) }));
    return (r.ok && J(r.checklist.genres) === J(['lofi', 'a', 'b', 'c', 'd', 'e']) && r.checklist.summary.length === 600) || J(r);
  }],
  ['every wording is plain and neutral', () => {
    const text = Object.values(CHECKLIST).map((v) => v[1]).join(' ');
    return !/slop|fake|garbage/i.test(text) || 'loaded word';
  }],
]);
