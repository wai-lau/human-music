(function () {
  globalThis.HM = globalThis.HM || {};

  const SOUL_OVER_AI = {
    id: 'soul-over-ai',
    name: 'Soul Over AI',
    url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json',
    enabled: true,
    mode: 'act',
    builtIn: true,
    lastRefresh: null,
    count: 0,
    lastError: null
  };

  const FREQUENCIES = {
    '6h': 21600000,
    '12h': 43200000,
    daily: 86400000,
    weekly: 604800000,
    manual: Infinity
  };

  function parseFilterList(data) {
    if (Array.isArray(data)) {
      const artists = [];
      for (const entry of data) {
        if (typeof entry === 'string') {
          artists.push({ name: entry });
        } else if (entry && typeof entry === 'object' && typeof entry.name === 'string' && !entry.removed) {
          const artist = { name: entry.name };
          if (typeof entry.channelId === 'string' && entry.channelId !== '') {
            artist.channelId = entry.channelId;
          }
          artists.push(artist);
        }
      }
      return { artists };
    }
    if (data && typeof data === 'object' && data.artists && Array.isArray(data.artists)) {
      const artists = [];
      for (const entry of data.artists) {
        if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
          const artist = { name: entry.name };
          if (typeof entry.channelId === 'string' && entry.channelId !== '') {
            artist.channelId = entry.channelId;
          }
          artists.push(artist);
        }
      }
      return { artists };
    }
    return null;
  }

  function isRefreshDue(lastRefresh, frequency, now) {
    if (lastRefresh === null) return true;
    const interval = FREQUENCIES[frequency];
    if (interval === undefined) {
      return now - lastRefresh >= FREQUENCIES.daily;
    }
    return now - lastRefresh >= interval;
  }

  function importBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Not a Human Music or YTM blocker backup');
    }
    if (data.format === 'human-music-backup') {
      const user = {
        artists: Array.isArray(data.user.artists) ? data.user.artists : [],
        songs: Array.isArray(data.user.songs) ? data.user.songs : [],
        keywords: Array.isArray(data.user.keywords) ? data.user.keywords : [],
        neverSkip: Array.isArray(data.user.neverSkip) ? data.user.neverSkip : []
      };
      return {
        user: user,
        settings: data.settings,
        filterLists: data.filterLists
      };
    }
    const oldStyle = (Array.isArray(data.blockedArtists) ||
      Array.isArray(data.blockedKeywords) ||
      Array.isArray(data.blockedTracks));
    if (!oldStyle) {
      throw new Error('Not a Human Music or YTM blocker backup');
    }
    const artists = Array.isArray(data.blockedArtists) ? data.blockedArtists : [];
    const keywords = Array.isArray(data.blockedKeywords) ? data.blockedKeywords : [];
    const songs = [];
    if (Array.isArray(data.blockedTracks)) {
      for (const entry of data.blockedTracks) {
        if (typeof entry === 'string') {
          songs.push({ title: entry, artist: null });
        } else if (entry && typeof entry === 'object') {
          let artist = null;
          if (typeof entry.artist === 'string' && entry.artist !== 'Manual Entry' && entry.artist.trim() !== '') {
            artist = entry.artist.split(' • ')[0].trim();
            if (artist === '') artist = null;
          }
          songs.push({ title: entry.title || '', artist: artist });
        }
      }
    }
    return {
      user: {
        artists: artists,
        songs: songs,
        keywords: keywords,
        neverSkip: []
      }
    };
  }

  function exportBackup(state) {
    return {
      format: 'human-music-backup',
      version: 1,
      user: state.user,
      settings: state.settings,
      filterLists: state.filterLists.map(function (list) {
        return {
          id: list.id,
          name: list.name,
          url: list.url,
          enabled: list.enabled,
          mode: list.mode,
          builtIn: list.builtIn
        };
      })
    };
  }

  function mergeUser(a, b) {
    const artists = [];
    const seenArtists = new Set();
    for (const entry of a.artists) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenArtists.has(n)) {
        seenArtists.add(n);
        artists.push(entry);
      }
    }
    for (const entry of b.artists) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenArtists.has(n)) {
        seenArtists.add(n);
        artists.push(entry);
      }
    }

    function songKey(entry) {
      let artist = entry.artist;
      if (typeof artist === 'string') {
        artist = artist.split(' • ')[0].trim();
      }
      return globalThis.HM.text.normalize(entry.title) + '|' + globalThis.HM.text.normalize(artist || '');
    }
    const songs = [];
    const seenSongs = new Set();
    for (const entry of a.songs) {
      const n = songKey(entry);
      if (!seenSongs.has(n)) {
        seenSongs.add(n);
        songs.push(entry);
      }
    }
    for (const entry of b.songs) {
      const n = songKey(entry);
      if (!seenSongs.has(n)) {
        seenSongs.add(n);
        songs.push(entry);
      }
    }

    const keywords = [];
    const seenKeywords = new Set();
    for (const entry of a.keywords) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenKeywords.has(n)) {
        seenKeywords.add(n);
        keywords.push(entry);
      }
    }
    for (const entry of b.keywords) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenKeywords.has(n)) {
        seenKeywords.add(n);
        keywords.push(entry);
      }
    }

    const neverSkip = [];
    const seenNeverSkip = new Set();
    for (const entry of a.neverSkip) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenNeverSkip.has(n)) {
        seenNeverSkip.add(n);
        neverSkip.push(entry);
      }
    }
    for (const entry of b.neverSkip) {
      const n = globalThis.HM.text.normalize(entry);
      if (!seenNeverSkip.has(n)) {
        seenNeverSkip.add(n);
        neverSkip.push(entry);
      }
    }

    return { artists: artists, songs: songs, keywords: keywords, neverSkip: neverSkip };
  }

  globalThis.HM.lists = {
    SOUL_OVER_AI: SOUL_OVER_AI,
    FREQUENCIES: FREQUENCIES,
    parseFilterList: parseFilterList,
    isRefreshDue: isRefreshDue,
    importBackup: importBackup,
    exportBackup: exportBackup,
    mergeUser: mergeUser
  };
})();
