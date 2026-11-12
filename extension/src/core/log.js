(function () {
  globalThis.HM = globalThis.HM || {};

  function makeEntry({ event, song, match, at }) {
    return {
      at: at,
      event: event,
      title: song ? song.title : '',
      artistLine: song ? song.artistLine : '',
      listId: match ? match.listId : null,
      listName: match ? match.listName : null,
      rule: match ? match.rule : null,
      entry: match ? match.entry : null
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

  globalThis.HM.log = { makeEntry, describe, append, seenRecently };
})();