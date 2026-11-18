// The release-key lock (security audit 2026-11-17): scripts/lock-release-keys.sh and
// scripts/with-release-keys.sh, run on fake keys in a temp folder with a throwaway gpg home.
// HM_GPG points at a gpg that takes a fixed test passphrase instead of asking.
import { run } from './load.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const PEM = '-----BEGIN PRIVATE KEY-----\nFAKE-SIGNING-KEY-FOR-TESTS\n-----END PRIVATE KEY-----\n';
const SA = '{"client_email":"x@y.iam.gserviceaccount.com","private_key":"FAKE-SA-KEY-FOR-TESTS"}\n';

function setup(passphrase = 'test-passphrase') {
  const dir = mkdtempSync(join(tmpdir(), 'hm-keys-'));
  const keys = join(dir, 'keys'); const gnupg = join(dir, 'gnupg');
  for (const d of [keys, gnupg]) spawnSync('mkdir', ['-m', '700', d]);
  writeFileSync(join(keys, 'human-music-crx.pem'), PEM); writeFileSync(join(keys, 'human-music-cws-sa.json'), SA);
  const fakeGpg = join(dir, 'gpg');
  writeFileSync(fakeGpg, `#!/bin/sh\nexec gpg --homedir "${gnupg}" --batch --passphrase "$HM_TEST_PASS" "$@"\n`); chmodSync(fakeGpg, 0o755);
  const env = { ...process.env, HM_KEYS_DIR: keys, HM_GPG: fakeGpg, HM_TEST_PASS: passphrase, GNUPGHOME: gnupg };
  const sh = (script, args = [], extra = {}) => spawnSync(join(repo, 'scripts', script), args, { env: { ...env, ...extra }, encoding: 'utf8' });
  return { dir, keys, sh, done: () => rmSync(dir, { recursive: true, force: true }) };
}

run([
  ['lock: one encrypted bundle, plain copies shredded, no key text in it', () => {
    const t = setup();
    try {
      const r = t.sh('lock-release-keys.sh');
      const bundle = join(t.keys, 'human-music-release.tar.gpg');
      const body = existsSync(bundle) ? readFileSync(bundle, 'latin1') : '';
      return (r.status === 0 && existsSync(bundle) && (statSync(bundle).mode & 0o777) === 0o600
        && !existsSync(join(t.keys, 'human-music-crx.pem')) && !existsSync(join(t.keys, 'human-music-cws-sa.json'))
        && !body.includes('FAKE-SIGNING-KEY') && !body.includes('FAKE-SA-KEY')) || JSON.stringify({ status: r.status, err: r.stderr.slice(-300) });
    } finally { t.done(); }
  }],
  ['lock: refuses when already locked, changing nothing', () => {
    const t = setup();
    try {
      t.sh('lock-release-keys.sh');
      writeFileSync(join(t.keys, 'human-music-crx.pem'), PEM); writeFileSync(join(t.keys, 'human-music-cws-sa.json'), SA);
      const r = t.sh('lock-release-keys.sh');
      return (r.status !== 0 && existsSync(join(t.keys, 'human-music-crx.pem'))) || JSON.stringify({ status: r.status });
    } finally { t.done(); }
  }],
  ['with-release-keys: the command sees both keys; afterwards they are gone', () => {
    const t = setup();
    try {
      t.sh('lock-release-keys.sh');
      const r = t.sh('with-release-keys.sh', ['sh', '-c', 'cat "$HM_CRX_KEY" "$HM_CWS_SA_KEY"; echo "DIR=$(dirname "$HM_CRX_KEY")"']);
      const dir = (r.stdout.match(/DIR=(.*)/) || [])[1];
      return (r.status === 0 && r.stdout.includes('FAKE-SIGNING-KEY') && r.stdout.includes('FAKE-SA-KEY') && dir && !existsSync(dir)) || JSON.stringify({ status: r.status, dir, err: r.stderr.slice(-300) });
    } finally { t.done(); }
  }],
  ['with-release-keys: a failing command still cleans up and passes its status on', () => {
    const t = setup();
    try {
      t.sh('lock-release-keys.sh');
      const r = t.sh('with-release-keys.sh', ['sh', '-c', 'echo "DIR=$(dirname "$HM_CRX_KEY")"; exit 7']);
      const dir = (r.stdout.match(/DIR=(.*)/) || [])[1];
      return (r.status === 7 && dir && !existsSync(dir)) || JSON.stringify({ status: r.status, dir });
    } finally { t.done(); }
  }],
  ['with-release-keys: a TERM signal while the command runs still removes the keys', () => {
    const t = setup();
    try {
      t.sh('lock-release-keys.sh');
      const r = t.sh('with-release-keys.sh', ['sh', '-c', 'echo "DIR=$(dirname "$HM_CRX_KEY")"; kill -TERM $PPID; sleep 1']);
      const dir = (r.stdout.match(/DIR=(.*)/) || [])[1];
      return (r.status !== 0 && dir && !existsSync(dir)) || JSON.stringify({ status: r.status, dir });
    } finally { t.done(); }
  }],
  ['with-release-keys: a wrong passphrase runs nothing', () => {
    const t = setup();
    try {
      t.sh('lock-release-keys.sh');
      const r = t.sh('with-release-keys.sh', ['sh', '-c', 'echo RAN'], { HM_TEST_PASS: 'wrong' });
      return (r.status !== 0 && !r.stdout.includes('RAN')) || JSON.stringify({ status: r.status, out: r.stdout });
    } finally { t.done(); }
  }],
  ['with-release-keys: before locking, the command runs with the plain keys', () => {
    const t = setup();
    try {
      const r = t.sh('with-release-keys.sh', ['sh', '-c', 'echo RAN']);
      return (r.status === 0 && r.stdout.includes('RAN') && /not locked yet/.test(r.stderr)) || JSON.stringify({ status: r.status, err: r.stderr });
    } finally { t.done(); }
  }],
  ['release.mjs takes the unlocked service account from HM_CWS_SA_KEY; only the sign phase runs under the keys, so tests and lint never do', () => /process\.env\.HM_CWS_SA_KEY \|\|/.test(readFileSync(join(repo, 'scripts/release.mjs'), 'utf8')) && /with-release-keys\.sh', \['node'/.test(readFileSync(join(repo, 'scripts/release.mjs'), 'utf8')) && !/with-release-keys/.test(readFileSync(join(repo, 'package.json'), 'utf8'))],
]);
