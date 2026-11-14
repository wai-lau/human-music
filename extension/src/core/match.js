(function () {
  globalThis.HM = globalThis.HM || {};
  const { normalize, credits, wholeWord } = globalThis.HM.text;

  function result(listId, listName, rule, entry, mode) {
    return { listId, listName, rule, entry, mode };
  }

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
        const entry = { listId: list.id, listName: list.name, entry: a.name };
        if (list.mode === 'act') {
          if (a.channelId) actChannels.set(a.channelId, entry);
          if (a.spotifyId) actChannels.set(a.spotifyId, entry);
          actArtists.set(key, entry);
        } else {
          if (a.channelId) watchChannels.set(a.channelId, entry);
          if (a.spotifyId) watchChannels.set(a.spotifyId, entry);
          watchArtists.set(key, entry);
        }
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

  // The rules in order, after Never skip: your songs, your artists, your keywords, then act
  // lists (name, then channel ID), then watch lists. Each rule tests only its own field (Wai,
  // 2026-11-13: "match correct fields in general, e.g. album to album, artist to artist"):
  // keywords see the title and the credited artists, never the album or year.
  function matchChain(index, title, normalizedCreditedArtists, channelIds) {
    for (const songEntry of index.userSongs) {
      if (normalize(title) === songEntry.title) {
        if (songEntry.artist) {
          if (normalizedCreditedArtists.includes(songEntry.artist)) {
            return result('user:songs', 'Your songs', 'song', songEntry.original.title, 'act');
          }
        } else {
          return result('user:songs', 'Your songs', 'song', songEntry.original.title, 'act');
        }
      }
    }

    for (const artistEntry of index.userArtists) {
      if (normalizedCreditedArtists.includes(artistEntry.key)) {
        return result('user:artists', 'Your artists', 'artist', artistEntry.name, 'act');
      }
    }

    for (const kw of index.userKeywords) {
      if (kw.regex.test(normalize(title)) || normalizedCreditedArtists.some(c => kw.regex.test(c))) {
        return result('user:keywords', 'Your keywords', 'keyword', kw.name, 'act');
      }
    }

    for (const credit of normalizedCreditedArtists) {
      if (index.actArtists.has(credit)) {
        const act = index.actArtists.get(credit);
        return result(act.listId, act.listName, 'artist', act.entry, 'act');
      }
    }
    for (const ch of channelIds) {
      if (index.actChannels.has(ch)) {
        const act = index.actChannels.get(ch);
        return result(act.listId, act.listName, 'channel', act.entry, 'act');
      }
    }
    for (const credit of normalizedCreditedArtists) {
      if (index.watchArtists.has(credit)) {
        const watch = index.watchArtists.get(credit);
        return result(watch.listId, watch.listName, 'artist', watch.entry, 'watch');
      }
    }
    for (const ch of channelIds) {
      if (index.watchChannels.has(ch)) {
        const watch = index.watchChannels.get(ch);
        return result(watch.listId, watch.listName, 'channel', watch.entry, 'watch');
      }
    }

    return null;
  }

  function matchSong(index, song) {
    const s = song || {};
    const title = s.title || '';
    const artistLine = s.artistLine || '';
    const channelIds = s.channelIds || [];
    const normalizedCreditedArtists = credits(artistLine);

    for (const credit of normalizedCreditedArtists) {
      if (index.neverSkip.has(credit)) return null;
    }

    return matchChain(index, title, normalizedCreditedArtists, channelIds);
  }

  function matchItem(index, item) {
    const i = item || {};
    const title = i.title || '';
    const creditsList = i.credits || [];
    const channelIds = i.channelIds || [];
    const featured = i.featured;
    const normalizedCredits = creditsList.map(normalize);

    for (const credit of normalizedCredits) {
      if (index.neverSkip.has(credit)) return null;
    }

    // A mix card (featured artists) matches only when every credit is listed: one person in
    // the mix keeps it. It acts only if every credit is on your artists or an act list;
    // otherwise (some only on watch lists) it is a watch match.
    if (featured) {
      if (normalizedCredits.length === 0) return null;
      const found = [];
      for (const credit of normalizedCredits) {
        const mine = index.userArtists.find(a => a.key === credit);
        if (mine) found.push(result('user:artists', 'Your artists', 'artist', mine.name, 'act'));
        else if (index.actArtists.has(credit)) {
          const act = index.actArtists.get(credit);
          found.push(result(act.listId, act.listName, 'artist', act.entry, 'act'));
        }
        else if (index.watchArtists.has(credit)) {
          const watch = index.watchArtists.get(credit);
          found.push(result(watch.listId, watch.listName, 'artist', watch.entry, 'watch'));
        }
        else return null;
      }
      const first = found.every(f => f.mode === 'act') ? found[0] : found.find(f => f.mode === 'watch');
      return result(first.listId, first.listName, 'artist', first.entry, first.mode);
    }

    return matchChain(index, title, normalizedCredits, channelIds);
  }

  globalThis.HM.match = { buildIndex, matchSong, matchItem };
})();
