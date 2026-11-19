import { el, makeDocument } from './dom.mjs';

// A clock whose timers run only inside tick(ms). While a timer runs, now() is its fire time.
export function fakeClock() {
  let now = 0;
  let seq = 0;
  let timers = [];

  function add(type, fn, delay) {
    const d = Number(delay) || 0;
    const t = { id: ++seq, type, fn, delay: type === 'interval' ? Math.max(1, d) : Math.max(0, d) };
    t.at = now + t.delay;
    timers.push(t);
    return t.id;
  }
  function clear(id) {
    timers = timers.filter(t => t.id !== id);
  }

  function tick(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const t of timers) {
        if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      }
      if (!next) break;
      now = next.at;
      if (next.type === 'interval') next.at += next.delay;
      else clear(next.id);
      next.fn();
    }
    now = end;
  }

  return {
    setTimeout: (fn, delay) => add('timeout', fn, delay),
    clearTimeout: clear,
    setInterval: (fn, delay) => add('interval', fn, delay),
    clearInterval: clear,
    tick,
    pending: () => timers.length,
    now: () => now,
  };
}

// Async storage shaped like chrome.storage.local; values are copied in and out.
export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];

  async function get(keys) {
    const wanted = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
    const out = {};
    for (const k of wanted) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  }

  async function set(obj) {
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      const oldValue = k in data ? structuredClone(data[k]) : undefined;
      data[k] = structuredClone(v);
      changes[k] = { oldValue, newValue: structuredClone(v) };
    }
    for (const fn of listeners) fn(changes, 'local');
  }

  async function remove(keys) {
    const changes = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      if (!(k in data)) continue;
      changes[k] = { oldValue: structuredClone(data[k]), newValue: undefined };
      delete data[k];
    }
    if (Object.keys(changes).length) for (const fn of listeners) fn(changes, 'local');
  }

  return { get, set, remove, onChanged: { addListener: fn => listeners.push(fn) }, data };
}

// Read all log entries from storage (segments or legacy array), newest first.
export async function readAllLogs(storage) {
  const HM = { log: null };
  const core = await import('./load.mjs');
  core.load(['src/core/text.js', 'src/core/store.js', 'src/core/log.js'], HM);
  const store = HM.HM.log.createLogStore(storage);
  return store.readAll();
}

// Read all log entries synchronously from segments (for tests that can't wait).
export function readAllLogsSync(storage) {
  const data = storage.data;
  // Legacy format
  if (data['hm.log'] && Array.isArray(data['hm.log'])) {
    return [...data['hm.log']];
  }
  // Segmented format
  const idx = data['hm.log.index'];
  if (!idx || typeof idx.count !== 'number' || idx.count === 0) return [];
  const result = [];
  let segN = Math.ceil(idx.count / 1000) - 1;
  while (segN >= 0) {
    const key = 'hm.log.seg.' + segN;
    if (data[key] && Array.isArray(data[key])) {
      result.push(...data[key]);
    }
    segN--;
  }
  return result.reverse();
}

// Read the log from storage, supporting both the legacy 'hm.log' array and the new segmented store.
// Returns a Promise resolving to an array of log entries (newest first).
// The whole log, newest first, as HM.log.createLogStore keeps it: segments 'hm.log.seg.<n>'
// from index.last down to index.first, then an old 'hm.log' array not migrated yet.
export async function readLog(storage) {
  const all = [];
  const idx = storage.data['hm.log.index'];
  if (idx && Number.isInteger(idx.first) && Number.isInteger(idx.last)) {
    for (let n = idx.last; n >= idx.first; n--) {
      const seg = storage.data['hm.log.seg.' + n] || [];
      for (let k = seg.length - 1; k >= 0; k--) all.push(structuredClone(seg[k]));
    }
  }
  if (Array.isArray(storage.data['hm.log'])) for (const x of storage.data['hm.log']) all.push(structuredClone(x));
  return all;
}

// A fake YouTube Music page for tests.
// layout: 'new' or 'old'
// song: { title, artistLine } (null = no song)
// queue: [{ title, artistLine, selected }] (null = no queue rows)
export function fakeYtm(opts = {}) {
  const layout = opts.layout || 'new';
  let song = opts.song || null;
  let queue = opts.queue || null;
  let duration = opts.duration || NaN;
  let currentTime = 0;
  let dislikePressed = opts.dislikePressed || false;

  const calls = { clickNext: 0, pressNextKey: 0, clickDislike: 0 };
  let menuOpenRow = null;
  let menuVisible = false;

  const doc = makeDocument();
  doc.location = opts.location || { pathname: '/' };
  doc.defaultView.location = doc.location;

  // Build player
  const playerTag = layout === 'new' ? 'ytmusic-miniplayer' : 'ytmusic-player-bar';
  const player = el(playerTag);
  if (song) {
    const titleClass = layout === 'new' ? 'ytmusicTrackInfoTitle' : 'title';
    const bylineClass = layout === 'new' ? 'ytmusicTrackInfoByline' : 'byline';
    player.append(el('div', { class: titleClass }, song.title));
    player.append(el('div', { class: bylineClass }, song.artistLine));
  }
  // Next button
  if (layout === 'new') {
    player.append(el('button', { 'aria-label': 'Next' }));
  } else {
    player.append(el('button', { class: 'next-button' }));
  }
  // Dislike button
  if (layout === 'new') {
    const dislikeVm = el('dislike-button-view-model');
    dislikeVm.append(el('button', { 'aria-pressed': String(dislikePressed) }));
    player.append(dislikeVm);
  } else {
    player.append(el('button', { class: 'dislike', 'aria-pressed': String(dislikePressed) }));
  }
  doc.body.append(player);

  // Build queue
  const queueEl = el('div', { id: 'queue' });
  if (queue) {
    queue.forEach((item, i) => {
      const row = el('ytmusic-player-queue-item');
      row.append(el('div', { class: 'song-title' }, item.title));
      row.append(el('div', { class: 'byline' }, item.artistLine));
      if (item.selected) row.setAttribute('selected', '');
      // Menu button for each row
      const menuBtn = el('ytmusic-menu-renderer');
      menuBtn.append(el('button'));
      row.append(menuBtn);
      queueEl.append(row);
    });
  }
  doc.body.append(queueEl);

  // Video element — store duration on the element so tests can read it after seekTo
  let _duration = duration;
  let _currentTime = currentTime;
  const video = el('video');
  video.duration = _duration;
  video.currentTime = _currentTime;
  doc.body.append(video);

  return {
    doc,
    layout,
    getSong: () => song,
    setSong: (s) => { song = s; if (s) { player.children[0].textContent = s.title; player.children[1].textContent = s.artistLine; } },
    getQueue: () => queue,
    setQueue: (q) => { queue = q; queueEl.children.forEach(c => c.parentNode.removeChild(c)); if (q) { q.forEach(item => { const row = el('ytmusic-player-queue-item'); row.append(el('div', { class: 'song-title' }, item.title)); row.append(el('div', { class: 'byline' }, item.artistLine)); if (item.selected) row.setAttribute('selected', ''); const menuBtn = el('ytmusic-menu-renderer'); menuBtn.append(el('button')); row.append(menuBtn); queueEl.append(row); }); } },
    getDuration: () => video.duration,
    setDuration: (d) => { video.duration = d; },
    getCurrentTime: () => video.currentTime,
    setCurrentTime: (t) => { video.currentTime = t; },
    getDislikePressed: () => dislikePressed,
    setDislikePressed: (v) => { dislikePressed = v; },
    calls,
    menuOpenRow,
    get menuVisible() { return menuVisible; },
  };
}
