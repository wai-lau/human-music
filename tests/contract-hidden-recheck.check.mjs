// Contract check (review 2026-11-17, page side, finding 1): a hidden page item is checked again
// on later passes. YouTube Music reuses item elements for other songs (Polymer's dom-repeat), so
// an item hidden for a listed artist can come back as a person's song; it must be shown again.
// Run from the repo root: node tests/contract-hidden-recheck.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

async function page() {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const link = el('a', { href: 'channel/UC1111111111111111111111' }, 'The Velvet Sundown');
  const title = el('div', { class: 'title' }, 'Dust on the Wind');
  const row = el('ytmusic-responsive-list-item-renderer', {}, title, el('div', { class: 'secondary-flex-columns' }, 'Song • ', link));
  const doc = makeDocument(el('div', { id: 'results' }, row));
  doc.location.pathname = '/search';
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  return { app, clock, row, link, title, storage };
}

await t('an item hidden for a listed artist and reused for a person\'s song is shown again', async () => {
  const p = await page();
  const hiddenFirst = p.row.hasAttribute('data-hm-hidden');
  p.title.textContent = 'Real Song';
  p.link.textContent = 'Some Person';
  p.link.setAttribute('href', 'channel/UC2222222222222222222222');
  await settle(p.clock, 60); await settle(p.clock, 60); await p.app.flush();
  const shown = !p.row.hasAttribute('data-hm-hidden') && p.row.style.display !== 'none';
  return (hiddenFirst && shown) || J({ hiddenFirst, stillHidden: p.row.hasAttribute('data-hm-hidden'), display: p.row.style.display });
});
await t('an item that still matches stays hidden across passes', async () => {
  const p = await page();
  await settle(p.clock, 60); await settle(p.clock, 60); await p.app.flush();
  return p.row.hasAttribute('data-hm-hidden') || 'shown again while still listed';
});
await t('Spotify: a hidden item that still matches stays hidden across passes (the recheck uses the site\'s own reader)', async () => {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const card = el('div', { 'data-encore-id': 'card' }, el('a', { href: '/artist/5ExXpwxyFXhwPKYKx6ItaN' }, el('span', { 'data-encore-id': 'cardTitle' }, 'The Velvet Sundown')), el('div', { 'data-encore-id': 'cardSubtitle' }, 'Artist'));
  const doc = makeDocument(el('main', {}, card));
  doc.location.hostname = 'open.spotify.com';
  doc.location.pathname = '/search/velvet';
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  const first = card.hasAttribute('data-hm-hidden');
  for (let i = 0; i < 3; i++) { await settle(clock, 60); }
  await app.flush();
  return (first && card.hasAttribute('data-hm-hidden')) || J({ first, after: card.hasAttribute('data-hm-hidden') });
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
