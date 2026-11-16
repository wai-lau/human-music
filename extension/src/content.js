// Content script on music.youtube.com: wires the core modules to the page.
// One MutationObserver schedules a pass (at most one pending, 50 ms later):
// check the playing song, run lookahead, hide page items, keep the player buttons.
// Anything that throws leaves the song playing.
(function () {
  'use strict';
  const HM = (globalThis.HM = globalThis.HM || {});

  const rebuilds = key => key === HM.store.KEYS.user || key === HM.store.KEYS.settings || key === HM.store.KEYS.filterLists || key.startsWith(HM.store.listPrefix);
  const rowKey = row => `${row.title}\n${row.artistLine}`;
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };

  // alive() turns false once this copy's extension is reloaded or removed: its chrome APIs
  // stop working while its page code keeps running. It then stands down (stops watching,
  // removes its buttons) so the fresh copy injected into the tab is the only one acting.
  // The page adapter for the site this page is on: HM.spotify on open.spotify.com,
  // HM.ytm (YouTube Music) otherwise. Both have the same shape.
  function siteFor(doc) {
    const host = safe(() => doc.location.hostname, '') || '';
    if (/(^|\.)open\.spotify\.com$/.test(host) && HM.spotify) return HM.spotify;
    return HM.ytm;
  }

  // The shape the skipper drives, bound to this page.
  function pageFor(site, doc) {
    return {
      readSong: () => site.readSong(doc),
      clickNext: () => site.clickNext(doc),
      pressNextKey: () => site.pressNextKey(doc),
      clickDislike: () => site.clickDislike(doc),
      videoDuration: () => site.videoDuration(doc),
      videoState: () => (site.videoState ? site.videoState(doc) : null),
      seekTo: seconds => site.seekTo(doc, seconds),
    };
  }

  function createApp({ doc, storage, timers, now, alive = () => true, site = siteFor(doc), onCount = () => {} }) {
    const state = {
      settings: HM.settings.sanitize({}),
      index: null,
      last: null, // { title, artistLine } of the song checked last
      lookaheadRunning: false,
      passTimer: null,
      skipper: null,
      observer: null,
      stopped: false,
      passes: 0, // passes run so far (shown in development status)
      // Sites that draw their queue only in a panel (Spotify):
      queueSeenOpen: false, // the panel was seen open at least once
      queueRefused: false, // seen open, then found closed: the person closed it; leave it
      queueTries: 0, // clicks on the queue button so far (at most 3)
      queueTriedAt: -Infinity, // when the last click was
      checkedFor: '', // the song whose upcoming rows lookahead has seen
      lastChanceFor: '', // the song the near-the-end check already opened the panel for
      closeAfterCheck: false, // close the panel again once its rows were seen
      skipMatch: null, // the match behind the skip in progress (for a skip-failed log line)
    };
    let writes = Promise.resolve();

    const matchSong = song => (state.index ? safe(() => HM.match.matchSong(state.index, song), null) : null);

    // Storage writes run one after another, so two quick ones never lose each other.
    function queueWrite(fn) {
      writes = writes.then(fn).catch(() => {});
      return writes;
    }

    // The toolbar count: songs skipped or removed from the queue in this tab (Wai,
    // 2026-11-13: "where 1 is the number of songs skipped or blocked").
    const COUNTED = new Set(['skipped', 'disliked', 'removed']);
    let count = 0;

    function log(event, song, match, { oncePerDay = false } = {}) {
      if (COUNTED.has(event)) { count++; safe(() => onCount(count)); }
      const entry = HM.log.makeEntry({ event, song, match, at: now() });
      return queueWrite(async () => {
        const stored = await storage.get(HM.store.KEYS.log);
        const entries = Array.isArray(stored[HM.store.KEYS.log]) ? stored[HM.store.KEYS.log] : [];
        if (oncePerDay && HM.log.seenRecently(entries, entry, entry.at)) return;
        await storage.set({ [HM.store.KEYS.log]: HM.log.append(entries, entry, 1000) });
      });
    }

    async function reload() {
      const stored = await storage.get([HM.store.KEYS.user, HM.store.KEYS.settings, HM.store.KEYS.filterLists]);
      state.settings = HM.settings.sanitize(stored[HM.store.KEYS.settings]);
      const user = { ...HM.store.emptyUser(), ...(stored[HM.store.KEYS.user] || {}) };
      const lists = Array.isArray(stored[HM.store.KEYS.filterLists]) ? stored[HM.store.KEYS.filterLists] : [];
      const keys = lists.map(l => HM.store.listKey(l.id));
      const data = keys.length ? await storage.get(keys) : {};
      state.index = HM.match.buildIndex({
        filterLists: lists.map(l => ({ ...l, artists: (data[HM.store.listKey(l.id)] || {}).artists || [] })),
        user,
      });
    }

    // --- the playing song ---------------------------------------------------------

    // Only the tab whose video is actually playing acts on the playing song: pressing Next in
    // a paused YouTube Music tab would start music there too (Wai: "find the tab that's
    // actually playing audio"). A paused tab is checked again on a later pass.
    function videoPlaying() {
      const v = safe(() => site.videoState(doc), null);
      return !v || !v.paused; // no video element at all: nothing to tell, act as before
    }

    function checkPlaying() {
      if (state.settings.paused) return;
      const song = safe(() => site.readSong(doc), null);
      if (!song) return;
      if (state.last && state.last.title === song.title && state.last.artistLine === song.artistLine) return;
      if (!videoPlaying()) return; // not remembered yet, so the song is checked once it plays
      // A skip still finishing (its poll sees the new song within 100 ms) would refuse this
      // one, so a listed song straight after a skipped one played on (Wai, 2026-11-13: "when
      // there are multiple songs in a row, it just stop skipping"). Not remembered yet: look
      // again shortly, once the player shows the new song in full.
      if (safe(() => state.skipper.busy(), false)) { safe(() => timers.setTimeout(schedule, 200)); return; }
      state.last = { title: song.title, artistLine: song.artistLine };
      const match = matchSong(song);
      if (!match) return;
      if (match.mode === 'watch') { log('watched', song, match); return; }
      if (!state.settings.autoSkip) { log('seen', song, match); return; }
      state.skipMatch = match; // named in the log if this skip doesn't take
      safe(() => state.skipper.skip({ dislikeFirst: state.settings.autoDislike }));
      log(state.settings.autoDislike ? 'disliked' : 'skipped', song, match);
    }

    // --- lookahead ----------------------------------------------------------------------

    // Removing a row opens its menu, which takes keyboard focus: never while the person is
    // typing (search box, any text field). A later pass removes it; auto-skip still covers it.
    function typing() {
      return safe(() => {
        const a = doc.activeElement;
        return !!a && (a.localName === 'input' || a.localName === 'textarea' || a.isContentEditable === true);
      }, false);
    }

    // Sites that draw their queue only in a panel (Spotify): open it once while a song is
    // loaded (Wai, 2026-11-13: "yes"). If the person closes it, leave it closed for good
    // on this page: Human Music never fights them over it.
    // A click before the page is ready opens nothing, so only a panel seen open and then
    // found closed counts as the person closing it; until it opens, try at most 3 times,
    // 2 s apart (checked live: the first click on a fresh page did nothing).
    function showQueue() {
      if (!site.openQueue || !site.queueOpen || state.queueRefused) return;
      if (safe(() => site.queueOpen(doc), true)) { state.queueSeenOpen = true; return; }
      if (state.queueSeenOpen) { state.queueRefused = true; return; } // closed by the person
      if (!safe(() => site.readSong(doc), null)) return;
      const t = now();
      if (state.queueTries >= 3 || t - state.queueTriedAt < 2000) return;
      state.queueTries += 1;
      state.queueTriedAt = t;
      safe(() => site.openQueue(doc));
      timers.setTimeout(schedule, 2100); // look again once the next try is allowed
    }

    const songKey = song => (song ? `${song.title}\n${song.artistLine}` : '');

    // Last chance before the next song (Wai, 2026-11-13: "Try reopening the queue panel
    // again when the song is about to end and the next queue is not open and ... the
    // lookahead has not happened yet"). With 15 s or less left, the panel closed and the
    // upcoming songs not yet seen during this song, open the panel once for this song; if
    // the person had closed it, close it again after the check.
    const LAST_CHANCE_S = 15;
    function lastChance() {
      if (!site.openQueue || !site.queueOpen || !site.timeLeft) return;
      const key = songKey(safe(() => site.readSong(doc), null));
      if (!key || state.checkedFor === key || state.lastChanceFor === key) return;
      const left = safe(() => site.timeLeft(doc), NaN);
      if (!(left > 0 && left <= LAST_CHANCE_S)) return;
      if (safe(() => site.queueOpen(doc), true)) return;
      state.lastChanceFor = key;
      state.closeAfterCheck = !!state.queueRefused;
      safe(() => site.openQueue(doc));
      timers.setTimeout(schedule, 600); // check as soon as the panel has drawn
    }

    async function runLookahead() {
      if (state.settings.paused || !state.settings.lookahead || state.lookaheadRunning || typing()) return;
      showQueue();
      lastChance();
      state.lookaheadRunning = true;
      const failed = new Set();
      try {
        for (let guard = 0; guard < 50; guard++) {
          // Re-read every time: removing a row shifts the rows after it.
          const rows = safe(() => site.readQueue(doc), []);
          if (rows.length > 1) state.checkedFor = songKey(rows.find(r => r.selected) || null) || state.checkedFor;
          const { remove, watched } = HM.lookahead.pickRemovals(rows, state.settings.lookahead,
            row => (failed.has(rowKey(row)) ? null : matchSong(row)));
          for (const w of watched) log('watched', rows[w.index], w.match, { oncePerDay: true });
          if (!remove.length || typing()) break;
          const row = rows[remove[0]];
          const match = matchSong(row);
          const removed = await Promise.resolve(safe(() => site.removeQueueRow(doc, row), false)).catch(() => false);
          if (removed) log('removed', row, match);
          else { failed.add(rowKey(row)); log('remove-failed', row, match, { oncePerDay: true }); }
        }
      } finally {
        state.lookaheadRunning = false;
        // A last-chance panel the person had closed goes away again once its rows were seen.
        if (state.closeAfterCheck && site.closeQueue && state.checkedFor === state.lastChanceFor) {
          state.closeAfterCheck = false;
          safe(() => site.closeQueue(doc));
        }
      }
    }

    // --- page items -----------------------------------------------------------------------

    function hidePass() {
      if (state.settings.paused || !state.settings.hidePageItems || !state.index) return;
      const path = safe(() => doc.location.pathname, '');
      for (const item of safe(() => site.readPageItems(doc, path), [])) {
        if (safe(() => item.el.hasAttribute('data-hm-hidden'), true)) continue;
        const match = safe(() => HM.match.matchItem(state.index, item), null);
        if (!match || match.mode !== 'act') continue;
        site.hideItem(item.el);
        log('hidden', { title: item.title, artistLine: item.credits.join(', ') }, match, { oncePerDay: true });
      }
    }

    // Song rows that stay on the page and would be skipped look unavailable, with the skip
    // glyph. Every pass looks at every row: YouTube Music reuses a row for another song.
    function markPass() {
      if (!site.readListRows || !site.markRow || !site.unmarkRow) return;
      const on = !state.settings.paused && state.settings.autoSkip && !!state.index;
      for (const item of safe(() => site.readListRows(doc), [])) {
        const match = on ? safe(() => HM.match.matchItem(state.index, item), null) : null;
        const should = !!(match && match.mode === 'act');
        const is = safe(() => item.el.hasAttribute('data-hm-marked'), false);
        if (should && !is) safe(() => site.markRow(item.el, doc));
        else if (!should && is) safe(() => site.unmarkRow(item.el));
      }
    }

    // --- player buttons -----------------------------------------------------------------

    function block(kind) {
      const song = safe(() => site.readSong(doc), null);
      if (!song) return;
      const credit = HM.text.leadCredit(song.artistLine);
      const N = HM.text.normalize;
      queueWrite(async () => {
        const stored = await storage.get(HM.store.KEYS.user);
        const user = { ...HM.store.emptyUser(), ...(stored[HM.store.KEYS.user] || {}) };
        if (kind === 'artist') {
          if (!credit || user.artists.some(a => N(a) === N(credit))) return;
          user.artists = [...user.artists, credit];
        } else {
          const artist = HM.text.splitNames(credit)[0] || null;
          if (user.songs.some(s => N(s.title) === N(song.title) && N(s.artist || '') === N(artist || ''))) return;
          user.songs = [...user.songs, { title: song.title, artist }];
        }
        await storage.set({ [HM.store.KEYS.user]: user });
      });
    }

    // Each copy tags the button it mounts; a button left by an earlier copy (cut off by a
    // reload, its clicks going nowhere) is replaced at once.
    const copyId = Math.random().toString(36).slice(2, 10);

    function playerButtons() {
      if (state.settings.playerButtons && !state.settings.paused) {
        const old = safe(() => doc.querySelector('#hm-player-buttons'), null);
        if (old && old.getAttribute('data-hm-copy') !== copyId) safe(() => old.remove());
        safe(() => site.mountPlayerButtons(doc, { onBlockArtist: () => block('artist') }));
        const box = safe(() => doc.querySelector('#hm-player-buttons'), null);
        if (box && !box.hasAttribute('data-hm-copy')) safe(() => box.setAttribute('data-hm-copy', copyId));
      } else {
        const box = safe(() => doc.querySelector('#hm-player-buttons'), null);
        if (box) box.remove();
      }
    }

    // --- passes ---------------------------------------------------------------------------

    function standDown() {
      state.stopped = true;
      safe(() => state.observer && state.observer.disconnect());
      if (state.passTimer != null) safe(() => timers.clearTimeout(state.passTimer));
      state.passTimer = null;
      const box = safe(() => doc.querySelector('#hm-player-buttons'), null);
      if (box) safe(() => box.remove());
    }

    function pass() {
      state.passTimer = null;
      state.passes += 1;
      if (state.stopped) return;
      if (!safe(alive, false)) { standDown(); return; }
      safe(checkPlaying);
      safe(() => runLookahead().catch(() => {}));
      safe(hidePass);
      safe(markPass);
      safe(playerButtons);
    }

    function schedule() {
      if (!state.stopped && state.passTimer == null) state.passTimer = timers.setTimeout(pass, 50);
    }

    async function start() {
      safe(() => onCount(0));
      try { await reload(); } catch (e) { /* no lists yet: nothing matches */ }
      state.skipper = HM.skipper.createSkipper({
        page: pageFor(site, doc),
        setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval, clearInterval: timers.clearInterval,
        onGiveUp: song => log('skip-failed', song, state.skipMatch),
      });
      storage.onChanged.addListener((changes, area) => {
        if (area && area !== 'local') return;
        if (!Object.keys(changes).some(rebuilds)) return; // hm.log alone changes nothing
        reload().then(() => {
          state.last = null; // check the playing song again against the new lists
          safe(() => site.unhideAll(doc)); // shown again unless it still matches
          schedule();
        }).catch(() => {});
      });
      safe(() => {
        const Observer = doc.defaultView.MutationObserver;
        state.observer = new Observer(schedule);
        state.observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      });
      pass();
    }

    // Resolves once every queued storage write has finished.
    async function flush() {
      let seen;
      do { seen = writes; await seen; } while (seen !== writes);
    }

    // Development aid: a small summary of this copy's state.
    function status() {
      return { passes: state.passes, stopped: state.stopped, lists: !!state.index, observing: !!state.observer, settings: state.settings };
    }

    return { start, checkPlaying, runLookahead, flush, status };
  }

  HM.createApp = createApp;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && !HM.app) {
    const api = HM.store.api();
    HM.app = createApp({
      doc: document,
      storage: api.storage.local,
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: id => clearTimeout(id),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: id => clearInterval(id),
      },
      now: () => Date.now(),
      alive: () => !!(chrome.runtime && chrome.runtime.id),
      // The worker puts this tab's count on the toolbar icon.
      onCount: count => {
        try {
          const sent = chrome.runtime.sendMessage({ type: 'hm-count', count });
          if (sent && typeof sent.catch === 'function') sent.catch(() => {});
        } catch (e) { /* cut off */ }
      },
    });
    HM.app.start().catch(() => {});
    // The service worker pings open tabs when it starts; a tab that answers has a live copy.
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'hm-ping') { sendResponse(true); return false; }
      return false;
    });
    // Ask the worker whether this is a development install; page aids are added only on true.
    // A cut-off copy's sendMessage throws, and a worker that can't answer leaves lastError:
    // both mean no aids.
    const askDev = () => new Promise(resolve => {
      const result = chrome.runtime.sendMessage({ type: 'dev-mode' }, reply => { void chrome.runtime.lastError; resolve(reply === true); });
      if (result && typeof result.then === 'function') { result.then(r => resolve(r === true)).catch(() => resolve(false)); }
    }).catch(() => false);
    askDev().then(dev => {
      if (!dev) return;
      // Development only: copy the service worker's notes onto the page so a test can read them.
      api.storage.local.get(null).then(r => {
        const notes = Object.fromEntries(Object.entries(r || {}).filter(([k]) => k.startsWith('hm.dev.')));
        document.documentElement.dataset.hmDev = JSON.stringify(notes);
      }).catch(() => {});
      const copy = Math.random().toString(36).slice(2, 7);
      setInterval(() => {
        try { document.documentElement.setAttribute('data-hm-status-' + copy, JSON.stringify({ alive: !!(chrome.runtime && chrome.runtime.id), ...HM.app.status() })); } catch (e) { /* cut off */ }
      }, 2000);
      window.addEventListener('message', e => {
        if (e.source === window && e.data && e.data.type === 'human-music:dev-reload') {
          try { chrome.runtime.sendMessage({ type: 'dev-reload' }); } catch (err) { /* already reloading */ }
        }
      });
    });
  }
})();
