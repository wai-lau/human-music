// Builds a sample of new acts made by people from MusicBrainz, for the weights experiment
// (Wai, 2026-11-19: "use a much bigger sample size to calibrate the weights").
// A MusicBrainz artist of type Person with a birth date is a human; we keep those born 1995-2006
// whose first release group is 2020 or later, who link a Spotify artist, and who are on no AI list
// and in no earlier sample. Half come from faceless genres (lofi, ambient, chillhop...).
// MusicBrainz allows one request a second and asks for a client name: we send the repo URL.
// Usage: node tools/mb-people-sample.mjs <out.json> <n-faceless> <n-other> <exclude.json>...
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'human-music-research/0.1 (https://github.com/wai-lau/human-music)';
const FACELESS_TAGS = ['lo-fi', 'lo-fi hip hop', 'ambient', 'chillhop', 'downtempo', 'chillwave', 'jazz hop', 'vaporwave', 'new age'];
const OTHER_TAGS = ['indie pop', 'indie rock', 'pop', 'rock', 'folk', 'hip hop', 'r&b', 'punk', 'singer-songwriter', 'metal', 'country', 'soul'];
const AI_LISTS = [
  'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/zoundhub.json',
  'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json',
];

const [out, nFaceless, nOther, ...excludeFiles] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/mb-people-sample.mjs <out.json> <n-faceless> <n-other> <exclude.json>...'); process.exit(2); }
const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function mb(path) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`, { headers: { 'User-Agent': UA } });
  if (res.status === 503) { await sleep(5000); return mb(path); }
  if (!res.ok) throw new Error(`MusicBrainz ${res.status} for ${path}`);
  return res.json();
}

const excludedNames = new Set(); const excludedIds = new Set();
for (const url of AI_LISTS) {
  const j = await (await fetch(url)).json();
  for (const a of (Array.isArray(j) ? j : j.artists || [])) {
    if (a.name) excludedNames.add(norm(a.name));
    for (const id of [a.spotifyId, a.spotify]) if (typeof id === 'string') excludedIds.add(id);
  }
}
for (const f of excludeFiles) for (const a of JSON.parse(readFileSync(f, 'utf8')).artists || []) excludedNames.add(norm(a.name));

async function collect(tags, want, faceless, taken) {
  const kept = [];
  for (let page = 0; kept.length < want && page < 12; page++) {
    for (const tag of tags) {
      if (kept.length >= want) break;
      const q = encodeURIComponent(`type:person AND begin:[1995 TO 2006] AND tag:"${tag}"`);
      let found;
      try { found = await mb(`artist/?query=${q}&limit=25&offset=${page * 25}`); } catch { continue; }
      for (const a of found.artists || []) {
        if (kept.length >= want) break;
        if (taken.has(a.id) || excludedNames.has(norm(a.name))) continue;
        taken.add(a.id);
        if ((a.tags || []).some((t) => /\bai\b|artificial/i.test(t.name))) continue;
        let full;
        try { full = await mb(`artist/${a.id}?inc=release-groups+url-rels`); } catch { continue; }
        const years = (full['release-groups'] || []).map((g) => parseInt((g['first-release-date'] || '').slice(0, 4), 10)).filter(Number.isFinite);
        if (!years.length || Math.min(...years) < 2020) continue;
        const sp = (full.relations || []).map((r) => r.url && r.url.resource).find((u) => /open\.spotify\.com\/artist\//.test(u || ''));
        if (!sp) continue;
        const spotifyId = sp.split('/artist/')[1].split(/[?/]/)[0];
        if (excludedIds.has(spotifyId)) continue;
        kept.push({ name: a.name, spotifyId, faceless, genre: tag, firstRelease: Math.min(...years), born: a['life-span'] && a['life-span'].begin,
          evidence: [{ url: `https://musicbrainz.org/artist/${a.id}`, what: `MusicBrainz: a Person born ${a['life-span'] && a['life-span'].begin}, first release ${Math.min(...years)}` }] });
        console.log(`${kept.length}/${want} ${faceless ? 'faceless' : 'other'}: ${a.name} (${tag}, ${Math.min(...years)})`);
      }
    }
  }
  return kept;
}

const taken = new Set();
const artists = [...await collect(FACELESS_TAGS, Number(nFaceless) || 60, true, taken), ...await collect(OTHER_TAGS, Number(nOther) || 60, false, taken)];
writeFileSync(out, JSON.stringify({
  description: 'New acts made by people from MusicBrainz (type Person, born 1995-2006, first release 2020 or later, a Spotify link, on no AI list), built by tools/mb-people-sample.mjs.',
  built: new Date().toISOString(), artists,
}, null, 1) + '\n');
console.log(`wrote ${artists.length} to ${out}`);
