#!/usr/bin/env bash
# Save your lists into the repo: copy the newest Human Music export
# (human-music-backup*.json, from the popup's Lists tab > Export) from your
# Windows Downloads folder to extension/lists/my-lists.json, then commit and push.
# The extension imports that file on its next reload.
# Usage: scripts/save-lists.sh [path/to/export.json]
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
src=${1:-}
if [ -z "$src" ]; then
  downloads=${DOWNLOADS:-}
  if [ -z "$downloads" ] && command -v cmd.exe >/dev/null; then
    downloads="$(wslpath "$(cd /mnt/c && cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")/Downloads"
  fi
  src=$(ls -t "$downloads"/human-music-backup*.json 2>/dev/null | head -1 || true)
  [ -n "$src" ] || { echo "No human-music-backup*.json in ${downloads:-Downloads}; export one from the popup first." >&2; exit 1; }
fi
node -e '
  const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (b.format !== "human-music-backup" || b.version !== 1) { console.error("Not a Human Music backup: " + process.argv[1]); process.exit(1); }
  const u = b.user || {};
  console.log(`${(u.artists||[]).length} artists, ${(u.songs||[]).length} songs, ${(u.keywords||[]).length} keywords, ${(u.neverSkip||[]).length} never-skip`);
' "$src"
cp "$src" "$repo/extension/lists/my-lists.json"
cd "$repo"
if git diff --quiet -- extension/lists/my-lists.json; then echo "No change to save."; exit 0; fi
git add extension/lists/my-lists.json
git commit -q -m "lists: update my lists" -- extension/lists/my-lists.json
git push -q
echo "Saved $(basename "$src") as extension/lists/my-lists.json and pushed. Reload the extension to import it."
