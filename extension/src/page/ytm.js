(function () {
  'use strict';

  const HM = globalThis.HM;
  const PC = HM.pageCommon;

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
    likeNew: 'like-button-view-model button',
    likeOld: '.like',
    queueRow: '#queue ytmusic-player-queue-item',
    queueRowTitle: '.song-title',
    queueRowByline: '.byline',
    queueRowMenu: 'ytmusic-menu-renderer button',
    menuPopup: 'ytmusic-menu-popup-renderer',
    menuItem: '[role=menuitem]',
  };

  // The player's cover and artist links (investigator plan, Task 4). A guess about the page
  // that misses gives nothing, never a wrong value: IDs only from channel/UC… links in the
  // artist line, covers only from Google's image hosts over https.
  const CHANNEL_LINK = /(?:^|\/)channel\/(UC[\w-]{22})(?![\w-])/;
  const ART_HOSTS = ['lh3.googleusercontent.com', 'yt3.googleusercontent.com', 'yt3.ggpht.com', 'i.ytimg.com'];
  function artHost(src) {
    const m = /^https:\/\/([^/?#:@]+)(?:[/?#]|$)/.exec(src || '');
    return !!m && ART_HOSTS.includes(m[1].toLowerCase());
  }
  function channelIdsIn(bylineEl) {
    const ids = [];
    if (!bylineEl) return ids;
    for (const a of bylineEl.querySelectorAll('a[href*="channel/"]')) {
      const m = CHANNEL_LINK.exec(a.getAttribute('href') || '');
      if (m && !ids.includes(m[1])) ids.push(m[1]);
    }
    return ids;
  }
  // Checked live 2026-11-17: the watch page's #song-image img is the cover at 544 px; the new
  // player's img.ytmusicTrackInfoThumbnail is the same picture at 60 px. Both on
  // yt3.googleusercontent.com. (The player's artist names are buttons with no href: no IDs.)
  function readArt(doc) {
    try {
      const big = doc.querySelector('#song-image img');
      const bigSrc = big ? big.getAttribute('src') || '' : '';
      if (artHost(bigSrc)) return bigSrc;
      const player = findPlayer(doc);
      if (!player) return '';
      for (const img of player.el.querySelectorAll('img')) {
        const src = img.getAttribute('src') || '';
        if (artHost(src)) return src;
      }
    } catch (e) { /* no cover */ }
    return '';
  }

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
    return { title, artistLine, channelIds: channelIdsIn(bylineEl) };
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

    // A song the person has liked is never disliked, even when it is on a list: false makes
    // the skipper just press Next.
    const likeBtn = player.el.querySelector(layout === 'new' ? SEL.likeNew : SEL.likeOld);
    if (likeBtn && likeBtn.getAttribute('aria-pressed') === 'true') return false;

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

  // The playing video's source, to tell one track's video from the next.
  function videoSrc(doc) {
    try {
      const video = doc.querySelector('video');
      return (video && (video.currentSrc || video.src)) || null;
    } catch (e) {
      return null;
    }
  }

  function videoState(doc) {
    return PC.videoState(doc);
  }

  function seekTo(doc, seconds) {
    const video = doc.querySelector('video');
    if (!video) return;
    video.currentTime = seconds;
    return seconds;
  }

  // Opening a row's menu moves keyboard focus into the menu, and closing it leaves focus
  // on some other control (checked live). Put focus back where the person had it.
  async function removeQueueRow(doc, row, opts) {
    return PC.removeQueueRowWrap(doc, row, r => removeQueueRowInner(doc, r, opts || {}));
  }

  // Words that never appear in "Remove from queue" but do in "Remove from playlist", "Save to
  // library", "Delete playlist" and the like: playlist, library and history nouns in the
  // languages YouTube Music is mostly used in (a verb such as "remove" can't be used: it is
  // the queue action's own word). A hit means the item is not the one expected: do nothing.
  const NOT_QUEUE_ACTION = /playlist|library|history|delete|wiedergabeliste|bibliothek|verlauf|biblioth[eè]que|historique|lista de reproducci|mediateca|mediathek|biblioteca|historial|cronologia|hist[oó]rico|afspeellijst|bibliotheek|spellista|プレイリスト|ライブラリ|플레이리스트|보관함|播放列表|媒体库|плейлист|медиатек/i;

  function itemLabel(item) {
    return [item.textContent || '', item.getAttribute('aria-label') || '', item.getAttribute('title') || ''].join(' ');
  }

  // The one "Remove from queue" item of a queue row's menu, or null. Matched by its icon, but
  // "Remove from playlist" may share it, so also: the row must sit in the queue panel, exactly
  // one item may carry the icon, and its own text may not name a playlist, library, history
  // or delete action. Any doubt means null (nothing is clicked).
  function findRemoveItem(popup, row) {
    if (!row || !row.el || !row.el.closest || !row.el.closest('#queue')) return null;
    const items = popup.querySelectorAll(SEL.menuItem);
    let found = null;
    for (let i = 0; i < items.length; i++) {
      const svg = items[i].querySelector('svg path');
      if (svg && svg.getAttribute('d') === REMOVE_ICON) {
        if (found) return null; // two items share the icon: can't tell which is which
        found = items[i];
      }
    }
    if (found && NOT_QUEUE_ACTION.test(itemLabel(found))) return null;
    return found;
  }

  async function removeQueueRowInner(doc, row, opts) {
    try {
      if (!row.el.isConnected) return false;

      // If any menu is already open, it might belong to another row (e.g. the person is about
      // to pick "Play next" on a person's song). Do nothing and let a later pass try again.
      const existingPopups = doc.querySelectorAll(SEL.menuPopup);
      for (let i = 0; i < existingPopups.length; i++) {
        if (existingPopups[i].offsetParent !== null) return false;
      }

      const menuBtn = row.el.querySelector(SEL.queueRowMenu);
      if (menuBtn) {
        menuBtn.click();
      } else {
        // Rows YouTube Music adds itself (its up-next radio) have no menu button until the
        // queue panel is drawn; a right-click on the row opens the same menu (checked live).
        PC.rightClickFallback(doc, row.el);
      }

      // Wait for menu popup (up to 1500 ms)
      const popup = await PC.waitFor(() => {
        const popups = doc.querySelectorAll(SEL.menuPopup);
        for (let i = 0; i < popups.length; i++) {
          if (popups[i].offsetParent !== null) return popups[i];
        }
        return null;
      }, 1500, 50);
      if (!popup) return false; // nothing opened: nothing to close

      // The person may have started typing while the menu was opening: close ours, click nothing.
        if (typeof opts.typing === 'function' && opts.typing()) {
        PC.dispatchEscape(doc, popup);
        return false;
      }

      const item = findRemoveItem(popup, row);
      if (item) {
        item.click();
        // Wait for row to be removed (up to 1500 ms)
        await PC.waitFor(() => !row.el.isConnected, 1500, 50);
        return !row.el.isConnected;
      }

      PC.dispatchEscape(doc, popup);
      return false;
    } catch (e) {
      return false;
    }
  }

  function glyph(doc) {
    return PC.glyph(doc);
  }

  // The player's repeat button: found by its label, else the last of the main controls.
  function repeatButton(player) {
    const buttons = [...player.querySelectorAll('button')];
    const byLabel = buttons.find(b => /repeat|loop/i.test(b.getAttribute('aria-label') || ''));
    if (byLabel) return byLabel;
    const row = player.querySelector('.ytmusicPlayerControlsMainControls');
    const last = row && row.lastElementChild;
    return last ? last.querySelector('button') : null;
  }

  // One "Block artist" button just right of the repeat button, built from a copy of the
  // repeat button's own wrapper so it has the same size, colours and spacing (its icon
  // swapped for the skip glyph). Without the player controls, a plain icon button goes at
  // the end of the player instead. Mounted once; returns false when there is no player.
  function mountPlayerButtons(doc, handlers) {
    const player = findPlayer(doc);
    if (!player) return false;
    const el = player.el;
    if (doc.querySelector('#hm-player-buttons')) return true;

    const onClick = e => {
      // Only a person's click counts: a page script's .click() has isTrusted false and could
      // otherwise add any artist to the person's list (security audit 2026-11-17).
      if (e && e.isTrusted === false) return;
      try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* plain event */ }
      try { if (handlers && handlers.onBlockArtist) handlers.onBlockArtist(); } catch (err) { /* never break the page */ }
    };

    const repeat = repeatButton(el);
    const wrapper = repeat && repeat.parentElement;
    if (wrapper && wrapper.parentElement) {
      const box = wrapper.cloneNode(true);
      box.id = 'hm-player-buttons';
      const button = box.querySelector('button');
      button.id = 'hm-block-artist';
      for (const name of ['aria-pressed', 'aria-disabled', 'disabled']) button.removeAttribute(name);
      button.setAttribute('aria-label', 'Block artist');
      button.setAttribute('title', 'Block artist');
      // Our icon goes inside YouTube's own icon holder, replacing whatever it holds. Swapping only
      // the copied <svg> failed whenever the repeat icon wasn't drawn yet at copy time: our icon
      // then sat beside the empty 24 px holder, pushed right in one player layout and below the
      // row in another (Wai, 2026-11-19: "fix skip button bottom right (not aligned)").
      const icon = button.querySelector('svg');
      const holder = icon ? null : [...button.querySelectorAll('*')].find(e => /icon/i.test(String(e.className || '')) || e.tagName.toLowerCase() === 'yt-icon');
      if (icon && icon.parentNode) icon.parentNode.replaceChild(glyph(doc), icon);
      else if (holder) { holder.replaceChildren(glyph(doc)); }
      else button.appendChild(glyph(doc));
      button.addEventListener('click', onClick);
      wrapper.parentElement.insertBefore(box, wrapper.nextSibling);
      return true;
    }

    const box = doc.createElement('div');
    box.id = 'hm-player-buttons';
    box.style.display = 'inline-flex';
    box.style.alignItems = 'center';
    box.style.marginLeft = '16px';
    const button = doc.createElement('button');
    button.id = 'hm-block-artist';
    button.setAttribute('aria-label', 'Block artist');
    button.setAttribute('title', 'Block artist');
    Object.assign(button.style, { width: '40px', height: '40px', padding: '8px', border: 'none', borderRadius: '50%',
      background: 'transparent', color: 'inherit', cursor: 'pointer' });
    button.appendChild(glyph(doc));
    button.addEventListener('click', onClick);
    box.appendChild(button);
    el.append(box);
    return true;
  }

  function pageAdapter(doc) {
    return {
      readSong: () => readSong(doc),
      clickNext: () => clickNext(doc),
      pressNextKey: () => pressNextKey(doc),
      clickDislike: () => clickDislike(doc),
      videoDuration: () => videoDuration(doc),
      videoState: () => videoState(doc),
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

  // An item is read from its own parts only: a search shelf holds song rows of its own, and
  // their links are theirs (review 2026-11-17: a person's shelf hid for a duet inside it).
  const ITEM_PARTS = 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-card-shelf-renderer';
  function ownAll(itemEl, sel) {
    const all = itemEl.querySelectorAll(sel);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const inner = all[i].parentElement && all[i].parentElement.closest(ITEM_PARTS);
      if (!inner || inner === itemEl) out.push(all[i]);
    }
    return out;
  }
  const own = (itemEl, sel) => ownAll(itemEl, sel)[0] || null;

  function extractPageItem(itemEl, doc) {
    try {
      // Title
      const titleEl = own(itemEl, '.title');
      const title = titleEl ? (titleEl.textContent || '').trim() : '';

      // Channel links
      const channelLinks = ownAll(itemEl, 'a[href*="channel/"]');
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
      let subtitleEl = own(itemEl, '.subtitle');
      if (!subtitleEl) subtitleEl = own(itemEl, '.secondary-flex-columns');
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

      // A playlist listing several artists is a mix of their songs, not their work: it never
      // hides for one name in it (review 2026-11-17). A playlist by one artist still does.
      if (typeWord && typeWord.toLowerCase() === 'playlist' && creditParts.length > 0 && creditParts[0].includes(', ')) {
        return { title, credits: dedupe(creditParts[0].split(', ').map(p => p.trim()).filter(Boolean)), channelIds: [], featured: true };
      }

      // Normal: first remaining part is the credit
      if (creditParts.length === 0) {
        return { title, credits: [], channelIds: [], featured: false };
      }

      const creditText = creditParts[0];
      const split = HM.text.splitNames(creditText);
      // Credits: whole text first, then split parts
      const allCredits = [creditText, ...split].filter(Boolean);
      const uniqueCredits = dedupe(allCredits);
      return { title, credits: uniqueCredits, channelIds: [], featured: false };
    } catch (e) {
      return { title: '', credits: [], channelIds: [], featured: false };
    }
  }

  // A row read once is read again only when its text changes: a pass over a long page would
  // otherwise re-extract every row each time. The same object comes back, so the caller can
  // keep its match for the row too.
  const extracted = new WeakMap();
  function readRow(el, doc) {
    const text = el.textContent;
    const hit = extracted.get(el);
    if (hit && hit.text === text) return hit.item;
    const item = { ...extractPageItem(el, doc), el };
    extracted.set(el, { text, item });
    return item;
  }

  function readPageItems(doc, path) {
    if (!isPageItemPath(path)) return [];

    const items = doc.querySelectorAll(ITEM_SELECTOR);
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Skip items inside player page or queue
      if (item.closest('ytmusic-player-page') || item.closest('#queue')) continue;
      result.push(readRow(item, doc));
    }
    return result;
  }

  function hideItem(el) {
    HM.pageCommon.hideItem(el);
  }

  function unhideItem(el) {
    HM.pageCommon.unhideItem(el);
  }

  function unhideAll(doc) {
    HM.pageCommon.unhideAll(doc);
  }

  // --- Song rows that stay on the page (playlists, albums, artist pages, search) ---
  // A row that will be skipped looks like YouTube Music's own unavailable rows: dimmed, its
  // thumbnail swapped for a grey disc, with the skip glyph where YouTube Music puts "!"
  // (Wai, 2026-11-13; checked live: the row at opacity 0.6, a 24 px #aaa disc centred in
  // the 48 px thumbnail slot). Dimmed by greying its text, not by opacity, since 2026-11-20: a
  // user on Chrome on an Intel Mac saw the page below a dimmed row turn white and lose its text,
  // the kind of drawing glitch a semi-transparent layer can set off there.
  const DIM_TEXT = '#7a7a7a';
  const DIM_SECONDARY = '#5f5f5f';
  const DIM_PARTS = '.secondary-flex-columns yt-formatted-string, .secondary-flex-columns a, .fixed-columns yt-formatted-string, .fixed-columns a';

  const LIST_ROW = 'ytmusic-responsive-list-item-renderer';
  // A disc (r 11) with the skip glyph cut out: ring and slash scaled to 0.78, one even-odd path.
  const MARK_PATH = 'M1 12a11 11 0 1 0 22 0a11 11 0 1 0-22 0ZM4.2 12a7.8 7.8 0 1 0 15.6 0a7.8 7.8 0 1 0-15.6 0Z' +
    'M5.76 12a6.24 6.24 0 1 0 12.48 0a6.24 6.24 0 1 0-12.48 0ZM8.17 7.07 16.93 15.83 15.83 16.93 7.07 8.17Z';

  function readListRows(doc) {
    const rows = doc.querySelectorAll(LIST_ROW);
    const result = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.closest('ytmusic-player-page') || row.closest('#queue') || row.hasAttribute('data-hm-hidden')) continue;
      result.push(readRow(row, doc));
    }
    return result;
  }

  // Inline and !important, so the page's own CSS can't undo it; null takes it off again.
  function setStyle(el, prop, value) {
    try {
      if (!el || !el.style) return;
      if (typeof el.style.setProperty === 'function') {
        if (value == null) el.style.removeProperty(prop);
        else el.style.setProperty(prop, value, 'important');
      } else if (value == null) delete el.style[prop];
      else el.style[prop] = value;
    } catch (e) { /* cosmetic only */ }
  }

  function markGlyph(doc) {
    const NS = 'http://www.w3.org/2000/svg';
    const make = tag => (doc.createElementNS ? doc.createElementNS(NS, tag) : doc.createElement(tag));
    const svg = make('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = make('path');
    path.setAttribute('d', MARK_PATH);
    path.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(path);
    return svg;
  }

  const MENU_PARTS = 'ytmusic-menu-renderer, ytmusic-menu-renderer button';

  function markRow(row, doc = row && row.ownerDocument) {
    try {
      row.setAttribute('data-hm-marked', '');
      // The title and icons follow these on the row; the artist line and duration set their own
      // colour, so they get it inline.
      setStyle(row, '--ytmusic-text-primary', DIM_TEXT);
      setStyle(row, '--ytmusic-text-secondary', DIM_SECONDARY);
      setStyle(row, 'color', DIM_TEXT);
      const parts = row.querySelectorAll(DIM_PARTS);
      for (let i = 0; i < parts.length; i++) setStyle(parts[i], 'color', DIM_SECONDARY);
      // Unclickable, like YouTube Music's own unavailable rows (Wai, 2026-11-13: "make the
      // songs that look blocked unclickable"): it would only be skipped.
      setStyle(row, 'pointer-events', 'none');
      row.setAttribute('aria-disabled', 'true');
      // ...but its own menu stays usable, so a row marked by mistake can still be handled.
      for (const part of row.querySelectorAll(MENU_PARTS)) setStyle(part, 'pointer-events', 'auto');
      const left = row.querySelector('.left-items');
      if (!left) return;
      const thumb = left.querySelector('ytmusic-thumbnail-renderer');
      if (thumb) setStyle(thumb, 'display', 'none');
      if (left.querySelector('.hm-mark')) return;
      const mark = doc.createElement('span');
      mark.setAttribute('class', 'hm-mark');
      for (const [prop, value] of [['display', 'flex'], ['align-items', 'center'], ['justify-content', 'center'],
        ['width', '48px'], ['height', '48px'], ['color', '#aaa'], ['pointer-events', 'none']]) setStyle(mark, prop, value);
      mark.appendChild(markGlyph(doc));
      left.appendChild(mark);
    } catch (e) { /* cosmetic only */ }
  }

  function unmarkRow(row) {
    try {
      row.removeAttribute('data-hm-marked');
      setStyle(row, 'opacity', null); // rows marked by an older copy
      setStyle(row, '--ytmusic-text-primary', null);
      setStyle(row, '--ytmusic-text-secondary', null);
      setStyle(row, 'color', null);
      const parts = row.querySelectorAll(DIM_PARTS);
      for (let i = 0; i < parts.length; i++) setStyle(parts[i], 'color', null);
      setStyle(row, 'pointer-events', null);
      for (const part of row.querySelectorAll(MENU_PARTS)) setStyle(part, 'pointer-events', null);
      row.removeAttribute('aria-disabled');
      const thumb = row.querySelector('.left-items ytmusic-thumbnail-renderer');
      if (thumb) setStyle(thumb, 'display', null);
      const mark = row.querySelector('.hm-mark');
      if (mark) mark.remove();
    } catch (e) { /* cosmetic only */ }
  }

  function unmarkAll(doc) {
    try {
      const rows = doc.querySelectorAll('[data-hm-marked]');
      for (let i = 0; i < rows.length; i++) unmarkRow(rows[i]);
    } catch (e) { /* ignore */ }
  }

  HM.ytm = {
    keyIsButton: false,
    SEL,
    REMOVE_ICON,
    readSong,
    readArt,
    readQueue,
    clickNext,
    pressNextKey,
    clickDislike,
    videoDuration,
    videoSrc,
    seekTo,
    removeQueueRow,
    videoState,
    mountPlayerButtons,
    pageAdapter,
    readPageItems,
    hideItem,
    unhideItem,
    unhideAll,
    readListRows,
    markRow,
    unmarkRow,
    unmarkAll,
  };
})();
