// Contract check (investigator plan, Task 4 leftovers): the YouTube Music player gives the
// artists' channel IDs, and both players give the playing song's cover address. A guess about
// the page that misses gives nothing (no ID, no cover), never a wrong one: IDs come only from
// channel/UC… links in the artist line, covers only from known image hosts.
// Run from the repo root: node tests/contract-player-art.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { ytm, spotify } = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'], { setTimeout, clearTimeout }).HM;
const fails = [];
const J = v => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const CH1 = 'UCIE9zgCYFKd-GLQX5jwhceA', CH2 = 'UCfEyz1qa5934AyDOxYGEmBA';

const ytmNew = (byline, img) => makeDocument(el('ytmusic-miniplayer', {}, img || el('span', {}),
  el('div', { class: 'ytmusicTrackInfoTitle' }, 'Song'), el('div', { class: 'ytmusicTrackInfoByline' }, ...byline)));
const ytmOld = (byline, img) => makeDocument(el('ytmusic-player-bar', {}, img || el('span', {}),
  el('div', { class: 'title' }, 'Song'), el('div', { class: 'byline' }, ...byline)));

t('YTM (new player): channel IDs from the artist links, each once', () => {
  const doc = ytmNew([el('a', { href: 'channel/' + CH1 }, 'A'), ' & ', el('a', { href: 'https://music.youtube.com/channel/' + CH2 }, 'B'), ' • ', el('a', { href: 'browse/MPREb_x' }, 'Album'), el('a', { href: 'channel/' + CH1 }, 'A')]);
  const s = ytm.readSong(doc);
  return J(s.channelIds) === J([CH1, CH2]) || J(s);
});
t('YTM (old player bar): channel IDs from the byline links', () => {
  const s = ytm.readSong(ytmOld([el('a', { href: 'channel/' + CH1 }, 'A'), ' • Album']));
  return J(s.channelIds) === J([CH1]) || J(s);
});
t('YTM: no channel links, or a malformed ID, gives no IDs', () => {
  const a = ytm.readSong(ytmNew([el('a', { href: 'browse/MPREb' }, 'A'), ' • X']));
  const b = ytm.readSong(ytmNew([el('a', { href: 'channel/UCshort' }, 'A')]));
  return (J(a.channelIds) === '[]' && J(b.channelIds) === '[]') || J({ a, b });
});
t('YTM: the cover comes from the player image on a Google image host', () => {
  const ok = ytm.readArt(ytmNew(['A'], el('img', { src: 'https://lh3.googleusercontent.com/abc=w544-h544' })));
  const yt = ytm.readArt(ytmOld(['A'], el('img', { src: 'https://i.ytimg.com/vi/x/hqdefault.jpg' })));
  return (ok === 'https://lh3.googleusercontent.com/abc=w544-h544' && yt === 'https://i.ytimg.com/vi/x/hqdefault.jpg') || J({ ok, yt });
});
t('YTM: an image on another host, http, or none gives no cover', () => {
  const a = ytm.readArt(ytmNew(['A'], el('img', { src: 'https://evil.test/x.jpg' })));
  const b = ytm.readArt(ytmNew(['A'], el('img', { src: 'http://lh3.googleusercontent.com/x' })));
  const c = ytm.readArt(ytmNew(['A']));
  const d = ytm.readArt(makeDocument(el('div', {})));
  return (a === '' && b === '' && c === '' && d === '') || J({ a, b, c, d });
});
const spot = img => makeDocument(el('div', { 'data-testid': 'now-playing-widget' }, img || el('span', {}), el('a', { 'data-testid': 'context-item-link' }, 'Song')));
t('Spotify: the cover comes from the now-playing image on a Spotify image host', () => {
  const ok = spotify.readArt(spot(el('img', { src: 'https://i.scdn.co/image/ab67616d00004851abc' })));
  const bad = spotify.readArt(spot(el('img', { src: 'https://evil.test/i.scdn.co/x' })));
  const none = spotify.readArt(makeDocument(el('div', {})));
  return (ok === 'https://i.scdn.co/image/ab67616d00004851abc' && bad === '' && none === '') || J({ ok, bad, none });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
