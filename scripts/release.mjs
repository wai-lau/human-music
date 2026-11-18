#!/usr/bin/env node
// Release Human Music to the Chrome Web Store from the terminal (Wai, 2026-11-13: "yes
// release from terminal"). Uses the Chrome Web Store API v2 with a service account.
//
//   node scripts/release.mjs status    published and submitted versions, review state
//   node scripts/release.mjs upload    pack the signed .crx from git HEAD and upload it
//   node scripts/release.mjs publish   upload, then submit it for review (goes live on approval)
//       (upload and publish need a clean tree on main, HEAD = GitHub main, HEAD tagged v<manifest version>)
//   node scripts/release.mjs release [patch|minor|major]   (npm run release) the whole release:
//       refuses on a dirty tree, off main, HEAD not GitHub main or while a version waits for review;
//       lists the commits since the last v* tag and needs a typed yes; runs unit tests, lint and end-to-end tests (refusing if HEAD moved meanwhile); bumps the version, commits,
//       packs the signed .crx and the Firefox zip into a staging folder, and only when every pack has worked tags
//       v<version> and pushes; uploads the .crx and submits it for review
//
// Config, kept outside the repo like the signing key: ~/.keys/human-music-cws.json
//   { "publisherId": "...", "itemId": "...", "serviceAccountKey": "~/.keys/<service account>.json" }
// ($HM_CWS_CONFIG points elsewhere.) The service account's JSON key is Google's own file.
// Nothing here prints a key or a token.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'fs';
import { createSign } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir, tmpdir } from 'os';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = p => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const b64url = buf => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// A signed JWT for Google's service-account token exchange (RS256, valid one hour).
export function makeJwt(sa, nowSec) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

// "0.1.10" > "0.1.9": numeric parts compared in order.
export function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Every version the store already holds (published or waiting for review).
export function knownVersions(status) {
  const out = [];
  for (const rev of [status && status.publishedItemRevisionStatus, status && status.submittedItemRevisionStatus]) {
    for (const ch of (rev && rev.distributionChannels) || []) if (ch.crxVersion) out.push(ch.crxVersion);
  }
  return out;
}

export function createClient({ config, serviceAccount, fetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const name = `publishers/${config.publisherId}/items/${config.itemId}`;
  let token = null;

  async function call(url, init = {}) {
    const res = await fetch(url, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : {}; } catch (e) { body = { raw: text.slice(0, 500) }; }
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${url.replace(API, '')} failed: ${res.status} ${JSON.stringify(body && body.error ? body.error : body).slice(0, 500)}`);
    return body;
  }

  async function auth() {
    if (token) return token;
    const assertion = makeJwt(serviceAccount, Math.floor(now() / 1000));
    const body = await call(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!body.access_token) throw new Error('token exchange gave no access token');
    token = body.access_token;
    return token;
  }

  const authed = async (extra = {}) => ({ Authorization: `Bearer ${await auth()}`, ...extra });

  async function status() {
    return call(`${API}/v2/${name}:fetchStatus`, { headers: await authed() });
  }

  // Uploads a signed .crx (the item takes verified CRX uploads only) and waits for it.
  async function upload(crxBytes, fileName) {
    let res = await call(`${API}/upload/v2/${name}:upload`, {
      method: 'POST',
      headers: await authed({ 'Content-Type': 'application/octet-stream', 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': fileName }),
      body: crxBytes,
    });
    for (let i = 0; i < 60 && /IN_PROGRESS/.test(String(res.uploadState)); i++) {
      await sleep(5000);
      const st = await status();
      res = { ...res, uploadState: st.lastAsyncUploadState || res.uploadState };
    }
    if (!/SUCCEEDED|SUCCESS/.test(String(res.uploadState))) throw new Error(`upload ended as ${res.uploadState}`);
    return res;
  }

  // Submits the uploaded version for review; it goes live (with the item's current
  // visibility) once approved.
  async function publish() {
    return call(`${API}/v2/${name}:publish`, {
      method: 'POST',
      headers: await authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
    });
  }

  return { status, upload, publish };
}

// 0.1.2 -> 0.1.3 (patch), 0.2.0 (minor), 1.0.0 (major).
export function bump(version, kind = 'patch') {
  const [major = 0, minor = 0, patch = 0] = String(version).split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown release kind ${kind}: use patch, minor or major`);
}

// The guards every command that ships code shares: clean tree, on main, HEAD exactly
// GitHub's main. Returns the commit that would ship.
function guardMain(git) {
  if (git(['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('uncommitted changes: commit or stash them first');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (branch !== 'main') throw new Error(`on ${branch}: releases go from main`);
  git(['fetch', '--quiet', 'origin', 'main']);
  const head = git(['rev-parse', 'HEAD']).trim();
  if (head !== git(['rev-parse', 'origin/main']).trim()) throw new Error('HEAD is not GitHub main (behind or ahead): pull or push first');
  return head;
}

// A release packs commits, so a stray file under extension/ (untracked or modified) means
// the tree is not what ships: refuse before anything is tested, tagged or pushed.
function guardExtensionClean(git) {
  const stray = git(['status', '--porcelain', '--untracked-files=all', '--', 'extension']).trim();
  if (stray) throw new Error(`extension/ has files not held as committed (commit, remove or ignore them first):\n${stray}`);
}

// Is v<version> a tag on exactly this commit?
function guardTagged(git, head, version) {
  let at = '';
  try { at = git(['rev-parse', `v${version}^{commit}`]).trim(); } catch (e) { /* no such tag */ }
  if (at !== head) throw new Error(`HEAD is not tagged v${version}: only a released, tagged main is uploaded (run the release command)`);
}

// upload / publish of a version already tagged by a release: same guards as a release,
// then pack HEAD (the tagged commit), upload it, and for publish submit it.
export async function runShip({ cmd, git, run, client, readVersion, readCrx, log = console.log }) {
  const head = guardMain(git);
  const version = readVersion();
  guardTagged(git, head, version);
  const before = await client.status();
  log(describe(before));
  const held = knownVersions(before);
  if (held.some(v => !newer(version, v))) throw new Error(`version ${version} at HEAD is not newer than ${held.join(', ')}: release again`);
  run('scripts/pack-crx.sh');
  const up = await client.upload(readCrx(version), `human-music-${version}.crx`);
  log(`uploaded ${up.crxVersion || version} (${up.uploadState})`);
  if (cmd === 'upload') return { version };
  const pub = await client.publish();
  log(`submitted for review: ${pub.state}`);
  for (const w of (pub.warningInfo && pub.warningInfo.warnings) || []) log(`warning: ${w.reason} ${w.description || ''}`);
  return { version, state: pub.state };
}

// The whole release, with every outside step passed in (so tests can watch the order).
// git(args) returns stdout; run(cmd, args) throws when the command fails;
// confirm(text) answers true only for a typed yes.
export async function runRelease({ kind = 'patch', git, run, client, confirm, readVersion, writeVersion, readCrx, stage, log = console.log }) {
  const head = guardMain(git);
  guardExtensionClean(git);

  const before = await client.status();
  log(describe(before));
  if (before.submittedItemRevisionStatus) {
    throw new Error(`a version is still waiting for review (${knownVersions({ publishedItemRevisionStatus: before.submittedItemRevisionStatus }).join(', ') || 'unknown'}): release again once it is through`);
  }

  let lastTag = '';
  try { lastTag = git(['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim(); } catch (e) { /* no release yet */ }
  const commits = git(['log', '--oneline', lastTag ? `${lastTag}..HEAD` : 'HEAD']).trim();
  const shown = `Changes since ${lastTag || 'the start'} (releasing ${head.slice(0, 9)}):\n${commits || '(none)'}\n`;
  log(shown);
  if (!(await confirm(shown))) throw new Error('not confirmed: nothing released');

  for (const [cmd, args] of [['npm', ['test']], ['npm', ['run', 'lint']], ['npm', ['run', 'e2e']]]) {
    log(`checking: ${cmd} ${args.join(' ')}`);
    run(cmd, args);
  }
  if (git(['rev-parse', 'HEAD']).trim() !== head) throw new Error('main moved while testing: run again');

  const held = [readVersion(), ...knownVersions(before)];
  const top = held.reduce((a, b) => (newer(b, a) ? b : a));
  const version = bump(top, kind);
  writeVersion(version);
  git(['commit', '-q', '-m', `release: ${version}`, '--', 'extension/manifest.json']);

  // Pack everything from the release commit into the staging folder BEFORE tagging or pushing:
  // a pack failure (or any other late failure) must not leave a tag or a pushed commit behind.
  const commit = git(['rev-parse', 'HEAD']).trim();
  try {
    run('scripts/pack-crx.sh', [commit], { HM_DIST_DIR: stage });
    run('scripts/pack-firefox.sh', [commit], { HM_DIST_DIR: stage });
  } catch (e) {
    git(['reset', '--hard', head]); // drop the version commit: nothing was tagged or pushed
    throw new Error(`packing failed, nothing tagged or pushed (the version commit is undone): ${e.message}`);
  }
  git(['tag', `v${version}`]);
  try { guardTagged(git, commit, version); } catch (e) { git(['tag', '-d', `v${version}`]); git(['reset', '--hard', head]); throw e; }
  git(['push', '-q', '--atomic', 'origin', 'main', `v${version}`]);
  log(`committed and pushed ${version}`);

  const name = `human-music-${version}.crx`;
  const up = await client.upload(readCrx(version, stage), name);
  log(`uploaded ${up.crxVersion || version} (${up.uploadState})`);
  const pub = await client.publish();
  log(`submitted ${version} for review: ${pub.state}`);
  for (const w of (pub.warningInfo && pub.warningInfo.warnings) || []) log(`warning: ${w.reason} ${w.description || ''}`);
  return { version, state: pub.state };
}

function loadConfig() {
  const path = home(process.env.HM_CWS_CONFIG || '~/.keys/human-music-cws.json');
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`no config at ${path} (see the top of scripts/release.mjs)`); }
  for (const k of ['publisherId', 'itemId', 'serviceAccountKey']) if (!config[k]) throw new Error(`${path} has no ${k}`);
  // scripts/with-release-keys.sh unlocks the key for one run and points HM_CWS_SA_KEY at it.
  const serviceAccount = JSON.parse(readFileSync(process.env.HM_CWS_SA_KEY || home(config.serviceAccountKey), 'utf8'));
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('the service account key file has no client_email or private_key');
  return { config, serviceAccount };
}

function describe(st) {
  const line = (label, rev) => `${label}: ${rev ? `${rev.state} ${knownVersions({ publishedItemRevisionStatus: rev }).join(', ')}` : 'none'}`;
  return [line('published', st.publishedItemRevisionStatus), line('submitted', st.submittedItemRevisionStatus),
    st.takenDown ? 'TAKEN DOWN' : null, st.warned ? 'warned' : null].filter(Boolean).join('\n');
}

async function typedYes(text) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(res => { rl.once('close', () => res('')); rl.question('Type yes to test and release these commits: ', res); });
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main(cmd, arg) {
  if (!['status', 'upload', 'publish', 'release'].includes(cmd)) { console.error('usage: node scripts/release.mjs status|upload|publish|release [patch|minor|major]'); process.exit(2); }
  const { config, serviceAccount } = loadConfig();
  const client = createClient({ config, serviceAccount, fetch: globalThis.fetch });
  const manifest = join(repo, 'extension', 'manifest.json');
  const deps = {
    git: args => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    run: (c, args = [], env = {}) => execFileSync(c.startsWith('scripts/') ? join(repo, c) : c, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } }),
    client,
    readVersion: () => JSON.parse(readFileSync(manifest, 'utf8')).version,
    readCrx: (v, dir = join(repo, 'dist')) => readFileSync(join(dir, `human-music-${v}.crx`)),
  };
  if (cmd === 'release') {
    const stage = mkdtempSync(join(tmpdir(), 'hm-release-'));
    let version;
    try {
      ({ version } = await runRelease({
        kind: arg || 'patch', ...deps, confirm: typedYes, stage,
        writeVersion: v => writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/"version": "[^"]*"/, `"version": "${v}"`)),
      }));
      mkdirSync(join(repo, 'dist'), { recursive: true });
      cpSync(stage, join(repo, 'dist'), { recursive: true });
    } finally { rmSync(stage, { recursive: true, force: true }); }
    console.log(`done: ${version} is in Google's review queue; it goes live once approved`);
    return;
  }
  if (cmd === 'status') { console.log(describe(await client.status())); return; }
  await runShip({ cmd, ...deps });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.argv[3]).catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
}
