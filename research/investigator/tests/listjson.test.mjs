import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { buildList } from '../src/listjson.mjs';

// The extension's own parser, loaded the way tests/load.mjs does.
const EXT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'extension');
const ctx = createContext({ console });
for (const f of ['src/core/text.js', 'src/core/lists.js']) {
  runInContext(readFileSync(join(EXT, f), 'utf8'), ctx, { filename: f });
}

const SP = '2GRtAbCdEfGhIjKlMnOpQr';
const YT = 'UCLeAbCdEfGhIjKlMnOpQrSt';
const NOW = new Date('2026-11-17T10:00:00.000Z');
const v = (o = {}) => ({
  name: 'Zed', verdict: 'ai', confidence: 70, rawConfidence: 70, signals: ['x'], reasons: ['secret reason'],
  sources: ['https://example.org/s'], model: 'm', checked: '2026-11-16', source: 'live', shlabs: 0.9, ...o,
});
const MAP = { ok: true, points: [[0, 0], [60, 60], [90, 95], [100, 100]] };
const build = (rows, o = {}) => JSON.parse(buildList(rows, { now: NOW, calibrated: false, mapping: null, ...o }));

await run([
  ['sorted by normalised name', () => {
    const l = build([v({ name: 'beta' }), v({ name: 'Alpha' }), v({ name: '  gamma ' })]);
    return l.artists.map((a) => a.name).join('|') === 'Alpha|beta|  gamma ' || JSON.stringify(l.artists.map((a) => a.name));
  }],
  ['header and formatting', () => {
    const text = buildList([v()], { now: NOW, calibrated: true, mapping: MAP });
    const l = JSON.parse(text);
    return (text.endsWith('}\n') && text.includes('\n  "name"') && l.name === 'Human Music verdicts'
      && l.updated === NOW.toISOString() && l.calibrated === true) || text;
  }],
  ['calibrated passes through, only true when true', () => {
    return build([], { calibrated: true }).calibrated === true && build([], { calibrated: false }).calibrated === false
      && build([], { calibrated: 'yes' }).calibrated === false;
  }],
  ['field whitelist', () => {
    const a = build([v({ spotifyId: SP, channelId: YT })]).artists[0];
    const keys = Object.keys(a).sort().join(',');
    return keys === 'channelId,checked,confidence,name,spotifyId,verdict' || keys;
  }],
  ['no reasons, sources, signals or scores anywhere in the text', () => {
    const text = buildList([v()], { now: NOW, calibrated: false, mapping: null });
    return !/secret reason|example\.org|signals|sources|reasons|shlabs|rawConfidence/.test(text) || text;
  }],
  ['invalid ids dropped', () => {
    const a = build([v({ spotifyId: 'short', channelId: 'UCnope' })]).artists[0];
    return (!('spotifyId' in a) && !('channelId' in a)) || JSON.stringify(a);
  }],
  ['calibration rows never included', () => {
    const l = build([v({ name: 'a', source: 'calibration' }), v({ name: 'b' })]);
    return (l.artists.length === 1 && l.artists[0].name === 'b') || JSON.stringify(l.artists);
  }],
  ['ai confidence is mapped from the raw value; not ready caps at 94', () => {
    const mapped = build([v({ rawConfidence: 90 })], { mapping: MAP }).artists[0].confidence;
    const capped = build([v({ rawConfidence: 100 })], { mapping: null }).artists[0].confidence;
    return (mapped === 95 && capped === 94) || `${mapped} ${capped}`;
  }],
  ['human and unsure confidences pass unchanged', () => {
    const l = build([v({ name: 'h', verdict: 'human', confidence: 97, rawConfidence: 97 }), v({ name: 'u', verdict: 'unsure', confidence: 40, rawConfidence: 40 })], { mapping: null });
    return (l.artists[0].confidence === 97 && l.artists[1].confidence === 40) || JSON.stringify(l.artists);
  }],
  ['output round-trips through the extension parseFilterList', () => {
    const rows = [
      v({ name: 'Zed', spotifyId: SP, rawConfidence: 90 }),
      v({ name: 'Ann', channelId: YT, verdict: 'human', confidence: 88, rawConfidence: 88 }),
      v({ name: 'Mid', verdict: 'unsure', confidence: 30, rawConfidence: 30 }),
    ];
    const text = buildList(rows, { now: NOW, calibrated: true, mapping: MAP });
    const want = JSON.parse(text);
    const got = ctx.HM.lists.parseFilterList(JSON.parse(text));
    if (!got || got.calibrated !== true || got.artists.length !== 3) return JSON.stringify(got);
    for (let i = 0; i < 3; i++) {
      const w = want.artists[i];
      const g = got.artists[i];
      if (g.name !== w.name || g.verdict !== w.verdict || g.confidence !== w.confidence) return JSON.stringify([w, g]);
      if (g.spotifyId !== w.spotifyId || g.channelId !== w.channelId) return JSON.stringify([w, g]);
    }
    return true;
  }],
]);
