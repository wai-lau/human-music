#!/usr/bin/env node
// Release Human Music to the Chrome Web Store from the terminal (Wai, 2026-11-13: "yes
// release from terminal"). Uses the Chrome Web Store API v2 with a service account.
//
//   node scripts/release.mjs status    published and submitted versions, review state
//   node scripts/release.mjs upload    pack the signed .crx from git HEAD and upload it
//   node scripts/release.mjs publish   upload, then submit it for review (goes live on approval)
//
// Config, kept outside the repo like the signing key: ~/.keys/human-music-cws.json
//   { "publisherId": "...", "itemId": "...", "serviceAccountKey": "~/.keys/<service account>.json" }
// ($HM_CWS_CONFIG points elsewhere.) The service account's JSON key is Google's own file.
// Nothing here prints a key or a token.
import { readFileSync } from 'fs';
import { createSign } from 'crypto';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname, basename } from 'path';
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

function loadConfig() {
  const path = home(process.env.HM_CWS_CONFIG || '~/.keys/human-music-cws.json');
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new Error(`no config at ${path} (see the top of scripts/release.mjs)`); }
  for (const k of ['publisherId', 'itemId', 'serviceAccountKey']) if (!config[k]) throw new Error(`${path} has no ${k}`);
  const serviceAccount = JSON.parse(readFileSync(home(config.serviceAccountKey), 'utf8'));
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('the service account key file has no client_email or private_key');
  return { config, serviceAccount };
}

function describe(st) {
  const line = (label, rev) => `${label}: ${rev ? `${rev.state} ${knownVersions({ publishedItemRevisionStatus: rev }).join(', ')}` : 'none'}`;
  return [line('published', st.publishedItemRevisionStatus), line('submitted', st.submittedItemRevisionStatus),
    st.takenDown ? 'TAKEN DOWN' : null, st.warned ? 'warned' : null].filter(Boolean).join('\n');
}

async function main(cmd) {
  if (!['status', 'upload', 'publish'].includes(cmd)) { console.error('usage: node scripts/release.mjs status|upload|publish'); process.exit(2); }
  const { config, serviceAccount } = loadConfig();
  const client = createClient({ config, serviceAccount, fetch: globalThis.fetch });
  const before = await client.status();
  console.log(describe(before));
  if (cmd === 'status') return;

  const version = JSON.parse(execFileSync('git', ['-C', repo, 'show', 'HEAD:extension/manifest.json'], { encoding: 'utf8' })).version;
  const held = knownVersions(before);
  if (held.some(v => !newer(version, v))) throw new Error(`version ${version} at HEAD is not newer than ${held.join(', ')}: bump extension/manifest.json and commit`);
  execFileSync(join(repo, 'scripts/pack-crx.sh'), { stdio: 'inherit' });
  const crx = join(repo, 'dist', `human-music-${version}.crx`);
  const up = await client.upload(readFileSync(crx), basename(crx));
  console.log(`uploaded ${up.crxVersion || version} (${up.uploadState})`);
  if (cmd === 'upload') return;

  const pub = await client.publish();
  console.log(`submitted for review: ${pub.state}`);
  for (const w of (pub.warningInfo && pub.warningInfo.warnings) || []) console.log(`warning: ${w.reason} ${w.description || ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
}
