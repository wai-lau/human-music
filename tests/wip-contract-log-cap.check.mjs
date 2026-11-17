// Contract check (security audit 2026-11-17, hardening): text from the page or a list is
// capped before it goes into the log, so a hostile 1 MB title can't fill the log's storage.
// Run from the repo root: node tests/wip-contract-log-cap.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { HM } = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js'], {});
const fails = [];
const J = v => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const long = 'x'.repeat(1_000_000);

t('title, artist line, list name and entry are each at most 300 characters', () => {
  const e = HM.log.makeEntry({ event: 'skipped', song: { title: long, artistLine: long }, match: { listId: 'l', listName: long, rule: 'artist', entry: long }, at: 1 });
  return (e.title.length <= 300 && e.artistLine.length <= 300 && e.listName.length <= 300 && e.entry.length <= 300) || J({ t: e.title.length, a: e.artistLine.length, n: e.listName.length, e: e.entry.length });
});
t('ordinary text is kept exactly', () => {
  const e = HM.log.makeEntry({ event: 'skipped', song: { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating on Echoes' }, match: { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown' }, at: 1 });
  return (e.title === 'Dust on the Wind' && e.artistLine === 'The Velvet Sundown • Floating on Echoes' && e.listName === 'Soul Over AI' && e.entry === 'The Velvet Sundown') || J(e);
});
t('missing song and match still give empty text and nulls', () => {
  const e = HM.log.makeEntry({ event: 'skipped', song: null, match: null, at: 1 });
  return (e.title === '' && e.artistLine === '' && e.listName === null && e.entry === null) || J(e);
});
console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
