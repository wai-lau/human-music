import { load, run } from './load.mjs';

const ctx = load(['src/core/text.js', 'src/core/lists.js']);
const { parseFilterList, isRefreshDue, importBackup, exportBackup, mergeUser, SOUL_OVER_AI } = ctx.HM.lists;

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

run([
  ['parseFilterList: Soul Over AI array', () => {
    const r = parseFilterList([{ name: 'A', removed: false }, { name: 'B', removed: true }, { name: 'C' }]);
    return deepEqual(r, { artists: [{ name: 'A' }, { name: 'C' }] }) || 'got ' + JSON.stringify(r);
  }],
  ['parseFilterList: simple array of strings', () => {
    const r = parseFilterList(['A', 'B']);
    return deepEqual(r, { artists: [{ name: 'A' }, { name: 'B' }] }) || 'got ' + JSON.stringify(r);
  }],
  ['parseFilterList: Human Music own format', () => {
    const r = parseFilterList({ name: 'HM', updated: '2026-11-11', artists: [{ name: 'A', channelId: 'UC1' }] });
    return deepEqual(r, { artists: [{ name: 'A', channelId: 'UC1' }] }) || 'got ' + JSON.stringify(r);
  }],
  ['parseFilterList: HTML → null', () => parseFilterList('<html>') === null || 'not null'],
  ['parseFilterList: unknown object → null', () => parseFilterList({ foo: 1 }) === null || 'not null'],
  ['parseFilterList: null → null', () => parseFilterList(null) === null || 'not null'],
  ['isRefreshDue: never fetched', () => isRefreshDue(null, 'manual', 0) === true || 'not true'],
  ['isRefreshDue: daily, exactly due', () => isRefreshDue(0, 'daily', 86400000) === true || 'not true'],
  ['isRefreshDue: daily, one second before', () => isRefreshDue(0, 'daily', 86399999) === false || 'not false'],
  ['isRefreshDue: manual, long ago', () => isRefreshDue(0, 'manual', 1e12) === false || 'not false'],
  ['isRefreshDue: unknown frequency → daily', () => isRefreshDue(0, 'bogus', 86400000) === true || 'not true'],
  ['importBackup: old extension format', () => {
    const r = importBackup({
      blockedArtists: ['A'],
      blockedKeywords: ['k'],
      blockedTracks: ['Old Song', { title: 'T', artist: 'Manual Entry' }, { title: 'U', artist: 'Band • Album' }]
    });
    return deepEqual(r.user.artists, ['A']) &&
      deepEqual(r.user.keywords, ['k']) &&
      deepEqual(r.user.neverSkip, []) &&
      deepEqual(r.user.songs, [
        { title: 'Old Song', artist: null },
        { title: 'T', artist: null },
        { title: 'U', artist: 'Band' }
      ]) || 'got ' + JSON.stringify(r);
  }],
  ['importBackup: own format round-trip', () => {
    const state = {
      user: { artists: ['The Velvet Sundown'], songs: [{ title: 'Love', artist: null }], keywords: ['remix'], neverSkip: [] },
      settings: { lookahead: 5, autoSkip: false },
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://example.com/list.json', enabled: true, mode: 'act', builtIn: true }]
    };
    const exported = exportBackup(state);
    const imported = importBackup(exported);
    return deepEqual(imported, { user: state.user, settings: state.settings, filterLists: state.filterLists }) || 'not equal';
  }],
  ['exportBackup: format and version', () => {
    const e = exportBackup({ user: {}, settings: {}, filterLists: [] });
    return e.format === 'human-music-backup' && e.version === 1 || 'wrong format/version';
  }],
  ['exportBackup: no artist data from filter lists', () => {
    const state = {
      user: { artists: [], songs: [], keywords: [], neverSkip: [] },
      settings: { lookahead: 3 },
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://example.com/list.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: 123, count: 100, lastError: null }]
    };
    const e = exportBackup(state);
    const list = e.filterLists[0];
    return list.lastRefresh === undefined && list.count === undefined && list.lastError === undefined || 'leaked metadata';
  }],
  ['importBackup: empty object throws', () => {
    try { importBackup({}); return 'no throw'; } catch (e) { return true; }
  }],
  ['importBackup: non-object throws', () => {
    try { importBackup('x'); return 'no throw'; } catch (e) { return true; }
  }],
  ['mergeUser: case-insensitive duplicate keeps first spelling', () => {
    const a = { artists: ['A'], songs: [], keywords: [], neverSkip: [] };
    const b = { artists: ['a', 'B'], songs: [], keywords: [], neverSkip: [] };
    const r = mergeUser(a, b);
    return deepEqual(r.artists, ['A', 'B']) || 'got ' + JSON.stringify(r.artists);
  }],
  ['mergeUser: song duplicate by normalized title+artist', () => {
    const a = { artists: [], songs: [{ title: 'Love', artist: 'Some Band' }], keywords: [], neverSkip: [] };
    const b = { artists: [], songs: [{ title: 'love', artist: 'SOME BAND • Album' }], keywords: [], neverSkip: [] };
    const r = mergeUser(a, b);
    return r.songs.length === 1 || 'got ' + r.songs.length;
  }],
  ['SOUL_OVER_AI has expected shape', () => {
    return SOUL_OVER_AI.id === 'soul-over-ai' &&
      SOUL_OVER_AI.name === 'Soul Over AI' &&
      SOUL_OVER_AI.enabled === true &&
      SOUL_OVER_AI.mode === 'act' &&
      SOUL_OVER_AI.builtIn === true || 'wrong shape';
  }]
]);
