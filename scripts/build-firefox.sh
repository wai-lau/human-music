#!/usr/bin/env bash
# Write a Firefox copy of the extension to dist/firefox/ (gitignored), built from a
# COMMIT, never the working tree: `git archive <ref> extension`, ref default HEAD.
# Usage: scripts/build-firefox.sh [ref]
# Firefox runs Manifest V3 with background.scripts (no service worker) and wants a
# gecko id; everything else is the same code. The Chrome package (extension/) is
# untouched. Load dist/firefox/manifest.json in Firefox at about:debugging >
# This Firefox > Load Temporary Add-on.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
ref=${1:-HEAD}
git -C "$repo" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || { echo "no such commit: $ref" >&2; exit 1; }
out="$repo/dist/firefox"
rm -rf "$out"
mkdir -p "$out"
git -C "$repo" archive "$ref" extension | tar -x -C "$out" --strip-components=1
node - "$out/manifest.json" "$out/manifest.json" <<'JS'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(src, 'utf8'));
// The service worker's importScripts list, as plain background scripts.
m.background = { scripts: ['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/background.js'] };
m.browser_specific_settings = { gecko: { id: 'human-music@wai-lau', strict_min_version: '121.0',
  // AMO requires this for new extensions (since 2025-11-03). Human Music collects and
  // transmits no data: required ["none"]. Firefox before 140 ignores the key.
  data_collection_permissions: { required: ['none'] } } };
fs.writeFileSync(dst, JSON.stringify(m, null, 2) + '\n');
console.log(`wrote ${dst}`);
JS
echo "Firefox build of $(git -C "$repo" rev-parse --short "$ref") in dist/firefox ($(find "$out" -type f | wc -l) files)"
