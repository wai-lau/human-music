(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

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

  globalThis.HM.log = { makeEntry, describe, section, action, reason, append, seenRecently };
})();
