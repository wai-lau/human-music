// Contract check for Task 6b (page items). Run from the repo root:
//   node tests/contract-ytm-items.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { ytm } = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = v => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const plain = items => items.map(i => ({ title: i.title, credits: i.credits, channelIds: i.channelIds, featured: i.featured }));

const card = (title, subtitle) => el('ytmusic-two-row-item-renderer', {}, el('div', { class: 'title' }, ` ${title} `), el('div', { class: 'subtitle' }, subtitle));
const searchRow = (title, ...bits) => el('ytmusic-responsive-list-item-renderer', {},
  el('div', { class: 'title-column' }, el('div', { class: 'title' }, title)),
  el('div', { class: 'secondary-flex-columns' }, ...bits));
const link = (id, name) => el('a', { href: `channel/${id}` }, name);

t('search row with three channel links', () => {
  const doc = makeDocument(searchRow('Midnight Bloom', 'EP • ', link('UC1', '1950 SoulClub'), ', ', link('UC2', '1960 SoulClub'), ' & ', link('UC3', 'Lewis Hanton'), ' • 2025'));
  const items = plain(ytm.readPageItems(doc, '/search'));
  return J(items) === J([{ title: 'Midnight Bloom', credits: ['1950 SoulClub', '1960 SoulClub', 'Lewis Hanton'], channelIds: ['UC1', 'UC2', 'UC3'], featured: true }]) || J(items);
});
t('repeated link counted once', () => {
  const doc = makeDocument(searchRow('X', link('UC1', 'A'), ' • ', link('UC1', 'A')));
  const i = ytm.readPageItems(doc, '/search')[0];
  return (J(i.credits) === J(['A']) && J(i.channelIds) === J(['UC1'])) || J(plain([i]));
});
t('album card without links', () => {
  const items = plain(ytm.readPageItems(makeDocument(card('Otis Blue', 'Album • Otis Redding')), '/'));
  return J(items) === J([{ title: 'Otis Blue', credits: ['Otis Redding'], channelIds: [], featured: false }]) || J(items);
});
t('EP card with several artists', () => {
  const i = ytm.readPageItems(makeDocument(card('Midnight Bloom', 'EP • 1950 SoulClub, 1960 SoulClub & Lewis Hanton • 2025')), '/explore')[0];
  return J(i.credits) === J(['1950 SoulClub, 1960 SoulClub & Lewis Hanton', '1950 SoulClub', '1960 SoulClub', 'Lewis Hanton']) || J(i.credits);
});
t('song row: type word dropped, artist next', () => {
  const i = ytm.readPageItems(makeDocument(searchRow('Lemon', 'Song • 米津玄師 • Lemon • 4:15')), '/search?q=x')[0];
  return J(i.credits) === J(['米津玄師']) || J(i.credits);
});
t('no type word: first part is the artist', () => {
  const i = ytm.readPageItems(makeDocument(card('Some Mix', 'Daft Punk feat. Pharrell Williams • 2013')), '/')[0];
  return J(i.credits) === J(['Daft Punk feat. Pharrell Williams', 'Daft Punk', 'Pharrell Williams']) || J(i.credits);
});
t('artist card credits the title', () => {
  const i = ytm.readPageItems(makeDocument(card('The Velvet Sundown', 'Artist • 1.2M monthly audience')), '/search')[0];
  return (J(i.credits) === J(['The Velvet Sundown']) && i.featured === false) || J(plain([i]));
});
t('mix card is featured', () => {
  const i = ytm.readPageItems(makeDocument(card('Replay Mix', 'ILLENIUM, GameChops, El Jazzy Chavo')), '/')[0];
  return (i.featured === true && J(i.credits) === J(['ILLENIUM', 'GameChops', 'El Jazzy Chavo'])) || J(plain([i]));
});
t('type word case-insensitive, whole part only', () => {
  const a = ytm.readPageItems(makeDocument(card('A', 'single • Band')), '/')[0];
  const b = ytm.readPageItems(makeDocument(card('B', 'Songbird • 2020')), '/')[0];
  return (J(a.credits) === J(['Band']) && J(b.credits) === J(['Songbird'])) || J([a.credits, b.credits]);
});
t('top result card shelf', () => {
  const shelf = el('ytmusic-card-shelf-renderer', {}, el('div', { class: 'title' }, 'Dust on the Wind'), el('div', { class: 'subtitle' }, 'Song • ', link('UCvs', 'The Velvet Sundown')));
  const items = plain(ytm.readPageItems(makeDocument(shelf), '/search'));
  return J(items) === J([{ title: 'Dust on the Wind', credits: ['The Velvet Sundown'], channelIds: ['UCvs'], featured: false }]) || J(items);
});
t('paths', () => {
  const doc = makeDocument(card('A', 'Album • B'));
  const n = p => ytm.readPageItems(doc, p).length;
  return J([n('/'), n('/explore'), n('/search'), n('/search?q=a'), n('/browse/x'), n('/library'), n('/explorer'), n('/watch')]) === J([1, 1, 1, 1, 0, 0, 0, 0]) || 'wrong paths';
});
t('player page and queue skipped', () => {
  const doc = makeDocument(card('Keep', 'Album • A'),
    el('ytmusic-player-page', {}, card('Up next', 'Album • A')),
    el('div', { id: 'queue' }, searchRow('Q', 'Song • A')));
  const items = ytm.readPageItems(doc, '/');
  return (items.length === 1 && items[0].title === 'Keep' && items[0].el.localName === 'ytmusic-two-row-item-renderer') || J(plain(items));
});
t('hidden items still returned', () => {
  const c = card('A', 'Album • B'); c.hidden = true;
  return ytm.readPageItems(makeDocument(c), '/').length === 1 || 'dropped';
});
t('hide and unhide', () => {
  const mine = card('A', 'Album • B'), theirs = card('C', 'Album • D');
  theirs.hidden = true;
  const doc = makeDocument(mine, theirs);
  ytm.hideItem(mine);
  const hid = mine.hidden === true && mine.hasAttribute('data-hm-hidden');
  ytm.unhideAll(doc);
  return (hid && mine.hidden === false && !mine.hasAttribute('data-hm-hidden') && theirs.hidden === true) || J({ hid, mine: mine.hidden, theirs: theirs.hidden });
});
t('empty item never throws', () => {
  const items = plain(ytm.readPageItems(makeDocument(el('ytmusic-two-row-item-renderer')), '/'));
  return J(items) === J([{ title: '', credits: [], channelIds: [], featured: false }]) || J(items);
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
