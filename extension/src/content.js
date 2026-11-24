// Content script on music.youtube.com: wires the core modules to the page.
// One MutationObserver schedules a pass (at most one pending, 50 ms later):
// check the playing song, run lookahead, hide page items, keep the player buttons.
// Anything that throws leaves the song playing.
(function () {
  'use strict';
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};
  const HM = globalThis.HM;

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
      videoSrc: () => (site.videoSrc ? site.videoSrc(doc) : null),
      videoState: () => (site.videoState ? site.videoState(doc) : null),
      seekTo: seconds => site.seekTo(doc, seconds),
      nextBlocked: () => (site.nextBlocked ? site.nextBlocked(doc) : false),
      keyIsButton: !!site.keyIsButton,
    };
  }

  function createApp({ doc, storage, timers, now, alive = () => true, site = siteFor(doc), onCount = () => {}, onUnknown = () => {}, fingerprints = null, locks }) {
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
      skipTimes: [], // when recent skips began (for the skip-loop breaker)
      skipPausedUntil: 0, // auto-skip rests until then (the breaker tripped)
      removeFailures: new Map(), // queue rows whose removal failed: rowKey -> { tries, at }
      reported: new Set(), // normalised credits already sent to the investigator this page
      // Fingerprinting state
      captureRunning: false,
      captureSong: null, // { title, artistLine } of the song being captured
      recordedKey: '', // the song (title + artist line) already recorded this play; once per play
      captureSkipTimer: null, // 20s timer to force skip if capture hangs
    };
    let writes = Promise.resolve();

    // The log is kept in segments (HM.log.createLogStore). The worker records this copy's cap as
    // hm.logCap (HM.log.capFor); until it has, the store cap holds.
    // The worker also migrates the old hm.log array, once, at its start.
    let logStore = null;
    async function getLogStore() {
      if (logStore) return logStore;
      let cap = HM.log.STORE_CAP;
      try {
        const r = await storage.get('hm.logCap');
        if (typeof r['hm.logCap'] === 'number') cap = r['hm.logCap'];
      } catch (e) { /* the store cap */ }
      logStore = HM.log.createLogStore(storage, { cap: cap });
      return logStore;
    }

    const matchSong = song => (state.index ? safe(() => HM.match.matchSong(state.index, song), null) : null);

    // The cover is read from the player, so only the playing song may carry it: a queue row
    // with the playing song's cover would have the investigator judge the wrong artist's art.
    function buildReportItem(row, playing) {
      const host = safe(() => doc.location.hostname, '') || '';
      const siteName = /(^|\.)open\.spotify\.com$/.test(host) ? 'spotify' : 'ytm';
      const artistLine = row.artistLine || '';
      const parts = artistLine.split(' • ');
      const album = parts.length > 1 ? parts[1].trim() : '';
      const readArt = site['readArt'];
      const artUrl = playing && typeof readArt === 'function' ? safe(() => readArt(doc), '') || '' : '';
      return {
        site: siteName,
        title: row.title || '',
        artistLine,
        credits: HM.text.splitNames(HM.text.leadCredit(artistLine)),
        album,
        artUrl,
        channelIds: row.channelIds || [],
      };
    }

    function reportUnknown(item, playing = false) {
      if (!state.settings.investigate || !state.index) return;
      const row = buildReportItem(item, playing);
      if (HM.match.isKnown(state.index, row)) return;
      for (const credit of row.credits) {
        const key = HM.text.normalize(credit);
        if (!state.reported.has(key)) {
          state.reported.add(key);
          safe(() => onUnknown([row]), []);
        }
      }
    }

    // Storage writes run one after another, so two quick ones never lose each other.
    function queueWrite(fn) {
      writes = writes.then(fn).catch(() => {});
      return writes;
    }

    // The toolbar count: songs skipped or removed from the queue in this tab (Wai,
    // 2026-11-13: "where 1 is the number of songs skipped or blocked").
    const COUNTED = new Set(['skipped', 'disliked', 'removed']);
    let count = 0;

    // Once-a-day entries this tab already logged (or found logged): remembered here, so a page
    // update every second doesn't read the whole log again to learn it (review 2026-11-17).
    const loggedOnce = new Map();
    function log(event, song, match, { oncePerDay = false } = {}) {
      if (COUNTED.has(event)) { count++; safe(() => onCount(count)); }
      const entry = HM.log.makeEntry({ event, song, match, at: now() });
      if (oncePerDay) {
        const k = [entry.event, entry.title, entry.artistLine].join('\u0000');
        const at = loggedOnce.get(k);
        if (at !== undefined && entry.at - at >= 0 && entry.at - at < 86400000) return Promise.resolve();
        if (loggedOnce.size >= 2000) loggedOnce.clear();
        loggedOnce.set(k, entry.at);
      }
      return queueWrite(async () => (await getLogStore()).append(entry, { oncePerDay }));
    }

    async function reload() {
      const stored = await storage.get([HM.store.KEYS.user, HM.store.KEYS.settings, HM.store.KEYS.filterLists]);
      state.settings = HM.settings.sanitize(stored[HM.store.KEYS.settings]);
      const user = { ...HM.store.emptyUser(), ...(stored[HM.store.KEYS.user] || {}) };
      const lists = Array.isArray(stored[HM.store.KEYS.filterLists]) ? stored[HM.store.KEYS.filterLists] : [];
      const keys = lists.map(l => HM.store.listKey(l.id));
      const data = keys.length ? await storage.get(keys) : {};
      // Calibration is the verdict list meta's flag (the refresher copies it there).
      const verdictList = lists.find(l => l.id === 'hm-verdicts');
      const calibrated = !!(verdictList && verdictList.calibrated === true);
      const mode = HM.settings.effectiveMode(state.settings, calibrated);
      const threshold = HM.settings.threshold(mode);
      state.index = HM.match.buildIndex({
        filterLists: lists.map(l => ({ ...l, artists: (data[HM.store.listKey(l.id)] || {}).artists || [] })),
        user,
        threshold,
      });
    }

    // --- audio fingerprints ---------------------------------------------------------

    // Captures the song's audio (12 s muted for a song to skip, 30 s unmuted for a song that plays on),
    // prints it to 510 values, and sends it. If the song changes during capture, nothing is sent
    // and no skip happens. If capture hangs (never resolves), the skip is forced after 20 s.
    function captureAndSend(song, match) {
      const startKey = song.title + '\u0000' + song.artistLine;
      // This song is being recorded already (a list or settings change re-checks the playing
      // song): the running recording skips it; skipping now would leave the next song muted.
      if (state.captureRunning && state.captureSong && songMatches(state.captureSong, startKey)) return;
      const doSkip = () => {
        state.captureRunning = false;
        state.captureSong = null;
        safe(() => state.skipper.skip({ dislikeFirst: state.settings.autoDislike }));
        log(state.settings.autoDislike ? 'disliked' : 'skipped', song, match);
      };
      // Skip immediately if fingerprinting unavailable or already capturing, or while the page
      // is hidden: Chrome slows a background window's timers once it goes silent, and the muted
      // recording left skips failing in the YouTube Music app window (2026-11-24).
      if (!fingerprints || state.captureRunning || safe(() => doc.visibilityState === 'hidden', false)) {
        doSkip();
        return;
      }
      // Check if dev mode is on before capturing
      safe(() => {
        const devPromise = fingerprints.enabled();
        if (devPromise && typeof devPromise.then === 'function') {
          devPromise.then(dev => {
            if (!dev) { doSkip(); return; }
            beginCapture(song, match, startKey, doSkip);
          }).catch(() => doSkip());
        } else if (devPromise) {
          beginCapture(song, match, startKey, doSkip);
        } else {
          doSkip();
        }
      }, null);
    }

    function beginCapture(song, match, startKey, doSkip) {
      state.captureRunning = true;
      state.captureSong = { title: song.title, artistLine: song.artistLine };
      let settled = false;
      // If the capture hangs, force a skip after 20 s
      state.captureSkipTimer = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        // Never skip a song that started meanwhile: it may be a person's.
        if (songMatches(safe(() => site.readSong(doc), null), startKey)) { doSkip(); return; }
        state.captureRunning = false;
        state.captureSong = null;
      }, 20000);
      safe(() => fingerprints.capture(12, { mute: true }), null)
        .catch(() => null)
        .then((captured) => {
          if (state.captureSkipTimer != null) {
            safe(() => timers.clearTimeout(state.captureSkipTimer));
            state.captureSkipTimer = null;
          }
          if (settled) return;
          settled = true;
          const same = songMatches(safe(() => site.readSong(doc), null), startKey);
          // Song changed during capture: no skip, no send (it may be a person's song).
          if (!same) { state.captureRunning = false; state.captureSong = null; return; }
          try {
            if (captured && captured.length >= 44100 * 5) {
              const print = Array.from(HM.fingerprint.fakeprint(captured));
              // A silent recording (all zeros) teaches the model nothing.
              if (print.some(v => v > 0)) {
                safe(() => fingerprints.send({ title: song.title, artistLine: song.artistLine, label: 'ai', seconds: 12, print }));
              }
            }
          } catch (e) { /* any failure still skips below */ }
          doSkip();
        });
    }

    // The dev-mode answer can arrive after the first song was checked: record that song then,
    // if it plays on (a song to skip was already skipped).
    function captureNow() {
      if (!fingerprints || state.captureRunning || safe(() => fingerprints.enabled(), false) !== true) return;
      if (state.settings.paused || !videoPlaying()) return;
      const song = safe(() => site.readSong(doc), null);
      if (!song || matchSong(song)) return;
      capturePlayedSong(song);
    }

    function capturePlayedSong(song) {
      if (!fingerprints) return;
      if (!safe(() => fingerprints.enabled(), false)) return;
      if (state.captureRunning) return;
      const startKey = song.title + '\u0000' + song.artistLine;
      // A re-check of the same play (lists or settings changed) never records it again.
      if (state.recordedKey === startKey) return;
      state.recordedKey = startKey;
      state.captureRunning = true;
      state.captureSong = { title: song.title, artistLine: song.artistLine };
      Promise.resolve().then(() => safe(() => fingerprints.capture(30, { mute: false }), null))
        .catch(() => null)
        .then(async (captured) => {
          state.captureRunning = false;
          state.captureSong = null;
          if (!captured) return;
          // Song changed during capture?
          const current = safe(() => site.readSong(doc), null);
          if (!songMatches(current, startKey)) return;
          // Print and send
          const fp = HM.fingerprint.fakeprint(captured);
          fingerprints.send({
            title: song.title,
            artistLine: song.artistLine,
            label: 'played',
            seconds: 30,
            print: Array.from(fp)
          });
        });
    }

    function songMatches(song, key) {
      if (!song) return false;
      if (typeof key !== 'string') key = key.title + '\u0000' + key.artistLine;
      return song.title + '\u0000' + song.artistLine === key;
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
      // The song changed while one was being recorded: stop that recording now, so its mute
      // never carries over to this song.
      if (state.captureRunning && state.captureSong && !songMatches(song, state.captureSong.title + '\u0000' + state.captureSong.artistLine)) {
        safe(() => fingerprints && typeof fingerprints.cancel === 'function' && fingerprints.cancel());
      }
      if (state.last && state.last.title === song.title && state.last.artistLine === song.artistLine) return;
      if (!videoPlaying()) return; // not remembered yet, so the song is checked once it plays
      // A skip still finishing (its poll sees the new song within 100 ms) would refuse this
      // one, so a listed song straight after a skipped one played on (Wai, 2026-11-13: "when
      // there are multiple songs in a row, it just stop skipping"). Not remembered yet: look
      // again shortly, once the player shows the new song in full.
      if (safe(() => state.skipper.busy(), false)) { safe(() => timers.setTimeout(schedule, 200)); return; }
      state.last = { title: song.title, artistLine: song.artistLine };
      // state.last is cleared when the lists change, so the song is checked again; this one
      // isn't, so a refresh that changes nothing doesn't log the same song again (review 2026-11-17).
      const songKey = song.title + '\u0000' + song.artistLine;
      if (songKey !== state.lastSongKey) { state.lastSongKey = songKey; state.lastLogged = null; }
      const match = matchSong(song);
      if (!match) {
        reportUnknown(song, true);
        // Song plays on: capture its audio for training
        capturePlayedSong(song);
        return;
      }
      if (match.mode === 'watch') { logPlaying('watched', song, match); return; }
      if (!state.settings.autoSkip) { logPlaying('seen', song, match); return; }
      if (skipLoopOpen()) return; // resting: the playing song is checked again when the pause is over
      state.skipMatch = match; // named in the log if this skip doesn't take
      // Capture audio before skipping, in dev copies
      captureAndSend(song, match);
    }

    // Circuit breaker: a queue of only listed songs on repeat, or a radio full of them, would
    // skip forever. After 6 skips within 20 s, auto-skip rests for 60 s and one 'skip-loop'
    // line goes to the log's Errors section. True while it rests. Called once per song that
    // is about to be skipped, which also counts that skip.
    const LOOP_SKIPS = 6, LOOP_WINDOW_MS = 20000, LOOP_REST_MS = 60000;
    function skipLoopOpen() {
      const t = now();
      if (t < state.skipPausedUntil) return true;
      state.skipTimes = state.skipTimes.filter(x => t - x < LOOP_WINDOW_MS);
      if (state.skipTimes.length >= LOOP_SKIPS) {
        state.skipTimes = [];
        state.skipPausedUntil = t + LOOP_REST_MS;
        log('skip-loop', { title: 'Every song kept being skipped, so auto-skip rests for a minute', artistLine: '' }, null);
        safe(() => timers.setTimeout(() => { state.last = null; schedule(); }, LOOP_REST_MS + 100));
        return true;
      }
      state.skipTimes.push(t);
      return false;
    }

    // Logs a song that plays on (watched, or seen with auto-skip off) once per play.
    function logPlaying(event, song, match) {
      const k = [event, match.listId, match.entry].join('\u0000');
      if (state.lastLogged === k) return;
      state.lastLogged = k;
      log(event, song, match);
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
      if (site.otherPanelOpen && safe(() => site.otherPanelOpen(doc), true)) return; // the person's own panel
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
      if (state.queueRefused || (site.otherPanelOpen && safe(() => site.otherPanelOpen(doc), true))) return;
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
      // A row whose removal failed is remembered across checks (a check runs on every page
      // update, about once a second while music plays): tried at most twice, 10 s apart, so
      // its menu doesn't open again and again. Auto-skip still catches it if it plays.
      const resting = row => {
        const f = state.removeFailures.get(rowKey(row));
        return !!f && (f.tries >= 2 || now() - f.at < 10000);
      };
      try {
        for (let guard = 0; guard < 50; guard++) {
          // Re-read every time: removing a row shifts the rows after it.
          const rows = safe(() => site.readQueue(doc), []);
          if (rows.length > 1) state.checkedFor = songKey(rows.find(r => r.selected) || null) || state.checkedFor;
          const { remove, watched } = HM.lookahead.pickRemovals(rows, state.settings.lookahead,
            row => (resting(row) ? null : matchSong(row)));
          for (const w of watched) log('watched', rows[w.index], w.match, { oncePerDay: true });
          // The person may switch to No filtering (or the lists may go) while a removal runs:
          // stop before the next one (review 2026-11-17).
          if (!remove.length || typing() || state.settings.paused || !state.index) break;
          const row = rows[remove[0]];
          const match = matchSong(row);
          const removed = await Promise.resolve(safe(() => site.removeQueueRow(doc, row, { typing }), false)).catch(() => false);
          if (removed) log('removed', row, match);
          else {
            const f = state.removeFailures.get(rowKey(row)) || { tries: 0, at: 0 };
            state.removeFailures.set(rowKey(row), { tries: f.tries + 1, at: now() });
            log('remove-failed', row, match, { oncePerDay: true });
          }
        }
        // Unknown artists in the lookahead window (the rows checked ahead) are reported; rows
        // further down wait until they come up, so a long queue can't spend the day's checks.
        if (state.settings.investigate && state.index) {
          const rows = safe(() => site.readQueue(doc), []);
          const at = rows.findIndex(r => r.selected);
          for (const row of rows.slice(at + 1, at + 1 + state.settings.lookahead)) reportUnknown(row);
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
        const wasHidden = safe(() => item.el.hasAttribute('data-hm-hidden'), true);
        const match = safe(() => HM.match.matchItem(state.index, item), null);
        if (!wasHidden && (!match || match.mode !== 'act')) continue;
        if (match && match.mode === 'act') {
          if (!wasHidden) {
            site.hideItem(item.el);
            log('hidden', { title: item.title, artistLine: item.credits.join(', ') }, match, { oncePerDay: true });
          }
        } else {
          // No longer matches: the DOM element is reused for another song
          site.unhideItem(item.el);
        }
      }
    }

    // Song rows that stay on the page and would be skipped look unavailable, with the skip
    // glyph. Every pass looks at every row: YouTube Music reuses a row for another song.
    function markPass() {
      if (!site.readListRows || !site.markRow || !site.unmarkRow) return;
      const on = !state.settings.paused && state.settings.autoSkip && !!state.index && !state.settings.plainPages;
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
      // Under the user key's lock with the popup and the worker: a concurrent removal is kept.
      queueWrite(() => HM.store.modify(storage, HM.store.KEYS.user, stored => {
        const user = { ...HM.store.emptyUser(), ...(stored || {}) };
        if (kind === 'artist') {
          if (!credit || user.artists.some(a => N(a) === N(credit))) return undefined;
          user.artists = [...user.artists, credit];
        } else {
          const artist = HM.text.splitNames(credit)[0] || null;
          if (user.songs.some(s => N(s.title) === N(song.title) && N(s.artist || '') === N(artist || ''))) return undefined;
          user.songs = [...user.songs, { title: song.title, artist }];
        }
        return user;
      }, { locks }));
    }

    // Each copy tags the button it mounts; a button left by an earlier copy (cut off by a
    // reload, its clicks going nowhere) is replaced at once.
    const copyId = Math.random().toString(36).slice(2, 10);

    function playerButtons() {
      if (state.settings.playerButtons && !state.settings.paused && !state.settings.plainPages) {
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
          // Hidden items are checked again at once (each is shown if it no longer matches), so a
          // refresh that changes nothing doesn't flash them. Hiding turned off shows them all.
          if (state.settings.paused || !state.settings.hidePageItems || !state.index) safe(() => site.unhideAll(doc));
          else safe(hidePass);
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

    return { start, checkPlaying, runLookahead, flush, status, captureNow };
  }

  HM.createApp = createApp;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && !HM.app) {
    const api = HM.store.api();
    const askDev = () => new Promise(resolve => {
      const result = chrome.runtime.sendMessage({ type: 'dev-mode' }, reply => { void chrome.runtime.lastError; resolve(reply === true); });
      if (result && typeof result.then === 'function') { result.then(r => resolve(r === true)).catch(() => resolve(false)); }
    }).catch(() => false);
    // Fingerprints only once the worker has said dev mode; a plain flag, so a store copy never
    // starts a recording while the answer is pending (a Promise would read as true).
    let devCopy = false;
    askDev().then(dev => { devCopy = dev === true; if (devCopy && HM.app) safe(() => HM.app.captureNow()); });

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
      fingerprints: {
        enabled: () => devCopy,
        capture: (seconds, opts) => (HM.capture && typeof HM.capture.record === 'function' ? HM.capture.record(seconds, opts) : Promise.resolve(null)),
        cancel: () => { if (HM.capture && typeof HM.capture.cancel === 'function') HM.capture.cancel(); },
        send: item => {
          try {
            chrome.runtime.sendMessage({ type: 'hm-fingerprint', item: item });
          } catch (err) { /* ignore */ }
        }
      },
      // The worker puts this tab's count on the toolbar icon.
      onCount: count => {
        try {
          const sent = chrome.runtime.sendMessage({ type: 'hm-count', count });
          if (sent && typeof sent.catch === 'function') sent.catch(() => {});
        } catch (e) { /* cut off */ }
      },
      // Unknown artists go to the worker, which sends them to the investigator only from Wai's
      // development copy with her key; every other copy drops them (investigate is off there).
      onUnknown: items => {
        try {
          const sent = chrome.runtime.sendMessage({ type: 'hm-investigate', items });
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
