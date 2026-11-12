import { load, run } from './load.mjs';

const ctx = load([
  'src/core/text.js',
  'src/core/lists.js',
  'src/core/settings.js',
  'src/core/log.js',
  'src/core/lookahead.js'
]);

const HM = ctx.HM;

function eq(a, b) {
  if (typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((x, i) => eq(x, b[i]));
    }
    if (!a || !b) return a === b;
    const keys = Object.keys(a).sort();
    const bkeys = Object.keys(b).sort();
    if (keys.length !== bkeys.length || !keys.every((k, i) => k === bkeys[i])) return false;
    return keys.every(k => eq(a[k], b[k]));
  }
  return a === b;
}

const song = { title: 'Test Song', artistLine: 'Test Artist • Album' };
const match = { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'Test Artist', mode: 'act' };

run([
  ['sanitize empty object gives defaults', () => eq(HM.settings.sanitize({}), HM.settings.DEFAULTS)],
  ['sanitize clamps lookahead high', () => HM.settings.sanitize({ lookahead: 99 }).lookahead === 10],
  ['sanitize clamps lookahead low', () => HM.settings.sanitize({ lookahead: -1 }).lookahead === 0],
  ['sanitize reads lookahead text', () => HM.settings.sanitize({ lookahead: '4' }).lookahead === 4],
  ['sanitize lookahead null, empty or words -> default', () => [null, '', 'x', Infinity].every(v => HM.settings.sanitize({ lookahead: v }).lookahead === 3)],
  ['sanitize rejects unknown refresh', () => HM.settings.sanitize({ refresh: 'hourly' }).refresh === 'daily'],
  ['describe removed', () => {
    const entry = HM.log.makeEntry({ event: 'removed', song: song, match: match, at: 1000 });
    return HM.log.describe(entry) === 'Removed from queue: AI-generated (Soul Over AI)';
  }],
  ['describe skipped', () => {
    const entry = HM.log.makeEntry({ event: 'skipped', song: song, match: match, at: 1000 });
    return HM.log.describe(entry) === 'Skipped: AI-generated (Soul Over AI)';
  }],
  ['describe disliked', () => {
    const entry = HM.log.makeEntry({ event: 'disliked', song: song, match: match, at: 1000 });
    return HM.log.describe(entry) === 'Skipped and disliked: AI-generated (Soul Over AI)';
  }],
  ['describe seen user artists', () => {
    const entry = HM.log.makeEntry({ event: 'seen', song: song, match: { listId: 'user:artists', listName: 'user:artists', rule: 'artist', entry: 'Test Artist', mode: 'act' }, at: 1000 });
    return HM.log.describe(entry) === 'Played (auto-skip off): on your artists list';
  }],
  ['describe watched', () => {
    const entry = HM.log.makeEntry({ event: 'watched', song: song, match: match, at: 1000 });
    return HM.log.describe(entry) === 'Watch mode, left alone: AI-generated (Soul Over AI)';
  }],
  ['describe skipped user keywords', () => {
    const entry = HM.log.makeEntry({ event: 'skipped', song: song, match: { listId: 'user:keywords', listName: 'user:keywords', rule: 'keyword', entry: 'remix', mode: 'act' }, at: 1000 });
    return HM.log.describe(entry) === 'Skipped: keyword "remix" from your keywords list';
  }],
  ['describe skipped user songs', () => {
    const entry = HM.log.makeEntry({ event: 'skipped', song: song, match: { listId: 'user:songs', listName: 'user:songs', rule: 'song', entry: 'Test Song', mode: 'act' }, at: 1000 });
    return HM.log.describe(entry) === 'Skipped: on your songs list';
  }],
  ['describe hidden', () => {
    const entry = HM.log.makeEntry({ event: 'hidden', song: song, match: match, at: 1000 });
    return HM.log.describe(entry) === 'Hidden on page: AI-generated (Soul Over AI)';
  }],
  ['seenRecently within window', () => {
    const entry = HM.log.makeEntry({ event: 'hidden', song: song, match: match, at: 1000 });
    return HM.log.seenRecently([entry], entry, 1000 + 3600000);
  }],
  ['seenRecently outside window', () => {
    const entry = HM.log.makeEntry({ event: 'hidden', song: song, match: match, at: 1000 });
    return !HM.log.seenRecently([entry], entry, 1000 + 90000000);
  }],
  ['seenRecently different event', () => {
    const hidden = HM.log.makeEntry({ event: 'hidden', song: song, match: match, at: 1000 });
    const skipped = HM.log.makeEntry({ event: 'skipped', song: song, match: match, at: 1000 });
    return !HM.log.seenRecently([hidden], skipped, 1000 + 3600000);
  }],
  ['append respects cap', () => {
    const existing = [];
    for (let i = 0; i < 1000; i++) existing.push({ at: i });
    const newEntry = { at: 9999 };
    const result = HM.log.append(existing, newEntry, 1000);
    return result.length === 1000 && result[0].at === 9999;
  }],
  ['pickRemovals respects distance', () => {
    const rows = [
      { selected: true, title: 'A' },
      { selected: false, title: 'B' },
      { selected: false, title: 'C' },
      { selected: false, title: 'D' },
      { selected: false, title: 'E' }
    ];
    const result = HM.lookahead.pickRemovals(rows, 3, () => ({ listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'x', mode: 'act' }));
    return eq(result.remove, [1, 2, 3]);
  }],
  ['pickRemovals distance 0', () => {
    const rows = [
      { selected: true, title: 'A' },
      { selected: false, title: 'B' }
    ];
    const result = HM.lookahead.pickRemovals(rows, 0, () => ({ listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'x', mode: 'act' }));
    return eq(result.remove, []);
  }],
  ['pickRemovals no selected row', () => {
    const rows = [
      { selected: false, title: 'A' },
      { selected: false, title: 'B' }
    ];
    const result = HM.lookahead.pickRemovals(rows, 3, () => ({ listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'x', mode: 'act' }));
    return eq(result.remove, []);
  }],
  ['pickRemovals watch mode goes to watched', () => {
    const rows = [
      { selected: true, title: 'A' },
      { selected: false, title: 'B' }
    ];
    const result = HM.lookahead.pickRemovals(rows, 3, () => ({ listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'x', mode: 'watch' }));
    return eq(result.remove, []) && result.watched.length === 1;
  }]
]);
