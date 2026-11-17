// Contract check for the investigator plan, Task 3 (matching by threshold; unknown artists). Run from the repo root:
//   node tests/contract-verdict-match.check.mjs
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { match, log } = load(['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js']).HM;
const fails = [];
const J = v => JSON.stringify(v);
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const tryEq = (label, fn, want) => { try { eq(label, fn(), want); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const fixture = JSON.parse(readFileSync(process.cwd() + '/tests/fixtures/verdicts.json', 'utf8'));
const verdictList = { id: 'hm-verdicts', name: 'Human Music verdicts', enabled: true, mode: 'act', artists: fixture.artists.filter(a => typeof a.confidence === 'number' && a.confidence <= 100 && ['ai', 'human', 'unsure'].includes(a.verdict)) };
const soa = { id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act', artists: [{ name: 'The Velvet Sundown' }] };
const emptyUser = { artists: [], songs: [], keywords: [], neverSkip: [] };
const idx = (t, user = emptyUser) => match.buildIndex({ filterLists: [soa, verdictList], user, threshold: t });
const song = name => ({ title: 'A Song', artistLine: `${name} • Album • 2025`, channelIds: [] });
const hit = (index, name) => !!match.matchSong(index, song(name));

tryEq('optimal blocks 97, not 70', () => [hit(idx(95), 'Forrest Rose'), hit(idx(95), 'The Broken Radios')], [true, false]);
tryEq('aggressive blocks 70 and 97', () => [hit(idx(60), 'The Broken Radios'), hit(idx(60), 'Forrest Rose')], [true, true]);
tryEq('people never block', () => hit(idx(60), 'Real Person'), false);
tryEq('unsure never blocks', () => hit(idx(0), 'Thin Evidence'), false);
tryEq('list-only ignores verdicts', () => hit(idx(null), 'Forrest Rose'), false);
tryEq('lists still block at list-only', () => hit(idx(null), 'The Velvet Sundown'), true);
tryEq('never skip wins', () => hit(idx(60, { ...emptyUser, neverSkip: ['Forrest Rose'] }), 'Forrest Rose'), false);
tryEq('confidence in the match', () => match.matchSong(idx(95), song('Forrest Rose')).confidence, 97);
tryEq('match names the verdict list', () => match.matchSong(idx(95), song('Forrest Rose')).listId, 'hm-verdicts');
tryEq('page items too', () => match.matchItem(idx(95), { title: 'X', credits: ['Forrest Rose'], channelIds: [], featured: false }).confidence, 97);
tryEq('no threshold argument means list-only', () => !!match.matchSong(match.buildIndex({ filterLists: [verdictList], user: emptyUser }), song('Forrest Rose')), false);
tryEq('reason with confidence', () => log.reason({ listId: 'hm-verdicts', listName: 'Human Music verdicts', confidence: 97 }), 'AI-generated · Human Music verdicts · 97%');
tryEq('reason without confidence unchanged', () => log.reason({ listId: 'soul-over-ai', listName: 'Soul Over AI' }), 'AI-generated · Soul Over AI');
tryEq('reason with no list is still an empty string', () => log.reason({ listId: null, listName: null }), '');
tryEq('log entry keeps confidence', () => log.makeEntry({ event: 'skipped', song: song('Forrest Rose'), match: { listId: 'hm-verdicts', listName: 'Human Music verdicts', rule: 'artist', entry: 'Forrest Rose', mode: 'act', confidence: 97 }, at: 1 }).confidence, 97);
tryEq('known: any verdict at any confidence', () => match.isKnown(idx(null), { credits: ['real person'], channelIds: [] }), true);
tryEq('known: a list artist', () => match.isKnown(idx(null), { credits: ['the velvet sundown'], channelIds: [] }), true);
tryEq('known: never skip', () => match.isKnown(idx(null, { ...emptyUser, neverSkip: ['Someone'] }), { credits: ['someone'], channelIds: [] }), true);
tryEq('known by channel ID', () => match.isKnown(match.buildIndex({ filterLists: [{ ...soa, artists: [{ name: 'X', channelId: 'UCLeR-eGh2OFy9ydX7IUcOTw' }] }], user: emptyUser, threshold: null }), { credits: [], channelIds: ['UCLeR-eGh2OFy9ydX7IUcOTw'] }), true);
tryEq('unknown', () => match.isKnown(idx(null), { credits: ['brand new act'], channelIds: [] }), false);
tryEq('disabled list is not known', () => match.isKnown(match.buildIndex({ filterLists: [{ ...verdictList, enabled: false }], user: emptyUser, threshold: null }), { credits: ['forrest rose'], channelIds: [] }), false);

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
