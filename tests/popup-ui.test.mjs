// Runs the real popup (popup.html + popup.js) against tests/dom.mjs and a fake chrome.
import { readFileSync } from 'fs';
import { load, run } from './load.mjs';
import { parseHTML, Event } from './dom.mjs';
import { fakeStorage } from './fakes.mjs';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

async function open(initial = {}, { grant = true } = {}) {
  const doc = parseHTML(readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8'));
  const storage = fakeStorage(initial);
  const calls = { permissions: [], messages: [] };
  const chrome = {
    storage: { local: storage, onChanged: storage.onChanged },
    permissions: { request: (q, cb) => { calls.permissions.push(q); cb(grant); }, remove: (q, cb) => { calls.removed = (calls.removed || []).concat([q]); if (cb) cb(true); } },
    runtime: { sendMessage: (m, cb) => { calls.messages.push(m); if (cb) cb(true); } },
  };
  load(['src/core/text.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js', 'popup/popup.js'],
    { document: doc, chrome, URL, Blob, setTimeout, clearTimeout });
  await settle();
  const $ = id => doc.getElementById(id);
  const change = async (id, set) => { set($(id)); $(id).dispatchEvent(new Event('change')); await settle(); };
  const click = async el => { el.click(); await settle(); };
  return { doc, storage, calls, $, change, click };
}
const data = (p, k) => p.storage.data[k];

run([
  ['Log is the first tab and the popup opens on it (Wai, 2026-11-13: "First Tab should be Log")', async () => {
    const p = await open();
    const tabs = [...p.doc.querySelectorAll('.tab')];
    const shown = [...p.doc.querySelectorAll('.tab-content')].filter(c => c.classList.contains('active')).map(c => c.id);
    return (tabs[0].dataset.tab === 'log' && tabs[0].classList.contains('active') && tabs.filter(t => t.classList.contains('active')).length === 1 && JSON.stringify(shown) === '["tab-log"]')
      || JSON.stringify({ first: tabs[0].dataset.tab, shown });
  }],
  ['built-in list shows with its count and refresh time', async () => {
    const p = await open();
    const row = p.doc.querySelector('#filter-lists li');
    return (row.querySelector('.list-name').textContent === 'Soul Over AI (built in)'
      && row.querySelector('.list-info').textContent === '0 artists, refreshed never'
      && !row.textContent.includes('Remove')) || row.textContent;
  }],
  ['behaviour switches save the right settings', async () => {
    const p = await open();
    await p.change('auto-dislike', e => { e.checked = true; });
    await p.change('hide-items', e => { e.checked = false; });
    await p.change('lookahead', e => { e.value = '5'; });
    await p.change('refresh-frequency', e => { e.value = 'weekly'; });
    const s = data(p, 'hm.settings');
    return (s.autoDislike === true && s.hidePageItems === false && s.lookahead === 5 && s.refresh === 'weekly' && s.autoSkip === true) || JSON.stringify(s);
  }],
  ['add an artist; the heading counts it', async () => {
    const p = await open();
    p.$('artist-input').value = '  Some Band ';
    await p.click(p.doc.querySelector('.add-entry-btn[data-kind="artists"]'));
    const h = [...p.doc.querySelectorAll('h3')].find(x => x.textContent.startsWith('Your artists'));
    return (JSON.stringify(data(p, 'hm.user').artists) === '["Some Band"]' && h.textContent === 'Your artists (1)' && p.$('artist-input').value === '') || h.textContent;
  }],
  ['add a song with no artist', async () => {
    const p = await open();
    p.$('song-title').value = 'Love';
    await p.click(p.$('add-song-btn'));
    return JSON.stringify(data(p, 'hm.user').songs) === '[{"title":"Love","artist":null}]' || JSON.stringify(data(p, 'hm.user'));
  }],
  ['import the old extension backup and merge it', async () => {
    const p = await open({ 'hm.user': { artists: ['A'], songs: [], keywords: [], neverSkip: [] } });
    const old = { blockedArtists: ['a', 'B'], blockedKeywords: ['remix'], blockedTracks: ['Song One', { title: 'T', artist: 'Band • Album' }] };
    p.$('import-file').files = [{ text: async () => JSON.stringify(old) }];
    await p.click(p.$('import-btn'));
    const u = data(p, 'hm.user');
    return (JSON.stringify(u.artists) === '["A","B"]' && u.songs.length === 2 && u.songs[1].artist === 'Band'
      && p.$('status').textContent === 'Imported 2 artists, 2 songs, 1 keyword and 0 never-skip artists.') || JSON.stringify({ u, s: p.$('status').textContent });
  }],
  ['a file that is not a backup says so', async () => {
    const p = await open();
    p.$('import-file').files = [{ text: async () => '{"hello": 1}' }];
    await p.click(p.$('import-btn'));
    return p.$('status').textContent === 'Not a Human Music or YTM blocker backup' || p.$('status').textContent;
  }],
  ['export then import keeps lists and settings', async () => {
    const p = await open({ 'hm.user': { artists: ['X'], songs: [], keywords: [], neverSkip: ['N'] }, 'hm.settings': { lookahead: 7 } });
    let saved = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = blob => { saved = blob; return 'blob:x'; };
    try { await p.click(p.$('export-btn')); } finally { URL.createObjectURL = realCreate; }
    const text = await saved.text();
    const q = await open();
    q.$('import-file').files = [{ text: async () => text }];
    await q.click(q.$('import-btn'));
    return (JSON.parse(text).format === 'human-music-backup' && JSON.stringify(data(q, 'hm.user').neverSkip) === '["N"]' && data(q, 'hm.settings').lookahead === 7) || text;
  }],
  ['log line reads plainly, and "Wrong" puts the artist on never skip', async () => {
    const entry = { at: Date.now(), event: 'skipped', title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating • 2025',
      listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown' };
    const p = await open({ 'hm.log': [entry] });
    const li = p.doc.querySelector('#log-entries li');
    const ok = li.querySelector('.log-desc').textContent === 'Skipped: AI-generated (Soul Over AI)' && li.textContent.includes('Dust on the Wind');
    await p.click(li.querySelector('button'));
    const after = p.doc.querySelector('#log-entries li button');
    return (ok && JSON.stringify(data(p, 'hm.user').neverSkip) === '["The Velvet Sundown"]' && after === null) || li.textContent;
  }],
  ['add a list by URL asks Chrome for that site, then refreshes it', async () => {
    const p = await open();
    p.$('list-url').value = 'https://example.org/ai.json';
    p.$('list-name').value = 'Community list';
    await p.click(p.$('add-list-btn'));
    const lists = data(p, 'hm.filterLists');
    return (JSON.stringify(p.calls.permissions) === '[{"origins":["https://example.org/*"]}]' && lists.length === 2 && lists[1].id === 'community-list'
      && p.calls.messages.some(m => m.type === 'refresh' && m.id === 'community-list')) || JSON.stringify({ c: p.calls, lists });
  }],
  ['a list added by URL starts in Watch only (Wai, 2026-11-13); "Act at once" makes it act', async () => {
    const p = await open();
    p.$('list-url').value = 'https://example.org/ai.json';
    await p.click(p.$('add-list-btn'));
    const first = data(p, 'hm.filterLists')[1];
    const said = p.$('status').textContent;
    p.$('list-url').value = 'https://example.org/other.json';
    p.$('list-act-now').checked = true;
    await p.click(p.$('add-list-btn'));
    const second = data(p, 'hm.filterLists')[2];
    return (first.mode === 'watch' && /Watch only/.test(said) && second.mode === 'act' && p.$('list-act-now').checked === false)
      || JSON.stringify({ first: first.mode, said, second: second && second.mode, box: p.$('list-act-now').checked });
  }],
  ['site access refused: list not added', async () => {
    const p = await open({}, { grant: false });
    p.$('list-url').value = 'https://example.org/ai.json';
    await p.click(p.$('add-list-btn'));
    return (data(p, 'hm.filterLists') === undefined && p.$('status').textContent.includes("didn't allow")) || p.$('status').textContent;
  }],
  ['http list address refused before asking Chrome', async () => {
    const p = await open();
    p.$('list-url').value = 'http://example.org/ai.json';
    await p.click(p.$('add-list-btn'));
    return (p.calls.permissions.length === 0 && p.$('status').textContent === 'Use an https:// address') || p.$('status').textContent;
  }],
  ['removing a list gives its site back once no other list uses it', async () => {
    const mk = (id, url) => ({ id, name: id, url, enabled: true, mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null });
    const soa = { id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: null, count: 0, lastError: null };
    const p = await open({ 'hm.filterLists': [soa, mk('a', 'https://lists.example/a.json'), mk('b', 'https://lists.example/b.json'), mk('c', 'https://other.example/c.json')] });
    const removeBtn = id => [...p.doc.querySelectorAll('#filter-lists li')].find(li => li.querySelector('.list-name').textContent === id).querySelectorAll('button').slice(-1)[0];
    await p.click(removeBtn('a')); // b still uses lists.example
    const afterA = JSON.stringify(p.calls.removed || []);
    await p.click(removeBtn('c'));
    await p.click(removeBtn('b'));
    const ids = data(p, 'hm.filterLists').map(l => l.id).join(',');
    return (afterA === '[]' && JSON.stringify(p.calls.removed) === '[{"origins":["https://other.example/*"]},{"origins":["https://lists.example/*"]}]' && ids === 'soul-over-ai')
      || JSON.stringify({ afterA, removed: p.calls.removed, ids });
  }],
  ['watch-only switch saves mode', async () => {
    const p = await open();
    const box = p.doc.querySelector('#filter-lists .watch input');
    box.checked = true; box.dispatchEvent(new Event('change')); await settle();
    return data(p, 'hm.filterLists')[0].mode === 'watch' || JSON.stringify(data(p, 'hm.filterLists'));
  }],
]);
