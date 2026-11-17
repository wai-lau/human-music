// The calibration run: draw a fixed sample from known AI and known people,
// run each through Claude, keep the raw results for fitting a confidence
// mapping, and allow the run to resume where it stopped.

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
}

function shuffle(arr, random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickSample({ soa, people, seed, n = 50 }) {
  const random = seededRandom(seed);
  const soaShuffled = shuffle(soa.artists, random);
  const ai = soaShuffled.slice(0, n).map((a) => ({
    name: a.name,
    spotifyId: a.spotifyId,
    youtubeChannelId: a.youtubeChannelId,
  }));

  const peopleEligible = people.artists.filter((a) => a.firstRelease >= 2020);
  const peopleShuffled = shuffle(peopleEligible, random);
  const peopleOut = peopleShuffled.slice(0, n).map((a) => ({
    name: a.name,
    spotifyId: a.spotifyId,
    youtubeChannelId: a.youtubeChannelId,
  }));

  return { seed, ai, people: peopleOut };
}

export async function runCalibration({ store, investigate, decide, sample, model }) {
  const resultsKey = `calibration.results.${model}`;
  let results = store.getState(resultsKey) || {};

  const allArtists = [
    ...sample.ai.map((a) => ({ ...a, truthAi: true })),
    ...sample.people.map((a) => ({ ...a, truthAi: false })),
  ];

  let stopped = null;

  for (const a of allArtists) {
    if (stopped) break;

    const prev = results[a.name];
    if (prev && !prev.failed) continue;
    if (prev && prev.failed >= 2) continue;

    const artist = {
      name: a.name,
      site: 'spotify',
      playing: false,
      songs: [],
    };
    if (a.spotifyId) artist.spotifyId = a.spotifyId;
    if (a.youtubeChannelId) artist.channelId = a.youtubeChannelId;

    let result;
    try {
      result = await investigate(artist, {}, { model });
    } catch (e) {
      result = { ok: false, kind: 'error', detail: String(e) };
    }

    if (!result.ok) {
      if (result.kind === 'auth' || result.kind === 'limit') {
        stopped = result.kind;
        break;
      }
      const attempts = (prev && prev.failed) || 0;
      results[a.name] = { failed: attempts + 1 };
    } else {
      try {
        const decision = decide(result.answer);
        results[a.name] = {
          truthAi: a.truthAi,
          verdict: decision.verdict,
          confidence: decision.confidence,
        };
      } catch (e) {
        const attempts = (prev && prev.failed) || 0;
        results[a.name] = { failed: attempts + 1 };
      }
    }

    store.setState(resultsKey, results);
  }

  const completed = Object.values(results).filter((r) => !r.failed).length;
  if (stopped) return { done: completed, stopped };
  return { done: completed };
}

export function fitSamples(results) {
  const out = [];
  for (const [name, r] of Object.entries(results)) {
    if (r.verdict === 'ai') {
      out.push({ raw: r.confidence, truthAi: r.truthAi, name });
    }
  }
  return out;
}