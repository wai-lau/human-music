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
      front INTEGER NOT NULL DEFAULT 0
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

  const q = {
    insert: db.prepare('INSERT INTO queue (artist, playing, front) VALUES (?, ?, ?)'),
    setKey: db.prepare('INSERT OR REPLACE INTO queue_keys (key, queue_id) VALUES (?, ?)'),
    hasKey: db.prepare('SELECT 1 AS x FROM queue_keys WHERE key = ?'),
    top: db.prepare('SELECT id, artist FROM queue ORDER BY front DESC, playing DESC, id ASC LIMIT 1'),
    drop: db.prepare('DELETE FROM queue WHERE id = ?'),
    dropKeys: db.prepare('DELETE FROM queue_keys WHERE queue_id = ?'),
    size: db.prepare('SELECT COUNT(*) AS n FROM queue'),
    maxFront: db.prepare('SELECT COALESCE(MAX(front), 0) AS m FROM queue'),
    seen: db.prepare('SELECT 1 AS x FROM enqueued_days WHERE key = ? AND day = ?'),
    markSeen: db.prepare('INSERT OR IGNORE INTO enqueued_days (key, day) VALUES (?, ?)'),
    oldDays: db.prepare('DELETE FROM enqueued_days WHERE day < ?'),
  };

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
        const row = q.top.get();
        if (!row) return null;
        q.dropKeys.run(row.id);
        q.drop.run(row.id);
        return JSON.parse(row.artist);
      });
    },

    requeue(artist) {
      store.transaction(() => {
        insert(artist, artistKeys(artist), q.maxFront.get().m + 1);
      });
    },

    pause(reason) {
      store.setState('queue.paused', String(reason));
      store.setState('queue.lastError', String(reason));
    },

    resume() {
      store.setState('queue.paused', null);
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
