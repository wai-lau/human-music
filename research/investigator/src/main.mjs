// The service's wiring. createApp(env, deps) builds everything from the environment and listens
// on a unix socket (nginx reaches it there; no TCP port is opened). Tests drive it with fakes.
// Nothing here logs a key, a token or the hash: every log line is scrubbed of the secret values
// before it is written.
import { chmodSync, lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cheapPass as cheapPassImpl } from './cheap.mjs';
import { fetchArt as fetchArtImpl, lookArt as lookArtImpl } from './art.mjs';
import { investigate as investigateImpl } from './claude.mjs';
import { buildList } from './listjson.mjs';
import * as intake from './intake.mjs';
import { createPublisher } from './publish.mjs';
import { createQueue } from './queue.mjs';
import { createServer } from './server.mjs';
import { createShLabs } from './shlabs.mjs';
import { openStore } from './store.mjs';
import { createWorker } from './worker.mjs';

export const DEFAULT_SOCKET = '/run/human-music/investigator.sock';
export const DEFAULT_DATA_DIR = '/var/lib/human-music';
const DEFAULT_CAP = 100;
const PUBLISH_DELAY_MS = 60 * 1000;
const PUBLISH_RETRY_MS = 10 * 60 * 1000;
const SLOW_TICK_MS = 5 * 60 * 1000;

export const dbPath = (dataDir) => join(dataDir, 'investigator.db');

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export function createApp(env, deps = {}) {
  const keyHash = text(env.HM_KEY_HASH);
  if (!keyHash) throw new Error('HM_KEY_HASH is not set: the service will not start without the access key hash (see tools/make-key.mjs)');

  const dataDir = text(env.HM_DATA_DIR) || DEFAULT_DATA_DIR;
  const socketPath = text(env.HM_SOCKET) || DEFAULT_SOCKET;
  const capNum = Number.parseInt(text(env.HM_DAILY_CAP) || '', 10);
  const cap = Number.isInteger(capNum) && capNum > 0 ? capNum : DEFAULT_CAP;
  const keyPath = text(env.HM_PUBLISH_KEY_PATH);

  const secrets = [keyHash, text(env.CLAUDE_CODE_OAUTH_TOKEN), text(env.SHLABS_API_KEY), keyPath].filter(Boolean);
  const rawLog = deps.log || ((...a) => console.log(...a));
  const log = (...a) => {
    let line = a.join(' ');
    for (const s of secrets) line = line.split(s).join('<redacted>');
    rawLog(line);
  };

  const now = deps.now || (() => new Date());
  const timers = deps.timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
  const doFetch = deps.fetch || globalThis.fetch;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  mkdirSync(dataDir, { recursive: true });
  const store = openStore(dbPath(dataDir));
  const queue = createQueue({ store, now, cap });

  const shlabsKey = text(env.SHLABS_API_KEY);
  const shlabs = deps.shlabs !== undefined ? deps.shlabs : (shlabsKey ? createShLabs({ fetch: doFetch, key: shlabsKey, sleep }) : null);
  const cheapPass = deps.cheapPass || ((artist) => cheapPassImpl(artist, { fetch: doFetch, sleep, now: () => Date.now() }));
  const investigate = deps.investigate || ((artist, evidence) => investigateImpl(artist, evidence, { env }));
  const fetchArt = deps.fetchArt || ((url) => fetchArtImpl(url, { fetch: doFetch }));
  const lookArt = deps.lookArt || ((image) => lookArtImpl(image, { env }));

  let publisher = deps.publisher !== undefined ? deps.publisher : null;
  const remote = text(env.HM_PUBLISH_REMOTE);
  if (publisher === null && remote && keyPath) {
    publisher = createPublisher({ repoDir: join(dataDir, 'verdicts-repo'), remote, sshKeyPath: keyPath });
  }

  // --- publishing: once per 60 s at most; a failed push retries every 10 minutes ---
  let pubTimer = null;
  let retryTimer = null;

  async function doPublish() {
    pubTimer = null;
    retryTimer = null;
    if (!publisher) return;
    let r;
    try {
      const list = buildList(store.listPublishable(), {
        now: now(),
        calibrated: store.getState('calibrated') === true,
        mapping: store.getState('calibration.mapping'),
      });
      r = await publisher.publish(list);
    } catch (e) {
      r = { ok: false, error: (e && e.message) || 'publisher failed' };
    }
    if (r && r.ok) {
      try { store.setState('publish.stale', null); } catch { /* the next publish clears it */ }
      log(`publish: ${r.changed ? 'pushed' : 'no change'}`);
    } else {
      log(`publish failed, retrying in 10 minutes: ${String((r && r.error) || 'unknown').slice(0, 200)}`);
      if (!pubTimer) retryTimer = timers.setTimeout(doPublish, PUBLISH_RETRY_MS);
    }
  }

  function schedulePublish() {
    if (!publisher || pubTimer || retryTimer) return;
    pubTimer = timers.setTimeout(doPublish, PUBLISH_DELAY_MS);
  }

  // --- the worker: one artist at a time ---
  let current = null;
  let chainTimer = null;
  let slowTimer = null;
  let closed = false;

  // A fresh worker per step, so a calibration the owner accepts takes effect without a restart.
  const buildWorker = () => createWorker({
    store, queue, cheapPass, investigate, shlabs, fetchArt, lookArt, schedulePublish, now,
    mapping: store.getState('calibration.mapping'),
  });

  function kick() {
    if (current) return current;
    current = (async () => {
      let result = 'idle';
      try { result = await buildWorker().runOne(); } catch (e) { log(`worker error: ${(e && e.message) || e}`); }
      return result;
    })().then((result) => {
      current = null;
      if (result !== 'idle') log(`step: ${result}`);
      if (result === 'done' && !closed && !chainTimer) {
        chainTimer = timers.setTimeout(() => { chainTimer = null; kick(); }, 0);
      }
      return result;
    });
    return current;
  }

  function slowTick() {
    slowTimer = timers.setTimeout(slowTick, SLOW_TICK_MS);
    try { if (store.getState('publish.stale')) schedulePublish(); } catch { /* try again next tick */ }
    kick();
  }

  // --- the HTTP side, on a unix socket ---
  const server = createServer({
    keyHash, queue, store, intake, allowedOrigin: text(env.HM_ALLOWED_ORIGIN) || null, kick: () => { kick(); },
  });

  function removeStaleSocket() {
    let st;
    try { st = lstatSync(socketPath); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (!st.isSocket()) throw new Error(`${socketPath} exists and is not a socket; refusing to remove it`);
    unlinkSync(socketPath);
  }

  let listening = false;
  async function listen() {
    removeStaleSocket();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => { server.off('error', reject); resolve(); });
    });
    listening = true;
    chmodSync(socketPath, 0o660);
    log(`listening on ${socketPath}`);
    slowTimer = timers.setTimeout(slowTick, SLOW_TICK_MS);
    try { if (store.listPublishable().length > 0) schedulePublish(); } catch { /* publish after the next verdict */ }
    kick(); // pick up whatever the last run left in the queue
  }

  async function close() {
    closed = true;
    for (const t of [pubTimer, retryTimer, chainTimer, slowTimer]) if (t) timers.clearTimeout(t);
    pubTimer = retryTimer = chainTimer = slowTimer = null;
    if (current) { try { await current; } catch { /* already logged */ } }
    if (listening) {
      listening = false;
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r()));
      try { unlinkSync(socketPath); } catch { /* node removed it */ }
    }
    try { store.close(); } catch { /* already closed */ }
  }

  return {
    server, store, queue, socketPath, cap,
    listen, close, kick, schedulePublish,
    idle: async () => { if (current) await current; },
    setPublisher(p) { publisher = p; },
  };
}

async function main() {
  let app;
  try {
    app = createApp(process.env);
    await app.listen();
  } catch (e) {
    console.error(`human-music-investigator: ${(e && e.message) || e}`);
    process.exit(1);
  }
  const stop = () => { app.close().finally(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
