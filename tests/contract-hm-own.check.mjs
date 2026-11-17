// Contract check (security audit 2026-11-17, finding 9): page markup can't take over the HM
// namespace. An element with id="HM" shows up as window.HM through the window's named
// properties (not an own property of the global), and the scripts used to adopt it.
// Run from the repo root: node tests/contract-hm-own.check.mjs
const { readFileSync, readdirSync } = await import('fs');
const { join } = await import('path');
const vm = await import('vm');
const fails = [];
const files = [];
const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk('extension');
const stale = files.filter(f => /globalThis\.HM\s*=\s*globalThis\.HM\s*\|\|/.test(readFileSync(f, 'utf8')));
if (stale.length) fails.push('still adopting any HM: ' + stale.join(', '));
// A global whose prototype carries HM, like a page element named HM.
const clobber = { tagName: 'A', id: 'HM' };
const proto = { HM: clobber };
const sandbox = Object.create(proto);
const ctx = vm.createContext(sandbox);
for (const f of ['extension/src/core/text.js', 'extension/src/core/store.js', 'extension/src/core/lists.js', 'extension/src/core/settings.js', 'extension/src/core/match.js', 'extension/src/core/log.js']) {
  try { vm.runInContext(readFileSync(f, 'utf8'), ctx, { filename: f }); } catch (e) { fails.push(f + ' threw: ' + e.message); }
}
const own = Object.prototype.hasOwnProperty.call(sandbox, 'HM');
if (!own) fails.push('HM is not the scripts\' own global');
else if (sandbox.HM === clobber) fails.push('HM is the page element');
else if (!sandbox.HM.text || !sandbox.HM.match || typeof sandbox.HM.match.buildIndex !== 'function') fails.push('HM lacks text or match');
if (Object.keys(clobber).length !== 2) fails.push('the page element was written to: ' + Object.keys(clobber).join(','));
console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
