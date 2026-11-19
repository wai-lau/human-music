(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  const SEGMENT = 1000;
  const STORE_CAP = 100000;

  function capFor(isDev) {
    return isDev ? 0 : STORE_CAP;
  }

  function cap(str) {
    if (str == null) return str;
    const s = String(str);
    return s.length > 300 ? s.slice(0, 300) : s;
  }

  function makeEntry({ event, song, match, at }) {
    const m = match || {};
    return {
      at: at,
      event: event,
      title: cap(song ? song.title : ''),
      artistLine: cap(song ? song.artistLine : ''),
      listId: m.listId || null,
      listName: cap(m.listName || null),
      rule: m.rule || null,
      entry: cap(m.entry || null),
      confidence: typeof m.confidence === 'number' ? m.confidence : undefined
    };
  }

  function describe(entry) {
    let action;
    switch (entry.event) {
      case 'removed': action = 'Removed from queue'; break;
      case 'skipped': action = 'Skipped'; break;
      case 'disliked': action = 'Skipped and disliked'; break;
      case 'seen': action = 'Played (auto-skip off)'; break;
      case 'watched': action = 'Watch mode, left alone'; break;
      case 'hidden': action = 'Hidden on page'; break;
      case 'skip-failed': action = 'Couldn\'t skip (still playing after 10 s)'; break;
      case 'remove-failed': action = 'Couldn\'t remove from queue'; break;
      default: action = entry.event; break;
    }

    let reason;
    if (entry.listId === 'user:artists') {
      reason = 'on your artists list';
    } else if (entry.listId === 'user:songs') {
      reason = 'on your songs list';
    } else if (entry.listId === 'user:keywords') {
      reason = 'keyword "' + entry.entry + '" from your keywords list';
    } else if (entry.listName) {
      reason = 'AI-generated (' + entry.listName + ')';
    } else {
      reason = 'unknown';
    }

    return action + ': ' + reason;
  }

  // The popup's three sections (Wai, 2026-11-15): blocks are what never reached the person
  // ("adblocked"), actions what was done for them while playing, errors what didn't work.
  const SECTIONS = {
    removed: 'blocks', hidden: 'blocks',
    skipped: 'actions', disliked: 'actions', seen: 'actions', watched: 'actions',
    'skip-failed': 'errors', 'remove-failed': 'errors',
  };
  function section(event) { return SECTIONS[event] || 'actions'; }

  // One or two words for a log line's tag; the artist and reason are shown once per group.
  const ACTIONS = {
    removed: 'Removed', hidden: 'Hidden', skipped: 'Skipped', disliked: 'Disliked', seen: 'Played',
    watched: 'Would skip', 'skip-failed': 'Couldn’t skip', 'remove-failed': 'Couldn’t remove',
  };
  function action(event) { return ACTIONS[event] || String(event || ''); }

  // Why it matched, in a few words.
  function reason(entry) {
    const e = entry || {};
    if (e.listId === 'user:artists') return 'Your artists';
    if (e.listId === 'user:songs') return 'Your songs';
    if (e.listId === 'user:keywords') return 'Keyword “' + (e.entry || '') + '”';
    let r = '';
    if (e.listName) {
      r = 'AI-generated · ' + e.listName;
      if (typeof e.confidence === 'number') r = r + ' · ' + e.confidence + '%';
    }
    return r;
  }

  function append(entries, entry, cap) {
    if (cap === undefined) cap = 1000;
    const result = [entry];
    const taken = Math.min(cap - 1, entries.length);
    for (let i = 0; i < taken; i++) {
      result.push(entries[i]);
    }
    return result;
  }

  function seenRecently(entries, entry, now, windowMs) {
    if (windowMs === undefined) windowMs = 86400000;
    for (const existing of entries) {
      if (existing.event === entry.event &&
          existing.title === entry.title &&
          existing.artistLine === entry.artistLine &&
          now - existing.at < windowMs) {
        return true;
      }
    }
    return false;
  }

  function segKey(n) {
    return 'hm.log.seg.' + n;
  }

  // The log in segments of SEGMENT entries, oldest first: 'hm.log.seg.<n>' for n from
  // index.first to index.last, and 'hm.log.index' = { first, last, count }. Only the newest
  // segment is ever rewritten; over the cap, whole oldest segments are removed, so the kept
  // count stays between cap and cap + SEGMENT. cap 0 keeps everything (the development copy).
  function createLogStore(storage, opts) {
    const limit = opts && typeof opts.cap === 'number' ? opts.cap : STORE_CAP;
    const DAY = 86400000;

    async function readIndex() {
      const got = await storage.get('hm.log.index');
      const i = got['hm.log.index'];
      return i && Number.isInteger(i.first) && Number.isInteger(i.last) && Number.isInteger(i.count) ? i : null;
    }
    async function readSeg(n) {
      const got = await storage.get(segKey(n));
      return Array.isArray(got[segKey(n)]) ? got[segKey(n)] : [];
    }
    function same(a, b) {
      return a && b && a.event === b.event && a.title === b.title && a.artistLine === b.artistLine &&
        a.listId === b.listId && a.rule === b.rule && a.entry === b.entry;
    }

    // oncePerDay looks back one day in the newest two segments only.
    async function append(entry, o) {
      try {
        let index = await readIndex();
        if (!index) index = { first: 0, last: 0, count: 0 };
        let seg = await readSeg(index.last);
        if (o && o.oncePerDay) {
          const recent = index.last > index.first ? (await readSeg(index.last - 1)).concat(seg) : seg;
          for (let k = recent.length - 1; k >= 0; k--) {
            const x = recent[k];
            if (!x || entry.at - x.at >= DAY) break;
            if (entry.at - x.at >= 0 && same(x, entry)) return false;
          }
        }
        if (seg.length >= SEGMENT) { index.last += 1; seg = []; }
        seg.push(entry);
        index.count += 1;
        const write = {};
        write[segKey(index.last)] = seg;
        const gone = [];
        while (limit > 0 && index.first < index.last && index.count - SEGMENT >= limit) {
          gone.push(segKey(index.first));
          index.first += 1;
          index.count -= SEGMENT;
        }
        write['hm.log.index'] = index;
        await storage.set(write);
        if (gone.length) await storage.remove(gone);
        return true;
      } catch (e) {
        return false;
      }
    }

    // Newest first: the segments, then an old 'hm.log' array not migrated yet (newest first too).
    async function readAll() {
      const all = [];
      try {
        const index = await readIndex();
        if (index) {
          for (let n = index.last; n >= index.first; n--) {
            const seg = await readSeg(n);
            for (let k = seg.length - 1; k >= 0; k--) all.push(seg[k]);
          }
        }
        const got = await storage.get('hm.log');
        if (Array.isArray(got['hm.log'])) for (const x of got['hm.log']) all.push(x);
      } catch (e) { /* what was read so far */ }
      return all;
    }

    async function clear() {
      const index = await readIndex();
      const keys = ['hm.log.index', 'hm.log'];
      if (index) for (let n = index.first; n <= index.last; n++) keys.push(segKey(n));
      await storage.remove(keys);
    }

    // The old log (one 'hm.log' array, newest first) is older than any segment, so it goes into
    // segments numbered below index.first.
    async function migrate() {
      try {
        const got = await storage.get('hm.log');
        const old = got['hm.log'];
        if (!Array.isArray(old)) return;
        const oldestFirst = old.slice().reverse();
        let index = await readIndex();
        const write = {};
        if (oldestFirst.length) {
          const segs = Math.ceil(oldestFirst.length / SEGMENT);
          const start = index ? index.first - segs : 0;
          for (let k = 0; k < segs; k++) write[segKey(start + k)] = oldestFirst.slice(k * SEGMENT, (k + 1) * SEGMENT);
          index = index
            ? { first: start, last: index.last, count: index.count + oldestFirst.length }
            : { first: 0, last: segs - 1, count: oldestFirst.length };
          write['hm.log.index'] = index;
          await storage.set(write);
        }
        await storage.remove('hm.log');
      } catch (e) { /* the old array stays; readAll still shows it */ }
    }

    return { append: append, readAll: readAll, clear: clear, migrate: migrate };
  }

  globalThis.HM.log = {
    SEGMENT: SEGMENT,
    STORE_CAP: STORE_CAP,
    capFor: capFor,
    createLogStore: createLogStore,
    makeEntry: makeEntry,
    describe: describe,
    section: section,
    action: action,
    reason: reason,
    append: append,
    seenRecently: seenRecently
  };
})();
