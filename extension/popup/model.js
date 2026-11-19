(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

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
      throw new Error('Use an https:// address', { cause: e });
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
      // A new list acts at once; it can be switched off in its row (Wai, 2026-11-19: "remove the
      // watch only toggle, people can just turn of their list"; it started in Watch only before).
      mode: 'act',
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

  // The artist a log group is about, which "Always show" puts on Never skip: for an artist or
  // channel match, the listed artist that matched (review 2026-11-17: the whole credit line of
  // a duet, "Some Person, The Velvet Sundown", protected nobody while the switch showed on);
  // otherwise, or for a bare channel ID, the first credited artist.
  const CHANNEL_ID = /^UC[\w-]{22}$/;
  function artistOf(entry) {
    const named = (entry.rule === 'artist' || entry.rule === 'channel') && typeof entry.entry === 'string'
      && entry.entry.trim() && !CHANNEL_ID.test(entry.entry.trim());
    if (named) return entry.entry.trim();
    const T = globalThis.HM.text;
    const lead = T.leadCredit(entry.artistLine);
    const first = lead ? (T.splitNames(lead)[0] || lead) : '';
    return first || entry.entry || 'Unknown artist';
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

  // A list's or the investigator's last error in plain words (review 2026-11-17: raw text such
  // as "TypeError: Failed to fetch" showed in the popup). Unknown text is kept, shortened.
  function plainError(message) {
    const m = typeof message === 'string' ? message.trim() : '';
    if (!m) return 'unknown problem';
    const http = /^HTTP (\d{3})/.exec(m);
    if (http) {
      const code = http[1];
      if (code === '404' || code === '410') return `the address was not found (HTTP ${code})`;
      if (code === '401' || code === '403') return `the server refused it (HTTP ${code})`;
      if (code[0] === '5') return `the server had a problem; it will be tried again (HTTP ${code})`;
      return `the server said no (HTTP ${code})`;
    }
    if (/over \d+ bytes/i.test(m)) return 'the list is over 5 MB, the most a list can be';
    if (/^Not a filter list|JSON|Unexpected token/i.test(m)) return 'the file there isn\u2019t a filter list';
    if (/^Not an https/i.test(m)) return 'the address must start with https://';
    if (/timeout|timed out|aborted/i.test(m)) return 'it took too long to answer';
    if (/Failed to fetch|NetworkError|network|ERR_/i.test(m)) return 'couldn\u2019t reach it (offline, or the site is down)';
    return m.length > 80 ? m.slice(0, 79) + '\u2026' : m;
  }

  const MODE_NAMES = { off: 'No filtering', lists: 'List only', optimal: 'Optimal', aggressive: 'Aggressive' };
  const TOGGLE_NAMES = { autoSkip: 'Skip a listed song that starts', autoDislike: 'Also dislike it', hidePageItems: 'Hide listed artists on pages', playerButtons: 'Block artist button on the player' };
  const REFRESH_NAMES = { '6h': 'Every 6 hours', '12h': 'Every 12 hours', daily: 'Daily', weekly: 'Weekly', manual: 'Only when I ask' };
  function importChanges(current, data) {
    const changes = [];
    const cur = current.settings || {};
    const imp = data.settings || {};
    if (imp.autoSkip !== undefined && cur.autoSkip !== imp.autoSkip) changes.push(`${TOGGLE_NAMES.autoSkip}: ${cur.autoSkip ? 'on' : 'off'} becomes ${imp.autoSkip ? 'on' : 'off'}`);
    if (imp.autoDislike !== undefined && cur.autoDislike !== imp.autoDislike) changes.push(`${TOGGLE_NAMES.autoDislike}: ${cur.autoDislike ? 'on' : 'off'} becomes ${imp.autoDislike ? 'on' : 'off'}`);
    if (imp.hidePageItems !== undefined && cur.hidePageItems !== imp.hidePageItems) changes.push(`${TOGGLE_NAMES.hidePageItems}: ${cur.hidePageItems ? 'on' : 'off'} becomes ${imp.hidePageItems ? 'on' : 'off'}`);
    if (imp.playerButtons !== undefined && cur.playerButtons !== imp.playerButtons) changes.push(`${TOGGLE_NAMES.playerButtons}: ${cur.playerButtons ? 'on' : 'off'} becomes ${imp.playerButtons ? 'on' : 'off'}`);
    if (imp.lookahead !== undefined && cur.lookahead !== imp.lookahead) changes.push(`Check songs ahead in the queue: ${cur.lookahead} becomes ${imp.lookahead}`);
    if (imp.refresh !== undefined && cur.refresh !== imp.refresh) changes.push(`Update lists: ${REFRESH_NAMES[cur.refresh]} becomes ${REFRESH_NAMES[imp.refresh]}`);
    if (imp.paused !== undefined && cur.paused !== imp.paused) changes.push(`Paused: ${cur.paused ? 'on' : 'off'} becomes ${imp.paused ? 'on' : 'off'}`);
    if (imp.mode !== undefined && cur.mode !== imp.mode) {
      changes.push(`Filtering mode: ${MODE_NAMES[cur.mode]} becomes ${MODE_NAMES[imp.mode]}`);
    }
    const curLists = current.filterLists || [];
    const impLists = data.filterLists || [];
    for (const l of curLists) {
      const b = impLists.find(x => x && x.id === l.id);
      if (b) {
        // A backup's Watch only list comes in off (there is no Watch only any more), as
        // applyBackup reads it.
        const bOn = !!b.enabled && b.mode !== 'watch';
        if (l.enabled !== bOn) changes.push(`${l.name}: ${l.enabled ? 'on' : 'off'} becomes ${bOn ? 'on' : 'off'}`);
      }
    }
    for (const b of impLists) {
      if (!b || b.builtIn || typeof b.url !== 'string' || !/^https:\/\//.test(b.url)) continue;
      if (curLists.some(l => l.id === b.id || l.url === b.url)) continue;
      changes.push(`Add list: ${b.name || b.id}`);
    }
    return changes;
  }

  globalThis.HM.popup = {
    plainError: plainError,
    groupLog: groupLog,
    sectionCounts: sectionCounts,
    timeLabel: timeLabel,
    todaySummary: todaySummary,
    addEntry: addEntry,
    addSong: addSong,
    removeEntry: removeEntry,
    addFilterList: addFilterList,
    removeFilterList: removeFilterList,
    importChanges: importChanges
  };
})();
