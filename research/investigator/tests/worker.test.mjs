import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { artistKeys } from '../src/names.mjs';

const NOW = new Date('2026-11-16T12:00:00Z');
const SPOTIFY = 'A'.repeat(22);
const TRACK = 'T'.repeat(22);
const art = (name, o = {}) => ({ name, site: 'ytm', songs: [{ title: 'S', album: '', artUrl: '' }], playing: false, ...o });
const answer = (o = {}) => ({
  verdict: 'ai', confidence: 97, signals: ['deezer_ai_label'], reasons: ['label'], sources: ['https://x.example/a', 'https://y.example/b'], ...o,
});

// The store and queue are real (in memory); every other collaborator is a fake.
function setup(opts = {}) {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => NOW, cap: opts.cap ?? 100 });
  const calls = { investigate: 0, cheap: 0, publish: 0, shlabs: [], fetchArt: [], lookArt: [], prompts: [] };
  const w = createWorker({
    store,
    queue,
    cheapPass: async (a) => { calls.cheap++; return opts.cheap ? opts.cheap(a) : null; },
    investigate: async (a, ev) => {
      calls.investigate++;
      calls.prompts.push(JSON.stringify([a, ev]));
      if (opts.investigate) return opts.investigate(a, ev);
      return { ok: true, answer: answer() };
    },
    shlabs: {
      scoreTracks: async (ids) => {
        calls.shlabs.push(ids);
        if (opts.shlabs) return opts.shlabs(ids);
        return [{ trackId: ids[0], probability: 88, label: 'ai', generator: 'suno', at: '2026-11-16T12:00:00.000Z' }];
      },
    },
    schedulePublish: () => { calls.publish++; },
    fetchArt: opts.fetchArt ? async (u) => { calls.fetchArt.push(u); return opts.fetchArt(u); } : undefined,
    lookArt: opts.lookArt ? async (i) => { calls.lookArt.push(i); return opts.lookArt(i); } : undefined,
    mapping: opts.mapping ?? null,
    now: () => NOW,
  });
  return { store, queue, w, calls };
}

const deepEqual3 = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const verdictOf = (store, a) => store.findVerdict(artistKeys(a));

run([
  ['an empty queue is idle', async () => {
    const { w } = setup();
    return (await w.runOne()) === 'idle' || 'not idle';
  }],
  ['a cheap human hit skips Claude, is stored, done, no bump', async () => {
    const a = art('Old Band');
    const { store, queue, w, calls } = setup({
      cheap: () => ({ verdict: 'human', confidence: 90, signals: [], reasons: ['old release'], sources: ['https://musicbrainz.org/artist/x'] }),
    });
    queue.enqueue([a]);
    const r = await w.runOne();
    const v = verdictOf(store, a);
    const ok = r === 'done' && calls.investigate === 0 && v && v.verdict === 'human' && v.confidence === 90
      && store.count('2026-11-16') === 0 && queue.status().queued === 0 && calls.publish === 1;
    return ok || JSON.stringify({ r, calls, v, status: queue.status() });
  }],
  ['a normal ai answer is stored, bumped, published, and the artist is done', async () => {
    const a = art('Synth One', { spotifyId: SPOTIFY });
    const { store, queue, w, calls } = setup();
    queue.enqueue([a]);
    const r = await w.runOne();
    const v = verdictOf(store, a);
    const ok = r === 'done' && v && v.verdict === 'ai' && v.rawConfidence === 97 && store.count('2026-11-16') === 1
      && calls.publish === 1 && queue.status().queued === 0 && v.checked === '2026-11-16' && v.source === 'live';
    return ok || JSON.stringify({ r, v, calls });
  }],
  ['done really drops the artist: a second runOne is idle', async () => {
    const { queue, w } = setup();
    queue.enqueue([art('Solo')]);
    await w.runOne();
    return (await w.runOne()) === 'idle' || 'artist still queued';
  }],
  ['an injected ai 100 with one weak signal is stored as unsure', async () => {
    const a = art('Injected');
    const { store, queue, w } = setup({
      investigate: () => ({ ok: true, answer: answer({ confidence: 100, signals: ['ai_style_art'] }) }),
    });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    return (v && v.verdict === 'unsure' && v.confidence <= 50) || JSON.stringify(v);
  }],
  ['two weak signals: decide caps at 94 and the worker keeps its result', async () => {
    const a = art('Weak Pair');
    const { store, queue, w } = setup({
      investigate: () => ({ ok: true, answer: answer({ confidence: 100, signals: ['ai_style_art', 'no_human_footprint'] }) }),
    });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    return (v && v.verdict === 'ai' && v.rawConfidence === 94 && v.confidence <= 94) || JSON.stringify(v);
  }],
  ['with no fit, a strong ai 100 is published at no more than 94', async () => {
    const a = art('No Fit');
    const { store, queue, w } = setup({ investigate: () => ({ ok: true, answer: answer({ confidence: 100 }) }) });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    return (v && v.rawConfidence === 100 && v.confidence <= 94) || JSON.stringify(v);
  }],
  ['with a fit, the ai confidence is mapped; human confidence passes unchanged', async () => {
    const mapping = { ok: true, points: [[0, 0], [60, 60], [90, 95], [100, 100]], wrongAt95: 0, wrongAt60: 0, n: 40 };
    const a = art('Fitted');
    const h = art('Person');
    const { store, queue, w } = setup({
      mapping,
      investigate: (x) => ({ ok: true, answer: x.name === 'Person' ? answer({ verdict: 'human', confidence: 83, signals: [] }) : answer({ confidence: 90 }) }),
    });
    queue.enqueue([a, h]);
    await w.runOne();
    await w.runOne();
    const va = verdictOf(store, a);
    const vh = verdictOf(store, h);
    return (va.confidence === 95 && va.rawConfidence === 90 && vh.confidence === 83 && vh.rawConfidence === 83) || JSON.stringify({ va, vh });
  }],
  ['an invalid answer stores nothing, does not re-queue, and is the last error', async () => {
    const a = art('Garbage');
    const { store, queue, w } = setup({ investigate: () => ({ ok: false, kind: 'invalid', detail: 'verdict not one of ai, human, unsure' }) });
    queue.enqueue([a]);
    const r = await w.runOne();
    const ok = r === 'done' && verdictOf(store, a) === null && queue.status().queued === 0
      && (await w.runOne()) === 'idle' && String(queue.status().lastError).includes('verdict not one of') && queue.status().paused === null;
    return ok || JSON.stringify({ r, status: queue.status() });
  }],
  ['an invalid answer uses a daily slot (Claude ran)', async () => {
    const { store, queue, w } = setup({ investigate: () => ({ ok: false, kind: 'invalid', detail: 'x' }) });
    queue.enqueue([art('Garbage')]);
    await w.runOne();
    return store.count('2026-11-16') === 1 || 'not counted';
  }],
  ['auth pauses the queue and the artist is back at the front, not done', async () => {
    const a = art('Waits');
    let first = true;
    const { store, queue, w, calls } = setup({
      investigate: () => {
        if (first) { first = false; return { ok: false, kind: 'auth', detail: 'please /login' }; }
        return { ok: true, answer: answer() };
      },
    });
    queue.enqueue([a, art('Behind')]);
    const r = await w.runOne();
    const st = queue.status();
    if (r !== 'paused' || !st.paused || !String(st.lastError).includes('login')) return JSON.stringify({ r, st });
    if (store.count('2026-11-16') !== 0 || calls.publish !== 0) return 'counted or published on auth';
    queue.resume();
    const again = queue.next(); // the same artist comes back first
    return (again && again.name === 'Waits' && st.queued === 2) || JSON.stringify({ again, st });
  }],
  ['limit pauses too, and the artist stays queued', async () => {
    const { queue, w } = setup({ investigate: () => ({ ok: false, kind: 'limit', detail: 'usage limit reached' }) });
    queue.enqueue([art('Cap Hit')]);
    const r = await w.runOne();
    const st = queue.status();
    return (r === 'paused' && st.paused && st.queued === 1) || JSON.stringify({ r, st });
  }],
  ['a paused queue makes runOne idle', async () => {
    const { queue, w } = setup();
    queue.enqueue([art('X')]);
    queue.pause('manual');
    return (await w.runOne()) === 'idle' || 'ran while paused';
  }],
  ['SH Labs scores are stored for up to two tracks and never listed as publishable', async () => {
    const a = art('Scored', { spotifyId: SPOTIFY });
    const { store, queue, w, calls } = setup({
      investigate: () => ({ ok: true, answer: answer({ trackIds: [TRACK, 'U'.repeat(22)] }) }),
    });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    const scores = store.getScores(v.id);
    const listed = JSON.stringify(store.listPublishable());
    const ok = calls.shlabs.length === 1 && calls.shlabs[0].length === 2 && scores.length === 1 && scores[0].probability === 88
      && !listed.includes('probability') && !listed.includes('suno');
    return ok || JSON.stringify({ calls: calls.shlabs, scores, listed });
  }],
  ['SH Labs gets the item track ids when the answer has none, and at most two', async () => {
    const a = art('Items', { trackIds: [TRACK, 'U'.repeat(22), 'V'.repeat(22)] });
    const { queue, w, calls } = setup();
    queue.enqueue([a]);
    await w.runOne();
    return (calls.shlabs.length === 1 && calls.shlabs[0].length <= 2 && calls.shlabs[0][0] === TRACK) || JSON.stringify(calls.shlabs);
  }],
  ['no track ids means SH Labs is not called', async () => {
    const { queue, w, calls } = setup();
    queue.enqueue([art('No Tracks')]);
    await w.runOne();
    return calls.shlabs.length === 0 || 'called';
  }],
  ['a SH Labs failure does not fail the verdict', async () => {
    const a = art('Shaky');
    const { store, queue, w } = setup({
      investigate: () => ({ ok: true, answer: answer({ trackIds: [TRACK] }) }),
      shlabs: () => { throw new Error('boom'); },
    });
    queue.enqueue([a]);
    const r = await w.runOne();
    const v = verdictOf(store, a);
    return (r === 'done' && v && v.verdict === 'ai' && queue.status().queued === 0) || JSON.stringify({ r, v });
  }],
  ['a thrown error leaves runOne resolving, stores nothing, and the queue running', async () => {
    const { store, queue, w } = setup({ investigate: () => { throw new Error('kaboom'); } });
    queue.enqueue([art('Throws'), art('Next One')]);
    const r = await w.runOne();
    const st = queue.status();
    const ok = typeof r === 'string' && st.paused === null && String(st.lastError).includes('kaboom')
      && store.listPublishable().length === 0 && st.queued === 1;
    return ok || JSON.stringify({ r, st });
  }],
  ['a throw from the cheap pass falls through to Claude', async () => {
    const a = art('Cheap Throws');
    const { store, queue, w, calls } = setup({ cheap: () => { throw new Error('mb down'); } });
    queue.enqueue([a]);
    await w.runOne();
    return (calls.investigate === 1 && verdictOf(store, a) !== null) || 'no verdict after cheap throw';
  }],
  ['the answer ids fill a non-ai verdict but never an ai one', async () => {
    const a = art('No Ids');
    const b = art('No Ids Ai');
    const { store, queue, w } = setup({
      investigate: (x) => ({ ok: true, answer: x.name === 'No Ids' ? answer({ verdict: 'human', confidence: 70, signals: [], spotifyId: SPOTIFY }) : answer({ spotifyId: 'B'.repeat(22) }) }),
    });
    queue.enqueue([a, b]);
    await w.runOne();
    await w.runOne();
    const va = verdictOf(store, a);
    const vb = verdictOf(store, b);
    return (va.spotifyId === SPOTIFY && vb.spotifyId === undefined) || JSON.stringify({ va, vb });
  }],
  ['a look of ai adds ai_style_art once, stores the look and address outside the published list', async () => {
    const a = art('Covered', { songs: [{ title: 'S', album: '', artUrl: 'https://i.scdn.co/image/x' }, { title: 'T', album: '', artUrl: 'https://i.scdn.co/image/y' }] });
    const { store, queue, w, calls } = setup({
      investigate: () => ({ ok: true, answer: answer({ signals: ['ai_style_art', 'no_human_footprint'] }) }),
      fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJD' }),
      lookArt: () => ({ ok: true, look: 'ai' }),
    });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    const stored = JSON.stringify(store.getState(`art:${v.id}`));
    const listed = JSON.stringify(store.listPublishable());
    const ok = v.signals.filter((s) => s === 'ai_style_art').length === 1 && v.signals.includes('no_human_footprint')
      && calls.fetchArt.length === 1 && calls.fetchArt[0] === 'https://i.scdn.co/image/x' && calls.lookArt.length === 1
      && stored.includes('"look":"ai"') && stored.includes('i.scdn.co/image/x') && !listed.includes('i.scdn.co') && !listed.includes('"look"');
    return ok || JSON.stringify({ v, stored, listed });
  }],
  ['a look of ai on top of a strong signal adds the weak signal; a look of not_ai or unclear adds nothing', async () => {
    const out = [];
    for (const look of ['ai', 'not_ai', 'unclear']) {
      const a = art(`Look ${look}`, { songs: [{ title: 'S', album: '', artUrl: 'https://i.scdn.co/image/x' }] });
      const { store, queue, w } = setup({ fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJD' }), lookArt: () => ({ ok: true, look }) });
      queue.enqueue([a]);
      await w.runOne();
      out.push(verdictOf(store, a).signals.includes('ai_style_art'));
    }
    return deepEqual3(out, [true, false, false]) || JSON.stringify(out);
  }],
  ['a fetch failure, a look failure and a throwing look add nothing and the verdict still lands', async () => {
    const res = [];
    const cases = [
      { fetchArt: () => ({ ok: false, why: 'host' }), lookArt: () => ({ ok: true, look: 'ai' }) },
      { fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJD' }), lookArt: () => ({ ok: false, kind: 'error', detail: 'x' }) },
      { fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJD' }), lookArt: () => { throw new Error('look boom'); } },
      { fetchArt: () => { throw new Error('fetch boom'); }, lookArt: () => ({ ok: true, look: 'ai' }) },
    ];
    for (const c of cases) {
      const a = art('Failing Art', { songs: [{ title: 'S', album: '', artUrl: 'https://i.scdn.co/image/x' }] });
      const { store, queue, w } = setup(c);
      queue.enqueue([a]);
      const r = await w.runOne();
      const v = verdictOf(store, a);
      res.push(r === 'done' && v && v.verdict === 'ai' && !v.signals.includes('ai_style_art'));
    }
    return res.every(Boolean) || JSON.stringify(res);
  }],
  ['art alone never makes ai: one weak signal from the look is stored as unsure', async () => {
    const a = art('Art Only', { songs: [{ title: 'S', album: '', artUrl: 'https://i.scdn.co/image/x' }] });
    const { store, queue, w } = setup({
      investigate: () => ({ ok: true, answer: answer({ confidence: 100, signals: [] }) }),
      fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJD' }),
      lookArt: () => ({ ok: true, look: 'ai' }),
    });
    queue.enqueue([a]);
    await w.runOne();
    const v = verdictOf(store, a);
    return (v.verdict === 'unsure' && v.signals.length === 1 && v.signals[0] === 'ai_style_art') || JSON.stringify(v);
  }],
  ['no art address or no art functions means no look; the research prompt carries no image data or look', async () => {
    const a = art('Plain');
    const b = art('Has Art', { songs: [{ title: 'S', album: '', artUrl: 'https://i.scdn.co/image/x' }] });
    const s1 = setup({ fetchArt: () => ({ ok: true, mediaType: 'image/png', base64: 'QUJDSECRETBYTES' }), lookArt: () => ({ ok: true, look: 'ai' }) });
    s1.queue.enqueue([a, b]);
    await s1.w.runOne();
    const noAddr = s1.calls.fetchArt.length === 0;
    await s1.w.runOne();
    const s2 = setup();
    s2.queue.enqueue([b]);
    await s2.w.runOne();
    const prompts = s1.calls.prompts.join('');
    const ok = noAddr && s1.calls.fetchArt.length === 1 && !prompts.includes('SECRETBYTES') && !prompts.includes('"look"') && !prompts.includes('base64') && s2.calls.fetchArt.length === 0;
    return ok || JSON.stringify({ noAddr, f: s1.calls.fetchArt.length, prompts });
  }],
]);
