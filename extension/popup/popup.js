// The popup: Lists, Behaviour and Log tabs over chrome.storage.local.
// Storage keys and shapes are the plan's "Shared shapes"; list edits go through HM.popup.
(function () {
  'use strict';
  const HM = globalThis.HM;
  const api = HM.store.api();
  const store = api.storage.local;
  const $ = id => document.getElementById(id);

  // The log lives in segments (HM.log.createLogStore). The popup only reads and clears the log, so the cap does not matter here.
  const logStore = HM.log.createLogStore(store, {});
  function getLogStore() { return Promise.resolve(logStore); }

  // Latest copies, kept so click handlers can act synchronously (Chrome only grants
  // a host permission from inside the click itself).
  const state = { user: HM.store.emptyUser(), settings: HM.settings.sanitize({}), lists: [], log: [], investigator: {} };

  // The status line. A routine message fades after 6 s; a problem (fail) stays until the next
  // action; an undo offer (offerUndo) stays 8 s. Every call replaces the one before.
  let statusTimer = null;
  const OK_MS = 6000;
  const UNDO_MS = 8000;
  function status(text, ms = OK_MS) {
    const el = $('status');
    clearTimeout(statusTimer);
    statusTimer = null;
    if (!el) return;
    el.textContent = text || '';
    if (text && ms) statusTimer = setTimeout(() => { el.textContent = ''; statusTimer = null; }, ms);
  }
  const fail = text => status(text, 0);
  // "Removed X. Undo": the button runs undo once, then the line clears.
  function offerUndo(text, undo) {
    status(text + ' ', UNDO_MS);
    const el = $('status');
    if (!el) return;
    const b = node('button', { class: 'undo-btn', textContent: 'Undo' });
    b.addEventListener('click', () => { b.disabled = true; status(''); Promise.resolve().then(undo).catch(() => fail('Could not undo that.')); });
    el.append(b);
  }

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

  // A small icon button (refresh: a circular arrow; remove: a cross), named for screen readers.
  const ICONS = {
    refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z',
    remove: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  };
  function iconButton(kind, label, onclick) {
    const b = node('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick });
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', ICONS[kind]); svg.append(path);
    b.append(svg);
    return b;
  }

  const READ_FAILED = 'Could not read your saved data, so nothing was changed. Try again.';

  // A failed read keeps the last copy on screen and says so: an empty answer must never stand
  // in for the person's lists (the next edit would have written it over them).
  async function load() {
    let r;
    try { r = (await store.get([HM.store.KEYS.user, HM.store.KEYS.settings, HM.store.KEYS.filterLists, HM.store.KEYS.investigator])) || {}; } catch (e) {
      fail('Could not read your saved data. What shows may be out of date.');
      return false;
    }
    state.user = { ...HM.store.emptyUser(), ...(r[HM.store.KEYS.user] || {}) };
    state.settings = HM.settings.sanitize(r[HM.store.KEYS.settings]);
    state.lists = listsFrom(r[HM.store.KEYS.filterLists]);
    try {
      state.log = await (await getLogStore()).readAll();
    } catch (e) {
      state.log = [];
    }
    const inv = r[HM.store.KEYS.investigator];
    state.investigator = inv && typeof inv === 'object' ? inv : {};
    return true;
  }
  function listsFrom(stored) {
    const lists = Array.isArray(stored) ? stored : [];
    return lists.some(l => l.id === HM.lists.SOUL_OVER_AI.id) ? lists : [{ ...HM.lists.SOUL_OVER_AI }, ...lists];
  }

  // Every edit reads what is stored right now, changes that, and writes it back, one edit at a
  // time. The popup's own copy (state) is only for drawing. A failed read or write changes
  // nothing and says so. Resolves to the new value, or null.
  let queue = Promise.resolve();
  // The read-write itself is HM.store.modify: it takes the key's Web Lock, so another open
  // popup, the worker and the music page's Block artist button queue behind it too.
  function edit(key, normalize, change, apply) {
    const run = queue.then(async () => {
      let next;
      try {
        next = await HM.store.modify(store, key, cur => normalize(change(normalize(cur))));
      } catch (e) {
        fail(e && e.stage === 'read' ? READ_FAILED : e && e.stage === 'change' ? e.message : 'Could not save that change.');
        return null;
      }
      apply(next);
      return next;
    });
    queue = run.catch(() => {});
    return run;
  }
  const editUser = change => edit(HM.store.KEYS.user, u => ({ ...HM.store.emptyUser(), ...(u || {}) }), change, u => { state.user = u; });
  const editSettings = change => edit(HM.store.KEYS.settings, s => HM.settings.sanitize(s), change, s => { state.settings = s; });
  const editLists = change => edit(HM.store.KEYS.filterLists, listsFrom, change, l => { state.lists = l; });

  // --- tabs --------------------------------------------------------------------

  // A tablist (review 2026-11-17): the open tab is aria-selected and the only one in the Tab
  // order; Left and Right move between tabs, as screen-reader users expect.
  const tabButtons = [...document.querySelectorAll('.tab')];
  function openTab(btn) {
    for (const b of tabButtons) {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      if (on) b.removeAttribute('tabindex'); else b.setAttribute('tabindex', '-1');
    }
    for (const c of document.querySelectorAll('.tab-content')) c.classList.toggle('active', c.id === 'tab-' + btn.dataset.tab);
  }
  for (const btn of tabButtons) {
    btn.addEventListener('click', () => openTab(btn));
    btn.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = tabButtons.indexOf(btn);
      const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length];
      openTab(next);
      next.focus();
    });
  }

  // --- Lists tab: filter lists ------------------------------------------------------

  function when(ms) {
    if (!ms) return 'never';
    try { return new Date(ms).toLocaleString(); } catch (e) { return 'never'; }
  }

  function updateList(id, change) {
    return editLists(ls => ls.map(l => (l.id === id ? { ...l, ...change } : l)));
  }

  // after: what to say once the refresh worked (a newly added list says how it starts).
  function refreshList(id, after = 'List refreshed.') {
    status('Refreshing…', 0);
    try {
      chrome.runtime.sendMessage({ type: 'refresh', id }, ok => {
        // A worker that isn't running ("No SW", just after a reload or update) leaves lastError
        // set; reading it keeps Chrome from listing an unchecked error. It counts as a failure.
        const failed = !!chrome.runtime.lastError;
        if (ok && !failed) status(after); else fail('Could not refresh that list; the last good copy is kept.');
      });
    } catch (e) { fail('Could not refresh that list; the last good copy is kept.'); }
  }

  // Remove a list. The record goes first, under its lock, so a refresh in flight can no longer
  // find it (the worker writes a list's data only while its record exists: no orphan copy, and
  // no resurrected list). Then its downloaded copy (up to 5 MB) goes, so adding the same address
  // later starts clean. If that fails the record is put back: the list stays in view to try again.
  async function removeList(list) {
    try { HM.popup.removeFilterList(state.lists, list.id); } catch (e) { fail(e.message); return; }
    let record = null;
    let at = 0;
    const next = await editLists(ls => {
      at = ls.findIndex(l => l.id === list.id);
      if (at < 0) return ls;
      record = ls[at];
      return HM.popup.removeFilterList(ls, list.id);
    });
    if (!next || !record) return;
    const putBack = () => editLists(ls => (ls.some(l => l.id === record.id) ? ls : ls.toSpliced(Math.min(at, ls.length), 0, record)));
    try { await store.remove(HM.store.listKey(list.id)); } catch (e) {
      await putBack();
      fail('Could not remove that list. Try again.');
      return;
    }
    offerUndo(`Removed ${list.name}.`, async () => {
      // Its saved copy is gone, so it comes back from a fresh download.
      const back = await putBack();
      if (back) refreshList(list.id, `Restored ${list.name}.`);
    });
  }

  function renderFilterLists() {
    const ul = $('filter-lists');
    clear(ul);
    const now = Date.now();
    // Largest list first (Wai, 2026-11-19: "order them by list size in the popup"); equal sizes
    // keep their stored order.
    const bySize = state.lists.toSorted((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
    for (const list of bySize) {
      const on = node('input', {
        type: 'checkbox', checked: !!list.enabled, title: 'On or off', 'aria-label': `${list.name} on`,
        onchange: () => {
          if (!on.checked) { updateList(list.id, { enabled: false }); return; }
          updateList(list.id, { enabled: true, held: null });
          refreshList(list.id);
        },
      });
      const count = (list.count || 0).toLocaleString('en');
      const updated = list.lastRefresh ? `updated ${HM.popup.timeLabel(list.lastRefresh, now)}` : 'not updated yet';
      // Refresh and Remove are icons in the top row (Wai, 2026-11-19: "make refresh an icon on
      // the topright to compact the empty space").
      ul.append(node('li', { class: 'list-row' },
        node('div', { class: 'list-main' }, on, node('span', { class: 'list-name', textContent: list.name }),
          list.builtIn ? node('span', { class: 'chip', textContent: 'Built in' }) : null,
          iconButton('refresh', `Refresh ${list.name}`, () => refreshList(list.id)),
          list.builtIn ? null : iconButton('remove', `Remove ${list.name}`,
            () => removeList(list))),
        node('div', { class: 'list-info' }, `${count} ${list.count === 1 ? 'artist' : 'artists'} · ${updated}`,
          list.lastError ? node('span', { class: 'error', textContent: `Last update failed: ${HM.popup.plainError(list.lastError)}` }) : null,
          list.held && !list.enabled ? node('span', { class: 'error', textContent: `Switched off: ${list.held.reason}` }) : null)));
    }
    const freq = $('refresh-frequency');
    if (freq) freq.value = state.settings.refresh;
  }

  $('add-list-btn').addEventListener('click', () => {
    const url = $('list-url').value.trim();
    const name = $('list-name').value;
    let added = null;
    editLists(ls => { const next = HM.popup.addFilterList(ls, url, name); added = next[next.length - 1]; return next; }).then(lists => {
      if (!lists) return;
      const said = `Added ${added.name}. Switch it off in its row if it skips something you want.`;
      refreshList(added.id, said);
      $('list-url').value = '';
      $('list-name').value = '';
      status(said);
    });
  });

  $('refresh-frequency').addEventListener('change', e => { const value = e.target.value; editSettings(s => ({ ...s, refresh: value })); });

  // --- Lists tab: your lists --------------------------------------------------------

  const USER_LISTS = [
    { kind: 'artists', ul: 'artists', heading: 'Your artists' },
    { kind: 'songs', ul: 'songs', heading: 'Your songs' },
    { kind: 'keywords', ul: 'keywords', heading: 'Your keywords' },
    { kind: 'neverSkip', ul: 'never-skip', heading: 'Never skip' },
  ];

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  async function removeEntry(kind, entry, text) {
    let gone = false;
    let at = -1;
    const next = await editUser(u => {
      at = (u[kind] || []).findIndex(x => same(x, entry));
      gone = at >= 0;
      return gone ? HM.popup.removeEntry(u, kind, at) : u;
    });
    if (!next || !gone) return;
    offerUndo(`Removed ${text}.`, () => editUser(u => {
      const list = u[kind] || [];
      return list.some(x => same(x, entry)) ? u : { ...u, [kind]: list.toSpliced(Math.min(at, list.length), 0, entry) };
    }));
  }

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
          node('button', { textContent: 'Remove', onclick: () => removeEntry(kind, entry, text) })));
      });
    }
  }

  const INPUTS = { artists: 'artist-input', keywords: 'keyword-input', neverSkip: 'never-skip-input' };
  for (const btn of document.querySelectorAll('.add-entry-btn')) {
    const kind = btn.dataset.kind;
    const input = $(INPUTS[kind]);
    const add = () => { const value = input.value; input.value = ''; editUser(u => HM.popup.addEntry(u, kind, value)); };
    btn.addEventListener('click', add);
    // Not while an IME is composing (Chinese, Japanese, Korean input): that Enter picks the
    // characters, and adding then saved half a name (Modern Web Guidance scan, 2026-11-23).
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) add(); });
  }
  $('add-song-btn').addEventListener('click', () => {
    const title = $('song-title').value;
    const artist = $('song-artist').value;
    $('song-title').value = '';
    $('song-artist').value = '';
    editUser(u => HM.popup.addSong(u, title, artist));
  });

  // --- Lists tab: backup -------------------------------------------------------------

  function download(name, type, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = node('a', { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { fail('Could not save the file.'); }
  }

  let pendingImport = null;

  $('export-btn').addEventListener('click', () => {
    const backup = HM.lists.exportBackup({ user: state.user, settings: state.settings, filterLists: state.lists });
    download('human-music-backup.json', 'application/json', JSON.stringify(backup, null, 2));
  });

  $('import-btn').addEventListener('click', async () => {
    const file = $('import-file').files && $('import-file').files[0];
    if (!file) { fail('Choose a backup file first.'); return; }
    let data;
    try {
      data = HM.lists.importBackup(JSON.parse(await file.text()));
    } catch (e) {
      fail(e instanceof SyntaxError ? 'That file is not a backup (it is not JSON).' : e.message);
      return;
    }
    const changes = HM.popup.importChanges({ settings: state.settings, filterLists: state.lists }, data);
    if (changes.length === 0) {
      await applyImport(data);
      return;
    }
    pendingImport = data;
    const box = $('import-confirm');
    const list = $('import-changes');
    clear(list);
    for (const change of changes) {
      list.append(node('li', { textContent: change }));
    }
    box.hidden = false;
  });

  $('import-apply').addEventListener('click', () => {
    if (pendingImport) {
      applyImport(pendingImport).then(() => { $('import-confirm').hidden = true; });
    }
  });

  $('import-cancel').addEventListener('click', () => {
    pendingImport = null;
    $('import-confirm').hidden = true;
    status('Nothing imported.');
  });

  async function applyImport(data) {
    const u = data.user;
    const apply = (u, s, l) => HM.lists.applyBackup({ user: u, settings: s, filterLists: l }, data);
    await editUser(cur => apply(cur, state.settings, state.lists).user);
    if (data.settings) await editSettings(s => apply(state.user, s, state.lists).settings);
    if (data.filterLists) await editLists(l => apply(state.user, state.settings, l).filterLists);
    pendingImport = null;
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    status(`Imported ${n(u.artists.length, 'artist', 'artists')}, ${n(u.songs.length, 'song', 'songs')}, ${n(u.keywords.length, 'keyword', 'keywords')} and ${n(u.neverSkip.length, 'never-skip artist', 'never-skip artists')}.`);
  }

  // --- Behaviour tab ------------------------------------------------------------------

  const TOGGLES = { 'auto-skip': 'autoSkip', 'auto-dislike': 'autoDislike', 'hide-items': 'hidePageItems', 'player-buttons': 'playerButtons', 'plain-pages': 'plainPages' };

  function renderSettings() {
    // Not while you're typing in it (review 2026-11-17: a log write reset a half-typed number).
    if (document.activeElement !== $('lookahead')) $('lookahead').value = String(state.settings.lookahead);
    for (const [id, key] of Object.entries(TOGGLES)) $(id).checked = !!state.settings[key];
  }

  // --- Filtering mode slider (header) ---------------------------------------------------------
  // Four stops on one track, like uBlock Origin's blocking-mode slider. Optimal and Aggressive
  // need a calibrated verdict list; until then a move to either lands on List only.

  const MODE_NAMES = { off: 'No filtering', lists: 'List only', optimal: 'Optimal', aggressive: 'Aggressive' };
  // The header line under the name: what each level blocks and how often it may skip a person
  // (Wai, 2026-11-24: "a quick 1-line desc of blocking level and risk", updated as the slider moves).
  const MODE_LINES = {
    off: 'Nothing skipped. AI-generated songs play.',
    lists: 'Listed artists only. Almost never skips people.',
    optimal: 'Adds artists sure to be AI. Rarely skips people.',
    aggressive: 'Adds likely AI artists. Sometimes skips people.',
  };
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
    showModeLine(mode);
  }

  function showModeLine(mode) {
    const el = $('today');
    if (!el) return;
    el.textContent = MODE_LINES[mode] || '';
    el.title = el.textContent;
    el.classList.toggle('paused', mode === 'off');
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
      fail(`${MODE_NAMES[mode]} is not ready yet, so List only stays on until the verdict list is checked.`);
      showMode(HM.settings.effectiveMode(state.settings, verdictsCalibrated()));
      return;
    }
    status('');
    showMode(mode);
    editSettings(s => ({ ...s, mode, modeChosen: true, paused: mode === 'off' }));
  });

  // --- Investigator (development copies only) ---------------------------------------------------
  // Hidden unless the worker says this is a development install; store copies never show it.

  function renderInvestigator() {
    // No secret store (or a failed read) means no key saved.
    Promise.resolve().then(() => (HM.secrets ? HM.secrets.get('investigator-token') : null)).catch(() => null).then(saved => {
      const inv = state.investigator;
      const bits = [saved ? 'A key is saved.' : 'No key saved.'];
      if (typeof inv.lastSentAt === 'number') bits.push(`Last sent ${HM.popup.timeLabel(inv.lastSentAt, Date.now())}.`);
      if (inv.lastError) bits.push(`Last error: ${HM.popup.plainError(inv.lastError)}`);
      const el = $('investigator-status');
      if (el) el.textContent = bits.join(' ');
    });
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
    // The key goes to the extension's own IndexedDB (HM.secrets), never to storage the music
    // pages can read. The stored record is edited through the popup's one-at-a-time queue
    // (fresh read, keep the worker's sent record, last error and last send), with any old key
    // field removed.
    edit(HM.store.KEYS.investigator, v => (v && typeof v === 'object' ? v : {}),
      cur => {
        const next = { ...cur, base: typeof cur.base === 'string' ? cur.base : 'https://wai-lau.net/human-music', sent: cur.sent && typeof cur.sent === 'object' ? cur.sent : {} };
        delete next.token;
        return next;
      },
      next => { state.investigator = next; })
      .then(next => (next ? (token ? HM.secrets.set('investigator-token', token) : HM.secrets.remove('investigator-token')).then(() => next) : null))
      .then(next => {
        if (!next) return;
        renderInvestigator();
        status(token ? 'A key is saved.' : 'The key is removed.');
      })
      .catch(() => { fail('Could not save the key.'); });
    editSettings(s => ({ ...s, investigate: !!token }));
  });

  $('lookahead').addEventListener('change', e => { const value = e.target.value; editSettings(s => ({ ...s, lookahead: value })); });
  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).addEventListener('change', e => { const on = !!e.target.checked; editSettings(s => ({ ...s, [key]: on })); });
  }

  // --- Log tab --------------------------------------------------------------------------

  // Three sections (Wai, 2026-11-15): Blocked, Actions, Errors; grouped by artist so the
  // artist, the reason and "Always play" each show once.
  const SECTION_HINTS = {
    blocks: 'Kept from playing: taken out of the queue or hidden on a page.',
    actions: 'Done while a song played: skipped or disliked.',
    errors: 'What didn’t work. The song played on.',
  };
  const EMPTY = { blocks: 'Nothing blocked yet.', actions: 'Nothing done yet.', errors: 'No errors.' };
  const SHOWN = 60; // artist groups shown; Export log has everything
  let section = null; // chosen section; until then, the section of the newest entry
  const expanded = new Set(); // artist groups unfolded in this popup

  function listErrors() {
    return state.lists.filter(l => l.enabled && l.lastError);
  }
  function listHeld() {
    return state.lists.filter(l => !l.enabled && l.held);
  }

  function renderToday() {
    // Not while the slider is held: its own input events show the level being dragged to.
    if (document.activeElement === $('mode')) return;
    showModeLine(state.settings.paused ? 'off' : HM.settings.effectiveMode(state.settings, verdictsCalibrated()));
  }

  function renderLog() {
    const counts = HM.popup.sectionCounts(state.log);
    counts.errors += listErrors().length + listHeld().length;
    if (!section) section = state.log.length ? HM.log.section(state.log[0].event) : (counts.errors ? 'errors' : 'blocks');
    for (const btn of document.querySelectorAll('.seg-btn')) {
      const k = btn.dataset.section;
      btn.classList.toggle('active', k === section);
      btn.setAttribute('aria-pressed', String(k === section));
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
          node('div', { class: 'log-reason error', textContent: `List update failed: ${HM.popup.plainError(l.lastError)}` })));
      }
      for (const l of listHeld()) {
        ul.append(node('li', { class: 'log-group' },
          node('div', { class: 'log-head' }, node('span', { class: 'log-artist', textContent: l.name }), node('span', { class: 'log-time', textContent: l.held ? `held ${HM.popup.timeLabel(l.held.at, now)}` : '' })),
          node('div', { class: 'log-reason error', textContent: `${l.name} was switched off: ${l.held.reason}` })));
      }
    }
    const groups = HM.popup.groupLog(state.log, { now, section, neverSkip: state.user.neverSkip });
    if (!groups.length && !(section === 'errors' && (listErrors().length || listHeld().length))) {
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
        'data-focus': `log|${key}`,
        onclick: () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); keepFocus(renderLog); },
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
              editUser(u => HM.popup.addEntry(u, 'neverSkip', g.artist));
              status(`${g.artist} will always show.`);
            } else {
              const N = HM.text.normalize;
              editUser(u => {
                const i = (u.neverSkip || []).findIndex(n => N(n) === N(g.artist));
                return i >= 0 ? HM.popup.removeEntry(u, 'neverSkip', i) : u;
              });
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

  $('clear-log').addEventListener('click', () => {
    getLogStore().then(s => s.clear()).then(() => status('Log cleared.'), () => fail('Could not clear the log. Try again.'));
  });
  $('export-log').addEventListener('click', () => {
    const lines = state.log.map(e => [when(e.at), HM.log.describe(e), e.title, e.artistLine, e.entry ? `entry: ${e.entry}` : ''].filter(Boolean).join('\t'));
    download('human-music-log.txt', 'text/plain', lines.join('\n') + '\n');
  });

  // --- start and live updates -------------------------------------------------------------

  function renderAll() { renderFilterLists(); renderUserLists(); renderSettings(); renderMode(); renderInvestigator(); renderToday(); renderLog(); }

  // A redraw puts keyboard focus back on the same control (review 2026-11-17: it fell out of
  // the popup on every redraw). Controls are found again by id, data-focus or aria-label.
  function keepFocus(render) {
    const a = document.activeElement;
    const k = a && a !== document.body && a.getAttribute
      ? { id: a.id || '', tag: (a.tagName || '').toLowerCase(), focus: a.getAttribute('data-focus'), label: a.getAttribute('aria-label') }
      : null;
    render();
    if (!k || (document.activeElement && document.activeElement !== document.body)) return;
    let el = k.id ? $(k.id) : null;
    if (!el && k.tag && (k.focus || k.label)) {
      el = [...document.querySelectorAll(k.tag)].find(e => (k.focus ? e.getAttribute('data-focus') === k.focus : e.getAttribute('aria-label') === k.label)) || null;
    }
    if (el && typeof el.focus === 'function') el.focus();
  }

  // Only the sections whose data changed are drawn again: a tab logs songs all the time, and
  // that must not rebuild the lists you are working in.
  const SECTIONS = [
    [k => k === HM.store.KEYS.log || k.startsWith('hm.log'), [renderToday, renderLog]],
    [k => k === HM.store.KEYS.user, [renderUserLists, renderLog]],
    [k => k === HM.store.KEYS.settings, [renderSettings, renderMode, renderInvestigator, renderLog]],
    [k => k === HM.store.KEYS.filterLists || k.startsWith('hm.list.'), [renderFilterLists, renderMode, renderLog]],
    [k => k === HM.store.KEYS.investigator, [renderInvestigator]],
  ];
  function renderFor(keys) {
    const todo = new Set();
    for (const k of keys) {
      const hit = SECTIONS.find(([is]) => is(k));
      if (!hit) return renderAll; // a key this list doesn't know: draw everything
      for (const fn of hit[1]) todo.add(fn);
    }
    return () => { for (const fn of todo) fn(); };
  }

  const onChanged = (api.storage && api.storage.onChanged) || store.onChanged;
  if (onChanged) {
    onChanged.addListener((changes, area) => {
      if (area && area !== 'local') return;
      const keys = Object.keys(changes).filter(k => k.startsWith('hm.'));
      if (!keys.length) return;
      const render = renderFor(keys);
      load().then(ok => { if (ok !== false) keepFocus(render); });
    });
  }

  load().then(renderAll);
})();
