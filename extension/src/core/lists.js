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

  // Zoundhub's clearest AI flags (rating 5 with Deezer's AI label, debut 2020 or later), mirrored
  // daily into the verdicts repo (Wai, 2026-11-18: switch to Zoundhub now; "1A" a daily mirror).
  const ZOUNDHUB = {
    id: 'zoundhub',
    name: 'Zoundhub',
    url: 'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/zoundhub.json',
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

  // Zoundhub's data file (zoundhub.com/data/artists-all.json) as a Human Music list (Wai,
  // 2026-11-18: switch to Zoundhub now). Zoundhub calls its rating "an AI signal, not a verified
  // classification", and rating 4 includes real people, so only rating 5 with Deezer's own AI
  // label counts; a debut before 2020 is left out (Wai: "pre-2020, auto-allow"); and a name that
  // also belongs to an artist Zoundhub rates 1-3 (or 4 without the label) matches by Spotify ID
  // only. Returns null for anything else, or when nothing is usable.
  function isZoundhub(data) {
    return !!data && typeof data === 'object' && !Array.isArray(data) && typeof data.reference_year === 'number' && Array.isArray(data.artists);
  }
  function fromZoundhub(data) {
    if (!isZoundhub(data)) return null;
    const N = globalThis.HM.text.normalize;
    const rows = data.artists.filter(a => a && typeof a === 'object' && typeof a.name === 'string' && a.name.trim());
    const lowNames = new Set(rows.filter(a => a.rating <= 3 || (a.rating === 4 && a.deezer !== true)).map(a => N(a.name)));
    const fromYear = d => { const y = parseInt(String(d == null ? '' : d).slice(0, 4), 10); return Number.isFinite(y) ? y : null; };
    const artists = [];
    for (const a of rows) {
      if (a.rating !== 5 || a.deezer !== true || typeof a.id !== 'string' || !SPOTIFY_ID_RE.test(a.id)) continue;
      const year = fromYear(a.debut);
      if (year !== null && year < 2020) continue;
      const entry = { name: a.name.trim(), spotifyId: a.id };
      if (lowNames.has(N(a.name))) entry.idOnly = true;
      artists.push(entry);
    }
    return artists.length ? { name: 'Zoundhub', artists } : null;
  }

  const MAX_ENTRIES = 50000;
  const MAX_NAME_LENGTH = 200;
  const MAX_ADDED_AT_ONCE = 500;
  // Names that would block a lot of music if a bad line carried them.
  const COMMON_NAMES = new Set(['the', 'a', 'an', 'various artists', 'various', 'unknown artist', 'unknown', 'va', 'n/a']);
  // A usable name: not empty, not one character, has a letter or digit, not too long, not a
  // very common word (names are compared as HM.text.normalize does: NFC, lower case, spaces).
  function usableName(name) {
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) return false;
    const n = globalThis.HM.text.normalize(name);
    if (n.length < 2 || !/[\p{L}\p{N}]/u.test(n)) return false;
    return !COMMON_NAMES.has(n);
  }

  function checkUpdate(oldArtists, newArtists, wellKnownNames, wellKnownIds) {
    if (!Array.isArray(oldArtists)) oldArtists = [];
    if (!Array.isArray(newArtists)) newArtists = [];
    if (!Array.isArray(wellKnownNames)) wellKnownNames = [];
    const knownIds = new Set(Array.isArray(wellKnownIds) ? wellKnownIds.filter(x => typeof x === 'string' && x) : []);
    const N = globalThis.HM.text.normalize;
    const oldNames = new Set();
    for (const a of oldArtists) {
      if (a && typeof a.name === 'string' && a.name !== '') oldNames.add(N(a.name));
    }
    const newNames = new Set();
    for (const a of newArtists) {
      if (a && typeof a.name === 'string' && a.name !== '') newNames.add(N(a.name));
    }
    const oldIds = new Set();
    for (const a of oldArtists) {
      if (a && a.channelId) oldIds.add(a.channelId);
      if (a && a.spotifyId) oldIds.add(a.spotifyId);
    }
    for (const a of newArtists) {
      if (!a) continue;
      for (const id of [a.channelId, a.spotifyId]) {
        if (id && knownIds.has(id) && !oldIds.has(id)) return { reason: 'names a well-known artist by ID: ' + id };
      }
    }
    const added = [];
    for (const n of newNames) {
      if (!oldNames.has(n)) added.push(n);
    }
    for (const w of wellKnownNames) {
      const nw = N(w);
      if (added.includes(nw)) {
        for (const orig of wellKnownNames) {
          if (N(orig) === nw) {
            return { reason: 'names a well-known artist: ' + orig };
          }
        }
        return { reason: 'names a well-known artist: ' + nw };
      }
    }
    // Half the list or 100 names, but never more than 500 in one refresh: a hacked list could
    // otherwise add thousands a day to a big list and nobody would notice. A real list grows by
    // dozens per refresh; a one-off big import is a few hundred at most.
    if (oldNames.size > 0 && added.length > Math.min(MAX_ADDED_AT_ONCE, Math.max(100, oldNames.size / 2))) {
      return { reason: 'added ' + added.length + ' names at once' };
    }
    return null;
  }

  function parseFilterList(data) {
    if (isZoundhub(data)) {
      const list = fromZoundhub(data);
      return list ? { artists: parseEntries(list.artists) } : null;
    }
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
      if (artists.length >= MAX_ENTRIES) break;
      if (typeof entry === 'string' && usableName(entry)) {
        artists.push({ name: entry });
      } else if (entry && typeof entry === 'object' && typeof entry.name === 'string' && usableName(entry.name)) {
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
        // Matched by its IDs only, never by name (a name shared by more than one act); only an
        // entry that has an ID can be one (Zoundhub switch, 2026-11-18).
        if (entry.idOnly === true && (artist.spotifyId || artist.channelId)) artist.idOnly = true;
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

  // Dev-only settings never come in from a file.
  function stripDevSettings(settings) {
    const out = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...settings } : {};
    delete out.investigate;
    delete out.modeChosen;
    return out;
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
        settings: stripDevSettings(data.settings),
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
    const settings = imported.settings ? { ...(current.settings || {}), ...stripDevSettings(imported.settings) } : { ...(current.settings || {}) };
    if (imported.settings && imported.settings.mode !== undefined && imported.settings.mode !== (current.settings || {}).mode) settings.modeChosen = true;
    let lists = (current.filterLists || []).map(l => ({ ...l }));
    if (Array.isArray(imported.filterLists)) {
      lists = lists.map(l => {
        const b = imported.filterLists.find(x => x && x.id === l.id);
        // No Watch only any more (Wai, 2026-11-19): a backup's Watch only list comes in off.
        return b ? { ...l, enabled: !!b.enabled && b.mode !== 'watch', mode: 'act' } : l;
      });
      for (const b of imported.filterLists) {
        if (!b || b.builtIn || typeof b.url !== 'string' || !/^https:\/\//.test(b.url)) continue;
        if (lists.some(l => l.id === b.id || l.url === b.url)) continue;
        lists.push({ id: String(b.id), name: String(b.name || b.id), url: b.url, enabled: false,
          mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null });
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
            if (artists.length < MAX_ENTRIES) artists.push({ channelId: m[j] });
          }
        }
      }
    }
    return { artists: artists };
  }

  globalThis.HM.lists = {
    checkUpdate: checkUpdate,
    fromZoundhub: fromZoundhub,
    SOUL_OVER_AI: SOUL_OVER_AI,
    HM_VERDICTS: HM_VERDICTS,
    CEVVAL: CEVVAL,
    ZOUNDHUB: ZOUNDHUB,
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
