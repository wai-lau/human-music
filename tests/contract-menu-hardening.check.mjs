// Contract check (hardening): the menus we open and the keys we send.
//  - Escape goes only to the menu we opened, only while it is on screen; never when nothing opened.
//  - If the person is typing once our menu is open: close our menu, click nothing.
//  - YouTube Music "Remove from queue" is matched by icon, but "Remove from playlist" may share
//    it: two items with the icon, a playlist/library label, or a row outside the queue panel
//    mean nothing is clicked.
//  - Auto-dislike never dislikes a song the person has liked.
//  - A row marked by mistake keeps its own menu button clickable.
// Run from the repo root: node tests/contract-menu-hardening.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const HM = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const REMOVE = HM.ytm.REMOVE_ICON;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A YouTube Music page whose queue row opens a menu with the given items [{ text, icon }].
function ytmPage({ items, inQueue = true, opens = true }) {
  const clicked = [];
  const escapes = [];
  const popup = el('ytmusic-menu-popup-renderer', {});
  const dropdown = el('tp-yt-iron-dropdown', {}, popup);
  dropdown.style.display = 'none';
  const btn = el('button');
  const row = el('ytmusic-player-queue-item', {}, el('div', { class: 'song-title' }, 'AI Song'), el('div', { class: 'byline' }, 'x'), el('ytmusic-menu-renderer', {}, btn));
  btn.addEventListener('click', () => {
    if (!opens) return;
    setTimeout(() => {
      popup.textContent = '';
      for (const it of items) {
        const item = el('tp-yt-paper-item', { role: 'menuitem' }, el('svg', {}, el('path', { d: it.icon })), it.text);
        item.addEventListener('click', () => { clicked.push(it.text); setTimeout(() => row.remove(), 10); });
        popup.append(item);
      }
      dropdown.style.display = '';
    }, 20);
  });
  const host = inQueue ? el('div', { id: 'queue' }, row) : el('div', { id: 'other' }, row);
  const doc = makeDocument(host, dropdown);
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { escapes.push(e.target === doc ? 'doc' : 'menu'); dropdown.style.display = 'none'; } });
  const entry = { el: row, title: 'AI Song', artistLine: 'x' };
  return { doc, row, entry, clicked, escapes, dropdown };
}
const OTHER = 'M3 3h12v12H3Z';

await t('no menu opened: no Escape is sent at all', async () => {
  const p = ytmPage({ items: [], opens: false });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && p.escapes.length === 0) || J({ r, escapes: p.escapes });
});
await t('our menu opened but has no remove item: Escape goes to that menu only', async () => {
  const p = ytmPage({ items: [{ text: 'Play next', icon: OTHER }] });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && J(p.escapes) === '["menu"]' && p.dropdown.style.display === 'none') || J({ r, escapes: p.escapes });
});
await t('Escape helper: a menu that is not on screen gets no key', () => {
  const doc = makeDocument(el('div'));
  const seen = [];
  doc.addEventListener('keydown', (e) => seen.push(e.key));
  const gone = el('div');
  const sent = [HM.pageCommon.dispatchEscape(doc, null), HM.pageCommon.dispatchEscape(doc, gone), HM.pageCommon.dispatchEscape(doc)];
  return (J(sent) === '[false,false,false]' && seen.length === 0) || J({ sent, seen });
});
await t('person typing once the menu is open: our menu closed, nothing clicked', async () => {
  const p = ytmPage({ items: [{ text: 'Remove from queue', icon: REMOVE }] });
  let typing = false;
  p.row.querySelector('button').addEventListener('click', () => setTimeout(() => { typing = true; }, 5));
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry, { typing: () => typing });
  return (r === false && p.clicked.length === 0 && J(p.escapes) === '["menu"]') || J({ r, clicked: p.clicked, escapes: p.escapes });
});
await t('two items share the icon: nothing is clicked', async () => {
  const p = ytmPage({ items: [{ text: 'Remove from playlist', icon: REMOVE }, { text: 'Remove from queue', icon: REMOVE }] });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && p.clicked.length === 0 && J(p.escapes) === '["menu"]') || J({ r, clicked: p.clicked, escapes: p.escapes });
});
await t('the one icon item is labelled as a playlist action: nothing is clicked', async () => {
  const p = ytmPage({ items: [{ text: 'Remove from playlist', icon: REMOVE }] });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && p.clicked.length === 0) || J({ r, clicked: p.clicked });
});
await t('a library label in another language: nothing is clicked', async () => {
  const p = ytmPage({ items: [{ text: 'Aus Mediathek entfernen', icon: REMOVE }, { text: 'Zur Wiedergabeliste hinzufügen', icon: OTHER }] });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && p.clicked.length === 0) || J({ r, clicked: p.clicked });
});
await t('a row outside the queue panel: nothing is clicked', async () => {
  const p = ytmPage({ items: [{ text: 'Remove from queue', icon: REMOVE }], inQueue: false });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === false && p.clicked.length === 0) || J({ r, clicked: p.clicked });
});
await t('one icon item labelled Remove from queue, in the queue: still removed', async () => {
  const p = ytmPage({ items: [{ text: 'Start radio', icon: OTHER }, { text: 'Remove from queue', icon: REMOVE }] });
  const r = await HM.ytm.removeQueueRow(p.doc, p.entry);
  return (r === true && J(p.clicked) === '["Remove from queue"]') || J({ r, clicked: p.clicked });
});

// Spotify: Escape only for the menu we opened; typing closes it without a click.
function spotifyPage({ opens = true }) {
  const clicked = [];
  const escapes = [];
  let menu = null;
  let doc;
  const more = el('button', { 'data-testid': 'more-button' });
  const row = el('li', { role: 'row' }, el('div', { 'data-encore-id': 'listRowTitle' }, 'AI Song'), el('a', { href: '/artist/AAAAAAAAAAAAAAAAAAAAAA' }, 'x'), more);
  more.addEventListener('click', () => {
    if (!opens) return;
    setTimeout(() => {
      menu = el('div', { 'data-testid': 'context-menu' });
      const item = el('button', { role: 'menuitem' }, el('svg', {}, el('path', { d: HM.spotify.REMOVE_ICON })));
      item.addEventListener('click', () => { clicked.push('remove'); menu.remove(); menu = null; setTimeout(() => row.remove(), 10); });
      menu.append(item); doc.body.append(menu);
    }, 20);
  });
  doc = makeDocument(el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }, row)));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') { escapes.push(e.target === doc ? 'doc' : 'menu'); if (menu) { menu.remove(); menu = null; } } });
  return { doc, entry: HM.spotify.readQueue(doc)[0], clicked, escapes };
}
await t('Spotify: no menu opened: no Escape is sent', async () => {
  const p = spotifyPage({ opens: false });
  const r = await HM.spotify.removeQueueRow(p.doc, p.entry);
  return (r === false && p.escapes.length === 0) || J({ r, escapes: p.escapes });
});
await t('Spotify: typing once the menu is open: closed, nothing clicked', async () => {
  const p = spotifyPage({ opens: true });
  const r = await HM.spotify.removeQueueRow(p.doc, p.entry, { typing: () => true });
  return (r === false && p.clicked.length === 0 && J(p.escapes) === '["menu"]') || J({ r, clicked: p.clicked, escapes: p.escapes });
});

// Auto-dislike: a liked song is only skipped.
function player(layout, { liked, clicks }) {
  const count = (name) => () => { clicks[name] = (clicks[name] || 0) + 1; };
  const like = layout === 'new' ? el('button', { 'aria-pressed': String(liked) }) : el('tp-yt-paper-icon-button', { class: 'like', 'aria-pressed': String(liked) });
  const dis = layout === 'new' ? el('button', { 'aria-pressed': 'false' }) : el('tp-yt-paper-icon-button', { class: 'dislike', 'aria-pressed': 'false' });
  dis.addEventListener('click', count('dislike'));
  if (layout === 'new') {
    return el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'Song'),
      el('div', {}, el('like-button-view-model', {}, like), el('dislike-button-view-model', {}, dis)));
  }
  return el('ytmusic-player-bar', {}, el('div', { class: 'title' }, 'Song'), el('div', { class: 'middle-controls' }, like, dis));
}
for (const layout of ['new', 'old']) {
  await t(`${layout}: a liked song is not disliked (false, so the skipper only presses Next)`, () => {
    const clicks = {};
    const r = HM.ytm.clickDislike(makeDocument(player(layout, { liked: true, clicks })));
    return (r === false && !clicks.dislike) || J({ r, clicks });
  });
  await t(`${layout}: a song that is not liked is still disliked`, () => {
    const clicks = {};
    const r = HM.ytm.clickDislike(makeDocument(player(layout, { liked: false, clicks })));
    return (r === true && clicks.dislike === 1) || J({ r, clicks });
  });
}

// Marked rows: pointer-events off on the row, but its menu button stays clickable.
await t('a marked row keeps its menu button clickable and unmarking restores it', () => {
  const btn = el('button');
  const menu = el('ytmusic-menu-renderer', {}, btn);
  const row = el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'left-items' }), menu);
  const doc = makeDocument(row);
  HM.ytm.markRow(row, doc);
  const rowOff = row.style.getPropertyValue ? row.style.getPropertyValue('pointer-events') : row.style['pointer-events'];
  const get = (e) => (e.style.getPropertyValue ? e.style.getPropertyValue('pointer-events') : e.style['pointer-events']);
  const marked = [get(row), get(menu), get(btn)];
  HM.ytm.unmarkRow(row);
  const after = [get(row), get(menu), get(btn)];
  void rowOff;
  return (J(marked) === '["none","auto","auto"]' && after.every((v) => !v)) || J({ marked, after });
});

await wait(10);
console.log(fails.length ? fails.map((f) => 'FAIL ' + f).join('\n') : 'menu hardening ok');
process.exit(fails.length ? 1 : 0);
