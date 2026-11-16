// The popup, end to end: opened as a page of the real extension; changes reach the music tab.
import { test, expect, openSite, events } from './fixtures.mjs';

const YTM = 'https://music.youtube.com/watch?v=e2e';
const AI = 'E2E Generated Band';
const PERSON = 'E2E Person';
const popupUrl = id => `chrome-extension://${id}/popup/popup.html`;

test('the built-in Soul Over AI list shows its bundled artists', async ({ context, extensionId, setState }) => {
  await setState();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.locator('.tab[data-tab="lists"]').click(); // the popup opens on Log
  const row = popup.locator('#filter-lists .list-row').filter({ hasText: 'Soul Over AI' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.list-name')).toHaveText('Soul Over AI');
  await expect(row.locator('.chip')).toHaveText('Built in');
  await expect(row.locator('.list-info')).toContainText(/^[1-9][\d,]* artists/);
  await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('an artist added in the popup is skipped in an open tab', async ({ context, extensionId, setState, readLog }) => {
  await setState({ settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await expect(page.locator('#hm-block-artist')).toBeVisible();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.locator('.tab[data-tab="lists"]').click(); // the popup opens on Log
  await popup.locator('#artist-input').fill(AI);
  await popup.locator('#artist-input').press('Enter');
  await expect(popup.locator('#artists li span')).toHaveText([AI]);
  await expect.poll(async () => (await events(page)).filter(e => e.type === 'key-j').length).toBe(1);
  await expect.poll(async () => (await readLog()).map(e => e.event)).toEqual(['skipped']);
});

test('"Always show" in the log protects the artist', async ({ context, extensionId, setState, readStore }) => {
  await setState({ user: { artists: [AI] }, settings: { lookahead: 0 } });
  const page = await openSite(context, YTM, { songs: [{ title: 'Made Song', artist: AI }, { title: 'After', artist: PERSON }] });
  await expect.poll(async () => (await events(page)).filter(e => e.type === 'key-j').length).toBe(1);
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await expect(popup.locator('#log-entries .log-reason')).toHaveText(['Your artists']);
  await popup.locator('#log-entries .log-toggle').click();
  await expect(popup.locator('#log-entries .tag')).toHaveText(['Skipped']);
  await popup.getByRole('checkbox', { name: `Always show ${AI}` }).check();
  await expect.poll(async () => (await readStore('hm.user')).neverSkip).toEqual([AI]);
});

test('import merges a backup and refuses lists that are not https', async ({ context, extensionId, setState, readStore }) => {
  await setState({ user: { artists: ['Already There'] } });
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.locator('.tab[data-tab="lists"]').click(); // the popup opens on Log
  const backup = {
    format: 'human-music-backup', version: 1,
    user: { artists: ['Imported Act', 'already there'], songs: [{ title: 'One Song', artist: null }], keywords: [], neverSkip: [] },
    settings: { lookahead: 5 },
    filterLists: [
      { id: 'evil', name: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', enabled: true, mode: 'act' },
      { id: 'plain', name: 'Plain http', url: 'http://lists.example/a.json', enabled: true, mode: 'act' },
      { id: 'ok-list', name: '<b>Good</b> list', url: 'https://lists.example/b.json', enabled: true, mode: 'act' },
    ],
  };
  await popup.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await popup.locator('#import-btn').click();
  await expect(popup.locator('#status')).toContainText('Imported 2 artists');
  await expect.poll(async () => (await readStore('hm.user')).artists).toEqual(['Already There', 'Imported Act']);
  expect((await readStore('hm.settings')).lookahead).toBe(5);
  const lists = await readStore('hm.filterLists');
  expect(lists.map(l => l.id).sort()).toEqual(['hm-verdicts', 'ok-list', 'soul-over-ai']); // both built-ins stay
  expect(lists.find(l => l.id === 'ok-list').enabled).toBe(false); // arrives off: turning on asks for the site
  // The list name is shown as text, never as markup.
  await expect(popup.locator('.list-name').filter({ hasText: '<b>Good</b> list' })).toHaveCount(1);
  await expect(popup.locator('#filter-lists b, #filter-lists img')).toHaveCount(0);
});

test('behaviour settings are saved', async ({ context, extensionId, setState, readStore }) => {
  await setState();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.getByRole('button', { name: 'Behaviour' }).click();
  await popup.locator('#lookahead').fill('7');
  await popup.locator('#lookahead').dispatchEvent('change');
  await popup.locator('#auto-skip').uncheck();
  await expect.poll(async () => { const s = await readStore('hm.settings'); return [s.lookahead, s.autoSkip]; }).toEqual([7, false]);
  await popup.locator('#lookahead').fill('99');
  await popup.locator('#lookahead').dispatchEvent('change');
  await expect.poll(async () => (await readStore('hm.settings')).lookahead).toBe(10); // capped
});

test('the run stays offline: the list download fails and the bundled copy is kept', async ({ setState, readStore }) => {
  await setState();
  const soa = (await readStore('hm.filterLists')).find(l => l.id === 'soul-over-ai');
  expect(soa.lastRefresh).toBeNull();
  expect(soa.lastError).toBeTruthy();
  expect((await readStore('hm.list.soul-over-ai')).artists.length).toBeGreaterThan(1000);
});
