// The popup: Lists, Behaviour and Log tabs over chrome.storage.local.
// Storage keys and shapes are the plan's "Shared shapes"; list edits go through HM.popup.
(function () {
  'use strict';
  const HM = globalThis.HM;
  const api = HM.store.api();
  const store = api.storage.local;
  const $ = id => document.getElementById(id);

  // Latest copies, kept so click handlers can act synchronously (Chrome only grants
  // a host permission from inside the click itself).
  const state = { user: HM.store.emptyUser(), settings: HM.settings.sanitize({}), lists: [], log: [], investigator: {} };

  function status(text) { const el = $('status'); if (el) el.textContent = text || ''; }

  function node(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'onclick') e.addEventListener('click', v);
      else if (k === 'onchange') e.addEventListener('change', v);
      else if (k.includes('-')) e.setAttribute(k, v);
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
    const r = await read([HM.store.KEYS.user, HM.store.KEYS.settings, HM.store.KEYS.filterLists, HM.store.KEYS.log, HM.store.KEYS.investigator]);
    state.user = { ...HM.store.emptyUser(), ...(r[HM.store.KEYS.user] || {}) };
    state.settings = HM.settings.sanitize(r[HM.store.KEYS.settings]);
    const lists = Array.isArray(r[HM.store.KEYS.filterLists]) ? r[HM.store.KEYS.filterLists] : [];
    state.lists = lists.some(l => l.id === HM.lists.SOUL_OVER_AI.id) ? lists : [{ ...HM.lists.SOUL_OVER_AI }, ...lists];
    state.log = Array.isArray(r[HM.store.KEYS.log]) ? r[HM.store.KEYS.log] : [];
    const inv = r[HM.store.KEYS.investigator];
    state.investigator = inv && typeof inv === 'object' ? inv : {};
  }
  const saveUser = user => { state.user = user; return store.set({ [HM.store.KEYS.user]: user }); };
  const saveSettings = s => { state.settings = HM.settings.sanitize(s); return store.set({ [HM.store.KEYS.settings]: state.settings }); };
  const saveLists = lists => { state.lists = lists; return store.set({ [HM.store.KEYS.filterLists]: lists }); };

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

  function renderFilterLists() {
    const ul = $('filter-lists');
    clear(ul);
    const now = Date.now();
    for (const list of state.lists) {
      const on = node('input', {
        type: 'checkbox', checked: !!list.enabled, title: 'On or off', 'aria-label': `${list.name} on`,
        onchange: () => {
          if (!on.checked) { updateList(list.id, { enabled: false }); return; }
          updateList(list.id, { enabled: true });
          refreshList(list.id);
        },
      });
      const count = (list.count || 0).toLocaleString('en');
      const updated = list.lastRefresh ? `updated ${HM.popup.timeLabel(list.lastRefresh, now)}` : 'not updated yet';
      ul.append(node('li', { class: 'list-row' },
        node('div', { class: 'list-main' }, on, node('span', { class: 'list-name', textContent: list.name }),
          list.builtIn ? node('span', { class: 'chip', textContent: 'Built in' }) : null),
        node('div', { class: 'list-info' }, `${count} ${list.count === 1 ? 'artist' : 'artists'} · ${updated}`,
          list.lastError ? node('span', { class: 'error', textContent: `Last update failed: ${list.lastError}` }) : null),
        node('div', { class: 'list-actions' },
          node('button', { class: 'link', textContent: 'Refresh', onclick: () => refreshList(list.id) }),
          list.builtIn ? null : node('button', {
            class: 'link', textContent: 'Remove',
            onclick: () => {
              let rest;
              try { rest = HM.popup.removeFilterList(state.lists, list.id); } catch (e) { status(e.message); return; }
              // The downloaded copy goes too (up to 5 MB), first: if it fails the list stays
              // in view to try again, and adding the same address later starts clean.
              Promise.resolve().then(() => store.remove(HM.store.listKey(list.id))).then(() => saveLists(rest))
                .catch(() => status('Could not remove that list. Try again.'));
            },
          }))));
    }
    const freq = $('refresh-frequency');
    if (freq) freq.value = state.settings.refresh;
    renderWatchLists();
  }

  // Watch only, per filter list, under Behaviour (Wai, 2026-11-16: "watch only should go under
  // behaviour, not lists"): a list in Watch only logs what it would skip and never acts.
  function renderWatchLists() {
    const ul = $('watch-lists');
    if (!ul) return;
    clear(ul);
    for (const list of state.lists) {
      ul.append(node('li', { class: 'setting' },
        node('div', { class: 'setting-text' }, node('span', { class: 'watch-name', textContent: list.name })),
        node('label', { class: 'switch' },
          node('input', {
            type: 'checkbox', checked: list.mode === 'watch', 'aria-label': `Watch only: ${list.name}`,
            onchange: e => updateList(list.id, { mode: e.target.checked ? 'watch' : 'act' }),
          }),
          node('span', { class: 'track', 'aria-hidden': 'true' }))));
    }
  }

  $('add-list-btn').addEventListener('click', () => {
    let lists;
    const act = !!$('list-act-now').checked;
    try { lists = HM.popup.addFilterList(state.lists, $('list-url').value.trim(), $('list-name').value, { act }); } catch (e) { status(e.message); return; }
    const added = lists[lists.length - 1];
    const said = act ? `Added ${added.name}. It acts at once.`
      : `Added ${added.name} in Watch only: the log shows what it would skip. Untick Watch only when it looks right.`;
    saveLists(lists).then(() => refreshList(added.id, said));
    $('list-url').value = '';
    $('list-name').value = '';
    $('list-act-now').checked = false;
    status(said);
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

  const TOGGLES = { 'auto-skip': 'autoSkip', 'auto-dislike': 'autoDislike', 'hide-items': 'hidePageItems', 'player-buttons': 'playerButtons' };

  function renderSettings() {
    $('lookahead').value = String(state.settings.lookahead);
    for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = !!state.settings[key];
  }

  // --- Filtering mode slider (header) ---------------------------------------------------------
  // Four stops on one track, like uBlock Origin's blocking-mode slider. Optimal and Aggressive
  // need a calibrated verdict list; until then a move to either lands on List only.

  const MODE_NAMES = { off: 'No filtering', lists: 'List only', optimal: 'Optimal', aggressive: 'Aggressive' };
  const verdictsCalibrated = () => state.lists.some(l => l.id === 'hm-verdicts' && l.calibrated === true);

  function showMode(mode) {
    const i = HM.settings.MODES.indexOf(mode);
    const slider = $('mode');
    slider.value = String(i);
    slider.setAttribute('aria-valuetext', MODE_NAMES[mode]);
    const label = $('mode-label');
    label.textContent = MODE_NAMES[mode];
    // The name sits under its stop but never runs past the popup's edge.
    label.style.marginLeft = `${(i / 3) * 100}%`;
    label.style.transform = `translateX(-${(i / 3) * 100}%)`;
  }

  function renderMode() {
    showMode(HM.settings.effectiveMode(state.settings, verdictsCalibrated()));
  }

  $('mode').addEventListener('input', e => {
    const m = HM.settings.MODES[Number(e.target.value)];
    if (m) showMode(m);
  });
  $('mode').addEventListener('change', e => {
    const mode = HM.settings.MODES[Number(e.target.value)] || 'lists';
    if (HM.settings.threshold(mode) !== null && !verdictsCalibrated()) {
      // Refused: nothing is saved, so this person still gets the Optimal default once the
      // verdict list is calibrated (saving a chosen List only would keep them off it).
      status(`${MODE_NAMES[mode]} is not ready yet, so List only stays on until the verdict list is checked.`);
      showMode(HM.settings.effectiveMode(state.settings, verdictsCalibrated()));
      return;
    }
    status('');
    showMode(mode);
    saveSettings({ ...state.settings, mode, modeChosen: true, paused: mode === 'off' });
  });

  // --- Investigator (development copies only) ---------------------------------------------------
  // Hidden unless the worker says this is a development install; store copies never show it.

  function renderInvestigator() {
    const inv = state.investigator;
    const bits = [inv.token ? 'A key is saved.' : 'No key saved.'];
    if (typeof inv.lastSentAt === 'number') bits.push(`Last sent ${HM.popup.timeLabel(inv.lastSentAt, Date.now())}.`);
    if (inv.lastError) bits.push(`Last error: ${inv.lastError}`);
    const el = $('investigator-status');
    if (el) el.textContent = bits.join(' ');
  }

  try {
    chrome.runtime.sendMessage({ type: 'dev-mode' }, answer => {
      void chrome.runtime.lastError;
      if (answer === true) $('investigator').hidden = false;
    });
  } catch (e) { /* stays hidden */ }

  $('investigator-save').addEventListener('click', () => {
    const field = $('investigator-token');
    const token = field.value.trim();
    field.value = '';
    const cur = state.investigator;
    const next = { ...cur, token, base: typeof cur.base === 'string' ? cur.base : 'https://wai-lau.net/human-music', sent: cur.sent && typeof cur.sent === 'object' ? cur.sent : {} };
    state.investigator = next;
    status(token ? 'A key is saved.' : 'The key is removed.');
    store.set({ [HM.store.KEYS.investigator]: next });
    saveSettings({ ...state.settings, investigate: !!token });
    renderInvestigator();
  });

  $('lookahead').addEventListener('change', e => saveSettings({ ...state.settings, lookahead: e.target.value }));
  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).addEventListener('change', e => saveSettings({ ...state.settings, [key]: !!e.target.checked }));
  }

  // --- Log tab --------------------------------------------------------------------------

  // Three sections (Wai, 2026-11-15): Blocked, Actions, Errors; grouped by artist so the
  // artist, the reason and "Always play" each show once.
  const SECTION_HINTS = {
    blocks: 'Kept from playing: taken out of the queue or hidden on a page.',
    actions: 'Done while a song played: skipped or disliked, and what Watch only lists would skip.',
    errors: 'What didn’t work. The song played on.',
  };
  const EMPTY = { blocks: 'Nothing blocked yet.', actions: 'Nothing done yet.', errors: 'No errors.' };
  const SHOWN = 60; // artist groups shown; Export log has everything
  let section = null; // chosen section; until then, the section of the newest entry
  const expanded = new Set(); // artist groups unfolded in this popup

  function listErrors() {
    return state.lists.filter(l => l.enabled && l.lastError);
  }

  function renderToday() {
    const el = $('today');
    if (!el) return;
    if (state.settings.paused) { el.textContent = 'Paused'; el.classList.add('paused'); return; }
    el.classList.remove('paused');
    const t = HM.popup.todaySummary(state.log, Date.now());
    const parts = [];
    if (t.skipped) parts.push(`${t.skipped} skipped`);
    if (t.removed) parts.push(`${t.removed} removed`);
    el.textContent = parts.length ? `${parts.join(' · ')} today` : 'Nothing skipped today';
  }

  function renderLog() {
    const counts = HM.popup.sectionCounts(state.log);
    counts.errors += listErrors().length;
    if (!section) section = state.log.length ? HM.log.section(state.log[0].event) : (counts.errors ? 'errors' : 'blocks');
    for (const btn of document.querySelectorAll('.seg-btn')) {
      const k = btn.dataset.section;
      btn.classList.toggle('active', k === section);
      btn.classList.toggle('has', counts[k] > 0);
      btn.querySelector('.n').textContent = counts[k] ? String(counts[k]) : '';
    }
    $('section-hint').textContent = SECTION_HINTS[section];

    const ul = $('log-entries');
    clear(ul);
    const now = Date.now();
    if (section === 'errors') {
      for (const l of listErrors()) {
        ul.append(node('li', { class: 'log-group' },
          node('div', { class: 'log-head' }, node('span', { class: 'log-artist', textContent: l.name }), node('span', { class: 'log-time', textContent: l.lastRefresh ? `last good ${HM.popup.timeLabel(l.lastRefresh, now)}` : '' })),
          node('div', { class: 'log-reason error', textContent: `List update failed: ${l.lastError}` })));
      }
    }
    const groups = HM.popup.groupLog(state.log, { now, section, neverSkip: state.user.neverSkip });
    if (!groups.length && !(section === 'errors' && listErrors().length)) {
      ul.append(node('li', { class: 'log-empty', textContent: EMPTY[section] }));
      return;
    }
    // The switches' heading, once (each switch also names its artist for screen readers).
    if (section !== 'errors' && groups.length) ul.append(node('li', { class: 'log-cols', 'aria-hidden': 'true' }, node('span', { textContent: 'Always show' })));
    for (const g of groups.slice(0, SHOWN)) {
      const key = `${section}|${g.artist}|${g.reason}`;
      const open = expanded.has(key);
      const items = node('ul', { class: 'log-items', hidden: !open });
      for (const it of g.items) {
        items.append(node('li', { class: 'log-item' },
          node('span', { class: 'log-title', textContent: it.title || '(untitled)' }),
          it.count > 1 ? node('span', { class: 'log-count', textContent: `×${it.count}` }) : null,
          node('span', { class: section === 'errors' ? 'tag error' : 'tag', textContent: it.action }),
          node('span', { class: 'log-time', textContent: HM.popup.timeLabel(it.at, now) })));
      }
      const toggle = node('button', {
        class: 'log-toggle', 'aria-expanded': String(open), title: open ? 'Hide songs' : 'Show songs',
        onclick: () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderLog(); },
      }, node('span', { class: 'chev', 'aria-hidden': 'true' }),
        node('span', { class: 'log-artist', textContent: g.artist }),
        node('span', { class: 'log-sum', textContent: String(g.total) }));
      // "Always show" (Wai, 2026-11-16: a toggle, not a link): on puts the artist on Never skip,
      // off takes them off again.
      const always = section === 'errors' ? null : node('label', { class: 'switch always', title: 'Never skip or hide this artist' },
        node('input', {
          type: 'checkbox', checked: g.onNeverSkip, 'aria-label': `Always show ${g.artist}`,
          onchange: e => {
            if (e.target.checked) {
              saveUser(HM.popup.addEntry(state.user, 'neverSkip', g.artist));
              status(`${g.artist} will always show.`);
            } else {
              const N = HM.text.normalize;
              const i = (state.user.neverSkip || []).findIndex(n => N(n) === N(g.artist));
              if (i >= 0) saveUser(HM.popup.removeEntry(state.user, 'neverSkip', i));
              status(`${g.artist} follows the lists again.`);
            }
          },
        }),
        node('span', { class: 'track', 'aria-hidden': 'true' }));
      ul.append(node('li', { class: open ? 'log-group open' : 'log-group' },
        node('div', { class: 'log-head' }, toggle, always),
        g.reason ? node('div', { class: 'log-reason', textContent: g.reason }) : null,
        items));
    }
    if (groups.length > SHOWN) ul.append(node('li', { class: 'log-more', textContent: `${groups.length - SHOWN} more artists are in Export log.` }));
  }

  for (const btn of document.querySelectorAll('.seg-btn')) {
    btn.addEventListener('click', () => { section = btn.dataset.section; renderLog(); });
  }

  $('clear-log').addEventListener('click', () => store.set({ [HM.store.KEYS.log]: [] }));
  $('export-log').addEventListener('click', () => {
    const lines = state.log.map(e => [when(e.at), HM.log.describe(e), e.title, e.artistLine, e.entry ? `entry: ${e.entry}` : ''].filter(Boolean).join('\t'));
    download('human-music-log.txt', 'text/plain', lines.join('\n') + '\n');
  });

  // --- start and live updates -------------------------------------------------------------

  function renderAll() { renderFilterLists(); renderUserLists(); renderSettings(); renderMode(); renderInvestigator(); renderToday(); renderLog(); }

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
