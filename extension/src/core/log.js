(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  // Store copies ask for no unlimitedStorage (Wai, 2026-11-18: "don't ask for unlimited
  // storage!"; scripts/store-manifest.mjs removes it when packing): Chrome's 10 MB holds the lists
  // too, and a full quota fails every write, list updates included. 20,000 entries is about 4.3 MB
  // (216 bytes each), leaving the lists room to grow. The development copy keeps unlimitedStorage
  // and every entry (Wai: "keep all entries for my own version", "no cap for dev?"): cap 0.
  const SEGMENT = 1000;
  const STORE_CAP = 20000;
  // The log also stays under this many bytes (about; an entry is about 220), so a long log
  // can't fill the 10 MB a store copy gets and make every write, list updates included, fail.
  const MAX_BYTES = 3000000;

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
      case 'skip-loop': action = 'Auto-skip paused for a minute (6 skips in 20 s)'; break;
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
    'skip-failed': 'errors', 'remove-failed': 'errors', 'skip-loop': 'errors',
  };
  function section(event) { return SECTIONS[event] || 'actions'; }

  // One or two words for a log line's tag; the artist and reason are shown once per group.
  const ACTIONS = {
    removed: 'Removed', hidden: 'Hidden', skipped: 'Skipped', disliked: 'Disliked', seen: 'Played',
    watched: 'Would skip', 'skip-failed': 'Couldn’t skip', 'remove-failed': 'Couldn’t remove', 'skip-loop': 'Paused skipping',
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

    // The estimated stored size of one entry: its JSON text.
    const sizeOf = x => { try { return JSON.stringify(x).length; } catch (e) { return 220; } };

    // Drops the oldest segment from index (its count and bytes with it) and returns its key.
    // Reads the segment to learn how much it held.
    async function dropOldest(index) {
      const old = await readSeg(index.first);
      const key = segKey(index.first);
      index.count = Math.max(0, index.count - (old.length || SEGMENT));
      index.bytes = Math.max(0, (typeof index.bytes === 'number' ? index.bytes : index.count * 220) - sizeOf(old));
      index.first += 1;
      return key;
    }

    // Adds several entries in one write: [{ entry, oncePerDay }]. oncePerDay looks back one day
    // in the newest two segments (and in this batch) only. Resolves to one boolean per entry
    // (false when oncePerDay found it already today). Only the newest segment(s) and the index
    // are written, once, however many entries came in.
    async function appendMany(items) {
      const kept = items.map(function () { return false; });
      try {
        let index = await readIndex();
        if (!index) index = { first: 0, last: 0, count: 0 };
        let seg = await readSeg(index.last);
        let recent = null; // the newest two segments, read when a oncePerDay entry needs them
        const touched = {};
        for (let n = 0; n < items.length; n++) {
          const entry = items[n].entry;
          if (items[n].oncePerDay) {
            if (!recent) recent = index.last > index.first ? (await readSeg(index.last - 1)).concat(seg) : seg.slice();
            let dup = false;
            for (let k = recent.length - 1; k >= 0; k--) {
              const x = recent[k];
              if (!x || entry.at - x.at >= DAY) break;
              if (entry.at - x.at >= 0 && same(x, entry)) { dup = true; break; }
            }
            if (dup) continue;
          }
          if (seg.length >= SEGMENT) { touched[index.last] = seg; index.last += 1; seg = []; }
          seg.push(entry);
          if (recent) recent.push(entry);
          index.count += 1;
          index.bytes = (typeof index.bytes === 'number' ? index.bytes : (index.count - 1) * 220) + sizeOf(entry);
          kept[n] = true;
        }
        if (!kept.some(Boolean)) return kept;
        touched[index.last] = seg;
        const gone = [];
        while (limit > 0 && index.first < index.last && index.count - SEGMENT >= limit) {
          gone.push(segKey(index.first));
          index.first += 1;
          index.count -= SEGMENT;
          index.bytes = Math.max(0, (index.bytes || 0) - SEGMENT * 220);
        }
        // Over the byte budget too (the store copy's 10 MB is shared with the lists).
        while (limit > 0 && index.first < index.last && index.bytes > MAX_BYTES) gone.push(await dropOldest(index));
        const write = {};
        for (const n in touched) if (Number(n) >= index.first) write[segKey(Number(n))] = touched[n];
        write['hm.log.index'] = index;
        try {
          await storage.set(write);
        } catch (e) {
          // Storage full: the oldest half of the log goes, then one more try.
          const drop = Math.max(1, Math.floor((index.last - index.first) / 2));
          for (let d = 0; d < drop && index.first < index.last; d++) gone.push(await dropOldest(index));
          if (index.first === index.last && seg.length > 1) {
            const cut = Math.floor(seg.length / 2);
            seg = seg.slice(cut); touched[index.last] = seg;
            index.count = Math.max(seg.length, index.count - cut);
          }
          for (const n in touched) if (Number(n) >= index.first) write[segKey(Number(n))] = touched[n];
          write[segKey(index.last)] = seg;
          await storage.set(write);
        }
        if (gone.length) await storage.remove(gone);
        return kept;
      } catch (e) {
        return kept;
      }
    }

    async function append(entry, o) {
      return (await appendMany([{ entry: entry, oncePerDay: !!(o && o.oncePerDay) }]))[0];
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
        const oldestFirst = old.toReversed();
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

    return { append: append, appendMany: appendMany, readAll: readAll, clear: clear, migrate: migrate };
  }

  globalThis.HM.log = {
    SEGMENT: SEGMENT,
    STORE_CAP: STORE_CAP,
    MAX_BYTES: MAX_BYTES,
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
