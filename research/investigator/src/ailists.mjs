// AI artist blocklists from the community. Downloads three lists at most once a day;
// if a list fails to download the last good copy is kept (or no match at all).
//
// Sources: Zoundhub (the GitHub mirror), Soul Over AI, Cevval.
// match() checks an artist by spotifyId, channelId or name (case/spacing insensitive).
// Cevval has channel IDs only, no names. Zoundhub's idOnly entries match by ID only.

const DAY_MS = 86400000;

// Lists we download, once a day at most. Each entry is { url, listName, parse }.
const SOURCES = [
  {
    url: 'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/zoundhub.json',
    listName: 'Zoundhub',
    parse: (text) => {
      const j = JSON.parse(text);
      return (j.artists || []).filter((a) => a && typeof a.name === 'string');
    },
  },
  {
    url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json',
    listName: 'Soul Over AI',
    parse: (text) => {
      const j = JSON.parse(text);
      const artists = Array.isArray(j) ? j : (j.artists || []);
      return artists.filter((a) => a && typeof a.name === 'string');
    },
  },
  {
    url: 'https://raw.githubusercontent.com/cevvalkoala/CevvalYoutubeAIBlocklist/main/CevvalYoutubeAIblocklist.txt',
    listName: 'Cevval',
    parse: (text) => {
      return text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('!') && !l.startsWith('@'));
    },
  },
];

export function createAiLists({ fetch, now }) {
  const today = () => Math.floor(now() / DAY_MS);

  // Last downloaded values, keyed by url. null means not downloaded yet.
  const cached = {};
  const cachedDay = {};

  // Normalise a name for matching: NFC, lower, trim, collapse spaces.
  const normName = (s) =>
    typeof s === 'string'
      ? s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ')
      : '';

  // The matching index.
  // zoundhub: { name -> { listName, url } } for named entries
  // zoundhubIds: { spotifyId -> { listName, url, idOnly } }
  // soul: same structure
  // cevval: { channelId -> { listName, url } }
  let index = null;
  let builtAt = 0;

  async function refresh() {
    builtAt = now();
    index = {
      zoundhubNames: {},
      zoundhubIds: {},
      soulNames: {},
      soulIds: {},
      cevvalIds: {},
    };

    for (const src of SOURCES) {
      try {
        const t = today();
        if (cachedDay[src.url] === t && cached[src.url] !== undefined) {
          // Use cached version from today
          const text = cached[src.url];
          buildIndex(src, text, index);
        } else {
          const res = await fetch(src.url, {
            redirect: 'error',
            credentials: 'omit',
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) {
            // Keep previous cached version if any, otherwise no entries
            if (cached[src.url] !== undefined) {
              buildIndex(src, cached[src.url], index);
            }
            continue;
          }
          const text = await res.text();
          cached[src.url] = text;
          cachedDay[src.url] = t;
          buildIndex(src, text, index);
        }
      } catch {
        // Failed to download; keep last good copy if we have one
        if (cached[src.url] !== undefined) {
          buildIndex(src, cached[src.url], index);
        }
      }
    }
  }

  function buildIndex(src, text, idx) {
    const list = src.parse(text);

    if (src.listName === 'Zoundhub') {
      for (const a of list) {
        if (typeof a.spotifyId === 'string') {
          idx.zoundhubIds[a.spotifyId] = { listName: src.listName, url: src.url, idOnly: a.idOnly === true };
        }
        if (!a.idOnly) {
          idx.zoundhubNames[normName(a.name)] = { listName: src.listName, url: src.url };
        }
      }
    } else if (src.listName === 'Soul Over AI') {
      for (const a of list) {
        const sid = typeof a.spotifyId === 'string' ? a.spotifyId : typeof a.spotify === 'string' ? a.spotify : null;
        if (sid) {
          idx.soulIds[sid] = { listName: src.listName, url: src.url };
        }
        if (!sid || typeof a.name === 'string') {
          idx.soulNames[normName(a.name)] = { listName: src.listName, url: src.url };
        }
        const cid = typeof a.youtube === 'string' ? a.youtube : typeof a.channelId === 'string' ? a.channelId : null;
        if (cid) {
          idx.soulIds[cid] = { listName: src.listName, url: src.url };
        }
      }
    } else if (src.listName === 'Cevval') {
      for (const channelId of list) {
        idx.cevvalIds[channelId] = { listName: src.listName, url: src.url };
      }
    }
  }

  async function match(artist) {
    if (artist === null || typeof artist !== 'object' || typeof artist.name !== 'string') {
      throw new TypeError('match() requires an object with a name property');
    }
    // Rebuilt on the first match after 24 hours, so a list's new entries arrive within a day.
    if (!index || now() - builtAt >= DAY_MS) {
      await refresh();
    }

    const name = normName(artist.name);
    const spotifyId = typeof artist.spotifyId === 'string' ? artist.spotifyId : null;
    const channelId = typeof artist.channelId === 'string' ? artist.channelId : null;

    // Zoundhub by name
    if (name && index.zoundhubNames[name]) return index.zoundhubNames[name];
    // Zoundhub by spotifyId (including idOnly)
    if (spotifyId && index.zoundhubIds[spotifyId]) return index.zoundhubIds[spotifyId];

    // Soul Over AI by name
    if (name && index.soulNames[name]) return index.soulNames[name];
    // Soul Over AI by spotifyId
    if (spotifyId && index.soulIds[spotifyId]) return index.soulIds[spotifyId];
    // Soul Over AI by channelId
    if (channelId && index.soulIds[channelId]) return index.soulIds[channelId];

    // Cevval by channelId only (no name matching)
    if (channelId && index.cevvalIds[channelId]) return index.cevvalIds[channelId];

    return null;
  }

  return { match, refresh };
}
