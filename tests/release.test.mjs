// scripts/release.mjs against a fake network: the service-account JWT, the exact Chrome Web
// Store API calls (signed .crx upload headers, polling, publish), and the version guard.
import { generateKeyPairSync, createVerify } from 'crypto';
import { run } from './load.mjs';
import { makeJwt, newer, knownVersions, createClient, bump, runRelease, runShip } from '../scripts/release.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'releaser@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const CONFIG = { publisherId: 'pub-1', itemId: 'abcdefghijklmnopabcdefghijklmnop' };
const J = v => JSON.stringify(v);
const fromB64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// A fake fetch: answers by URL, records every call.
function fakeFetch(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    const key = Object.keys(answers).find(k => url.endsWith(k));
    const a = key ? answers[key] : { status: 404, body: { error: 'no fake for ' + url } };
    const body = typeof a.body === 'function' ? a.body(calls.length) : a.body;
    return { ok: (a.status || 200) < 400, status: a.status || 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}
const token = { status: 200, body: { access_token: 'tok-123', expires_in: 3600 } };

const basics = [
  ['makeJwt: RS256, signed by the service account, claims for the Web Store scope', () => {
    const jwt = makeJwt(SA, 1000);
    const [h, c, sig] = jwt.split('.');
    const v = createVerify('RSA-SHA256'); v.update(`${h}.${c}`);
    const claims = JSON.parse(fromB64url(c));
    return (v.verify(publicKey, fromB64url(sig)) && JSON.parse(fromB64url(h)).alg === 'RS256'
      && claims.iss === SA.client_email && claims.scope === 'https://www.googleapis.com/auth/chromewebstore'
      && claims.aud === 'https://oauth2.googleapis.com/token' && claims.iat === 1000 && claims.exp === 4600) || J(claims);
  }],
  ['newer compares numbers, not text', () => newer('0.1.10', '0.1.9') && !newer('0.1.1', '0.1.1') && !newer('0.1.0', '0.1.1') && newer('1.0', '0.9.9')],
  ['knownVersions: published and submitted versions', () =>
    J(knownVersions({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.1.1' }] }, submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.1.2' }] } })) === J(['0.1.1', '0.1.2'])],
  ['upload: one token exchange, the signed .crx with the raw-upload headers, polled until done', async () => {
    const f = fakeFetch({
      'oauth2.googleapis.com/token': token,
      ':upload': { body: { itemId: CONFIG.itemId, uploadState: 'IN_PROGRESS' } },
      ':fetchStatus': { body: n => ({ lastAsyncUploadState: n < 4 ? 'IN_PROGRESS' : 'SUCCEEDED' }) },
    });
    const client = createClient({ config: CONFIG, serviceAccount: SA, fetch: f.fetch, now: () => 1_000_000, sleep: async () => {} });
    const crx = Buffer.from('Cr24 signed');
    const res = await client.upload(crx, 'human-music-0.1.2.crx');
    const [tok, up] = f.calls;
    const form = new URLSearchParams(tok.body);
    return (f.calls.filter(c => c.url.includes('oauth2')).length === 1
      && form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && form.get('assertion').split('.').length === 3
      && up.url === 'https://chromewebstore.googleapis.com/upload/v2/publishers/pub-1/items/abcdefghijklmnopabcdefghijklmnop:upload'
      && up.method === 'POST' && up.body === crx && up.headers.Authorization === 'Bearer tok-123'
      && up.headers['X-Goog-Upload-Protocol'] === 'raw' && up.headers['X-Goog-Upload-File-Name'] === 'human-music-0.1.2.crx'
      && res.uploadState === 'SUCCEEDED') || J({ calls: f.calls.map(c => c.url), res });
  }],
  ['a failed upload stops the release with its state', async () => {
    const f = fakeFetch({ 'oauth2.googleapis.com/token': token, ':upload': { body: { uploadState: 'FAILED' } } });
    const client = createClient({ config: CONFIG, serviceAccount: SA, fetch: f.fetch, sleep: async () => {} });
    try { await client.upload(Buffer.from('x'), 'a.crx'); return 'did not throw'; } catch (e) { return /FAILED/.test(e.message) || e.message; }
  }],
  ['publish submits for review with the default publish type', async () => {
    const f = fakeFetch({ 'oauth2.googleapis.com/token': token, ':publish': { body: { itemId: CONFIG.itemId, state: 'PENDING_REVIEW' } } });
    const client = createClient({ config: CONFIG, serviceAccount: SA, fetch: f.fetch });
    const res = await client.publish();
    const call = f.calls[1];
    return (call.url === 'https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/abcdefghijklmnopabcdefghijklmnop:publish'
      && call.method === 'POST' && JSON.parse(call.body).publishType === 'DEFAULT_PUBLISH' && res.state === 'PENDING_REVIEW') || J(f.calls);
  }],
  ['an API error names the call and status, never the token', async () => {
    const f = fakeFetch({ 'oauth2.googleapis.com/token': token, ':fetchStatus': { status: 403, body: { error: { message: 'forbidden' } } } });
    const client = createClient({ config: CONFIG, serviceAccount: SA, fetch: f.fetch });
    try { await client.status(); return 'did not throw'; } catch (e) { return (/403/.test(e.message) && /fetchStatus/.test(e.message) && !/tok-123/.test(e.message)) || e.message; }
  }],
];

// The whole release (npm run release): refusals first, then checks, bump, commit, push,
// pack, upload, publish, in that order. Every step is a fake that records itself.

function fakes({ status = { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '0.1.2' }] } },
  head = '0.1.2', dirty = '', branch = 'main', origin = 'aaa', moves = false, answer = true, lastTag = 'v0.1.2', tagAt = 'aaa',
  commits = 'bbb2 fix: one\nccc3 feat: two\n', failing = null, problems = [], untracked = '' } = {}) {
  const steps = [];
  let version = head;
  let sha = 'aaa';
  const git = args => {
    steps.push('git ' + args.join(' '));
    if (args[0] === 'status') return args.includes('extension') ? untracked : dirty;
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return branch + '\n';
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return sha + '\n';
    if (args[0] === 'rev-parse' && args[1] === 'origin/main') return origin + '\n';
    if (args[0] === 'rev-parse' && /^v.*\^\{commit\}$/.test(args[1])) { if (tagAt === null) throw new Error('no tag'); return tagAt + '\n'; }
    if (args[0] === 'describe') { if (!lastTag) throw new Error('no tags'); return lastTag + '\n'; }
    if (args[0] === 'log') return commits;
    if (args[0] === 'commit') sha = 'new';
    if (args[0] === 'reset') sha = args[args.length - 1];
    if (args[0] === 'tag') tagAt = sha;
    return '';
  };
  const run = (cmd, args = [], env) => {
    const s = [cmd, ...args].join(' '); steps.push('run ' + s + (env && env.HM_DIST_DIR ? ' >' + env.HM_DIST_DIR : ''));
    if (moves && s === 'npm run e2e') sha = 'zzz';
    if (failing && s.includes(failing)) throw new Error(s + ' failed');
  };
  const client = {
    status: async () => { steps.push('status'); return status; },
    upload: async (bytes, name) => { steps.push('upload ' + name); return { uploadState: 'SUCCEEDED', crxVersion: version }; },
    publish: async () => { steps.push('publish'); return { state: 'PENDING_REVIEW' }; },
  };
  const shown = [];
  const confirm = async text => { steps.push('confirm'); shown.push(text); return answer; };
  const deps = { git, run, client, confirm, readVersion: () => version, writeVersion: v => { steps.push('version ' + v); version = v; },
    verify: (dir, v) => { steps.push('verify ' + v + ' ' + dir); return problems; },
    readCrx: (v, dir) => { steps.push('read crx ' + v + ' ' + dir); return Buffer.from('crx'); }, stage: '/stage', log: () => {} };
  return { steps, deps, shown };
}

const refused = async (fn, steps, bad) => {
  try { await fn(); return 'did not refuse'; } catch (e) { return steps.some(s => bad.test(s)) ? 'went too far: ' + JSON.stringify(steps) : true; }
};

await run([
  ...basics,
  ['bump: patch, minor, major', () => bump('0.1.2', 'patch') === '0.1.3' && bump('0.1.2', 'minor') === '0.2.0' && bump('0.1.2', 'major') === '1.0.0' && bump('1.2', 'patch') === '1.2.1'],
  ['a release runs checks, then bumps, commits, packs everything into a staging folder, and only then tags, pushes, uploads and submits', async () => {
    const { steps, deps } = fakes();
    const res = await runRelease({ kind: 'patch', ...deps });
    const order = ['confirm', 'run npm test', 'run npm run lint', 'run npm run e2e', 'status', 'version 0.1.3', 'git commit', 'run scripts/pack-crx.sh new >/stage', 'run scripts/pack-firefox.sh new >/stage', 'verify 0.1.3 /stage', 'git tag v0.1.3', 'git push', 'read crx 0.1.3 /stage', 'upload human-music-0.1.3.crx', 'publish'];
    let at = -1;
    const inOrder = order.every(o => { const i = steps.findIndex((s, k) => k > at && s.startsWith(o)); if (i < 0) return false; at = i; return true; });
    return (inOrder && res.version === '0.1.3') || JSON.stringify(steps);
  }],
  ['the push is one atomic push of the branch and the tag', async () => {
    const { steps, deps } = fakes();
    await runRelease({ kind: 'patch', ...deps });
    const pushes = steps.filter(s => s.startsWith('git push'));
    return (pushes.length === 1 && /--atomic/.test(pushes[0]) && /origin main v0\.1\.3$/.test(pushes[0])) || JSON.stringify(pushes);
  }],
  ['an untracked or modified file under extension/ refuses before anything is tested, tagged or pushed', async () => {
    const out = [];
    for (const f of [{ untracked: '?? extension/src/stray.js\n' }, { dirty: ' M extension/src/content.js\n' }]) {
      const { steps, deps } = fakes(f);
      const r = await refused(() => runRelease({ kind: 'patch', ...deps }), steps, /^run |^version|^git commit|^git tag|^git push|^upload|^publish/);
      if (r !== true) out.push(r);
    }
    return out.length === 0 || out.join('; ');
  }],
  ['a pack failure leaves no tag and no push, and the version commit is undone', async () => {
    const out = [];
    for (const failing of ['pack-crx', 'pack-firefox']) {
      const { steps, deps } = fakes({ failing });
      try { await runRelease({ kind: 'patch', ...deps }); out.push(failing + ' did not stop'); continue; } catch (e) { /* expected */ }
      if (steps.some(s => /^git tag|^git push|^upload|^publish/.test(s))) out.push(failing + ' went too far: ' + JSON.stringify(steps));
      // Only the version commit and the manifest are undone; no hard reset (a shared checkout).
      if (!steps.includes('git reset -q --mixed aaa') || !steps.includes('git checkout aaa -- extension/manifest.json') || steps.some(s => /reset --hard/.test(s))) out.push(failing + ' left the version commit or reset hard: ' + JSON.stringify(steps));
    }
    return out.length === 0 || out.join('; ');
  }],
  ['a pack that fails verify-pack stops the release like a pack failure: no tag, no push, version undone', async () => {
    const { steps, deps } = fakes({ problems: ['lists/my-lists.json is in the package'] });
    try { await runRelease({ kind: 'patch', ...deps }); return 'did not stop'; } catch (e) { if (!/my-lists/.test(e.message)) return 'wrong error: ' + e.message; }
    if (steps.some(s => /^git tag|^git push|^upload|^publish/.test(s))) return 'went too far: ' + JSON.stringify(steps);
    return steps.includes('git reset -q --mixed aaa') || JSON.stringify(steps);
  }],
  ['tests, lint and e2e run before the keyed step, and nothing but signing runs inside it', async () => {
    const { steps, deps } = fakes();
    let head = null;
    await runRelease({ kind: 'patch', ...deps, signed: async h => { head = h; steps.push('KEYS ON'); return { version: '0.1.3' }; } });
    const on = steps.indexOf('KEYS ON');
    return (head === 'aaa' && on > steps.indexOf('run npm run e2e') && steps.slice(on).every(s => !/^run npm|^confirm/.test(s))) || JSON.stringify(steps);
  }],
  ['the new version is above everything the store holds, not just HEAD', async () => {
    const { deps } = fakes({ head: '0.1.2', status: { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '0.1.5' }] } } });
    const res = await runRelease({ kind: 'patch', ...deps });
    return res.version === '0.1.6' || res.version;
  }],
  ['refused while a version waits for review: nothing changed', async () => {
    const { steps, deps } = fakes({ status: { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.1.2' }] } } });
    try { await runRelease({ kind: 'patch', ...deps }); return 'did not refuse'; } catch (e) {
      return (/review/i.test(e.message) && !steps.some(s => /^version|^git commit|^upload|^publish/.test(s))) || e.message + ' ' + JSON.stringify(steps);
    }
  }],
  ['refused with uncommitted changes, off main, or not equal to GitHub main', async () => {
    const out = [];
    for (const f of [{ dirty: ' M extension/src/content.js\n' }, { branch: 'feature' }, { origin: 'bbb' }]) {
      const { steps, deps } = fakes(f);
      const r = await refused(() => runRelease({ kind: 'patch', ...deps }), steps, /^version|^upload|^run npm|^confirm/);
      if (r !== true) out.push(r + ' ' + JSON.stringify(f));
    }
    return out.length === 0 || out.join('; ');
  }],
  ['refused when HEAD moves during the checks: no bump, tag, push or upload', async () => {
    const { steps, deps } = fakes({ moves: true });
    try { await runRelease({ kind: 'patch', ...deps }); return 'did not refuse'; } catch (e) {
      return (/main moved while testing: run again/.test(e.message) && !steps.some(s => /^version|^git commit|^git tag|^git push|^upload|^publish/.test(s))) || e.message + JSON.stringify(steps);
    }
  }],
  ['refused without a typed yes: nothing is tested or changed', async () => {
    const { steps, deps } = fakes({ answer: false });
    return await refused(() => runRelease({ kind: 'patch', ...deps }), steps, /^run |^version|^git commit|^upload/);
  }],
  ['the commits shown are those since the last tag, asked before testing', async () => {
    const { steps, deps, shown } = fakes();
    await runRelease({ kind: 'patch', ...deps });
    const logAt = steps.indexOf('git log --oneline v0.1.2..HEAD');
    return (logAt >= 0 && logAt < steps.indexOf('confirm') && steps.indexOf('confirm') < steps.indexOf('run npm test')
      && /fix: one/.test(shown[0]) && /feat: two/.test(shown[0]) && /v0\.1\.2/.test(shown[0])) || JSON.stringify({ steps, shown });
  }],
  ['with no tag yet, every commit is shown', async () => {
    const { steps, deps } = fakes({ lastTag: null });
    await runRelease({ kind: 'patch', ...deps });
    return steps.includes('git log --oneline HEAD') || JSON.stringify(steps);
  }],
  ['the packed commit is the tagged commit: nothing is pushed or uploaded if the tag is not at it', async () => {
    const { steps, deps } = fakes();
    const git = deps.git;
    deps.git = args => (args[0] === 'rev-parse' && /^v.*\^\{commit\}$/.test(args[1]) ? 'other\n' : git(args));
    return await refused(() => runRelease({ kind: 'patch', ...deps }), steps, /^git push|^upload|^publish/);
  }],
  ['upload and publish: refused off main, behind GitHub, dirty or untagged; nothing uploaded', async () => {
    const out = [];
    for (const f of [{ branch: 'feature' }, { origin: 'bbb' }, { dirty: ' M extension/manifest.json\n' }, { tagAt: null }, { tagAt: 'old' }]) {
      for (const cmd of ['upload', 'publish']) {
        const { steps, deps } = fakes(f);
        const r = await refused(() => runShip({ cmd, ...deps }), steps, /^run |^upload|^publish|^read crx/);
        if (r !== true) out.push(cmd + ' ' + r + ' ' + JSON.stringify(f));
      }
    }
    return out.length === 0 || out.join('; ');
  }],
  ['upload and publish from tagged, clean, pushed main: pack, upload (and submit for publish)', async () => {
    const out = [];
    for (const cmd of ['upload', 'publish']) {
      const { steps, deps } = fakes({ tagAt: 'aaa', status: {} });
      await runShip({ cmd, ...deps });
      const ok = steps.includes('run scripts/pack-crx.sh') && steps.includes('upload human-music-0.1.2.crx') && steps.includes('publish') === (cmd === 'publish');
      if (!ok) out.push(cmd + JSON.stringify(steps));
    }
    return out.length === 0 || out.join('; ');
  }],
  ['a failing check stops before the version changes', async () => {
    const { steps, deps } = fakes({ failing: 'npm run e2e' });
    try { await runRelease({ kind: 'patch', ...deps }); return 'did not stop'; } catch (e) {
      return !steps.some(s => /^version|^git commit|^upload/.test(s)) || JSON.stringify(steps);
    }
  }],
]);
