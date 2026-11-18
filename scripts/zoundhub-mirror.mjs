// The Zoundhub mirror (Wai, 2026-11-18: "1A", a daily mirror on GitHub). Zoundhub's site doesn't
// let other sites read its data file, and the extension may only reach YouTube Music and Spotify,
// so a scheduled GitHub Action in wai-lau/human-music-verdicts runs this once a day and publishes
// the result next to verdicts.json, where every copy can read it like any list.
//
//   node scripts/zoundhub-mirror.mjs <out.json> [<previous.json>]
//
// It fetches zoundhub.com/data/artists-all.json once, keeps only the clear AI flags (the
// extension's own HM.lists.fromZoundhub: rating 5 with Deezer's AI label, debut 2020 or later,
// shared names by Spotify ID only) and writes the list with its credit. If the fetch fails or the
// result looks wrong (under 1,000 artists, or a third fewer than the previous list), it writes
// nothing and exits 1, so the old list stays up.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const SOURCE = 'https://zoundhub.com/data/artists-all.json';
const MIN_ARTISTS = 1000;
const MAX_DROP = 1 / 3;
const MAX_BYTES = 20 * 1024 * 1024;

// The extension's list code, loaded the way the extension loads it (plain scripts on globalThis.HM).
export function loadLists(root = join(fileURLToPath(import.meta.url), '..', '..')) {
  const ctx = createContext({ console });
  for (const f of ['text.js', 'store.js', 'lists.js']) {
    runInContext(readFileSync(join(root, 'extension', 'src', 'core', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.HM.lists;
}

// data: Zoundhub's file; previous: the list now published (or null); now: a Date.
// Returns { ok: true, list } or { ok: false, reason }.
export function buildMirror(data, previous, now, lists = loadLists()) {
  const built = lists.fromZoundhub(data);
  if (!built) return { ok: false, reason: 'not Zoundhub data, or nothing usable' };
  const n = built.artists.length;
  if (n < MIN_ARTISTS) return { ok: false, reason: `only ${n} artists (fewer than ${MIN_ARTISTS})` };
  const before = previous && Array.isArray(previous.artists) ? previous.artists.length : 0;
  if (before && n < before * (1 - MAX_DROP)) return { ok: false, reason: `${n} artists, down from ${before}` };
  return {
    ok: true,
    list: {
      name: 'Zoundhub',
      source: 'https://zoundhub.com',
      note: 'Artists Zoundhub rates 5 with Deezer\'s AI label, debut 2020 or later, mirrored once a day by Human Music. Zoundhub calls its rating "an AI signal, not a verified classification". A name Zoundhub also gives a low-rated artist matches by Spotify ID only (idOnly).',
      updated: now.toISOString(),
      artists: built.artists,
    },
  };
}

async function main(out, previousPath) {
  if (!out) { console.error('usage: node scripts/zoundhub-mirror.mjs <out.json> [<previous.json>]'); return 2; }
  let previous = null;
  if (previousPath && existsSync(previousPath)) {
    try { previous = JSON.parse(readFileSync(previousPath, 'utf8')); } catch { previous = null; }
  }
  let data;
  try {
    const res = await fetch(SOURCE, {
      headers: { 'User-Agent': 'HumanMusicMirror/1 (+https://github.com/wai-lau/human-music)', Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`over ${MAX_BYTES} bytes`);
    data = JSON.parse(text);
  } catch (e) {
    console.error(`fetch failed, the old list stays: ${e.message}`);
    return 1;
  }
  const r = buildMirror(data, previous, new Date());
  if (!r.ok) { console.error(`not published, the old list stays: ${r.reason}`); return 1; }
  writeFileSync(out, JSON.stringify(r.list, null, 1) + '\n');
  console.log(`wrote ${out}: ${r.list.artists.length} artists, ${r.list.artists.filter((a) => a.idOnly).length} by Spotify ID only`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv[3]).then((code) => process.exit(code));
}
