// The store copy (no dev-copy marker, like a packed release) acts like a store install, and the
// development copy (the marker added to a temporary copy) still acts like one: the shipped
// my-lists.json backup is imported only by the development copy, and only it shows the investigator.
import { test, expect } from './fixtures.mjs';

const popupUrl = id => `chrome-extension://${id}/popup/popup.html`;
const devModeAnswer = page => page.evaluate(() => new Promise(res => chrome.runtime.sendMessage({ type: 'dev-mode' }, res)));

test.describe('store copy', () => {
  test.use({ storeCopy: true });

  test('does not import the bundled my-lists.json backup, but keeps the built-in lists', async ({ setState, readStore }) => {
    await setState();
    const seen = Object.keys(await readStore('hm.bundled'));
    expect(seen).toContain('soul-over-ai.json');
    expect(seen).not.toContain('my-lists.json');
  });

  test('says it is not a development copy and hides the investigator in the popup', async ({ context, extensionId, setState }) => {
    await setState();
    const popup = await context.newPage();
    await popup.goto(popupUrl(extensionId));
    await popup.locator('.tab[data-tab="behaviour"]').click(); // the investigator section lives on Behaviour
    expect(await devModeAnswer(popup)).toBe(false);
    await expect(popup.locator('#investigator')).toBeHidden();
  });
});

test.describe('development copy', () => {
  test('imports the bundled my-lists.json backup and shows the investigator in the popup', async ({ context, extensionId, setState, readStore }) => {
    await setState();
    expect(Object.keys(await readStore('hm.bundled'))).toContain('my-lists.json');
    const popup = await context.newPage();
    await popup.goto(popupUrl(extensionId));
    await popup.locator('.tab[data-tab="behaviour"]').click();
    expect(await devModeAnswer(popup)).toBe(true);
    await expect(popup.locator('#investigator')).toBeVisible();
  });
});
