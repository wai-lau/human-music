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
      const artists = Array.isArray(list.artists) ? list.artists : [];
      for (const a of artists) {
        if (!a || typeof a.name !== 'string' || !normalize(a.name)) continue;
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
    // An empty keyword would match every song, so empties are dropped.
    const userKeywords = (user.keywords || []).filter(k => normalize(k)).map(k => ({ key: normalize(k), name: k, regex: wholeWord(k) }));
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
      if (kw.regex.test(normalize(title)) || kw.regex.test(normalize(artistLine))) {
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

    // A mix card (featured artists) matches only when every credit is listed: one
    // person in the mix keeps it. It acts only if every credit is on your artists
    // or an act list; otherwise (some only on watch lists) it is a watch match.
    if (featured) {
      if (normCredits.length === 0) return null;
      const found = [];
      for (const credit of normCredits) {
        const mine = index.userArtists.find(a => a.key === credit);
        if (mine) found.push({ listId: 'user:artists', listName: 'Your artists', entry: mine.name, mode: 'act' });
        else if (index.actArtists.has(credit)) found.push({ ...index.actArtists.get(credit), mode: 'act' });
        else if (index.watchArtists.has(credit)) found.push({ ...index.watchArtists.get(credit), mode: 'watch' });
        else return null;
      }
      const first = found.every(f => f.mode === 'act') ? found[0] : found.find(f => f.mode === 'watch');
      return { listId: first.listId, listName: first.listName, rule: 'artist', entry: first.entry, mode: first.mode };
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
      if (kw.regex.test(normalize(title))) {
        return { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword', entry: kw.name, mode: 'act' };
      }
      for (const credit of normCredits) {
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
