// The popup: Lists, Behaviour and Log tabs over chrome.storage.local.
// Storage keys and shapes are the plan's "Shared shapes"; list edits go through HM.popup.
(function () {
  'use strict';
  const HM = globalThis.HM;
  // Firefox's browser.* always returns promises (its chrome.* may not); Chrome has no browser.
  const api = typeof browser !== 'undefined' && browser.storage ? browser : chrome;
  const store = api.storage.local;
  const $ = id => document.getElementById(id);
  const emptyUser = () => ({ artists: [], songs: [], keywords: [], neverSkip: [] });

  // Latest copies, kept so click handlers can act synchronously (Chrome only grants
  // a host permission from inside the click itself).
  const state = { user: emptyUser(), settings: HM.settings.sanitize({}), lists: [], log: [] };

  function status(text) { const el = $('status'); if (el) el.textContent = text || ''; }

  function node(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'onclick') e.addEventListener('click', v);
      else if (k === 'onchange') e.addEventListener('change', v);
      else e[k] = v;
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }
  function clear(el) { if (el) el.textContent = ''; }

  async function read(keys) {
    try { return (await store.get(keys)) || {}; } catch (e) { return {}; }
  }
  async function load() {
    const r = await read(['hm.user', 'hm.settings', 'hm.filterLists', 'hm.log']);
    state.user = { ...emptyUser(), ...(r['hm.user'] || {}) };
    state.settings = HM.settings.sanitize(r['hm.settings']);
    const lists = Array.isArray(r['hm.filterLists']) ? r['hm.filterLists'] : [];
    state.lists = lists.some(l => l.id === HM.lists.SOUL_OVER_AI.id) ? lists : [{ ...HM.lists.SOUL_OVER_AI }, ...lists];
    state.log = Array.isArray(r['hm.log']) ? r['hm.log'] : [];
  }
  const saveUser = user => { state.user = user; return store.set({ 'hm.user': user }); };
  const saveSettings = s => { state.settings = HM.settings.sanitize(s); return store.set({ 'hm.settings': state.settings }); };
  const saveLists = lists => { state.lists = lists; return store.set({ 'hm.filterLists': lists }); };

  // --- tabs --------------------------------------------------------------------

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b === btn);
      for (const c of document.querySelectorAll('.tab-content')) c.classList.toggle('active', c.id === 'tab-' + btn.dataset.tab);
    });
  }

  // --- Lists tab: filter lists ------------------------------------------------------

  function when(ms) {
    if (!ms) return 'never';
    try { return new Date(ms).toLocaleString(); } catch (e) { return 'never'; }
  }

  function updateList(id, change) {
    return saveLists(state.lists.map(l => (l.id === id ? { ...l, ...change } : l)));
  }

  // after: what to say once the refresh worked (a newly added list says how it starts).
  function refreshList(id, after = 'List refreshed.') {
    status('Refreshing…');
    try {
      chrome.runtime.sendMessage({ type: 'refresh', id }, ok => {
        status(ok ? after : 'Could not refresh that list; the last good copy is kept.');
      });
    } catch (e) { status('Could not refresh that list; the last good copy is kept.'); }
  }

  // Lists other than the built-in one need their site allowed before they can be fetched.
  function withAccess(list, then) {
    if (list.builtIn) { then(true); return; }
    let origin;
    try { origin = new URL(list.url).origin; } catch (e) { then(false); return; }
    try {
      chrome.permissions.request({ origins: [origin + '/*'] }, granted => then(!!granted));
    } catch (e) { then(false); }
  }

  // A removed list's site access goes back to Chrome once no other list uses that site.
  function releaseAccess(list, rest) {
    const originOf = url => { try { return new URL(url).origin; } catch (e) { return null; } };
    const origin = originOf(list.url);
    if (!origin || rest.some(l => originOf(l.url) === origin)) return;
    try {
      chrome.permissions.remove({ origins: [origin + '/*'] }, () => void chrome.runtime.lastError);
    } catch (e) { /* nothing to give back */ }
  }

  function renderFilterLists() {
    const ul = $('filter-lists');
    clear(ul);
    for (const list of state.lists) {
      const on = node('input', {
        type: 'checkbox', checked: !!list.enabled, title: 'On or off',
        onchange: () => {
          if (!on.checked) { updateList(list.id, { enabled: false }); return; }
          withAccess(list, granted => {
            if (granted) { updateList(list.id, { enabled: true }); refreshList(list.id); }
            else { on.checked = false; status("Chrome didn't allow access to that list's site, so it stays off."); }
          });
        },
      });
      const watch = node('input', { type: 'checkbox', checked: list.mode === 'watch', onchange: () => updateList(list.id, { mode: watch.checked ? 'watch' : 'act' }) });
      const info = `${list.count || 0} ${list.count === 1 ? 'artist' : 'artists'}, refreshed ${when(list.lastRefresh)}`;
      ul.append(node('li', { class: 'list-row' },
        node('div', { class: 'list-main' }, on, node('span', { class: 'list-name', textContent: list.name + (list.builtIn ? ' (built in)' : '') })),
        node('div', { class: 'list-info', textContent: info + (list.lastError ? ` (last try failed: ${list.lastError})` : '') }),
        node('div', { class: 'list-actions' },
          node('label', { class: 'watch' }, watch, ' Watch only (log, never act)'),
          node('button', { textContent: 'Refresh now', onclick: () => refreshList(list.id) }),
          list.builtIn ? null : node('button', {
            textContent: 'Remove',
            onclick: () => {
              let rest;
              try { rest = HM.popup.removeFilterList(state.lists, list.id); } catch (e) { status(e.message); return; }
              saveLists(rest);
              releaseAccess(list, rest);
            },
          }))));
    }
    const freq = $('refresh-frequency');
    if (freq) freq.value = state.settings.refresh;
  }

  $('add-list-btn').addEventListener('click', () => {
    let lists;
    const act = !!$('list-act-now').checked;
    try { lists = HM.popup.addFilterList(state.lists, $('list-url').value.trim(), $('list-name').value, { act }); } catch (e) { status(e.message); return; }
    const added = lists[lists.length - 1];
    withAccess(added, granted => {
      if (!granted) { status("Chrome didn't allow access to that site, so the list wasn't added."); return; }
      const said = act ? `Added ${added.name}. It acts at once.`
        : `Added ${added.name} in Watch only: the log shows what it would skip. Untick Watch only when it looks right.`;
      saveLists(lists).then(() => refreshList(added.id, said));
      $('list-url').value = '';
      $('list-name').value = '';
      $('list-act-now').checked = false;
      status(said);
    });
  });

  $('refresh-frequency').addEventListener('change', e => saveSettings({ ...state.settings, refresh: e.target.value }));

  // --- Lists tab: your lists --------------------------------------------------------

  const USER_LISTS = [
    { kind: 'artists', ul: 'artists', heading: 'Your artists' },
    { kind: 'songs', ul: 'songs', heading: 'Your songs' },
    { kind: 'keywords', ul: 'keywords', heading: 'Your keywords' },
    { kind: 'neverSkip', ul: 'never-skip', heading: 'Never skip' },
  ];

  function renderUserLists() {
    for (const { kind, ul: id, heading } of USER_LISTS) {
      const ul = $(id);
      clear(ul);
      const entries = state.user[kind] || [];
      const h = ul && ul.parentElement && [...ul.parentElement.querySelectorAll('h3')].find(x => x.textContent.startsWith(heading));
      if (h) h.textContent = `${heading} (${entries.length})`;
      entries.forEach((entry, i) => {
        const text = typeof entry === 'string' ? entry : entry.title + (entry.artist ? ` by ${entry.artist}` : '');
        ul.append(node('li', {}, node('span', { textContent: text }),
          node('button', { textContent: 'Remove', onclick: () => saveUser(HM.popup.removeEntry(state.user, kind, i)) })));
      });
    }
  }

  const INPUTS = { artists: 'artist-input', keywords: 'keyword-input', neverSkip: 'never-skip-input' };
  for (const btn of document.querySelectorAll('.add-entry-btn')) {
    const kind = btn.dataset.kind;
    const input = $(INPUTS[kind]);
    const add = () => { saveUser(HM.popup.addEntry(state.user, kind, input.value)); input.value = ''; };
    btn.addEventListener('click', add);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }
  $('add-song-btn').addEventListener('click', () => {
    saveUser(HM.popup.addSong(state.user, $('song-title').value, $('song-artist').value));
    $('song-title').value = '';
    $('song-artist').value = '';
  });

  // --- Lists tab: backup -------------------------------------------------------------

  function download(name, type, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = node('a', { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { status('Could not save the file.'); }
  }

  $('export-btn').addEventListener('click', () => {
    const backup = HM.lists.exportBackup({ user: state.user, settings: state.settings, filterLists: state.lists });
    download('human-music-backup.json', 'application/json', JSON.stringify(backup, null, 2));
  });

  $('import-btn').addEventListener('click', async () => {
    const file = $('import-file').files && $('import-file').files[0];
    if (!file) { status('Choose a backup file first.'); return; }
    let data;
    try {
      data = HM.lists.importBackup(JSON.parse(await file.text()));
    } catch (e) {
      status(e instanceof SyntaxError ? 'That file is not a backup (it is not JSON).' : e.message);
      return;
    }
    const u = data.user;
    const next = HM.lists.applyBackup({ user: state.user, settings: state.settings, filterLists: state.lists }, data);
    await saveUser(next.user);
    if (data.settings) await saveSettings(next.settings);
    if (data.filterLists) await saveLists(next.filterLists);
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    status(`Imported ${n(u.artists.length, 'artist', 'artists')}, ${n(u.songs.length, 'song', 'songs')}, ${n(u.keywords.length, 'keyword', 'keywords')} and ${n(u.neverSkip.length, 'never-skip artist', 'never-skip artists')}.`);
  });

  // --- Behaviour tab ------------------------------------------------------------------

  const TOGGLES = { 'auto-skip': 'autoSkip', 'auto-dislike': 'autoDislike', 'hide-items': 'hidePageItems', 'player-buttons': 'playerButtons', paused: 'paused' };

  function renderSettings() {
    $('lookahead').value = String(state.settings.lookahead);
    for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = !!state.settings[key];
  }

  $('lookahead').addEventListener('change', e => saveSettings({ ...state.settings, lookahead: e.target.value }));
  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).addEventListener('change', e => saveSettings({ ...state.settings, [key]: !!e.target.checked }));
  }

  // --- Log tab --------------------------------------------------------------------------

  const SHOWN = 200;
  const creditOf = entry => String(entry.artistLine || '').split(' • ')[0].trim();

  function renderLog() {
    const ul = $('log-entries');
    clear(ul);
    if (!state.log.length) { ul.append(node('li', { class: 'log-empty', textContent: 'Nothing yet.' })); return; }
    for (const entry of state.log.slice(0, SHOWN)) {
      const credit = creditOf(entry);
      const onNever = (state.user.neverSkip || []).some(n => HM.text.normalize(n) === HM.text.normalize(credit));
      ul.append(node('li', {},
        node('div', { class: 'log-desc', textContent: HM.log.describe(entry) }),
        node('div', { class: 'log-meta', textContent: `${when(entry.at)} · ${entry.title || ''}${entry.artistLine ? ' · ' + entry.artistLine : ''}` }),
        credit && !onNever ? node('button', {
          textContent: 'Wrong: never skip this artist',
          onclick: () => { saveUser(HM.popup.addEntry(state.user, 'neverSkip', credit)); status(`${credit} will always play.`); },
        }) : null));
    }
    if (state.log.length > SHOWN) ul.append(node('li', { class: 'log-more', textContent: `${state.log.length - SHOWN} older entries are in Export log.` }));
  }

  $('clear-log').addEventListener('click', () => store.set({ 'hm.log': [] }));
  $('export-log').addEventListener('click', () => {
    const lines = state.log.map(e => [when(e.at), HM.log.describe(e), e.title, e.artistLine, e.entry ? `entry: ${e.entry}` : ''].filter(Boolean).join('\t'));
    download('human-music-log.txt', 'text/plain', lines.join('\n') + '\n');
  });

  // --- start and live updates -------------------------------------------------------------

  function renderAll() { renderFilterLists(); renderUserLists(); renderSettings(); renderLog(); }

  const onChanged = (api.storage && api.storage.onChanged) || store.onChanged;
  if (onChanged) {
    onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (!Object.keys(changes).some(k => k.startsWith('hm.'))) return;
      load().then(renderAll);
    });
  }

  load().then(renderAll);
})();
