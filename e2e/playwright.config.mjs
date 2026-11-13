// End-to-end tests: real Chromium with the unpacked extension, on local stand-in pages
// served in place of music.youtube.com and open.spotify.com (no real site, no account,
// no network). Run: npm run e2e (first time: npx playwright install chromium).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: '.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one browser profile per test; keep the machine quiet
  retries: 0,
  reporter: [['list']],
});
