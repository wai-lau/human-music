(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

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

  const HM_VERDICTS = {
    id: 'hm-verdicts',
    name: 'Human Music verdicts',
    // Its own repo (Wai, 2026-11-17): the investigator's GitHub key can write only there.
    url: 'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/verdicts.json',
    enabled: true,
    mode: 'act',
    builtIn: true,
    lastRefresh: null,
    count: 0,
    lastError: null
  };

  const CEVVAL = {
    id: 'cevval',
    name: 'Cevval AI music list',
    url: 'https://raw.githubusercontent.com/cevvalkoala/CevvalYoutubeAIBlocklist/main/CevvalYoutubeAIblocklist.txt',
    enabled: true,
    mode: 'act',
    builtIn: true,
    format: 'text',
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

  const YT_CHANNEL_RE = /^UC[\w-]{22}$/;
  const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

  function parseFilterList(data) {
    if (Array.isArray(data)) {
      return { artists: parseEntries(data) };
    }
    if (data && typeof data === 'object' && data.artists && Array.isArray(data.artists)) {
      const out = { artists: parseEntries(data.artists) };
      if (typeof data.calibrated === 'boolean') {
        out.calibrated = data.calibrated;
      }
      return out;
    }
    return null;
  }

  function parseEntries(entries) {
    const artists = [];
    for (const entry of entries) {
      if (typeof entry === 'string' && entry !== '') {
        artists.push({ name: entry });
      } else if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name !== '') {
        if (entry.removed) continue;
        const artist = { name: entry.name };
        if (typeof entry.channelId === 'string' && entry.channelId !== '') {
          artist.channelId = entry.channelId;
        } else if (typeof entry.youtube === 'string' && YT_CHANNEL_RE.test(entry.youtube)) {
          artist.channelId = entry.youtube;
        }
        if (typeof entry.spotifyId === 'string' && entry.spotifyId !== '' && SPOTIFY_ID_RE.test(entry.spotifyId)) {
          artist.spotifyId = entry.spotifyId;
        } else if (typeof entry.spotify === 'string' && SPOTIFY_ID_RE.test(entry.spotify)) {
          artist.spotifyId = entry.spotify;
        }
        if (entry.verdict === 'ai' || entry.verdict === 'human' || entry.verdict === 'unsure') {
          artist.verdict = entry.verdict;
        }
        if (typeof entry.confidence === 'number' && isFinite(entry.confidence)) {
          const c = Math.round(entry.confidence);
          artist.confidence = Math.max(0, Math.min(100, c));
        }
        artists.push(artist);
      }
    }
    return artists;
  }

  function isRefreshDue(lastRefresh, frequency, now) {
    if (lastRefresh == null) return true;
    let interval = undefined;
    if (Object.prototype.hasOwnProperty.call(FREQUENCIES, frequency)) {
      interval = FREQUENCIES[frequency];
    }
    // A time ahead of now (the clock was corrected) is no proof of a recent refresh.
    if (typeof lastRefresh === 'number' && lastRefresh > now && interval !== Infinity) return true;
    if (interval === undefined) {
      return now - lastRefresh >= FREQUENCIES.daily;
    }
    return now - lastRefresh >= interval;
  }

  function filterStrings(arr) {
    const result = [];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (typeof entry === 'string' && entry !== '') {
          result.push(entry);
        }
      }
    }
    return result;
  }

  function importBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Not a Human Music or YTM blocker backup');
    }
    if (data.format === 'human-music-backup') {
      if (data.version !== 1) {
        throw new Error('Unsupported Human Music backup version');
      }
      const rawUser = data.user || {};
      const artists = filterStrings(rawUser.artists);
      const keywords = filterStrings(rawUser.keywords);
      const neverSkip = filterStrings(rawUser.neverSkip);
      const songs = [];
      if (Array.isArray(rawUser.songs)) {
        for (const entry of rawUser.songs) {
          if (entry && typeof entry === 'object' && typeof entry.title === 'string' && entry.title !== '') {
            songs.push(entry);
          }
        }
      }
      return {
        user: { artists, songs, keywords, neverSkip },
        settings: data.settings || {},
        filterLists: Array.isArray(data.filterLists) ? data.filterLists : []
      };
    }
    const oldStyle = (Array.isArray(data.blockedArtists) ||
      Array.isArray(data.blockedKeywords) ||
      Array.isArray(data.blockedTracks));
    if (!oldStyle) {
      throw new Error('Not a Human Music or YTM blocker backup');
    }
    const artists = [];
    if (Array.isArray(data.blockedArtists)) {
      for (const entry of data.blockedArtists) {
        if (typeof entry === 'string' && entry !== '' && entry.trim() !== '') {
          artists.push(entry);
        }
      }
    }
    const keywords = filterStrings(data.blockedKeywords);
    const songs = [];
    if (Array.isArray(data.blockedTracks)) {
      for (const entry of data.blockedTracks) {
        if (typeof entry === 'string' && entry !== '' && entry.trim() !== '') {
          songs.push({ title: entry, artist: null });
        } else if (entry && typeof entry === 'object' && typeof entry.title === 'string' && entry.title !== '') {
          let artist = null;
          if (typeof entry.artist === 'string' && entry.artist !== 'Manual Entry' && entry.artist.trim() !== '') {
            artist = globalThis.HM.text.leadCredit(entry.artist);
            if (artist === '') artist = null;
          }
          songs.push({ title: entry.title, artist: artist });
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

  function dedupe(arr, keyFn) {
    const seen = new Set();
    const result = [];
    for (const entry of arr) {
      const key = keyFn(entry);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry);
      }
    }
    return result;
  }

  function mergeUser(a, b) {
    const artists = dedupe([...a.artists, ...b.artists], x => globalThis.HM.text.normalize(x));
    function songKey(entry) {
      let artist = entry.artist;
      if (typeof artist === 'string') {
        artist = globalThis.HM.text.leadCredit(artist);
      }
      return globalThis.HM.text.normalize(entry.title) + '|' + globalThis.HM.text.normalize(artist || '');
    }
    const songs = dedupe([...a.songs, ...b.songs], songKey);
    const keywords = dedupe([...a.keywords, ...b.keywords], x => globalThis.HM.text.normalize(x));
    const neverSkip = dedupe([...a.neverSkip, ...b.neverSkip], x => globalThis.HM.text.normalize(x));
    return { artists, songs, keywords, neverSkip };
  }

  // Apply an imported backup (the result of importBackup) to the current state.
  // Your lists are merged (a union); settings in the backup replace those keys;
  // known filter lists take the backup's on/off and mode, and lists the state
  // doesn't have arrive switched off.
  // Returns a new { user, settings, filterLists }; the inputs are not changed.
  function applyBackup(current, imported) {
    const user = mergeUser({ ...HM.store.emptyUser(), ...(current.user || {}) }, { ...HM.store.emptyUser(), ...(imported.user || {}) });
    const settings = imported.settings ? { ...(current.settings || {}), ...imported.settings } : { ...(current.settings || {}) };
    let lists = (current.filterLists || []).map(l => ({ ...l }));
    if (Array.isArray(imported.filterLists)) {
      lists = lists.map(l => {
        const b = imported.filterLists.find(x => x && x.id === l.id);
        return b ? { ...l, enabled: !!b.enabled, mode: b.mode === 'watch' ? 'watch' : 'act' } : l;
      });
      for (const b of imported.filterLists) {
        if (!b || b.builtIn || typeof b.url !== 'string' || !/^https:\/\//.test(b.url)) continue;
        if (lists.some(l => l.id === b.id || l.url === b.url)) continue;
        lists.push({ id: String(b.id), name: String(b.name || b.id), url: b.url, enabled: false,
          mode: b.mode === 'watch' ? 'watch' : 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null });
      }
    }
    return { user, settings, filterLists: lists };
  }

  // A short, stable fingerprint of a text (FNV-1a, 32 bit), to tell whether a
  // bundled list file changed since it was last imported.
  function fingerprint(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0') + ':' + text.length;
  }

  function parseFilterText(text) {
    const artists = [];
    const seen = new Set();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '' || line.startsWith('!')) continue;
      const m = line.match(/UC[\w-]{22}/g);
      if (m) {
        for (let j = 0; j < m.length; j++) {
          if (!seen.has(m[j])) {
            seen.add(m[j]);
            artists.push({ channelId: m[j] });
          }
        }
      }
    }
    return { artists: artists };
  }

  globalThis.HM.lists = {
    SOUL_OVER_AI: SOUL_OVER_AI,
    HM_VERDICTS: HM_VERDICTS,
    CEVVAL: CEVVAL,
    FREQUENCIES: FREQUENCIES,
    parseFilterList: parseFilterList,
    parseFilterText: parseFilterText,
    isRefreshDue: isRefreshDue,
    importBackup: importBackup,
    exportBackup: exportBackup,
    mergeUser: mergeUser,
    applyBackup: applyBackup,
    fingerprint: fingerprint
  };
})();
