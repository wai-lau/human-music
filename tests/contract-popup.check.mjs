// Contract check for Task 9 (popup model + popup.html). Run from the repo root:
//   node tests/contract-popup.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { popup, lists } = load(['src/core/text.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js'], { URL }).HM;
const fails = [];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const J = v => JSON.stringify(sortKeys(v));
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const throws = (label, fn, msg) => { try { fn(); fails.push(`${label}: did not throw`); } catch (e) { if (e.message !== msg) fails.push(`${label}: message ${J(e.message)}`); } };
const U = o => ({ artists: [], songs: [], keywords: [], neverSkip: [], ...o });

const u0 = U({ artists: ['Beyoncé'] });
const frozen = J(u0);
eq('add artist', popup.addEntry(u0, 'artists', '  The Velvet Sundown ').artists, ['Beyoncé', 'The Velvet Sundown']);
eq('dup by normalize', popup.addEntry(u0, 'artists', 'BEYONCÉ').artists, ['Beyoncé']);
eq('empty ignored', popup.addEntry(u0, 'keywords', '   ').keywords, []);
eq('never skip', popup.addEntry(u0, 'neverSkip', 'Real Band').neverSkip, ['Real Band']);
t('input unchanged', () => J(u0) === frozen || 'mutated');
eq('addSong null artist', popup.addSong(U({}), ' Love ', null).songs, [{ title: 'Love', artist: null }]);
eq('addSong empty artist -> null', popup.addSong(U({}), 'Love', '  ').songs, [{ title: 'Love', artist: null }]);
eq('addSong dup', popup.addSong(U({ songs: [{ title: 'Love', artist: 'Band' }] }), 'love', 'BAND').songs, [{ title: 'Love', artist: 'Band' }]);
eq('addSong same title other artist', popup.addSong(U({ songs: [{ title: 'Love', artist: null }] }), 'Love', 'Band').songs.length, 2);
eq('addSong empty title', popup.addSong(U({}), ' ', 'Band').songs, []);
eq('removeEntry', popup.removeEntry(U({ keywords: ['a', 'b', 'c'] }), 'keywords', 1).keywords, ['a', 'c']);
eq('removeEntry songs', popup.removeEntry(U({ songs: [{ title: 'A', artist: null }] }), 'songs', 0).songs, []);
eq('removeEntry out of range', popup.removeEntry(U({ keywords: ['a'] }), 'keywords', 5).keywords, ['a']);

const base = [{ ...lists.SOUL_OVER_AI }];
const baseJ = J(base);
const l1 = popup.addFilterList(base, 'https://example.org/list.json', ' My List ');
eq('added list', l1[1], { id: 'my-list', name: 'My List', url: 'https://example.org/list.json', enabled: true, mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null });
t('lists unchanged', () => J(base) === baseJ || 'mutated');
eq('id made unique', popup.addFilterList(popup.addFilterList(l1, 'https://b.org/x', 'My list!'), 'https://c.org/y', 'my  LIST').map(l => l.id), ['soul-over-ai', 'my-list', 'my-list-2', 'my-list-3']);
eq('empty name -> hostname', popup.addFilterList(base, 'https://lists.example.net/a.json', '  ')[1].name, 'lists.example.net');
eq('id from symbols only', popup.addFilterList(base, 'https://x.org/a', '!!!')[1].id, 'list');
throws('http rejected', () => popup.addFilterList(base, 'http://x.org/a', 'X'), 'Use an https:// address');
throws('not a url', () => popup.addFilterList(base, 'example', 'X'), 'Use an https:// address');
throws('duplicate url', () => popup.addFilterList(l1, 'https://example.org/list.json', 'Again'), 'That list is already added');
throws('built-in kept', () => popup.removeFilterList(base, 'soul-over-ai'), 'Built-in lists can be switched off but not removed');
eq('remove added', popup.removeFilterList(l1, 'my-list').map(l => l.id), ['soul-over-ai']);
eq('remove unknown', popup.removeFilterList(l1, 'nope').map(l => l.id), ['soul-over-ai', 'my-list']);

const html = readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8');
for (const label of ['Lists', 'Behaviour', 'Log']) t(`tab ${label}`, () => new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`).test(html) || 'no tab button');
t('credit line', () => html.includes('Soul Over AI list by souloverai.com, CC BY 4.0.') || 'missing');
const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
eq('script order', srcs, ['../src/core/text.js', '../src/core/lists.js', '../src/core/settings.js', '../src/core/log.js', 'model.js', 'popup.js']);
t('no inline script', () => !/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html) || 'inline script');
t('popup.js and css exist', () => { readFileSync(process.cwd() + '/extension/popup/popup.js'); readFileSync(process.cwd() + '/extension/popup/popup.css'); return true; });

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
