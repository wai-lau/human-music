(function () {
  globalThis.HM = globalThis.HM || {};

  function copy(arr) {
    if (!arr) return [];
    return arr.slice();
  }

  function cloneUser(user) {
    return {
      artists: copy(user.artists),
      songs: copy(user.songs),
      keywords: copy(user.keywords),
      neverSkip: copy(user.neverSkip)
    };
  }

  function addEntry(user, kind, value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed === '') return cloneUser(user);
    const normalized = HM.text.normalize(trimmed);
    const existing = user[kind] || [];
    for (const entry of existing) {
      if (HM.text.normalize(entry) === normalized) {
        return cloneUser(user);
      }
    }
    const result = cloneUser(user);
    result[kind].push(trimmed);
    return result;
  }

  function addSong(user, title, artist) {
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    let trimmedArtist = null;
    if (typeof artist === 'string') {
      trimmedArtist = artist.trim() || null; // blank artist: the song matches by title alone
    }
    if (trimmedTitle === '') {
      return cloneUser(user);
    }
    const normTitle = HM.text.normalize(trimmedTitle);
    const normArtist = HM.text.normalize(trimmedArtist || '');
    const existing = user.songs || [];
    for (const entry of existing) {
      let entryArtist = entry.artist;
      if (typeof entryArtist === 'string') {
        entryArtist = entryArtist.trim();
      }
      if (entryArtist === '') {
        entryArtist = null;
      }
      if (HM.text.normalize(entry.title) === normTitle && HM.text.normalize(entryArtist || '') === normArtist) {
        return cloneUser(user);
      }
    }
    const result = cloneUser(user);
    result.songs.push({ title: trimmedTitle, artist: trimmedArtist });
    return result;
  }

  function removeEntry(user, kind, index) {
    const existing = user[kind] || [];
    if (index < 0 || index >= existing.length) {
      return cloneUser(user);
    }
    const result = cloneUser(user);
    result[kind].splice(index, 1);
    return result;
  }

  function slugify(name) {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function addFilterList(lists, url, name, options) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      throw new Error('Use an https:// address');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Use an https:// address');
    }

    const existingLists = lists || [];
    for (const list of existingLists) {
      if (list.url === url) {
        throw new Error('That list is already added');
      }
    }

    let listName = typeof name === 'string' ? name.trim() : '';
    if (listName === '') {
      listName = parsedUrl.hostname;
    }

    let id = slugify(listName);
    if (id === '') {
      id = 'list';
    }

    let suffix = 1;
    let finalId = id;
    while (existingLists.some(function (l) {
      return l.id === finalId;
    })) {
      suffix++;
      finalId = id + '-' + suffix;
    }

    const newList = {
      id: finalId,
      name: listName,
      url: url,
      enabled: true,
      // Watch only until the person has seen what it matches, unless they chose to act at
      // once (Wai, 2026-11-13).
      mode: options && options.act ? 'act' : 'watch',
      builtIn: false,
      lastRefresh: null,
      count: 0,
      lastError: null
    };

    return copy(existingLists).concat([newList]);
  }

  function removeFilterList(lists, id) {
    const existingLists = lists || [];
    for (const list of existingLists) {
      if (list.id === id) {
        if (list.builtIn) {
          throw new Error('Built-in lists can be switched off but not removed');
        }
        const result = existingLists.filter(function (l) {
          return l.id !== id;
        });
        return result;
      }
    }
    return copy(existingLists);
  }

  // --- the log view ---------------------------------------------------------------
  // Grouped by artist so nothing repeats (Wai, 2026-11-15: "grouping should be done by
  // artist" / "avoid repeating text in logs"), within one of the three sections.

  function artistOf(entry) {
    return globalThis.HM.text.leadCredit(entry.artistLine) || entry.entry || 'Unknown artist';
  }

  // groups: [{ artist, reason, onNeverSkip, total, last, items: [{ title, action, count, at }] }],
  // artists by newest entry, songs newest first; a song repeated is one item with a count.
  function groupLog(entries, opts) {
    const o = opts || {};
    const N = globalThis.HM.text.normalize;
    const never = new Set((o.neverSkip || []).map(N));
    const groups = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || (o.section && globalThis.HM.log.section(entry.event) !== o.section)) continue;
      const artist = artistOf(entry);
      const key = N(artist) + '|' + (entry.listId || '');
      let g = groups.get(key);
      if (!g) {
        g = { artist, reason: globalThis.HM.log.reason(entry), onNeverSkip: never.has(N(artist)), total: 0, last: 0, items: [], byItem: new Map() };
        groups.set(key, g);
      }
      g.total++;
      g.last = Math.max(g.last, entry.at || 0);
      const action = globalThis.HM.log.action(entry.event);
      const itemKey = N(entry.title || '') + '|' + action;
      let item = g.byItem.get(itemKey);
      if (!item) { item = { title: entry.title || '', action, count: 0, at: 0 }; g.byItem.set(itemKey, item); g.items.push(item); }
      item.count++;
      item.at = Math.max(item.at, entry.at || 0);
    }
    const out = [...groups.values()];
    for (const g of out) { delete g.byItem; g.items.sort((a, b) => b.at - a.at); }
    return out.sort((a, b) => b.last - a.last);
  }

  function sectionCounts(entries) {
    const c = { blocks: 0, actions: 0, errors: 0 };
    for (const e of Array.isArray(entries) ? entries : []) if (e) c[globalThis.HM.log.section(e.event)]++;
    return c;
  }

  function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

  // "just now", "5 min ago", today's time, "Yesterday", then "Nov 12".
  function timeLabel(at, now) {
    const diff = now - at;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    const today = startOfDay(now);
    if (at >= today) return new Date(at).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
    if (at >= today - 86400000) return 'Yesterday';
    return new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  // Today's songs skipped (or disliked) and removed from the queue, for the header.
  function todaySummary(entries, now) {
    const today = startOfDay(now);
    const s = { skipped: 0, removed: 0 };
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || (e.at || 0) < today) continue;
      if (e.event === 'skipped' || e.event === 'disliked') s.skipped++;
      else if (e.event === 'removed') s.removed++;
    }
    return s;
  }

  globalThis.HM.popup = {
    groupLog: groupLog,
    sectionCounts: sectionCounts,
    timeLabel: timeLabel,
    todaySummary: todaySummary,
    addEntry: addEntry,
    addSong: addSong,
    removeEntry: removeEntry,
    addFilterList: addFilterList,
    removeFilterList: removeFilterList
  };
})();
