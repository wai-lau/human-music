// Spotify web player, end to end: the real extension in Chromium on the stand-in page.
import { test, expect, openSite, events, LISTED } from './fixtures.mjs';

const PLAYER = 'https://open.spotify.com/album/e2e';
const PERSON = { artist: 'E2E Person', id: 'E2EPerson0000000000000' };
const nexts = list => list.filter(e => e.type === 'next-button');

test('a listed artist is matched by Spotify ID (whatever name shows) and skipped', async ({ context, setState, readLog }) => {
  await setState({ settings: { lookahead: 0 } });
  const page = await openSite(context, PLAYER, { songs: [
    { title: 'Made Song', artist: 'E2E Renamed Act', id: LISTED.spotifyId },
    { title: 'Next Song', ...PERSON },
  ] });
  await expect.poll(async () => nexts(await events(page)).length).toBe(1);
  await expect.poll(async () => (await readLog()).map(e => `${e.event}:${e.listName}:${e.entry}`)).toEqual([`skipped:Soul Over AI:${LISTED.name}`]);
  await page.waitForTimeout(2000);
  expect(nexts(await events(page))).toHaveLength(1);
});

test("a person's song keeps playing", async ({ context, setState, readLog }) => {
  await setState({ settings: { lookahead: 0 } });
  const page = await openSite(context, PLAYER, { songs: [{ title: 'Real Song', ...PERSON }, { title: 'After', ...PERSON }] });
  await expect(page.locator('[aria-label="Block artist"]')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(nexts(await events(page))).toEqual([]);
  expect(await readLog()).toEqual([]);
});

test('the Queue panel is opened once and a listed song is removed from it', async ({ context, setState, readLog }) => {
  await setState({ settings: { lookahead: 3 } });
  const page = await openSite(context, PLAYER, { songs: [
    { title: 'Now Playing', ...PERSON },
    { title: 'Made Song', artist: 'E2E Renamed Act', id: LISTED.spotifyId },
    { title: 'Later', ...PERSON },
  ] });
  await expect.poll(async () => (await events(page)).filter(e => e.type === 'removed').map(e => e.title)).toEqual(['Made Song']);
  await expect(page.locator('aside[aria-label="Queue"] li[role="row"]')).toHaveCount(1);
  const ev = await events(page);
  expect(ev.filter(e => e.type === 'queue-open')).toHaveLength(1);
  expect(ev.filter(e => e.type === 'album')).toEqual([]); // only the exact remove icon is pressed
  await expect.poll(async () => (await readLog()).map(e => e.event)).toEqual(['removed']);
});

test('a Queue panel the person closes stays closed', async ({ context, setState }) => {
  await setState({ settings: { lookahead: 3 } });
  const page = await openSite(context, PLAYER, { songs: [{ title: 'Now Playing', ...PERSON }, { title: 'Later', ...PERSON }] });
  await expect(page.locator('aside[aria-label="Queue"]')).toBeVisible();
  await page.locator('[data-testid="control-button-queue"]').click();
  await page.waitForTimeout(5000); // past every retry Human Music would make
  await expect(page.locator('aside[aria-label="Queue"]')).toHaveCount(0);
});

test('search cards by a listed artist are hidden, others stay', async ({ context, setState }) => {
  await setState();
  const page = await openSite(context, 'https://open.spotify.com/search/e2e', {
    songs: [{ title: 'Real Song', ...PERSON }],
    items: [{ title: 'Made Song', artist: 'E2E Renamed Act', id: LISTED.spotifyId }, { title: 'Real Song', ...PERSON }],
  });
  await expect(page.locator('[data-e2e="Made Song"]')).toBeHidden();
  await expect(page.locator('[data-e2e="Real Song"]')).toBeVisible();
});
