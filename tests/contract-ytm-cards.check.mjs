// Contract check (review 2026-11-17, page side, finding 8): two YouTube Music cards that hid a
// person's music.
// 1. A playlist card whose subtitle lists several artists ("Playlist • Norah Jones, The Velvet
//    Sundown, Bon Iver") is a mix, not their work: one listed name must not hide it. A
//    playlist by one listed artist still hides.
// 2. A search result shelf for a person read the links of the songs inside it, so the
//    person's whole card hid because one song inside is a duet with a listed artist. A card
//    is read from its own title and subtitle only; the song row inside is its own item.
// Run from the repo root: node tests/contract-ytm-cards.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/page/common.js', 'src/page/ytm.js']).HM;
const index = HM.match.buildIndex({ filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act', artists: [{ name: 'The Velvet Sundown' }] }], user: HM.store.emptyUser(), threshold: null });
const card = (title, subtitle) => el('ytmusic-two-row-item-renderer', {}, el('div', { class: 'title' }, title), el('div', { class: 'subtitle' }, subtitle));
const shelf = el('ytmusic-card-shelf-renderer', {},
  el('div', { class: 'title' }, el('a', { href: 'channel/UCPERSONPERSONPERSONPERS' }, 'Some Person')),
  el('div', { class: 'subtitle' }, 'Artist • 2M subscribers'),
  el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title' }, 'Duet'),
    el('div', { class: 'secondary-flex-columns' }, 'Song • ', el('a', { href: 'channel/UCPERSONPERSONPERSONPERS' }, 'Some Person'), ' & ', el('a', { href: 'channel/UC1111111111111111111111' }, 'The Velvet Sundown'))));
const doc = makeDocument(
  card('Chill Mix', 'Playlist • Norah Jones, The Velvet Sundown, Bon Iver'),
  card('Mix', 'Norah Jones, The Velvet Sundown, Bon Iver'),
  card('Sundown Hits', 'Playlist • The Velvet Sundown'),
  shelf);
const items = HM.ytm.readPageItems(doc, '/search');
const got = Object.fromEntries(items.map((i) => [i.title, { credits: i.credits, mode: (HM.match.matchItem(index, i) || {}).mode || null }]));

await t('a playlist listing several artists is a mix: not hidden for one listed name', () =>
  (got['Chill Mix'] && got['Chill Mix'].mode === null) || J(got['Chill Mix']));
await t('a mix card stays a mix', () => (got.Mix && got.Mix.mode === null) || J(got.Mix));
await t('a playlist by one listed artist still hides', () => (got['Sundown Hits'] && got['Sundown Hits'].mode === 'act') || J(got['Sundown Hits']));
await t('a person\'s search shelf is read from its own header, not the songs inside', () =>
  (got['Some Person'] && J(got['Some Person'].credits) === J(['Some Person']) && got['Some Person'].mode === null) || J(got['Some Person']));
await t('the duet inside the shelf is still its own item', () => (got.Duet && got.Duet.mode === 'act') || J(got.Duet));

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
