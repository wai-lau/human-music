#!/usr/bin/env bash
# Build the Firefox copy, then zip its contents (manifest.json at the zip root) to
# dist/human-music-firefox-<version>.zip (gitignored), ready to upload to
# addons.mozilla.org. Built from a commit, never the working tree: the tag
# v<version> of the version at HEAD when it exists (a release), else HEAD.
# Usage: scripts/pack-firefox.sh [ref]
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
ref=${1:-}
if [[ -z $ref ]]; then
  head_version=$(git -C "$repo" show HEAD:extension/manifest.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")
  if git -C "$repo" rev-parse --verify --quiet "v$head_version^{commit}" >/dev/null; then
    ref="v$head_version"
  else
    ref=HEAD
    echo "note: no tag v$head_version; building from HEAD" >&2
  fi
fi
bash "$repo/scripts/build-firefox.sh" "$ref"
version=$(node -p "require('$repo/dist/firefox/manifest.json').version")
zip_path="$repo/dist/human-music-firefox-$version.zip"
rm -f "$zip_path"
if command -v zip >/dev/null 2>&1; then
  (cd "$repo/dist/firefox" && zip -qrD -X "$zip_path" .)
else
  python3 - "$repo/dist/firefox" "$zip_path" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1:]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in sorted(os.walk(src)):
        for f in sorted(fs):
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, src))
PY
fi
echo "wrote $zip_path"
