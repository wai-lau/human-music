// The popup, end to end: opened as a page of the real extension; changes reach the music tab.
import { test, expect, openSite, events } from './fixtures.mjs';

const YTM = 'https://music.youtube.com/watch?v=e2e';
const AI = 'E2E Generated Band';
const PERSON = 'E2E Person';
const popupUrl = id => `chrome-extension://${id}/popup/popup.html`;

test('the built-in Soul Over AI list shows its downloaded artists', async ({ context, extensionId, setState }) => {
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
  await expect(popup.locator('#import-confirm')).toBeVisible();
  await popup.locator('#import-apply').click();
  await expect(popup.locator('#status')).toContainText('Imported 2 artists');
  await expect.poll(async () => (await readStore('hm.user')).artists).toEqual(['Already There', 'Imported Act']);
  expect((await readStore('hm.settings')).lookahead).toBe(5);
  const lists = await readStore('hm.filterLists');
  expect(lists.map(l => l.id).filter(id => id !== 'cevval').sort()).toEqual(['hm-verdicts', 'ok-list', 'soul-over-ai', 'zoundhub']); // the built-ins stay; only the https list joins
  expect(lists.find(l => l.id === 'ok-list').enabled).toBe(false); // arrives off: turning on asks for the site
  // The list name is shown as text, never as markup.
  await expect(popup.locator('.list-name').filter({ hasText: '<b>Good</b> list' })).toHaveCount(1);
  await expect(popup.locator('#filter-lists b, #filter-lists img')).toHaveCount(0);
});

test('behaviour settings are saved', async ({ context, extensionId, setState, readStore }) => {
  await setState();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.getByRole('tab', { name: 'Behaviour' }).click();
  await popup.locator('#lookahead').fill('7');
  await popup.locator('#lookahead').dispatchEvent('change');
  await popup.locator('#auto-skip').uncheck();
  await expect.poll(async () => { const s = await readStore('hm.settings'); return [s.lookahead, s.autoSkip]; }).toEqual([7, false]);
  await popup.locator('#lookahead').fill('99');
  await popup.locator('#lookahead').dispatchEvent('change');
  await expect.poll(async () => (await readStore('hm.settings')).lookahead).toBe(10); // capped
});

test('the run stays offline: the list download fails and the last downloaded copy is kept', async ({ setState, readStore }) => {
  await setState();
  const soa = (await readStore('hm.filterLists')).find(l => l.id === 'soul-over-ai');
  expect(soa.lastRefresh).toBeNull();
  expect(soa.lastError).toBeTruthy();
  expect((await readStore('hm.list.soul-over-ai')).artists.length).toBeGreaterThan(1000);
});

test('the filtering mode slider saves the mode and snaps back while the verdict list is not ready', async ({ context, extensionId, setState, readStore }) => {
  await setState();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  const slider = popup.getByRole('slider', { name: 'Filtering mode' });
  await expect(popup.locator('#mode-label')).toHaveText('List only');
  await slider.focus();
  await slider.press('ArrowRight'); // Optimal: not ready, lands on List only
  await expect(popup.locator('#status')).toContainText('not ready yet');
  await expect(popup.locator('#mode-label')).toHaveText('List only');
  await slider.press('Home');
  await expect(popup.locator('#mode-label')).toHaveText('No filtering');
  await expect.poll(async () => { const s = await readStore('hm.settings'); return [s.mode, s.modeChosen, s.paused]; }).toEqual(['off', true, true]);
  await slider.press('ArrowRight');
  await expect.poll(async () => { const s = await readStore('hm.settings'); return [s.mode, s.paused]; }).toEqual(['lists', false]);
});

test('the investigator key section shows in this development copy and never shows the key back', async ({ context, extensionId, setState, readStore, worker }) => {
  await setState();
  const popup = await context.newPage();
  await popup.goto(popupUrl(extensionId));
  await popup.getByRole('tab', { name: 'Behaviour' }).click();
  await expect(popup.locator('#investigator')).toBeVisible();
  await popup.locator('#investigator-token').fill('e2e-secret-key');
  await popup.locator('#investigator-save').click();
  await expect(popup.locator('#investigator-token')).toHaveValue('');
  await expect(popup.locator('#investigator-status')).toContainText('A key is saved');
  // Kept in the extension's own IndexedDB, out of the storage the music pages can read.
  await expect.poll(async () => worker.evaluate(() => globalThis.HM.secrets.get('investigator-token'))).toBe('e2e-secret-key');
  expect(JSON.stringify(await readStore('hm.investigator'))).not.toContain('e2e-secret-key');
  expect((await readStore('hm.settings')).investigate).toBe(true);
});

for (const scheme of ['light', 'dark']) {
  test(`popup screenshot, ${scheme}`, async ({ context, extensionId, setState }) => {
    await setState();
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 400, height: 640 });
    await popup.goto(popupUrl(extensionId));
    await popup.getByRole('tab', { name: 'Behaviour' }).click();
    await popup.locator('#investigator').scrollIntoViewIfNeeded();
    await popup.screenshot({ path: `e2e/.results/popup-${scheme}.png` });
  });
}

test('the four stop dots sit where the thumb lands for each value', async ({ context, extensionId, setState }) => {
  await setState();
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 400, height: 300 });
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.goto(popupUrl(extensionId));
  const input = await popup.locator('#mode').boundingBox();
  const dots = popup.locator('.mode-dot');
  await expect(dots).toHaveCount(4);
  await popup.evaluate(() => { window.__seen = []; document.getElementById('mode').addEventListener('input', e => window.__seen.push(e.target.value)); });
  for (let v = 0; v < 4; v++) {
    const d = await dots.nth(v).boundingBox();
    const dotX = d.x + d.width / 2;
    // The browser puts the thumb centre half a thumb (9px) in from each end of the input.
    const thumbX = input.x + 9 + (input.width - 18) * v / 3;
    expect(Math.abs(dotX - thumbX)).toBeLessThanOrEqual(2);
    // And the browser agrees: pressing on a dot's centre moves the thumb to that stop.
    await popup.mouse.click(dotX, input.y + input.height / 2);
    expect(Number(await popup.evaluate(() => window.__seen.at(-1)))).toBe(v);
    // Screenshot at this value (an unready stop snaps back after a click, so set the stop directly).
    await popup.evaluate(n => { const m = document.getElementById('mode'); m.value = String(n); m.dispatchEvent(new Event('input')); }, v);
    await popup.locator('.mode').screenshot({ path: `e2e/.results/slider-${v}.png` });
  }
});
