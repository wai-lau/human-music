// The only code in the service that runs git. It keeps a local clone of the verdicts repo,
// writes verdicts.json at the root of `main`, and pushes with one deploy key. It refuses any
// remote other than the one it was created with, and never force-pushes.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const AUTHOR_NAME = 'Human Music Investigator';
const AUTHOR_EMAIL = 'human-music-investigator@users.noreply.github.com';

// GitHub's published SSH host keys (api.github.com/meta, checked 2026-11-17; ed25519
// fingerprint SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU). Pinned, so a push never
// trusts whatever answers first, and BatchMode never meets an unknown host.
const GITHUB_KNOWN_HOSTS = [
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
].join('\n') + '\n';

// Every git command is stopped after timeoutMs (review 2026-11-17: a hung push held the
// publisher, and with it every later publish, forever).
export function defaultRunGit(args, { cwd, env, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message).trim());
        e.code = err.code;
        reject(e);
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Compare two lists ignoring the `updated` stamp (and formatting).
function sameApartFromUpdated(a, b) {
  try {
    const x = JSON.parse(a);
    const y = JSON.parse(b);
    delete x.updated;
    delete y.updated;
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

export function createPublisher({ repoDir, remote, branch = 'main', path = 'verdicts.json', sshKeyPath, runGit = defaultRunGit, now = () => new Date() }) {
  if (branch !== 'main') throw new Error('the publisher only writes the main branch');
  if (path !== 'verdicts.json') throw new Error('the publisher only writes verdicts.json');
  if (typeof remote !== 'string' || !remote) throw new Error('remote is required');
  if (typeof repoDir !== 'string' || !repoDir || /['\n\r\0]/.test(repoDir)) throw new Error('repoDir is required and must not contain quotes or newlines');
  const knownHosts = `${repoDir}.known_hosts`;
  if (typeof sshKeyPath !== 'string' || !sshKeyPath || /['\n\r\0]/.test(sshKeyPath)) throw new Error('sshKeyPath is required and must not contain quotes or newlines');

  const env = {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i '${sshKeyPath}' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='${knownHosts}' -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=2`,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: AUTHOR_EMAIL,
  };
  const git = (args) => runGit(args, { cwd: repoDir, env });
  const file = join(repoDir, path);

  const redact = (text) => String(text)
    .split(sshKeyPath).join('<key>')
    .replace(/\s+/g, ' ')
    .slice(0, 500);

  async function hasRef(ref) {
    try {
      await git(['rev-parse', '--verify', '--quiet', ref]);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureClone() {
    mkdirSync(dirname(knownHosts), { recursive: true });
    writeFileSync(knownHosts, GITHUB_KNOWN_HOSTS, { mode: 0o644 });
    if (!existsSync(join(repoDir, '.git'))) {
      mkdirSync(repoDir, { recursive: true });
      await git(['init', '-q', '-b', 'main']);
      await git(['remote', 'add', 'origin', remote]);
    }
    const { stdout } = await git(['remote', 'get-url', 'origin']);
    if (stdout.trim() !== remote) throw new Error('clone remote is not the configured one; refusing');
  }

  // Put the clone exactly where the remote's main is (or empty if the remote has no main yet).
  async function syncToRemote() {
    // ls-remote first: it fails if the remote is unreachable, and tells an empty remote apart.
    const listing = await git(['ls-remote', '--heads', remote, 'main']);
    if (listing.stdout.trim() !== '') {
      await git(['fetch', '-q', '--no-tags', remote, '+refs/heads/main:refs/remotes/origin/main']);
      await git(['checkout', '-q', '-f', '-B', 'main', 'origin/main']);
    } else if (await hasRef('refs/heads/main')) {
      // The remote has no main but a local one lingers: drop it so the first commit is fresh.
      await git(['update-ref', '-d', 'refs/heads/main']);
      await git(['rm', '-q', '--cached', '-r', '--ignore-unmatch', '.']);
    }
  }

  async function undoCommit() {
    try {
      if (await hasRef('HEAD~1')) await git(['reset', '-q', '--hard', 'HEAD~1']);
      else {
        await git(['update-ref', '-d', 'refs/heads/main']);
        await git(['rm', '-q', '--cached', '-r', '--ignore-unmatch', '.']);
      }
    } catch {
      // the next publish re-syncs from the remote anyway
    }
  }

  let busy = Promise.resolve();

  async function publishOnce(listJson) {
    try {
      JSON.parse(listJson);
    } catch {
      return { ok: false, error: 'list is not valid JSON' };
    }
    try {
      await ensureClone();
      await syncToRemote();
      if (existsSync(file) && (await hasRef('HEAD')) && sameApartFromUpdated(readFileSync(file, 'utf8'), listJson)) {
        return { ok: true, changed: false };
      }
      writeFileSync(file, listJson);
      await git(['add', '--', path]);
      await git(['commit', '-q', '--no-gpg-sign', '-m', `Update verdicts (${now().toISOString()})`, '--', path]);
      const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim();
      try {
        await git(['push', '-q', remote, 'HEAD:refs/heads/main']);
      } catch (e) {
        await undoCommit();
        return { ok: false, error: redact(e.message) };
      }
      return { ok: true, changed: true, commit };
    } catch (e) {
      return { ok: false, error: redact(e && e.message ? e.message : e) };
    }
  }

  return {
    publish(listJson) {
      const next = busy.then(() => publishOnce(listJson));
      busy = next.catch(() => {});
      return next;
    },
  };
}
