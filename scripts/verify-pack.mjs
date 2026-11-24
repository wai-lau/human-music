#!/usr/bin/env node
// Checks that a packed copy of the extension is what friends should get, and fails on any problem.
//   node scripts/verify-pack.mjs <staged-dir | .zip | .crx> [--version X.Y.Z] [--firefox]
// A .zip whose name has "firefox" in it (or --firefox) is checked as the Firefox build.
// release.mjs runs this on every pack before anything is tagged or pushed.
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const PERMISSIONS = ['scripting', 'storage'];
const BANNED_FILES = ['dev-copy', 'lists/my-lists.json', 'src/core/capture.js', 'src/core/fingerprint.js'];

// Returns a list of problems (empty when the tree is fine).
export function verifyTree(dir, { version = null, firefox = false } = {}) {
  const problems = [];
  for (const f of BANNED_FILES) if (existsSync(join(dir, f))) problems.push(`${f} is in the package`);
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch (e) { return [...problems, `no readable manifest.json: ${e.message}`]; }
  if (JSON.stringify([...(manifest.permissions || [])].sort()) !== JSON.stringify(PERMISSIONS)) {
    problems.push(`permissions are ${JSON.stringify(manifest.permissions)}, not ${JSON.stringify(PERMISSIONS)}`);
  }
  if (version && manifest.version !== version) problems.push(`manifest version ${manifest.version} is not the release version ${version}`);
  for (const cs of manifest.content_scripts || []) {
    for (const f of cs.js || []) if (/(^|\/)(capture|fingerprint)\.js$/.test(f)) problems.push(`content script ${f} is listed in the manifest`);
  }
  try {
    const index = JSON.parse(readFileSync(join(dir, 'lists/index.json'), 'utf8'));
    if ((index.files || []).some(f => f && f.file === 'my-lists.json')) problems.push('lists/index.json still lists my-lists.json');
  } catch (e) { if (e.code !== 'ENOENT') problems.push(`lists/index.json unreadable: ${e.message}`); }
  if (firefox) {
    if (manifest.background && 'service_worker' in manifest.background) problems.push('Firefox manifest has a service_worker');
    const id = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko && manifest.browser_specific_settings.gecko.id;
    if (!id) problems.push('Firefox manifest has no gecko id');
  }
  return problems;
}

// Unpacks a .zip or .crx (a zip behind a header) into a scratch folder and checks it.
export function verifyArchive(file, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hm-verify-'));
  try {
    execFileSync('python3', ['-I', '-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', file, dir], { stdio: 'pipe' });
    // A .crx from Chromium keeps the extension at the zip root; guard a single wrapping folder anyway.
    let root = dir;
    const names = readdirSync(dir);
    if (!existsSync(join(dir, 'manifest.json')) && names.length === 1 && statSync(join(dir, names[0])).isDirectory()) root = join(dir, names[0]);
    return verifyTree(root, { ...opts, firefox: opts.firefox ?? /firefox/i.test(basename(file)) });
  } catch (e) {
    return [`cannot read ${file}: ${String(e.stderr || e.message).trim()}`];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function verifyTarget(target, opts = {}) {
  return statSync(target).isDirectory() ? verifyTree(target, opts) : verifyArchive(target, opts);
}

// What the release checks in its staging folder: both packs, at the version being released.
export function verifyStage(stage, version) {
  const problems = [];
  for (const [file, firefox] of [[`human-music-${version}.crx`, false], [`human-music-firefox-${version}.zip`, true]]) {
    const p = join(stage, file);
    if (!existsSync(p)) { problems.push(`${file}: missing from ${stage}`); continue; }
    for (const m of verifyArchive(p, { version, firefox })) problems.push(`${file}: ${m}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const vi = args.indexOf('--version');
  const version = vi >= 0 ? args.splice(vi, 2)[1] : null;
  const fi = args.indexOf('--firefox');
  const firefox = fi >= 0 ? (args.splice(fi, 1), true) : undefined;
  if (args.length !== 1) { console.error('usage: node scripts/verify-pack.mjs <dir|.zip|.crx> [--version X.Y.Z] [--firefox]'); process.exit(2); }
  let problems;
  try { problems = verifyTarget(args[0], { version, firefox: firefox ?? /firefox/i.test(basename(args[0])) }); } catch (e) { problems = [e.message]; }
  if (problems.length) { for (const p of problems) console.error(`verify-pack: ${p}`); process.exit(1); }
  console.log(`verify-pack: ${args[0]} is clean`);
}
