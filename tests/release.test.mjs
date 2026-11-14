// scripts/release.mjs against a fake network: the service-account JWT, the exact Chrome Web
// Store API calls (signed .crx upload headers, polling, publish), and the version guard.
import { generateKeyPairSync, createVerify } from 'crypto';
import { run } from './load.mjs';
import { makeJwt, newer, knownVersions, createClient } from '../scripts/release.mjs';

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

run([
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
]);
