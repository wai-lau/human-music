// Shared code between the YouTube Music and Spotify page adapters.
// Sets globalThis.HM.pageCommon. No page-specific selectors here.
(function () {
  'use strict';
  const HM = (globalThis.HM = globalThis.HM || {});

  // The "skip" glyph (a circle with a slash, as on an UNO skip card), drawn for Human Music.
  const BLOCK_GLYPH = [
    { d: 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0ZM4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0Z', rule: 'evenodd' },
    { d: 'M7.05 5.63 18.37 16.95 16.95 18.37 5.63 7.05Z' },
  ];

  function glyph(doc, size) {
    size = size || '24';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS ? doc.createElementNS(NS, 'svg') : doc.createElement('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    for (const part of BLOCK_GLYPH) {
      const path = doc.createElementNS ? doc.createElementNS(NS, 'path') : doc.createElement('path');
      path.setAttribute('d', part.d);
      if (part.rule) path.setAttribute('fill-rule', part.rule);
      svg.appendChild(path);
    }
    return svg;
  }

  function setDisplayNone(el, on) {
    try {
      if (typeof el.style.setProperty === 'function') {
        if (on) el.style.setProperty('display', 'none', 'important');
        else el.style.removeProperty('display');
      } else if (on) el.style.display = 'none';
      else delete el.style.display;
    } catch (e) { /* ignore */ }
  }

  function hideItem(el) {
    try {
      el.hidden = true;
      el.setAttribute('data-hm-hidden', '');
    } catch (e) { /* ignore */ }
    setDisplayNone(el, true);
  }

  function unhideAll(doc) {
    try {
      const hidden = doc.querySelectorAll('[data-hm-hidden]');
      for (let i = 0; i < hidden.length; i++) {
        hidden[i].hidden = false;
        hidden[i].removeAttribute('data-hm-hidden');
        setDisplayNone(hidden[i], false);
      }
    } catch (e) { /* ignore */ }
  }

  // { time, paused } of the playing video, or null when there is none.
  function videoState(doc) {
    try {
      const video = doc.querySelector('video');
      if (!video) return null;
      return { time: Number(video.currentTime) || 0, paused: !!video.paused };
    } catch (e) {
      return null;
    }
  }

  // Wrapper for removeQueueRow inner operations: restores keyboard focus afterward.
  // Opening a row's menu moves keyboard focus into the menu, and closing it leaves focus
  // on some other control (checked live). Put focus back where the person had it.
  async function removeQueueRowWrap(doc, row, innerFn) {
    let before = null;
    try { before = doc.activeElement; } catch (e) { /* no page */ }
    try {
      // Wait for row to be removed (up to 1500 ms)
      return await innerFn(row);
    } catch (e) {
      return false;
    } finally {
      try {
        if (before && before !== doc.body && before.isConnected && doc.activeElement !== before) {
          before.focus({ preventScroll: true });
        }
      } catch (e) { /* focus is a courtesy */ }
    }
  }

  // Wait for a predicate to return a truthy value, up to timeout ms.
  // Returns the value when found, or null on timeout.
  async function waitFor(predicate, timeout, interval) {
    timeout = timeout || 1500;
    interval = interval || 50;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = predicate();
      if (result) return result;
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }

  function dispatchEscape(doc) {
    const View = (doc.defaultView && doc.defaultView.KeyboardEvent) || KeyboardEvent;
    const ev = new View('keydown', { key: 'Escape', bubbles: true });
    doc.dispatchEvent(ev);
  }

  // Right-click on an element (for menu when the menu button isn't there).
  function rightClickFallback(doc, el) {
    const View = (doc.defaultView && doc.defaultView.MouseEvent) || MouseEvent;
    el.dispatchEvent(new View('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2 }));
  }

  HM.pageCommon = {
    glyph,
    setDisplayNone,
    hideItem,
    unhideAll,
    videoState,
    removeQueueRowWrap,
    waitFor,
    dispatchEscape,
    rightClickFallback,
  };
})();
