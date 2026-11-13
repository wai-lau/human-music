// Page adapter for the Spotify web player (open.spotify.com): every Spotify selector
// and page action lives here. Same shape as HM.ytm, so content.js can use either.
// Page facts were checked live (spec, "Spotify page facts"). Nothing here throws.
(function () {
  'use strict';
  const HM = (globalThis.HM = globalThis.HM || {});

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

  function readSong(doc) {
    return safe(() => {
      const widget = doc.querySelector(SEL.widget);
      if (!widget) return null;
      const title = text(widget.querySelector(SEL.title));
      if (!title) return null;
      const byline = widget.querySelector(SEL.byline) || widget;
      const { names, ids } = artistsIn(byline);
      return { title, artistLine: names.join(', '), channelIds: ids };
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
        out.push({ title: text(row.querySelector(SEL.rowTitle)), artistLine: names.join(', '), channelIds: ids, selected: false, el: row });
      }
      return out;
    }, []);
  }

  function clickNext(doc) {
    const btn = safe(() => doc.querySelector(SEL.next), null);
    if (!btn) return false;
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
    return safe(() => {
      const video = doc.querySelector('video');
      if (!video) return null;
      return { time: Number(video.currentTime) || 0, paused: !!video.paused };
    }, null);
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
  async function removeQueueRow(doc, row) {
    let before = null;
    try { before = doc.activeElement; } catch (e) { /* no page */ }
    try {
      return await removeInner(doc, row);
    } catch (e) {
      return false;
    } finally {
      try {
        if (before && before !== doc.body && before.isConnected && doc.activeElement !== before) before.focus({ preventScroll: true });
      } catch (e) { /* focus is a courtesy */ }
    }
  }

  async function removeInner(doc, row) {
    if (!row || !row.el || !row.el.isConnected) return false;
    const more = row.el.querySelector(SEL.more);
    if (more) more.click();
    else {
      const View = (doc.defaultView && doc.defaultView.MouseEvent) || MouseEvent;
      row.el.dispatchEvent(new View('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2 }));
    }
    let menu = null;
    for (let t = 0; t < 1500 && !menu; t += 50) {
      menu = doc.querySelector(SEL.menu);
      if (!menu) await wait(50);
    }
    const item = menu && [...menu.querySelectorAll('[role="menuitem"], button')].find(i => {
      const path = i.querySelector('svg path');
      return path && path.getAttribute('d') === REMOVE_ICON;
    });
    if (!item) {
      const View = (doc.defaultView && doc.defaultView.KeyboardEvent) || KeyboardEvent;
      doc.dispatchEvent(new View('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return false;
    }
    item.click();
    for (let t = 0; t < 1500; t += 50) {
      if (!row.el.isConnected) return true;
      await wait(50);
    }
    return !row.el.isConnected;
  }

  // The "skip" glyph (a circle with a slash, as on an UNO skip card), as in ytm.js.
  function glyph(doc) {
    const NS = 'http://www.w3.org/2000/svg';
    const make = tag => (doc.createElementNS ? doc.createElementNS(NS, tag) : doc.createElement(tag));
    const svg = make('svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'currentColor', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const [d, rule] of [['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0ZM4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0Z', 'evenodd'], ['M7.05 5.63 18.37 16.95 16.95 18.37 5.63 7.05Z', null]]) {
      const p = make('path');
      p.setAttribute('d', d);
      if (rule) p.setAttribute('fill-rule', rule);
      svg.appendChild(p);
    }
    return svg;
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
      if (icon && icon.parentNode) icon.parentNode.replaceChild(glyph(doc), icon);
      else button.appendChild(glyph(doc));
      button.addEventListener('click', e => {
        safe(() => { e.preventDefault(); e.stopPropagation(); });
        safe(() => handlers && handlers.onBlockArtist && handlers.onBlockArtist());
      });
      box.appendChild(button);
      repeat.parentElement.insertBefore(box, repeat.nextSibling);
      return true;
    }, false);
  }

  // Home and search only. Credits come from artist links (and an artist card's own title);
  // subtitles are never read: on Spotify they are often playlist descriptions.
  function readPageItems(doc, path) {
    return safe(() => {
      if (typeof path !== 'string' || !(path === '/' || path.startsWith('/search'))) return [];
      const out = [];
      for (const el of doc.querySelectorAll(SEL.pageItem)) {
        if (el.closest(SEL.notPage)) continue;
        const title = text(el.querySelector(SEL.itemTitle));
        const { names, ids } = artistsIn(el);
        const own = el.querySelector('a[href]');
        const ownId = own ? idOf(own.getAttribute('href')) : null;
        const credits = uniq(ownId && title ? [title, ...names] : names);
        out.push({ title, credits, channelIds: uniq(ownId ? [ownId, ...ids] : ids), featured: false, el });
      }
      return out;
    }, []);
  }

  function hideItem(el) {
    safe(() => { el.hidden = true; el.setAttribute('data-hm-hidden', ''); });
  }

  function unhideAll(doc) {
    safe(() => {
      for (const el of doc.querySelectorAll('[data-hm-hidden]')) { el.hidden = false; el.removeAttribute('data-hm-hidden'); }
    });
  }

  HM.spotify = {
    SEL, REMOVE_ICON, readSong, readQueue, clickNext, pressNextKey, clickDislike,
    videoDuration, videoState, seekTo, removeQueueRow, mountPlayerButtons, readPageItems, hideItem, unhideAll,
  };
})();
