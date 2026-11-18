// Shared E2E fixtures: a fresh Chromium profile with Human Music loaded, its service
// worker, and stand-in pages for the two music sites. Every request leaves the browser
// only through context.route: the stand-in pages are served from e2e/pages, the list
// download is refused (the extension then keeps its bundled copy) and anything else is
// aborted, so a run never touches the real sites or the network.
import { test as base, chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { join, basename } from 'path';

const here = fileURLToPath(new URL('.', import.meta.url));
// The extension the tests read from. HM_E2E_EXT: run against another copy of the extension (a
// mutation check, a build); that copy is loaded as it is.
export const EXT = process.env.HM_E2E_EXT || join(here, '..', 'extension');

// Each test loads its own temporary copy, so a run never writes into the checkout. The tests drive
// a development copy (the investigator section, the page aids, the my-lists.json import), which
// needs the dev-copy marker (a file kept out of version control): the run adds it to the temporary
// copy only. A test that sets `storeCopy` gets the copy without the marker, like a packed release.
function makeCopy(storeCopy) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-e2e-ext-'));
  const ext = join(dir, 'extension');
  cpSync(EXT, ext, { recursive: true, filter: src => basename(src) !== 'dev-copy' });
  if (!storeCopy) writeFileSync(join(ext, 'dev-copy'), 'Development copy marker, added by the e2e run.\n');
  return { dir, ext };
}
const PAGES = { 'music.youtube.com': 'ytm.html', 'open.spotify.com': 'spotify.html' };

// The "Remove from queue" icons the adapters look for, read from the adapters themselves.
const iconOf = file => readFileSync(join(EXT, 'src/page', file), 'utf8').match(/const REMOVE_ICON = '([^']+)'/)[1];
export const ICONS = { ytm: iconOf('ytm.js'), spotify: iconOf('spotify.js') };

// An artist from the bundled Soul Over AI list that has a Spotify ID.
const SOA = JSON.parse(readFileSync(join(EXT, 'lists/soul-over-ai.json'), 'utf8'));
export const LISTED = (Array.isArray(SOA) ? SOA : SOA.artists).find(a => a && a.name && /^[A-Za-z0-9]{22}$/.test(a.spotifyId || ''));

const EMPTY_USER = { artists: [], songs: [], keywords: [], neverSkip: [] };

export const test = base.extend({
  storeCopy: [false, { option: true }],

  context: async ({ storeCopy }, use) => {
    const copy = process.env.HM_E2E_EXT && !storeCopy ? null : makeCopy(storeCopy);
    const ext = copy ? copy.ext : EXT;
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // new headless: runs extensions
      headless: !process.env.HM_E2E_HEADED,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required',
        // The service worker's fetches skip context.route: no host resolves, so its list
        // download fails and the bundled copy stays (the stand-in pages are routed first).
        '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      const page = url.protocol === 'https:' && PAGES[url.hostname];
      if (page) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(join(here, 'pages', page), 'utf8') });
      return route.abort('internetdisconnected');
    });
    await use(context);
    await context.close();
    if (copy) rmSync(copy.dir, { recursive: true, force: true });
  },

  worker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },

  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },

  // Wait until the install (defaults, bundled lists, first list download) has settled,
  // then replace your lists and settings with the test's own. The filter lists stay as
  // installed: Soul Over AI from the bundled copy in extension/lists.
  setState: async ({ worker }, use) => {
    await expect.poll(() => worker.evaluate(async () => {
      const r = await chrome.storage.local.get(['hm.bundled', 'hm.filterLists']);
      const soa = (r['hm.filterLists'] || []).find(l => l.id === 'soul-over-ai');
      return !!(r['hm.bundled'] && soa && (soa.lastError || soa.lastRefresh));
    }), { timeout: 15_000 }).toBe(true);
    await use(async ({ user = {}, settings = {} } = {}) => {
      await worker.evaluate(async ({ user, settings }) => {
        const cur = await chrome.storage.local.get('hm.settings');
        await chrome.storage.local.set({ 'hm.user': user, 'hm.settings': { ...cur['hm.settings'], ...settings }, 'hm.log': [] });
      }, { user: { ...EMPTY_USER, ...user }, settings });
    });
  },

  // Read Human Music's log (newest first).
  readLog: async ({ worker }, use) => {
    await use(() => worker.evaluate(async () => (await chrome.storage.local.get('hm.log'))['hm.log'] || []));
  },

  readStore: async ({ worker }, use) => {
    await use(key => worker.evaluate(async k => (await chrome.storage.local.get(k))[k], key));
  },
});

// Open a stand-in page. setup is read by the page's own script (window.__setup).
export async function openSite(context, url, setup) {
  const page = await context.newPage();
  await page.addInitScript(s => { window.__setup = s; }, { ...setup, icons: ICONS });
  await page.goto(url);
  return page;
}

// What the stand-in page saw: Next presses, menu clicks, removals.
export const events = page => page.evaluate(() => window.__events.slice());

export { expect };
