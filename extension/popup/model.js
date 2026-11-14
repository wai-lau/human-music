(function () {
  globalThis.HM = globalThis.HM || {};

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
      throw new Error('Use an https:// address');
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
      // Watch only until the person has seen what it matches, unless they chose to act at
      // once (Wai, 2026-11-13).
      mode: options && options.act ? 'act' : 'watch',
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

  globalThis.HM.popup = {
    addEntry: addEntry,
    addSong: addSong,
    removeEntry: removeEntry,
    addFilterList: addFilterList,
    removeFilterList: removeFilterList
  };
})();
