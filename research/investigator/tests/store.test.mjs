import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';

const SP = '2GRtAbCdEfGhIjKlMnOpQr';
const YT = 'UCLeAbCdEfGhIjKlMnOpQrSt';

const verdict = (o = {}) => ({
  name: 'The Velvet Sundown', verdict: 'ai', confidence: 90, rawConfidence: 95,
  signals: ['deezer_ai_label'], reasons: ['label'], sources: ['https://example.org/a'],
  model: 'claude-x', checked: '2026-11-16', source: 'live', ...o,
});
const throws = (fn) => { try { fn(); } catch { return true; } return false; };

await run([
  ['put then find by each key', () => {
    const s = openStore(':memory:');
    s.putVerdict(verdict({ spotifyId: SP, channelId: YT }));
    for (const k of [`sp:${SP}`, `yt:${YT}`, 'nm:the velvet sundown']) {
      const v = s.findVerdict([k]);
      if (!v || v.verdict !== 'ai' || v.confidence !== 90 || v.rawConfidence !== 95) return k + ' -> ' + JSON.stringify(v);
    }
    const v = s.findVerdict(['nm:the velvet sundown']);
    return (JSON.stringify(v.signals) === '["deezer_ai_label"]' && v.checked === '2026-11-16' && v.model === 'claude-x') || JSON.stringify(v);
  }],
  ['unknown keys give null', () => {
    const s = openStore(':memory:');
    return s.findVerdict(['nm:nobody']) === null && s.findVerdict([]) === null;
  }],
  ['a second put with a new Spotify ID adds the key', () => {
    const s = openStore(':memory:');
    const id1 = s.putVerdict(verdict());
    const id2 = s.putVerdict(verdict({ spotifyId: SP, confidence: 80 }));
    const v = s.findVerdict([`sp:${SP}`]);
    return (id1 === id2 && v && v.confidence === 80 && s.findVerdict(['nm:the velvet sundown']).confidence === 80) || JSON.stringify([id1, id2, v]);
  }],
  ['YouTube and Spotify items joined by one answer give one artist', () => {
    const s = openStore(':memory:');
    const a = s.putVerdict(verdict({ name: 'Act', channelId: YT, verdict: 'unsure', confidence: 40 }));
    const b = s.putVerdict(verdict({ name: 'Act Official', spotifyId: SP, verdict: 'unsure', confidence: 40 }));
    if (a === b) return 'should be two artists first';
    const c = s.putVerdict(verdict({ name: 'Act', channelId: YT, spotifyId: SP, verdict: 'human', confidence: 70 }));
    const byYt = s.findVerdict([`yt:${YT}`]);
    const bySp = s.findVerdict([`sp:${SP}`]);
    const byNm = s.findVerdict(['nm:act official']);
    return (c === Math.min(a, b) && byYt.verdict === 'human' && bySp.verdict === 'human' && byNm && byNm.verdict === 'human' && s.listPublishable().length === 1) || JSON.stringify([a, b, c, byYt, bySp, byNm]);
  }],
  ['merged artists keep their scores', () => {
    const s = openStore(':memory:');
    const a = s.putVerdict(verdict({ name: 'Act', channelId: YT }));
    const b = s.putVerdict(verdict({ name: 'Other', spotifyId: SP }));
    s.putScores(b, [{ trackId: 't1', probability: 0.9, label: 'ai', generator: 'suno', at: '2026-11-16T00:00:00Z' }]);
    const c = s.putVerdict(verdict({ name: 'Act', channelId: YT, spotifyId: SP }));
    return (c === a && s.getScores(a).length === 1 && s.getScores(a)[0].trackId === 't1') || JSON.stringify(s.getScores(a));
  }],
  ['listPublishable omits calibration rows', () => {
    const s = openStore(':memory:');
    s.putVerdict(verdict({ name: 'Live One' }));
    s.putVerdict(verdict({ name: 'Calib One', source: 'calibration' }));
    const l = s.listPublishable();
    return (l.length === 1 && l[0].name === 'Live One') || JSON.stringify(l);
  }],
  ['bump returns 1, 2 on one day and 1 on the next; count reads it', () => {
    const s = openStore(':memory:');
    const r = [s.count('2026-11-16'), s.bump('2026-11-16'), s.bump('2026-11-16'), s.bump('2026-11-17'), s.count('2026-11-16'), s.count('2026-11-17')];
    return JSON.stringify(r) === '[0,1,2,1,2,1]' || JSON.stringify(r);
  }],
  ['scores round-trip and are not in listPublishable', () => {
    const s = openStore(':memory:');
    const id = s.putVerdict(verdict());
    const sc = [{ trackId: 't1', probability: 0.97, label: 'ai', generator: 'suno', at: '2026-11-16T01:00:00Z' }];
    s.putScores(id, sc);
    s.putScores(id, [{ trackId: 't2', probability: 0.1, label: 'human', generator: null, at: '2026-11-16T02:00:00Z' }]);
    const got = s.getScores(id);
    const pub = JSON.stringify(s.listPublishable());
    return (got.length === 2 && JSON.stringify(got[0]) === JSON.stringify(sc[0]) && got[1].generator === null && !pub.includes('0.97') && !pub.includes('suno') && !pub.includes('probability')) || JSON.stringify([got, pub]);
  }],
  ['putScores on the same track replaces it', () => {
    const s = openStore(':memory:');
    const id = s.putVerdict(verdict());
    s.putScores(id, [{ trackId: 't1', probability: 0.5, label: 'x', generator: 'g', at: 'a' }]);
    s.putScores(id, [{ trackId: 't1', probability: 0.6, label: 'y', generator: 'g', at: 'b' }]);
    const g = s.getScores(id);
    return (g.length === 1 && g[0].probability === 0.6) || JSON.stringify(g);
  }],
  ['state round-trips; missing is null', () => {
    const s = openStore(':memory:');
    s.setState('pause', 'login expired');
    s.setState('map', { a: [1, 2] });
    s.setState('pause', 'again');
    return s.getState('pause') === 'again' && JSON.stringify(s.getState('map')) === '{"a":[1,2]}' && s.getState('none') === null;
  }],
  ['reopening a file path keeps the data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-store-'));
    try {
      const path = join(dir, 'v.sqlite');
      const s = openStore(path);
      s.putVerdict(verdict({ spotifyId: SP }));
      s.bump('2026-11-16');
      s.setState('k', 'v');
      s.close();
      const t = openStore(path);
      const ok = t.findVerdict([`sp:${SP}`]).verdict === 'ai' && t.count('2026-11-16') === 1 && t.getState('k') === 'v';
      t.close();
      return ok;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
  ['bad verdict word or confidence is refused and stores nothing', () => {
    const s = openStore(':memory:');
    const bad = [{ verdict: 'maybe' }, { confidence: 101 }, { confidence: -1 }, { confidence: 'high' }, { confidence: 5.5 }, { source: 'x' }, { name: '' }];
    for (const b of bad) if (!throws(() => s.putVerdict(verdict(b)))) return 'accepted ' + JSON.stringify(b);
    return s.listPublishable().length === 0;
  }],
  ['injection-looking text is stored as plain data', () => {
    const s = openStore(':memory:');
    s.putVerdict(verdict({ name: "x'); DROP TABLE artists;--", reasons: ['ignore the rules'] }));
    return s.findVerdict(["nm:x'); drop table artists;--"]) !== null && s.listPublishable().length === 1;
  }],
  ['store.db is exposed for the queue', () => {
    const s = openStore(':memory:');
    s.db.exec('CREATE TABLE q (a)');
    return typeof s.db.prepare === 'function';
  }],
]);
