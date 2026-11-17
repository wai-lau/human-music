import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { run } from './harness.mjs';
import { createPublisher, defaultRunGit } from '../src/publish.mjs';

// Real git against temp bare repos. Ignore the developer's own git config, and never let git
// walk up into a parent repository (/home/wai is one).
const root = mkdtempSync(join(tmpdir(), 'hm-publish-'));
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CEILING_DIRECTORIES = dirname(root);

const genv = { ...process.env };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: genv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let n = 0;
const fresh = () => join(root, `t${++n}`);

function bareRemote(dir) {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', dir], { env: genv });
  return dir;
}

// Seed the bare repo's main with an unrelated commit; returns its hash.
function seedMain(bare) {
  const w = fresh();
  execFileSync('git', ['init', '-q', '-b', 'main', w], { env: genv });
  writeFileSync(join(w, 'README.md'), 'seed\n');
  git(w, 'add', '.');
  git(w, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.org', 'commit', '-q', '-m', 'seed');
  git(w, 'push', '-q', bare, 'HEAD:refs/heads/main');
  return git(w, 'rev-parse', 'HEAD');
}

const list = (updated, names = ['A']) => JSON.stringify({
  name: 'Human Music verdicts', updated, calibrated: false,
  artists: names.map((name) => ({ name, verdict: 'human', confidence: 80, checked: '2026-11-16' })),
}, null, 2) + '\n';

const mk = (remote, extra = {}) => createPublisher({
  repoDir: fresh(), remote, sshKeyPath: '/keys/deploy key', ...extra,
});
const count = (bare) => Number(git(bare, 'rev-list', '--count', 'main'));
const files = (bare, ref = 'main') => git(bare, 'ls-tree', '-r', '--name-only', ref).split('\n');

await run([
  ['first publish on an empty remote makes main with exactly verdicts.json', async () => {
    const bare = bareRemote(fresh());
    const r = await mk(bare).publish(list('t1'));
    if (!r.ok || r.changed !== true || !r.commit) return JSON.stringify(r);
    return (files(bare).join() === 'verdicts.json' && count(bare) === 1 && git(bare, 'rev-parse', 'main') === r.commit)
      || files(bare).join();
  }],
  ['same list with a new updated stamp makes no commit', async () => {
    const bare = bareRemote(fresh());
    const p = mk(bare);
    await p.publish(list('t1'));
    const r = await p.publish(list('t2'));
    return (r.ok === true && r.changed === false && count(bare) === 1) || JSON.stringify(r);
  }],
  ['a changed list makes exactly one commit, from a fresh clone too', async () => {
    const bare = bareRemote(fresh());
    await mk(bare).publish(list('t1'));
    const r = await mk(bare).publish(list('t2', ['A', 'B']));
    return (r.ok && r.changed === true && count(bare) === 2) || JSON.stringify(r);
  }],
  ['an existing main keeps its history and files; every commit of ours touches only verdicts.json', async () => {
    const bare = bareRemote(fresh());
    const seed = seedMain(bare);
    const p = mk(bare);
    const r1 = await p.publish(list('t1'));
    const r2 = await p.publish(list('t2', ['A', 'B']));
    if (!r1.ok || !r2.ok) return JSON.stringify([r1, r2]);
    if (git(bare, 'rev-list', '--max-parents=0', 'main') !== seed) return 'history rewritten';
    if (git(bare, 'merge-base', '--is-ancestor', seed, 'main') !== '') return 'seed lost';
    if (files(bare).sort().join() !== 'README.md,verdicts.json') return files(bare).join();
    for (const c of git(bare, 'rev-list', `${seed}..main`).split('\n')) {
      const touched = git(bare, 'diff-tree', '--no-commit-id', '--name-only', '-r', c);
      if (touched !== 'verdicts.json') return `${c} touched ${touched}`;
    }
    return true;
  }],
  ['only main exists in the remote', async () => {
    const bare = bareRemote(fresh());
    await mk(bare).publish(list('t1'));
    return git(bare, 'for-each-ref', '--format=%(refname)') === 'refs/heads/main' || git(bare, 'for-each-ref');
  }],
  ['author and committer are the fixed generic identity', async () => {
    const bare = bareRemote(fresh());
    await mk(bare).publish(list('t1'));
    const who = git(bare, 'log', '-1', '--format=%an|%ae|%cn|%ce', 'main');
    const generic = 'Human Music Investigator|human-music-investigator@users.noreply.github.com';
    return who === `${generic}|${generic}` || who;
  }],
  ['a branch other than main throws; so does another path', () => {
    const bare = bareRemote(fresh());
    let a = false;
    let b = false;
    try { mk(bare, { branch: 'dev' }); } catch { a = true; }
    try { mk(bare, { path: 'other.json' }); } catch { b = true; }
    return (a && b) || `${a} ${b}`;
  }],
  ['an unreachable remote is ok:false; once it exists a publish succeeds', async () => {
    const dir = fresh();
    const p = mk(dir);
    const bad = await p.publish(list('t1'));
    if (bad.ok !== false || typeof bad.error !== 'string') return JSON.stringify(bad);
    bareRemote(dir);
    const good = await p.publish(list('t1'));
    return (good.ok === true && good.changed === true && count(dir) === 1) || JSON.stringify(good);
  }],
  ['a refused push is ok:false, leaves nothing behind, and the retry works', async () => {
    const bare = bareRemote(fresh());
    const seed = seedMain(bare);
    const hook = join(bare, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho "denied by test" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const p = mk(bare);
    const bad = await p.publish(list('t1'));
    if (bad.ok !== false || !/denied/.test(bad.error)) return JSON.stringify(bad);
    if (git(bare, 'rev-parse', 'main') !== seed) return 'remote moved';
    rmSync(hook);
    const good = await p.publish(list('t1'));
    return (good.ok && good.changed === true && count(bare) === 2) || JSON.stringify(good);
  }],
  ['a refused first push to an empty remote also retries as a change', async () => {
    const bare = bareRemote(fresh());
    const hook = join(bare, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    const p = mk(bare);
    const bad = await p.publish(list('t1'));
    rmSync(hook);
    const good = await p.publish(list('t1'));
    return (bad.ok === false && good.ok && good.changed === true && count(bare) === 1) || JSON.stringify([bad, good]);
  }],
  ['a clone whose origin was changed is refused and nothing is pushed', async () => {
    const bare = bareRemote(fresh());
    const other = bareRemote(fresh());
    const repoDir = fresh();
    const p = createPublisher({ repoDir, remote: bare, sshKeyPath: '/k' });
    await p.publish(list('t1'));
    git(repoDir, 'remote', 'set-url', 'origin', other);
    const r = await p.publish(list('t2', ['A', 'B']));
    let otherEmpty = false;
    try { git(other, 'rev-parse', 'main'); } catch { otherEmpty = true; }
    return (r.ok === false && /not the configured/.test(r.error) && otherEmpty && count(bare) === 1) || JSON.stringify(r);
  }],
  ['the key is used only through GIT_SSH_COMMAND; pushes never force and target only main', async () => {
    const bare = bareRemote(fresh());
    const calls = [];
    const runGit = (args, o) => { calls.push({ args, env: o.env }); return defaultRunGit(args, o); };
    await mk(bare, { runGit }).publish(list('t1'));
    const pushes = calls.filter((c) => c.args.includes('push'));
    if (pushes.length !== 1) return `${pushes.length} pushes`;
    const a = pushes[0].args;
    if (a.some((x) => /^--?f/.test(x) || /force|^\+/.test(x))) return 'force flag: ' + a.join(' ');
    if (a[a.length - 1] !== 'HEAD:refs/heads/main') return a.join(' ');
    const ssh = pushes[0].env.GIT_SSH_COMMAND;
    return (ssh === "ssh -i '/keys/deploy key' -o IdentitiesOnly=yes -o BatchMode=yes") || ssh;
  }],
  ['an error never carries the key path', async () => {
    const runGit = async (args) => {
      if (args[0] === 'push') throw new Error('Permission denied (publickey) using /keys/deploy key');
      return defaultRunGit(args, { cwd: undefined, env: process.env }).catch(() => ({ stdout: '' }));
    };
    const bare = bareRemote(fresh());
    const repoDir = fresh();
    const p = createPublisher({ repoDir, remote: bare, sshKeyPath: '/keys/deploy key',
      runGit: (args, o) => (args[0] === 'push' ? runGit(args) : defaultRunGit(args, o)) });
    const r = await p.publish(list('t1'));
    return (r.ok === false && !r.error.includes('/keys/deploy key') && /publickey/.test(r.error)) || JSON.stringify(r);
  }],
  ['bad input is ok:false and git is not touched', async () => {
    const bare = bareRemote(fresh());
    const repoDir = fresh();
    const p = createPublisher({ repoDir, remote: bare, sshKeyPath: '/k' });
    const r = await p.publish('not json');
    return (r.ok === false && !existsSync(repoDir)) || JSON.stringify(r);
  }],
  ['cleanup', () => {
    rmSync(root, { recursive: true, force: true });
    return !existsSync(root);
  }],
]);
