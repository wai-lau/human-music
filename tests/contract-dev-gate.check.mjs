// Contract check: development aids run only in a development install (audit 2026-11-13).
// Run from the repo root: node tests/contract-dev-gate.check.mjs (tests/contracts.test.mjs runs them all).
// Old gate: "no update_url in the manifest", which is also true of a Firefox add-on from
// addons.mozilla.org, so any page could make a released copy reload itself in a loop and
// read its settings off <html>. New gate: management.getSelf().installType === 'development'
// (an unpacked Chrome extension, a temporary Firefox add-on); getSelf needs no permission.
// The worker answers { type: 'dev-mode' } with true or false; the content script asks it
// and adds its page aids (the dev-reload message listener, the data-hm-* status) only on true.
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const { makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.stack || e}`); } };
const settle = () => new Promise(r => setTimeout(r, 30));
const manifest = JSON.parse(readFileSync(process.cwd() + '/extension/manifest.json', 'utf8'));
delete manifest.update_url; // as unpacked Chrome and every Firefox build

// --- worker ------------------------------------------------------------------------------

// installType: a string (getSelf resolves to it), 'none' (no management API), or 'throws'.
function worker(installType, { callbackOnly = false } = {}) {
  const seen = { reloads: 0, message: null };
  const storage = fakeStorage({});
  const ev = name => ({ addListener: fn => { seen[name] = fn; } });
  const chrome = {
    storage: { local: storage },
    runtime: { id: 'abc', getManifest: () => manifest, reload: () => { seen.reloads++; }, getURL: p => 'chrome-extension://abc/' + p,
      onInstalled: ev('installed'), onStartup: ev('startup'), onMessage: ev('message'), lastError: undefined },
    alarms: { create: () => {}, onAlarm: ev('alarm') },
    tabs: { query: (q, cb) => cb([]), sendMessage: () => {} },
    scripting: { executeScript: async () => [] },
  };
  if (installType !== 'none') {
    chrome.management = {
      getSelf: cb => {
        if (installType === 'throws') throw new Error('no management');
        const info = { id: 'abc', installType };
        if (typeof cb === 'function') { setTimeout(() => cb(info), 0); return undefined; }
        if (callbackOnly) throw new Error('promise form not supported here');
        return Promise.resolve(info);
      },
    };
  }
  const ctx = load([], {
    chrome, setTimeout, clearTimeout,
    importScripts: (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); },
    fetch: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
  const ask = msg => new Promise(resolve => {
    let done = false;
    const kept = seen.message(msg, { id: 'abc' }, v => { done = true; resolve(v); });
    if (!kept && !done) setTimeout(() => resolve(undefined), 50);
  });
  return { seen, storage, ask };
}

const devKeys = storage => Object.keys(storage.data).filter(k => k.startsWith('hm.dev.'));

for (const kind of ['normal', 'admin', 'sideload', 'other', 'none', 'throws']) {
  await t(`worker: ${kind} install is not development`, async () => {
    const w = worker(kind);
    await settle();
    if (typeof w.seen.message !== 'function') return 'no onMessage listener';
    const mode = await w.ask({ type: 'dev-mode' });
    w.seen.message({ type: 'dev-reload' }, { id: 'abc' }, () => {});
    await settle();
    if (w.seen.installed) { w.seen.installed({ reason: 'install' }); await settle(); }
    return (mode === false && w.seen.reloads === 0 && devKeys(w.storage).length === 0) || J({ mode, reloads: w.seen.reloads, devKeys: devKeys(w.storage) });
  });
}

await t('worker: development install answers dev-mode true and reloads', async () => {
  const w = worker('development');
  await settle();
  const mode = await w.ask({ type: 'dev-mode' });
  w.seen.message({ type: 'dev-reload' }, { id: 'abc' }, () => {});
  await settle();
  return (mode === true && w.seen.reloads === 1) || J({ mode, reloads: w.seen.reloads });
});

await t('worker: dev-mode asked before getSelf answers still gets the right answer', async () => {
  const w = worker('development');
  const mode = await w.ask({ type: 'dev-mode' }); // no settle first
  return mode === true || J(mode);
});

await t('worker: getSelf with a callback only (no promise) still works', async () => {
  const w = worker('development', { callbackOnly: true });
  const mode = await w.ask({ type: 'dev-mode' });
  return mode === true || J(mode);
});

await t('worker: refresh messages still work in a normal install', async () => {
  const w = worker('normal');
  await settle();
  const kept = w.seen.message({ type: 'refresh', id: 'nope' }, { id: 'abc' }, () => {});
  return kept === true || 'refresh handler did not keep the channel open';
});

// --- content script ------------------------------------------------------------------------

const CORE = ['src/core/text.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/content.js'];

function content(devAnswer) {
  const doc = makeDocument();
  const listeners = [];
  const sent = [];
  const intervals = [];
  const window = { addEventListener: (type, fn) => listeners.push({ type, fn }), postMessage: () => {} };
  const chrome = {
    storage: { local: fakeStorage({ 'hm.dev.installed': { at: 1, reason: 'install' } }) },
    runtime: {
      id: 'abc', getManifest: () => manifest, onMessage: { addListener: () => {} },
      sendMessage: (msg, cb) => {
        sent.push(msg);
        const reply = msg && msg.type === 'dev-mode' ? devAnswer : undefined;
        if (typeof cb === 'function') { setTimeout(() => cb(reply), 0); return undefined; }
        return Promise.resolve(reply);
      },
    },
  };
  const ctx = load(CORE, {
    chrome, document: doc, window, setTimeout, clearTimeout,
    setInterval: (fn, ms) => { intervals.push(fn); return intervals.length; }, clearInterval: () => {},
  });
  const attrs = () => [...doc.documentElement._attrs.keys()].filter(k => k.startsWith('data-hm'));
  const tickIntervals = () => { for (const fn of intervals) { try { fn(); } catch (e) { /* ignore */ } } };
  return { ctx, listeners, sent, attrs, tickIntervals, window };
}

for (const answer of [false, undefined]) {
  await t(`content: no page aids when the worker says dev-mode ${J(answer)}`, async () => {
    const c = content(answer);
    await settle();
    c.tickIntervals();
    await settle();
    const msgListeners = c.listeners.filter(l => l.type === 'message');
    return (msgListeners.length === 0 && c.attrs().length === 0) || J({ messageListeners: msgListeners.length, attrs: c.attrs() });
  });
}

await t('content: page aids on when the worker says dev-mode true', async () => {
  const c = content(true);
  await settle();
  c.tickIntervals();
  await settle();
  const ml = c.listeners.filter(l => l.type === 'message');
  if (ml.length !== 1) return 'message listeners: ' + ml.length;
  ml[0].fn({ source: c.window, data: { type: 'human-music:dev-reload' } });
  await settle();
  const reloadAsked = c.sent.some(m => m && m.type === 'dev-reload');
  const hasStatus = c.attrs().some(k => k.startsWith('data-hm-status-'));
  return (reloadAsked && hasStatus) || J({ reloadAsked, attrs: c.attrs() });
});

await t('content: a message from another window never asks for a reload', async () => {
  const c = content(true);
  await settle();
  const ml = c.listeners.filter(l => l.type === 'message');
  if (ml.length !== 1) return 'message listeners: ' + ml.length;
  ml[0].fn({ source: {}, data: { type: 'human-music:dev-reload' } });
  await settle();
  return !c.sent.some(m => m && m.type === 'dev-reload') || 'reload asked from another window';
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
