// The shape every page adapter (HM.ytm, HM.spotify) gives content.js, in one place (audit D5).
// content.js calls the required methods on any site and probes the optional ones first; an
// adapter that adds a site must pass this test.
import { readFileSync } from 'fs';
import { run, load } from './load.mjs';

const REQUIRED = ['readSong', 'readQueue', 'clickNext', 'pressNextKey', 'clickDislike', 'videoDuration', 'videoState',
  'seekTo', 'removeQueueRow', 'mountPlayerButtons', 'readPageItems', 'hideItem', 'unhideItem', 'unhideAll'];
// Each group is all-or-nothing: content.js uses a group only when every method in it is there.
const OPTIONAL = {
  'queue panel (Spotify draws the queue only in a panel)': ['queueOpen', 'openQueue', 'closeQueue', 'timeLeft'],
  'marked rows (rows that will be skipped look unavailable)': ['readListRows', 'markRow', 'unmarkRow'],
};

const ctx = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'], { setTimeout, clearTimeout });
const ADAPTERS = { ytm: ctx.HM.ytm, spotify: ctx.HM.spotify };
const content = readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');

run([
  ...Object.entries(ADAPTERS).map(([name, a]) => [`${name} has every required method`, () => {
    const missing = REQUIRED.filter(m => typeof a[m] !== 'function');
    return missing.length === 0 || `missing: ${missing.join(', ')}`;
  }]),
  ...Object.entries(ADAPTERS).map(([name, a]) => [`${name}: each optional group is complete or absent`, () => {
    const half = Object.entries(OPTIONAL).filter(([, ms]) => { const have = ms.filter(m => typeof a[m] === 'function').length; return have > 0 && have < ms.length; });
    return half.length === 0 || `incomplete: ${half.map(([g]) => g).join('; ')}`;
  }]),
  ['content.js calls nothing on the adapter beyond this list', () => {
    const known = new Set([...REQUIRED, ...Object.values(OPTIONAL).flat()]);
    const used = [...new Set([...content.matchAll(/\bsite\.([a-zA-Z]+)/g)].map(m => m[1]))];
    const unknown = used.filter(m => !known.has(m));
    return unknown.length === 0 || `add to tests/adapters.test.mjs: ${unknown.join(', ')}`;
  }],
]);
