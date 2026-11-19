#!/usr/bin/env bash
# Write dist/human-music-<version>.crx (gitignored), signed with the Chrome Web
# Store verified-upload key. The store item is opted in to verified CRX uploads,
# so every upload must be this signed .crx, not a zip.
#
# Packs the COMMITTED extension/ (git HEAD, or the commit given as the first argument), never
# uncommitted work in the tree. Output goes to dist/, or to $HM_DIST_DIR (the release packs into a
# staging folder first, so nothing is tagged until every pack has worked).
# Key: $HM_CRX_KEY, default ~/.keys/human-music-crx.pem (kept outside the repo).
# Chrome: $HM_CHROME, default the newest Playwright Chromium.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
ref=${1:-HEAD}
dist=${HM_DIST_DIR:-$repo/dist}
key=${HM_CRX_KEY:-$HOME/.keys/human-music-crx.pem}
chrome=${HM_CHROME:-$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)}
[[ -f $key ]] || { echo "no signing key at $key" >&2; exit 1; }
[[ -x $chrome ]] || { echo "no Chromium found; set HM_CHROME" >&2; exit 1; }
git -C "$repo" diff --quiet HEAD -- extension \
  || echo "note: extension/ has uncommitted changes; packing $ref without them" >&2

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$repo" archive "$ref" extension | tar -x -C "$work"
# The store package asks for no development-only permission (scripts/store-manifest.mjs).
node "$repo/scripts/store-manifest.mjs" "$work/extension/manifest.json"
version=$(node -p "require(process.argv[1]).version" "$work/extension/manifest.json")

"$chrome" --headless=new --no-sandbox --user-data-dir="$work/profile" \
  --pack-extension="$work/extension" --pack-extension-key="$key" >/dev/null 2>&1 || true
[[ -f $work/extension.crx ]] || { echo "Chromium did not write a .crx" >&2; exit 1; }

# The .crx must carry our public key, or the store rejects it.
pub=$(openssl pkey -in "$key" -pubout -outform DER | xxd -p | tr -d '\n')
xxd -p "$work/extension.crx" | tr -d '\n' | grep -q "$pub" \
  || { echo ".crx is not signed with $key" >&2; exit 1; }

out="$dist/human-music-$version.crx"
mkdir -p "$dist"
mv "$work/extension.crx" "$out"
chmod 644 "$out"
echo "wrote $out (version $version, from $(git -C "$repo" rev-parse --short "$ref"))"
