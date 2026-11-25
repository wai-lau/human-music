// Page adapter for the Spotify web player (open.spotify.com): every Spotify selector
// and page action lives here. Same shape as HM.ytm, so content.js can use either.
// Page facts were checked live (spec, "Spotify page facts"). Nothing here throws.
(function () {
  'use strict';
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};
  const HM = globalThis.HM;
  const PC = HM.pageCommon;

  const SEL = {
    widget: '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]',
    title: '[data-testid="context-item-link"]',
    byline: '[data-testid="now-playing-widget-v2-byline"], [data-testid="context-item-info-subtitles"]',
    artistLink: 'a[href*="/artist/"]',
    next: '[data-testid="control-button-skip-forward"]',
    repeat: '[data-testid="control-button-repeat"]',
    duration: '[data-testid="playback-duration"]',
    progress: '[data-testid="playback-progressbar"] input[type="range"]',
    queuePanel: 'aside[aria-label="Queue"]',
    tag: 'span[data-encore-id="tag"]',
    queueRow: 'ul[role="treegrid"] li[role="row"]',
    rowTitle: '[data-encore-id="listRowTitle"], a[href*="/track/"]',
    more: '[data-testid="more-button"]',
    menu: '[data-testid="context-menu"], #context-menu',
    pageItem: '[data-encore-id="listRow"], [data-testid="tracklist-row"], [data-encore-id="card"]',
    itemTitle: '[data-encore-id="cardTitle"], [data-encore-id="listRowTitle"], a[href*="/track/"]',
    notPage: 'aside, [data-testid="now-playing-bar"]',
  };

  // "Remove from queue" in the track menu (a trash can); "Go to album" and "Exclude from
  // your taste profile" share another icon's start, so only an exact match counts.
  const REMOVE_ICON = 'M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583M2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z';

  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const text = el => (el && el.textContent ? el.textContent : '').trim();
  const idOf = href => { const m = String(href || '').match(/\/artist\/([A-Za-z0-9]{22})/); return m ? m[1] : null; };
  const uniq = list => list.filter((v, i) => v && list.indexOf(v) === i);

  function artistsIn(el) {
    const links = [...el.querySelectorAll(SEL.artistLink)];
    return { names: uniq(links.map(a => text(a))), ids: uniq(links.map(a => idOf(a.getAttribute('href')))) };
  }

  // Spotify's own "AI Persona" tag (checked live 2026-11-26): a span[data-encore-id="tag"] whose
  // text is exactly that (English only; any other text, or another language, does not count and
  // so errs toward playing). It belongs to the nearest artist link before it in the same line
  // (the link and the tag sit inside one element). Class names are hashed, so none is used.
  // Returns the tagged artists' names. `strict`: the link and tag must share an element other
  // than `root` itself (a row's artist line), so a tag in another cell never pairs.
  function taggedIn(root, strict) {
    const out = [];
    const pairs = root.querySelectorAll(SEL.artistLink + ', ' + SEL.tag);
    let last = null;
    for (const node of pairs) {
      if (node.matches(SEL.artistLink)) { last = node; continue; }
      if (text(node).toLowerCase() !== 'ai persona' || !last) continue;
      let line = last.parentElement;
      while (line && line !== root && !line.contains(node)) line = line.parentElement;
      if (!line || (strict && line === root)) continue;
      out.push(text(last));
    }
    return uniq(out);
  }

  function readSong(doc) {
    return safe(() => {
      const widget = doc.querySelector(SEL.widget);
      if (!widget) return null;
      const title = text(widget.querySelector(SEL.title));
      if (!title) return null;
      const byline = widget.querySelector(SEL.byline) || widget;
      const { names, ids } = artistsIn(byline);
      const song = { title, artistLine: names.join(', '), credits: names, channelIds: ids };
      const aiTagged = taggedIn(byline, false);
      if (aiTagged.length) song.aiTagged = aiTagged;
      return song;
    }, null);
  }

  // The playing song first (selected), then the rows of the Queue panel. Empty while the
  // panel is closed: Spotify only draws its queue there, and Human Music never opens it.
  function readQueue(doc) {
    return safe(() => {
      const panel = doc.querySelector(SEL.queuePanel);
      if (!panel || !panel.querySelector('ul[role="treegrid"]')) return [];
      const playing = readSong(doc);
      const out = playing ? [{ ...playing, selected: true, el: doc.querySelector(SEL.widget) }] : [];
      for (const row of panel.querySelectorAll(SEL.queueRow)) {
        const { names, ids } = artistsIn(row);
        const item = { title: text(row.querySelector(SEL.rowTitle)), artistLine: names.join(', '), credits: names, channelIds: ids, selected: false, el: row };
        const aiTagged = taggedIn(row, true);
        if (aiTagged.length) item.aiTagged = aiTagged;
        out.push(item);
      }
      return out;
    }, []);
  }

  // The Queue panel: Spotify draws the queue only while it is open.
  // A Queue panel that is open but still drawing (no rows yet) counts as open.
  function queueOpen(doc) {
    return safe(() => !!doc.querySelector(SEL.queuePanel), false);
  }

  // Another right-hand panel (Lyrics, Now Playing view, Devices, Friend activity) is the
  // person's choice: Human Music never replaces it by clicking Queue.
  function otherPanelOpen(doc) {
    return safe(() => [...doc.querySelectorAll('aside')].some(a => !a.matches(SEL.queuePanel + ', [data-testid="now-playing-bar"]')), false);
  }

  // Open the Queue panel (Wai, 2026-11-13: lookahead may open it). True if it clicked.
  function openQueue(doc) {
    return safe(() => {
      if (queueOpen(doc) || otherPanelOpen(doc)) return false;
      const btn = doc.querySelector('[data-testid="control-button-queue"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, false);
  }

  // Close the Queue panel (only used to undo a last-chance open the person hadn't wanted).
  function closeQueue(doc) {
    return safe(() => {
      if (!queueOpen(doc)) return false;
      const btn = doc.querySelector('[data-testid="control-button-queue"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, false);
  }

  // Seconds left in the playing song, from the times shown; NaN when unknown.
  function timeLeft(doc) {
    return safe(() => {
      const pos = text(doc.querySelector('[data-testid="playback-position"]'));
      if (!/^\d+(:\d{1,2}){1,2}$/.test(pos)) return NaN;
      const at = pos.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
      return videoDuration(doc) - at;
    }, NaN);
  }

  // Spotify Free limits skips: Next is then disabled, or a notice says so. Pressing again
  // does nothing useful and never moves the person's song.
  function nextBlocked(doc) {
    return safe(() => {
      const btn = doc.querySelector(SEL.next);
      if (btn && (btn.disabled === true || btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled'))) return true;
      const notices = doc.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"], [data-testid*="notification"], [data-testid*="banner"]');
      return [...notices].some(n => /skip limit|out of skips|skips? (left|remaining)|reached .{0,20}skip|too many skips/i.test(text(n)));
    }, false);
  }

  function clickNext(doc) {
    const btn = safe(() => doc.querySelector(SEL.next), null);
    if (!btn || nextBlocked(doc)) return false;
    return safe(() => { btn.click(); return true; }, false);
  }

  // Spotify ignores shortcut keys sent by a script (checked live), so its "key" is the button.
  function pressNextKey(doc) {
    clickNext(doc);
  }

  // Spotify has no dislike.
  function clickDislike() {
    return false;
  }

  // The song's length from the time shown (m:ss or h:mm:ss); the page's video element
  // reports a different duration, so it isn't used for this.
  function videoDuration(doc) {
    return safe(() => {
      const t = text(doc.querySelector(SEL.duration));
      if (!/^\d+(:\d{1,2}){1,2}$/.test(t)) return NaN;
      return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
    }, NaN);
  }

  function videoState(doc) {
    return PC.videoState(doc);
  }

  // Seek through the progress bar (its value is in milliseconds).
  function seekTo(doc, seconds) {
    safe(() => {
      const input = doc.querySelector(SEL.progress);
      if (!input) return;
      const max = Number(input.getAttribute('max') || input.max);
      let ms = Math.round(Number(seconds) * 1000);
      if (Number.isFinite(max) && ms > max) ms = max;
      input.value = String(ms);
      const View = (doc.defaultView && doc.defaultView.Event) || Event;
      input.dispatchEvent(new View('input', { bubbles: true }));
      input.dispatchEvent(new View('change', { bubbles: true }));
    });
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Open the row's menu, press "Remove from queue" (exact icon), and resolve true once the
  // row is gone. No such item: Escape, click nothing else, false. Focus goes back after.
  async function removeQueueRow(doc, row, opts) {
    return PC.removeQueueRowWrap(doc, row, r => removeInner(doc, r, opts || {}));
  }

  async function removeInner(doc, row, opts) {
    if (!row || !row.el || !row.el.isConnected) return false;

    // If a context menu is already open, it might belong to another row (the person is about
    // to pick "Play next" on a person's song). Do nothing and let a later pass try again.
    if (doc.querySelector(SEL.menu)) return false;

    const more = row.el.querySelector(SEL.more);
    if (more) more.click();
    else {
      PC.rightClickFallback(doc, row.el);
    }
    let menu = null;
    for (let t = 0; t < 1500 && !menu; t += 50) {
      menu = doc.querySelector(SEL.menu);
      if (!menu) await wait(50);
    }
    // The person may have started typing while the menu was opening: close ours, click nothing.
    if (menu && typeof opts.typing === 'function' && opts.typing()) {
      PC.dispatchEscape(doc, menu);
      return false;
    }
    const item = menu && [...menu.querySelectorAll('[role="menuitem"], button')].find(i => {
      const path = i.querySelector('svg path');
      return path && path.getAttribute('d') === REMOVE_ICON;
    });
    if (!item) {
      PC.dispatchEscape(doc, menu);
      return false;
    }
    item.click();
    for (let t = 0; t < 1500; t += 50) {
      if (!row.el.isConnected) return true;
      await wait(50);
    }
    return !row.el.isConnected;
  }



  // One "Block artist" button right of Spotify's repeat button: a copy of it (same size and
  // colours) in a display:contents box, so the controls' own spacing applies.
  function mountPlayerButtons(doc, handlers) {
    return safe(() => {
      const repeat = doc.querySelector(SEL.repeat);
      if (!repeat || !repeat.parentElement) return false;
      if (doc.querySelector('#hm-player-buttons')) return true;
      const box = doc.createElement('div');
      box.id = 'hm-player-buttons';
      box.style.display = 'contents';
      const button = repeat.cloneNode(true);
      for (const name of ['aria-checked', 'aria-pressed', 'data-testid', 'disabled', 'id']) button.removeAttribute(name);
      button.setAttribute('aria-label', 'Block artist');
      button.setAttribute('title', 'Block artist');
      const icon = button.querySelector('svg');
      if (icon && icon.parentNode) icon.parentNode.replaceChild(PC.glyph(doc, '16'), icon);
      else button.appendChild(PC.glyph(doc, '16'));
      button.addEventListener('click', e => {
        // Only a person's click counts: a page script's .click() has isTrusted false (audit 2026-11-17).
        if (e && e.isTrusted === false) return;
        safe(() => { e.preventDefault(); e.stopPropagation(); });
        safe(() => handlers && handlers.onBlockArtist && handlers.onBlockArtist());
      });
      box.appendChild(button);
      repeat.parentElement.insertBefore(box, repeat.nextSibling);
      return true;
    }, false);
  }

  // Home and search only. Credits come from artist links (and an artist card's own title);
  // subtitles are never read: on Spotify they are often playlist descriptions. A list row's
  // title is the track's name, not a credit (review 2026-11-17).
  function readPageItems(doc, path) {
    return safe(() => {
      if (typeof path !== 'string' || !(path === '/' || path.startsWith('/search'))) return [];
      const out = [];
      for (const el of doc.querySelectorAll(SEL.pageItem)) {
        if (el.closest(SEL.notPage)) continue;
        const title = text(el.querySelector(SEL.itemTitle));
        const { names, ids } = artistsIn(el);
        const isListRow = el.getAttribute('data-encore-id') === 'listRow';
        const own = el.querySelector('a[href]');
        const ownId = own ? idOf(own.getAttribute('href')) : null;
        let credits;
        // Several credited artists make a mix: it hides only when every one is listed.
        let featured = false;
        if (isListRow) {
          credits = names;
        } else {
          credits = uniq(ownId && title ? [title, ...names] : names);
        }
        if (!ownId && names.length > 1) featured = true;
        const kind = el.getAttribute('data-testid') === 'tracklist-row' ? 'song' : 'other';
        const item = { title, credits, channelIds: uniq(ownId ? [ownId, ...ids] : ids), featured, kind, el };
        let aiTagged = taggedIn(el, true);
        // An artist card: its tag sits beside the artist's own name, which is the card's title.
        if (!isListRow && ownId && title && !aiTagged.length && [...el.querySelectorAll(SEL.tag)].some(n => text(n).toLowerCase() === 'ai persona' && !el.querySelector(SEL.artistLink + ':not([href*="' + ownId + '"])'))) aiTagged = [title];
        if (aiTagged.length) item.aiTagged = aiTagged;
        out.push(item);
      }
      return out;
    }, []);
  }

  function hideItem(el) {
    PC.hideItem(el);
  }

  function unhideItem(el) {
    PC.unhideItem(el);
  }

  function unhideAll(doc) {
    PC.unhideAll(doc);
  }

  // The playing song's cover, only from Spotify's image hosts over https (investigator plan,
  // Task 4); anything else gives no cover.
  const ART_HOSTS = ['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com'];
  function readArt(doc) {
    return safe(() => {
      const widget = doc.querySelector(SEL.widget);
      if (!widget) return '';
      for (const img of widget.querySelectorAll('img')) {
        const src = img.getAttribute('src') || '';
        const m = /^https:\/\/([^/?#:@]+)(?:[/?#]|$)/.exec(src);
        if (m && ART_HOSTS.includes(m[1].toLowerCase())) return src;
      }
      return '';
    }, '');
  }

  HM.spotify = {
    keyIsButton: true,
    SEL, REMOVE_ICON, readSong, readArt, readQueue, queueOpen, otherPanelOpen, nextBlocked, openQueue, closeQueue, timeLeft, clickNext, pressNextKey, clickDislike,
    videoDuration, videoState, seekTo, removeQueueRow, mountPlayerButtons, readPageItems, hideItem, unhideItem, unhideAll,
  };
})();
