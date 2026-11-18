// The investigator path, end to end: an unknown artist playing on the YouTube Music stand-in
// page reaches the worker, which sends it with the key (this run is a development copy). The
// worker's fetch is recorded instead of reaching the network.
import { test, expect, openSite } from './fixtures.mjs';

const YTM = 'https://music.youtube.com/watch?v=e2e';
const UNKNOWN = 'E2E Unknown Act';

async function recordSends(worker, token) {
  await worker.evaluate(async (token) => {
    // The key lives in the extension's own IndexedDB, never in storage (hardening, 2026-11-18).
    await chrome.storage.local.set({ 'hm.investigator': {} });
    await globalThis.HM.secrets.set('investigator-token', token);
    globalThis.__hmSends = [];
    if (!globalThis.__hmFetch) {
      globalThis.__hmFetch = globalThis.fetch;
      globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('/api/investigate')) {
          globalThis.__hmSends.push({ url: String(url), auth: (init.headers || {}).Authorization, body: JSON.parse(init.body || '{}') });
          return new Response('{}', { status: 202 });
        }
        return globalThis.__hmFetch(url, init);
      };
    }
  }, token);
}
const sends = worker => worker.evaluate(() => globalThis.__hmSends || []);

test('an unknown artist playing reaches the investigator once, with the key', async ({ context, worker, setState }) => {
  await setState({ settings: { lookahead: 0, investigate: true } });
  await recordSends(worker, 'e2e-key');
  const page = await openSite(context, YTM, { songs: [{ title: 'Fresh Song', artist: UNKNOWN, channelId: 'UCIE9zgCYFKd-GLQX5jwhceZ', art: 'https://lh3.googleusercontent.com/e2e-cover=w544' }, { title: 'Next', artist: UNKNOWN }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible();
  await expect.poll(async () => (await sends(worker)).length, { timeout: 10_000 }).toBe(1);
  const [s] = await sends(worker);
  expect(s.url).toBe('https://wai-lau.net/human-music/api/investigate');
  expect(s.auth).toBe('Bearer e2e-key');
  expect(s.body.items.map(i => i.credits).flat()).toContain(UNKNOWN);
  // The player's artist link and cover travel with the playing song.
  expect(s.body.items[0].channelIds).toEqual(['UCIE9zgCYFKd-GLQX5jwhceZ']);
  expect(s.body.items[0].artUrl).toBe('https://lh3.googleusercontent.com/e2e-cover=w544');
  await page.waitForTimeout(2500); // the same artist is not sent again
  expect(await sends(worker)).toHaveLength(1);
});

test('nothing is sent while investigating is off', async ({ context, worker, setState }) => {
  await setState({ settings: { lookahead: 0, investigate: false } });
  await recordSends(worker, 'e2e-key');
  const page = await openSite(context, YTM, { songs: [{ title: 'Fresh Song', artist: UNKNOWN }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await sends(worker)).toEqual([]);
});
