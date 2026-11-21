// The service's wiring. createApp(env, deps) builds everything from the environment and listens
// on a unix socket (nginx reaches it there; no TCP port is opened). Tests drive it with fakes.
// Nothing here logs a key, a token or the hash: every log line is scrubbed of the secret values
// before it is written.
import { chmodSync, lstatSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAiLists } from './ailists.mjs';
import { cheapPass as cheapPassImpl } from './cheap.mjs';
import { fetchArt as fetchArtImpl, lookArt as lookArtImpl } from './art.mjs';
import { investigate as investigateImpl } from './claude.mjs';
import { buildList } from './listjson.mjs';
import * as intake from './intake.mjs';
import { createPublisher } from './publish.mjs';
import { createQueue } from './queue.mjs';
import { createServer } from './server.mjs';
import { createShLabs } from './shlabs.mjs';
import { createIsrcLinker } from './isrclink.mjs';
import { openStore } from './store.mjs';
import { createWorker } from './worker.mjs';

export const DEFAULT_SOCKET = '/run/human-music/investigator.sock';
export const DEFAULT_DATA_DIR = '/var/lib/human-music';
const DEFAULT_CAP = 100;
const PUBLISH_DELAY_MS = 24 * 60 * 60 * 1000;
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
  const recheckDaysNum = Number.parseInt(text(env.HM_RECHECK_DAYS) || '', 10);
  const recheckDays = Number.isInteger(recheckDaysNum) && recheckDaysNum > 0 ? recheckDaysNum : 30;
  const shlabsCapNum = Number.parseInt(text(env.HM_SHLABS_DAILY_CAP) || '', 10);
  const shlabsDailyCap = Number.isInteger(shlabsCapNum) && shlabsCapNum > 0 ? shlabsCapNum : 190;
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
  const queue = createQueue({ store, now, cap, recheckDays });

  const shlabsKey = text(env.SHLABS_API_KEY);
  const shlabs = deps.shlabs !== undefined ? deps.shlabs : (shlabsKey ? createShLabs({ fetch: doFetch, key: shlabsKey, sleep }) : null);
  const isrcLinker = deps.isrcLinker !== undefined ? deps.isrcLinker : createIsrcLinker({ fetch: doFetch });
  const aiLists = deps.aiLists !== undefined ? deps.aiLists : createAiLists({ fetch: doFetch, now: () => Date.now() });
  const fetchPage = deps.fetchPage || ((url) =>
    doFetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20000) }).then(async (res) => {
      if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
      return res.text();
    })
  );
  const cheapPass = deps.cheapPass || ((artist) => cheapPassImpl(artist, { fetch: doFetch, sleep, now: () => Date.now() }));
  const investigate = deps.investigate || ((artist, evidence, o = {}) => investigateImpl(artist, evidence, { env, ...o }));
  const fetchArt = deps.fetchArt || ((url) => fetchArtImpl(url, { fetch: doFetch }));
  const lookArt = deps.lookArt || ((image) => lookArtImpl(image, { env }));

  let publisher = deps.publisher !== undefined ? deps.publisher : null;
  const remote = text(env.HM_PUBLISH_REMOTE);
  if (publisher === null && remote && keyPath) {
    publisher = createPublisher({ repoDir: join(dataDir, 'verdicts-repo'), remote, sshKeyPath: keyPath });
  }

  // --- publishing: once a day (Wai, 2026-11-17); a failed push retries every 10 minutes. The due
  // time is stored, so a restart doesn't push it back a day (review 2026-11-17). ---
  let pubTimer = null;
  let pubTimerDueAt = null;
  let retryTimer = null;

  async function doPublish() {
    pubTimer = null;
    pubTimerDueAt = null;
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
      try {
        store.setState('publish.dueAt', null);
        store.setState('publish.lastAt', now().toISOString());
      } catch { /* the next schedule starts a fresh day */ }
      log(`publish: ${r.changed ? 'pushed' : 'no change'}`);
    } else {
      log(`publish failed, retrying in 10 minutes: ${String((r && r.error) || 'unknown').slice(0, 200)}`);
      if (!pubTimer) retryTimer = timers.setTimeout(doPublish, PUBLISH_RETRY_MS);
    }
  }

  // Calculate what the publish should be due at (in ms since epoch), from the store.
  function calcPublishDue() {
    const t = now().getTime();
    let due = NaN;
    try {
      due = Date.parse(store.getState('publish.dueAt') || '');
      if (!Number.isFinite(due)) {
        const last = Date.parse(store.getState('publish.lastAt') || '');
        due = Number.isFinite(last) ? Math.max(t, last + PUBLISH_DELAY_MS) : t + PUBLISH_DELAY_MS;
      }
    } catch { /* without the store, a day from now */ }
    if (!Number.isFinite(due)) return t + PUBLISH_DELAY_MS;
    // Never more than a day away, even if the clock moved back since the due time was stored.
    return Math.min(t + PUBLISH_DELAY_MS, Math.max(t, due));
  }

  function schedulePublish() {
    if (!publisher || pubTimer || retryTimer) return pubTimerDueAt;
    const t = now().getTime();
    const due = calcPublishDue();
    try {
      if (!store.getState('publish.dueAt') && Number.isFinite(due)) {
        store.setState('publish.dueAt', new Date(due).toISOString());
      }
    } catch { /* no store */ }
    const wait = Math.max(0, due - t);
    pubTimer = timers.setTimeout(doPublish, wait);
    pubTimerDueAt = due;
    return pubTimerDueAt;
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
    // Evidence scoring is the default (Wai, 2026-11-18: the research weights approved);
    // HM_SCORING=off goes back to Claude's own number.
    scoring: text(env.HM_SCORING) !== 'off',
    aiLists,
    fetchPage,
    shlabsDailyCap,
    isrcLinker,
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
      if ((result === 'done' || result === 'retry') && !closed && !chainTimer) {
        chainTimer = timers.setTimeout(() => { chainTimer = null; kick(); }, 0);
      }
      return result;
    });
    return current;
  }

  function slowTick() {
    slowTimer = timers.setTimeout(slowTick, SLOW_TICK_MS);
    try {
      if (store.getState('publish.stale')) {
        const storedDue = calcPublishDue();
        // Only replace the timer if the stored due time is earlier.
        if (!pubTimer || storedDue < pubTimerDueAt) {
          if (pubTimer) timers.clearTimeout(pubTimer);
          pubTimer = null;
          schedulePublish();
        }
      }
    } catch { /* try again next tick */ }
    try { if (queue.resumeIfDue()) log('queue: usage-limit pause lifted after an hour'); } catch { /* next tick */ }
    try {
      // Recheck due passes only when the live queue is empty.
      if (queue.status().queued === 0) {
        const day = now().toISOString().slice(0, 10);
        const remaining = cap - queue.status().today;
        if (remaining > 0) {
          const due = store.listDuePasses(day, remaining, recheckDays);
          if (due.length > 0) {
            const items = due.map((v) => {
              const item = { name: v.name, site: 'recheck', songs: [], playing: false };
              if (v.spotifyId) item.spotifyId = v.spotifyId;
              if (v.channelId) item.channelId = v.channelId;
              return item;
            });
            const result = queue.enqueue(items);
            if (result.queued > 0) {
              log(`recheck: queued ${result.queued} due pass(es)`);
            }
          }
        }
      }
    } catch { /* next tick */ }
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
