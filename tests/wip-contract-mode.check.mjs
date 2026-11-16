// Contract check for the investigator plan, Task 1 (filtering mode in settings). Run from the repo root:
//   node tests/wip-contract-mode.check.mjs
// Wai, 2026-11-15: "no filtering / list-only / optimal, searches and blocks 95% confidence AI music /
// aggressive, blocks 60%+ confidence".
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { settings } = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js']).HM;
const fails = [];
const J = v => JSON.stringify(v);
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const tryEq = (label, fn, want) => { try { eq(label, fn(), want); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

tryEq('modes', () => settings.MODES, ['off', 'lists', 'optimal', 'aggressive']);
tryEq('default', () => settings.sanitize({}).mode, 'lists');
tryEq('defaults object', () => settings.DEFAULTS.mode, 'lists');
tryEq('old paused migrates', () => settings.sanitize({ paused: true }).mode, 'off');
tryEq('mode wins over paused', () => settings.sanitize({ paused: true, mode: 'optimal' }).mode, 'optimal');
tryEq('paused follows mode', () => [settings.sanitize({ mode: 'off' }).paused, settings.sanitize({ mode: 'aggressive' }).paused], [true, false]);
tryEq('junk mode', () => settings.sanitize({ mode: 'turbo' }).mode, 'lists');
tryEq('inherited key is junk', () => settings.sanitize({ mode: 'toString' }).mode, 'lists');
tryEq('thresholds', () => ['off', 'lists', 'optimal', 'aggressive'].map(m => settings.threshold(m)), [null, null, 95, 60]);
tryEq('modeChosen and investigate kept, default false', () => [settings.sanitize({}).modeChosen, settings.sanitize({}).investigate, settings.sanitize({ modeChosen: true, investigate: true }).investigate], [false, false, true]);
tryEq('default follows calibration', () => [settings.effectiveMode(settings.sanitize({}), false), settings.effectiveMode(settings.sanitize({}), true)], ['lists', 'optimal']);
tryEq('a chosen mode stays', () => settings.effectiveMode(settings.sanitize({ mode: 'lists', modeChosen: true }), true), 'lists');
tryEq('chosen off stays off', () => settings.effectiveMode(settings.sanitize({ mode: 'off', modeChosen: true }), true), 'off');
tryEq('other settings unchanged', () => { const s = settings.sanitize({ lookahead: 4, autoSkip: false }); return [s.lookahead, s.autoSkip, s.refresh]; }, [4, false, 'daily']);

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
