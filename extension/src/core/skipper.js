(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  globalThis.HM.skipper = {
    createSkipper({ page, setTimeout, clearTimeout, setInterval, clearInterval, onGiveUp }) {
      let busy = false;
      let skipSong = null;
      let pollInterval = null;
      let giveUpTimeout = null;
      let seekTimeout = null;
      let seekInterval = null;
      let dislikeWaitTimeout = null;
      let buttonTimeout = null;

      function isCurrentSong() {
        try {
          const now = page.readSong();
          if (skipSong == null) return true;
          if (now == null) return true;
          return now.title === skipSong.title && now.artistLine === skipSong.artistLine;
        } catch (e) {
          return true;
        }
      }

      // For pressing again or seeking, the song must be readable and still the listed one
      // (review 2026-11-17): a player that shows no title between songs may already be playing
      // a person's song, so unreadable means "don't act", not "still the same".
      function stillSameSong() {
        try {
          const now = page.readSong();
          return skipSong != null && now != null && now.title === skipSong.title && now.artistLine === skipSong.artistLine;
        } catch (e) {
          return false;
        }
      }

      function clearAllTimers() {
        if (pollInterval != null) { clearInterval(pollInterval); pollInterval = null; }
        if (giveUpTimeout != null) { clearTimeout(giveUpTimeout); giveUpTimeout = null; }
        if (seekTimeout != null) { clearTimeout(seekTimeout); seekTimeout = null; }
        if (seekInterval != null) { clearInterval(seekInterval); seekInterval = null; }
        if (dislikeWaitTimeout != null) { clearTimeout(dislikeWaitTimeout); dislikeWaitTimeout = null; }
        if (buttonTimeout != null) { clearTimeout(buttonTimeout); buttonTimeout = null; }
      }

      // Next: YouTube Music's own shortcut first (Wai, 2026-11-12: "Use shortcut keys when
      // possible"). The button only if, 750 ms later, the same song is plainly still
      // playing (video running, time moving on), so a slow but working key never leads
      // to a second Next. The seek to the end stays the last resort at 1500 ms.
      function videoNow() {
        try { return page.videoState ? page.videoState() : null; } catch (e) { return null; }
      }

      function pressNext() {
        const before = videoNow();
        try { page.pressNextKey(); } catch (e) {}
        buttonTimeout = setTimeout(() => {
          buttonTimeout = null;
          if (!busy || !stillSameSong()) return;
          const now = videoNow();
          if (before && now && !now.paused && now.time > before.time) {
            try { page.clickNext(); } catch (e) {}
          }
        }, 750);
        seekTimeout = setTimeout(() => {
          seekTimeout = null;
          if (busy && stillSameSong()) {
            tryMaybeSeek();
          }
        }, 1500);
      }

      function tryMaybeSeek() {
        try {
          const dur = page.videoDuration();
          if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
            page.seekTo(dur);
            if (seekInterval != null) { clearInterval(seekInterval); seekInterval = null; }
          } else {
            if (seekInterval == null) {
              seekInterval = setInterval(() => {
                if (!busy || !stillSameSong()) {
                  clearInterval(seekInterval);
                  seekInterval = null;
                  return;
                }
                try {
                  const dur = page.videoDuration();
                  if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
                    page.seekTo(dur);
                    clearInterval(seekInterval);
                    seekInterval = null;
                  }
                } catch (e) {}
              }, 100);
            }
          }
        } catch (e) {}
      }

      function skipDone() {
        busy = false;
        skipSong = null;
        clearAllTimers();
      }

      function handlePoll() {
        if (!busy) return;
        if (!isCurrentSong()) { skipDone(); }
      }

      return {
        skip({ dislikeFirst = false } = {}) {
          if (busy) return;

          busy = true;
          skipSong = null;

          try { skipSong = page.readSong(); } catch (e) {}

          if (dislikeFirst) {
            let disliked = false;
            try { disliked = page.clickDislike(); } catch (e) {}

            if (disliked) {
              dislikeWaitTimeout = setTimeout(() => {
                dislikeWaitTimeout = null;
                if (busy && isCurrentSong()) {
                  pressNext();
                }
              }, 2000);
            } else {
              pressNext();
            }
          } else {
            pressNext();
          }

          giveUpTimeout = setTimeout(() => {
            giveUpTimeout = null;
            // Still the same song, plainly read, after 10 s: the skip didn't take. Report it
            // (the log's Errors section); a song that can't be read counts as moved on.
            let stuck;
            try {
              const now = page.readSong();
              stuck = !!(busy && skipSong && now && now.title === skipSong.title && now.artistLine === skipSong.artistLine);
            } catch (e) { stuck = false; }
            const song = skipSong;
            skipDone();
            if (stuck && onGiveUp) { try { onGiveUp(song); } catch (e) { /* reporting only */ } }
          }, 10000);

          pollInterval = setInterval(handlePoll, 100);
        },
        busy() { return busy; }
      };
    }
  };
})();
