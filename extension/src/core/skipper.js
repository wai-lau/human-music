(function () {
  globalThis.HM = globalThis.HM || {};

  globalThis.HM.skipper = {
    createSkipper({ page, setTimeout, clearTimeout, setInterval, clearInterval }) {
      let busy = false;
      let skipSong = null;
      let pollInterval = null;
      let giveUpTimeout = null;
      let seekTimeout = null;
      let seekInterval = null;
      let dislikeWaitTimeout = null;

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

      function clearAllTimers() {
        if (pollInterval != null) { clearInterval(pollInterval); pollInterval = null; }
        if (giveUpTimeout != null) { clearTimeout(giveUpTimeout); giveUpTimeout = null; }
        if (seekTimeout != null) { clearTimeout(seekTimeout); seekTimeout = null; }
        if (seekInterval != null) { clearInterval(seekInterval); seekInterval = null; }
        if (dislikeWaitTimeout != null) { clearTimeout(dislikeWaitTimeout); dislikeWaitTimeout = null; }
      }

      function pressNext() {
        let moved = false;
        try { moved = page.clickNext(); } catch (e) {}
        if (!moved) {
          try { page.pressNextKey(); } catch (e) {}
        }
        seekTimeout = setTimeout(() => {
          seekTimeout = null;
          if (busy && isCurrentSong()) {
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
                if (!busy || !isCurrentSong()) {
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
            skipDone();
          }, 10000);

          pollInterval = setInterval(handlePoll, 100);
        },
        busy() { return busy; }
      };
    }
  };
})();
