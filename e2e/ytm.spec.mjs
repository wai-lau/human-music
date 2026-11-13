// YouTube Music, end to end: the real extension in Chromium on the stand-in page.
import { test, expect, openSite, events } from './fixtures.mjs';

const YTM = 'https://music.youtube.com/watch?v=e2e';
const AI = 'E2E Generated Band';
const PERSON = 'E2E Person';
const nexts = list => list.filter(e => e.type === 'key-j' || e.type === 'next-button');

test('a listed artist playing is skipped once and logged', async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'Next Song', artist: PERSON }] });
  await expect.poll(async () => nexts(await events(page)).length).toBe(1);
  await expect(page.locator('.ytmusicTrackInfoTitle')).toHaveText('Next Song');
  await expect.poll(async () => (await readLog()).map(e => `${e.event}:${e.title}`)).toEqual(['skipped:Made Song']);
  await page.waitForTimeout(2500); // no second Next for the song after it
  expect(nexts(await events(page))).toHaveLength(1);
});

test("a person's song keeps playing (nothing pressed, nothing logged)", async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Real Song', artist: PERSON }, { title: 'After', artist: PERSON }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible(); // the content script is running
  await page.waitForTimeout(3000);
  expect(nexts(await events(page))).toEqual([]);
  expect(await readLog()).toEqual([]);
});

test('never skip wins over every list', async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI], neverSkip: [AI] }, settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(nexts(await events(page))).toEqual([]);
  expect(await readLog()).toEqual([]);
});

test('a paused tab is left alone until it plays', async ({ context, setState }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { playing: false, songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible();
  await page.waitForTimeout(2500);
  expect(nexts(await events(page))).toEqual([]);
});

test('auto-skip off: the song plays and is logged as seen', async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 0, autoSkip: false } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await expect.poll(async () => (await readLog()).map(e => e.event)).toEqual(['seen']);
  expect(nexts(await events(page))).toEqual([]);
});

test('lookahead removes a listed song from the queue before it plays', async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 3 } });
  const page = await openSite(context, YTM, { songs: [
    { title: 'Now Playing', artist: PERSON },
    { title: 'Made Song', artist: AI },
    { title: 'Later', artist: PERSON },
  ] });
  await expect.poll(async () => (await events(page)).filter(e => e.type === 'removed').map(e => e.title)).toEqual(['Made Song']);
  await expect(page.locator('#queue .song-title')).toHaveText(['Now Playing', 'Later']);
  expect((await events(page)).filter(e => e.type === 'radio')).toEqual([]); // only the remove item was pressed
  await expect.poll(async () => (await readLog()).map(e => `${e.event}:${e.title}`)).toEqual(['removed:Made Song']);
  expect(nexts(await events(page))).toEqual([]);
});

test('search results by a listed artist are hidden, others stay', async ({ context, setState }) => {
  await setState({ user: { artists: [AI] } });
  const page = await openSite(context, 'https://music.youtube.com/search?q=e2e', {
    songs: [{ title: 'Real Song', artist: PERSON }],
    items: [{ title: 'Made Song', artist: AI }, { title: 'Real Song', artist: PERSON }],
  });
  await expect(page.locator('[data-e2e="Made Song"]')).toBeHidden();
  await expect(page.locator('[data-e2e="Real Song"]')).toBeVisible();
});

test('Block artist adds the playing credit to your artists and skips it', async ({ context, setState, readStore }) => {
  await setState({ settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Some Song', artist: 'E2E Blockable' }, { title: 'After', artist: PERSON }] });
  await page.locator('#hm-block-artist').click();
  await expect.poll(async () => (await readStore('hm.user')).artists).toEqual(['E2E Blockable']);
  await expect.poll(async () => nexts(await events(page)).length).toBe(1);
});

test('the Block artist button sits right of Repeat, once', async ({ context, setState }) => {
  await setState();
  const page = await openSite(context, YTM, { songs: [{ title: 'Real Song', artist: PERSON }] });
  await expect(page.locator('#hm-block-artist')).toHaveCount(1);
  const order = await page.locator('.ytmusicPlayerControlsMainControls button').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label')));
  expect(order).toEqual(['Previous', 'Next', 'Repeat off', 'Block artist']);
});

test('pausing Human Music in settings stops it acting', async ({ context, setState, readLog }) => {
  await setState({ user: { artists: [AI] }, settings: { paused: true, lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await page.waitForTimeout(3000);
  expect(nexts(await events(page))).toEqual([]);
  expect(await readLog()).toEqual([]);
  await expect(page.locator('#hm-block-artist')).toHaveCount(0);
});
