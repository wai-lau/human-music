(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};
  const { normalize, credits, wholeWord } = globalThis.HM.text;

  function result(listId, listName, rule, entry, mode, confidence) {
    const r = { listId, listName, rule, entry, mode };
    if (confidence !== undefined) r.confidence = confidence;
    return r;
  }

  // Names too common or too empty to stand for one artist on a shared list. Your own lists are
  // exempt; a list entry that has an ID can still match by it.
  const GENERIC = new Set(['the', 'a', 'an', 'va', 'various', 'various artists', 'unknown', 'unknown artist', 'artist', 'youtube music', 'spotify']);
  function genericKey(key) {
    return key.length < 2 || !/[\p{L}\p{N}]/u.test(key) || GENERIC.has(key);
  }
  const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
  const YT_ID = /^UC[\w-]{22}$/;

  function buildIndex({ filterLists, user, threshold }) {
    const actArtists = new Map();
    const actChannels = new Map();
    const watchArtists = new Map();
    const watchChannels = new Map();
    // Every entry on every enabled list is "known", regardless of threshold:
    // list-only mode still sees them, and we can tell unknown artists from ones
    // that have a low-confidence verdict.
    const known = new Set();

    // A verdicts name that also belongs to a person (verdict human or unsure) is matched by ID only.
    const shared = new Set();
    for (const list of filterLists) {
      if (!list.enabled || list.id !== 'hm-verdicts' || !Array.isArray(list.artists)) continue;
      for (const a of list.artists) {
        if (a && typeof a.name === 'string' && a.verdict !== 'ai') shared.add(normalize(a.name));
      }
    }

    for (const list of filterLists) {
      if (!list.enabled) continue;
      const artists = Array.isArray(list.artists) ? list.artists : [];
      for (const a of artists) {
        if (!a) continue;
        const name = typeof a.name === 'string' ? a.name : '';
        // An idOnly entry is matched by its IDs only: its name may belong to someone else too.
        const nameKey = name ? normalize(name) : null;
        if (nameKey && !a.idOnly) known.add(nameKey);
        const key = nameKey && !a.idOnly && !genericKey(nameKey) && !(list.id === 'hm-verdicts' && shared.has(nameKey)) ? nameKey : null;

        if (a.channelId) known.add(a.channelId);
        if (a.spotifyId) known.add(a.spotifyId);

        // The verdict list only blocks at the mode's confidence threshold.
        let confidence;
        if (list.id === 'hm-verdicts') {
          if (threshold === null || threshold === undefined) continue;
          if (a.verdict !== 'ai') continue;
          if (typeof a.confidence !== 'number' || a.confidence < threshold) continue;
          confidence = a.confidence;
        }

        const entry = { listId: list.id, listName: list.name, entry: name || a.channelId || a.spotifyId };
        if (confidence !== undefined) entry.confidence = confidence;
        if (a.channelId) entry.channelId = a.channelId;
        if (a.spotifyId) entry.spotifyId = a.spotifyId;
        if (list.mode === 'act') {
          if (a.channelId) actChannels.set(a.channelId, entry);
          if (a.spotifyId) actChannels.set(a.spotifyId, entry);
          if (key) actArtists.set(key, entry);
        } else {
          if (a.channelId) watchChannels.set(a.channelId, entry);
          if (a.spotifyId) watchChannels.set(a.spotifyId, entry);
          if (key) watchArtists.set(key, entry);
        }
      }
    }

    const userArtists = (user.artists || []).map(a => ({ key: normalize(a), name: a }));
    userArtists.forEach(a => known.add(a.key));
    // A song whose title is empty after normalising would match every row whose title isn't
    // drawn yet (review 2026-11-17): dropped, like empty keywords.
    const userSongs = (user.songs || []).map(s => ({ title: normalize(s && s.title), artist: s && s.artist ? normalize(s.artist) : null, original: s })).filter(s => s.title);
    // An empty keyword would match every song, so empties are dropped.
    const userKeywords = (user.keywords || []).filter(k => normalize(k)).map(k => ({ key: normalize(k), name: k, regex: wholeWord(k) }));
    const neverSkip = new Set((user.neverSkip || []).map(a => normalize(a)));
    neverSkip.forEach(a => known.add(a));

    return {
      actArtists, actChannels, watchArtists, watchChannels,
      userArtists, userSongs, userKeywords, neverSkip,
      known,
    };
  }

  function isKnown(index, item) {
    const i = item || {};
    const creditsList = i.credits || [];
    const channelIds = i.channelIds || [];
    for (const credit of creditsList) {
      if (index.known.has(normalize(credit))) return true;
    }
    for (const id of channelIds) {
      if (index.known.has(id)) return true;
    }
    return false;
  }

  // The rules in order, after Never skip: your songs, your artists, your keywords, then act
  // lists (name, then channel ID), then watch lists. Each rule tests only its own field (Wai,
  // 2026-11-13: "match correct fields in general, e.g. album to album, artist to artist"):
  // keywords see the title and the credited artists, never the album or year.
  // A name match gives way to IDs: when the song names artist IDs of the entry's kind and none is
  // the entry's, it is a different artist with the same name.
  function sameArtist(entry, channelIds) {
    const yt = channelIds.filter(c => YT_ID.test(c));
    const sp = channelIds.filter(c => SPOTIFY_ID.test(c));
    if (entry.channelId && yt.length && !yt.includes(entry.channelId)) return false;
    if (entry.spotifyId && sp.length && !sp.includes(entry.spotifyId)) return false;
    return true;
  }

  // songRow: the item is a song row (not an album or playlist card); a song with no artist
  // matches only those.
  function matchChain(index, title, normalizedCreditedArtists, channelIds, songRow = true) {
    for (const songEntry of index.userSongs) {
      if (normalize(title) === songEntry.title) {
        if (songEntry.artist) {
          if (normalizedCreditedArtists.includes(songEntry.artist)) {
            return result('user:songs', 'Your songs', 'song', songEntry.original.title, 'act');
          }
        } else if (songRow) {
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
      const act = index.actArtists.get(credit);
      if (act && sameArtist(act, channelIds)) {
        return result(act.listId, act.listName, 'artist', act.entry, 'act', act.confidence);
      }
    }
    for (const ch of channelIds) {
      if (index.actChannels.has(ch)) {
        const act = index.actChannels.get(ch);
        return result(act.listId, act.listName, 'channel', act.entry, 'act', act.confidence);
      }
    }
    for (const credit of normalizedCreditedArtists) {
      const watch = index.watchArtists.get(credit);
      if (watch && sameArtist(watch, channelIds)) {
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
    const normalizedCreditedArtists = credits(artistLine, Array.isArray(s.credits) ? s.credits : null);

    for (const credit of normalizedCreditedArtists) {
      if (index.neverSkip.has(credit)) return null;
    }

    return matchChain(index, title, normalizedCreditedArtists, channelIds, true);
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
    // A mix lists every name in it (`names`); `credits` may also hold the whole line.
    const required = featured && Array.isArray(i.names) ? i.names.map(normalize) : normalizedCredits;
    if (featured) for (const name of required) if (index.neverSkip.has(name)) return null;

    // A mix card (featured artists) matches only when every credit is listed: one person in
    // the mix keeps it. It acts only if every credit is on your artists or an act list;
    // otherwise (some only on watch lists) it is a watch match.
    if (featured) {
      if (required.length === 0) return null;
      // The whole line may itself be one listed act ("Earth, Wind & Fire").
      if (i.whole) {
        const whole = matchChain(index, '', [normalize(i.whole)], [], false);
        if (whole && whole.rule === 'artist') return whole;
      }
      const found = [];
      for (const credit of required) {
        const mine = index.userArtists.find(a => a.key === credit);
        if (mine) found.push(result('user:artists', 'Your artists', 'artist', mine.name, 'act'));
        else if (index.actArtists.has(credit)) {
          const act = index.actArtists.get(credit);
          found.push(result(act.listId, act.listName, 'artist', act.entry, 'act', act.confidence));
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

    // An item credited to several artists never reaches here (it is a mix); a card for an album or
    // playlist is not a song row.
    return matchChain(index, title, normalizedCredits, channelIds, i.kind === 'song');
  }

  globalThis.HM.match = { buildIndex, matchSong, matchItem, isKnown };
})();
