// Contract check for Task 6a (page adapter: player and queue). Run from the repo root:
//   node tests/contract-ytm-player.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { ytm } = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const REMOVE = 'M9 .75a8.25 8.25 0 100 16.5A8.25 8.25 0 009 .75Zm0 1.5a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5Zm3 6H6a.75.75 0 000 1.5h6a.75.75 0 100-1.5Z';
const OTHER = 'M3 3h12v12H3Z';

function player(layout, { title = 'Dust on the Wind', pressed = false, clicks } = {}) {
  const count = name => () => { clicks[name] = (clicks[name] || 0) + 1; };
  if (layout === 'new') {
    const next = el('button', { 'aria-label': 'Next' }); next.addEventListener('click', count('next'));
    const dis = el('button', { 'aria-pressed': String(pressed) }); dis.addEventListener('click', count('dislike'));
    const control = (label, extra = {}) => el('div', { class: 'ytmusicPlayerControlsControlButton x9Hash' },
      el('button', { class: 'ytSpecButtonShapeNextHost ytSpecButtonShapeNextText', 'aria-label': label, title: label, ...extra },
        el('div', { class: 'ytSpecButtonShapeNextIcon' }, el('span', { class: 'ytIconWrapperHost' }, el('svg', { viewBox: '0 0 24 24' }, el('path', { d: 'M1 1h22v22H1Z' }))))));
    const nextWrap = el('div', { class: 'ytmusicPlayerControlsControlButton x9Hash' }, next);
    return el('ytmusic-miniplayer', {},
      el('div', { class: 'ytmusicTrackInfoTitle' }, ` ${title} `),
      el('div', { class: 'ytmusicTrackInfoByline' }, el('a', {}, 'The Velvet Sundown'), ' • Floating • 2025'),
      el('div', {}, el('like-button-view-model', {}, el('button', { 'aria-pressed': 'false' })), el('dislike-button-view-model', {}, dis)),
      el('ytmusic-wiz-player-controls', {}, el('div', { class: 'ytmusicPlayerControlsMainControls' },
        control('Shuffle'), control('Previous'), nextWrap, control('Repeat off', { 'aria-pressed': 'false' }))));
  }
  const next = el('tp-yt-paper-icon-button', { class: 'next-button' }); next.addEventListener('click', count('next'));
  const dis = el('tp-yt-paper-icon-button', { class: 'dislike', 'aria-pressed': String(pressed) }); dis.addEventListener('click', count('dislike'));
  return el('ytmusic-player-bar', {},
    el('div', { class: 'title' }, title),
    el('span', { class: 'byline' }, el('a', {}, 'The Velvet Sundown'), ' • Floating • 2025'),
    el('div', { class: 'middle-controls' }, dis, next));
}

function queue(doc, titles, sel, { menuItems = [OTHER, REMOVE, OTHER], removeAfter = 100, clicks, noButtons = false } = {}) {
  const popup = el('ytmusic-menu-popup-renderer', {});
  const dropdown = el('tp-yt-iron-dropdown', { style: { display: 'none' } }, popup);
  const rows = titles.map((t, i) => {
    const menuBtn = el('button', { 'aria-label': 'Action menu' });
    const row = el('ytmusic-player-queue-item', { selected: i === sel }, el('div', { class: 'song-title' }, t), el('span', { class: 'byline' }, `Artist ${t} • 3:00`),
      noButtons ? null : el('ytmusic-menu-renderer', {}, menuBtn));
    const open = () => {
      clicks.menu = (clicks.menu || 0) + 1;
      popup.textContent = '';
      for (const [k, d] of menuItems.entries()) {
        const item = el('tp-yt-paper-item', { role: 'menuitem' }, el('yt-icon', {}, el('svg', {}, el('path', { d }))), `item ${k}`);
        item.addEventListener('click', () => {
          clicks.items = [...(clicks.items || []), d === REMOVE ? 'remove' : 'other'];
          dropdown.style.display = 'none';
          if (d === REMOVE) setTimeout(() => (row.closest('ytmusic-playlist-panel-video-wrapper-renderer') || row).remove(), removeAfter);
        });
        popup.append(item);
      }
      dropdown.style.display = '';
    };
    menuBtn.addEventListener('click', open);
    row.addEventListener('contextmenu', e => { clicks.contextmenu = (clicks.contextmenu || 0) + 1; e.preventDefault(); open(); });
    const twin = el('ytmusic-player-queue-item', {}, el('div', { class: 'song-title' }, `${t} (video)`), el('span', { class: 'byline' }, 'x'));
    return i % 2 === 0
      ? el('ytmusic-playlist-panel-video-wrapper-renderer', {}, el('div', { id: 'primary-renderer' }, row), el('div', { id: 'counterpart-renderer' }, twin))
      : row;
  });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') { clicks.escape = (clicks.escape || 0) + 1; dropdown.style.display = 'none'; } });
  doc.body.append(el('div', { id: 'queue' }, el('div', { id: 'contents' }, ...rows)), dropdown);
}

for (const layout of ['new', 'old']) {
  await t(`${layout}: readSong`, () => {
    const doc = makeDocument(player(layout, { clicks: {} }));
    const s = ytm.readSong(doc);
    return J(s) === J({ title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating • 2025', channelIds: [] }) || J(s);
  });
  await t(`${layout}: clickNext inside the player only`, () => {
    const clicks = {}; let carousel = 0;
    const arrow = el('button', { 'aria-label': 'Next', class: 'next-button' }); arrow.addEventListener('click', () => carousel++);
    const doc = makeDocument(el('ytmusic-carousel', {}, arrow), player(layout, { clicks }));
    const r = ytm.clickNext(doc);
    return (r === true && clicks.next === 1 && carousel === 0) || J({ r, clicks, carousel });
  });
  await t(`${layout}: clickDislike`, () => {
    const clicks = {}; const doc = makeDocument(player(layout, { clicks }));
    const r = ytm.clickDislike(doc);
    return (r === true && clicks.dislike === 1) || J({ r, clicks });
  });
  await t(`${layout}: clickDislike already pressed`, () => {
    const clicks = {}; const doc = makeDocument(player(layout, { pressed: true, clicks }));
    const r = ytm.clickDislike(doc);
    return (r === true && !clicks.dislike) || J({ r, clicks });
  });
  await t(`${layout}: one Block artist button, mounted once`, () => {
    const doc = makeDocument(player(layout, { clicks: {} })); const hits = [];
    const h = { onBlockArtist: () => hits.push('artist') };
    const a = ytm.mountPlayerButtons(doc, h), b = ytm.mountPlayerButtons(doc, h);
    const boxes = doc.querySelectorAll('#hm-player-buttons');
    const btns = boxes[0] ? boxes[0].querySelectorAll('button') : [];
    if (!(a === true && b === true && boxes.length === 1 && btns.length === 1)) return J({ a, b, boxes: boxes.length, btns: btns.length });
    const btn = btns[0];
    btn.click();
    return (btn.getAttribute('aria-label') === 'Block artist' && btn.getAttribute('title') === 'Block artist' && !btn.textContent.trim()
      && btn.querySelectorAll('svg path').length === 2 && hits.join() === 'artist' && !!boxes[0].closest('ytmusic-miniplayer, ytmusic-player-bar'))
      || J({ label: btn.getAttribute('aria-label'), text: btn.textContent, paths: btn.querySelectorAll('svg path').length, hits });
  });
}

await t('new layout: the button sits right of Repeat and looks like it', () => {
  const doc = makeDocument(player('new', { clicks: {} }));
  ytm.mountPlayerButtons(doc, { onBlockArtist() {} });
  const row = doc.querySelector('.ytmusicPlayerControlsMainControls');
  const kids = row.children;
  const box = doc.querySelector('#hm-player-buttons');
  const repeatWrap = kids[kids.length - 2];
  const repeatBtn = repeatWrap.querySelector('button');
  const btn = box.querySelector('button');
  return (kids[kids.length - 1] === box && repeatBtn.getAttribute('aria-label') === 'Repeat off'
    && box.className === repeatWrap.className && btn.className === repeatBtn.className
    && !btn.hasAttribute('aria-pressed') && box.querySelector('.ytSpecButtonShapeNextIcon svg') !== null
    && repeatBtn.querySelector('svg path').getAttribute('d') === 'M1 1h22v22H1Z')
    || J({ last: kids[kids.length - 1].id, boxClass: box.className, btnClass: btn.className });
});
await t('no player: everything safe', () => {
  const doc = makeDocument(el('div'));
  const a = ytm.pageAdapter(doc);
  return (ytm.readSong(doc) === null && ytm.clickNext(doc) === false && ytm.clickDislike(doc) === false && Number.isNaN(ytm.videoDuration(doc))
    && ytm.mountPlayerButtons(doc, { onBlockArtist() {}, onBlockSong() {} }) === false && J(ytm.readQueue(doc)) === '[]'
    && (ytm.seekTo(doc, 5), a.seekTo(5), true) && a.readSong() === null) || 'unsafe';
});
await t('empty title -> null', () => ytm.readSong(makeDocument(player('new', { title: '  ', clicks: {} }))) === null || 'not null');
await t('pressNextKey: one j keydown on body', () => {
  const doc = makeDocument(player('new', { clicks: {} })); const seen = [];
  doc.addEventListener('keydown', e => seen.push([e.key, e.code, e.target === doc.body]));
  ytm.pressNextKey(doc);
  return J(seen) === J([['j', 'KeyJ', true]]) || J(seen);
});
await t('video duration and seek', () => {
  const v = el('video', { props: { duration: 200, currentTime: 3 } });
  const doc = makeDocument(player('new', { clicks: {} }), v);
  const a = ytm.pageAdapter(doc); a.seekTo(199);
  return (ytm.videoDuration(doc) === 200 && v.currentTime === 199 && a.videoDuration() === 200) || J({ d: ytm.videoDuration(doc), c: v.currentTime });
});
await t('pageAdapter shape', () => {
  const clicks = {}; const doc = makeDocument(player('old', { clicks }));
  const a = ytm.pageAdapter(doc);
  const keys = ['readSong', 'clickNext', 'pressNextKey', 'clickDislike', 'videoDuration', 'seekTo'];
  return (keys.every(k => typeof a[k] === 'function') && a.readSong().title === 'Dust on the Wind' && a.clickNext() === true && clicks.next === 1) || J(Object.keys(a));
});
await t('REMOVE_ICON', () => ytm.REMOVE_ICON === REMOVE || J(ytm.REMOVE_ICON));
await t('readQueue skips twins', () => {
  const doc = makeDocument(player('new', { clicks: {} })); queue(doc, ['A', 'B', 'C', 'D'], 1, { clicks: {} });
  const q = ytm.readQueue(doc);
  return (J(q.map(r => [r.title, r.artistLine, r.selected])) === J([['A', 'Artist A • 3:00', false], ['B', 'Artist B • 3:00', true], ['C', 'Artist C • 3:00', false], ['D', 'Artist D • 3:00', false]])
    && q.every(r => r.el && r.el.localName === 'ytmusic-player-queue-item')) || J(q.map(r => r.title));
});
await t('removeQueueRow removes one row', async () => {
  const clicks = {}; const doc = makeDocument(player('new', { clicks })); queue(doc, ['A', 'B', 'C', 'D'], 0, { clicks });
  const row = ytm.readQueue(doc)[2];
  const r = await ytm.removeQueueRow(doc, row);
  const left = ytm.readQueue(doc).map(x => x.title);
  return (r === true && J(left) === J(['A', 'B', 'D']) && J(clicks.items) === J(['remove'])) || J({ r, left, clicks });
});
await t('removeQueueRow ignores a stale hidden popup', async () => {
  const clicks = {}; const doc = makeDocument(player('new', { clicks })); queue(doc, ['A', 'B', 'C'], 0, { clicks });
  const stale = el('ytmusic-menu-popup-renderer', {}, el('tp-yt-paper-item', { role: 'menuitem' }, el('svg', {}, el('path', { d: REMOVE }))));
  stale.querySelector('tp-yt-paper-item').addEventListener('click', () => { clicks.stale = true; });
  doc.body.insertBefore(el('tp-yt-iron-dropdown', { style: { display: 'none' } }, stale), doc.body.firstElementChild);
  const r = await ytm.removeQueueRow(doc, ytm.readQueue(doc)[1]);
  return (r === true && !clicks.stale && J(ytm.readQueue(doc).map(x => x.title)) === J(['A', 'C'])) || J({ r, clicks });
});
await t('removeQueueRow with no remove item: Escape, nothing clicked, false', async () => {
  const clicks = {}; const doc = makeDocument(player('new', { clicks })); queue(doc, ['A', 'B'], 0, { clicks, menuItems: [OTHER, OTHER] });
  const t0 = Date.now();
  const r = await ytm.removeQueueRow(doc, ytm.readQueue(doc)[1]);
  return (r === false && !clicks.items && clicks.escape === 1 && ytm.readQueue(doc).length === 2 && Date.now() - t0 < 2000) || J({ r, clicks });
});
await t('removeQueueRow on a row with no menu button uses a right-click', async () => {
  const clicks = {}; const doc = makeDocument(player('new', { clicks })); queue(doc, ['A', 'B', 'C'], 0, { clicks, noButtons: true });
  const r = await ytm.removeQueueRow(doc, ytm.readQueue(doc)[2]);
  return (r === true && clicks.contextmenu === 1 && J(ytm.readQueue(doc).map(x => x.title)) === J(['A', 'B'])) || J({ r, clicks });
});
await t('removeQueueRow puts keyboard focus back', async () => {
  const clicks = {}; const doc = makeDocument(player('new', { clicks })); queue(doc, ['A', 'B', 'C'], 0, { clicks, noButtons: true });
  const search = el('input', { id: 'search' }); doc.body.append(search); search.focus();
  // the menu takes focus when it opens, as YouTube Music's does
  const steal = () => { const item = doc.querySelector('ytmusic-menu-popup-renderer [role=menuitem]'); if (item) item.focus(); };
  doc.addEventListener('contextmenu', () => setTimeout(steal, 10), true);
  const r = await ytm.removeQueueRow(doc, ytm.readQueue(doc)[1]);
  return (r === true && doc.activeElement === search) || J({ r, active: doc.activeElement.localName });
});
await t('removeQueueRow never rejects on a detached row', async () => {
  const doc = makeDocument(player('new', { clicks: {} }));
  const r = await ytm.removeQueueRow(doc, { title: 'x', artistLine: 'y', selected: false, el: el('ytmusic-player-queue-item') });
  return r === false || J(r);
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
