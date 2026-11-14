// Contract check for the Spotify page adapter (HM.spotify), against page facts checked live
// on open.spotify.com (spec, "Spotify page facts"). Run from the repo root:
//   node tests/contract-spotify.check.mjs   (tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { spotify } = load(['src/core/text.js', 'src/page/common.js', 'src/page/spotify.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.message}`); } };
const REMOVE = 'M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583M2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z';
const OTHER = 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8';
const A1 = '60df5JBRRPcnSpsIMxxwQm', A2 = '5ExXpwxyFXhwPKYKx6ItaN';

function bar({ title = 'Dust on the Wind', artists = [['The Velvet Sundown', A2]], clicks = {}, video = { paused: false, currentTime: 12 } } = {}) {
  const count = n => () => { clicks[n] = (clicks[n] || 0) + 1; };
  const next = el('button', { 'data-testid': 'control-button-skip-forward', 'aria-label': 'Next' }); next.addEventListener('click', count('next'));
  const repeat = el('button', { 'data-testid': 'control-button-repeat', class: 'e-legacy-button e-tertiary', 'aria-label': 'Enable repeat', 'aria-checked': 'false' },
    el('span', { class: 'icon' }, el('svg', { viewBox: '0 0 16 16' }, el('path', { d: 'M0 0h16v16H0Z' }))));
  const byline = el('div', { 'data-testid': 'now-playing-widget-v2-byline' }, ...artists.flatMap(([n, id], i) => [i ? ', ' : null, el('a', { href: `/artist/${id}?si=x` }, n)].filter(Boolean)));
  return el('aside', { 'data-testid': 'now-playing-bar' },
    el('div', { 'data-testid': 'now-playing-widget-v2' }, el('a', { 'data-testid': 'context-item-link', href: '/album/abcdefghijklmnopqrstuv' }, ` ${title} `), byline),
    el('div', { 'data-testid': 'player-controls' }, el('div', { class: 'left' }, el('button', { 'data-testid': 'control-button-playpause', 'aria-label': 'Pause' })),
      el('div', { class: 'right' }, next, repeat)),
    el('div', {}, el('div', { 'data-testid': 'playback-position' }, '0:12'), el('div', { 'data-testid': 'playback-progressbar' }, el('input', { type: 'range', min: '0', max: '163000', props: { value: '12000' } })),
      el('div', { 'data-testid': 'playback-duration' }, '2:43')),
    el('video', { props: video }));
}

function queuePanel(doc, songs, clicks, { menuItems = [OTHER, REMOVE, OTHER] } = {}) {
  const menuHost = el('div');
  const rows = songs.map(([title, artist, id]) => {
    const more = el('button', { 'data-testid': 'more-button', 'aria-label': `More options for ${title}` });
    const row = el('li', { role: 'row' }, el('div', { 'data-encore-id': 'listRow' },
      el('a', { href: `/track/${'t'.repeat(22)}` }, el('span', { 'data-encore-id': 'listRowTitle' }, title)), el('a', { href: `/artist/${id}` }, artist), more));
    more.addEventListener('click', () => {
      menuHost.textContent = '';
      const menu = el('div', { id: 'context-menu', 'data-testid': 'context-menu' });
      for (const d of menuItems) {
        const item = el('button', { role: 'menuitem' }, el('svg', {}, el('path', { d })), 'item');
        item.addEventListener('click', () => { clicks.items = [...(clicks.items || []), d === REMOVE ? 'remove' : 'other']; menuHost.textContent = ''; if (d === REMOVE) setTimeout(() => row.remove(), 30); });
        menu.append(item);
      }
      menuHost.append(menu);
    });
    return row;
  });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') { clicks.escape = (clicks.escape || 0) + 1; menuHost.textContent = ''; } });
  doc.body.append(el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid', 'aria-label': 'Next up' }, ...rows)), menuHost);
}

await t('readSong: title, artists joined, Spotify artist IDs', () => {
  const s = spotify.readSong(makeDocument(bar({ artists: [['The Velvet Sundown', A2], ['Otis Redding', A1]] })));
  return J(s) === J({ title: 'Dust on the Wind', artistLine: 'The Velvet Sundown, Otis Redding', channelIds: [A2, A1] }) || J(s);
});
await t('readSong: nothing playing -> null', () => spotify.readSong(makeDocument(el('div'))) === null || 'not null');
await t('clickNext and pressNextKey both press the Next button', () => {
  const clicks = {}; const doc = makeDocument(bar({ clicks }));
  const r = spotify.clickNext(doc); spotify.pressNextKey(doc);
  return (r === true && clicks.next === 2) || J({ r, clicks });
});
await t('no dislike on Spotify', () => spotify.clickDislike(makeDocument(bar())) === false || 'not false');
await t('duration from the time text; seek through the progress bar', () => {
  const doc = makeDocument(bar());
  const d = spotify.videoDuration(doc);
  const input = doc.querySelector('[data-testid="playback-progressbar"] input');
  let changed = 0; input.addEventListener('change', () => changed++);
  spotify.seekTo(doc, d);
  return (d === 163 && input.value === '163000' && changed === 1) || J({ d, value: input.value, changed });
});
await t('videoState from the media element', () => J(spotify.videoState(makeDocument(bar({ video: { paused: false, currentTime: 12 } })))) === J({ time: 12, paused: false }) || 'wrong');
await t('readQueue: playing song first (selected), then the queue panel rows', () => {
  const doc = makeDocument(bar({ title: 'Now Song', artists: [['Otis Redding', A1]] }));
  queuePanel(doc, [['B', 'The Velvet Sundown', A2], ['C', 'Someone', A1]], {});
  const q = spotify.readQueue(doc);
  return (J(q.map(r => [r.title, r.artistLine, r.selected, r.channelIds])) === J([['Now Song', 'Otis Redding', true, [A1]], ['B', 'The Velvet Sundown', false, [A2]], ['C', 'Someone', false, [A1]]]) && q.slice(1).every(r => r.el && r.el.localName === 'li')) || J(q.map(r => [r.title, r.selected]));
});
await t('readQueue: no queue panel -> []', () => J(spotify.readQueue(makeDocument(bar()))) === '[]' || 'not empty');
await t('removeQueueRow removes exactly that row', async () => {
  const clicks = {}; const doc = makeDocument(bar());
  queuePanel(doc, [['B', 'X', A2], ['C', 'Y', A1], ['D', 'Z', A1]], clicks);
  const r = await spotify.removeQueueRow(doc, spotify.readQueue(doc)[2]);
  return (r === true && J(spotify.readQueue(doc).slice(1).map(x => x.title)) === J(['B', 'D']) && J(clicks.items) === J(['remove'])) || J({ r, clicks });
});
await t('removeQueueRow with no remove item: Escape, nothing clicked, false', async () => {
  const clicks = {}; const doc = makeDocument(bar());
  queuePanel(doc, [['B', 'X', A2]], clicks, { menuItems: [OTHER, OTHER] });
  const r = await spotify.removeQueueRow(doc, spotify.readQueue(doc)[1]);
  return (r === false && !clicks.items && clicks.escape === 1) || J({ r, clicks });
});
await t('removeQueueRow puts focus back', async () => {
  const clicks = {}; const doc = makeDocument(bar());
  queuePanel(doc, [['B', 'X', A2], ['C', 'Y', A1]], clicks);
  const search = el('input'); doc.body.append(search); search.focus();
  doc.addEventListener('click', e => { if (e.target.getAttribute && e.target.getAttribute('data-testid') === 'more-button') setTimeout(() => { const i = doc.querySelector('#context-menu button'); if (i) i.focus(); }, 5); }, true);
  const r = await spotify.removeQueueRow(doc, spotify.readQueue(doc)[1]);
  return (r === true && doc.activeElement === search) || J({ r, active: doc.activeElement.localName });
});
await t('one Block artist button right of Repeat, a copy of it, mounted once', () => {
  const doc = makeDocument(bar()); let hits = 0;
  const a = spotify.mountPlayerButtons(doc, { onBlockArtist: () => hits++ });
  const b = spotify.mountPlayerButtons(doc, { onBlockArtist: () => hits++ });
  const boxes = doc.querySelectorAll('#hm-player-buttons');
  const btns = boxes[0] ? boxes[0].querySelectorAll('button') : [];
  const repeat = doc.querySelector('[data-testid="control-button-repeat"]');
  if (!(a && b && boxes.length === 1 && btns.length === 1)) return J({ a, b, boxes: boxes.length, btns: btns.length });
  btns[0].click();
  return (btns[0].getAttribute('aria-label') === 'Block artist' && btns[0].className === repeat.className && !btns[0].hasAttribute('aria-checked')
    && !btns[0].hasAttribute('data-testid') && boxes[0].previousElementSibling === repeat && btns[0].querySelectorAll('svg path').length === 2 && hits === 1)
    || J({ cls: btns[0].className, prev: boxes[0].previousElementSibling && boxes[0].previousElementSibling.getAttribute('data-testid'), hits });
});
await t('no player: safe everywhere', async () => {
  const doc = makeDocument(el('div'));
  return (spotify.readSong(doc) === null && spotify.clickNext(doc) === false && Number.isNaN(spotify.videoDuration(doc)) && spotify.mountPlayerButtons(doc, {}) === false
    && (spotify.pressNextKey(doc), spotify.seekTo(doc, 3), true) && (await spotify.removeQueueRow(doc, { el: el('li') })) === false) || 'unsafe';
});

const card = (title, href, extra = []) => el('div', { 'data-encore-id': 'card' }, el('a', { href }, el('span', { 'data-encore-id': 'cardTitle' }, title)), el('div', { 'data-encore-id': 'cardSubtitle' }, ...extra));
await t('page items: artist links give credits and IDs; artist cards credit their title', () => {
  const doc = makeDocument(el('main', {},
    el('div', { role: 'grid', 'aria-label': 'Search results' },
      el('div', { 'data-encore-id': 'listRow' }, el('a', { href: '/track/xxxxxxxxxxxxxxxxxxxxxx' }, el('span', { 'data-encore-id': 'listRowTitle' }, 'Song One')), el('a', { href: `/artist/${A2}` }, 'The Velvet Sundown'), ', ', el('a', { href: `/artist/${A1}` }, 'Otis Redding'))),
    card('The Velvet Sundown', `/artist/${A2}`, ['Artist']),
    card('Indie Mix', '/playlist/pppppppppppppppppppppp', ['The latest from Future, Fall Out Boy and more'])),
    bar());
  const items = spotify.readPageItems(doc, '/search/velvet').map(i => [i.title, i.credits, i.channelIds, i.featured]);
  return J(items) === J([['Song One', ['The Velvet Sundown', 'Otis Redding'], [A2, A1], false], ['The Velvet Sundown', ['The Velvet Sundown'], [A2], false], ['Indie Mix', [], [], false]]) || J(items);
});
await t('page items only on home and search; never the player or queue', () => {
  const doc = makeDocument(el('main', {}, card('X', `/artist/${A2}`)), bar());
  queuePanel(doc, [['B', 'X', A2]], {});
  const n = p => spotify.readPageItems(doc, p).length;
  return J([n('/'), n('/search/x'), n('/album/y'), n('/playlist/z')]) === J([1, 1, 0, 0]) || J([n('/'), n('/search/x'), n('/album/y')]);
});
await t('hide and unhide', () => {
  const c = card('X', `/artist/${A2}`); const doc = makeDocument(el('main', {}, c));
  spotify.hideItem(c); const hid = c.hidden && c.hasAttribute('data-hm-hidden');
  spotify.unhideAll(doc);
  return (hid && !c.hidden && !c.hasAttribute('data-hm-hidden')) || 'not restored';
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
