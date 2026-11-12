import { load } from './load.mjs';

const ctx = load(['src/core/text.js', 'src/core/match.js']);
const { match } = ctx.HM;

function generateArtists(count) {
  const artists = [];
  for (let i = 0; i < count; i++) {
    artists.push({ name: `AI Artist ${i}` });
  }
  return artists;
}

function generateSong(index, idx) {
  return { title: `Song ${index}`, artistLine: `AI Artist ${idx} • Album` };
}

console.log('Performance test: 1375 artists, 2000 matchSong calls');

const artists = generateArtists(1375);
const filterLists = [
  { id: 'perf-list', name: 'Perf List', enabled: true, mode: 'act', data: { artists } }
];
const user = { artists: [], songs: [], keywords: [], neverSkip: [] };

const idx = match.buildIndex({ filterLists, user });

const start = process.hrtime.bigint();
for (let i = 0; i < 2000; i++) {
  const artistIdx = i % 1375;
  const song = generateSong(i, artistIdx);
  match.matchSong(idx, song);
}
const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

const avgMs = elapsed / 2000;
console.log(`Total: ${elapsed.toFixed(1)} ms`);
console.log(`Average: ${avgMs.toFixed(3)} ms per call`);

if (avgMs < 6) {
  console.log(`PASS ${avgMs.toFixed(3)} ms < 6 ms`);
} else {
  console.log(`FAIL ${avgMs.toFixed(3)} ms >= 6 ms`);
  process.exit(1);
}
