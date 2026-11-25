// Contract: song titles for Spotify-labelled artists (Wai, 2026-11-25, "A"). Run from
// research/investigator: node tests/spotify-titles-contract.check.mjs
//   spotifytitles.mjs: titlesFromEmbed(html) reads props.pageProps.state.data.entity.trackList[].title
//     out of the page's __NEXT_DATA__ (max 50, distinct, cut to 200 chars); bad input gives [].
//   addTitles(store, spotifyId, titles) merges and persists (cap 50); getTitles(store, spotifyId).
//   worker: saving a spotify-label verdict fetches the embed page and stores its titles; a failing
//     fetch still saves the verdict; the titles the extension sent (artist.songTitles) merge in.
//   intake: songTitles is accepted only alongside spotifyAiLabel (max 20, each cut to 200 chars).
//   listjson: `titles` (an array, maybe empty) and `labelName` instead of `name` on spotify-label
//     entries, and only there; spotifyId stays. withTitles(store, verdicts) attaches the titles.
import { run } from './harness.mjs';
import { openStore } from '../src/store.mjs';
import { createQueue } from '../src/queue.mjs';
import { createWorker } from '../src/worker.mjs';
import { parseRequest } from '../src/intake.mjs';
import { artistKeys } from '../src/names.mjs';
import { buildList } from '../src/listjson.mjs';
import { titlesFromEmbed, addTitles, getTitles, withTitles } from '../src/spotifytitles.mjs';

const NOW = new Date('2026-11-25T12:00:00Z');
const SP = 'S'.repeat(22);
const J = (v) => JSON.stringify(v);
const embed = (titles) => '<html><script id="__NEXT_DATA__" type="application/json">' +
  J({ props: { pageProps: { state: { data: { entity: { trackList: titles.map((t) => ({ title: t, subtitle: 'Velvet Ghost' })) } } } } } }) + '</script></html>';
const art = (o = {}) => ({ name: 'Velvet Ghost', site: 'spotify', spotifyId: SP, songs: [], playing: false, spotifyAiLabel: true, ...o });

function setup({ fetchPage } = {}) {
  const store = openStore(':memory:');
  const queue = createQueue({ store, now: () => NOW, cap: 100 });
  const w = createWorker({
    store, queue, now: () => NOW, mapping: null, scoring: true, schedulePublish() {}, fetchPage,
    cheapPass: async () => null, aiLists: { match: async () => null }, fakeprintLayer: { scoreArtist: async () => [] },
    shlabs: { scoreTracks: async () => [] }, investigate: async () => ({ ok: false }),
  });
  return { store, queue, w };
}
const body = (item) => J({ items: [{ title: 'T', artistLine: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [SP], album: '', artUrl: '', ...item }] });

await run([
  ['embed: titles come out in page order, distinct', () => J(titlesFromEmbed(embed(['A', 'B', 'A', 'C']))) === J(['A', 'B', 'C']) || J(titlesFromEmbed(embed(['A', 'B', 'A', 'C'])))],
  ['embed: capped at 50 and each title at 200 chars', () => {
    const r = titlesFromEmbed(embed(Array.from({ length: 80 }, (_, i) => 'Song ' + i + (i === 0 ? 'x'.repeat(300) : ''))));
    return (r.length === 50 && r[0].length <= 200) || r.length;
  }],
  ['embed: junk gives an empty list', () => [undefined, '', '<html></html>', '<script id="__NEXT_DATA__">{not json</script>', embed([])].every((h) => titlesFromEmbed(h).length === 0) || 'not empty'],
  ['store: titles merge across saves and persist, no repeats', () => {
    const s = openStore(':memory:');
    addTitles(s, SP, ['A', 'B']); addTitles(s, SP, ['B', 'C']);
    return J(getTitles(s, SP)) === J(['A', 'B', 'C']) || J(getTitles(s, SP));
  }],
  ['store: capped at 50', () => {
    const s = openStore(':memory:');
    addTitles(s, SP, Array.from({ length: 40 }, (_, i) => 'a' + i)); addTitles(s, SP, Array.from({ length: 40 }, (_, i) => 'b' + i));
    return getTitles(s, SP).length === 50 || getTitles(s, SP).length;
  }],
  ['intake: songTitles with the flag are kept (max 20, cut to 200)', () => {
    const r = parseRequest(body({ spotifyAiLabel: true, songTitles: Array.from({ length: 30 }, (_, i) => (i === 0 ? 'x'.repeat(300) : 'S' + i)) }));
    const a = r.ok && r.artists[0];
    return (a && a.songTitles.length === 20 && a.songTitles[0].length <= 200) || J(r).slice(0, 200);
  }],
  ['intake: songTitles without the flag are dropped', () => {
    const r = parseRequest(body({ songTitles: ['A'] }));
    return (r.ok && !('songTitles' in r.artists[0])) || J(r);
  }],
  ['intake: songTitles that are not strings are ignored', () => {
    const r = parseRequest(body({ spotifyAiLabel: true, songTitles: ['ok', 5, null, { a: 1 }] }));
    return (r.ok && J(r.artists[0].songTitles) === J(['ok'])) || J(r);
  }],
  ['worker: the embed page titles are stored when the label verdict is saved', async () => {
    const urls = [];
    const t = setup({ fetchPage: async (u) => { urls.push(u); return embed(['Midnight Rain', 'Echoes']); } });
    t.queue.enqueue([art()]);
    const r = await t.w.runOne();
    const v = t.store.findVerdict(artistKeys(art()));
    return (r === 'done' && v && v.model === 'spotify-label' && J(getTitles(t.store, SP)) === J(['Midnight Rain', 'Echoes']) && urls[0] === 'https://open.spotify.com/embed/artist/' + SP) || J([r, urls, getTitles(t.store, SP)]);
  }],
  ['worker: a failing fetch still saves the verdict, with the titles the extension sent', async () => {
    const t = setup({ fetchPage: async () => { throw new Error('down'); } });
    t.queue.enqueue([art({ songTitles: ['Dust'] })]);
    const r = await t.w.runOne();
    const v = t.store.findVerdict(artistKeys(art()));
    return (r === 'done' && v && v.verdict === 'ai' && J(getTitles(t.store, SP)) === J(['Dust'])) || J([r, getTitles(t.store, SP)]);
  }],
  ['worker: no fetchPage at all still saves the verdict', async () => {
    const t = setup({});
    t.queue.enqueue([art()]);
    const r = await t.w.runOne();
    return (r === 'done' && !!t.store.findVerdict(artistKeys(art()))) || r;
  }],
  ['worker: extension titles merge with the embed titles', async () => {
    const t = setup({ fetchPage: async () => embed(['A', 'B']) });
    t.queue.enqueue([art({ songTitles: ['B', 'Dust'] })]);
    await t.w.runOne();
    return J(getTitles(t.store, SP)) === J(['A', 'B', 'Dust']) || J(getTitles(t.store, SP));
  }],
  ['publish: a spotify-label entry carries labelName and titles, no plain name; others are unchanged', () => {
    const s = openStore(':memory:');
    addTitles(s, SP, ['Echoes']);
    const label = { name: 'Velvet Ghost', spotifyId: SP, verdict: 'ai', confidence: 100, rawConfidence: 100, model: 'spotify-label', checked: '2026-11-25', source: 'live' };
    const other = { name: 'Plain Bot', verdict: 'ai', confidence: 100, rawConfidence: 100, model: 'list', checked: '2026-11-25', source: 'live' };
    const list = JSON.parse(buildList(withTitles(s, [label, other]), { now: NOW }));
    const a = list.artists.find((x) => x.labelName === 'Velvet Ghost') || {};
    const b = list.artists.find((x) => x.name === 'Plain Bot') || {};
    return (!('name' in a) && J(a.titles) === J(['Echoes']) && a.spotifyId === SP && !('titles' in b) && !('labelName' in b)) || J(list);
  }],
  ['publish: a label entry with no titles known publishes an empty titles array', () => {
    const s = openStore(':memory:');
    const label = { name: 'Quiet Ghost', spotifyId: 'Q'.repeat(22), verdict: 'ai', confidence: 100, rawConfidence: 100, model: 'spotify-label', checked: '2026-11-25', source: 'live' };
    const a = JSON.parse(buildList(withTitles(s, [label]), { now: NOW })).artists[0];
    return (J(a.titles) === J([]) && !('name' in a)) || J(a);
  }],
]);
