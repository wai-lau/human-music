(function () {
  'use strict';

  const HM = globalThis.HM;

  const REMOVE_ICON = 'M9 .75a8.25 8.25 0 100 16.5A8.25 8.25 0 009 .75Zm0 1.5a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5Zm3 6H6a.75.75 0 000 1.5h6a.75.75 0 100-1.5Z';

  const SEL = {
    playerNew: 'ytmusic-miniplayer',
    playerOld: 'ytmusic-player-bar',
    titleNew: '.ytmusicTrackInfoTitle',
    titleOld: '.title',
    bylineNew: '.ytmusicTrackInfoByline',
    bylineOld: '.byline',
    nextNew: 'button[aria-label="Next"]',
    nextOld: '.next-button',
    dislikeNew: 'dislike-button-view-model button',
    dislikeOld: '.dislike',
    queueRow: 'ytmusic-player-queue-item',
    queueRowTitle: '.song-title',
    queueRowByline: '.byline',
    queueRowMenu: 'ytmusic-menu-renderer button',
    menuPopup: 'ytmusic-menu-popup-renderer',
    menuItem: '[role=menuitem]',
  };

  function findPlayer(doc) {
    let player = doc.querySelector(SEL.playerNew);
    if (player) return { el: player, layout: 'new' };
    player = doc.querySelector(SEL.playerOld);
    if (player) return { el: player, layout: 'old' };
    return null;
  }

  function readSong(doc) {
    const player = findPlayer(doc);
    if (!player) return null;
    const el = player.el;
    const layout = player.layout;

    let titleEl, bylineEl;
    if (layout === 'new') {
      titleEl = el.querySelector(SEL.titleNew);
      bylineEl = el.querySelector(SEL.bylineNew);
    } else {
      titleEl = el.querySelector(SEL.titleOld);
      bylineEl = el.querySelector(SEL.bylineOld);
    }

    if (!titleEl) return null;
    const title = (titleEl.textContent || '').trim();
    if (!title) return null;
    const artistLine = (bylineEl ? bylineEl.textContent : '').trim();
    return { title, artistLine, channelIds: [] };
  }

  function readQueue(doc) {
    const rows = doc.querySelectorAll(SEL.queueRow);
    const result = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Skip rows inside #counterpart-renderer
      if (row.closest('#counterpart-renderer')) continue;

      const titleEl = row.querySelector(SEL.queueRowTitle);
      const bylineEl = row.querySelector(SEL.queueRowByline);
      const title = titleEl ? (titleEl.textContent || '').trim() : '';
      const artistLine = bylineEl ? (bylineEl.textContent || '').trim() : '';
      const selected = row.hasAttribute('selected');
      result.push({ title, artistLine, selected, el: row });
    }
    return result;
  }

  function clickNext(doc) {
    const player = findPlayer(doc);
    if (!player) return false;
    const layout = player.layout;
    let btn;
    if (layout === 'new') {
      btn = player.el.querySelector(SEL.nextNew);
    } else {
      btn = player.el.querySelector(SEL.nextOld);
    }
    if (!btn) return false;
    btn.click();
    return true;
  }

  function pressNextKey(doc) {
    const ev = new doc.defaultView.KeyboardEvent('keydown', {
      key: 'j',
      code: 'KeyJ',
      bubbles: true
    });
    doc.body.dispatchEvent(ev);
  }

  function clickDislike(doc) {
    const player = findPlayer(doc);
    if (!player) return false;
    const layout = player.layout;
    let btn;
    if (layout === 'new') {
      btn = player.el.querySelector(SEL.dislikeNew);
    } else {
      btn = player.el.querySelector(SEL.dislikeOld);
    }
    if (!btn) return false;

    // In new layout, the inner button has aria-pressed
    if (layout === 'new') {
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') return true; // already disliked
      btn.click();
    } else {
      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') return true;
      btn.click();
    }
    return true;
  }

  function videoDuration(doc) {
    const video = doc.querySelector('video');
    if (!video) return NaN;
    return video.duration;
  }

  function seekTo(doc, seconds) {
    const video = doc.querySelector('video');
    if (!video) return;
    video.currentTime = seconds;
    return seconds;
  }

  async function removeQueueRow(doc, row) {
    try {
      const menuBtn = row.el.querySelector(SEL.queueRowMenu);
      if (!menuBtn) return false;
      menuBtn.click();

      // Wait for menu popup (up to 1500 ms)
      let popup = null;
      const start = Date.now();
      while (Date.now() - start < 1500) {
        const popups = doc.querySelectorAll(SEL.menuPopup);
        for (let i = 0; i < popups.length; i++) {
          if (popups[i].offsetParent !== null) {
            popup = popups[i];
            break;
          }
        }
        if (popup) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (!popup) {
        dispatchEscape(doc);
        return false;
      }

      // Find the remove item
      const items = popup.querySelectorAll(SEL.menuItem);
      for (let i = 0; i < items.length; i++) {
        const svg = items[i].querySelector('svg path');
        if (svg && svg.getAttribute('d') === REMOVE_ICON) {
          items[i].click();
          // Wait for row to be removed (up to 1500 ms)
          const start2 = Date.now();
          while (Date.now() - start2 < 1500) {
            if (!row.el.isConnected) return true;
            await new Promise(r => setTimeout(r, 50));
          }
          return false;
        }
      }

      dispatchEscape(doc);
      return false;
    } catch (e) {
      return false;
    }
  }

  function dispatchEscape(doc) {
    const ev = new doc.defaultView.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true
    });
    doc.dispatchEvent(ev);
  }

  function mountPlayerButtons(doc, handlers) {
    const player = findPlayer(doc);
    if (!player) return false;
    const layout = player.layout;
    const el = player.el;

    // Check for existing container
    let container = el.querySelector('#hm-player-buttons');
    if (!container) {
      container = doc.createElement('div');
      container.id = 'hm-player-buttons';
      container.style.display = 'inline-block';
      container.style.marginLeft = '8px';
      el.append(container);
    }

    // Add buttons
    const blockArtistBtn = doc.createElement('button');
    blockArtistBtn.textContent = 'Block artist';
    blockArtistBtn.addEventListener('click', () => {
      if (handlers.onBlockArtist) handlers.onBlockArtist();
    });

    const blockSongBtn = doc.createElement('button');
    blockSongBtn.textContent = 'Block song';
    blockSongBtn.addEventListener('click', () => {
      if (handlers.onBlockSong) handlers.onBlockSong();
    });

    container.append(blockArtistBtn);
    container.append(blockSongBtn);
    return true;
  }

  function pageAdapter(doc) {
    return {
      readSong: () => readSong(doc),
      clickNext: () => clickNext(doc),
      pressNextKey: () => pressNextKey(doc),
      clickDislike: () => clickDislike(doc),
      videoDuration: () => videoDuration(doc),
      seekTo: (seconds) => seekTo(doc, seconds),
    };
  }

  HM.ytm = {
    SEL,
    REMOVE_ICON,
    readSong,
    readQueue,
    clickNext,
    pressNextKey,
    clickDislike,
    videoDuration,
    seekTo,
    removeQueueRow,
    mountPlayerButtons,
    pageAdapter,
  };
})();
