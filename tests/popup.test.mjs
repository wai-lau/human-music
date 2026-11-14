import { load, run } from './load.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EXT = join(TEST_DIR, '..', 'extension');

function popupHtml() {
  return readFileSync(join(EXT, 'popup/popup.html'), 'utf8');
}

const ctx = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js'], { URL: URL });
const HM = ctx.HM;

function emptyUser() {
  return { artists: [], songs: [], keywords: [], neverSkip: [] };
}

run([
  // addEntry
  ['addEntry adds a new artist', () => {
    const u = emptyUser();
    const result = HM.popup.addEntry(u, 'artists', 'Beyoncé');
    return result.artists.length === 1 && result.artists[0] === 'Beyoncé';
  }],
  ['addEntry trims whitespace', () => {
    const u = emptyUser();
    const result = HM.popup.addEntry(u, 'artists', '  Beyoncé  ');
    return result.artists.length === 1 && result.artists[0] === 'Beyoncé';
  }],
  ['addEntry ignores empty value', () => {
    const u = emptyUser();
    const result = HM.popup.addEntry(u, 'artists', '   ');
    return result.artists.length === 0;
  }],
  ['addEntry ignores duplicate by normalize (case)', () => {
    const u = { artists: ['Beyoncé'], songs: [], keywords: [], neverSkip: [] };
    const result = HM.popup.addEntry(u, 'artists', 'BEYONCÉ');
    return result.artists.length === 1;
  }],
  ['addEntry ignores duplicate by normalize (whitespace)', () => {
    const u = { artists: ['Earth, Wind & Fire'], songs: [], keywords: [], neverSkip: [] };
    const result = HM.popup.addEntry(u, 'artists', 'Earth,  Wind & Fire');
    return result.artists.length === 1;
  }],
  ['addEntry returns unchanged copy for duplicate', () => {
    const u = { artists: ['Beyoncé'], songs: [], keywords: [], neverSkip: [] };
    const result = HM.popup.addEntry(u, 'artists', 'BEYONCÉ');
    return result === u || (result.artists.length === 1 && result.artists[0] === 'Beyoncé');
  }],
  ['addEntry works for keywords', () => {
    const u = emptyUser();
    const result = HM.popup.addEntry(u, 'keywords', 'remix');
    return result.keywords.length === 1 && result.keywords[0] === 'remix';
  }],
  ['addEntry works for neverSkip', () => {
    const u = emptyUser();
    const result = HM.popup.addEntry(u, 'neverSkip', 'The Velvet Sundown');
    return result.neverSkip.length === 1 && result.neverSkip[0] === 'The Velvet Sundown';
  }],
  // addSong
  ['addSong adds a new song', () => {
    const u = emptyUser();
    const result = HM.popup.addSong(u, 'Love', 'Some Band');
    return result.songs.length === 1 && result.songs[0].title === 'Love' && result.songs[0].artist === 'Some Band';
  }],
  ['addSong trims title and artist', () => {
    const u = emptyUser();
    const result = HM.popup.addSong(u, '  Love  ', '  Some Band  ');
    return result.songs.length === 1 && result.songs[0].title === 'Love' && result.songs[0].artist === 'Some Band';
  }],
  ['addSong handles null artist', () => {
    const u = emptyUser();
    const result = HM.popup.addSong(u, 'Love', null);
    return result.songs.length === 1 && result.songs[0].title === 'Love' && result.songs[0].artist === null;
  }],
  ['addSong ignores empty title', () => {
    const u = emptyUser();
    const result = HM.popup.addSong(u, '   ', 'Band');
    return result.songs.length === 0;
  }],
  ['addSong with a blank artist keeps the song, artist null', () => {
    const u = emptyUser();
    const result = HM.popup.addSong(u, 'Love', '   ');
    return result.songs.length === 1 && result.songs[0].artist === null;
  }],
  ['addSong ignores duplicate by normalized title and artist', () => {
    const u = { artists: [], songs: [{ title: 'Love', artist: 'Some Band' }], keywords: [], neverSkip: [] };
    const result = HM.popup.addSong(u, 'love', 'SOME BAND');
    return result.songs.length === 1;
  }],
  // removeEntry
  ['removeEntry removes by index', () => {
    const u = { artists: ['A', 'B', 'C'], songs: [], keywords: [], neverSkip: [] };
    const result = HM.popup.removeEntry(u, 'artists', 1);
    return result.artists.length === 2 && result.artists[0] === 'A' && result.artists[1] === 'C';
  }],
  ['removeEntry works for songs', () => {
    const u = { artists: [], songs: [{ title: 'Love', artist: 'Band' }], keywords: [], neverSkip: [] };
    const result = HM.popup.removeEntry(u, 'songs', 0);
    return result.songs.length === 0;
  }],
  ['removeEntry out of range changes nothing', () => {
    const u = { artists: ['A'], songs: [], keywords: [], neverSkip: [] };
    const result = HM.popup.removeEntry(u, 'artists', 5);
    return result.artists.length === 1;
  }],
  // addFilterList
  ['addFilterList rejects http URL', () => {
    try {
      HM.popup.addFilterList([], 'http://example.com/list.json', 'Test');
      return false;
    } catch (e) {
      return e.message === 'Use an https:// address';
    }
  }],
  ['addFilterList rejects non-https scheme', () => {
    try {
      HM.popup.addFilterList([], 'ftp://example.com/list.json', 'Test');
      return false;
    } catch (e) {
      return e.message === 'Use an https:// address';
    }
  }],
  ['addFilterList rejects duplicate URL', () => {
    try {
      const lists = HM.popup.addFilterList([], 'https://example.com/list.json', 'Test');
      HM.popup.addFilterList(lists, 'https://example.com/list.json', 'Same URL');
      return false;
    } catch (e) {
      return e.message === 'That list is already added';
    }
  }],
  ['addFilterList makes id from name', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/list.json', 'My Custom List');
    return lists.length === 1 && lists[0].id === 'my-custom-list';
  }],
  ['addFilterList makes unique id when taken', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/a.json', 'My List');
    const lists2 = HM.popup.addFilterList(lists, 'https://example.com/b.json', 'My List');
    return lists2.length === 2 && lists2[0].id === 'my-list' && lists2[1].id === 'my-list-2';
  }],
  ['addFilterList empty name uses hostname', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/list.json', '   ');
    return lists[0].name === 'example.com';
  }],
  ['addFilterList new list has correct defaults', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/list.json', 'Test');
    const list = lists[0];
    return list.enabled === true && list.mode === 'watch' && list.builtIn === false && // Watch only first (Wai, 2026-11-13)
      list.lastRefresh === null && list.count === 0 && list.lastError === null;
  }],
  // removeFilterList
  ['removeFilterList removes user list', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/list.json', 'Test');
    const result = HM.popup.removeFilterList(lists, lists[0].id);
    return result.length === 0;
  }],
  ['removeFilterList throws for built-in list', () => {
    const lists = [{ id: 'soul-over-ai', name: 'Soul Over AI', builtIn: true }];
    try {
      HM.popup.removeFilterList(lists, 'soul-over-ai');
      return false;
    } catch (e) {
      return e.message === 'Built-in lists can be switched off but not removed';
    }
  }],
  ['removeFilterList unknown id returns copy', () => {
    const lists = HM.popup.addFilterList([], 'https://example.com/list.json', 'Test');
    const result = HM.popup.removeFilterList(lists, 'nonexistent');
    return result.length === 1;
  }],
  // Immutability
  ['addEntry does not mutate input', () => {
    const u = emptyUser();
    HM.popup.addEntry(u, 'artists', 'Beyoncé');
    return u.artists.length === 0;
  }],
  // popup.html checks
  ['popup.html contains Lists tab', () => {
    const html = popupHtml();
    return html.includes('Lists');
  }],
  ['popup.html contains Behaviour tab', () => {
    const html = popupHtml();
    return html.includes('Behaviour');
  }],
  ['popup.html contains Log tab', () => {
    const html = popupHtml();
    return html.includes('Log');
  }],
  ['popup.html contains credit line', () => {
    const html = popupHtml();
    return html.includes('Soul Over AI list by souloverai.com, CC BY 4.0.');
  }],
  ['popup.html loads scripts in correct order', () => {
    const html = popupHtml();
    const scripts = [
      '../src/core/text.js',
      '../src/core/lists.js',
      '../src/core/settings.js',
      '../src/core/log.js',
      'model.js',
      'popup.js'
    ];
    let last = 0;
    for (const s of scripts) {
      const idx = html.indexOf(s);
      if (idx === -1 || idx < last) return `script ${s} not found or out of order`;
      last = idx;
    }
    return true;
  }],
  ['popup.html has no inline scripts', () => {
    const html = popupHtml();
    return !/<script[^>]*>[^<]/.test(html);
  }]
]);
