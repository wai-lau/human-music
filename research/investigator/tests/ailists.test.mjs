// AI artist list matching: fetches three lists once a day, matches by spotifyId,
// channelId or normalised name. Failures fall back to the last good copy.
import { createAiLists } from '../src/ailists.mjs';
import { run } from './harness.mjs';

function fakeFetch(url) {
  if (url.includes('zoundhub')) return Promise.resolve({ ok: true, text: () => Promise.resolve(`{"artists":[{"name":"Zed Bot","spotifyId":"zbotid","idOnly":true},{"name":"Named Bot","spotifyId":"namedbotid"}]}`) });
  if (url.includes('soul-over-ai')) return Promise.resolve({ ok: true, text: () => Promise.resolve(`{"artists":[{"name":"Soul Fake","spotifyId":"soulfake"},{"name":"Name Only","spotify":"none"}]}`) });
  if (url.includes('Cevval')) return Promise.resolve({ ok: true, text: () => Promise.resolve('UCceval1\nUCceval2\n!comment\n\n') });
  return Promise.reject(new Error('no fake for ' + url));
}

const now = () => Date.now();
const lists = createAiLists({ fetch: fakeFetch, now });

await run([
  ['matches a Zoundhub artist by spotifyId', async () => {
    const m = await lists.match({ name: 'whatever', spotifyId: 'zbotid' });
    return m && m.listName === 'Zoundhub';
  }],
  ['matches a Zoundhub artist by name (case/spacing normalised)', async () => {
    const m = await lists.match({ name: '  NAMED bot ' });
    return m && m.listName === 'Zoundhub';
  }],
  ['idOnly entries match only by id, not by name', async () => {
    const m = await lists.match({ name: 'Zed Bot' });
    return !m;
  }],
  ['matches a Soul Over AI artist by spotifyId', async () => {
    const m = await lists.match({ name: 'whatever', spotifyId: 'soulfake' });
    return m && m.listName === 'Soul Over AI';
  }],
  ['matches a Soul Over AI artist by name', async () => {
    const m = await lists.match({ name: 'Soul Fake' });
    return m && m.listName === 'Soul Over AI';
  }],
  ['matches a Cevval channel by channelId only', async () => {
    const m = await lists.match({ name: 'whatever', channelId: 'UCceval1' });
    return m && m.listName === 'Cevval';
  }],
  ['Cevval has no name matching', async () => {
    const m = await lists.match({ name: 'Ce Vval' });
    return !m;
  }],
  ['returns null for an unlisted artist', async () => {
    const m = await lists.match({ name: 'Not Listed', spotifyId: 'xxx', channelId: 'UCyyy' });
    return m === null;
  }],
  ['uses a previous cached copy when download fails', async () => {
    let ok = true;
    const failingFetch = async (url) => {
      if (url.includes('zoundhub')) throw new Error('network');
      return fakeFetch(url);
    };
    const failing = createAiLists({ fetch: failingFetch, now });
    // First match (cache empty) fails for Zoundhub; Soul Over AI still works.
    const m = await failing.match({ name: 'Soul Fake' });
    ok = ok && m && m.listName === 'Soul Over AI';
    // One instance: a good download, then a day later Zoundhub fails; its last copy still matches.
    let t = 1_800_000_000_000; let down = false;
    const f = (url) => (down && url.includes('zoundhub') ? Promise.reject(new Error('network')) : fakeFetch(url));
    const l = createAiLists({ fetch: f, now: () => t });
    ok = ok && !!(await l.match({ name: 'Named Bot' }));
    down = true; t += 25 * 3600000;
    const kept = await l.match({ name: 'Named Bot' });
    return ok && kept && kept.listName === 'Zoundhub';
  }],
  ['throws a helpful error for non-objects', async () => {
    try {
      await lists.match('just a string');
      return false;
    } catch (e) {
      return /name/.test(e.message);
    }
  }],
  ['a day later the lists are downloaded again, so new entries arrive', async () => {
    let t = 1_800_000_000_000; let zh = '{"artists":[]}'; let calls = 0;
    const f = (url) => { calls++; return Promise.resolve({ ok: true, text: () => Promise.resolve(url.includes('zoundhub') ? zh : '[]') }); };
    const l = createAiLists({ fetch: f, now: () => t });
    const before = await l.match({ name: 'New Bot' });
    zh = '{"artists":[{"name":"New Bot","spotifyId":"newbotid"}]}';
    t += 3600000; const sameDay = await l.match({ name: 'New Bot' });
    t += 25 * 3600000; const after = await l.match({ name: 'New Bot' });
    return (before === null && sameDay === null && after && after.listName === 'Zoundhub' && calls === 6) || JSON.stringify({ before, sameDay, after, calls });
  }],
]);