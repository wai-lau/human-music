// The popup's log in three sections (Wai, 2026-11-15: "blocks: things that were
// 'adblocked' / actions: actions taken on behalf of the user, skip, dislike / errors"),
// grouped by artist ("grouping should be done by artist") so nothing repeats ("avoid
// repeating text in logs"): each artist once with its reason, each song once with a count.
import { load, run } from './load.mjs';

const { popup, log, match } = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/match.js', 'popup/model.js'], { URL }).HM;
const J = v => JSON.stringify(v);
// Local noon on 2026-11-15, so "today" and "yesterday" don't depend on the time zone.
const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime();
const MIN = 60000, DAY = 86400000;
const SOA = { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist' };
const MINE = { listId: 'user:artists', listName: 'Your artists', rule: 'artist' };
const e = (ago, event, title, artistLine, match = SOA, entry = 'The Velvet Sundown') => ({ at: NOW - ago, event, title, artistLine, ...match, entry });

run([
  ['plainError: list and investigator errors in plain words, the code kept in brackets', () => {
    const P = popup.plainError;
    const got = ['HTTP 404', 'HTTP 503', 'HTTP 401', 'Content-Length over 5242880 bytes', 'Body over 5242880 bytes', 'Not a filter list',
      'Not an https:// URL', 'TypeError: Failed to fetch', 'The operation was aborted due to timeout', 'Unexpected token < in JSON at position 0', 'weird thing', ''].map(m => P(m));
    const ok = /not found/i.test(got[0]) && /404/.test(got[0]) && /server/i.test(got[1]) && /503/.test(got[1]) && /refused/i.test(got[2])
      && /5 MB/.test(got[3]) && /5 MB/.test(got[4]) && /isn.t a filter list/i.test(got[5]) && /https:\/\//.test(got[6])
      && /couldn.t reach/i.test(got[7]) && /too long/i.test(got[8]) && /isn.t a filter list/i.test(got[9]) && /weird thing/.test(got[10]) && got[11] === 'unknown problem'
      && got.every(g => !/TypeError|Content-Length|Unexpected token/.test(g));
    return ok || J(got);
  }],
  // Review 2026-11-17: "Always show" puts the group's artist on Never skip, so the group must be
  // the listed artist that matched, not the whole credit line ("Some Person, The Velvet Sundown"
  // on Never skip never matched anything, while the switch showed as on).
  ['a two-artist entry is grouped under the artist that matched, and Always show then protects it', () => {
    const g = popup.groupLog([e(MIN, 'hidden', 'Duet', 'Some Person, The Velvet Sundown', SOA, 'Some Person')], { now: NOW, section: 'blocks' });
    const artist = g[0] && g[0].artist;
    const idx = match.buildIndex({ filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act', artists: [{ name: 'Some Person' }] }], user: { artists: [], songs: [], keywords: [], neverSkip: [artist] }, threshold: null });
    const after = match.matchItem(idx, { title: 'Duet', credits: ['Some Person', 'The Velvet Sundown'], channelIds: [], featured: false });
    return (artist === 'Some Person' && after === null) || J({ artist, after });
  }],
  ['a keyword or song match still groups under the lead credit', () => {
    const g = popup.groupLog([e(MIN, 'skipped', 'Neon', 'Aven • Album', { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword' }, 'neon')], { now: NOW, section: 'actions' });
    return (g[0] && g[0].artist === 'Aven') || J(g.map(x => x.artist));
  }],
  ['log.reason and log.action: short words', () =>
    log.reason(e(0, 'skipped', 'x', 'A')) === 'AI-generated · Soul Over AI'
    && log.reason({ listId: 'user:artists' }) === 'Your artists'
    && log.reason({ listId: 'user:songs' }) === 'Your songs'
    && log.reason({ listId: 'user:keywords', entry: 'suno' }) === 'Keyword “suno”'
    && log.action('removed') === 'Removed' && log.action('skipped') === 'Skipped' && log.action('hidden') === 'Hidden'
    && log.action('watched') === 'Would skip' && log.action('seen') === 'Played' && log.action('disliked') === 'Disliked'],
  ['log.section: blocks, actions, errors', () =>
    ['removed', 'hidden'].every(v => log.section(v) === 'blocks')
    && ['skipped', 'disliked', 'seen', 'watched'].every(v => log.section(v) === 'actions')
    && ['skip-failed', 'remove-failed'].every(v => log.section(v) === 'errors')
    && log.action('skip-failed') === 'Couldn’t skip' && log.action('remove-failed') === 'Couldn’t remove'],
  ['groupLog takes one section; counts per section for the switch', () => {
    const all = [e(MIN, 'skipped', 'A', 'X'), e(2 * MIN, 'removed', 'B', 'X'), e(3 * MIN, 'hidden', 'C', 'X'), e(4 * MIN, 'skip-failed', 'D', 'X')];
    const titles = sec => popup.groupLog(all, { now: NOW, section: sec }).flatMap(g => g.items.map(i => i.title));
    return (J(titles('blocks')) === J(['B', 'C']) && J(titles('actions')) === J(['A']) && J(titles('errors')) === J(['D'])
      && J(popup.sectionCounts(all)) === J({ blocks: 2, actions: 1, errors: 1 })) || J({ b: titles('blocks'), a: titles('actions'), e: titles('errors'), c: popup.sectionCounts(all) });
  }],
  ['grouped by artist across days: one group, each song once, newest first, album and year dropped', () => {
    const g = popup.groupLog([
      e(1 * MIN, 'skipped', 'Drift', 'The Velvet Sundown • Floating on Echoes • 2025'),
      e(2 * MIN, 'skipped', 'Dust on the Wind', 'The Velvet Sundown • Floating on Echoes • 2025'),
      e(3 * DAY, 'skipped', 'Let it Burn', 'The Velvet Sundown • Dust and Silence'),
    ], { now: NOW, section: 'actions' });
    return (g.length === 1 && g[0].artist === 'The Velvet Sundown' && g[0].reason === 'AI-generated · Soul Over AI' && g[0].total === 3
      && J(g[0].items.map(i => [i.title, i.action])) === J([['Drift', 'Skipped'], ['Dust on the Wind', 'Skipped'], ['Let it Burn', 'Skipped']]))
      || J(g);
  }],
  ['the same song again is one line with a count and its latest time', () => {
    const g = popup.groupLog([
      e(1 * MIN, 'hidden', 'Floating', 'The Velvet Sundown'),
      e(DAY, 'hidden', 'Floating', 'The Velvet Sundown'),
      e(2 * DAY, 'hidden', 'Floating', 'The Velvet Sundown'),
    ], { now: NOW, section: 'blocks' });
    const i = g[0].items;
    return (i.length === 1 && i[0].count === 3 && i[0].at === NOW - MIN && g[0].total === 3) || J(g);
  }],
  ['artists ordered by their newest entry', () => {
    const g = popup.groupLog([
      e(1 * MIN, 'skipped', 'Drift', 'The Velvet Sundown'),
      e(10 * MIN, 'skipped', 'Neon', 'Aven • Midnight', MINE, 'Aven'),
      e(20 * MIN, 'skipped', 'Dust', 'The Velvet Sundown'),
      e(DAY, 'skipped', 'Summer Echo', 'Desa feat. Amao • Summer Echo', SOA, 'Desa'),
    ], { now: NOW, section: 'actions' });
    // Desa, not "Desa feat. Amao": the listed artist that matched (review 2026-11-17).
    return J(g.map(x => x.artist)) === J(['The Velvet Sundown', 'Aven', 'Desa']) || J(g.map(x => x.artist));
  }],
  ['the same artist for two reasons stays two groups (each reason shown once)', () => {
    const g = popup.groupLog([e(1 * MIN, 'skipped', 'A', 'Aven'), e(2 * MIN, 'skipped', 'B', 'Aven', MINE, 'Aven')], { now: NOW, section: 'actions' });
    return g.length === 2 || J(g);
  }],
  ['groups say whether the artist is already on Never skip', () => {
    const g = popup.groupLog([e(MIN, 'skipped', 'Drift', 'The Velvet Sundown • X')], { now: NOW, section: 'actions', neverSkip: ['the velvet sundown'] });
    return g[0].onNeverSkip === true || J(g);
  }],
  ['timeLabel: minutes ago, today’s time, Yesterday, then the date', () => {
    const t = ago => popup.timeLabel(NOW - ago, NOW);
    return (t(30 * 1000) === 'just now' && t(5 * MIN) === '5 min ago' && /\d/.test(t(3 * 3600000)) && t(DAY) === 'Yesterday' && /Nov/.test(t(3 * DAY)))
      || J([t(30000), t(5 * MIN), t(3 * 3600000), t(DAY), t(3 * DAY)]);
  }],
  ['summary for the header: today’s skipped and removed songs', () =>
    J(popup.todaySummary([e(MIN, 'skipped', 'a', 'A'), e(MIN, 'disliked', 'b', 'A'), e(2 * MIN, 'removed', 'c', 'A'), e(3 * MIN, 'hidden', 'd', 'A'), e(DAY, 'skipped', 'e', 'A')], NOW))
      === J({ skipped: 2, removed: 1 })],
]);
