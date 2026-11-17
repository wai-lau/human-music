// Contract check (review 2026-11-17, page side, finding 2): queue removal must never press
// "Remove from queue" in a menu that belongs to another row. With a menu already open (the
// person is about to pick "Play next" on a person's song), removal does nothing and returns
// false; a later pass tries again. Both sites draw the clicked row's menu a moment after the
// click, as the real pages do. Run from the repo root: node tests/contract-queue-menu.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const HM = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const REMOVE = 'M9 .75a8.25 8.25 0 100 16.5A8.25 8.25 0 009 .75Zm0 1.5a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5Zm3 6H6a.75.75 0 000 1.5h6a.75.75 0 100-1.5Z';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ytmPage() {
  const removed = [];
  const popup = el('ytmusic-menu-popup-renderer', {});
  const dropdown = el('tp-yt-iron-dropdown', {}, popup);
  const fill = (row, title) => {
    popup.textContent = '';
    const item = el('tp-yt-paper-item', { role: 'menuitem' }, el('svg', {}, el('path', { d: REMOVE })));
    item.addEventListener('click', () => { dropdown.style.display = 'none'; removed.push(title); setTimeout(() => row.remove(), 20); });
    popup.append(item); dropdown.style.display = '';
  };
  const rows = ['Now', 'Person Song', 'AI Song'].map((ti, i) => {
    const btn = el('button');
    const row = el('ytmusic-player-queue-item', { selected: i === 0 }, el('div', { class: 'song-title' }, ti), el('div', { class: 'byline' }, 'x'), el('ytmusic-menu-renderer', {}, btn));
    btn.addEventListener('click', () => setTimeout(() => fill(row, ti), 30));
    return row;
  });
  dropdown.style.display = 'none';
  const doc = makeDocument(el('div', { id: 'queue' }, ...rows), dropdown);
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.style.display = 'none'; });
  return { doc, rows, removed, fill };
}
function spotifyPage() {
  const removed = [];
  let menu = null;
  let doc;
  const openMenu = (row, title) => {
    if (menu) menu.remove();
    menu = el('div', { 'data-testid': 'context-menu' });
    const item = el('button', { role: 'menuitem' }, el('svg', {}, el('path', { d: HM.spotify.REMOVE_ICON })));
    item.addEventListener('click', () => { menu.remove(); menu = null; removed.push(title); setTimeout(() => row.remove(), 20); });
    menu.append(item); doc.body.append(menu);
  };
  const rows = ['Person Song', 'AI Song'].map((ti) => {
    const more = el('button', { 'data-testid': 'more-button' });
    const row = el('li', { role: 'row' }, el('div', { 'data-encore-id': 'listRowTitle' }, ti), el('a', { href: '/artist/AAAAAAAAAAAAAAAAAAAAAA' }, 'x'), more);
    more.addEventListener('click', () => setTimeout(() => openMenu(row, ti), 30));
    return row;
  });
  doc = makeDocument(el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }, ...rows)));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { menu.remove(); menu = null; } });
  return { doc, rows, removed, openMenu };
}

await t('YouTube Music: another row\'s menu already open: nothing removed, false', async () => {
  const p = ytmPage();
  p.fill(p.rows[1], 'Person Song');
  const r = await HM.ytm.removeQueueRow(p.doc, HM.ytm.readQueue(p.doc).find((x) => x.title === 'AI Song'));
  await wait(100);
  return (r === false && p.removed.length === 0) || J({ r, removed: p.removed });
});
await t('YouTube Music: with no menu open, the row is still removed', async () => {
  const p = ytmPage();
  const r = await HM.ytm.removeQueueRow(p.doc, HM.ytm.readQueue(p.doc).find((x) => x.title === 'AI Song'));
  await wait(100);
  return (r === true && J(p.removed) === J(['AI Song'])) || J({ r, removed: p.removed });
});
await t('Spotify: another row\'s menu already open: nothing removed, false', async () => {
  const p = spotifyPage();
  p.openMenu(p.rows[0], 'Person Song');
  const r = await HM.spotify.removeQueueRow(p.doc, HM.spotify.readQueue(p.doc).find((x) => x.title === 'AI Song'));
  await wait(100);
  return (r === false && p.removed.length === 0) || J({ r, removed: p.removed });
});
await t('Spotify: with no menu open, the row is still removed', async () => {
  const p = spotifyPage();
  const r = await HM.spotify.removeQueueRow(p.doc, HM.spotify.readQueue(p.doc).find((x) => x.title === 'AI Song'));
  await wait(100);
  return (r === true && J(p.removed) === J(['AI Song'])) || J({ r, removed: p.removed });
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
