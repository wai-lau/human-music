// The deploy files: contents the plan lists, plus nothing private in a public repo.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './harness.mjs';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const unit = read('deploy/human-music-investigator.service');
const nginx = read('deploy/nginx-human-music.conf');
const env = read('deploy/env.example');
const readme = read('README.md');
const files = { unit, nginx, env, readme };
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const has = (re) => re.test(code(unit));

await run([
  ['unit: NoNewPrivileges, ProtectSystem, PrivateTmp, ProtectHome', () => has(/^NoNewPrivileges=yes$/m) && has(/^ProtectSystem=strict$/m) && has(/^PrivateTmp=yes$/m) && has(/^ProtectHome=yes$/m)],
  ['unit: MemoryMax=600M', () => has(/^MemoryMax=600M$/m)],
  ['unit: ReadWritePaths is the data folder only', () => /^ReadWritePaths=\/var\/lib\/human-music$/m.test(code(unit))],
  ['unit: own user, env file under /etc, ExecStart runs main.mjs with the system node', () => has(/^User=human-music$/m) && has(/^EnvironmentFile=\/etc\/human-music\/env$/m) && has(/^ExecStart=\/usr\/bin\/node \S*\/main\.mjs$/m)],
  ['unit: extra hardening', () => ['ProtectKernelTunables', 'ProtectControlGroups', 'RestrictSUIDSGID', 'LockPersonality'].every((k) => has(new RegExp('^' + k + '=yes$', 'm')))],
  ['unit: every hardening line is explained by a comment above it', () => {
    const lines = unit.split('\n');
    return lines.every((l, i) => !/^(Protect|Restrict|Lock|NoNew|PrivateTmp|MemoryMax)/.test(l) || (i > 0 && lines[i - 1].trim().startsWith('#')));
  }],
  ['nginx: proxies only /human-music/api/ and /human-music/verdicts/, over the unix socket', () => {
    const c = code(nginx);
    const locs = [...c.matchAll(/location\s+(\S+)\s*\{/g)].map((m) => m[1]).sort();
    const sock = 'http://unix:/run/human-music/investigator.sock:/';
    return JSON.stringify(locs) === JSON.stringify(['/human-music/api/', '/human-music/verdicts/']) && [...c.matchAll(/proxy_pass\s+(\S+);/g)].every((m) => m[1].startsWith(sock)) && (c.match(/proxy_pass/g) || []).length === 2 && !/127\.0\.0\.1|8140/.test(c);
  }],
  ['unit: RuntimeDirectory=human-music, for the socket', () => has(/^RuntimeDirectory=human-music$/m)],
  ['unit: IPAddressDeny fences off local and private addresses; only the DNS stub comes back', () => {
    const m = /^IPAddressDeny=(.*)$/m.exec(code(unit));
    return Boolean(m) && m[1].trim().split(/\s+/).join(' ') === 'localhost link-local multicast 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16' && (code(unit).match(/^IPAddressAllow=.*$/gm) || []).join('|') === 'IPAddressAllow=127.0.0.53';
  }],
  ['unit: the new fence lines are explained by a comment above them', () => {
    const lines = unit.split('\n');
    return lines.every((l, i) => !/^(RuntimeDirectory|IPAddressDeny|IPAddressAllow)=/.test(l) || (i > 0 && lines[i - 1].trim().startsWith('#')));
  }],
  ['nginx: 64k body limit and a rate limit', () => /client_max_body_size\s+64k;/.test(code(nginx)) && /limit_req\s+zone=/.test(code(nginx)) && /limit_req_zone/.test(nginx) && /http block/i.test(nginx)],
  ['env.example: exactly the nine names, all empty', () => {
    const names = ['HM_KEY_HASH', 'CLAUDE_CODE_OAUTH_TOKEN', 'SHLABS_API_KEY', 'HM_DAILY_CAP', 'HM_ALLOWED_ORIGIN', 'HM_DATA_DIR', 'HM_PUBLISH_REMOTE', 'HM_PUBLISH_KEY_PATH', 'HM_SOCKET'];
    const lines = env.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    return lines.length === names.length && names.every((n) => lines.includes(n + '='));
  }],
  ['env.example: a comment above each variable', () => {
    const lines = env.split('\n');
    return lines.every((l, i) => !/^[A-Z_]+=/.test(l) || (i > 0 && lines[i - 1].startsWith('#')));
  }],
  ['no file has a home path, /root, or a personal name', () => Object.values(files).every((s) => !/\/home\/|\/root|\/Users\/|wai-root|wai-lau|\bwai\b/i.test(s))],
  ['no file has a key-looking value (long hex, sk- strings, long token after =)', () => Object.values(files).every((s) => !/\b[0-9a-f]{32,}\b/i.test(s) && !/sk-[A-Za-z0-9_-]{10,}/.test(s) && !/=\s*[A-Za-z0-9_-]{24,}\s*$/m.test(s))],
  ['no file names an access detail or another service', () => Object.values(files).every((s) => !/\bssh\s|root@|exec-fn/i.test(s))],
  ['readme: neutral words only', () => !/slop|fake|garbage/i.test(readme) && /made by people/.test(readme) && /AI-generated/.test(readme)],
  ['readme: lists the routes, every env variable and the test command', () => ['/api/investigate', '/api/status', '/api/recheck', '/verdicts/', 'HM_KEY_HASH', 'CLAUDE_CODE_OAUTH_TOKEN', 'SHLABS_API_KEY', 'HM_DAILY_CAP', 'HM_ALLOWED_ORIGIN', 'HM_DATA_DIR', 'HM_PUBLISH_REMOTE', 'HM_PUBLISH_KEY_PATH', 'HM_SOCKET', 'IPAddressDeny', 'investigator.sock', 'npm test'].every((t) => readme.includes(t))],
  ['readme: no ASCII-art diagram', () => !/[─│┌└├]|^\s*[+|]?-{3,}>|-->\s*$/m.test(readme.replace(/```mermaid[\s\S]*?```/g, ''))],
]);
