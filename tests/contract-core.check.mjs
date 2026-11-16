// Contract check for Task 5 (settings, log, lookahead). Run from the repo root:
//   node tests/contract-core.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { settings, log, lookahead } = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js']).HM;
const fails = [];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const J = v => JSON.stringify(sortKeys(v));
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const D = { lookahead: 3, autoSkip: true, autoDislike: false, hidePageItems: true, playerButtons: true, paused: false, refresh: 'daily', mode: 'lists', modeChosen: false, investigate: false };
eq('DEFAULTS', settings.DEFAULTS, D);
eq('sanitize {}', settings.sanitize({}), D);
eq('sanitize null', settings.sanitize(null), D);
t('sanitize returns a copy', () => settings.sanitize({}) !== settings.DEFAULTS || 'same object');
eq('lookahead clamp', [99, -1, '4', 4.7, 'x', NaN, null, '', ' 5 ', Infinity].map(v => settings.sanitize({ lookahead: v }).lookahead), [10, 0, 4, 4, 3, 3, 3, 3, 5, 3]);
eq('refresh', [settings.sanitize({ refresh: 'hourly' }).refresh, settings.sanitize({ refresh: 'weekly' }).refresh], ['daily', 'weekly']);
eq('booleans', settings.sanitize({ autoSkip: false, paused: true, autoDislike: 'yes' }), { ...D, autoSkip: false, paused: true, mode: 'off' });
eq('unknown keys dropped', Object.keys(settings.sanitize({ bogus: 1 })).sort(), Object.keys(D).sort());

const song = { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating • 2025' };
const soa = { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown', mode: 'act' };
const e = (event, match = soa, at = 1000) => log.makeEntry({ event, song, match, at });
eq('makeEntry', e('skipped'), { at: 1000, event: 'skipped', title: song.title, artistLine: song.artistLine, listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown' });
eq('makeEntry empty', log.makeEntry({ event: 'seen', at: 5 }), { at: 5, event: 'seen', title: '', artistLine: '', listId: null, listName: null, rule: null, entry: null });
const u = (listId, entry = 'x', rule = 'artist') => ({ listId, listName: 'Your', rule, entry, mode: 'act' });
eq('describe', [
  log.describe(e('removed')), log.describe(e('skipped')), log.describe(e('disliked')),
  log.describe(e('seen', u('user:artists'))), log.describe(e('watched')),
  log.describe(e('skipped', u('user:keywords', 'remix', 'keyword'))), log.describe(e('skipped', u('user:songs', 'Love', 'song'))),
  log.describe(e('hidden')),
], [
  'Removed from queue: AI-generated (Soul Over AI)', 'Skipped: AI-generated (Soul Over AI)', 'Skipped and disliked: AI-generated (Soul Over AI)',
  'Played (auto-skip off): on your artists list', 'Watch mode, left alone: AI-generated (Soul Over AI)',
  'Skipped: keyword "remix" from your keywords list', 'Skipped: on your songs list', 'Hidden on page: AI-generated (Soul Over AI)',
]);
t('describe wording', () => !/\b(slop|fake|garbage)\b|fight ai/i.test(['removed', 'skipped', 'disliked', 'seen', 'watched', 'hidden'].map(v => log.describe(e(v))).join(' ')) || 'bad word');

const h = e('hidden', soa, 0);
eq('seenRecently', [log.seenRecently([h], h, 3600000), log.seenRecently([h], h, 90000000), log.seenRecently([e('skipped', soa, 0)], h, 3600000)], [true, false, false]);
const many = Array.from({ length: 1000 }, (_, i) => e('skipped', soa, i));
const added = log.append(many, e('removed', soa, 5000));
t('append cap', () => (added.length === 1000 && added[0].event === 'removed' && many.length === 1000 && many[0].at === 0) || `len ${added.length} first ${added[0].event} input ${many.length}`);
eq('append default cap', log.append([], e('seen')).length, 1);
eq('append small cap', log.append([e('seen'), e('seen')], e('removed'), 2).map(x => x.event), ['removed', 'seen']);

const watch = { ...soa, mode: 'watch' };
const rows = [{ title: 'A', artistLine: 'a', selected: true }, { title: 'B', artistLine: 'b', selected: false }, { title: 'C', artistLine: 'c', selected: false },
  { title: 'D', artistLine: 'd', selected: false }, { title: 'E', artistLine: 'e', selected: false }];
const fn = s => ({ B: soa, D: soa, E: soa, C: null }[s.title] ?? null);
eq('pick 3', lookahead.pickRemovals(rows, 3, fn).remove, [1, 3]);
eq('pick 0', lookahead.pickRemovals(rows, 0, fn), { remove: [], watched: [] });
eq('no selected', lookahead.pickRemovals(rows.map(r => ({ ...r, selected: false })), 3, fn), { remove: [], watched: [] });
eq('watch', lookahead.pickRemovals(rows, 3, s => (s.title === 'C' ? watch : null)), { remove: [], watched: [{ index: 2, match: watch }] });
eq('selected in middle', lookahead.pickRemovals([rows[1], { ...rows[0] }, rows[3]], 5, fn).remove, [2]);
eq('throwing matchFn', lookahead.pickRemovals(rows, 3, s => { if (s.title === 'B') throw new Error('x'); return fn(s); }).remove, [3]);
eq('fractional distance', lookahead.pickRemovals(rows, 1.9, fn).remove, [1]);
eq('negative distance', lookahead.pickRemovals(rows, -2, fn).remove, []);

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
