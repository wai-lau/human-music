// Runs the real popup (popup.html + popup.js) against tests/dom.mjs and a fake chrome.
import { readFileSync } from 'fs';
import { load, run } from './load.mjs';
import { parseHTML, Event } from './dom.mjs';
import { fakeStorage } from './fakes.mjs';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

async function open(initial = {}, { grant = true, dev = true, wrap = null } = {}) {
  const doc = parseHTML(readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8'));
  const base = fakeStorage(initial);
  const storage = wrap ? wrap(base) : base;
  storage.data = base.data;
  const calls = { permissions: [], messages: [] };
  const chrome = {
    storage: { local: storage, onChanged: storage.onChanged },
    permissions: { request: (q, cb) => { calls.permissions.push(q); cb(grant); }, remove: (q, cb) => { calls.removed = (calls.removed || []).concat([q]); if (cb) cb(true); } },
    runtime: { sendMessage: (m, cb) => { calls.messages.push(m); if (dev === 'throw' && m.type === 'dev-mode') throw new Error('no worker'); if (cb) cb(m.type === 'dev-mode' ? dev === true : true); } },
  };
  load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js', 'popup/popup.js'],
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
    return (row.querySelector('.list-name').textContent === 'Soul Over AI' && row.querySelector('.chip').textContent === 'Built in'
      && row.querySelector('.list-info').textContent === '0 artists · not updated yet'
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
  // Wai, 2026-11-16: "for the logs collapse and sum each artist / Always play button should be
  // 'always show' and it should be a toggle, not a link".
  ['log: each artist collapsed with its sum; unfolds to its songs; "Always show" switches Never skip on and off', async () => {
    const entry = { at: Date.now(), event: 'skipped', title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating • 2025',
      listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown' };
    const p = await open({ 'hm.log': [entry, { ...entry, at: entry.at - 1000, title: 'Drift' }, { ...entry, at: entry.at - 2000, title: 'Drift' }] });
    const g = () => p.doc.querySelector('#log-entries .log-group');
    const items = () => g().querySelector('.log-items');
    const collapsed = items().hidden === true && g().querySelector('.log-toggle').getAttribute('aria-expanded') === 'false';
    const head = g().querySelector('.log-artist').textContent === 'The Velvet Sundown' && g().querySelector('.log-sum').textContent === '3'
      && g().querySelector('.log-reason').textContent === 'AI-generated · Soul Over AI' && !g().textContent.includes('Floating');
    await p.click(g().querySelector('.log-toggle'));
    const open1 = items().hidden === false && [...g().querySelectorAll('.log-title')].map(x => x.textContent).join() === 'Dust on the Wind,Drift'
      && g().querySelectorAll('button.link').length === 0;
    const sw = () => g().querySelector('input');
    const label = sw().getAttribute('aria-label') === 'Always show The Velvet Sundown' && sw().checked === false;
    sw().checked = true; sw().dispatchEvent(new Event('change')); await settle();
    const on = JSON.stringify(data(p, 'hm.user').neverSkip) === '["The Velvet Sundown"]' && sw().checked === true && items().hidden === false;
    sw().checked = false; sw().dispatchEvent(new Event('change')); await settle();
    const off = JSON.stringify(data(p, 'hm.user').neverSkip) === '[]';
    return (collapsed && head && open1 && label && on && off) || JSON.stringify({ collapsed, head, open1, label, on, off });
  }],
  ['log sections: Blocked, Actions, Errors with counts; list update failures show under Errors', async () => {
    const at = Date.now();
    const base = { artistLine: 'The Velvet Sundown', listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown' };
    const soa = { id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: 1, count: 3, lastError: 'HTTP 500' };
    const p = await open({ 'hm.filterLists': [soa], 'hm.log': [{ ...base, at, event: 'removed', title: 'A' }, { ...base, at: at - 1, event: 'hidden', title: 'B' }, { ...base, at: at - 2, event: 'skip-failed', title: 'C' }] });
    const n = k => p.doc.querySelector(`.seg-btn[data-section="${k}"] .n`).textContent;
    const blocked = [...p.doc.querySelectorAll('#log-entries .log-title')].map(x => x.textContent).join();
    await p.click(p.doc.querySelector('.seg-btn[data-section="errors"]'));
    const errs = p.doc.querySelector('#log-entries').textContent;
    return (n('blocks') === '2' && n('actions') === '' && n('errors') === '2' && blocked === 'A,B'
      && errs.includes('List update failed: HTTP 500') && errs.includes('Couldn’t skip')) || JSON.stringify({ n: [n('blocks'), n('actions'), n('errors')], blocked, errs });
  }],
  // No site permission any more (Wai, 2026-11-13: "minimize required permissions"): a list
  // server must allow any origin (GitHub raw files do), or its refresh fails visibly.
  ['add a list by URL asks Chrome for nothing and refreshes it', async () => {
    const p = await open();
    p.$('list-url').value = 'https://example.org/ai.json';
    p.$('list-name').value = 'Community list';
    await p.click(p.$('add-list-btn'));
    const lists = data(p, 'hm.filterLists');
    return (p.calls.permissions.length === 0 && lists.length === 2 && lists[1].id === 'community-list'
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
  ['http list address refused', async () => {
    const p = await open();
    p.$('list-url').value = 'http://example.org/ai.json';
    await p.click(p.$('add-list-btn'));
    return (p.calls.permissions.length === 0 && p.$('status').textContent === 'Use an https:// address') || p.$('status').textContent;
  }],
  ['removing lists asks Chrome for nothing', async () => {
    const mk = (id, url) => ({ id, name: id, url, enabled: true, mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null });
    const soa = { id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: null, count: 0, lastError: null };
    const p = await open({ 'hm.filterLists': [soa, mk('a', 'https://lists.example/a.json'), mk('b', 'https://lists.example/b.json'), mk('c', 'https://other.example/c.json')] });
    const removeBtn = id => [...p.doc.querySelectorAll('#filter-lists li')].find(li => li.querySelector('.list-name').textContent === id).querySelectorAll('button').slice(-1)[0];
    await p.click(removeBtn('a')); // b still uses lists.example
    const afterA = JSON.stringify(p.calls.removed || []);
    await p.click(removeBtn('c'));
    await p.click(removeBtn('b'));
    const ids = data(p, 'hm.filterLists').map(l => l.id).join(',');
    return (afterA === '[]' && p.calls.removed === undefined && ids === 'soul-over-ai')
      || JSON.stringify({ afterA, removed: p.calls.removed, ids });
  }],
  ['a failed storage read keeps your lists: the next Add leaves the other entries and says so', async () => {
    const user = { artists: ['Old Artist'], songs: [{ title: 'S', artist: null }], keywords: ['kw'], neverSkip: ['Safe One'] };
    let failNext = false;
    const wrap = s => ({ ...s, get: async k => { if (failNext) { failNext = false; throw new Error('storage hiccup'); } return s.get(k); } });
    const p = await open({ 'hm.user': user }, { wrap });
    failNext = true;
    await p.storage.set({ 'hm.log': [] }); // a storage change: the popup reloads, and that read fails
    await settle();
    const shown = p.$('artists').children.length;
    const said = p.$('status').textContent;
    p.$('artist-input').value = 'New';
    await p.click(p.doc.querySelector('.add-entry-btn[data-kind="artists"]'));
    const u = data(p, 'hm.user');
    return (shown === 1 && said !== '' && JSON.stringify(u) === JSON.stringify({ ...user, artists: ['Old Artist', 'New'] }))
      || JSON.stringify({ shown, said, u });
  }],
  ['an Add whose read fails writes nothing and says so', async () => {
    const user = { artists: ['Old Artist'], songs: [], keywords: ['kw'], neverSkip: ['Safe One'] };
    let failNext = false;
    const wrap = s => ({ ...s, get: async k => { if (failNext) { failNext = false; throw new Error('storage hiccup'); } return s.get(k); } });
    const p = await open({ 'hm.user': user }, { wrap });
    failNext = true;
    p.$('artist-input').value = 'New';
    await p.click(p.doc.querySelector('.add-entry-btn[data-kind="artists"]'));
    return (JSON.stringify(data(p, 'hm.user')) === JSON.stringify(user) && p.$('status').textContent !== '') || JSON.stringify({ u: data(p, 'hm.user'), said: p.$('status').textContent });
  }],
  ['removing a list also deletes its downloaded data, so adding it again starts clean', async () => {
    const mk = (id, url) => ({ id, name: id, url, enabled: true, mode: 'act', builtIn: false, lastRefresh: 5, count: 1, lastError: null });
    const soa = { id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: null, count: 0, lastError: null };
    const p = await open({ 'hm.filterLists': [soa, mk('a', 'https://lists.example/a.json')], 'hm.list.a': { artists: [{ name: 'X' }] }, 'hm.list.soul-over-ai': { artists: [] } });
    const btn = [...p.doc.querySelectorAll('#filter-lists li')].find(li => li.querySelector('.list-name').textContent === 'a').querySelectorAll('button').slice(-1)[0];
    await p.click(btn);
    const keys = Object.keys(p.storage.data).sort().join(',');
    return (!('hm.list.a' in p.storage.data) && 'hm.list.soul-over-ai' in p.storage.data && data(p, 'hm.filterLists').length === 1) || keys;
  }],
  ['watch-only switches live under Behaviour, one per list, and save the mode (Wai, 2026-11-16)', async () => {
    const p = await open();
    if (p.doc.querySelector('#filter-lists .watch')) return 'still on the list card';
    const box = p.doc.querySelector('#watch-lists input');
    box.checked = true; box.dispatchEvent(new Event('change')); await settle();
    return data(p, 'hm.filterLists')[0].mode === 'watch' || JSON.stringify(data(p, 'hm.filterLists'));
  }],
  // Filtering mode (investigator plan, Task 6).
  ['the slider shows the mode and saves it; leaving No filtering clears paused', async () => {
    const p = await open({ 'hm.settings': { mode: 'off', paused: true }, 'hm.filterLists': [{ id: 'hm-verdicts', name: 'Human Music verdicts', url: 'https://x.example/v.json', enabled: true, mode: 'act', builtIn: true, calibrated: true, count: 1 }] });
    const shown = p.$('mode').value === '0' && p.$('mode-label').textContent === 'No filtering' && p.$('paused') === null;
    await p.change('mode', e => { e.value = '3'; });
    const s = data(p, 'hm.settings');
    return (shown && s.mode === 'aggressive' && s.modeChosen === true && s.paused === false && p.$('mode-label').textContent === 'Aggressive') || JSON.stringify({ shown, s });
  }],
  ['moving to No filtering saves paused', async () => {
    const p = await open();
    await p.change('mode', e => { e.value = '0'; });
    const s = data(p, 'hm.settings');
    return (s.mode === 'off' && s.paused === true && s.modeChosen === true) || JSON.stringify(s);
  }],
  // A refusal saves nothing (review 2026-11-17): recording a chosen List only would keep this
  // person off the Optimal default once the verdict list is calibrated.
  ['until the verdict list is calibrated, Optimal and Aggressive snap back to List only, say so, and save nothing', async () => {
    const p = await open();
    await p.change('mode', e => { e.value = '2'; });
    const s = data(p, 'hm.settings') || {};
    const said = p.$('status').textContent;
    return (s.modeChosen !== true && s.mode !== 'optimal' && p.$('mode').value === '1' && p.$('mode-label').textContent === 'List only' && /Optimal is not ready yet/.test(said)) || JSON.stringify({ s, said });
  }],
  ['a verdict log line reads AI-generated · Human Music verdicts · 97%', async () => {
    const p = await open({ 'hm.log': [{ at: Date.now(), event: 'removed', title: 'T', artistLine: 'Forrest Rose', listId: 'hm-verdicts', listName: 'Human Music verdicts', rule: 'artist', entry: 'Forrest Rose', confidence: 97 }] });
    return p.doc.querySelector('#log-entries .log-reason').textContent === 'AI-generated · Human Music verdicts · 97%' || p.doc.querySelector('#log-entries').textContent;
  }],
  ['investigator: saving a key stores it apart from settings, sets investigate, empties the field; clearing turns it off', async () => {
    const p = await open();
    const type = p.$('investigator-token').getAttribute('type') === 'password' && p.$('investigator').hidden === false;
    p.$('investigator-token').value = 'secret-key-123';
    await p.click(p.$('investigator-save'));
    const inv = data(p, 'hm.investigator');
    const saved = inv.token === 'secret-key-123' && data(p, 'hm.settings').investigate === true && p.$('investigator-token').value === ''
      && !JSON.stringify(data(p, 'hm.settings')).includes('secret-key') && !p.doc.body.textContent.includes('secret-key') && /key is saved/.test(p.$('investigator-status').textContent);
    await p.click(p.$('investigator-save'));
    const cleared = data(p, 'hm.investigator').token === '' && data(p, 'hm.settings').investigate === false;
    return (type && saved && cleared) || JSON.stringify({ type, saved, cleared, inv });
  }],
  ['investigator: saving a key keeps the worker\'s newer sent record and last error', async () => {
    const p = await open({ 'hm.investigator': { token: 'old', base: 'https://wai-lau.net/human-music', sent: {} } });
    // The worker records a send after the popup loaded (no change event reaches this popup).
    p.storage.data['hm.investigator'] = { token: 'old', base: 'https://wai-lau.net/human-music', sent: { 'some artist': '2026-11-17' }, lastSentAt: 5, lastError: 'HTTP 503' };
    p.$('investigator-token').value = 'new-key';
    await p.click(p.$('investigator-save'));
    const inv = data(p, 'hm.investigator');
    return (inv.token === 'new-key' && inv.sent['some artist'] === '2026-11-17' && inv.lastSentAt === 5 && inv.lastError === 'HTTP 503') || JSON.stringify(inv);
  }],
  ['investigator status shows last sent and last error', async () => {
    const p = await open({ 'hm.investigator': { token: 'k', base: 'https://wai-lau.net/human-music', sent: {}, lastSentAt: Date.now() - 60000, lastError: 'HTTP 401' } });
    const t = p.$('investigator-status').textContent;
    return (/Last sent/.test(t) && t.includes('Last error: HTTP 401')) || t;
  }],
  ['investigator section stays hidden unless the worker says development copy', async () => {
    const no = await open({}, { dev: false });
    const fail = await open({}, { dev: 'throw' });
    return (no.$('investigator').hidden === true && fail.$('investigator').hidden === true) || 'shown';
  }],
]);
