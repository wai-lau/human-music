// The investigation queue: priority, daily cap, one a day per artist, pause. All state is in
// the store's database, so a restart loses nothing (and keeps the once-a-day record).
import { artistKeys } from './names.mjs';

const REQUEUE_AFTER_DAYS = 30;
const DAY_MS = 86400000;

export function createQueue({ store, now, cap }) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      playing INTEGER NOT NULL,
      front INTEGER NOT NULL DEFAULT 0,
      in_progress INTEGER NOT NULL DEFAULT 0,
      tries INTEGER NOT NULL DEFAULT 0,
      not_before INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS queue_keys (
      key TEXT PRIMARY KEY,
      queue_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enqueued_days (
      key TEXT NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (key, day)
    );
  `);

  // Databases made before retries (review 2026-11-17) get the two columns.
  const cols = new Set(db.prepare('PRAGMA table_info(queue)').all().map((c) => c.name));
  if (!cols.has('tries')) db.exec('ALTER TABLE queue ADD COLUMN tries INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('not_before')) db.exec('ALTER TABLE queue ADD COLUMN not_before INTEGER NOT NULL DEFAULT 0');

  const q = {
    insert: db.prepare('INSERT INTO queue (artist, playing, front) VALUES (?, ?, ?)'),
    setKey: db.prepare('INSERT OR REPLACE INTO queue_keys (key, queue_id) VALUES (?, ?)'),
    hasKey: db.prepare('SELECT 1 AS x FROM queue_keys WHERE key = ?'),
    top: db.prepare('SELECT id, artist FROM queue WHERE in_progress = 0 AND not_before <= ? ORDER BY front DESC, playing DESC, id ASC LIMIT 1'),
    triesOf: db.prepare('SELECT tries FROM queue WHERE id = ?'),
    later: db.prepare('UPDATE queue SET in_progress = 0, tries = tries + 1, not_before = ?, front = (SELECT COALESCE(MIN(front), 0) FROM queue) - 1 WHERE id = ?'),
    drop: db.prepare('DELETE FROM queue WHERE id = ?'),
    dropKeys: db.prepare('DELETE FROM queue_keys WHERE queue_id = ?'),
    size: db.prepare('SELECT COUNT(*) AS n FROM queue WHERE in_progress = 0'),
    take: db.prepare('UPDATE queue SET in_progress = 1 WHERE id = ?'),
    owner: db.prepare('SELECT queue_id FROM queue_keys WHERE key = ?'),
    isTaken: db.prepare('SELECT in_progress FROM queue WHERE id = ?'),
    release: db.prepare('UPDATE queue SET in_progress = 0, front = ? WHERE id = ?'),
    orphans: db.prepare('SELECT id FROM queue WHERE in_progress = 1 ORDER BY id DESC'),
    maxFront: db.prepare('SELECT COALESCE(MAX(front), 0) AS m FROM queue'),
    seen: db.prepare('SELECT 1 AS x FROM enqueued_days WHERE key = ? AND day = ?'),
    markSeen: db.prepare('INSERT OR IGNORE INTO enqueued_days (key, day) VALUES (?, ?)'),
    oldDays: db.prepare('DELETE FROM enqueued_days WHERE day < ?'),
  };

  // A process that died mid-run left in-progress rows: they go back to the front.
  for (const { id } of q.orphans.all()) q.release.run(q.maxFront.get().m + 1, id);

  const today = () => now().toISOString().slice(0, 10);

  function insert(artist, keys, front) {
    const id = Number(q.insert.run(JSON.stringify(artist), artist.playing ? 1 : 0, front).lastInsertRowid);
    for (const k of keys) q.setKey.run(k, id);
  }

  // 'known' when a verdict stands; an unsure one at least 30 days old is due again.
  function isKnown(keys) {
    const v = store.findVerdict(keys);
    if (!v) return false;
    if (v.verdict !== 'unsure') return true;
    const age = (now().getTime() - Date.parse(v.checked + 'T00:00:00Z')) / DAY_MS;
    return !(age >= REQUEUE_AFTER_DAYS);
  }

  return {
    enqueue(artists) {
      const day = today();
      let queued = 0, known = 0, again = 0;
      store.transaction(() => {
        q.oldDays.run(day);
        for (const a of artists) {
          const keys = artistKeys(a);
          if (isKnown(keys)) { known++; continue; }
          if (keys.some(k => q.hasKey.get(k)) || keys.some(k => q.seen.get(k, day))) { again++; continue; }
          insert(a, keys, 0);
          for (const k of keys) q.markSeen.run(k, day);
          queued++;
        }
      });
      return { queued, known, again };
    },

    next() {
      if (store.getState('queue.paused') !== null) return null;
      if (store.count(today()) >= cap) return null;
      return store.transaction(() => {
        const row = q.top.get(now().getTime());
        if (!row) return null;
        q.take.run(row.id);
        return JSON.parse(row.artist);
      });
    },

    requeue(artist) {
      store.transaction(() => {
        const keys = artistKeys(artist);
        const front = q.maxFront.get().m + 1;
        for (const k of keys) {
          const row = q.owner.get(k);
          if (row && q.isTaken.get(row.queue_id)) { q.release.run(front, row.queue_id); return; }
        }
        insert(artist, keys, front);
      });
    },

    // A temporary failure (a timeout, a crash): the artist goes to the back and waits
    // waitMs, at most `max` times; then it is dropped like any failure. Returns whether it stays.
    retryLater(artist, { waitMs = 15 * 60000, max = 2 } = {}) {
      return store.transaction(() => {
        for (const k of artistKeys(artist)) {
          const row = q.owner.get(k);
          if (!row || !q.isTaken.get(row.queue_id)) continue;
          const t = q.triesOf.get(row.queue_id);
          if (!t || t.tries >= max) return false;
          q.later.run(now().getTime() + waitMs, row.queue_id);
          return true;
        }
        return false;
      });
    },

    // The verdict is stored: forget the artist. `key` is any of its artist keys (or the artist).
    done(key) {
      const k = typeof key === 'string' ? key : artistKeys(key)[0];
      store.transaction(() => {
        const row = q.owner.get(k);
        if (!row) return;
        q.dropKeys.run(row.queue_id);
        q.drop.run(row.queue_id);
      });
    },

    pause(reason) {
      store.setState('queue.paused', String(reason));
      store.setState('queue.pausedAt', now().toISOString());
      store.setState('queue.lastError', String(reason));
    },

    resume() {
      store.setState('queue.paused', null);
      store.setState('queue.pausedAt', null);
    },

    // A usage-limit pause lifts itself an hour after it began (the next run tells whether the
    // limit has passed); a login pause waits for Wai's `resume` (review 2026-11-17).
    resumeIfDue() {
      const reason = store.getState('queue.paused');
      if (typeof reason !== 'string' || !reason.startsWith('limit')) return false;
      const at = Date.parse(store.getState('queue.pausedAt') || '');
      if (Number.isFinite(at) && now().getTime() - at < 3600000) return false;
      this.resume();
      return true;
    },

    status() {
      return {
        queued: q.size.get().n,
        today: store.count(today()),
        cap,
        paused: store.getState('queue.paused'),
        lastError: store.getState('queue.lastError'),
      };
    },
  };
}
