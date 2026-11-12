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
    queueRow: '#queue ytmusic-player-queue-item',
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
    try { btn.click(); } catch (e) { return false; }
    return true;
  }

  function pressNextKey(doc) {
    try {
      const ev = new doc.defaultView.KeyboardEvent('keydown', {
        key: 'j',
        code: 'KeyJ',
        bubbles: true
      });
      doc.body.dispatchEvent(ev);
    } catch (e) { /* no page to press on: nothing to do */ }
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
    const el = player.el;
    if (el.querySelector('#hm-player-buttons')) return true; // already mounted: never a second pair

    const container = doc.createElement('div');
    container.id = 'hm-player-buttons';
    container.style.display = 'inline-block';
    container.style.marginLeft = '8px';
    el.append(container);

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

  // --- Page items (home, Explore, search) ---

  const ITEM_SELECTOR = 'ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer, ytmusic-card-shelf-renderer';

  function isPageItemPath(path) {
    if (typeof path !== 'string') return false;
    return path === '/' || path === '/explore' || path.startsWith('/search');
  }

  function dedupe(arr) {
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function splitNames(text) {
    // Split on ', ', ' & ', ' feat. ' (case-insensitive)
    const parts = text.split(/, | & | feat\. /i);
    return parts.map(p => p.trim()).filter(Boolean);
  }

  function extractPageItem(itemEl, doc) {
    try {
      // Title
      const titleEl = itemEl.querySelector('.title');
      const title = titleEl ? (titleEl.textContent || '').trim() : '';

      // Channel links
      const channelLinks = itemEl.querySelectorAll('a[href*="channel/"]');
      const channelIds = [];
      let linkCredits = [];
      for (let i = 0; i < channelLinks.length; i++) {
        const link = channelLinks[i];
        const text = (link.textContent || '').trim();
        if (text) linkCredits.push(text);
        const href = link.getAttribute('href') || '';
        const chMatch = href.match(/channel\/(UC[A-Za-z0-9_-]+)/);
        if (chMatch) channelIds.push(chMatch[1]);
      }
      linkCredits = dedupe(linkCredits);
      const channelIdsUnique = dedupe(channelIds);

      if (linkCredits.length > 0) {
        // Has channel links → use them as credits
        return { title, credits: linkCredits, channelIds: channelIdsUnique, featured: false };
      }

      // No channel links → read subtitle
      let subtitleEl = itemEl.querySelector('.subtitle');
      if (!subtitleEl) subtitleEl = itemEl.querySelector('.secondary-flex-columns');
      const subtitle = subtitleEl ? (subtitleEl.textContent || '').trim() : '';

      if (!subtitle) {
        return { title, credits: [], channelIds: [], featured: false };
      }

      const parts = subtitle.split(' • ').map(p => p.trim()).filter(Boolean);

      // Check for type word at start
      const typeWords = ['Song', 'Album', 'Single', 'EP', 'Playlist', 'Artist', 'Video'];
      let typeWord = null;
      let creditParts = parts;
      if (parts.length > 0) {
        for (const tw of typeWords) {
          if (parts[0].toLowerCase() === tw.toLowerCase()) {
            typeWord = parts[0];
            creditParts = parts.slice(1);
            break;
          }
        }
      }

      // Type word was "Artist" → credits = [title]
      if (typeWord && typeWord.toLowerCase() === 'artist') {
        return { title, credits: [title], channelIds: [], featured: false };
      }

      // No ' • ' at all AND at least one ', ' → mix card
      // Every name is kept: dropping one would let a mix with a person in it count as all listed.
      if (parts.length === 1 && subtitle.includes(', ')) {
        const mixCredits = dedupe(subtitle.split(', ').map(p => p.trim()));
        return { title, credits: mixCredits, channelIds: [], featured: true };
      }

      // Normal: first remaining part is the credit
      if (creditParts.length === 0) {
        return { title, credits: [], channelIds: [], featured: false };
      }

      const creditText = creditParts[0];
      const split = splitNames(creditText);
      // Credits: whole text first, then split parts
      const allCredits = [creditText, ...split].filter(Boolean);
      const uniqueCredits = dedupe(allCredits);
      return { title, credits: uniqueCredits, channelIds: [], featured: false };
    } catch (e) {
      return { title: '', credits: [], channelIds: [], featured: false };
    }
  }

  function readPageItems(doc, path) {
    if (!isPageItemPath(path)) return [];

    const items = doc.querySelectorAll(ITEM_SELECTOR);
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Skip items inside player page or queue
      if (item.closest('ytmusic-player-page') || item.closest('#queue')) continue;
      result.push({ ...extractPageItem(item, doc), el: item });
    }
    return result;
  }

  function hideItem(el) {
    try {
      el.hidden = true;
      el.setAttribute('data-hm-hidden', '');
    } catch (e) { /* ignore */ }
  }

  function unhideAll(doc) {
    try {
      const hidden = doc.querySelectorAll('[data-hm-hidden]');
      for (let i = 0; i < hidden.length; i++) {
        hidden[i].hidden = false;
        hidden[i].removeAttribute('data-hm-hidden');
      }
    } catch (e) { /* ignore */ }
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
    readPageItems,
    hideItem,
    unhideAll,
  };
})();
