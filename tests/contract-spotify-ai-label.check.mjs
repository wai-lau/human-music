// Contract check: Spotify's own "AI Persona" tag as a built-in list, "Spotify's AI label" (Wai,
// 2026-11-26). The adapter marks which credited artists carry the tag (item.aiTagged); the
// match treats a tagged artist as listed while the list is on; Never skip wins; a mix needs
// every artist listed or tagged; the list has no address and is never fetched.
// Run from the repo root: node tests/contract-spotify-ai-label.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.message}`); } };
const A = 'A'.repeat(22), B = 'B'.repeat(22);
const tag = (txt = 'AI Persona') => el('span', { 'data-encore-id': 'tag' }, txt);
const link = (n, id) => el('a', { href: `/artist/${id}` }, n);

const { HM } = load(['src/core/text.js', 'src/core/lists.js', 'src/core/match.js', 'src/page/common.js', 'src/page/spotify.js'], { setTimeout, clearTimeout });
const sp = HM.spotify;

// --- tag pairing ---
function pageWith(...children) { return makeDocument(el('main', {}, ...children)); }
const row = (...line) => el('div', { 'data-encore-id': 'listRow' }, el('a', { href: `/track/${'t'.repeat(22)}` }, el('span', { 'data-encore-id': 'listRowTitle' }, 'Song')), el('span', { class: 'line-clamp' }, ...line));
await t('a tag after artist A in a two-artist line tags only A', () => {
  const items = sp.readPageItems(pageWith(row(link('Act A', A), tag(), ', ', link('Act B', B))), '/search/x');
  return J(items[0].aiTagged) === J(['Act A']) || J(items[0].aiTagged);
});
await t('a tag after artist B tags only B', () => {
  const items = sp.readPageItems(pageWith(row(link('Act A', A), ', ', link('Act B', B), tag())), '/search/x');
  return J(items[0].aiTagged) === J(['Act B']) || J(items[0].aiTagged);
});
await t('text other than "AI Persona" does not count; case and spaces are forgiven', () => {
  const none = sp.readPageItems(pageWith(row(link('Act A', A), tag('AI Generated'), tag('Explicit'))), '/search/x')[0];
  const ok = sp.readPageItems(pageWith(row(link('Act A', A), tag('  ai persona '))), '/search/x')[0];
  return (!(none.aiTagged || []).length && J(ok.aiTagged) === J(['Act A'])) || J({ none: none.aiTagged, ok: ok.aiTagged });
});
await t('the top result card: a tag beside the card\'s own artist tags that artist', () => {
  const card = el('div', { 'data-encore-id': 'card' }, el('div', { 'data-testid': 'title' }, el('a', { href: `/artist/${A}`, 'data-encore-id': 'cardTitle' }, 'Act A'), tag()));
  const it = sp.readPageItems(pageWith(card), '/search/x')[0];
  return J(it.aiTagged) === J(['Act A']) || J(it.aiTagged);
});
await t('the playing song: a tag beside an artist in the byline', () => {
  const bar = el('aside', { 'data-testid': 'now-playing-bar' }, el('div', { 'data-testid': 'now-playing-widget-v2' },
    el('a', { 'data-testid': 'context-item-link', href: '/album/x' }, 'Song'),
    el('div', { 'data-testid': 'now-playing-widget-v2-byline' }, link('Act A', A), tag(), ', ', link('Act B', B))));
  const s = sp.readSong(makeDocument(bar));
  return J(s.aiTagged) === J(['Act A']) || J(s);
});
await t('queue rows carry their own tags', () => {
  const li = el('li', { role: 'row' }, row(link('Act A', A), tag()));
  const li2 = el('li', { role: 'row' }, row(link('Act B', B)));
  const doc = makeDocument(el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }, li, li2)));
  const rows = sp.readQueue(doc);
  return (J(rows[0].aiTagged) === J(['Act A']) && !(rows[1].aiTagged || []).length) || J(rows.map(r => r.aiTagged));
});

// --- matching ---
const LABEL = () => ({ ...HM.lists.SPOTIFY_AI_LABEL, artists: [] });
const index = (over = {}, user = {}) => HM.match.buildIndex({ filterLists: [{ ...LABEL(), ...over }], user: { artists: [], songs: [], keywords: [], neverSkip: [], ...user }, threshold: 0.5 });
await t('SPOTIFY_AI_LABEL: built in, on, acting, named, no address', () => {
  const l = HM.lists.SPOTIFY_AI_LABEL || {};
  return (l.id === 'spotify-ai-label' && l.name === "Spotify's AI label" && l.builtIn === true && l.enabled === true && l.mode === 'act' && !l.url) || J(l);
});
const song = { title: 'S', artistLine: 'Act A', credits: ['Act A'], channelIds: [A], aiTagged: ['Act A'] };
await t('on: a tagged artist matches the list, entry is that artist', () => {
  const m = HM.match.matchSong(index(), song);
  return (m && m.listId === 'spotify-ai-label' && m.listName === "Spotify's AI label" && m.entry === 'Act A' && m.mode === 'act') || J(m);
});
await t('off: no match', () => HM.match.matchSong(index({ enabled: false }), song) === null || 'matched');
await t('an untagged artist does not match', () => HM.match.matchSong(index(), { ...song, aiTagged: [] }) === null || 'matched');
await t('Never skip wins', () => HM.match.matchSong(index({}, { neverSkip: ['act a'] }), song) === null || 'matched');
const card = { title: 'Mix', credits: ['Act A', 'Act B'], names: ['Act A', 'Act B'], channelIds: [A, B], featured: true, kind: 'other' };
await t('a mix hides only when every artist is tagged', () => {
  const one = HM.match.matchItem(index(), { ...card, aiTagged: ['Act A'] });
  const both = HM.match.matchItem(index(), { ...card, aiTagged: ['Act A', 'Act B'] });
  return (one === null && both && both.listId === 'spotify-ai-label') || J({ one, both });
});
await t('a mix: one tagged, the other on Your artists, matches', () => {
  const m = HM.match.matchItem(index({}, { artists: ['Act B'] }), { ...card, aiTagged: ['Act A'] });
  return (m && m.mode === 'act') || J(m);
});
await t('a single-artist card matches; Never skip wins there too', () => {
  const c = { title: 'Act A', credits: ['Act A'], channelIds: [A], featured: false, kind: 'other', aiTagged: ['Act A'] };
  return (HM.match.matchItem(index(), c) && HM.match.matchItem(index({}, { neverSkip: ['Act A'] }), c) === null) || 'wrong';
});

// --- built-in upkeep ---
const ctxFor = () => {
  let ctx;
  const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
  ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
  runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
  return ctx;
};
const bg = ctxFor();
let fetched = [];
const fetch = async url => { fetched.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => (url === 'lists/index.json' ? '{"files":[]}' : '{"artists":[]}') }; };
const OTHERS = new Set(Object.values(bg.HM.lists).filter(l => l && l.url).map(l => l.url));
const onlyForLabel = urls => urls.filter(u => !/^lists\//.test(u) && !OTHERS.has(u));
const refresher = s => bg.HM.createRefresher({ storage: s, fetch, now: () => 1, assetUrl: p => p });
await t('a fresh install has the label list on, and fetches nothing for it', async () => {
  fetched = []; const s = fakeStorage({});
  await refresher(s).install();
  const l = s.data['hm.filterLists'].find(x => x.id === 'spotify-ai-label');
  const bad = onlyForLabel(fetched);
  return (l && l.enabled === true && l.builtIn === true && !l.url && !bad.length && !('hm.list.spotify-ai-label' in s.data && s.data['hm.list.spotify-ai-label'].artists.length)) || J({ l, fetched });
});
await t('an existing install gains it at the next start, without a fetch', async () => {
  fetched = []; const L = bg.HM.lists;
  const s = fakeStorage({ 'hm.filterLists': [{ ...L.SOUL_OVER_AI }, { ...L.HM_VERDICTS }, { ...L.CEVVAL }, { ...L.ZOUNDHUB }] });
  await refresher(s).ensureBuiltIns();
  const l = s.data['hm.filterLists'].find(x => x.id === 'spotify-ai-label');
  return (l && l.enabled === true && !onlyForLabel(fetched).length) || J({ l, fetched });
});
await t('off stays off after a restart and a refresh pass; the list is never fetched', async () => {
  fetched = []; const L = bg.HM.lists;
  const s = fakeStorage({ 'hm.filterLists': [{ ...L.SPOTIFY_AI_LABEL, enabled: false }] });
  const r = refresher(s);
  await r.ensureBuiltIns(); await r.refreshDue();
  const l = s.data['hm.filterLists'].find(x => x.id === 'spotify-ai-label');
  return (l.enabled === false && !onlyForLabel(fetched).length) || J({ l, fetched });
});
await t('even switched on, the refresher does not fetch it or record a failure', async () => {
  fetched = []; const L = bg.HM.lists;
  const s = fakeStorage({ 'hm.filterLists': [{ ...L.SPOTIFY_AI_LABEL }] });
  const r = refresher(s);
  await r.refreshDue(); await r.refreshOne('spotify-ai-label');
  const l = s.data['hm.filterLists'][0];
  return (!onlyForLabel(fetched).length && !l.lastError) || J({ l, fetched });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
