// SQLite store (node:sqlite, no flag needed from Node 22.13). Verdicts, artist keys, SH Labs
// scores, the daily counter and small state values. The queue (queue.mjs) adds its own
// tables through store.db.
//
// Bound values are strings, integers and null only: older Node 22 builds refuse
// undefined and booleans as parameters.
import { DatabaseSync } from 'node:sqlite';
import { artistKeys } from './names.mjs';

const VERDICTS = new Set(['ai', 'human', 'unsure']);
const SOURCES = new Set(['live', 'calibration']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  raw_confidence INTEGER NOT NULL,
  signals TEXT NOT NULL,
  reasons TEXT NOT NULL,
  sources TEXT NOT NULL,
  model TEXT NOT NULL,
  checked TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artist_keys (
  key TEXT PRIMARY KEY,
  artist_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS artist_keys_artist ON artist_keys (artist_id);
CREATE TABLE IF NOT EXISTS scores (
  artist_id INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  probability REAL NOT NULL,
  label TEXT,
  generator TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (artist_id, track_id)
);
CREATE TABLE IF NOT EXISTS counters (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function checkVerdict(v) {
  if (!v || typeof v !== 'object') throw new TypeError('verdict must be an object');
  if (!VERDICTS.has(v.verdict)) throw new TypeError('verdict word must be ai, human or unsure');
  for (const f of ['confidence', 'rawConfidence']) {
    if (!Number.isInteger(v[f]) || v[f] < 0 || v[f] > 100) throw new TypeError(f + ' must be an integer 0-100');
  }
  if (!SOURCES.has(v.source)) throw new TypeError('source must be live or calibration');
  if (typeof v.checked !== 'string' || !DAY.test(v.checked)) throw new TypeError('checked must be YYYY-MM-DD');
  if (typeof v.model !== 'string') throw new TypeError('model must be a string');
}

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);

  const q = {
    keyOwner: db.prepare('SELECT artist_id FROM artist_keys WHERE key = ?'),
    insertArtist: db.prepare(`INSERT INTO artists
      (name, verdict, confidence, raw_confidence, signals, reasons, sources, model, checked, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateArtist: db.prepare(`UPDATE artists SET name = ?, verdict = ?, confidence = ?, raw_confidence = ?,
      signals = ?, reasons = ?, sources = ?, model = ?, checked = ?, source = ? WHERE id = ?`),
    setKey: db.prepare('INSERT OR REPLACE INTO artist_keys (key, artist_id) VALUES (?, ?)'),
    moveKeys: db.prepare('UPDATE artist_keys SET artist_id = ? WHERE artist_id = ?'),
    moveScores: db.prepare('UPDATE OR IGNORE scores SET artist_id = ? WHERE artist_id = ?'),
    dropScores: db.prepare('DELETE FROM scores WHERE artist_id = ?'),
    dropArtist: db.prepare('DELETE FROM artists WHERE id = ?'),
    getArtist: db.prepare('SELECT * FROM artists WHERE id = ?'),
    keysOf: db.prepare('SELECT key FROM artist_keys WHERE artist_id = ?'),
    publishable: db.prepare("SELECT * FROM artists WHERE source = 'live' ORDER BY id"),
    putScore: db.prepare(`INSERT OR REPLACE INTO scores (artist_id, track_id, probability, label, generator, at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    getScores: db.prepare('SELECT track_id, probability, label, generator, at FROM scores WHERE artist_id = ? ORDER BY rowid'),
    getCount: db.prepare('SELECT n FROM counters WHERE day = ?'),
    bumpCount: db.prepare('INSERT INTO counters (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1'),
    getState: db.prepare('SELECT value FROM state WHERE key = ?'),
    setState: db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)'),
  };

  function toVerdict(row) {
    const out = {
      id: row.id,
      name: row.name,
      verdict: row.verdict,
      confidence: row.confidence,
      rawConfidence: row.raw_confidence,
      signals: JSON.parse(row.signals),
      reasons: JSON.parse(row.reasons),
      sources: JSON.parse(row.sources),
      model: row.model,
      checked: row.checked,
      source: row.source,
    };
    for (const { key } of q.keysOf.all(row.id)) {
      if (key.startsWith('sp:')) out.spotifyId = key.slice(3);
      else if (key.startsWith('yt:')) out.channelId = key.slice(3);
    }
    return out;
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }

  function ownerOf(keys) {
    const ids = new Set();
    for (const k of keys) {
      const row = q.keyOwner.get(k);
      if (row) ids.add(row.artist_id);
    }
    return [...ids].sort((a, b) => a - b);
  }

  return {
    db,
    close() { db.close(); },

    putVerdict(v) {
      checkVerdict(v);
      const keys = artistKeys(v);
      const vals = [
        v.name, v.verdict, v.confidence, v.rawConfidence,
        JSON.stringify(v.signals || []), JSON.stringify(v.reasons || []), JSON.stringify(v.sources || []),
        v.model, v.checked, v.source,
      ];
      return transaction(() => {
        const owners = ownerOf(keys);
        let id;
        if (owners.length === 0) {
          id = Number(q.insertArtist.run(...vals).lastInsertRowid);
        } else {
          id = owners[0];
          for (const other of owners.slice(1)) {
            q.moveKeys.run(id, other);
            q.moveScores.run(id, other);
            q.dropScores.run(other);
            q.dropArtist.run(other);
          }
          q.updateArtist.run(...vals, id);
        }
        for (const k of keys) q.setKey.run(k, id);
        return id;
      });
    },

    findVerdict(keys) {
      const owners = ownerOf(keys);
      if (owners.length === 0) return null;
      return toVerdict(q.getArtist.get(owners[0]));
    },

    listPublishable() {
      return q.publishable.all().map(toVerdict);
    },

    putScores(artistId, scores) {
      transaction(() => {
        for (const s of scores) {
          q.putScore.run(artistId, String(s.trackId), s.probability, s.label ?? null, s.generator ?? null, s.at);
        }
      });
    },

    getScores(artistId) {
      return q.getScores.all(artistId).map(r => ({
        trackId: r.track_id, probability: r.probability, label: r.label, generator: r.generator, at: r.at,
      }));
    },

    count(day) {
      const r = q.getCount.get(day);
      return r ? r.n : 0;
    },

    bump(day) {
      return transaction(() => {
        q.bumpCount.run(day);
        return q.getCount.get(day).n;
      });
    },

    getState(key) {
      const r = q.getState.get(key);
      return r ? JSON.parse(r.value) : null;
    },

    setState(key, value) {
      q.setState.run(key, JSON.stringify(value === undefined ? null : value));
    },

    transaction,
  };
}
