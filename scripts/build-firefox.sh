#!/usr/bin/env bash
# Write a Firefox copy of the extension to dist/firefox/ (gitignored).
# Firefox runs Manifest V3 with background.scripts (no service worker) and wants a
# gecko id; everything else is the same code. The Chrome package (extension/) is
# untouched. Load dist/firefox/manifest.json in Firefox at about:debugging >
# This Firefox > Load Temporary Add-on.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
out="$repo/dist/firefox"
rm -rf "$out"
mkdir -p "$out"
cp -r "$repo/extension/." "$out/"
node - "$repo/extension/manifest.json" "$out/manifest.json" <<'JS'
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(src, 'utf8'));
// The service worker's importScripts list, as plain background scripts.
m.background = { scripts: ['src/core/text.js', 'src/core/lists.js', 'src/core/settings.js', 'src/background.js'] };
m.browser_specific_settings = { gecko: { id: 'human-music@wai-lau', strict_min_version: '121.0' } };
fs.writeFileSync(dst, JSON.stringify(m, null, 2) + '\n');
console.log(`wrote ${dst}`);
JS
echo "Firefox build in dist/firefox ($(find "$out" -type f | wc -l) files)"
