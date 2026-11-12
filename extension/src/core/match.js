(function () {
  globalThis.HM = globalThis.HM || {};
  const { normalize, credits, wholeWord } = globalThis.HM.text;

  function buildIndex({ filterLists, user }) {
    const actArtists = new Map();
    const actChannels = new Map();
    const watchArtists = new Map();
    const watchChannels = new Map();

    for (const list of filterLists) {
      if (!list.enabled) continue;
      const data = list.data || { artists: [] };
      for (const a of data.artists) {
        const key = normalize(a.name);
        if (a.channelId) {
          if (list.mode === 'act') actChannels.set(a.channelId, { listId: list.id, listName: list.name, entry: a.name });
          else watchChannels.set(a.channelId, { listId: list.id, listName: list.name, entry: a.name });
        }
        if (list.mode === 'act') actArtists.set(key, { listId: list.id, listName: list.name, entry: a.name });
        else watchArtists.set(key, { listId: list.id, listName: list.name, entry: a.name });
      }
    }

    const userArtists = (user.artists || []).map(a => ({ key: normalize(a), name: a }));
    const userSongs = (user.songs || []).map(s => ({ title: normalize(s.title), artist: s.artist ? normalize(s.artist) : null, original: s }));
    const userKeywords = (user.keywords || []).map(k => ({ key: normalize(k), name: k, regex: wholeWord(k) }));
    const neverSkip = new Set((user.neverSkip || []).map(a => normalize(a)));

    return {
      actArtists, actChannels, watchArtists, watchChannels,
      userArtists, userSongs, userKeywords, neverSkip,
    };
  }

  function matchSong(index, song) {
    const s = song || {};
    const title = s.title || '';
    const artistLine = s.artistLine || '';
    const channelIds = s.channelIds || [];
    const songCredits = credits(artistLine);

    for (const credit of songCredits) {
      if (index.neverSkip.has(credit)) return null;
    }

    for (const songEntry of index.userSongs) {
      if (normalize(title) === songEntry.title) {
        if (songEntry.artist) {
          if (songCredits.includes(songEntry.artist)) {
            return { listId: 'user:songs', listName: 'Your songs', rule: 'song', entry: songEntry.original.title, mode: 'act' };
          }
        } else {
          return { listId: 'user:songs', listName: 'Your songs', rule: 'song', entry: songEntry.original.title, mode: 'act' };
        }
      }
    }

    for (const artistEntry of index.userArtists) {
      if (songCredits.includes(artistEntry.key)) {
        return { listId: 'user:artists', listName: 'Your artists', rule: 'artist', entry: artistEntry.name, mode: 'act' };
      }
    }

    for (const kw of index.userKeywords) {
      if (kw.regex.test(title) || kw.regex.test(artistLine)) {
        return { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword', entry: kw.name, mode: 'act' };
      }
    }

    for (const credit of songCredits) {
      if (index.actArtists.has(credit)) {
        const act = index.actArtists.get(credit);
        return { listId: act.listId, listName: act.listName, rule: 'artist', entry: act.entry, mode: 'act' };
      }
    }
    for (const ch of channelIds) {
      if (index.actChannels.has(ch)) {
        const act = index.actChannels.get(ch);
        return { listId: act.listId, listName: act.listName, rule: 'channel', entry: act.entry, mode: 'act' };
      }
    }
    for (const credit of songCredits) {
      if (index.watchArtists.has(credit)) {
        const watch = index.watchArtists.get(credit);
        return { listId: watch.listId, listName: watch.listName, rule: 'artist', entry: watch.entry, mode: 'watch' };
      }
    }
    for (const ch of channelIds) {
      if (index.watchChannels.has(ch)) {
        const watch = index.watchChannels.get(ch);
        return { listId: watch.listId, listName: watch.listName, rule: 'channel', entry: watch.entry, mode: 'watch' };
      }
    }

    return null;
  }

  function matchItem(index, item) {
    const i = item || {};
    const title = i.title || '';
    const creditsList = i.credits || [];
    const channelIds = i.channelIds || [];
    const featured = i.featured;

    const normCredits = creditsList.map(normalize);

    for (const credit of normCredits) {
      if (index.neverSkip.has(credit)) return null;
    }

    if (featured) {
      let allListed = true;
      let anyMatch = false;
      let firstMatch = null;
      for (const credit of normCredits) {
        if (index.actArtists.has(credit) || index.watchArtists.has(credit)) {
          anyMatch = true;
          if (!firstMatch) firstMatch = credit;
        } else {
          allListed = false;
        }
      }
      if (allListed && anyMatch) {
        if (index.actArtists.has(firstMatch)) {
          const m = index.actArtists.get(firstMatch);
          return { listId: m.listId, listName: m.listName, rule: 'artist', entry: m.entry, mode: 'act' };
        } else {
          const m = index.watchArtists.get(firstMatch);
          return { listId: m.listId, listName: m.listName, rule: 'artist', entry: m.entry, mode: 'watch' };
        }
      }
      return null;
    }

    for (const songEntry of index.userSongs) {
      if (normalize(title) === songEntry.title) {
        if (songEntry.artist) {
          if (normCredits.includes(songEntry.artist)) {
            return { listId: 'user:songs', listName: 'Your songs', rule: 'song', entry: songEntry.original.title, mode: 'act' };
          }
        } else {
          return { listId: 'user:songs', listName: 'Your songs', rule: 'song', entry: songEntry.original.title, mode: 'act' };
        }
      }
    }

    for (const credit of normCredits) {
      for (const artistEntry of index.userArtists) {
        if (credit === artistEntry.key) {
          return { listId: 'user:artists', listName: 'Your artists', rule: 'artist', entry: artistEntry.name, mode: 'act' };
        }
      }
    }

    for (const kw of index.userKeywords) {
      if (kw.regex.test(title)) {
        return { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword', entry: kw.name, mode: 'act' };
      }
      for (const credit of creditsList) {
        if (kw.regex.test(credit)) {
          return { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword', entry: kw.name, mode: 'act' };
        }
      }
    }

    for (const credit of normCredits) {
      const act = index.actArtists.get(credit);
      if (act) return { listId: act.listId, listName: act.listName, rule: 'artist', entry: act.entry, mode: 'act' };
    }
    for (const ch of channelIds) {
      const act = index.actChannels.get(ch);
      if (act) return { listId: act.listId, listName: act.listName, rule: 'channel', entry: act.entry, mode: 'act' };
    }
    for (const credit of normCredits) {
      const watch = index.watchArtists.get(credit);
      if (watch) return { listId: watch.listId, listName: watch.listName, rule: 'artist', entry: watch.entry, mode: 'watch' };
    }
    for (const ch of channelIds) {
      const watch = index.watchChannels.get(ch);
      if (watch) return { listId: watch.listId, listName: watch.listName, rule: 'channel', entry: watch.entry, mode: 'watch' };
    }

    return null;
  }

  globalThis.HM.match = { buildIndex, matchSong, matchItem };
})();