#!/usr/bin/env bash
# Build the Firefox copy, then zip its contents (manifest.json at the zip root) to
# dist/human-music-firefox-<version>.zip (gitignored), ready to upload to
# addons.mozilla.org. Version comes from the manifest.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
bash "$repo/scripts/build-firefox.sh"
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
