// Contract: our own audio detector as an investigator layer (Wai, 2026-11-22/23: build our own
// fakeprint detector, then "A": a layer before SH Labs). Research and numbers:
// research/calibration/fakeprint-results.md; the Python reference: research/fakeprint/fakeprint.py.
//
// src/fakeprint.mjs (a port of research/fakeprint/fakeprint.py; read its docstring):
//   fakeprint(samples: Float32Array of mono audio at 44100 Hz) -> Float32Array (510 values for 10 s+)
//     FFT size 16384, Hann window (numpy.hanning: 0.5 - 0.5 cos(2 pi n / (N - 1))), hop 8192, frames
//     only where a full window fits; magnitude |rfft| in dB (20 log10(m + 1e-10)) averaged over
//     frames; keep bins with 5000 <= freq <= 16000 (freq = k * 44100 / 16384); lower envelope =
//     running minimum over 151 bins then running mean over 51 bins, both centred with the edge
//     values repeated past the ends (scipy 'nearest'); residual = max(band - envelope, 0);
//     max-pool in groups of 8 (drop the tail); divide by the maximum (if above 0).
//   probability(fp, model) -> number   model = model/fakeprint.json: sigmoid(intercept + coef . ((fp - mean) / scale))
//   decode(bytes) -> Promise<Float32Array>: ffmpeg -v quiet -i pipe:0 -t 30 -ac 1 -ar 44100 -f f32le pipe:1
//     (spawned with { spawn } injectable; any failure rejects).
// src/fakeprintlayer.mjs:
//   createFakeprintLayer({ fetch, decode, model, linker }) -> { scoreArtist(artist) -> Promise<number[]> }
//     linker.deezerArtistFor(artist) -> Promise<deezerId | null> (src/isrclink.mjs gains this: the same
//     MusicBrainz-by-channel, then Deezer exact-name-and-title rule isrcsFor uses). Previews: GET
//     https://api.deezer.com/artist/<id>/top?limit=10, the tracks with a 'preview'; if fewer than 2,
//     GET https://api.deezer.com/search?q=<artist name> (limit 25) kept to tracks whose artist.id is
//     <id>; the first two previews are fetched (redirect 'error', credentials 'omit', 15 s timeout),
//     decoded and scored. Returns the two probabilities, or [] on any failure or fewer than two.
// src/worker.mjs: a fakeprint layer after the AI lists and before SH Labs: with a fakeprintLayer
//   option, two probabilities both >= 0.8 save 'ai', confidence 90, model 'fakeprint', signals ['M3'],
//   reasons [`${p1} and ${p2} on our audio model`] (rounded to 2 places), sources ['https://www.deezer.com'];
//   otherwise the artist goes on to SH Labs and Claude as today. Its scores are not stored.
// src/main.mjs wires it with the real fetch, decode and model/fakeprint.json.
// Run from research/investigator: node tests/fakeprint-contract.check.mjs
import { readFileSync } from 'node:fs';
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { artistKeys } from '../src/names.mjs';
import { CODES } from '../src/checklist.mjs';

const J = (v) => JSON.stringify(v);
const golden = JSON.parse(readFileSync(new URL('./fixtures/fakeprint-golden.json', import.meta.url), 'utf8'));
const model = JSON.parse(readFileSync(new URL('../model/fakeprint.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-23T12:00:00Z');

// The golden signal (research/fakeprint/golden.py): three sines and xorshift32 noise, float32.
function signal() {
  const N = golden.samples, SR = golden.sampleRate, x = new Float32Array(N);
  let s = golden.seed >>> 0;
  for (let n = 0; n < N; n++) {
    s ^= (s << 13) >>> 0; s >>>= 0; s ^= s >>> 17; s ^= (s << 5) >>> 0; s >>>= 0;
    const u = s / 2 ** 32;
    x[n] = 0.3 * Math.sin(2 * Math.PI * 440 * n / SR) + 0.1 * Math.sin(2 * Math.PI * 9000 * n / SR) + 0.05 * Math.sin(2 * Math.PI * 12345 * n / SR) + 0.02 * (u * 2 - 1);
  }
  return x;
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(8) });

function worker({ probs, shlabsCalls }) {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => NOW, cap: 100 });
  const calls = { claude: 0, shlabs: 0 };
  const w = createWorker({ store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {},
    cheapPass: async () => null, aiLists: { match: async () => null }, fetchPage: async () => '"spotify:track:' + 'A'.repeat(22) + '" "spotify:track:' + 'B'.repeat(22) + '"',
    fakeprintLayer: { scoreArtist: async () => probs },
    shlabs: { scoreTracks: async (ids) => { calls.shlabs++; return ids.map((id) => ({ trackId: id, probability: 30, label: '', generator: null, audioSource: 'preview', at: NOW.toISOString() })); } },
    investigate: async () => { calls.claude++; return { ok: true, checklist: { signs: Object.fromEntries(CODES.map((c) => [c, 'unknown'])), genres: [], sources: [], summary: '' } }; } });
  const artist = { name: 'Some Act', site: 'spotify', spotifyId: 'S'.repeat(22), songs: [{ title: 'Song', album: '', artUrl: '' }], playing: true };
  return { store, queue, w, calls, artist };
}

await run([
  ['fakeprint() matches the Python reference on the golden signal (every value within 0.002)', async () => {
    const { fakeprint } = await import('../src/fakeprint.mjs');
    const fp = fakeprint(signal());
    if (fp.length !== golden.fakeprint.length) return `length ${fp.length}, want ${golden.fakeprint.length}`;
    let worst = 0, at = -1;
    golden.fakeprint.forEach((v, i) => { const d = Math.abs(fp[i] - v); if (d > worst) { worst = d; at = i; } });
    return worst < 0.002 || `largest difference ${worst.toFixed(5)} at ${at}`;
  }],
  ['probability() gives the Python model\'s value on the golden fakeprint (within 0.001)', async () => {
    const { probability } = await import('../src/fakeprint.mjs');
    const p = probability(Float32Array.from(golden.fakeprint), model);
    return Math.abs(p - golden.probability) < 0.001 || `p ${p}, want ${golden.probability}`;
  }],
  ['the layer: Deezer artist, two previews (top list, then search kept to the artist), decoded and scored', async () => {
    const { createFakeprintLayer } = await import('../src/fakeprintlayer.mjs');
    const urls = [];
    const fetch = async (u, o) => {
      urls.push(String(u));
      if (String(u).includes('/artist/777/top')) return ok({ data: [{ id: 1, preview: 'https://cdn.example/p1.mp3' }] });
      if (String(u).includes('api.deezer.com/search')) return ok({ data: [{ id: 1, preview: 'https://cdn.example/p1.mp3', artist: { id: 777 } }, { id: 2, preview: 'https://cdn.example/p2.mp3', artist: { id: 777 } }, { id: 3, preview: 'https://cdn.example/x.mp3', artist: { id: 999 } }] });
      if (String(u).startsWith('https://cdn.example/')) { if (o.redirect !== 'error' || o.credentials !== 'omit') throw new Error('unsafe fetch'); return ok({}); }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const layer = createFakeprintLayer({ fetch, decode: async () => signal(), model, linker: { deezerArtistFor: async () => 777 } });
    const got = await layer.scoreArtist({ name: 'Some Act', songs: [{ title: 'Song' }] });
    const fetched = urls.filter((u) => u.startsWith('https://cdn.example/'));
    return (got.length === 2 && got.every((p) => Math.abs(p - golden.probability) < 0.001) && J(fetched) === J(['https://cdn.example/p1.mp3', 'https://cdn.example/p2.mp3'])) || J({ got, urls });
  }],
  ['the layer gives [] with no Deezer artist, fewer than two previews, or a failure', async () => {
    const { createFakeprintLayer } = await import('../src/fakeprintlayer.mjs');
    const none = createFakeprintLayer({ fetch: async () => ok({ data: [] }), decode: async () => signal(), model, linker: { deezerArtistFor: async () => null } });
    const one = createFakeprintLayer({ fetch: async () => ok({ data: [{ id: 1, preview: 'https://cdn.example/p1.mp3', artist: { id: 5 } }] }), decode: async () => signal(), model, linker: { deezerArtistFor: async () => 5 } });
    const bad = createFakeprintLayer({ fetch: async () => ok({ data: [{ id: 1, preview: 'https://cdn.example/p1.mp3', artist: { id: 5 } }, { id: 2, preview: 'https://cdn.example/p2.mp3', artist: { id: 5 } }] }), decode: async () => { throw new Error('ffmpeg'); }, model, linker: { deezerArtistFor: async () => 5 } });
    const r = [await none.scoreArtist({ name: 'A' }), await one.scoreArtist({ name: 'A' }), await bad.scoreArtist({ name: 'A' })];
    return J(r) === J([[], [], []]) || J(r);
  }],
  ['isrclink exposes deezerArtistFor (the same artist rule as isrcsFor)', async () => {
    const { createIsrcLinker } = await import('../src/isrclink.mjs');
    const fetch = async (u) => (String(u).includes('api.deezer.com/search') ? ok({ data: [{ id: 1, title: 'Song', artist: { id: 111, name: 'Some Act' } }] }) : { ok: false, status: 404, json: async () => ({}) });
    const id = await createIsrcLinker({ fetch }).deezerArtistFor({ name: 'Some Act', songs: [{ title: 'Song' }] });
    return id === 111 || J(id);
  }],
  ['worker: both songs 0.8 or more is AI at 90 from our audio model; SH Labs is not asked', async () => {
    const t = worker({ probs: [0.93, 0.85] });
    t.queue.enqueue([t.artist]); await t.w.runOne();
    const v = t.store.findVerdict(artistKeys(t.artist));
    return (v && v.verdict === 'ai' && v.confidence === 90 && v.model === 'fakeprint' && t.calls.shlabs === 0 && t.calls.claude === 0) || J({ v, calls: t.calls });
  }],
  ['worker: one song under 0.8, or no scores: on to SH Labs as today', async () => {
    const a = worker({ probs: [0.93, 0.5] }); a.queue.enqueue([a.artist]); await a.w.runOne();
    const b = worker({ probs: [] }); b.queue.enqueue([b.artist]); await b.w.runOne();
    const va = a.store.findVerdict(artistKeys(a.artist));
    return (a.calls.shlabs >= 1 && b.calls.shlabs >= 1 && (!va || va.model !== 'fakeprint')) || J({ a: a.calls, b: b.calls, va });
  }],
]);
