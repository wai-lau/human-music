// The public HTTP layer. Every route except a CORS preflight needs the key, checked first,
// before any body is read. Nothing here logs a key, a header or a body.
import http from 'node:http';
import { checkBearer } from './keys.mjs';

const MAX_BODY = 65536;
const KEY_SHAPE = /^(sp|yt|nm):.{1,300}$/s;
const FINGERPRINT_LABELS = new Set(['ai', 'played']);

export function createServer({ keyHash, queue, store, intake, allowedOrigin, kick, now = () => new Date() }) {
  function send(res, status, obj, cors) {
    const payload = JSON.stringify(obj);
    res.writeHead(status, {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  }

  // Reads at most MAX_BODY bytes. Past that it stops reading: resolves null.
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let over = false;
      req.on('data', (c) => {
        if (over) return;
        total += c.length;
        if (total > MAX_BODY) { over = true; chunks.length = 0; req.pause(); resolve(null); return; }
        chunks.push(c);
      });
      req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
      req.on('error', reject);
      req.on('aborted', () => { if (!over) reject(new Error('aborted')); });
    });
  }

  function tooLarge(req, res, cors) {
    const payload = JSON.stringify({ error: 'body too large' });
    res.writeHead(413, {
      ...cors, 'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload), Connection: 'close',
    });
    res.end(payload, () => req.socket.destroy());
  }

  function recheckArtist(key) {
    const v = store.findVerdict([key]);
    if (!v) return null;
    const artist = { name: v.name, site: '', songs: [], playing: false };
    if (v.spotifyId) artist.spotifyId = v.spotifyId;
    if (v.channelId) artist.channelId = v.channelId;
    return artist;
  }

  async function handle(req, res, cors) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'POST' && path === '/api/investigate') {
      if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge(req, res, cors);
      const text = await readBody(req);
      if (text === null) return tooLarge(req, res, cors);
      const parsed = intake.parseRequest(text);
      if (!parsed.ok) return send(res, parsed.status, { error: parsed.reason }, cors);
      const counts = queue.enqueue(parsed.artists);
      if (counts.queued > 0) kick();
      return send(res, 202, counts, cors);
    }

    if (req.method === 'POST' && path === '/api/fingerprint') {
      if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge(req, res, cors);
      const text = await readBody(req);
      if (text === null) return tooLarge(req, res, cors);
      let data;
      try { data = JSON.parse(text); } catch { return send(res, 400, { error: 'not JSON' }, cors); }
      if (!data || typeof data !== 'object') return send(res, 400, { error: 'body must be an object' }, cors);

      const { title, artistLine, label, seconds, print } = data;

      // Validate title
      if (typeof title !== 'string' || title.length < 1 || title.length > 300) {
        return send(res, 400, { error: 'title must be a string 1-300 chars' }, cors);
      }

      // Validate artistLine
      if (typeof artistLine !== 'string' || artistLine.length < 1 || artistLine.length > 300) {
        return send(res, 400, { error: 'artistLine must be a string 1-300 chars' }, cors);
      }

      // Validate label
      if (!FINGERPRINT_LABELS.has(label)) {
        return send(res, 400, { error: 'label must be ai or played' }, cors);
      }

      // Validate seconds
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 5 || seconds > 60) {
        return send(res, 400, { error: 'seconds must be a number 5-60' }, cors);
      }

      // Validate print
      if (!Array.isArray(print) || print.length !== 510) {
        return send(res, 400, { error: 'print must be an array of exactly 510 numbers' }, cors);
      }
      for (const n of print) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) {
          return send(res, 400, { error: 'print must be 510 numbers each 0-1' }, cors);
        }
      }

      // Check daily limit
      const dayPrefix = now().toISOString().slice(0, 10);
      const count = store.countPlayerPrints(dayPrefix);
      if (count >= 500) {
        return send(res, 429, { error: 'daily fingerprint limit reached' }, cors);
      }

      // Store
      store.putPlayerPrint({
        at: now().toISOString(),
        title,
        artistLine,
        label,
        seconds,
        print,
      });

      return send(res, 202, { stored: 1 }, cors);
    }

    if (req.method === 'GET' && path === '/api/status') {
      return send(res, 200, queue.status(), cors);
    }

    if (req.method === 'POST' && path === '/api/recheck') {
      if (Number(req.headers['content-length']) > MAX_BODY) return tooLarge(req, res, cors);
      const text = await readBody(req);
      if (text === null) return tooLarge(req, res, cors);
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      const key = data && typeof data === 'object' ? data.key : undefined;
      if (typeof key !== 'string' || !KEY_SHAPE.test(key)) return send(res, 400, { error: 'body must be { key }' }, cors);
      const artist = recheckArtist(key);
      if (!artist) return send(res, 404, { error: 'no such artist' }, cors);
      queue.requeue(artist);
      kick();
      return send(res, 202, { queued: 1 }, cors);
    }

    if (req.method === 'GET' && path.startsWith('/verdicts/')) {
      let key;
      try { key = decodeURIComponent(path.slice('/verdicts/'.length)); } catch { key = ''; }
      if (!KEY_SHAPE.test(key)) return send(res, 404, { error: 'not found' }, cors);
      const v = store.findVerdict([key]);
      if (!v) return send(res, 404, { error: 'not found' }, cors);
      return send(res, 200, { ...v, scores: store.getScores(v.id) }, cors);
    }

    return send(res, 404, { error: 'not found' }, cors);
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const cors = origin !== undefined && origin === allowedOrigin
      ? { 'Access-Control-Allow-Origin': allowedOrigin, Vary: 'Origin' }
      : {};

    if (req.method === 'OPTIONS') {
      if (Object.keys(cors).length) {
        cors['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        cors['Access-Control-Allow-Methods'] = 'POST, GET';
        cors['Access-Control-Max-Age'] = '600';
      }
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // One check, one fixed answer, before anything else is read or routed.
    if (!checkBearer(req.headers.authorization, keyHash)) {
      send(res, 401, { error: 'unauthorized' }, cors);
      return;
    }

    handle(req, res, cors).catch(() => {
      if (!res.headersSent) send(res, 500, { error: 'server error' }, cors);
      else res.destroy();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
