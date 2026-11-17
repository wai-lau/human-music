import { EventEmitter } from 'node:events';
import { run } from './harness.mjs';
import { ART_HOSTS, ART_SCHEMA, ART_PROMPT, buildArtArgv, fetchArt, lookArt } from '../src/art.mjs';

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(20, 3)]);
const GOOD = 'https://i.scdn.co/image/abc';

// A fake fetch: records calls, answers with a streamed body.
function fakeFetch(body, { status = 200, type = 'image/jpeg', chunk = 1000 } = {}) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    let sent = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (sent >= body.length) return c.close();
        c.enqueue(new Uint8Array(body.subarray(sent, sent + chunk)));
        sent += chunk;
      },
    });
    return { status, ok: status >= 200 && status < 300, headers: new Headers({ 'content-type': type }), body: stream };
  };
  f.calls = calls;
  return f;
}

function fakeSpawn(out, { code = 0, hang = false } = {}) {
  const calls = [];
  const spawn = (file, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.written = '';
    child.ended = false;
    child.stdin = { write: (s) => { child.written += s; return true; }, end: (s) => { if (s) child.written += s; child.ended = true; }, on() {} };
    child.kill = () => { child.emit('close', null); };
    calls.push({ file, argv, opts, child });
    if (!hang) {
      setImmediate(() => {
        const text = typeof out === 'string' ? out : JSON.stringify({ type: 'result', is_error: false, ...out });
        if (text) child.stdout.emit('data', Buffer.from(text));
        child.emit('close', code);
      });
    }
    return child;
  };
  spawn.calls = calls;
  return spawn;
}
const env = { PATH: '/bin', HOME: '/h', CLAUDE_CODE_OAUTH_TOKEN: 'tok', HM_KEY_HASH: 'x', SHLABS_API_KEY: 'y' };
const image = { ok: true, mediaType: 'image/png', base64: PNG.toString('base64') };
const look = (out, o = {}) => lookArt(image, { spawn: fakeSpawn(out), env, ...o });

run([
  ['ART_HOSTS is exactly the seven allowed hosts', () => deepEqual([...ART_HOSTS], ['lh3.googleusercontent.com', 'yt3.ggpht.com', 'i.ytimg.com', 'i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com'])],
  ['hosts outside the list, http, IP literals, ports and credentials fail with no fetch', async () => {
    const bad = ['https://lh3.googleusercontent.com.evil.test/a', 'https://evil.test/i.scdn.co', 'http://i.scdn.co/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://i.scdn.co:8443/a', 'https://u:p@i.scdn.co/a', 'ftp://i.scdn.co/a', 'not a url', '', undefined, 'https://sub.i.scdn.co/a'];
    for (const u of bad) {
      const f = fakeFetch(PNG);
      const r = await fetchArt(u, { fetch: f });
      if (r.ok !== false || f.calls.length) return `accepted ${u}`;
    }
    return true;
  }],
  ['every allowed host is fetched, with redirect: error', async () => {
    for (const h of ART_HOSTS) {
      const f = fakeFetch(PNG);
      const r = await fetchArt(`https://${h}/x`, { fetch: f });
      if (!r.ok || f.calls[0].opts.redirect !== 'error') return `failed ${h}`;
    }
    return true;
  }],
  ['a redirect status, a thrown redirect error, and a 404 all give ok: false', async () => {
    const a = await fetchArt(GOOD, { fetch: fakeFetch(PNG, { status: 302 }) });
    const b = await fetchArt(GOOD, { fetch: async () => { throw new TypeError('redirect'); } });
    const c = await fetchArt(GOOD, { fetch: fakeFetch(PNG, { status: 404 }) });
    return (a.ok === false && b.ok === false && c.ok === false) || 'not all false';
  }],
  ['1 MB passes, 1 MB + 1 byte fails, and an endless stream is cut off early', async () => {
    const at = Buffer.concat([PNG, Buffer.alloc(1048576 - PNG.length)]);
    const over = Buffer.concat([at, Buffer.alloc(1)]);
    const ok = await fetchArt(GOOD, { fetch: fakeFetch(at, { chunk: 65536 }) });
    let pulled = 0;
    const endless = async () => ({ status: 200, ok: true, headers: new Headers(), body: new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(65536)); } }) });
    const r1 = await fetchArt(GOOD, { fetch: fakeFetch(over, { chunk: 65536 }) });
    const r2 = await fetchArt(GOOD, { fetch: endless });
    return (ok.ok === true && r1.ok === false && r2.ok === false && pulled < 40) || JSON.stringify({ a: ok.ok, r1, r2, pulled });
  }],
  ['a PNG served as text/html is image/png; JPEG and WebP by signature too', async () => {
    const a = await fetchArt(GOOD, { fetch: fakeFetch(PNG, { type: 'text/html' }) });
    const b = await fetchArt(GOOD, { fetch: fakeFetch(JPG, { type: 'text/html' }) });
    const c = await fetchArt(GOOD, { fetch: fakeFetch(WEBP, { type: 'application/json' }) });
    return (a.mediaType === 'image/png' && a.base64 === PNG.toString('base64') && b.mediaType === 'image/jpeg' && c.mediaType === 'image/webp') || JSON.stringify([a.mediaType, b.mediaType, c.mediaType]);
  }],
  ['an HTML body served as image/jpeg is ok: false; so are empty, tiny and RIFF-not-WEBP', async () => {
    const bodies = [Buffer.from('<html><script>alert(1)</script></html>'), Buffer.alloc(0), Buffer.from([0xff, 0xd8]), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)])];
    for (const body of bodies) {
      const r = await fetchArt(GOOD, { fetch: fakeFetch(body, { type: 'image/jpeg' }) });
      if (r.ok !== false) return 'accepted a non-image';
    }
    return true;
  }],
  ['fetchArt never throws: a throwing fetch, a bad body, a timeout and no fetch give ok: false', async () => {
    const a = await fetchArt(GOOD, { fetch: async () => { throw new Error('boom'); } });
    const b = await fetchArt(GOOD, { fetch: async () => ({ status: 200, ok: true, headers: new Headers(), body: null }) });
    const c = await fetchArt(GOOD, { fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), timeoutMs: 20 });
    const d = await fetchArt(GOOD, {});
    return (a.ok === false && b.ok === false && c.ok === false && d.ok === false) || 'a case did not fail cleanly';
  }],
  ['buildArtArgv equals the pinned list; --tools is empty; --strict-mcp-config present', () => {
    const argv = buildArtArgv();
    const pinned = ['-p', '--model', 'opus', '--input-format', 'stream-json', '--output-format', 'json', '--json-schema', JSON.stringify(ART_SCHEMA), '--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--restricted', '--safe-mode', '--max-turns', '2', '--no-session-persistence', '--append-system-prompt', ART_PROMPT];
    return (deepEqual(argv, pinned) && argv[argv.indexOf('--tools') + 1] === '' && argv.includes('--strict-mcp-config') && !argv.includes('--allowedTools')) || JSON.stringify(argv);
  }],
  ['ART_SCHEMA allows only look: ai, not_ai, unclear', () => deepEqual(ART_SCHEMA, { type: 'object', additionalProperties: false, required: ['look'], properties: { look: { enum: ['ai', 'not_ai', 'unclear'] } } })],
  ['lookArt writes one stream-json user message: the image block, then the question', async () => {
    const sp = fakeSpawn({ structured_output: { look: 'ai' } });
    const r = await lookArt(image, { spawn: sp, env });
    const c = sp.calls[0];
    const lines = c.child.written.split('\n').filter(Boolean);
    const msg = JSON.parse(lines[0]);
    const content = msg.message.content;
    const ok = r.ok === true && r.look === 'ai' && c.file === 'claude' && deepEqual(c.argv, buildArtArgv()) && lines.length === 1
      && msg.type === 'user' && msg.message.role === 'user' && content.length === 2
      && deepEqual(content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.base64 } })
      && content[1].type === 'text' && content[1].text.length > 10 && c.child.ended;
    return ok || JSON.stringify({ r, written: c.child.written.slice(0, 200) });
  }],
  ['lookArt accepts each exact answer, as a list, an object or a JSON string', async () => {
    for (const w of ['ai', 'not_ai', 'unclear']) {
      const a = await look({ structured_output: { look: w } });
      const b = await look(JSON.stringify([{ type: 'system' }, { type: 'result', is_error: false, structured_output: { look: w } }]));
      const c = await look({ result: JSON.stringify({ look: w }) });
      if (a.look !== w || b.look !== w || c.look !== w) return `failed ${w}`;
    }
    return true;
  }],
  ['lookArt rejects AI, extra fields, free text, is_error and a bad list', async () => {
    const outs = [{ structured_output: { look: 'AI' } }, { structured_output: { look: 'ai', why: 'x' } }, { result: 'I think it looks AI-made.' }, { result: 'ai' }, { structured_output: { look: ['ai'] } }, { structured_output: {} }, { structured_output: null, result: 'x' }, { is_error: true, result: '{"look":"ai"}', structured_output: { look: 'ai' } }, 'not json', JSON.stringify([{ type: 'system' }])];
    for (const o of outs) {
      const r = await look(o);
      if (r.ok !== false) return `accepted ${JSON.stringify(o)}`;
    }
    return true;
  }],
  ['lookArt: a non-zero exit, a spawn throw and a timeout give ok: false', async () => {
    const a = await look({}, { spawn: fakeSpawn({ structured_output: { look: 'ai' } }, { code: 1 }) });
    const b = await look({}, { spawn: () => { throw new Error('nope'); } });
    const c = await look({}, { spawn: fakeSpawn('', { hang: true }), timeoutMs: 20 });
    return (a.ok === false && b.ok === false && c.ok === false) || JSON.stringify([a, b, c]);
  }],
  ['the child env drops HM_KEY_HASH and SHLABS_API_KEY', async () => {
    const sp = fakeSpawn({ structured_output: { look: 'unclear' } });
    await lookArt(image, { spawn: sp, env });
    return deepEqual(Object.keys(sp.calls[0].opts.env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH']) || JSON.stringify(sp.calls[0].opts.env);
  }],
]);
